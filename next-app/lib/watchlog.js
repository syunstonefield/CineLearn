// 視聴記録＝視聴完了の自己申告（docs/design-recap-endroll.md §1・2026-07-19改訂）。
// ホームの質問カード「観終わりましたか？」の「観終わった」タップで epKey＋日時を記録する。
// 祝い（再会・さっと復習・発券）は必ずこの申告の後＝誤爆が構造的に起きない、が設計の根拠。
// MVPは端末ローカル。クラウド同期は当日券(P2)でチケット同期に相乗りする予定。

const MAX_ENTRIES = 200; // 追記ログの上限（古いものからFIFO）。判定は直近の視聴にしか使わない。

export function watchLogKey(profileId) {
  return profileId ? `cl_watch_log_${profileId}` : 'cl_watch_log';
}

// 半券と同じ同一話キー（lib/tickets.js の epKey と同じ定義）。
// ★tmdbId を最優先★（邦題/英題で title が割れても同一話が二重申告にならない）。
export function watchEpKey({ tmdbId, title, season, episode }) {
  return `${tmdbId ?? title}|${season}|${episode}`;
}

export function loadWatchLog(profileId) {
  try {
    const raw = localStorage.getItem(watchLogKey(profileId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 同一話の照合はepKey文字列でなくフィールドで行う（tmdbId一致 or タイトル一致）。
// 申告時にtmdbIdが引けず後から引けるようになる（棚に追加/クラウドpull）とepKeyが
// 「title|S|E」→「tmdbId|S|E」へ移行するが、その場合も申告済みが外れない。
function sameEpisode(e, meta) {
  const title = meta.dramaTitle || meta.title || '';
  return (
    e.season === (meta.season ?? null) &&
    e.episode === (meta.episode ?? null) &&
    ((meta.tmdbId != null && e.tmdbId === meta.tmdbId) || (!!title && e.title === title))
  );
}

// meta: {tmdbId, dramaTitle|title, season, episode}
export function isWatchConfirmed(profileId, meta) {
  return loadWatchLog(profileId).some((e) => sameEpisode(e, meta));
}

// 「観終わった」申告。meta は Dashboard の watchMeta（computeWatchGroup + tmdbId/epKey 補完済み）。
export function confirmWatch(profileId, meta) {
  const entry = {
    epKey: meta.epKey,
    tmdbId: meta.tmdbId ?? null,
    title: meta.dramaTitle || meta.title || '',
    season: meta.season ?? null,
    episode: meta.episode ?? null,
    wordCount: (meta.words || []).length,
    confirmedAt: Date.now(),
  };
  const arr = loadWatchLog(profileId).filter((e) => !sameEpisode(e, entry));
  arr.push(entry);
  while (arr.length > MAX_ENTRIES) arr.shift();
  try {
    localStorage.setItem(watchLogKey(profileId), JSON.stringify(arr));
  } catch {
    /* プライベートモード等は保存をあきらめる（そのセッション中は state で祝いが出る） */
  }
  return entry;
}

// 「まだ途中」＝そのセッション中だけ質問を引っ込める（次にアプリを開いたらまた一度だけ聞く）。
// 罪悪感UI禁止: 押しても何も失わない・カウントもしない。
export function snoozeWatchPrompt(epKey) {
  try {
    sessionStorage.setItem(`cl_watch_snooze_${epKey}`, '1');
  } catch {
    /* ignore */
  }
}

export function isWatchSnoozed(epKey) {
  try {
    return sessionStorage.getItem(`cl_watch_snooze_${epKey}`) === '1';
  } catch {
    return false;
  }
}
