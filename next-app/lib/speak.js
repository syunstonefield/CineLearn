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
//   ⑥ ★2026-11-08 オーナーの PC（macOS・Chrome）の実データ: 音声 199 個・既定は Kyoko(ja-JP)＝英語の既定が無い。
//      voice 未指定だと Chrome は en-US の先頭＝Albert（macOS の"おもしろ音声"＝かすれたホラー声）を選んでいた。
//      → 英語の既定が無く、**ブラウザ任せで選ばれそうな声がおもしろ音声／Eloquence 系（Eddy・Flo 等の機械的な声）の時だけ**
//        自然な声（Samantha・Alex・Daniel…）を明示指定する。ブラウザ任せの声がふつうの声なら今までどおり未指定
//        （Windows・Android・iPhone の挙動は変えない）。
//      非既定を指すと鳴らない環境がある（⑤）ので、明示指定した時は start が来ない／error の時に
//      **voice 未指定で1回だけ言い直す**（保険2・onerror）。
//      どの声を選んだかは localStorage.cl_tts_debug = '1' の時だけコンソールに出す。
// ★通常経路は必ずクリックと同じタスクで同期的に speak する（iOS の必須要件）。

let _held = null; // ②GC 防止：発話中の utterance をモジュールに固定する

// ⑥ macOS の"おもしろ音声"（novelty）と Eloquence 系（機械的な合成音）。名前の先頭で判定する
//   （「Eddy (英語（イギリス）)」のように後ろに地域が付くため）。Google/Microsoft の声はここに入れない。
const NOVELTY = [
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Deranged', 'Good News', 'Hysterical',
  'Jester', 'Organ', 'Pipe Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior',
  'Ralph', 'Kathy', 'Princess', 'Agnes', 'Bruce', 'Vicki', 'Victoria',
];
const ELOQUENCE = ['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley'];
// 自然な声の優先順（先に見つかったもの）。Siri 系（Aaron・Nicky 等）は Chrome で鳴らない例があるので入れない。
const PREFERRED = [
  'Samantha', 'Alex', 'Ava', 'Allison', 'Susan', 'Tom', 'Zoe', 'Evan', 'Nathan',
  'Daniel', 'Karen', 'Moira', 'Tessa', 'Serena', 'Kate', 'Oliver', 'Rishi',
  'Google US English', 'Google UK English Female', 'Google UK English Male',
];

// ⑦ ★2026-11-14 オーナー決定「使える中でいちばんきれいな声を自動で選ぶ」（Chrome 系だけ・Safari は端末の設定の声のまま）:
//   1. Edge の Microsoft「Online (Natural)」の声（AI の声・en-US）
//   2. Mac 等で利用者がダウンロードした「Premium／Enhanced」の声（端末の中・すぐ鳴る）
//   3. Chrome の「Google US English」
//   どれも無ければ今までどおり（⑤⑥）。明示指定なので、鳴らない時は voice 未指定で1回言い直す（保険2）。
//   費用: どれもブラウザ・OS の機能で当社の費用は0。Natural と Google の声はブラウザが文を提供元へ送って音にする。
const NATURAL_ORDER = ['Ava', 'Andrew', 'Emma', 'Brian', 'Jenny', 'Aria', 'Guy', 'Ana', 'Christopher', 'Eric', 'Michelle', 'Roger', 'Steffan'];
const isUS = (v) => /^en[-_]us$/i.test(v.lang || '');
function bestVoice(en) {
  const natural = en.filter((v) => isUS(v) && /Online \(Natural\)/i.test(v.name || ''));
  if (natural.length) {
    const rank = (v) => {
      const n = String(v.name || '');
      const i = NATURAL_ORDER.findIndex((x) => new RegExp(`Microsoft ${x}(?:Multilingual)? Online`).test(n));
      return (i < 0 ? 99 : i) + (/Multilingual/.test(n) ? 0.5 : 0);
    };
    return [...natural].sort((a, b) => rank(a) - rank(b))[0];
  }
  const premium = en.filter((v) => /\b(Premium|Enhanced)\b|\.(premium|enhanced)\./i.test(`${v.name || ''} ${v.voiceURI || ''}`) && !isOdd(v));
  if (premium.length) return premium.find(isUS) || premium[0];
  return en.find((v) => isUS(v) && baseName(v) === 'Google US English') || null;
}

