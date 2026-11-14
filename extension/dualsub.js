'use strict';
// CineLearn 同時字幕（試し作り 2026-11-14・本番に出さない）
//   英語字幕の下に、端末の中の機械訳（Chrome の Translator API・en→ja）を1行出す。
//   設計: reports/ext-sidepanel-dualsub-2026-11-14/設計.md の B。
//   守ること（法務 2026-11-14）:
//   * 行と訳は保存しない・どこにも送らない。話の間だけメモリ（clDualCache）に持ち、話が変わったら捨てる。
//   * 英語字幕は隠さない。訳は配信の字幕と見分けがつく見た目（書体・色・地・「機械訳」の札）。
//   * 初期はオフ。コピー・書き出しの機能は付けない（行は選択できない）。
//   content.js と同じ isolated world で動く（getOnScreenCaption・getActiveVideo・clControls・SUBTITLE_SELECTORS を使う）。

const CL_DUAL_MODE_KEY = 'cl_dualsub_mode'; // 'off' | 'blur' | 'always'（好みだけを保存。行・訳は保存しない）
const CL_DUAL_MODES = ['off', 'blur', 'always'];
const CL_DUAL_LABEL = { off: '日本語: オフ', blur: '日本語: ぼかし（マウスを乗せた時・一時停止の時だけ読める）', always: '日本語: いつも表示' };
const CL_DUAL_PAIR = { sourceLanguage: 'en', targetLanguage: 'ja' };
const CL_DUAL_CACHE_MAX = 600;

let clDualMode = 'off';
let clDualLine = null;      // 訳の1行
let clDualBtn = null;       // 切り替えボタン
let clDualTranslator = null;
let clDualVia = '';         // 'page'（content script で訳す）| 'bg'（service worker で訳す）
let clDualState = 'idle';   // idle | preparing | ready | unavailable | failed
let clDualCache = new Map(); // 英語の行 → 訳（話の間だけ・メモリだけ）
let clDualShown = '';       // いま訳を出している英語の行
let clDualUrl = location.href;
let clDualSeq = 0;
// 置く側（2026-11-14 オーナー指摘「字幕の長さで日本語が英語の上下を行き来する」）:
//   原則は英語の下。下に入らない行が一度でも出たら、その話（と全画面の出入り）の間は上に固定する。
//   旧実装は行ごとに判定していたため、2行の字幕など下端に近づいた行だけ上へ移っていた。
let clDualSide = 'below';
let clDualSideKey = '';
let clDualLastTop = null;    // 字幕が一瞬消えた時に、仮の位置へ飛ばないための控え
const CL_DUAL_BLUR_KEY = 'cl_dualsub_blurstyle'; // ぼかしの見え方 'soft'（薄く）| 'ghost'（輪郭だけ）。好みだけを保存
const CL_DUAL_BLUR_STYLES = ['soft', 'ghost'];
const CL_DUAL_BLUR_LABEL = { soft: 'A 薄く', ghost: 'B 輪郭だけ' };
let clDualBlurStyle = 'soft';
const clDualStats = { n: 0, cached: 0, last: 0, max: 0, sum: 0, via: '' }; // 遅れの計測（試し作り用・ms）

const clDualHasApi = () => typeof Translator !== 'undefined';

function clDualSetState(s, note) {
  clDualState = s;
  if (clDualBtn) {
    clDualBtn.dataset.mode = clDualMode;
    clDualBtn.dataset.state = s;
    clDualBtn.title = CL_DUAL_LABEL[clDualMode] + (note ? `\n${note}` : '') + '\n（Chrome の翻訳機能による機械訳です。字幕の行と訳は、この端末の外に送らず、保存しません）';
  }
}

// service worker に訳を頼む（content script から呼べない時の控え。行は拡張の中だけで受け渡し、端末の外には出ない）
function clDualAskBg(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'CL_DUALSUB', ...payload }, (res) => resolve(chrome.runtime.lastError ? null : res));
    } catch { resolve(null); }
  });
}

