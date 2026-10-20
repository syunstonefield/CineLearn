// 手動追加で raw cache が失効していた時の字幕の取り直し（2026-10-20 /decide D・/api/example manual 経路）。
//   1) リスト生成に使ったファイルが記録されていれば、検索し直さずに同じファイルを直接 DL する
//      （検索し直すと「その時点で人気のファイル」になり、リストと別の書き起こしで例文を探してしまう）。
//      別の話数のファイル（episode_match='fallback'）の記録は使わない（G）。
//   2) OS が 404/410（ファイルが消えた）を返した時だけ記録を消して、1回だけ検索に戻る（権利者の申立て等で
//      消えたファイルを再び使わない・法務 R1）。一時障害（5xx・timeout・os_quota）は記録を消さず、検索にも
//      戻らない＝同じ取り直しで DL を重ねない（security R2）。呼び出し側の catch で例文なし。
//   3) 記録が無い・使えない（歌詞字幕・短すぎ）・fallback の記録 → 従来どおり検索（fetchEpisodeSrt）。
//   → { raw, fileId, via } | null（字幕なし）。投げる: UpstreamError（呼び出し側で reason に変える）。
// seed・node:test から import できるよう相対 import だけを使う。deps で差し替え可能。
import { fetchEpisodeSrt, fetchSrtByFileId } from './opensubtitles.js';
import { readSubtitleSource, clearSubtitleFileId } from './vocabCache.js';
import { UpstreamError } from './constants.js';

export async function refetchSubtitleForManual(
  { cacheKey, tmdbId, type, season, episode },
  {
    readSource = readSubtitleSource,
    clearSource = clearSubtitleFileId,
    byFileId = fetchSrtByFileId,
    search = fetchEpisodeSrt,
    log = console,
  } = {}
) {
  const ep = { tmdbId, type, season, episode };
  const src = await readSource(cacheKey);
  if (src && src.episodeMatch !== 'fallback') {
    try {
      const sub = await byFileId({ ...ep, fileId: src.fileId });
      if (sub?.raw) return sub;
      // 記録したファイルが使えなかった（歌詞字幕・短すぎ）→ 検索へ
    } catch (err) {
      const gone = err instanceof UpstreamError && err.reason === 'os_download' && (err.status === 404 || err.status === 410);
      if (!gone) throw err;
      log.warn?.('[CL:EXAMPLE] recorded subtitle file gone', { cacheKey, fileId: src.fileId, status: err.status });
      await clearSource(cacheKey, src.fileId);
    }
  }
  return search(ep);
}
