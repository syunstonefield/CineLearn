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
const IS_NETFLIX = /netflix\./.test(location.hostname);

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
let clControls       = null; // ◀ 📋 ▶ コントロール群
let clMiniToast      = null; // コピー結果のミニトースト
let clMiniToastTimer = null;

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

  // コピー結果のミニトースト（◀▶📋 群の近くに小さく表示）
  clMiniToast = document.createElement('div');
  Object.assign(clMiniToast.style, {
    position: 'fixed', bottom: '210px', left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(20,20,20,0.92)', color: '#fff',
    padding: '8px 18px', borderRadius: '20px',
    fontFamily: 'system-ui, sans-serif', fontSize: '13px',
    zIndex: '2147483647', display: 'none', whiteSpace: 'nowrap',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)', pointerEvents: 'none',
    transition: 'opacity 0.25s',
  });
  document.body.appendChild(clMiniToast);

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

  // ◀ 📋 ▶ コントロール群を作成
  createSubtitleControls();

  // Netflix のネイティブ字幕トラック取得を開始（MAIN ワールド注入と連携）
  initNativeSubtitles();

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
  // 拡張機能のリロード後、開きっぱなしのタブでは chrome.* が切断される
  // （Extension context invalidated）。記録を黙ってスキップしてエラーを防ぐ。
  if (!chrome.runtime?.id) return;
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
  if (!chrome.runtime?.id) return; // 接続切れ（リロード後の残留タブ）では何もしない
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
      // 1語≈300Bと軽量なため2000語まで保持（≈600KB。旧上限500は過剰に保守的だった）
      chrome.storage.local.set({ [key]: words.slice(0, 2000) });
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
    // 拡張機能のリロード後は古いタブとの接続が切れ保存できない。
    // 黙って失敗する代わりに、再読み込みの案内を出す。
    if (!chrome.runtime?.id) {
      closePopupAndResume();
      showToast('拡張機能が更新されました。ページを再読み込み（F5）してください');
      return;
    }
    const entry = {
      word,
      sentence:   sentence || '',
      phonetic:   dict?.phonetic || '',
      pos:        dict?.pos || '',
      definition: dict?.definition || '',
      savedAt:    new Date().toISOString().slice(0, 10), // ISO（アプリ側で表示変換）
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
// 字幕タイムライン（センテンス送り ◀▶ ／ 1文コピー 📋 用）
//   この拡張は字幕ファイルをパースせず、配信側が画面に表示する字幕 DOM を
//   ミラーリングしている。そのため start/end を持つ字幕ブロック配列は存在しない。
//   → 画面に新しい字幕が出るたびに { text, start:video.currentTime } を
//     時系列で記録し、これを擬似的な字幕ブロック列として扱う。
//   巻き戻し（◀）と 1文コピー（📋）はこの記録だけで成立する。
//   前方向（▶）の未視聴ブロックだけは開始時刻が未知なので、フロンティアでは
//   小さく早送りするフォールバックにする。
// ─────────────────────────────────────────────────────────────────
let captionTimeline   = [];   // [{ text, start }] start 昇順
const TIMELINE_MAX    = 600;  // 1エピソードあたりの保持上限
const FRONTIER_NUDGE  = 4;    // 未視聴ブロックへ ▶ したときの早送り秒

// ◀▶ ナビ用カーソル。連続操作（連打）を取りこぼさず文単位で積み上げる。
let navStart          = -1;   // いまナビ中の「文の先頭ブロック」index
let navTime           = 0;    // 最後にナビ操作した時刻（performance.now）
const NAV_CHAIN_MS    = 1200; // この間隔内の操作は連続操作として navStart を基準にする
let seekDebounceTimer = null; // 連打を1回のシークにまとめる
let pendingSeekTime   = null;

// ── ネイティブ字幕トラック（Netflix の WebVTT を横取りして文 index 化）──
//   netflix-inject.js が JSON.parse を横取りして字幕トラック一覧を postMessage で渡す。
//   その WebVTT を background 経由で取得・パースし、全文を「文」に分割して 0..n の
//   index を付与。◀▶ は index±1 で正確にシークする（DOM も currentTime のズレも見ない）。
let ttMovieId   = null;
let ttCandidates = [];        // [{ language, languageDescription, isForced, url }]
const ttCueCache = new Map(); // url -> cues[]（成功） / 'failed'
const ttPending  = new Set(); // 取得中の url
let ttActiveUrl = null;       // 採用した（＝表示言語に一致した）トラックの url
let ttSentences = [];         // [{ start, end, text }] start 昇順・index=配列位置
let ttNavIdx    = -1;         // ◀▶ ナビ中の文 index（連打を1文ずつ確実に積み上げる）
let ttNavTime   = 0;          // 最後にナビした時刻（performance.now）
let amazonCueMap = new Map(); // Amazon 字幕の蓄積（key: "start|text" → cue）

// 本編の video 要素を取得（Netflix / Amazon 共通）
function getActiveVideo() {
  const vids = Array.from(document.querySelectorAll('video'));
  return vids.find(v => !v.paused && v.currentTime > 0)
      || vids.filter(v => isFinite(v.duration) && v.duration > 0)
             .sort((a, b) => b.duration - a.duration)[0]
      || vids[0] || null;
}

// 画面に新しい字幕が出るたびに呼ぶ。最新到達点（フロンティア）でのみ追記する。
function recordCaptionBlock(rawText) {
  const text = (rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const video = getActiveVideo();
  if (!video) return;
  const start = video.currentTime;
  if (!isFinite(start) || start < 0) return;

  const last = captionTimeline[captionTimeline.length - 1];
  if (last) {
    if (text === last.text)        return; // 同一字幕の継続表示
    if (start <= last.start + 0.4) return; // 巻き戻し後の再表示＝既知領域は記録しない
  }
  captionTimeline.push({ text, start });
  if (captionTimeline.length > TIMELINE_MAX) captionTimeline.shift();
}

// 現在のセリフのブロック index。
//   まず「画面に今出ている字幕テキスト」に一致するブロックを優先する。
//   時刻ベースだと DOM 更新の僅かなズレで現在ブロックを1つ多く数え、
//   ◀ が現在行の先頭へ飛んでしまう（前の行に行けない）ため。
//   一致が無ければ currentTime ベースで直近の過去ブロックにフォールバック。
function getCurrentBlockIndex() {
  if (!captionTimeline.length) return -1;
  const video = getActiveVideo();
  const t = video ? video.currentTime : 0;

  const onscreen = getOnScreenCaption().replace(/\s+/g, ' ').trim();
  if (onscreen) {
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < captionTimeline.length; i++) {
      if (captionTimeline[i].text === onscreen) {
        const d = Math.abs(captionTimeline[i].start - t);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
    }
    if (best >= 0 && bestDiff < 8) return best; // 8秒以内に一致があれば採用
  }

  let idx = -1;
  for (let i = 0; i < captionTimeline.length; i++) {
    if (captionTimeline[i].start <= t + 0.05) idx = i; else break;
  }
  return idx; // -1 = まだ最初のブロックより前
}

// 画面に今出ている字幕テキスト（タイムライン未蓄積時のフォールバック）
function getOnScreenCaption() {
  if (IS_AMAZON) return lastOverlayText || '';
  for (const sel of SUBTITLE_SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      const txt = (el.innerText || '').trim();
      if (txt) return txt;
    }
  }
  return '';
}

// ═════════════════════════════════════════════════════════════════
// ネイティブ字幕トラック取得 → 文 index 化
// ═════════════════════════════════════════════════════════════════

// MAIN ワールドの netflix-inject.js からのメッセージを受け取る。
// ※ Netflix が manifest を parse するのは content.js の init(DOMContentLoaded)より
//   前のこともあるため、リスナーは document_start で即登録する（取りこぼし防止）。
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!d) return;
  // Netflix の字幕トラック一覧
  if (d.source === 'cl-netflix-tt' && d.type === 'tracks') {
    handleTtTracks(d.movieId, d.tracks);
    return;
  }
  // Amazon
  if (d.source === 'cl-amazon-tt') {
    // ① プレイヤーが取得した字幕ファイル本文を横取り（表示中言語＝そのまま採用）
    if (d.type === 'subtitle-content') { handleAmazonSubtitleContent(d.url, d.text); return; }
    // ② 保険：subtitleUrls から URL だけ拾えた場合は inject に取得させて言語判定
    if (d.type === 'subtitle-url') {
      const key = d.url;
      if (!ttCandidates.some(t => t.url === key)) {
        ttCandidates.push({ source: 'amazon', url: key,
          language: d.language || '', languageDescription: d.languageDescription || '' });
      }
      return;
    }
    // ②の取得応答
    if (d.type === 'subtitle') {
      ttPending.delete(d.url);
      let cues = [];
      try { cues = d.text ? parseSubtitle(d.text) : []; } catch { cues = []; }
      ttCueCache.set(d.url, cues.length ? cues : 'failed');
      return;
    }
  }
});

