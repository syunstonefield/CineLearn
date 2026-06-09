'use strict';
// CineLearn Word Saver - Content Script
//
// document_start で実行されるため Netflix の JS より先にリスナーが登録される。
// クリック・長押しの検出は最上部で即時登録し、DOM 操作は DOMContentLoaded まで待つ。

const CL_WORDS_KEY_BASE = 'cl_my_words';
const ACCENT        = '#c17f3b';
const LONG_PRESS_MS = 600; // 長押し判定ミリ秒

// Amazon Prime Video は video.pause() の連続呼び出しで DRM 再生が落ちるため、
// ホバー時の自動一時停止を無効化する（クリックでの単語保存は有効）
const IS_AMAZON = /amazon\.|primevideo\./.test(location.hostname);

const SUBTITLE_SELECTORS = [
  // Netflix
  '.player-timedtext-text-container',
  '[data-uia="player-text-cue"]',
  '.timedTextContainer',
  '[class*="SubtitleTextContainer"]',
  '[class*="subtitle-text-container"]',
  '.playback-caption-display-container',
  '[class*="caption-display"]',
  '.ms-cue-block',
  '[class*="CaptionText"]',
  '[class*="captionText"]',
  // YouTube
  '.ytp-caption-segment',
  '.captions-text',
  '[class*="caption-visual-line"]',
  // Amazon Prime Video
  '.atvwebplayersdk-captions-text',
  '[class*="captions-text"]',
  '.timedTextAttributedString',
  '[data-testid="timed-text-container"]',
  '[class*="TimedText"]',
  '[class*="timedText"]',
  '.dvui-caption',
  '[class*="caption-window"]',
];

// UI 要素（DOMContentLoaded 後に作成）
let toast = null;
let popup = null;

// ─────────────────────────────────────────────────────────────────
// ① クリック・長押し検出
//    document_start で登録 → Netflix の JS より確実に先に発火する
// ─────────────────────────────────────────────────────────────────
let longPressTimer    = null;
let longPressTriggered = false;

// mousedown / pointerdown：長押しタイマーをスタートし、プレイヤーへ伝播させない
function handleDown(e) {
  const clientX = e.clientX ?? e.touches?.[0]?.clientX;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY;
  if (clientX == null) return;
  const els    = document.elementsFromPoint(clientX, clientY);
  const wordEl = els.find(el => el.classList?.contains('cl-word'));
  if (!wordEl) return;

  e.stopImmediatePropagation();
  e.preventDefault();

  longPressTriggered = false;
  clearTimeout(longPressTimer);

  // 長押し：LONG_PRESS_MS 後にポップアップ表示
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    showWordPopup(wordEl.dataset.word, wordEl.dataset.sentence,
                  wordEl.getBoundingClientRect());
  }, LONG_PRESS_MS);
}
document.addEventListener('mousedown', handleDown, true);

// click / pointerup：プレイヤーの play/pause をブロックし、ポップアップを表示
function handleClick(e) {
  const clientX = e.clientX ?? e.changedTouches?.[0]?.clientX;
  const clientY = e.clientY ?? e.changedTouches?.[0]?.clientY;
  if (clientX == null) return;
  const els    = document.elementsFromPoint(clientX, clientY);
  const wordEl = els.find(el => el.classList?.contains('cl-word'));
  if (!wordEl) return;

  e.stopImmediatePropagation();
  e.preventDefault();

  // 長押しで既に表示済みの場合は何もしない
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }

  clearTimeout(longPressTimer);
  longPressTimer = null;

  // 通常クリック：ポップアップ表示
  showWordPopup(wordEl.dataset.word, wordEl.dataset.sentence,
                wordEl.getBoundingClientRect());
}
document.addEventListener('click', handleClick, true);

// ─────────────────────────────────────────────────────────────────
// ② ホバー検出（mousemove + elementsFromPoint）
//    Netflix のオーバーレイを透過して cl-word を検出する
// ─────────────────────────────────────────────────────────────────
let hoveredWord      = null;
let isSubtitleHovered = false;
let rafPending        = false;

