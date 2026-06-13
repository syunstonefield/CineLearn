'use strict';
// CineLearn - Amazon Prime Video 字幕取得（MAIN ワールド注入スクリプト）
//
// Prime の新プレイヤー(WebPlayerSDK)は GetPlaybackResources を素の JSON.parse で
// 処理しないことがあるため、字幕URL一覧の横取りは当てにできない。
// そこで「プレイヤーが字幕ファイル(TTML/WebVTT)を取得する fetch / XHR 通信」を
// 横取りし、その本文を直接 content.js へ渡す。表示中言語の字幕だけが取得される
// ので、言語判定なしでそのまま採用できる。Netflix の動作は別ファイルなので無関係。

(function () {
  const TAG = 'cl-amazon-tt';
  const sentKeys = new Set();

  function stableKey(url) {
    try { const u = new URL(url, location.href); return u.origin + u.pathname; }
    catch { return url; }
  }

  // 本文が字幕(TTML or WebVTT)らしいか
  function looksLikeSubtitle(text) {
    if (!text) return false;
    const head = text.slice(0, 600);
    return /<tt[\s>]/i.test(head) || /ns\/ttml/i.test(head) || /^\s*WEBVTT/.test(head)
        || /<tt:tt[\s>]/i.test(head);
  }

  // URL が字幕ファイルっぽいか（本文確認の前段フィルタ）
  function urlLooksLikeSubtitle(url) {
    return /\.(ttml2?|dfxp|xml|vtt)(\?|$)/i.test(url)
        || /subtitle|timedtext|caption|\/tt\b/i.test(url);
  }

  function sendSubtitle(url, text) {
    if (!looksLikeSubtitle(text)) return;
    const key = stableKey(url);
    if (sentKeys.has(key)) return; // 同じ字幕ファイルは一度だけ
    sentKeys.add(key);
    window.postMessage({ source: TAG, type: 'subtitle-content', url, text }, '*');
  }

  // ── fetch を横取り ──────────────────────────────────────────────
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const req = args[0];
        const url = (typeof req === 'string') ? req : (req && req.url) || '';
        if (url) {
          p.then(resp => {
            try {
              const ct = (resp.headers.get('content-type') || '').toLowerCase();
              if (urlLooksLikeSubtitle(url) || /ttml|dfxp|xml|vtt|text\/plain/.test(ct)) {
                resp.clone().text().then(t => sendSubtitle(url, t)).catch(() => {});
              }
            } catch { /* ignore */ }
          }).catch(() => {});
        }
      } catch { /* ignore */ }
      return p;
    };
  }

  // ── XMLHttpRequest を横取り ─────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._clUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      const url = this._clUrl || '';
      if (url) {
        this.addEventListener('load', function () {
          try {
            const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
            if (urlLooksLikeSubtitle(url) || /ttml|dfxp|xml|vtt|text\/plain/.test(ct)) {
              const t = this.responseType === '' || this.responseType === 'text'
                ? this.responseText
                : (typeof this.response === 'string' ? this.response : '');
              if (t) sendSubtitle(url, t);
            }
          } catch { /* ignore */ }
        });
      }
    } catch { /* ignore */ }
    return origSend.apply(this, arguments);
  };

  // ── JSON.parse も一応監視（subtitleUrls が素で取れる旧フローの保険）──
  const originalParse = JSON.parse;
  JSON.parse = function () {
    const data = originalParse.apply(this, arguments);
    try {
      const obj = data && (data.result || data);
      const list = obj && obj.subtitleUrls;
      if (Array.isArray(list)) {
        for (const s of list) {
          if (s && s.url) {
            window.postMessage({ source: TAG, type: 'subtitle-url', url: s.url,
              languageDescription: s.displayName || '', language: s.languageCode || '' }, '*');
          }
        }
      }
    } catch { /* ignore */ }
    return data;
  };
})();
