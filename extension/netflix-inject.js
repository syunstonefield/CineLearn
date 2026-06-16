'use strict';
// CineLearn - Netflix シーク専用（MAIN ワールド注入スクリプト）
//
// ◀▶ で再生位置を動かすためだけのスクリプト。字幕データの取得（傍受）は行わない。
// Netflix は video.currentTime を直接書き換えると MSE のバッファ管理と競合して
// フリーズするため、content.js からの要求を受けて公式プレイヤーAPI(seek)を呼ぶ。
// （字幕は content.js が画面のDOMから読む。このファイルは字幕に触れない。）

(function () {
  // content.js からのシーク要求を Netflix 公式プレイヤーAPIで実行する。
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

  // ── 視聴中の作品メタ（タイトル/シーズン/話数）を content.js へ渡す ──────────
  //   再生中の Netflix は document.title が「Netflix」のままで、タイトルDOMも
  //   コントロール非表示時には消える。例文補完（#3）には「何を観ているか」の
  //   正確な特定が要るため、プレイヤーの公式メタ（字幕ストリームではない＝識別情報）
  //   を読み取って渡す。取得できた時だけ・変化時のみ postMessage する。
  // Netflix の2部構成話（前編/後編 等）を1話に畳むためのベースタイトル抽出。
  //   末尾の「前編/後編/前篇/後篇/パートN/Part N/PtN」（任意の括弧付き）を取り除く。
  //   素の数字は誤畳み込みを避けるため取り除かない。
  function stripPartMarker(t) {
    return String(t || '')
      .replace(/[\s　]*[（(]?\s*(前編|後編|前篇|後篇|パート\s*[0-9０-９]+|part\s*\d+|pt\.?\s*\d+)\s*[)）]?\s*$/i, '')
      .trim();
  }

  function getMeta() {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = vp.getAllPlayerSessionIds() || [];
      const id  = ids.find(x => /watch/i.test(x)) || ids[0];
      const videoId = vp.getVideoPlayerBySessionId(id).getMovieId();

      // 種別（movie/tv）は falcorCache の summary が確実
      let type = 'tv';
      try {
        const t = window.netflix.falcorCache?.videos?.[videoId]?.summary?.value?.type;
        if (t) type = t === 'movie' ? 'movie' : 'tv';
      } catch { /* falcor 不可 */ }

      const state = window.netflix.appContext.state.playerApp.getState();
      const vm = state.videoPlayer.videoMetadata[videoId];
      const video = vm?._metadataObject?.video;

      // 作品（シリーズ）タイトル（バージョン差を吸収して複数候補）
      const cands = [
        video?.title,
        vm?._metadataObject?.title,
        vm?._video?._metadata?.title,
        vm?._video?._video?.title,
      ];
      const title = (cands.find(t => typeof t === 'string' && t.trim()) || '').trim();
      if (!title) return null;

      if (type === 'movie') return { title, type, season: null, episode: null };

      // ── TV: Netflix 話数 → TMDB/OpenSubtitles 話数へ補正 ──────────────
      //   Netflix は2部構成（前編/後編 等）を別話に分けるが、TMDB は1話に統合する
      //   （例: Suits S1 は Netflix 13話 / TMDB 12話 = パイロットが前後編に分割）。
      //   現在シーズンの一覧で「同一ベースタイトルの連続話」を1話に畳んで番号を振り直す。
      //   言語非依存・分割が先頭でなくても効く。畳めない時は falcor の素の番号にフォールバック。
      let season = null, episode = null;
      try {
        const cur = video.currentEpisode;
        const seasons = video.seasons || [];
        const cs = seasons.find(s => (s.episodes || []).some(e => (e.episodeId || e.id) === cur));
        if (cs && Array.isArray(cs.episodes)) {
          season = cs.seq ?? null;
          const eps = [...cs.episodes].sort((a, b) => (a.seq || 0) - (b.seq || 0));
          let n = 0, prevBase = null;
          for (const ep of eps) {
            const base = stripPartMarker(ep.title);
            if (!(base && base === prevBase)) n++; // 新しい話グループ＝TMDB話数を1つ進める
            prevBase = base;
            if ((ep.episodeId || ep.id) === cur) { episode = n; break; }
          }
        }
      } catch { /* 補正失敗 → 下のフォールバック */ }

      // 補正できなければ falcor の素の番号（Netflix番号・ズレうる）にフォールバック
      if (season == null || episode == null) {
        try {
          const sum = window.netflix.falcorCache?.videos?.[videoId]?.summary?.value;
          if (sum) { season = season ?? sum.season ?? null; episode = episode ?? sum.episode ?? null; }
        } catch { /* falcor 不可 */ }
      }

      return { title, type, season, episode };
    } catch {
      return null; // メタ不可 → content.js 側の DOM フォールバックに任せる
    }
  }

  let _lastMetaJson = '';
  setInterval(() => {
    const m = getMeta();
    if (!m) return;
    const j = JSON.stringify(m);
    if (j === _lastMetaJson) return; // 変化時のみ送る
    _lastMetaJson = j;
    window.postMessage({ source: 'cl-netflix-meta', meta: m }, '*');
  }, 3000);
})();
