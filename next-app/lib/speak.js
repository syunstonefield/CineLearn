// 英単語・例文の読み上げ（Web Speech API）。単語帳・単語リスト・復習・予習カードで共用。
//
// 「押しても鳴らない」対策（2026-08-07 オーナー報告：PC・スマホとも無音／消音スイッチは無関係）。
// Web Speech API は実装差と既知バグが多く、素直に書くと鳴らない。ここで踏んでいる地雷は4つ:
//   ① **utterance が GC されると無音になる**（Chrome/Safari の既知バグ）。ローカル変数だけで
//      持っていると発話開始前に回収され得る。→ モジュール変数で参照を保持する。
//   ② `cancel()` 直後の `speak()` はキューごと落ちて鳴らないことがある。
//      → 何か鳴っている時だけ cancel し、その時だけ次のタスクへ回す。
//   ③ ページ復帰・別タブ往復のあと合成器が paused のまま固まることがある → `resume()` で解錠。
//   ④ **`getVoices()` は空を返すことがある**（本番実測で0件・それでも既定音声で鳴る）。
//      空を待って遅延させると **ユーザー操作の外**で speak することになり、iOS Safari や
//      一部 Chrome が黙って無視する。→ **待たない**。voice は取れた時だけ指定する。
// ★原則: 通常経路は必ず**クリックハンドラと同じタスクで同期的に** speak する（iOS の必須要件）。
// 最後の保険として、start が来なければ一度だけ鳴らし直す（③④の取りこぼし用）。

let _held = null; // ①GC 防止：発話中の utterance をモジュールに固定する
let _retried = false;

function pickVoice(synth) {
  const list = synth.getVoices() || [];
  if (!list.length) return null; // ④空でも既定音声で鳴る＝待たない
  const en = list.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  if (!en.length) return null;
  return en.find((v) => /^en[-_]US/i.test(v.lang)) || en[0];
}

function utter(synth, text, onStart) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = pickVoice(synth);
  if (v) u.voice = v;
  u.onstart = onStart || null;
  u.onend = () => {
    if (_held === u) _held = null;
  };
  u.onerror = () => {
    if (_held === u) _held = null;
  };
  _held = u;
  try {
    synth.resume(); // ③paused で固まった合成器を解錠（鳴っていなければ no-op）
  } catch {
    /* 未対応ブラウザは無視 */
  }
  synth.speak(u);
}

export function speak(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  const synth = window.speechSynthesis;
  _retried = false;

  let started = false;
  const onStart = () => {
    started = true;
  };

  const go = () => {
    utter(synth, text, onStart);
    // 保険：start も speaking も立たない＝呑まれた可能性。一度だけ鳴らし直す。
    // （2回目以降は諦める＝無限ループにしない）
    setTimeout(() => {
      if (started || synth.speaking || synth.pending || _retried) return;
      _retried = true;
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      utter(synth, text, onStart);
    }, 300);
  };

  if (synth.speaking || synth.pending) {
    synth.cancel(); // ②直前の読み上げを止める時だけ、間を空けてから鳴らす
    setTimeout(go, 80);
    return;
  }
  go(); // 通常経路＝クリックと同じタスクで同期的に speak（iOS の必須要件）
}