const baseName = (v) => String(v?.name || '').replace(/\s*\(.*$/, '').trim();
const inList = (v, list) => list.includes(baseName(v));
const isOdd = (v) => inList(v, NOVELTY) || inList(v, ELOQUENCE);

// 純粋関数（テスト用に export）。戻り値: 明示指定する voice、または null（＝voice 未指定・ブラウザ任せ）。
//   chromium: ⑥は Chrome 系（Blink）だけ＝voice 未指定だと「lang に合う先頭の声」を選ぶのは Chrome の挙動。
//   Safari（Mac・iPhone の全ブラウザ）は未指定なら端末の設定の声を使うので、今までどおり触らない。
export function pickVoiceFrom(list, { chromium = true } = {}) {
  if (!list || !list.length) return null; // ④空でも既定音声で鳴る＝待たない
  const en = list.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  if (!en.length) return null;
  // ⑦きれいな声があれば最優先（Chrome 系だけ）
  if (chromium) {
    const best = bestVoice(en);
    if (best) return best;
  }
  // ⑤既定の英語音声があればそれだけを明示指定（今までどおり）
  const def = en.find((v) => v.default);
  if (def) return def;
  if (!chromium) return null;
  // ⑥英語の既定が無い時: ブラウザ任せで選ばれそうな声（u.lang='en-US' に合う先頭）がふつうの声なら未指定のまま
  const us = (v) => /^en[-_]us$/i.test(v.lang || '');
  const browserPick = en.find(us) || en[0];
  if (!isOdd(browserPick)) return null;
  for (const name of PREFERRED) {
    const hit = en.find((v) => baseName(v) === name);
    if (hit) return hit;
  }
  // 優先リストに無い時: おもしろ音声・Eloquence 以外で、端末内の声（localService）→それ以外の順
  return en.find((v) => !isOdd(v) && v.localService !== false) || en.find((v) => !isOdd(v)) || null;
}

function isChromium() {
  try {
    return !!navigator.userAgentData; // Chrome・Edge・Android Chrome（iPhone の Chrome は WebKit なので無い）
  } catch {
    return false;
  }
}

// ⑥ Chrome の getVoices() は、そのページで最初に呼んだ時は 0 件で、読み込みが済むと voiceschanged が来る。
//   最初のクリックで 0 件→ブラウザ任せ（＝Albert）にならないよう、この部品を読み込んだ時点で一覧の読み込みを始めておく
//   （待たない④はそのまま。クリック時に一覧が空なら今までどおり未指定で鳴らす）。
let _voices = [];
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    const synth0 = window.speechSynthesis;
    _voices = synth0.getVoices() || [];
    synth0.addEventListener?.('voiceschanged', () => {
      _voices = synth0.getVoices() || [];
    });
  } catch {
    /* ignore */
  }
}

function pickVoice(synth) {
  const now = synth.getVoices() || [];
  return pickVoiceFrom(now.length ? now : _voices, { chromium: isChromium() });
}

function debugLog(...args) {
  try {
    if (window.localStorage.getItem('cl_tts_debug') === '1') console.info('[CineLearn 読み上げ]', ...args);
  } catch {
    /* localStorage 不可は無視 */
  }
}

// ①固まり解錠。speak() の直後に呼ぶ（idle 時の resume は no-op なので事前呼び出しでは効かない）。
function kick(synth) {
  try {
    synth.resume();
  } catch {
    /* 未対応ブラウザは無視 */
  }
}

// noVoice: 明示指定した声で鳴らなかった時の言い直し用（voice 未指定＝ブラウザ任せ）。
// 戻り値: 既定ではない声を明示指定したか（＝鳴らなかったら言い直す対象か）。
function utter(synth, text, onStart, { noVoice = false, onFail = null } = {}) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = noVoice ? null : pickVoice(synth);
  if (v) u.voice = v;
  const explicit = !!v && !v.default;
  debugLog(v ? `声: ${v.name}（${v.lang}${v.default ? '・既定' : ''}）` : noVoice ? '声: ブラウザ任せ（言い直し）' : '声: ブラウザ任せ', '／', text);
  u.onstart = onStart || null;
  const release = () => {
    if (_held === u) _held = null;
  };
  u.onend = release;
  u.onerror = (e) => {
    release();
    debugLog('error', e?.error);
    // 止めた（canceled/interrupted）のは失敗ではない。明示指定した声そのものが失敗した時だけ言い直す
    if (explicit && onFail && e?.error !== 'canceled' && e?.error !== 'interrupted') onFail();
  };
  _held = u;
  synth.speak(u);
  kick(synth);
  return explicit;
}

export function speak(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  const synth = window.speechSynthesis;

  let started = false;
  const onStart = () => {
    started = true;
  };

  let retried = false;
  let explicit = false;
  // ⑥明示指定した声で鳴らない時は、voice 未指定で1回だけ言い直す（onerror と保険2で共用・2回は言い直さない）
  //   ③に合わせ、まだキューに残っている時だけ cancel して少し間を空けてから言い直す。
  const retryPlain = () => {
    if (started || retried) return;
    retried = true;
    const again = () => {
      if (started) return;
      kick(synth);
      utter(synth, text, onStart, { noVoice: true });
    };
    if (synth.speaking || synth.pending) {
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      setTimeout(again, 80);
      return;
    }
    again();
  };

  const go = () => {
    explicit = utter(synth, text, onStart, { onFail: retryPlain });
    // 保険1: 少し待って start が来なければもう一度蹴る（paused 固着の解錠）。
    setTimeout(() => {
      if (!started) kick(synth);
    }, 120);
    // 保険2: それでも start が来ない＝キューが死んでいる。積み直して一度だけやり直す。
    //   pending が立っていても再試行する（pending のまま永久に開始されないのが実症状のため）。
    //   明示指定した声だった時は、やり直しは voice 未指定で（その声が原因の可能性があるため）。
    setTimeout(() => {
      if (started || retried) return;
      if (explicit) {
        retryPlain();
        return;
      }
      retried = true;
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
