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
  // 全角記号を半角に揃えた表記（＆→&・？→?・！→!）。TMDB 検索は半角側の表記で持っていることが多い
  // （ファルコン＆ウィンター・ソルジャー→ファルコン&ウィンター・ソルジャー 2026-10-15 実測）。
  const nfkc = t.normalize('NFKC');
  if (nfkc !== t) cands.push(nfkc);
  // 配信UIの「...？」（半角ドット3つ＋全角？）は TMDB の「…?」と一致しない（ホワット・イフ…? 2026-10-09 実測）。
  // 三点リーダと半角記号に寄せた表記も候補にする。
  const ellipsis = nfkc.replace(/\.{3}/g, '…');
  if (ellipsis !== t && !cands.includes(ellipsis)) cands.push(ellipsis);
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
  // NFKC で全角記号・英数を半角に揃える（＆→&・！→!・？→?・…→...・Ａ→A）。配信UIは全角、TMDB は半角で
  // 出ることが多く、記号を個別に足しても漏れる（＆のファルコン&ウィンター・ソルジャー 2026-10-15 実測）。
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s:：・／/｜|,.'"’”!?！？\-–—~〜…‥&＆]/g, '')
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

// ── 自分がリストを作った作品（history）からの照合 ─────────────────────────────────────
// 拡張の作品名は配信UIの表記（全角記号・副題・「を視聴」等）で、TMDB 全体からの検索は表記揺れに弱い
// （ワンダヴィジョン/ホワット・イフ/ファルコン＆… で3度同型の未解決・2026-10）。本人がリストを作った作品は
// 数件〜数十件なので、相手が少ない前提の「ゆるい一致」を安全に使える。順に、
//   ①正規化して等しい ②片方がもう片方を含む（短い方が6文字以上・長さ比0.6以上）
//   ③語（スペース/記号区切り）の重なり Jaccard ≥ 0.6（語が2つ以上ある時だけ）
// 複数当たれば ①>②>③ の強さ、同点なら新しい履歴（rows の先頭＝updated_at desc）を採る。
function titleTokens(s) {
  return new Set(
    String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .split(/[\s:：・／/｜|,.'"’”!?！？\-–—~〜…‥&＆()（）「」『』]+/)
      .filter((x) => x.length >= 2)
  );
}
export function titleMatchStrength(a, b) {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 3;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 6 && long.includes(short) && short.length / long.length >= 0.6) return 2;
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size >= 2 && tb.size >= 2) {
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    const jac = inter / (ta.size + tb.size - inter);
    if (jac >= 0.6) return 1;
  }
  return 0;
}
// rows: history の { drama:{title,tmdbId,type}, season, episode } 配列（updated_at desc）。
// wantMovie と type が食い違う行は除く（type 未記録の旧行は TV 扱い＝映画の要求には当てない）。戻り値 tmdbId | null。
export function resolveTmdbIdFromHistory(title, wantMovie, rows) {
  let best = null;
  for (const r of rows || []) {
    const d = r?.drama;
    const id = Number(d?.tmdbId);
    if (!d?.title || !Number.isFinite(id) || id <= 0) continue;
    if ((d.type === 'movie') !== !!wantMovie) continue;
    const st = titleMatchStrength(title, d.title);
    if (st > 0 && (!best || st > best.st)) best = { st, id };
  }
  return best ? best.id : null;
}