// 訳の準備。初回はデータを端末に入れる（利用者の操作＝ボタンのクリックの中で呼ぶ）。
async function clDualPrepare() {
  if (clDualState === 'ready' || clDualState === 'preparing') return;
  if (!clDualHasApi()) { clDualSetState('unavailable', 'この Chrome では使えません'); return; }
  clDualSetState('preparing', '訳の準備をしています（初回だけ）');
  clDualRender('訳の準備をしています（初回だけ）', true);
  const t0 = performance.now();
  try {
    const avail = await Translator.availability(CL_DUAL_PAIR);
    if (avail === 'unavailable') { clDualSetState('unavailable', 'この端末では英語→日本語の訳が使えません'); clDualRender('', false); return; }
    // データを入れている途中は create が NotSupportedError で落ちることがある（実測）。入るまで待ってやり直す。
    for (let i = 0; i < 40 && !clDualTranslator; i++) {
      try {
        clDualTranslator = await Translator.create(CL_DUAL_PAIR);
        clDualVia = 'page';
      } catch (e) {
        if (e?.name === 'NotAllowedError' && i > 0) throw e; // 操作なしでは入れられない＝もう一度押してもらう
        if (e?.name !== 'NotSupportedError' && e?.name !== 'NotAllowedError') throw e;
        await new Promise((r) => setTimeout(r, 1500));
        if (i > 0 && (await Translator.availability(CL_DUAL_PAIR)) === 'unavailable') throw e;
      }
    }
    if (!clDualTranslator) throw new Error('timeout');
  } catch (e) {
    // 配信ページの決まりで呼べない時などは service worker で訳す
    const res = await clDualAskBg({ op: 'prepare' });
    if (res?.ok) clDualVia = 'bg';
    else { clDualSetState('failed', `訳の準備に失敗しました（${e?.name || e}）。もう一度押してください`); clDualRender('', false); return; }
  }
  clDualStats.via = clDualVia;
  clDualStats.prepareMs = Math.round(performance.now() - t0);
  console.debug('[CL:dual] ready via', clDualVia, clDualStats.prepareMs, 'ms');
  clDualSetState('ready');
  clDualShown = '';
}

async function clDualTranslate(text) {
  if (clDualCache.has(text)) { clDualStats.cached++; return clDualCache.get(text); }
  let ja = '';
  if (clDualVia === 'page') ja = await clDualTranslator.translate(text);
  else ja = (await clDualAskBg({ op: 'translate', text }))?.ja || '';
  if (ja) {
    if (clDualCache.size >= CL_DUAL_CACHE_MAX) clDualCache.delete(clDualCache.keys().next().value);
    clDualCache.set(text, ja);
  }
  return ja;
}

// いま画面に出ている英語字幕の四角（訳の行を下に置くため）
function clDualCaptionRect() {
  if (IS_AMAZON || IS_DISNEY) {
    if (!clOverlay || clOverlay.style.display === 'none') return null;
    const r = clOverlay.getBoundingClientRect();
    return r.width && r.height ? r : null;
  }
  let box = null;
  for (const sel of SUBTITLE_SELECTORS) {
    let list = [];
    try { list = document.querySelectorAll(sel); } catch { continue; }
    list.forEach((el) => {
      if (!(el.innerText || '').trim()) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      box = box
        ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) }
        : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  }
  return box;
}

function clDualEnsureLine() {
  if (clDualLine) return;
  clDualLine = document.createElement('div');
  clDualLine.id = 'cl-dualsub';
  clDualLine.innerHTML = '<span class="cl-dualsub-text"></span><span class="cl-dualsub-tag">機械訳</span>';
  // 配信のプレイヤーへクリックを流さない（再生・停止が切り替わらないように）
  ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick'].forEach((ev) =>
    clDualLine.addEventListener(ev, (e) => e.stopPropagation(), true));
  document.body.appendChild(clDualLine);
}

function clDualRender(text, isNote) {
  clDualEnsureLine();
  const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  if (clDualLine.parentElement !== host) host.appendChild(clDualLine); // 全画面では全画面要素の中でないと描かれない
  if (!text || clDualMode === 'off') { clDualLine.style.display = 'none'; return; }
  clDualLine.firstChild.textContent = text;
  clDualLine.classList.toggle('cl-dualsub-note', !!isNote);
  clDualLine.style.display = 'flex';
  clDualPosition();
}

