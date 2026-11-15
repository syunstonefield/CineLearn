// 待ち時間の目安（D・オーナー決定 2026-11-12）。共有キャッシュに当たれば数秒で終わる（最低 4.5秒のロビー）ので、
//   それより長く待っている時だけ目安を出す＝当たった人には出ない。
//   数字は本番の実測に合わせる（docs ではなくここが正・2026-11-12 見直し）:
//     ドラマ＝2分割・並列（A）で約37秒（Loki S2E2・S2E3）。字幕が短く割らない話は1回書きで約50〜60秒
//       → 最初は「30〜40秒ほど」、ETA_LONG_TV_SEC を過ぎたら「1分ほど」に言い直す（前もって字幕の長さは分からないため）。
//     映画＝約61秒（Infinity War）→「1分ほど」、長い映画で ETA_LONG_MOVIE_SEC を過ぎたら「1分半ほど」。
export const ETA_SHOW_AFTER_SEC = 5;
export const ETA_LONG_TV_SEC = 45;
export const ETA_LONG_MOVIE_SEC = 70;
// 2026-11-15 オーナー指摘: 最初から1行で出す（途中で出たり消えたりしない・SE でも1行に収まる長さ）。
//   すぐ出る時（共有キャッシュ）にも嘘にならない言い方＝「新しく作る時は…」。
export function etaText(isMovie, elapsedSec = 0) {
  if (isMovie) {
    return elapsedSec >= ETA_LONG_MOVIE_SEC ? '長い映画は、1分半ほどかかります' : '新しく作る映画は、1分ほどかかります';
  }
  return elapsedSec >= ETA_LONG_TV_SEC ? '長めの話は、1分ほどかかります' : '新しく作る時は、30〜40秒ほどかかります';
}