document.addEventListener('mousemove', (e) => {
  if (rafPending) return;
  rafPending = true;

  requestAnimationFrame(() => {
    rafPending = false;
    const els    = document.elementsFromPoint(e.clientX, e.clientY);
    const wordEl = els.find(el => el.classList?.contains('cl-word')) || null;

    if (wordEl === hoveredWord) return;

    if (hoveredWord) hoveredWord.classList.remove('cl-word-active');
    hoveredWord = wordEl;

    if (wordEl) {
      wordEl.classList.add('cl-word-active');
      isSubtitleHovered = true;
      pauseVideo();
    } else {
      isSubtitleHovered = false;
      resumeVideo();
    }
  });
}, { passive: true });

// ─────────────────────────────────────────────────────────────────
// ③ DOM が準備できたら UI と字幕監視を初期化
// ─────────────────────────────────────────────────────────────────
function init() {
  // トースト通知
  toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed', bottom: '130px', left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(20,20,20,0.92)', color: '#fff',
    padding: '10px 22px', borderRadius: '24px',
    fontFamily: 'system-ui, sans-serif', fontSize: '14px',
    zIndex: '2147483647', display: 'none', whiteSpace: 'nowrap',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)', pointerEvents: 'none',
  });
  document.body.appendChild(toast);

  // 単語ポップアップ
  popup = document.createElement('div');
  Object.assign(popup.style, {
    position: 'fixed', background: '#fff', borderRadius: '16px',
    fontFamily: 'system-ui, sans-serif', zIndex: '2147483647',
    display: 'none', flexDirection: 'column',
    boxShadow: '0 8px 40px rgba(0,0,0,0.35)', width: '280px',
    overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)',
  });
  document.body.appendChild(popup);

  // ポップアップ外クリックで閉じる
  document.addEventListener('click', (e) => {
    if (popup && !popup.contains(e.target) &&
        !e.target.classList?.contains('cl-word')) {
      closePopupAndResume();
    }
  });

  // 字幕監視を開始
  if (IS_AMAZON) {
    // アマプラは React 管理 DOM のため直接書き換えると落ちる。
    // 元字幕を透明化し、自前オーバーレイをポーリングで重ねる方式を使う。
    createAmazonOverlay();
  } else {
    findAndWatchSubtitles();
    new MutationObserver(() => findAndWatchSubtitles())
      .observe(document.body, { childList: true, subtree: true });
  }
}

// document_start では body がまだない → DOMContentLoaded まで待つ
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ─────────────────────────────────────────────────────────────────
// 動画の一時停止・再生
// ─────────────────────────────────────────────────────────────────
let pausedVideoRef  = null;
let pauseKeepAlive  = null;

function pauseVideo() {
  const video = Array.from(document.querySelectorAll('video')).find(v => !v.paused);
  if (!video) return;
  pausedVideoRef = video;
  video.pause();

  clearInterval(pauseKeepAlive);
  pauseKeepAlive = setInterval(() => {
    const keepPaused = isSubtitleHovered || popup?.style.display === 'flex';
    if (!keepPaused) { clearInterval(pauseKeepAlive); pauseKeepAlive = null; return; }
    if (pausedVideoRef && !pausedVideoRef.paused) pausedVideoRef.pause();
  }, 50);
}

function resumeVideo() {
  if (popup?.style.display === 'flex') return;
  clearInterval(pauseKeepAlive);
  pauseKeepAlive = null;

  const video = pausedVideoRef;
  if (!video) return;
  pausedVideoRef = null;

  setTimeout(() => {
    if (isSubtitleHovered || popup?.style.display === 'flex') return;
    video.play().catch(() => {});
  }, 150);
}

// ユーザーが動画を直接操作（再生ボタン等）した場合はkeepaliveを解除する
document.addEventListener('play', (e) => {
  if (e.target?.tagName !== 'VIDEO') return;
  // ユーザーが明示的に再生した場合、CineLearnの一時停止を解除
  clearInterval(pauseKeepAlive);
  pauseKeepAlive = null;
  pausedVideoRef = null;
  isSubtitleHovered = false;
}, true);

function closePopupAndResume() {
  if (!popup) return;
  popup.style.display = 'none';
  if (!isSubtitleHovered) resumeVideo();
}

// ─────────────────────────────────────────────────────────────────
// トースト通知
// ─────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 2500);
}