function clDualPosition() {
  if (!clDualLine || clDualLine.style.display === 'none') return;
  const v = getActiveVideo();
  const vr = v ? v.getBoundingClientRect() : null;
  const cap = clDualCaptionRect();
  // 字の大きさは英語字幕より小さめ（映像の高さから決める）
  const base = vr && vr.height ? vr.height : window.innerHeight;
  clDualLine.style.fontSize = `${Math.max(14, Math.min(30, Math.round(base * 0.028)))}px`;
  const h = clDualLine.offsetHeight || 30;
  const cx = cap ? (cap.left + cap.right) / 2 : vr ? vr.left + vr.width / 2 : window.innerWidth / 2;
  const limit = Math.min(window.innerHeight, vr ? vr.bottom : window.innerHeight) - h - 6;
  const key = `${location.href}|${document.fullscreenElement || document.webkitFullscreenElement ? 'fs' : 'win'}`;
  if (key !== clDualSideKey) { clDualSideKey = key; clDualSide = 'below'; clDualLastTop = null; }
  if (cap && clDualSide === 'below' && cap.bottom + 6 > limit) clDualSide = 'above'; // 一度上にしたら、この話の間は戻さない
  clDualLine.dataset.place = clDualSide;
  let top;
  if (cap) top = clDualSide === 'above' ? cap.top - h - 6 : cap.bottom + 6;
  else top = clDualLastTop ?? (vr ? vr.bottom - vr.height * 0.1 : window.innerHeight * 0.88);
  top = Math.max(6, Math.min(top, limit));
  clDualLastTop = top;
  clDualLine.style.top = `${Math.round(top)}px`;
  clDualLine.style.left = `${Math.round(cx)}px`;
  clDualLine.style.maxWidth = `${Math.round((vr ? vr.width : window.innerWidth) * 0.86)}px`;
}

// 80ms ごとに画面の英語字幕を見て、変わっていたら訳して下に出す
async function clDualTick() {
  if (location.href !== clDualUrl) { // 話が変わったら覚えた訳を捨てる
    clDualUrl = location.href;
    clDualCache = new Map();
    clDualShown = '';
  }
  if (clDualMode === 'off' || !clEnabled) { if (clDualLine) clDualLine.style.display = 'none'; clDualShown = ''; return; }
  if (clDualState !== 'ready') { clDualPosition(); return; }
  const v = getActiveVideo();
  if (clDualLine) {
    clDualLine.classList.toggle('cl-dualsub-reveal', clDualMode === 'always' || !!(v && v.paused));
    clDualLine.dataset.mode = clDualMode;
  }
  const text = (getOnScreenCaption() || '').replace(/\s+/g, ' ').trim();
  if (text === clDualShown) { clDualPosition(); return; }
  clDualShown = text;
  if (!text) { clDualRender('', false); return; }
  const seq = ++clDualSeq;
  const t0 = performance.now();
  let ja = '';
  try { ja = await clDualTranslate(text); } catch (e) { console.debug('[CL:dual] translate failed', e?.name); }
  if (seq !== clDualSeq) return; // 訳している間に次の字幕に替わった
  const ms = Math.round(performance.now() - t0);
  clDualStats.n++; clDualStats.last = ms; clDualStats.sum += ms; clDualStats.max = Math.max(clDualStats.max, ms);
  clDualRender(ja, false);
}

function clDualSetBlurStyle(style, persist = true) {
  clDualBlurStyle = CL_DUAL_BLUR_STYLES.includes(style) ? style : 'soft';
  clDualEnsureLine();
  clDualLine.dataset.blurstyle = clDualBlurStyle;
  if (persist) { try { chrome.storage.local.set({ [CL_DUAL_BLUR_KEY]: clDualBlurStyle }); } catch { /* 接続切れ */ } }
}

function clDualSetMode(mode, fromClick) {
  clDualMode = CL_DUAL_MODES.includes(mode) ? mode : 'off';
  try { chrome.storage.local.set({ [CL_DUAL_MODE_KEY]: clDualMode }); } catch { /* 接続切れ */ }
  clDualSetState(clDualState);
  clDualShown = '';
  if (clDualMode === 'off') { clDualRender('', false); return; }
  // データが入っていれば操作なしでも準備できる。入っていなければクリックの中でだけ入れる。
  if (clDualState !== 'ready') {
    if (fromClick) clDualPrepare();
    else if (clDualHasApi()) Translator.availability(CL_DUAL_PAIR).then((a) => { if (a === 'available') clDualPrepare(); else clDualSetState('idle', 'ボタンを押すと訳の準備を始めます（初回だけ）'); }).catch(() => {});
  }
}

// ── 初めての案内（1回だけ・閉じたら二度と出さない・再生は止めない・字幕に重ねない）──
//   「日」ボタンの上に小さな吹き出し。先に出る「CineLearn 起動中」の案内が閉じられてから出す（重ねない）。
const CL_DUAL_HINT_KEY = 'cl_dualsub_hint_seen';
let clDualHint = null;
let clDualHintSeen = true; // 読み込むまでは出さない

