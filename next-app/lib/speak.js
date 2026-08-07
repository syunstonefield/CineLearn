// 英単語・例文の読み上げ（Web Speech API）。単語帳・単語リスト・復習・予習カードで共用。
//
// ★2026-08-07 オーナー環境の実ログで確定した症状:
//     speak alien Aaron / error canceled / speak alien Aaron / error canceled / speak jurisdiction
//   = speak() は呼ばれ英語音声(Aaron)も選ばれているのに **start が一度も出ない**。
//     発話はキューに入ったまま開始されず、次のクリックの cancel() で canceled になっていた。
//   これは Chrome の既知の「合成器が固まる」状態（内部が paused のまま／キューが死んでいる）で、
//   **speak() の直後に resume() を叩く**のが定番の解錠手段。idle 時の resume() は no-op のため、
//   speak() の前に呼んでも効かない（前版の誤り）。
//
// 実装方針（踏んだ地雷と対策）:
//   ① 固まり: speak() の**直後**と、start が来ない時にもう一度 resume() で蹴る。
//      それでも start が来なければ cancel→resume→speak をもう一度だけやり直す（pending の
//      まま死んでいる場合も再試行する＝前版は pending を「生きている」と誤判定して見送っていた）。
//   ② GC: utterance が回収されると無音になる（Chrome/Safari）→ モジュール変数で保持する。
//   ③ cancel 直後の speak はキューごと落ちる → 鳴っている時だけ cancel し、少し間を空ける。
//   ④ getVoices() は 0 件を返すことがある（本番実測）。空を待って遅延させると発話が
//      ユーザー操作の外へ出て iOS Safari 等が無視する → **待たない**。
//   ⑤ voice は既定音声を優先する。端末によっては特定の音声を明示指定すると鳴らないため、
//      default フラグの立った英語音声だけを選び、無ければ voice 未指定（ブラウザ任せ）にする。
// ★通常経路は必ずクリックと同じタスクで同期的に speak する（iOS の必須要件）。

let _held = null; // ②GC 防止：発話中の utterance をモジュールに固定する

function pickVoice(synth) {
  const list = synth.getVoices() || [];
  if (!list.length) return null; // ④空でも既定音声で鳴る＝待たない
  const en = list.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  if (!en.length) return null;
  // ⑤既定音声のみ明示指定（Aaron のような非既定を指すと鳴らない環境があった）
  return en.find((v) => v.default) || null;
}

// ①固まり解錠。speak() の直後に呼ぶ（idle 時の resume は no-op なので事前呼び出しでは効かない）。
function kick(synth) {
  try {
    synth.resume();
  } catch {
    /* 未対応ブラウザは無視 */
  }
}

function utter(synth, text, onStart) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = pickVoice(synth);
  if (v) u.voice = v;
  u.onstart = onStart || null;
  const release = () => {
    if (_held === u) _held = null;
  };
  u.onend = release;
  u.onerror = release;
  _held = u;
  synth.speak(u);
  kick(synth);
}

export function speak(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  const synth = window.speechSynthesis;

  let started = false;
  const onStart = () => {
    started = true;
  };

  const go = () => {
    utter(synth, text, onStart);
    // 保険1: 少し待って start が来なければもう一度蹴る（paused 固着の解錠）。
    setTimeout(() => {
      if (!started) kick(synth);
    }, 120);
    // 保険2: それでも start が来ない＝キューが死んでいる。積み直して一度だけやり直す。
    //   pending が立っていても再試行する（pending のまま永久に開始されないのが実症状のため）。
    setTimeout(() => {
      if (started) return;
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      kick(synth);
      utter(synth, text, onStart);
    }, 400);
  };

  if (synth.speaking || synth.pending) {
    synth.cancel(); // ③直前の読み上げを止める時だけ、間を空けてから鳴らす
    setTimeout(go, 80);
    return;
  }
  go(); // 通常経路＝クリックと同じタスクで同期的に speak（iOS の必須要件）
}
