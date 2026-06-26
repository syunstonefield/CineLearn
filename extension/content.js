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
// Disney+（BAMTECH系・hive プレイヤー）。字幕は Web Components の Shadow DOM 内に描画されるため
// Amazon同様オーバーレイ方式で読む（createDisneyOverlay）。ホバー一時停止は有効（DRM落ちは実機監視中）。
const IS_DISNEY = /disneyplus\./.test(location.hostname);

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
let clHoverTip       = null; // ホバーだけで訳を出す小さなツールチップ
let clBadge          = null; // 「CineLearn」ON/OFF バッジ（OFF でも残してON復帰の入口にする）
let clHint           = null; // 初回のクリック保存ヒントふきだし
let clBadgeDimTimer  = null; // 数秒後にバッジを淡色化するタイマー
let clEnabled        = true; // ON/OFF 状態（chrome.storage の cl_enabled で永続化・既定ON）

// ─────────────────────────────────────────────────────────────────
// ① クリック・長押し検出
//    document_start で登録 → Netflix の JS より確実に先に発火する
// ─────────────────────────────────────────────────────────────────
let longPressTimer    = null;
let longPressTriggered = false;

// CineLearn 自身の UI（バッジ／ヒント／◀📋▶／単語ポップアップ）上のクリックか判定。
//   単語検出は elementsFromPoint で座標上の全要素から cl-word を探すため、
//   不透明な自前UIの裏に字幕単語があるとボタン操作を単語クリックと誤検出し、
//   preventDefault+stopImmediatePropagation でボタン自身の click まで潰してしまう。
//   最前面（els[0]）が自前UIなら横取りせず通常のクリックとして扱う。
function isOwnUI(el) {
  if (!el) return false;
  return [clBadge, clHint, clControls, popup].some(ui => ui && ui.contains(el));
}

