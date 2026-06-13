'use strict';
// CineLearn - Netflix 字幕トラック取得（MAIN ワールド注入スクリプト）
//
// Netflix は字幕を「タイムドテキスト（WebVTT）」の別ファイルとして丸ごと
// ダウンロードしてから表示している。そのダウンロード URL は、プレイヤーが
// 取得する manifest JSON の中（result.timedtexttracks）に含まれる。
//
// このスクリプトは MAIN ワールド（Netflix 本体の JS と同じ世界）で動き、
// JSON.parse を横取りして manifest を見つけ、字幕トラックの一覧（言語名と
// WebVTT の URL）を window.postMessage で content.js（隔離ワールド）へ渡す。
// Netflix の動作には一切干渉しない（パース結果はそのまま返す）。

(function () {
  const TAG = 'cl-netflix-tt';
  const seenMovies = new Set();

  // ttDownloadables から WebVTT の URL を1つ取り出す（形式差を吸収）
  function pickVttUrl(track) {
    const dls = track.ttDownloadables;
    if (!dls || typeof dls !== 'object') return null;
    // WebVTT 形式のキーを優先（例: webvtt-lssdh-ios8）
    const keys = Object.keys(dls);
    const vttKey = keys.find(k => /webvtt|vtt/i.test(k));
    const entry = vttKey ? dls[vttKey] : null;
    if (!entry) return null;
    // urls:[{url}] と downloadUrls:{cdn:url} の両形式に対応
    if (Array.isArray(entry.urls) && entry.urls.length) {
      return entry.urls[0].url || entry.urls[0];
    }
    if (entry.downloadUrls && typeof entry.downloadUrls === 'object') {
      const vals = Object.values(entry.downloadUrls);
      if (vals.length) return vals[0];
    }
    return null;
  }

  function extractTracks(result) {
    const movieId = result.movieId;
    const tracks = [];
    for (const t of result.timedtexttracks || []) {
      if (t.isNoneTrack) continue;          // 「オフ」トラックは除外
      const url = pickVttUrl(t);
      if (!url) continue;                    // WebVTT が無いトラックは扱わない
      tracks.push({
        source:              'netflix',
        language:            t.language || '',
        languageDescription: t.languageDescription || '',
        rawTrackType:        t.rawTrackType || '',
        isForced:            !!t.isForcedNarrative,
        url,
      });
    }
    if (!tracks.length) return;
    window.postMessage({ source: TAG, type: 'tracks', movieId, tracks }, '*');
  }

  // content.js からのシーク要求を Netflix 公式プレイヤーAPIで実行する。
  //   video.currentTime の直接書き換えは MSE のバッファ管理と競合してフリーズ
  //   するため、netflix.appContext 経由の videoPlayer.seek(ms) を使う。
  function netflixSeek(timeMs) {
    try {
      const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = api.getAllPlayerSessionIds() || [];
      const id  = ids.find(x => /watch/i.test(x)) || ids[0];
      const player = api.getVideoPlayerBySessionId(id);
      if (player && typeof player.seek === 'function') {
        player.seek(timeMs);
        return;
      }
    } catch { /* API 不可 → 下のフォールバックへ */ }
    // フォールバック：API が使えない場合のみ currentTime 直接
    try {
      const v = document.querySelector('video');
      if (v) v.currentTime = timeMs / 1000;
    } catch { /* 取得失敗は無視 */ }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'cl-netflix-cmd') return;
    if (d.type === 'seek' && typeof d.timeMs === 'number') netflixSeek(d.timeMs);
  });

  // JSON.parse を横取り（結果はそのまま返し、字幕トラックだけ控える）
  const originalParse = JSON.parse;
  JSON.parse = function () {
    const data = originalParse.apply(this, arguments);
    try {
      const result = data && (data.result || data);
      if (result && result.timedtexttracks && result.movieId) {
        // 同じ movieId でも言語追加で再取得され得るので毎回送る
        extractTracks(result);
        seenMovies.add(result.movieId);
      }
    } catch { /* 解析失敗は無視（Netflix の動作は壊さない） */ }
    return data;
  };
})();
