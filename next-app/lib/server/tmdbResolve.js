// タイトル文字列 → TMDB ID の解決（拡張は作品名しか持たないためサーバで解決する）。
// 2026-10-02: app/api/example/route.js から切り出し。/api/vocab-marks（字幕マーカー用の語リスト）と共用。
import { tmdbSearch } from './tmdb';

// タイトル文字列 → TMDB ID（拡張は ID を持たないためここで解決）。失敗・曖昧は null。
// 配信サービスの表示タイトルは「スター・ウォーズエピソード3／シスの復讐」のように区切り無しで詰まっていたり
// サブタイトルが付いたりして、TMDB のあいまい検索が空振りする（2026-07-03 実測で確定）。
// そこで複数の候補クエリを順に試し、最初に当たった ID を採用する。
export function titleQueryCandidates(title) {
  const t = (title || '').trim();
  if (!t) return [];
  const cands = [t];
  // 区切り（全角/半角スラッシュ・コロン・波ダッシュ・パイプ）を空白へ正規化
  const spaced = t.replace(/[／/:：|｜〜~–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (spaced && spaced !== t) cands.push(spaced);
  // 区切りで分割した各セグメント（長い順）＝サブタイトル単独が最も当たりやすい
  const segs = t.split(/[／/:：|｜]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  segs.sort((a, b) => b.length - a.length).forEach((s) => cands.push(s));
  return [...new Set(cands)];
}

// 照合用のタイトル正規化（記号・空白・大小の揺れを吸収）。
export function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s:：・／/｜|,.'"’”!?！？\-–—~〜]/g, '')
    .trim();
}

// 候補から「クエリと同じ作品」を選ぶ。results[0] 直採りは邦題で別作品を掴む。
//   ①原題・邦題のどれかが正規化一致するものを最優先 ②同点なら人気度で決める
// 一致が1つも無ければ null＝**あえて解決しない**（誤った作品の字幕を引くより、例文なしの方が安全）。
export function pickTmdbCandidate(results, query, wantMovie) {
  const q = normTitle(query);
  const cands = (results || []).filter((r) => {
    if (!r?.id) return false;
    const mt = r.media_type;
    if (mt && mt !== (wantMovie ? 'movie' : 'tv')) return false;
    return true;
  });
  const named = (r) => [r.title, r.original_title, r.name, r.original_name].filter(Boolean);
  const exact = cands.filter((r) => named(r).some((n) => normTitle(n) === q));
  if (!exact.length) return null;
  return exact.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0].id;
}

// タイトル文字列 → TMDB ID。
// ★2026-08-08: 映画で search_movie の results[0] を無検証で採用していたため、邦題のクエリが別作品に解決されていた
//   （「アイアンマン」→ "Iron Man: Rise of Technovore"）。search_multi（ja-JP）に寄せ、正規化一致を必須にした。
export async function resolveTmdbId(title, isMovie) {
  for (const query of titleQueryCandidates(title)) {
    try {
      const results = await tmdbSearch({ action: 'search_multi', query });
      const id = pickTmdbCandidate(results, query, isMovie);
      if (id) return id;
    } catch {
      /* この候補は失敗＝次の候補へ */
    }
  }
  // 保険: 種別特化の検索でも一致を探す（search_multi が取りこぼす綴りの作品向け）。
  const action = isMovie ? 'search_movie' : 'search';
  for (const query of titleQueryCandidates(title)) {
    try {
      const results = await tmdbSearch({ action, query });
      const id = pickTmdbCandidate(results, query, isMovie);
      if (id) return id;
    } catch {
      /* この候補は失敗＝次の候補へ */
    }
  }
  return null;
}
