// 英単語・例文の読み上げ（Web Speech API）。単語帳・単語リスト・復習・予習カードで共用。
//
// 「押しても鳴らない」対策（2026-08-07 オーナー報告）。旧実装は cancel()→speak() の2行で、
// 次の4つのいずれかを踏むと無音になっていた:
//   ① cancel() 直後の speak() は Chrome/Safari でキューごと落ちて鳴らないことがある
//      → 何か鳴っている時だけ cancel し、その時だけ次のタスクへ回して speak する。
//   ② ページ復帰・別タブ往復のあと合成器が pause のまま止まることがある → resume() で解錠。
//   ③ 起動直後は voices が未ロードで無音になる端末がある → voiceschanged を一度だけ待つ。
//   ④ 端末に英語音声が複数あると lang だけでは日本語音声が選ばれ英単語が読めないことがある
//      → en 系の voice を明示指定する。
// ★iOS は「最初の発話がユーザー操作の中で呼ばれる」ことを要求するため、通常経路
//   （何も鳴っていない・voices ロード済み）は同期のまま speak する。遅延させない。

let _voices = [];

function loadVoices(synth) {
  const v = synth.getVoices() || [];
  if (v.length) _voices = v;
  return _voices;
}

function pickVoice() {
  const en = _voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  if (!en.length) return null;
  return en.find((v) => /^en[-_]US/i.test(v.lang)) || en[0];
}

function utter(synth, text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = pickVoice();
  if (v) u.voice = v;
  try {
    synth.resume(); // ② pause で固まった合成器を解錠（鳴っていなければ no-op）
  } catch {
    /* 未対応ブラウザは無視 */
  }
  synth.speak(u);
}

export function speak(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  const synth = window.speechSynthesis;

  const start = () => {
    if (synth.speaking || synth.pending) {
      synth.cancel(); // ① 直前の読み上げを止める時だけ、間を空けてから鳴らす
      setTimeout(() => utter(synth, text), 80);
      return;
    }
    utter(synth, text);
  };

  if (!loadVoices(synth).length) {
    // ③ voices 未ロード（初回・一部端末）→ 一度だけ待つ。取れなくても既定音声で鳴らす。
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      loadVoices(synth);
      start();
    };
    try {
      synth.addEventListener('voiceschanged', go, { once: true });
    } catch {
      /* addEventListener 非対応は setTimeout 側で拾う */
    }
    setTimeout(go, 250);
    return;
  }
  start();
}
