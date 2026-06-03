'use strict';
// CineLearn Word Saver - Content Script
//
// document_start で実行されるため Netflix の JS より先にリスナーが登録される。
// クリック・長押しの検出は最上部で即時登録し、DOM 操作は DOMContentLoaded まで待つ。

const CL_WORDS_KEY_BASE = 'cl_my_words';
const ACCENT        = '#c17f3b';
const LONG_PRESS_MS = 600; // 長押し判定ミリ秒

const SUBTITLE_SELECTORS = [
  '.player-timedtext-text-container',
  '[data-uia="player-text-cue"]',
  '.atvwebplayersdk-captions-overlay',
  '.timedTextContainer',
  '[class*="SubtitleTextContainer"]',
  '[class*="subtitle-text-container"]',
  '.playback-caption-display-container',
  '[class*="caption-display"]',
  '.ms-cue-block',
  '[class*="CaptionText"]',
  '[class*="captionText"]',
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

// mousedown：長押しタイマーをスタートし、Netflix へ伝播させない
document.addEventListener('mousedown', (e) => {
  const els    = document.elementsFromPoint(e.clientX, e.clientY);
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
}, true);

// click：Netflix の play/pause をブロックし、通常クリックのポップアップを表示
// Netflix は mousedown ではなく click でplay/pauseを処理するため
// click もキャプチャする必要がある
document.addEventListener('click', (e) => {
  const els    = document.elementsFromPoint(e.clientX, e.clientY);
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
}, true);

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
  findAndWatchSubtitles();
  new MutationObserver(() => findAndWatchSubtitles())
    .observe(document.body, { childList: true, subtree: true });
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
    if (!keepPaused) { clearInterval(pauseKeepAlive); return; }
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
    // 日本語フォーマット「第N話」「シーズンN エピソードN」
    /シーズン\s*(\d+)\s*[エエ]ピソード\s*(\d+)/,
    /第\s*(\d+)\s*[シーズン].*第\s*(\d+)\s*話/,
  ];

  function extractSE(text) {
    for (const pat of sePatterns) {
      const m = text.match(pat);
      if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
    }
    return null;
  }

  // ① タイトル要素から取得
  const titleSelectors = [
    '[data-uia="video-title"]',
    '[data-uia="player-title"]',
    '.video-title',
    '[class*="PlayerTitle"]',
    '[class*="VideoTitle"]',
    '[class*="player-title"]',
    '[class*="titleTreatmentWrapper"]',
    '[data-testid="title"]',
    '.webPlayerUIContainer .title',
  ];

  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const text = el.textContent.trim();
    if (!text) continue;

    if (!season) {
      const se = extractSE(text);
      if (se) { season = se.season; episode = se.episode; }
    }

    const heading   = el.querySelector('h1,h2,h3,h4,h5');
    const candidate = heading
      ? heading.textContent.trim()
      : text.split(/[\n\r]/)[0].split(/[:\-–—\/]/)[0].trim(); // / でも分割（SUITS/スーツ対策）
    if (candidate && !showTitle) showTitle = candidate;
    if (showTitle && season !== null) break;
  }

  // ② S/E がまだ取れていない場合、DOM 全体から広く検索
  if (season === null) {
    const seSelectors = [
      '[data-uia="episode-title"]',
      '[data-uia="player-episode-title"]',
      '[class*="EpisodeTitle"]',
      '[class*="episode-title"]',
      '[class*="SubTitle"]',
      '[class*="subtitle"]',
    ];
    for (const sel of seSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const se = extractSE(el.textContent);
      if (se) { season = se.season; episode = se.episode; break; }
    }
  }

  // ③ document.title から S/E を試みる（例: "Suits S1E1 | Netflix"）
  if (season === null) {
    const se = extractSE(document.title);
    if (se) { season = se.season; episode = se.episode; }
  }

  // ④ タイトルが未取得の場合 document.title から抽出（/ 前の部分をシリーズ名とする）
  if (!showTitle) {
    showTitle = document.title
      .replace(/\s*[|\-–—]\s*(Netflix|Prime Video|Amazon|Disney\+|Apple TV\+?|Hulu|U-NEXT)\s*$/i, '')
      .split(/\s*[:\-–—\/]\s*/)[0]  // / でも分割
      .trim();
  }

  return { dramaTitle: showTitle || document.title.split('|')[0].trim(), season, episode };
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
    const ctx   = getEpisodeContext();
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
  if (el.querySelector?.('.cl-word')) return;

  const sentence = el.textContent.trim();
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
}

// ─────────────────────────────────────────────────────────────────
// 字幕コンテナを探して監視する
// ─────────────────────────────────────────────────────────────────
let watchedContainers = new Set();

function findAndWatchSubtitles() {
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