// プレイヤーが取得した字幕ファイル本文をそのまま採用する（表示中言語なので
// 言語判定は不要）。分割配信(複数ファイル)でも1ファイルでも対応できるよう、
// キューを蓄積して毎回 文を再構築する。
function handleAmazonSubtitleContent(url, text) {
  if (!text) return;
  let cues = [];
  try { cues = parseSubtitle(text); } catch { cues = []; }
  if (!cues.length) return;

  let added = 0;
  for (const c of cues) {
    const k = `${c.start.toFixed(2)}|${c.text}`;
    if (!amazonCueMap.has(k)) { amazonCueMap.set(k, c); added++; }
  }
  if (!added && ttSentences.length) return; // 新規キューなし

  const all = Array.from(amazonCueMap.values()).sort((a, b) => a.start - b.start);
  ttSentences = buildSentences(all);
  ttActiveUrl = url;
  navStart = -1;
  ttNavIdx  = -1;
  console.info(`[CineLearn] ネイティブ字幕を採用(Amazon): ${all.length}キュー → ${ttSentences.length}文`);
}

function initNativeSubtitles() {
  // 字幕が出てから表示言語に一致するトラックを選ぶ（定期的に試行）
  setInterval(tickTrackSelection, 1000);
}

function handleTtTracks(movieId, tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return;
  if (movieId !== ttMovieId) {
    // エピソード（作品）が変わった → 全リセット
    ttMovieId   = movieId;
    ttCandidates = [];
    ttActiveUrl = null;
    ttSentences = [];
    ttCueCache.clear();
    ttPending.clear();
  }
  const known = new Set(ttCandidates.map(t => t.url));
  for (const t of tracks) {
    if (t.url && !known.has(t.url)) { ttCandidates.push(t); known.add(t.url); }
  }
  // 表示言語に近い候補から試すよう並べ替え（通常は1回の取得で当たる）
  const prefs = (navigator.languages || [navigator.language || 'en'])
    .map(l => (l || '').toLowerCase().split('-')[0]);
  ttCandidates.sort((a, b) => {
    const ap = prefs.indexOf((a.language || '').toLowerCase().split('-')[0]);
    const bp = prefs.indexOf((b.language || '').toLowerCase().split('-')[0]);
    const av = ap < 0 ? 99 : ap, bv = bp < 0 ? 99 : bp;
    if (av !== bv) return av - bv;
    return (a.isForced ? 1 : 0) - (b.isForced ? 1 : 0);
  });
}