function clDualHintEnsure() {
  if (clDualHint) return;
  clDualHint = document.createElement('div');
  clDualHint.id = 'cl-dualhint';
  clDualHint.style.display = 'none';
  clDualHint.innerHTML =
    '<div class="cl-hint-title">日本語の同時表示</div>' +
    '<div class="cl-hint-body">「日」を押すと、英語字幕の下に日本語の機械訳を出せます。押すたびに ぼかし → いつも → オフ と切り替わります。' +
    '初回だけ、準備に少し時間がかかります。</div>' +
    '<div class="cl-dualhint-note">日本語は Chrome の翻訳機能による機械訳です。誤りを含むことがあります。</div>' +
    '<button type="button" class="cl-hint-ok">閉じる</button>';
  ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick'].forEach((ev) =>
    clDualHint.addEventListener(ev, (e) => e.stopPropagation(), false));
  clDualHint.querySelector('.cl-hint-ok').addEventListener('click', clDualHintDone);
  document.body.appendChild(clDualHint);
}

function clDualHintDone() {
  clDualHintSeen = true;
  if (clDualHint) clDualHint.style.display = 'none';
  try { chrome.storage.local.set({ [CL_DUAL_HINT_KEY]: true }); } catch { /* 接続切れ */ }
}

// 80ms ごとに出す条件と位置を見る（出ている間だけ動く）
function clDualHintTick() {
  if (clDualHintSeen || !clDualBtn) return;
  const ready = clEnabled && clControls && clControls.style.display !== 'none' && !(clHint && clHint.style.display !== 'none');
  clDualHintEnsure();
  const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  if (clDualHint.parentElement !== host) host.appendChild(clDualHint);
  if (!ready) { clDualHint.style.display = 'none'; return; }
  clDualHint.style.display = 'block';
  const b = clDualBtn.getBoundingClientRect();
  const w = clDualHint.offsetWidth, h = clDualHint.offsetHeight;
  const left = Math.max(8, Math.min(b.right - w, window.innerWidth - w - 8));
  const top = Math.max(8, b.top - h - 12); // ボタン列の上＝字幕より上の高さ
  clDualHint.style.left = `${Math.round(left)}px`;
  clDualHint.style.top = `${Math.round(top)}px`;
}

function clDualInit() {
  if (!clControls) { setTimeout(clDualInit, 500); return; }
  if (!clDualHasApi()) return; // 古い Chrome・Edge など＝ボタンを出さない
  clDualBtn = document.createElement('button');
  clDualBtn.type = 'button';
  clDualBtn.className = 'cl-ctrl-btn cl-dualsub-btn';
  clDualBtn.textContent = '日';
  const stopAll = (e) => e.stopPropagation();
  ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'dblclick'].forEach((ev) => clDualBtn.addEventListener(ev, stopAll, true));
  clDualBtn.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.shiftKey) { // Shift＋クリック＝ぼかしの見え方を A／B で切り替え（比べる用）
      clDualSetBlurStyle(CL_DUAL_BLUR_STYLES[(CL_DUAL_BLUR_STYLES.indexOf(clDualBlurStyle) + 1) % CL_DUAL_BLUR_STYLES.length]);
      try { showMiniToast(`ぼかしの見え方: ${CL_DUAL_BLUR_LABEL[clDualBlurStyle]}`); } catch { /* 古い版 */ }
      return;
    }
    if (!clDualHintSeen) clDualHintDone();
    clDualSetMode(CL_DUAL_MODES[(CL_DUAL_MODES.indexOf(clDualMode) + 1) % CL_DUAL_MODES.length], true);
  }, true);
  clControls.appendChild(clDualBtn);
  clDualSetState('idle');
  try {
    chrome.storage.local.get([CL_DUAL_MODE_KEY, CL_DUAL_BLUR_KEY, CL_DUAL_HINT_KEY], (r) => {
      clDualHintSeen = !!r[CL_DUAL_HINT_KEY];
      clDualSetBlurStyle(r[CL_DUAL_BLUR_KEY] || 'soft', false);
      clDualSetMode(r[CL_DUAL_MODE_KEY] || 'off', false);
    });
    chrome.storage.onChanged.addListener((ch, area) => { // 設定画面で変えた時も反映
      if (area === 'local' && ch[CL_DUAL_BLUR_KEY]) clDualSetBlurStyle(ch[CL_DUAL_BLUR_KEY].newValue, false);
    });
  } catch { /* 接続切れ */ }
  setInterval(() => { clDualTick().catch(() => {}); clDualHintTick(); }, 80);
  window.addEventListener('resize', clDualPosition);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(clDualInit, 800));
else setTimeout(clDualInit, 800);