// mousedown / pointerdown：長押しタイマーをスタートし、プレイヤーへ伝播させない
function handleDown(e) {
  if (!clEnabled) return; // OFF 時は単語操作を一切行わない
  const clientX = e.clientX ?? e.touches?.[0]?.clientX;
  const clientY = e.clientY ?? e.touches?.[0]?.clientY;
  if (clientX == null) return;
  const els    = document.elementsFromPoint(clientX, clientY);
  if (isOwnUI(els[0])) return; // 自前UI上の操作は横取りしない
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
  if (!clEnabled) return; // OFF 時は単語操作を一切行わない
  const clientX = e.clientX ?? e.changedTouches?.[0]?.clientX;
  const clientY = e.clientY ?? e.changedTouches?.[0]?.clientY;
  if (clientX == null) return;
  const els    = document.elementsFromPoint(clientX, clientY);
  if (isOwnUI(els[0])) return; // 自前UI上のクリックは横取りしない（OK等のボタンを生かす）
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
let hoverTipTimer    = null;          // ホバー滞留のデバウンス
const jaCache        = new Map();     // 単語→英日訳のクライアントキャッシュ（連続ホバーの再取得防止）

document.addEventListener('mousemove', (e) => {
  if (rafPending) return;
  rafPending = true;

  requestAnimationFrame(() => {
    rafPending = false;
    const els    = document.elementsFromPoint(e.clientX, e.clientY);
    // OFF 時、または自前UI上にカーソルがある時は裏の単語をハイライト／一時停止しない
    const wordEl = (!clEnabled || isOwnUI(els[0]))
      ? null
      : (els.find(el => el.classList?.contains('cl-word')) || null);

    if (wordEl === hoveredWord) return;

    if (hoveredWord) hoveredWord.classList.remove('cl-word-active');
    hoveredWord = wordEl;

    if (wordEl) {
      wordEl.classList.add('cl-word-active');
      isSubtitleHovered = true;
      pauseVideo();
      scheduleHoverTip(wordEl); // ホバーだけで訳を出す（クリック不要）
    } else {
      isSubtitleHovered = false;
      resumeVideo();
      hideHoverTip();
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

  // ホバー訳ツールチップ（pointer-events:none＝ホバー検出を邪魔しない）
  clHoverTip = document.createElement('div');
  clHoverTip.id = 'cl-hovertip';
  clHoverTip.style.display = 'none';
  document.body.appendChild(clHoverTip);

  // ポップアップ外クリックで閉じる
  document.addEventListener('click', (e) => {
    if (popup && !popup.contains(e.target) &&
        !e.target.classList?.contains('cl-word')) {
      closePopupAndResume();
    }
  });

  // ◀ 📋 ▶ コントロール群を作成
  createSubtitleControls();

  // 「CineLearn 起動中」バッジ＋初回ヒントを作成（常時ONの可視化）
  createStatusBadge();

  // ◀▶ タイムラインのローカル保持（後日再開時も観た範囲を巻き戻せる）
  initTimelinePersistence();

  // 字幕監視を開始
  if (IS_AMAZON) {
    // アマプラは React 管理 DOM のため直接書き換えると落ちる。
    // 元字幕を透明化し、自前オーバーレイをポーリングで重ねる方式を使う。
    createAmazonOverlay();
  } else if (IS_DISNEY) {
    // Disney+(hive)は字幕を Shadow DOM 内に能動再描画する → Amazon同様オーバーレイ方式。
    createDisneyOverlay();
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

  // Disney+ は keepalive(50ms毎の再pause)で再生を握り続けると native の再生ボタンが効かなくなる
  // （再生→即re-pause の綱引き）。1回だけ pause し、以降の再生制御はユーザー/プレイヤーに委ねる。
  if (IS_DISNEY) return;

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
// 英日訳（公式翻訳API＝DeepL/Azure を background 経由で）
//   鍵をサーバー側に隠すため content.js からは外部APIを直接叩かず、
//   background → cinelearn-next /api/translate に中継する（結果はサーバーでキャッシュ）。
//   英英定義（lookupWord）と並べて日本語の意味も出す。失敗・鍵未設定は null で英語のみ。
// ─────────────────────────────────────────────────────────────────
function translateToJa(word) {
  return new Promise((resolve) => {
    if (!word || !chrome.runtime?.id) return resolve(null);
    try {
      chrome.runtime.sendMessage({ type: 'CL_TRANSLATE_JA', word }, (res) => {
        if (chrome.runtime.lastError) return resolve(null); // 接続切れ等は黙って諦める
        resolve(res?.ja || null);
      });
    } catch {
      resolve(null);
    }
  });
}

// 訳をクライアント側でもキャッシュ（ホバーとクリックで二重に取得しない・連続ホバーの抑制）。
function getJaCached(word) {
  const key = (word || '').toLowerCase();
  if (jaCache.has(key)) return Promise.resolve(jaCache.get(key));
  return translateToJa(word).then((ja) => {
    jaCache.set(key, ja);
    return ja;
  });
}

// ─────────────────────────────────────────────────────────────────
// ホバー訳ツールチップ（クリックしなくても訳が見える）
//   字幕の単語に一定時間カーソルが乗ったら、その上に日本語訳を出す。
//   通り過ぎるだけの語で API を叩かないようデバウンスし、結果はキャッシュ。
// ─────────────────────────────────────────────────────────────────
function scheduleHoverTip(wordEl) {
  clearTimeout(hoverTipTimer);
  if (popup && popup.style.display === 'flex') { hideHoverTip(); return; } // 詳細ポップアップ中は出さない
  hoverTipTimer = setTimeout(() => showHoverTip(wordEl), 300);
}

async function showHoverTip(wordEl) {
  if (!clHoverTip || !wordEl || hoveredWord !== wordEl) return; // 既に別の語へ移っていたら出さない
  if (popup && popup.style.display === 'flex') return;
  const word = wordEl.dataset.word;
  if (!word) return;

  // キャッシュ済みなら即時、未取得ならローディング表示してから取得
  const cached = jaCache.get(word.toLowerCase());
  if (cached !== undefined) {
    if (!cached) return hideHoverTip();        // 訳が取れない語は出さない
    clHoverTip.textContent = cached;
  } else {
    clHoverTip.textContent = '…';
  }
  positionHoverTip(wordEl);

  if (cached !== undefined) return;            // キャッシュ表示で完了

  const ja = await getJaCached(word);
  if (hoveredWord !== wordEl) return;          // 取得中に別の語へ移った
  if (!ja) return hideHoverTip();
  clHoverTip.textContent = ja;
  positionHoverTip(wordEl);
}

function positionHoverTip(wordEl) {
  if (!clHoverTip) return;
  clHoverTip.style.visibility = 'hidden';
  clHoverTip.style.display = 'block';
  const r  = wordEl.getBoundingClientRect();
  const th = clHoverTip.offsetHeight || 32;
  const tw = clHoverTip.offsetWidth  || 80;
  let top  = r.top - th - 8;
  if (top < 8) top = r.bottom + 8;             // 上に収まらなければ下へ
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  clHoverTip.style.top  = `${top}px`;
  clHoverTip.style.left = `${left}px`;
  clHoverTip.style.visibility = 'visible';
}

function hideHoverTip() {
  clearTimeout(hoverTipTimer);
  if (clHoverTip) clHoverTip.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────
// ストリーミングページからドラマ名・シーズン・エピソードを取得する
// ─────────────────────────────────────────────────────────────────
// Netflix 内部メタ（netflix-inject.js が MAIN world から渡す視聴中作品情報）。
//   再生中は document.title が「Netflix」のままでタイトルDOMも消えるため、
//   作品の特定はこのメタを最優先にする（取れない時は従来の DOM 抽出にフォールバック）。
let netflixMeta = null;
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (d && d.source === 'cl-netflix-meta' && d.meta && d.meta.title) netflixMeta = d.meta;
});

// サービス名そのもの（作品名が取れなかった時の誤フォールバック）を弾く
const BANNED_TITLES = /^(netflix|prime\s*video|amazon|disney\+?|apple\s*tv\+?|hulu|u-?next|youtube)$/i;

function getEpisodeContext() {
  // Netflix 内部メタが取れていれば最優先（DOMにタイトルが出ていない時の決定打）
  if (netflixMeta && netflixMeta.title && !BANNED_TITLES.test(netflixMeta.title.trim())) {
    return {
      dramaTitle: netflixMeta.title.trim(),
      season:     netflixMeta.season ?? null,
      episode:    netflixMeta.episode ?? null,
    };
  }

  let showTitle = '';
  let season    = null;
  let episode   = null;

  const sePatterns = [
    /[Ss]eason\s*(\d+)[\s:·•,]+[Ee]pisode\s*(\d+)/,
    /[Ss](\d+)\s*[:：]?\s*[Ee](\d+)/,   // "S1E1" / "S1:E1"（Netflix表記）
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

  // サービス名そのもの（例: 再生中Netflixの document.title='Netflix'）は作品名として使わない。
  // 誤った作品に解決させるより、空にして「例文なし＝単語だけ保存」に倒す（#3）。
  if (BANNED_TITLES.test(showTitle)) showTitle = '';

  return { dramaTitle: showTitle, season, episode };
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
// 例文バックフィル（経路②→①畳み込み #3）
//   配信字幕行は保存しないので、クリック語を含む OpenSubtitles の1文を
//   /api/example（background 経由）から取得し、保存済みの同単語に後から埋める。
//   不一致・字幕なし・TMDB未解決・通信失敗は bare（例文なし）のまま＝逆戻りさせない。
// ─────────────────────────────────────────────────────────────────
function requestExampleBackfill(entry, lineText) {
  if (!chrome.runtime?.id) return;
  const payload = {
    title:   entry.dramaTitle,
    season:  entry.season,
    episode: entry.episode,
    word:    entry.word,
  };
  // 複数一致の絞り込み用に現在の再生位置を添える。
  const t = getActiveVideo()?.currentTime;
  if (isFinite(t)) payload.currentTimeSec = Math.round(t);
  // クリック語を含む「画面に出ている字幕行」をアンカーとして添える。サーバーはこれを OS 側の
  // 該当行特定（時計ズレに依存しない照合）にのみ使い、保存しない。画面字幕は端末側に保存しない
  // （entry.sentence='' のまま）＝送るのは照合用の一時データだけ。
  if (lineText) payload.lineText = String(lineText).slice(0, 300);

  try {
    chrome.runtime.sendMessage({ type: 'CL_FETCH_EXAMPLE', payload }, (res) => {
      if (chrome.runtime.lastError) return;       // 接続切れ等は黙って諦める
      if (!res || !res.found || !res.sentence) return;
      const updated = { ...entry, sentence: res.sentence };
      saveWord(updated);                           // ローカルを patch（同単語を上書き）
      try {
        chrome.runtime.sendMessage({ type: 'SAVE_WORD_TO_CLOUD', word: updated }).catch(() => {});
      } catch {}
    });
  } catch { /* 送信失敗は無視 */ }
}

// ─────────────────────────────────────────────────────────────────
// ポップアップ表示
// ─────────────────────────────────────────────────────────────────
async function showWordPopup(word, sentence, rect) {
  if (!popup) return;
  hideHoverTip(); // 詳細ポップアップと重ねない

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

  // 英英定義と英日訳を並行取得（どちらかが失敗してももう一方を表示）。
  // 訳はホバーと同じキャッシュを使い、同じ語を二重に取得しない。
  const [dict, ja] = await Promise.all([lookupWord(word), getJaCached(word)]);

  popup.innerHTML = `
    <div style="padding:16px 16px 12px;border-bottom:1px solid #f0f0f0">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
        <span style="font-size:20px;font-weight:700;color:${ACCENT}">${word}</span>
        <span style="font-size:12px;color:#aaa">${dict?.phonetic || ''}</span>
      </div>
      ${dict?.pos ? `<span style="font-size:10px;color:#5b4fd4;
        border:1px solid rgba(91,79,212,0.3);border-radius:3px;padding:1px 6px">
        ${dict.pos}</span>` : ''}
      ${ja ? `<div style="margin-top:8px;font-size:15px;color:#222;font-weight:600;line-height:1.5">${ja}</div>` : ''}
      ${dict?.definition ? `<div style="margin-top:${ja ? '6px' : '8px'};font-size:13px;
        color:${ja ? '#777' : '#333'};line-height:1.6">${dict.definition}</div>` : ''}
      ${(!ja && !dict?.definition) ? `<div style="margin-top:8px;font-size:13px;color:#aaa">訳・定義が見つかりませんでした</div>` : ''}
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
      // 配信(Netflix/Amazon)の画面字幕行は保存しない（経路②→①畳み込み #3）。
      // 例文は下の requestExampleBackfill が OpenSubtitles 由来の1文で後から埋める。
      sentence:   '',
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
    requestExampleBackfill(entry, sentence); // OS 由来の例文を非同期で補完（#3・画面字幕行をアンカーに）
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
const TIMELINE_MAX    = 1500; // 1エピソードあたりの保持上限（フル話が収まる程度）

// ◀▶ ナビ用カーソル。連続操作（連打）を取りこぼさず文単位で積み上げる。
let navStart          = -1;   // いまナビ中の「文の先頭ブロック」index
let navTime           = 0;    // 最後にナビ操作した時刻（performance.now）
const NAV_CHAIN_MS    = 1200; // この間隔内の操作は連続操作として navStart を基準にする
let seekDebounceTimer = null; // 連打を1回のシークにまとめる
let pendingSeekTime   = null;

// ── ◀▶ タイムラインのローカル保持（後日再開時も観た範囲を巻き戻せる）──
//   観た字幕（captionTimeline）をエピソード単位で chrome.storage.local に保存し、
//   同じ話を開いた時に復元する。端末内のみ・他ユーザーとは非共有。
let ttStoreKey    = null;             // 現在のエピソードの保存キー
let ttStoreDirty  = false;            // 前回保存以降に追記があったか
const TT_KEYS_IDX = 'cl_timeline_index'; // 保存キー一覧（古いエピソードを間引く用）
const TT_KEYS_MAX = 30;               // 保持するエピソード数の上限

// ◀ ▶ ボタン要素（先頭/フロンティアで淡色化するため参照を保持）
let clPrevBtn = null;
let clNextBtn = null;

// 本編の video 要素を取得（Netflix / Amazon / Disney+ 共通）。
// Disney+ 等は currentTime=0・videoWidth=0・duration=NaN の「ダミー video」が同居するため、
// 実際に映像を描画している video（videoWidth>0）を最優先で選ぶ（一時停止中でも本編を取り違えない）。
function getActiveVideo() {
  const vids = Array.from(document.querySelectorAll('video'));
  return vids.find(v => v.videoWidth > 0 && v.currentTime > 0)
      || vids.find(v => v.videoWidth > 0)
      || vids.find(v => !v.paused && v.currentTime > 0)
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
  ttStoreDirty = true; // ローカル保存対象として印を付ける
}

// 現在のエピソードの保存キー（タイトル+S/E）。タイトル未取得なら null。
function episodeStorageKey() {
  try {
    const ctx = getEpisodeContext();
    const titleKey = (ctx.dramaTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (titleKey.replace(/_/g, '').length < 2) return null; // タイトルがまだ取れていない
    return `cl_timeline_${titleKey}_s${ctx.season || 1}e${ctx.episode || 1}`;
  } catch { return null; }
}

// 保存済みブロックを現在の captionTimeline に取り込む（重複は start で除外・昇順整列）
function mergeIntoTimeline(saved) {
  if (!Array.isArray(saved) || !saved.length) return;
  const seen = new Set(captionTimeline.map(b => Math.round(b.start * 10)));
  for (const b of saved) {
    if (!b || typeof b.start !== 'number' || !b.text) continue;
    const k = Math.round(b.start * 10);
    if (!seen.has(k)) { captionTimeline.push({ text: b.text, start: b.start }); seen.add(k); }
  }
  captionTimeline.sort((a, b) => a.start - b.start);
  if (captionTimeline.length > TIMELINE_MAX) captionTimeline = captionTimeline.slice(-TIMELINE_MAX);
}

function loadTimelineFor(key) {
  if (!key || !chrome.runtime?.id) return;
  try {
    chrome.storage.local.get([key], (r) => {
      if (chrome.runtime.lastError) return;
      mergeIntoTimeline(r[key]);
    });
  } catch { /* 接続切れは無視 */ }
}

// dirty なら現在のタイムラインを保存し、古いエピソードを間引く。
function saveTimelineNow() {
  if (!ttStoreDirty || !ttStoreKey || !captionTimeline.length || !chrome.runtime?.id) return;
  ttStoreDirty = false;
  const key = ttStoreKey;
  try {
    chrome.storage.local.set({ [key]: captionTimeline });
    chrome.storage.local.get([TT_KEYS_IDX], (r) => {
      if (chrome.runtime.lastError) return;
      let list = Array.isArray(r[TT_KEYS_IDX]) ? r[TT_KEYS_IDX] : [];
      list = [key, ...list.filter(k => k !== key)];          // 最近使った順
      const remove = list.slice(TT_KEYS_MAX);                // 上限超は破棄対象
      list = list.slice(0, TT_KEYS_MAX);
      chrome.storage.local.set({ [TT_KEYS_IDX]: list });
      if (remove.length) chrome.storage.local.remove(remove);
    });
  } catch { /* 接続切れは無視 */ }
}

// エピソードの確定・切替を監視して復元/保存を回す。
function initTimelinePersistence() {
  setInterval(() => {
    const key = episodeStorageKey();
    if (key !== ttStoreKey) {
      if (ttStoreKey) saveTimelineNow();          // 直前のエピソードを保存
      if (ttStoreKey && key) {                    // 別エピソードへ切替 → 旧データを破棄
        captionTimeline = [];
        navStart = -1;
      }
      ttStoreKey = key;
      ttStoreDirty = false;
      if (key) loadTimelineFor(key);              // 新エピソードを復元（merge）
    } else {
      saveTimelineNow();                          // 同一エピソード中は dirty なら保存
    }
  }, 10000);

  // タブを閉じる/隠れる時の保険保存
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveTimelineNow(); });
  window.addEventListener('pagehide', saveTimelineNow);
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
  if (IS_AMAZON || IS_DISNEY) return lastOverlayText || '';
  for (const sel of SUBTITLE_SELECTORS) {
    for (const el of document.querySelectorAll(sel)) {
      const txt = (el.innerText || '').trim();
      if (txt) return txt;
    }
  }
  return '';
}

// ── 機能1: 巻き戻し / 先送り（最小ステップ方式）──────────────────────
//   ◀▶ は画面に表示された字幕（captionTimeline）だけを使う DOM 読み方式（傍受なし）。
//   句読点が不規則で「文の境目」を当てにできないので、グループ化に頼らず
//   「現在位置から SEEK_MIN_STEP 秒“以上”離れた最初の字幕」へ飛ぶ。
//   → 小さな断片では止まらず（前のセリフに届く）、かつ戻り幅に上限ができて
//     大きく飛ばない（＝未バッファ位置へのシークでスタールしない）。
//   補正値 SEEK_MIN_STEP を上下すれば「届かない↔飛びすぎ」を調整できる。
const SEEK_MIN_STEP = 2.5; // 補正値（秒）: 1押しで最低これだけ時間を移動する

function seekRelative(dir) {
  const video = getActiveVideo();
  if (!video || !captionTimeline.length) return;

  // 基準ブロック（＝表示中の字幕行）。直近 NAV_CHAIN_MS 内の連続操作は
  // 前回ナビ位置から積み上げる（連打で1ステップずつ確実に遡る）。
  const now = performance.now();
  let curIdx;
  if (navStart >= 0 && navStart < captionTimeline.length && (now - navTime) < NAV_CHAIN_MS) {
    curIdx = navStart;
  } else {
    const cur = getCurrentBlockIndex();
    curIdx = cur < 0 ? 0 : cur;
  }
  navTime = now;

  const baseT = captionTimeline[curIdx].start;
  let targetIdx = null;
  if (dir < 0) {
    // baseT より SEEK_MIN_STEP 秒以上前の最初のブロック（断片はスキップ）
    let j = curIdx - 1;
    while (j - 1 >= 0 && baseT - captionTimeline[j].start < SEEK_MIN_STEP) j--;
    if (j >= 0) targetIdx = j;
  } else {
    // baseT より SEEK_MIN_STEP 秒以上後の最初のブロック（記録済みのみ）
    let j = curIdx + 1;
    while (j + 1 < captionTimeline.length && captionTimeline[j].start - baseT < SEEK_MIN_STEP) j++;
    if (j < captionTimeline.length && captionTimeline[j].start > baseT) targetIdx = j;
  }

  if (targetIdx != null) {
    navStart = targetIdx;
    scheduleSeek(video, captionTimeline[targetIdx].start);
  }
}

// ◀▶ ボタンの淡色化。先頭では◀、未視聴フロンティアでは▶を淡く。
function updateNavButtonsState() {
  if (!clPrevBtn || !clNextBtn) return;
  const len = captionTimeline.length;
  const cur = len ? getCurrentBlockIndex() : -1;
  const curIdx = cur < 0 ? 0 : cur;
  clPrevBtn.classList.toggle('cl-ctrl-disabled', !(len && curIdx - 1 >= 0));
  clNextBtn.classList.toggle('cl-ctrl-disabled', !(len && curIdx + 1 < len));
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
    } else if (IS_DISNEY) {
      // Disney+ は一時停止中に currentTime で seek すると「読み込み中」のまま止まりやすい。
      // 先に再生状態へ戻してから seek すると、rebuffer 後に自動で再生が継続しやすい。
      v.play().catch(() => {});
      try { v.currentTime = target; } catch {}
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
  // 字幕を一度も検出していない間（ブラウズ画面の自動再生トレーラー等）は出さない。
  // ◀📋▶ は字幕送り/コピー用なので、視聴中に字幕が出てから初めて表示する。
  const v = getActiveVideo();
  const r = v ? v.getBoundingClientRect() : null;
  if (!clEnabled || captionTimeline.length === 0 ||
      !r || r.width <= 0 || r.height <= 0 || !isFinite(v.duration) || v.duration <= 0) {
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
  if (clBadge && clBadge.parentElement !== host) host.appendChild(clBadge);
  if (clHint && clHint.parentElement !== host) host.appendChild(clHint);
  if (clHoverTip && clHoverTip.parentElement !== host) host.appendChild(clHoverTip);
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

  if (IS_DISNEY) {
    // Disney+ は currentTime シークが rebuffer でスタールするため ◀▶ を一旦無効化（B案）。
    // 字幕読み・単語保存・ホバー一時停止・📋コピーは有効。◀▶は内部APIシーク実装まで保留。
    // clPrevBtn/clNextBtn は null のまま → updateNavButtonsState は guard で no-op。
    clControls.append(makeBtn('📋', '今のセリフを1文コピー', () => copyCurrentSentence()));
  } else {
    clPrevBtn = makeBtn('◀',  '前のセリフへ戻る',      () => seekRelative(-1));
    clNextBtn = makeBtn('▶',  '次のセリフへ進む',      () => seekRelative(+1));
    clControls.append(
      clPrevBtn,
      makeBtn('📋', '今のセリフを1文コピー', () => copyCurrentSentence()),
      clNextBtn,
    );
  }
  document.body.appendChild(clControls);

  // 全画面の出入りで親要素を移し替え、リサイズで位置を再計算する
  document.addEventListener('fullscreenchange', relocateControlsForFullscreen);
  document.addEventListener('webkitfullscreenchange', relocateControlsForFullscreen);
  window.addEventListener('resize', positionControls);

  // 動画ページでのみ表示。動画の矩形を基準に安定配置（行ごとにブレない）。
  relocateControlsForFullscreen();
  setInterval(() => {
    relocateControlsForFullscreen();
    updateNavButtonsState(); // ◀▶ の淡色化（先頭文・未視聴フロンティア）
  }, 500);
}

// ── 「CineLearn」ON/OFF バッジ＋初回ヒント ───────────────────────
//   クリック保存は document_start から常時動くため、ユーザーが任意に止められるよう
//   バッジ自体を ON/OFF トグルにする。OFF でもバッジは消さず、クリックで ON に戻せる。
//   状態は chrome.storage の cl_enabled に永続化（既定 ON）。
//   初回だけクリック保存のヒントを自動表示する（cl_badge_hint_seen で一度きり）。
const CL_HINT_SEEN_KEY = 'cl_badge_hint_seen';
const CL_ENABLED_KEY   = 'cl_enabled';

function createStatusBadge() {
  clBadge = document.createElement('div');
  clBadge.id = 'cl-badge';
  clBadge.innerHTML =
    '<img class="cl-badge-logo" alt="CineLearn">' +
    '<span class="cl-badge-state">ON</span>';
  // content script から拡張同梱画像を読むには web_accessible_resources 登録が必要。
  // 接続切れ（リロード後の残留タブ）では getURL が例外を投げるためガードする。
  try {
    clBadge.querySelector('.cl-badge-logo').src = chrome.runtime.getURL('icons/icon-192.png');
  } catch { /* ロゴ無しで続行 */ }

  clHint = document.createElement('div');
  clHint.id = 'cl-hint';
  clHint.style.display = 'none';
  clHint.innerHTML =
    '<div class="cl-hint-title">CineLearn 起動中</div>' +
    '<div class="cl-hint-body">字幕の単語をクリックすると単語帳に保存できます。' +
    'バッジをクリックすると ON / OFF を切り替えられます。</div>' +
    '<button type="button" class="cl-hint-ok">OK</button>';

  // バッジ／ヒント上の操作は動画プレイヤーやポップアップ閉じ処理へ伝播させない。
  //   ※ bubble phase で止めるのが肝。capture でコンテナに付けると子（OKボタン等）に
  //     イベントが届く前に stopPropagation され、ボタン自身の click が発火しなくなる。
  const stopAll = e => e.stopPropagation();
  [clBadge, clHint].forEach(el => {
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'dblclick'].forEach(ev =>
      el.addEventListener(ev, stopAll, false));
  });

  // バッジクリックで ON/OFF を切り替える
  clBadge.addEventListener('click', () => setEnabled(!clEnabled));
  clHint.querySelector('.cl-hint-ok').addEventListener('click', hideHint);

  document.body.appendChild(clBadge);
  document.body.appendChild(clHint);

  // 全画面に追随させる（clControls と同じホストへ移し替え）
  relocateControlsForFullscreen();

  // ON の時だけ数秒で淡色化（OFF は ON 復帰の入口なので常に見えるまま）。ホバーで戻す。
  clBadge.addEventListener('pointerenter', () => {
    clBadge.classList.remove('cl-badge-dim');
    clearTimeout(clBadgeDimTimer);
  });
  clBadge.addEventListener('pointerleave', scheduleBadgeDim);

  // 保存済みの ON/OFF 状態を反映 → 初回ヒント（接続切れの残留タブでは触らない）
  if (!chrome.runtime?.id) return;
  chrome.storage.local.get([CL_ENABLED_KEY, CL_HINT_SEEN_KEY], (r) => {
    if (chrome.runtime.lastError) return;
    setEnabled(r[CL_ENABLED_KEY] !== false, false); // 未設定（undefined）は ON
    if (!r[CL_HINT_SEEN_KEY]) showHint();
  });
}

// ON/OFF を切り替える。OFF 時は下線・クリック・ホバー一時停止・◀📋▶ を休止する。
//   下線とコントロールの非表示は html.cl-disabled クラスの CSS で行い、DOM は触らない
//   （再 ON で即復帰できる）。クリック等の挙動は clEnabled フラグで各ハンドラがゲートする。
function setEnabled(on, persist = true) {
  clEnabled = !!on;
  if (persist && chrome.runtime?.id) chrome.storage.local.set({ [CL_ENABLED_KEY]: clEnabled });
  document.documentElement.classList.toggle('cl-disabled', !clEnabled);
  updateBadgeState();

  if (!clEnabled) {
    // 休止：ホバー解除・開いている単語ポップアップを閉じる・オーバーレイを隠す
    if (hoveredWord) { hoveredWord.classList.remove('cl-word-active'); hoveredWord = null; }
    isSubtitleHovered = false;
    hideHoverTip();
    closePopupAndResume();
    if (clOverlay) clOverlay.style.display = 'none';
  }
  scheduleBadgeDim();
}

function updateBadgeState() {
  if (!clBadge) return;
  clBadge.classList.toggle('cl-badge-off', !clEnabled);
  const st = clBadge.querySelector('.cl-badge-state');
  if (st) st.textContent = clEnabled ? 'ON' : 'OFF'; // ON/OFF を常時表示＝トグルだと気づける
  clBadge.title = clEnabled
    ? 'CineLearn 起動中 — クリックでOFF'
    : 'CineLearn 停止中 — クリックでON';
}

function scheduleBadgeDim() {
  clearTimeout(clBadgeDimTimer);
  if (!clEnabled) { clBadge?.classList.remove('cl-badge-dim'); return; } // OFF は淡色化しない
  clBadgeDimTimer = setTimeout(() => clBadge?.classList.add('cl-badge-dim'), 4000);
}

function showHint() {
  if (!clHint) return;
  clHint.style.display = 'block';
  clBadge?.classList.remove('cl-badge-dim');
  clearTimeout(clBadgeDimTimer);
}

function hideHint() {
  if (!clHint) return;
  clHint.style.display = 'none';
  if (chrome.runtime?.id) chrome.storage.local.set({ [CL_HINT_SEEN_KEY]: true });
  scheduleBadgeDim();
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
  if (!clEnabled) { clOverlay.style.display = 'none'; return; } // OFF 時はオーバーレイを隠す
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
// Disney+（hive プレイヤー）用オーバーレイ
//   字幕は <timed-text-override-region> 等のオープン Shadow DOM 内
//   `.hive-subtitle-renderer-*` に能動再描画される（document.querySelectorAll では届かない）。
//   Amazon と同様、直接書き換えず Shadow DOM を貫通して読み取り→自前オーバーレイを重ねる。
//   元字幕を隠す style は「字幕が属する shadow root」に注入する（document.head では隔離され効かない）。
// ─────────────────────────────────────────────────────────────────
let disneyCapHost = null; // 字幕を含む shadow host（Web Component）をキャッシュして再探索を避ける
// 字幕オーバーレイを上げてプレイヤーのスキップ等ボタンとの重なりを避ける（px・調整可）。
// 2行字幕でも下端がボタンに被らないよう、やや大きめに取る。
const DISNEY_SUB_RAISE_PX = 120;

function createDisneyOverlay() {
  clOverlay = document.createElement('div');
  Object.assign(clOverlay.style, {
    position: 'fixed', zIndex: '2147483640',
    pointerEvents: 'none', textAlign: 'center',
    display: 'none', lineHeight: '1.3', whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
  });
  document.body.appendChild(clOverlay);
  setInterval(updateDisneyOverlay, 150);
}

// Shadow DOM を貫通して hive 字幕要素を探す（host はキャッシュし、次回以降は中だけ見て軽くする）
function findDisneyCaption() {
  if (disneyCapHost && disneyCapHost.isConnected && disneyCapHost.shadowRoot) {
    const c = disneyCapHost.shadowRoot.querySelector('[class*="hive-subtitle"]');
    if (c && (c.innerText || '').trim()) return c;
  }
  const stack = [document];
  while (stack.length) {
    const root = stack.pop();
    let els;
    try { els = root.querySelectorAll('*'); } catch { continue; }
    for (const el of els) {
      if (el.shadowRoot) stack.push(el.shadowRoot);
      if (/hive-subtitle/.test(String(el.className || '')) && (el.innerText || '').trim()) {
        const host = el.getRootNode().host;
        if (host) disneyCapHost = host;
        return el;
      }
    }
  }
  return null;
}

// 元字幕を隠す style を、字幕が属する shadow root 内に1度だけ注入する
function ensureDisneyHideStyle(capEl) {
  const root = capEl.getRootNode();
  if (!root || root === document || typeof root.querySelector !== 'function') return;
  if (root.querySelector('style[data-cl-hide]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-cl-hide', '1');
  // 文字色だけでなく背景（半透明の黒帯）も消す。元字幕を完全に不可視化し、自前オーバーレイだけ見せる。
  s.textContent = '[class*="hive-subtitle"], [class*="hive-subtitle"] * { color: transparent !important; text-shadow: none !important; background: transparent !important; background-color: transparent !important; box-shadow: none !important; }';
  root.appendChild(s);
}

// フォントサイズ取得用に、字幕 wrapper 内で「直接テキストノードを持つ最深要素」を返す
function findDisneyTextEl(wrapper) {
  for (const el of wrapper.querySelectorAll('*')) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return el;
    }
  }
  return wrapper;
}

function updateDisneyOverlay() {
  if (!clOverlay) return;
  if (!clEnabled) { clOverlay.style.display = 'none'; return; } // OFF 時は隠す
  const cap = findDisneyCaption();
  if (!cap) {
    if (clOverlay.style.display !== 'none') { clOverlay.style.display = 'none'; lastOverlayText = ''; }
    return;
  }
  ensureDisneyHideStyle(cap);

  const text = (cap.innerText || '').trim();
  if (text && text !== lastOverlayText) {
    lastOverlayText = text;
    buildOverlayWords(text);   // クリック可能な .cl-word を生成（Amazon と共通）
    recordCaptionBlock(text);  // ◀▶📋 用の字幕タイムラインに記録
  }

  // オーバーレイは「実際に字幕が表示されている要素」に重ねる。
  // wrapper(cap) は大きな容器で上部基準のことがあり位置もサイズもズレる →
  // 直接テキストを持つ最深要素の座標・フォントに合わせる（＝Disney+ が出している下部の位置）。
  const textEl = findDisneyTextEl(cap);
  const rect   = textEl.getBoundingClientRect();
  const cs     = getComputedStyle(textEl);
  Object.assign(clOverlay.style, {
    display:    'block',
    left:       `${rect.left}px`,
    top:        `${rect.top - DISNEY_SUB_RAISE_PX}px`,
    width:      `${rect.width}px`,
    fontSize:   cs.fontSize,
    fontWeight: cs.fontWeight,
  });
}

// ─────────────────────────────────────────────────────────────────
// 字幕コンテナを探して監視する（Netflix / YouTube 用）
// ─────────────────────────────────────────────────────────────────
let watchedContainers = new Set();

function findAndWatchSubtitles() {
  if (IS_AMAZON || IS_DISNEY) return; // アマプラ/Disney+ はオーバーレイ方式を使うため何もしない
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
  saveTimelineNow();         // 旧エピソードのタイムラインを保存してから
  watchedContainers.clear(); // 古い DOM 要素への参照を破棄
  captionTimeline = [];      // エピソードが変わるので字幕タイムラインもリセット
  navStart = -1;             // ナビカーソルもリセット
  ttStoreKey = null;         // 次のティックで新エピソードを復元させる
  ttStoreDirty = false;
  // 少し待ってから新しい字幕コンテナをスキャン
  setTimeout(findAndWatchSubtitles, 1000);
  setTimeout(findAndWatchSubtitles, 3000); // 遅延ロードに備えて2回
}).observe(document, { subtree: true, childList: true });