// 画面に出ている字幕テキストと一致するトラックを採用言語として選ぶ
function tickTrackSelection() {
  if (ttActiveUrl || !ttCandidates.length) return;
  const sample = normalizeForMatch(getOnScreenCaption());
  if (sample.length < 4) return; // 字幕がまだ出ていない／短すぎる

  let pendingOrUnfetched = 0;
  for (const t of ttCandidates) {
    const cues = ttCueCache.get(t.url);
    if (cues === undefined) {
      if (!ttPending.has(t.url)) requestSubtitle(t); // 未取得なら取得を開始
      pendingOrUnfetched++;
      continue;
    }
    if (cues === 'failed') continue;
    if (cueListContains(cues, sample)) { activateTrack(t.url, cues); return; }
  }
  // 全候補を取得し終えても一致しなかった場合だけ警告（取得待ちの間は黙る）
  if (pendingOrUnfetched === 0 && !ttWarnedNoMatch) {
    ttWarnedNoMatch = true;
    console.warn('[CineLearn] 表示中の字幕に一致するトラックが見つからず（言語判定失敗）。'
      + ' 画面字幕サンプル=', JSON.stringify(sample.slice(0, 40)));
  }
}
let ttWarnedNoMatch = false;

function activateTrack(url, cues) {
  ttActiveUrl = url;
  ttSentences = buildSentences(cues);
  navStart = -1;  // 旧フォールバックのカーソルは無効化
  ttNavIdx = -1;  // ネイティブナビのカーソルも初期化
  const tr = ttCandidates.find(t => t.url === url);
  console.info(`[CineLearn] ネイティブ字幕を採用: ${tr?.languageDescription || tr?.language || '?'} `
    + `（${cues.length}キュー → ${ttSentences.length}文）`);
}