// ─────────────────────────────────────────────────────────────────
// 辞書 API（Free Dictionary API）
// ─────────────────────────────────────────────────────────────────
async function lookupWord(word) {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const [entry] = await res.json();
    const meaning = entry?.meanings?.[0];
    return {
      phonetic:   entry?.phonetics?.find(p => p.text)?.text || entry?.phonetic || '',
      pos:        meaning?.partOfSpeech || '',
      definition: meaning?.definitions?.[0]?.definition || '',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// ストリーミングページからドラマ名・シーズン・エピソードを取得する
// ─────────────────────────────────────────────────────────────────
function getEpisodeContext() {
  let showTitle = '';
  let season    = null;
  let episode   = null;

  const sePatterns = [
    /[Ss]eason\s*(\d+)[\s:·•,]+[Ee]pisode\s*(\d+)/,
    /[Ss](\d+)\s*[Ee](\d+)/,
    /(\d+)\s*[×x]\s*(\d+)/,
    /シーズン\s*(\d+)[^\d]+エピソード\s*(\d+)/,
    /シーズン\s*(\d+)[^\d]+第\s*(\d+)\s*話/,
  ];

  function extractSE(text) {
    if (!text) return null;
    for (const pat of sePatterns) {
      const m = text.match(pat);
      if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
    }
    return null;
  }

  // ① 特定セレクターから S/E とタイトルを取得
  const titleSelectors = [
    '[data-uia="video-title"]',
    '[data-uia="player-title"]',
    '[data-uia="episode-title"]',
    '[data-uia="player-episode-title"]',
    '.video-title',
    '[class*="PlayerTitle"]',
    '[class*="VideoTitle"]',
    '[class*="EpisodeTitle"]',
    '[class*="episode-title"]',
    '[class*="player-title"]',
    '[class*="titleTreatmentWrapper"]',
    '[data-testid="title"]',
    '.webPlayerUIContainer .title',
    // Amazon Prime Video
    '[data-automation-id="title"]',
    '.atvwebplayersdk-title-text',
    '[class*="TitleText"]',
    '[class*="titleText"]',
    '.av-detail-section h1',
    '[data-testid="series-title"]',
    '[data-testid="episode-name"]',
  ];

  for (const sel of titleSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const text = el.textContent.trim();
      if (!text) continue;
      if (!season) {
        const se = extractSE(text);
        if (se) { season = se.season; episode = se.episode; }
      }
      if (!showTitle) {
        const heading = el.querySelector('h1,h2,h3,h4,h5');
        const candidate = heading
          ? heading.textContent.trim()
          : text.split(/[\n\r]/)[0].split(/[:\-–—\/]/)[0].trim();
        if (candidate) showTitle = candidate;
      }
    }
    if (showTitle && season !== null) break;
  }

  // ② ページ全体の全テキストノードから S/E を広くスキャン（Netflix 等で有効）
  // ただし「次のエピソード」「オートプレイ」関連要素は除外して誤検知を防ぐ
  if (season === null) {
    const EXCLUDE_SELECTORS = [
      '[class*="next-episode"]', '[class*="nextEpisode"]', '[class*="next_episode"]',
      '[class*="autoplay"]',     '[class*="AutoPlay"]',
      '[class*="up-next"]',      '[class*="upNext"]',
      '[class*="postplay"]',     '[class*="PostPlay"]',
      '[data-uia*="next"]',      '[data-uia*="autoplay"]',
      '[aria-label*="次のエピソード"]', '[aria-label*="Next Episode"]',
    ];
    const isExcluded = (el) => el?.closest(EXCLUDE_SELECTORS.join(','));

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || ['SCRIPT','STYLE','NOSCRIPT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.classList.contains('cl-word') || p.closest('#cl-popup')) return NodeFilter.FILTER_REJECT;
        if (isExcluded(p)) return NodeFilter.FILTER_REJECT;
        return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let node;
    while ((node = walker.nextNode()) && season === null) {
      const se = extractSE(node.textContent);
      if (se) { season = se.season; episode = se.episode; }
    }
  }

  // ③ document.title から S/E を試みる
  if (season === null) {
    const se = extractSE(document.title);
    if (se) { season = se.season; episode = se.episode; }
  }

  // ④ タイトルが未取得の場合 document.title から抽出
  if (!showTitle) {
    showTitle = document.title
      .replace(/\s*[|\-–—]\s*(Netflix|Prime Video|Amazon|Disney\+|Apple TV\+?|Hulu|U-NEXT)\s*$/i, '')
      .split(/\s*[:\-–—\/]\s*/)[0]
      .trim();
  }

  return { dramaTitle: showTitle || document.title.split('|')[0].trim(), season, episode };
}

// ─────────────────────────────────────────────────────────────────
// VOD実時刻アンカーの記録（タイムスタンプ補正用）
//   字幕が画面に出た瞬間の { 字幕テキスト, video.currentTime } を間引いて保存。
//   Webアプリ側で OpenSubtitles の時刻を VOD の時間軸に補正するのに使う。
//   30秒に1回・最大300個まで。全字幕は取らず最小限のアンカーだけ。
// ─────────────────────────────────────────────────────────────────
const VOD_ANCHOR_MIN_GAP = 30;  // 秒（この間隔より密には取らない）
const VOD_ANCHOR_MAX     = 300; // 1作品あたり最大アンカー数
let   _vodAnchorKey      = '';
let   _vodLastAnchorTime = -999;

function captureVodAnchor(rawText) {
  try {
    const video = Array.from(document.querySelectorAll('video')).find(v => v.currentTime > 0);
    if (!video) return;
    const t = video.currentTime;
    if (!isFinite(t) || t < 2) return;             // 再生直後は除外
    const text = (rawText || '').replace(/\s+/g, ' ').trim();
    if (text.length < 8) return;                   // 短い行はアンカーに不向き

    const ctx = getEpisodeContext();
    const titleKey = (ctx.dramaTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const key = `cl_vodsync_${titleKey}_s${ctx.season || 1}e${ctx.episode || 1}`;

    // エピソードが変わったら間引きタイマーをリセット
    if (key !== _vodAnchorKey) { _vodAnchorKey = key; _vodLastAnchorTime = -999; }
    if (t - _vodLastAnchorTime < VOD_ANCHOR_MIN_GAP) return; // 間引き
    _vodLastAnchorTime = t;

    // 読み込み→追記→保存を storage コールバック内で原子的に行う
    chrome.storage.local.get([key], r => {
      let list = r[key] || [];
      list.push({ text, t: Math.round(t) });
      if (list.length > VOD_ANCHOR_MAX) list = list.filter((_, i) => i % 2 === 0);
      chrome.storage.local.set({ [key]: list });
    });
  } catch { /* 取得失敗は無視 */ }
}

// ─────────────────────────────────────────────────────────────────
// 単語保存（chrome.storage.local）
// ─────────────────────────────────────────────────────────────────
function saveWord(entry) {
  chrome.storage.local.get(['cl_active_profile'], (profileResult) => {
    const profileId = profileResult['cl_active_profile'];
    const key = profileId ? `${CL_WORDS_KEY_BASE}_${profileId}` : CL_WORDS_KEY_BASE;
    chrome.storage.local.get([key], (result) => {
      const words = result[key] || [];
      const idx = words.findIndex(w => w.word.toLowerCase() === entry.word.toLowerCase());
      if (idx >= 0) {
        words[idx] = { ...words[idx], ...entry };
      } else {
        words.unshift(entry);
      }
      chrome.storage.local.set({ [key]: words.slice(0, 500) });
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// ポップアップ表示
// ─────────────────────────────────────────────────────────────────
async function showWordPopup(word, sentence, rect) {
  if (!popup) return;

  // Netflix のオーバーレイが消える前に即座に取得
  const ctx = getEpisodeContext();

  const top  = Math.max(rect.top - 240, 10);
  const left = Math.max(Math.min(rect.left, window.innerWidth - 295), 10);
  Object.assign(popup.style, { display: 'flex', top: `${top}px`, left: `${left}px` });

  popup.innerHTML = `
    <div style="padding:16px">
      <div style="font-size:20px;font-weight:700;color:${ACCENT}">${word}</div>
      <div style="font-size:12px;color:#aaa;margin-top:4px">辞書を検索中...</div>
    </div>`;

  const dict = await lookupWord(word);

  popup.innerHTML = `
    <div style="padding:16px 16px 12px;border-bottom:1px solid #f0f0f0">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
        <span style="font-size:20px;font-weight:700;color:${ACCENT}">${word}</span>
        <span style="font-size:12px;color:#aaa">${dict?.phonetic || ''}</span>
      </div>
      ${dict?.pos ? `<span style="font-size:10px;color:#5b4fd4;
        border:1px solid rgba(91,79,212,0.3);border-radius:3px;padding:1px 6px">
        ${dict.pos}</span>` : ''}
      <div style="margin-top:8px;font-size:13px;color:#333;line-height:1.6">
        ${dict?.definition || '<span style="color:#aaa">定義が見つかりませんでした</span>'}
      </div>
      ${sentence ? `<div style="margin-top:8px;font-size:11px;color:#aaa;
        line-height:1.5;font-style:italic;
        border-top:1px solid #f5f5f5;padding-top:8px">"${sentence}"</div>` : ''}
    </div>
    <div style="padding:10px 16px;display:flex;gap:8px">
      <button id="cl-save-btn" style="flex:1;background:${ACCENT};color:#fff;
        border:none;padding:9px;border-radius:10px;font-size:13px;font-weight:500;
        cursor:pointer;font-family:inherit;">✓ 保存</button>
      <button id="cl-cancel-btn" style="background:#f0f0f0;color:#888;
        border:none;padding:9px 14px;border-radius:10px;font-size:13px;
        cursor:pointer;font-family:inherit;">✕</button>
    </div>`;

  document.getElementById('cl-save-btn').addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    const entry = {
      word,
      sentence:   sentence || '',
      phonetic:   dict?.phonetic || '',
      pos:        dict?.pos || '',
      definition: dict?.definition || '',
      savedAt:    new Date().toLocaleDateString('ja-JP'),
      source:     document.title.split(/[|\-–—]/)[0].trim(),
      dramaTitle: ctx.dramaTitle,
      season:     ctx.season,
      episode:    ctx.episode,
    };
    saveWord(entry);
    try {
      chrome.runtime.sendMessage({ type: 'SAVE_WORD_TO_CLOUD', word: entry }).catch(() => {});
    } catch {}
    closePopupAndResume();
    const epInfo = ctx.season != null ? ` S${ctx.season}E${ctx.episode}` : '';
    showToast(`「${word}」を保存しました${epInfo} ✓`);
  });

  document.getElementById('cl-cancel-btn').addEventListener('click', () => {
    closePopupAndResume();
  });
}

// ─────────────────────────────────────────────────────────────────
// 字幕テキストを単語 span に分割する
// ─────────────────────────────────────────────────────────────────
function wrapWordsInElement(el) {
  if (!el || !el.textContent?.trim()) return;

  // テキストが変化した場合は既存の cl-word を解除して再ラップする
  const currentText = el.textContent.trim();
  if (el.dataset.clWrapped === currentText) return; // 同じ内容なら何もしない
  captureVodAnchor(currentText); // VOD実時刻アンカーを記録（Netflix/YouTube）

  // 既存の cl-word span を元のテキストノードに戻す
  el.querySelectorAll?.('.cl-word').forEach(span => {
    span.replaceWith(document.createTextNode(span.textContent));
  });

  if (!el.textContent?.trim()) return;
  const sentence = currentText;
  const walker   = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.classList.contains('cl-word')) return NodeFilter.FILTER_REJECT;
      return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  textNodes.forEach(textNode => {
    const parent = textNode.parentNode;
    if (!parent) return;
    const fragment = document.createDocumentFragment();

    textNode.textContent.split(/(\b[a-zA-Z']+\b)/).forEach(part => {
      if (/^[a-zA-Z]{2,}$/.test(part) || /^[a-zA-Z]+'[a-zA-Z]+$/.test(part)) {
        const span = document.createElement('span');
        span.className        = 'cl-word';
        span.textContent      = part;
        span.dataset.word     = part.replace(/^'+|'+$/g, '');
        span.dataset.sentence = sentence;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });

    parent.replaceChild(fragment, textNode);
  });

  // ラップ済みテキストを記録（次回の変化検知に使う）
  el.dataset.clWrapped = sentence;
}

// ─────────────────────────────────────────────────────────────────
// Amazon Prime Video 専用：オーバーレイ方式
//   React が管理する字幕 DOM を直接書き換えると、次の字幕更新時に
//   React の差分計算が壊れてプレイヤーごと落ちる（会話が速いと字幕欠落も発生）。
//   そこで元字幕は CSS で透明化し、その上に自前のクリック可能な層を重ねる。
// ─────────────────────────────────────────────────────────────────
let clOverlay       = null;
let lastOverlayText = '';

function createAmazonOverlay() {
  // ① 元字幕テキストを透明化（DOM は触らず CSS のみ＝React と競合しない）
  const style = document.createElement('style');
  style.textContent = `
    .atvwebplayersdk-captions-text,
    .atvwebplayersdk-captions-text * { color: transparent !important; }
  `;
  (document.head || document.documentElement).appendChild(style);

  // ② オーバーレイ層
  clOverlay = document.createElement('div');
  Object.assign(clOverlay.style, {
    position: 'fixed', zIndex: '2147483640',
    pointerEvents: 'none', textAlign: 'center',
    display: 'none', lineHeight: '1.3', whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
  });
  document.body.appendChild(clOverlay);

  // ③ ポーリングで字幕を追従（MutationObserver より競合が少なく安定）
  setInterval(updateAmazonOverlay, 150);
}

function findAmazonCaption() {
  const sels = ['.atvwebplayersdk-captions-text', '[class*="captions-text"]'];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.innerText?.trim()) return el;
    }
  }
  return null;
}

function updateAmazonOverlay() {
  if (!clOverlay) return;
  const cap = findAmazonCaption();
  if (!cap) {
    if (clOverlay.style.display !== 'none') {
      clOverlay.style.display = 'none';
      lastOverlayText = '';
    }
    return;
  }

  const text = cap.innerText.trim();
  if (text !== lastOverlayText) {
    lastOverlayText = text;
    buildOverlayWords(text);
    captureVodAnchor(text); // VOD実時刻アンカーを記録（Amazon）
  }

  // 元字幕の位置・サイズに追従
  const rect = cap.getBoundingClientRect();
  const cs   = getComputedStyle(cap);
  Object.assign(clOverlay.style, {
    display:    'block',
    left:       `${rect.left}px`,
    top:        `${rect.top}px`,
    width:      `${rect.width}px`,
    fontSize:   cs.fontSize,
    fontWeight: cs.fontWeight,
  });
}

function buildOverlayWords(text) {
  clOverlay.innerHTML = '';
  const sentence = text.replace(/\n/g, ' ');
  const lines    = text.split('\n');

  lines.forEach((line, li) => {
    line.split(/(\b[a-zA-Z']+\b)/).forEach(part => {
      const isWord = /^[a-zA-Z]{2,}$/.test(part) || /^[a-zA-Z]+'[a-zA-Z]+$/.test(part);
      const span   = document.createElement('span');
      span.textContent     = part;
      span.style.color     = '#fff';
      span.style.textShadow = '0 1px 3px rgba(0,0,0,0.95)';
      if (isWord) {
        span.className        = 'cl-word';
        span.dataset.word     = part.replace(/^'+|'+$/g, '');
        span.dataset.sentence = sentence;
      }
      clOverlay.appendChild(span);
    });
    if (li < lines.length - 1) clOverlay.appendChild(document.createElement('br'));
  });
}

// ─────────────────────────────────────────────────────────────────
// 字幕コンテナを探して監視する（Netflix / YouTube 用）
// ─────────────────────────────────────────────────────────────────
let watchedContainers = new Set();

function findAndWatchSubtitles() {
  if (IS_AMAZON) return; // アマプラはオーバーレイ方式を使うため何もしない
  SUBTITLE_SELECTORS.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (watchedContainers.has(el)) return;
        watchedContainers.add(el);
        wrapWordsInElement(el);
        new MutationObserver(() => wrapWordsInElement(el))
          .observe(el, { childList: true, subtree: true, characterData: true });
      });
    } catch { }
  });
}

// Netflix の SPA ナビゲーション対応
// Netflix はページをリロードせず URL だけ変わるため、
// URL 変化を検知して watchedContainers をリセットし字幕を再スキャンする
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  watchedContainers.clear(); // 古い DOM 要素への参照を破棄
  // 少し待ってから新しい字幕コンテナをスキャン
  setTimeout(findAndWatchSubtitles, 1000);
  setTimeout(findAndWatchSubtitles, 3000); // 遅延ロードに備えて2回
}).observe(document, { subtree: true, childList: true });
