// 語彙リユニオンB案＝視聴直後リキャップ（docs/design-curated-catalog.md 改善1・
// growth-features-strategy「B案先行」決定）。
// 「直近の視聴で保存した語のうち、以前どこかで出会ったことのある語」＝実際に起きた再会を祝う。
// 予測（A案近接予告）と違いカタログ非依存：今回側はクリック保存（全作品で動く）、
// 過去側は予習履歴（history.words）と SRS の学習痕跡から検出する。
//
// データの制約（2026-07-06 実査）: my_words は1語1エントリで上書きされるため、
// 「クリック×クリック」の再会は過去メタが消えて検出できない。完全版は拡張 v1.2.2 の
// 遭遇ログ（encounters 退避）で強化する。本モジュールは既存データだけで成立する範囲。

// 視聴確認（質問カード）用: 最新の保存グループ＝「今回の視聴」候補を返す
// （docs/design-recap-endroll.md §1・視聴申告方式）。
// 再会の有無に関わらず、鮮度内の保存があれば返す。保存すら無い夜は null＝カード自体を出さない。
// words: getActiveWords() の配列（word/dramaTitle/season/episode/savedAt/ja/definition/sentence…）
// savedAt は実データで「2026/6/7」（旧拡張・スラッシュ）と「2026-07-19」（ISO）が混在する。
// 文字列比較だと '/' > '-' で旧形式が常に「最新」勝ちする（2026-07-20 実機で発覚）ため、
// 必ず Date として解釈して比較する。解釈できないものは最古扱い。
import { sameWorkTitle, isKnownMovieTitle, normTitleForMatch } from './words';

const savedAtMs = (w) => {
  const t = new Date(w.savedAt).getTime();
  return isFinite(t) ? t : 0;
};

export function computeWatchGroup({ words, withinDays = 7 }) {
  if (!Array.isArray(words) || !words.length) return null;
  const dated = words.filter((w) => w.word && w.savedAt && w.dramaTitle);
  if (!dated.length) return null;

  // 最新の保存語が属するエピソードを「今回の視聴」とみなす（同日複数話は最新話を採用）
  dated.sort((a, b) => savedAtMs(b) - savedAtMs(a));
  const newest = dated[0];
  const ageDays = (Date.now() - savedAtMs(newest)) / 86400000;
  if (!isFinite(ageDays) || ageDays > withinDays || !savedAtMs(newest)) return null; // 鮮度切れは出さない

  const group = dated.filter(
    (w) => w.dramaTitle === newest.dramaTitle && w.season === newest.season && w.episode === newest.episode
  );
  return {
    dramaTitle: newest.dramaTitle,
    season: newest.season ?? null,
    episode: newest.episode ?? null,
    savedAt: newest.savedAt,
    words: group,
  };
}

// history: loadHistory() の配列（drama.title/season/episode/words[]）
// srs: loadSrs() のマップ（wordLower → {repetitions, skipped, ...}）
// movieTitles: 正規化済みタイトルの Set（呼び出し側の myDramas 由来・任意）。
//   映画は S/E の概念が無い（履歴の 1/1 は画面 state の名残）ため、映画由来の再会は
//   S/E を表示に出さない。名寄せキャッシュ（isKnownMovieTitle）でも判定を補う。
export function computeRecap({ words, history, srs, maxItems = 5, withinDays = 7, movieTitles }) {
  const g = computeWatchGroup({ words, withinDays });
  if (!g) return null;
  const group = g.words;
  const isMovieWork = (t) =>
    isKnownMovieTitle(t) || !!(movieTitles && movieTitles.has(normTitleForMatch(t)));

  const items = [];
  for (const w of group) {
    const wl = w.word.toLowerCase();
    let past = null;
    // 過去の遭遇⓪: 遭遇ログ（v1.2.2・クリック×クリックの再会＝最も具体的な場面メタ）
    // 拡張が上書き保存時に旧メタを encounters へ退避したもの。最新の遭遇を採用。
    // ただし同一作品で場面（S/E）も区別できない遭遇（映画内の再クリック等）は
    // 「再会」にしない（fail-closed・タイトルは日英表記ゆれを跨いで同一視）。
    if (Array.isArray(w.encounters) && w.encounters.length) {
      const last = w.encounters[w.encounters.length - 1];
      if (last?.dramaTitle) {
        const sameNoScene =
          sameWorkTitle(last.dramaTitle, w.dramaTitle) &&
          (last.season == null ||
            w.season == null ||
            (last.season === w.season && last.episode === w.episode));
        if (!sameNoScene) {
          const movie = isMovieWork(last.dramaTitle);
          past = {
            via: 'click',
            title: last.dramaTitle,
            season: movie ? null : last.season ?? null,
            episode: movie ? null : last.episode ?? null,
          };
        }
      }
    }
    // 過去の遭遇①: 別エピソードの予習リストに載っていた語（場面メタつきで祝える）
    if (!past) {
      for (const h of history || []) {
        const t = h.drama?.title;
        if (!t || !Array.isArray(h.words)) continue;
        // 同一作品の除外はタイトルの日英・表記ゆれを跨いで判定する。旧実装の生文字列
        // 比較は作品側「Spider-Man: Homecoming」と保存語側「スパイダーマン: ホーム
        // カミング」を別作品と誤認し、自作品の予習リストとの照合が疑似再会になっていた
        // （2026-08-07 実機）。同一作品では「別エピソードの予習リスト」だけを再会とし、
        // S/E が比べられない語（映画は season=null）は fail-closed で対象外。
        if (
          sameWorkTitle(t, w.dramaTitle) &&
          (w.season == null ||
            h.season == null ||
            (h.season === w.season && h.episode === w.episode))
        )
          continue;
        if (h.words.some((x) => x?.word && x.word.toLowerCase() === wl)) {
          const movie = isMovieWork(t);
          past = {
            via: 'history',
            title: t,
            season: movie ? null : h.season ?? null,
            episode: movie ? null : h.episode ?? null,
          };
          break;
        }
      }
    }
    // 過去の遭遇②: SRS に学習痕跡（復習・クイズ済み）がある語。
    // 場面情報は持たないが「何回・何日ぶり」は言える（v1.2.2以前の保存は上書きで
    // 旧場面メタが失われており、この語たちは遭遇ログが貯まるまで場所を出せない）。
    if (!past) {
      const e = srs?.[wl];
      if (e && !e.skipped && (e.repetitions || 0) >= 1) {
        const last = e.lastReview ? new Date(e.lastReview).getTime() : NaN;
        const daysSince = isFinite(last) ? Math.floor((Date.now() - last) / 86400000) : null;
        past = { via: 'srs', repetitions: e.repetitions || 0, daysSince };
      }
    }
    if (past) items.push({ word: w.word, ja: w.ja || null, past, entry: w });
    if (items.length >= maxItems) break;
  }
  if (!items.length) return null;

  return {
    dramaTitle: g.dramaTitle,
    season: g.season,
    episode: g.episode,
    savedAt: g.savedAt,
    items,
  };
}