// 連続するキューを文末（. ! ?）まで束ねて「文」にする
function buildSentences(cues) {
  const out = [];
  let cur = null;
  for (const c of cues) {
    const text = (c.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!cur) cur = { start: c.start, end: c.end, text };
    else { cur.text += ' ' + text; cur.end = c.end; }
    if (endsSentence(text)) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// 字幕本文の取得を依頼する。
//   Netflix: 別オリジン(*.nflxvideo.net)の CORS を background 権限で回避。
//   Amazon : ホストが不定なので、ページ文脈の amazon-inject に fetch させる。
function requestSubtitle(track) {
  const url = track.url;
  if (ttCueCache.has(url) || ttPending.has(url)) return;
  ttPending.add(url);

  if (track.source === 'amazon') {
    window.postMessage({ source: 'cl-amazon-cmd', type: 'fetch', url }, '*');
    return; // 応答は window message リスナーで処理
  }

  if (!chrome.runtime?.id) { ttPending.delete(url); return; }
  try {
    chrome.runtime.sendMessage({ type: 'CL_FETCH_VTT', url }, (res) => {
      ttPending.delete(url);
      if (chrome.runtime.lastError || !res || !res.ok || !res.text) {
        console.warn('[CineLearn] 字幕取得失敗:', chrome.runtime.lastError?.message || res?.error || '不明');
        ttCueCache.set(url, 'failed');
        return;
      }
      let cues = [];
      try { cues = parseSubtitle(res.text); } catch { cues = []; }
      ttCueCache.set(url, cues.length ? cues : 'failed');
    });
  } catch {
    ttPending.delete(url);
    ttCueCache.set(url, 'failed');
  }
}

// WebVTT / TTML を中身から判別してパースする
function parseSubtitle(text) {
  const head = String(text).slice(0, 300);
  if (/^\s*WEBVTT/.test(head)) return parseVtt(text);
  if (/<tt[\s>]/i.test(head) || /ns\/ttml/i.test(head)) return parseTtml(text);
  // 不明な場合は両方試す
  let cues = [];
  try { cues = parseVtt(text); } catch {}
  if (cues.length) return cues;
  try { return parseTtml(text); } catch { return []; }
}

// TTML(XML)をパースして [{ start, end, text }] にする（Amazon Prime 用）
function parseTtml(text) {
  const cues = [];
  let doc;
  try { doc = new DOMParser().parseFromString(String(text), 'application/xml'); } catch { return cues; }
  if (!doc || doc.getElementsByTagName('parsererror').length) {
    try { doc = new DOMParser().parseFromString(String(text), 'text/html'); } catch { return cues; }
  }
  const tt = doc.getElementsByTagName('tt')[0] || doc.documentElement;
  const frameRate = parseFloat(
    tt?.getAttribute?.('ttp:frameRate') || tt?.getAttribute?.('frameRate') || ''
  ) || 25;

  let ps = doc.getElementsByTagName('p');
  if (!ps.length && doc.getElementsByTagNameNS) ps = doc.getElementsByTagNameNS('*', 'p');
  for (const p of Array.from(ps)) {
    const begin = p.getAttribute('begin');
    if (begin == null) continue;
    const start = ttmlTime(begin, frameRate);
    if (!isFinite(start)) continue;
    const endAttr = p.getAttribute('end');
    const end = endAttr != null ? ttmlTime(endAttr, frameRate) : start;
    let t = '';
    for (const node of Array.from(p.childNodes)) t += ttmlNodeText(node);
    t = t.replace(/\s+/g, ' ').trim();
    if (t) cues.push({ start, end: isFinite(end) ? end : start, text: t });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// TTML の <p> 配下テキストを取り出す（<br/> は空白に）
function ttmlNodeText(node) {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType === 1) {
    const ln = (node.localName || node.nodeName || '').toLowerCase();
    if (ln === 'br') return ' ';
    let s = '';
    for (const c of Array.from(node.childNodes)) s += ttmlNodeText(c);
    return s;
  }
  return '';
}

// TTML の時刻表現を秒に変換（clock / offset の両形式）
function ttmlTime(v, frameRate) {
  v = String(v).trim();
  let m;
  if ((m = v.match(/^([\d.]+)ms$/)))  return parseFloat(m[1]) / 1000;
  if ((m = v.match(/^([\d.]+)s$/)))   return parseFloat(m[1]);
  if ((m = v.match(/^([\d.]+)f$/)))   return parseFloat(m[1]) / (frameRate || 25);
  const parts = v.split(':');
  if (parts.length === 3) return (+parts[0]) * 3600 + (+parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 4) return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]) + (+parts[3]) / (frameRate || 25);
  const f = parseFloat(v);
  return isFinite(f) ? f : NaN;
}

// WebVTT をパースして [{ start, end, text }] にする
function parseVtt(vtt) {
  const cues = [];
  const body = String(vtt).replace(/\r/g, '');
  for (const block of body.split(/\n\n+/)) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    const tIdx = lines.findIndex(l => l.includes('-->'));
    if (tIdx < 0) continue;
    const m = lines[tIdx].match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/
    );
    if (!m) continue;
    const start = vttTime(m[1]);
    const end   = vttTime(m[2]);
    let text = lines.slice(tIdx + 1).join(' ')
      .replace(/<[^>]+>/g, '')                                   // <i> 等のタグ除去
      .replace(/&lrm;|&rlm;/gi, '')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start, end, text });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

function vttTime(s) {
  const parts = String(s).replace(',', '.').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// 記号・空白を除いて言語横断で比較できる形に正規化（CJK も保持）
function normalizeForMatch(x) {
  return (x || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function cueListContains(cues, normSample) {
  for (const c of cues) {
    const cs = normalizeForMatch(c.text);
    if (!cs) continue;
    if (cs === normSample || cs.includes(normSample) || normSample.includes(cs)) return true;
  }
  return false;
}

// currentTime が属する文 index（二分探索：start <= t の最後の文）
function currentSentenceIndex(t) {
  let lo = 0, hi = ttSentences.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ttSentences[mid].start <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// ◀▶ の基準となる「いまの文」index を決める。
//   currentTime だけで判定すると、人が字幕を読んで押す頃には再生位置が
//   次の文へ進んでいて ◀ が「表示中の文の先頭」に着く。そこで
//   ①連打中は前回ナビ index を基準 ②画面に表示中の字幕に一致する文を優先
//   ③それも無ければ currentTime ベース、の順で決める。
function nativeCurrentIndex(video) {
  const t = video.currentTime;

  // ① 連打中（直近 NAV_CHAIN_MS）はカーソルで積み上げる。シークは1回にまとめる
  //    ため連打中は再生位置が動かないので、位置整合では拾えない分をここで拾う。
  if (ttNavIdx >= 0 && ttNavIdx < ttSentences.length &&
      (performance.now() - ttNavTime) < NAV_CHAIN_MS) {
    return ttNavIdx;
  }

  // ② カーソル：直近ナビした文に「再生位置がまだ居る」なら、それを基準にする。
  //    タイマーではなく現在位置との整合で判定するので、古いカーソルで遠くへ
  //    飛ぶことがない（＝結構後の文へ飛ぶ／オシレートするバグの防止）。
  if (ttNavIdx >= 0 && ttNavIdx < ttSentences.length) {
    const s = ttSentences[ttNavIdx];
    const nextStart = ttSentences[ttNavIdx + 1] ? ttSentences[ttNavIdx + 1].start : s.end + 60;
    if (t >= s.start - 1.5 && t < nextStart + 0.5) return ttNavIdx;
  }

  // ② 画面に表示中の字幕に一致する文（＝ユーザーが見ている「現在の文」）。
  //    表示字幕はキュー断片なので「その断片を含む文」を探す。短文の誤マッチを
  //    避けるため sample は6文字以上を要求し、包含は一方向（文⊇断片）だけにする。
  //    さらに currentTime の近傍(±6秒)に限定し、遠い同一フレーズへの誤マッチ＝
  //    遠いシーク（Amazon でのスタール）を防ぐ。
  const sample = normalizeForMatch(getOnScreenCaption());
  if (sample.length >= 6) {
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < ttSentences.length; i++) {
      const ns = normalizeForMatch(ttSentences[i].text);
      if (ns && ns.includes(sample)) {
        const d = Math.abs(ttSentences[i].start - t);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
    }
    if (best >= 0 && bestDiff < 6) return best;
  }

  // ③ フォールバック：時刻ベース（表示の残り/先走りに備え少し過去寄り）。
  return currentSentenceIndex(Math.max(0, t - 0.4));
}

// ── 機能1: センテンス（文）単位の巻き戻し / 先送り ──────────────────
// 字幕は1文が複数ブロックに分割されているため、ブロック単位ではなく
// 「文」単位で送る（◀＝前の文の先頭、▶＝次の文の先頭）。1押し＝1文。

// blockIdx を含む文の先頭ブロック index
function sentenceStartIndex(blockIdx) {
  let s = blockIdx;
  while (s - 1 >= 0 && !endsSentence(captionTimeline[s - 1].text)) s--;
  return s;
}
// blockIdx を含む文の末尾ブロック index
function sentenceEndIndex(blockIdx) {
  let e = blockIdx;
  while (e + 1 < captionTimeline.length && !endsSentence(captionTimeline[e].text)) e++;
  return e;
}

function seekRelative(dir) {
  const video = getActiveVideo();
  if (!video) return;

  // ① ネイティブ字幕トラックがあれば、文 index±1 で正確にナビ（最優先）。
  //    「いまの文」は表示中の字幕で判定するので、◀ は確実に1つ前の文へ行く。
  if (ttSentences.length) {
    const base   = nativeCurrentIndex(video);
    const target = Math.max(0, Math.min(ttSentences.length - 1, base + dir));
    ttNavIdx  = target;
    ttNavTime = performance.now();
    scheduleSeek(video, ttSentences[target].start);
    return;
  }

  // ② フォールバック：ネイティブ未取得（取得失敗 / アマプラ等）は
  //    画面ミラーのタイムラインで文単位ナビ。
  if (!captionTimeline.length) return;

  // 基準となる「現在の文の先頭」を決める。
  //   直近 NAV_CHAIN_MS 内の連続操作なら navStart を基準に積み上げる
  //   （シーク直後は字幕DOM・currentTime が安定しないため、画面テキストや
  //     currentTime を見ずに前回ナビ位置から確実に1文ずつ動かす）。
  //   間が空いたら currentTime から現在の文を再同期する。
  const now = performance.now();
  let curStart;
  if (navStart >= 0 && navStart < captionTimeline.length && (now - navTime) < NAV_CHAIN_MS) {
    curStart = navStart;
  } else {
    // 「現在のブロック」は時刻ではなく“画面に表示中の字幕”で判定する。
    //   時刻だけだと再生位置が次の字幕へ先走り、◀ が現在の文の頭に着地するため
    //   （Netflix で直したのと同じドリフト対策）。captionTimeline とは全文一致で
    //   照合するので短文の誤マッチも起きない。
    const cur = getCurrentBlockIndex();
    curStart = sentenceStartIndex(cur < 0 ? 0 : cur);
  }
  navTime = now;

  let targetTime;
  if (dir < 0) {
    // 前の文の先頭へ
    if (curStart - 1 >= 0) {
      navStart = sentenceStartIndex(curStart - 1);
    } else {
      navStart = 0; // すでに先頭文
    }
    targetTime = captionTimeline[navStart].start;
  } else {
    // 次の文の先頭へ
    const curEnd = sentenceEndIndex(curStart);
    if (curEnd + 1 < captionTimeline.length) {
      navStart = curEnd + 1;
      targetTime = captionTimeline[navStart].start;
    } else {
      // フロンティア：次の文は未記録 → 少し早送り（カーソルは無効化）
      navStart = -1;
      const dur = isFinite(video.duration) ? video.duration : Infinity;
      targetTime = Math.min(dur, video.currentTime + FRONTIER_NUDGE);
    }
  }

  scheduleSeek(video, targetTime);
}

// 連打を1回のシークにまとめてプレイヤーのフリーズを防ぐ。
function scheduleSeek(video, time) {
  pendingSeekTime = Math.max(0, time);
  // トレーリングデバウンス：押すたびにタイマーを延長し、指が止まってから
  // 1回だけシークする。超連打で currentTime を何度も叩いてバッファを壊し
  // スタール（リロード表示で停止）するのを防ぐ。
  clearTimeout(seekDebounceTimer);
  seekDebounceTimer = setTimeout(() => {
    seekDebounceTimer = null;
    const v = getActiveVideo() || video;
    const target = pendingSeekTime;
    pendingSeekTime = null;
    if (!v || target == null) return;

    // ホバー一時停止の keepalive が残っていると play と競合して固まるため解除
    clearInterval(pauseKeepAlive);
    pauseKeepAlive = null;
    pausedVideoRef = null;

    if (IS_NETFLIX) {
      // Netflix は currentTime を直接書き換えるとシーク先が未バッファで
      // フリーズする。ページの公式プレイヤーAPI(seek)を inject 経由で呼ぶ。
      window.postMessage({ source: 'cl-netflix-cmd', type: 'seek',
        timeMs: Math.round(target * 1000) }, '*');
    } else {
      try { v.currentTime = target; } catch {}
      // Amazon はシーク後にスタールすることがあるので、少し後に動いて
      // いなければ play() で再生を促す（純正の10秒戻しと同じ復帰のきっかけ）。
      const before = v.currentTime;
      setTimeout(() => {
        if (v.readyState < 3 || Math.abs(v.currentTime - before) < 0.05) {
          v.play().catch(() => {});
        }
      }, 600);
    }
    if (v.paused) v.play().catch(() => {});
  }, 180);
}

// ── 機能2: 文単位の字幕コピー ────────────────────────────────────
// 文末（. ! ? …）判定。末尾の引用符・閉じ括弧は無視して判定する。
function endsSentence(text) {
  const t = (text || '').replace(/[\s"'”’」』）)\]》]+$/u, '');
  return /[.!?…。！？]$/.test(t);
}

// 現在のセリフを含む「1文」を復元して返す。
// 将来の「この文を和訳・文法解説」ボタンからも再利用する想定で切り出している。
function getCurrentSentence() {
  // ネイティブ字幕トラックがあれば、現在時刻の文をそのまま返す（最も正確）
  if (ttSentences.length) {
    const v = getActiveVideo();
    const s = ttSentences[currentSentenceIndex(v ? v.currentTime : 0)];
    if (s) return s.text;
  }
  if (!captionTimeline.length) {
    return getOnScreenCaption().replace(/\s+/g, ' ').trim();
  }
  let idx = getCurrentBlockIndex();
  if (idx < 0) idx = 0; // まだ最初のブロックより前なら先頭を採用

  // 前方向: 直前ブロックが文末でない限り遡って文頭まで含める
  let startIdx = idx;
  while (startIdx - 1 >= 0 && !endsSentence(captionTimeline[startIdx - 1].text)) startIdx--;
  // 後方向: 現在ブロックが文末でない限り次へ進めて文末まで含める
  let endIdx = idx;
  while (endIdx + 1 < captionTimeline.length && !endsSentence(captionTimeline[endIdx].text)) endIdx++;

  return captionTimeline.slice(startIdx, endIdx + 1)
    .map(b => b.text).join(' ').replace(/\s+/g, ' ').trim();
}

async function copyCurrentSentence() {
  const sentence = getCurrentSentence();
  if (!sentence) { showMiniToast('コピーできる字幕がありません'); return; }
  try {
    await navigator.clipboard.writeText(sentence);
    showMiniToast('✓ コピーしました');
  } catch {
    // フォーカス外などで clipboard API が失敗することがあるため execCommand で再試行
    try {
      const ta = document.createElement('textarea');
      ta.value = sentence;
      Object.assign(ta.style, { position: 'fixed', top: '-9999px', opacity: '0' });
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      showMiniToast(ok ? '✓ コピーしました' : 'コピーに失敗しました');
    } catch {
      showMiniToast('コピーに失敗しました');
    }
  }
}

// ── コピー結果のミニトースト（2秒） ──────────────────────────────
function showMiniToast(msg) {
  if (!clMiniToast) return;
  clMiniToast.textContent = msg;
  clMiniToast.style.display = 'block';
  clMiniToast.style.opacity = '1';
  clearTimeout(clMiniToastTimer);
  clMiniToastTimer = setTimeout(() => {
    clMiniToast.style.opacity = '0';
    setTimeout(() => { clMiniToast.style.display = 'none'; }, 250);
  }, 2000);
}

// コントロール群を動画の矩形を基準に配置する。
//   字幕ボックス（行ごとに出入り・高さが変わる）ではなく video 要素を基準にするため、
//   再生中に位置がブレない。リサイズ／全画面でも動画に対して一定の位置を保つ。
function positionControls() {
  if (!clControls) return;
  const v = getActiveVideo();
  const r = v ? v.getBoundingClientRect() : null;
  if (!r || r.width <= 0 || r.height <= 0 || !isFinite(v.duration) || v.duration <= 0) {
    clControls.style.display = 'none';
    return;
  }
  clControls.style.display = 'flex';

  const h = clControls.offsetHeight || 40;
  // 字幕は動画下端から約16%上に出るので、その高さに中央を合わせる
  let top = r.bottom - r.height * 0.16 - h / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  // 動画の右端から少し内側へ
  const margin = Math.max(16, r.width * 0.025);
  let right = Math.max(8, window.innerWidth - r.right + margin);

  clControls.style.top    = `${top}px`;
  clControls.style.right  = `${right}px`;
  clControls.style.bottom = 'auto';
  clControls.style.left   = 'auto';
}

// 全画面時は body 直下の要素が描画されないため、全画面要素の中へ移し替える。
function relocateControlsForFullscreen() {
  if (!clControls) return;
  const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  if (clControls.parentElement !== host) host.appendChild(clControls);
  if (clMiniToast && clMiniToast.parentElement !== host) host.appendChild(clMiniToast);
  positionControls();
}

// ── ◀ 📋 ▶ コントロール群を作成 ─────────────────────────────────
function createSubtitleControls() {
  clControls = document.createElement('div');
  clControls.id = 'cl-controls';
  clControls.style.display = 'none';

  // 既存の「単語クリックで保存」やプレイヤーの再生/停止と競合させないため、
  // ボタン上のポインタ系イベントは外へ伝播させず、クリックはここで止めて処理する。
  const stopAll = e => e.stopPropagation();
  const makeBtn = (label, title, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cl-ctrl-btn';
    b.textContent = label;
    b.title = title;
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'dblclick'].forEach(ev =>
      b.addEventListener(ev, stopAll, true));
    b.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      action();
    }, true);
    return b;
  };

  clControls.append(
    makeBtn('◀',  '前のセリフへ戻る',       () => seekRelative(-1)),
    makeBtn('📋', '今のセリフを1文コピー',  () => copyCurrentSentence()),
    makeBtn('▶',  '次のセリフへ進む',       () => seekRelative(+1)),
  );
  document.body.appendChild(clControls);

  // 全画面の出入りで親要素を移し替え、リサイズで位置を再計算する
  document.addEventListener('fullscreenchange', relocateControlsForFullscreen);
  document.addEventListener('webkitfullscreenchange', relocateControlsForFullscreen);
  window.addEventListener('resize', positionControls);

  // 動画ページでのみ表示。動画の矩形を基準に安定配置（行ごとにブレない）。
  relocateControlsForFullscreen();
  setInterval(relocateControlsForFullscreen, 500);
}

// ─────────────────────────────────────────────────────────────────
// 字幕テキストを単語 span に分割する
// ─────────────────────────────────────────────────────────────────
function wrapWordsInElement(el) {
  if (!el || !el.textContent?.trim()) return;

  // テキストが変化した場合は既存の cl-word を解除して再ラップする
  const currentText = el.textContent.trim();
  if (el.dataset.clWrapped === currentText) return; // 同じ内容なら何もしない
  captureVodAnchor(currentText);   // VOD実時刻アンカーを記録（Netflix/YouTube）
  recordCaptionBlock(currentText); // ◀▶📋 用の字幕タイムラインに記録

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
    captureVodAnchor(text);   // VOD実時刻アンカーを記録（Amazon）
    recordCaptionBlock(text); // ◀▶📋 用の字幕タイムラインに記録
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
  captionTimeline = [];      // エピソードが変わるので字幕タイムラインもリセット
  navStart = -1;             // ナビカーソルもリセット
  // ネイティブ字幕も作品が変わるのでリセット（新 manifest で再取得される）
  ttMovieId = null; ttCandidates = []; ttActiveUrl = null;
  ttSentences = []; ttCueCache.clear(); ttPending.clear(); ttNavIdx = -1;
  amazonCueMap = new Map();
  // 少し待ってから新しい字幕コンテナをスキャン
  setTimeout(findAndWatchSubtitles, 1000);
  setTimeout(findAndWatchSubtitles, 3000); // 遅延ロードに備えて2回
}).observe(document, { subtree: true, childList: true });
