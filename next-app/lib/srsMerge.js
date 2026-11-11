// SRS（復習の進み具合）のクラウド取り込み: 全件の読み出しと語単位の合算（2026-11-07・純関数）。
//   背景（オーナー報告 2026-11-07「スマホで復習した語が PC では未復習・リロードしても直らない」）:
//   旧実装は srs_data を `limit=5000` の1回取得で読んでいた。Supabase（PostgREST）には1回の応答の行数上限（既定 1000 行）が
//   あり、SRS がそれを超えると先頭の行しか返らない（並び順の指定が無いので、概ね古い行から）。取り込みに入らなかった語は
//   端末の古い値が残り、さらに「ローカルにしか無い語の吸い上げ」が、取り込みに入らなかった語を「クラウドに無い語」と誤認して
//   端末の古い値でクラウドを上書きしていた。my_words は 2026-09-22 に同じ理由でページ送りにしてある。
//   対策: ① word 順に SRS_PAGE 行ずつ末尾まで読む（fetchAllSrs）。② 全件取れた時だけ吸い上げる（complete）。
//        ③ 同じ日に両端末で採点した語は updated_at（送った時刻）が新しい方を採る（無ければ従来どおり端末優先）。
// 依存なし。sbFetch などは引数で受ける（node のテストから読む）。

export const SRS_PAGE = 1000;
export const SRS_MAX = 20000; // 安全上限（1語≈150B・localStorage 5MB の範囲）

// クラウドの SRS を word 順に SRS_PAGE 行ずつ全部読む。
//   fetchPage(offset, limit) → 行の配列（失敗は null）。戻り値 { rows, complete }。
//   complete=false（途中で失敗・上限到達）のとき、呼び出し側は「ローカルにしか無い語の吸い上げ」をしてはいけない。
export async function fetchAllSrs(fetchPage, { page = SRS_PAGE, max = SRS_MAX } = {}) {
  const rows = [];
  for (let offset = 0; offset < max; offset += page) {
    const batch = await fetchPage(offset, page);
    if (!Array.isArray(batch)) return { rows, complete: false };
    rows.push(...batch);
    if (batch.length < page) return { rows, complete: true };
  }
  return { rows, complete: false };
}

// クラウドの行 → 端末の形。
export function cloudRowToEntry(e) {
  const entry = {
    interval: e.interval,
    repetitions: e.repetitions,
    easeFactor: parseFloat(e.ease_factor),
    dueDate: e.due_date,
    lastReview: e.last_review,
    skipped: e.skipped,
  };
  // 出所（最初に出会った作品/話）。列が無いDBでは undefined＝付けない
  if (e.origin_title) entry.origin = { title: e.origin_title, season: e.origin_season ?? null, episode: e.origin_episode ?? null };
  // 初回の答え（first_quality）。先に入った値を優先・null は上書きしない
  if (e.first_quality != null) entry.firstQuality = e.first_quality;
  // 最後の答え（last_quality・2026-11-12）。列が無い DB・記録前の行は undefined＝付けない
  if (e.last_quality != null) entry.lastQuality = e.last_quality;
  if (e.updated_at) entry.updatedAt = e.updated_at;
  return entry;
}

const day = (v) => String(v || '');
const iso = (v) => (typeof v === 'string' ? v : '');

// クラウドの行を採るか（true＝クラウド・false＝端末）。
//   lastReview（YYYY-MM-DD）が新しい方。同じ日なら updatedAt（ISO・送った時刻）が新しい方。どちらも無ければ端末優先（従来どおり）。
export function cloudWins(local, cloudRow) {
  if (!local) return true;
  const lc = day(cloudRow.last_review);
  const ll = day(local.lastReview);
  if (lc !== ll) return lc > ll;
  const uc = iso(cloudRow.updated_at);
  const ul = iso(local.updatedAt);
  return !!uc && !!ul && uc > ul;
}

// 端末の値をクラウドへ送るか（吸い上げ）。
//   クラウドに無い語（complete のときだけ意味を持つ）／端末の方が新しい／skipped が違う／端末だけが初回の答えを持つ。
export function localWinsPush(local, cloudRow) {
  if (!cloudRow) return true;
  const lc = day(cloudRow.last_review);
  const ll = day(local.lastReview);
  if (ll !== lc) return ll > lc;
  if (!!local.skipped !== !!cloudRow.skipped) return true;
  if ('first_quality' in cloudRow && cloudRow.first_quality == null && local.firstQuality != null) return true;
  // 列はあるがクラウドに最後の答えが無い（列を足す前の行）＝端末の値で埋める。同じ日の時だけ（違う日は上の比較で決着済み）
  if ('last_quality' in cloudRow && cloudRow.last_quality == null && local.lastQuality != null) return true;
  const uc = iso(cloudRow.updated_at);
  const ul = iso(local.updatedAt);
  return !!uc && !!ul && ul > uc;
}

// 語単位の合算。戻り値 { merged, pushBack }。
//   complete=false のときは、クラウドに無い語を吸い上げない（取り込みが途中で切れただけかもしれないため）。
export function mergeSrs(local, cloudRows, { complete = true } = {}) {
  const merged = { ...(local || {}) };
  const cloudByWord = {};
  for (const e of cloudRows || []) {
    if (!e || !e.word) continue;
    cloudByWord[e.word] = e;
    const cloudEntry = cloudRowToEntry(e);
    const l = merged[e.word];
    if (cloudWins(l, e)) {
      // ローカルだけが出所・初回の答えを持っていれば引き継ぐ（クラウド行が古い＝列が空のことがある）
      if (!cloudEntry.origin && l?.origin?.title) cloudEntry.origin = l.origin;
      if (cloudEntry.firstQuality == null && l?.firstQuality != null) cloudEntry.firstQuality = l.firstQuality;
      // 最後の答えは、クラウドに無く（列が無い・列を足す前の行）同じ日の答えの時だけ端末の値を引き継ぐ。
      //   違う日（クラウドが新しい）なら端末の値は古い＝付けない（lib/againWords.js が repetitions=0 から「知らなかった」を読む）
      if (cloudEntry.lastQuality == null && l?.lastQuality != null && day(l.lastReview) === day(e.last_review)) {
        cloudEntry.lastQuality = l.lastQuality;
      }
      merged[e.word] = cloudEntry;
    } else {
      const fill = {};
      if (!l.origin?.title && cloudEntry.origin) fill.origin = cloudEntry.origin; // ローカル優先でも出所だけは補う
      if (l.firstQuality == null && cloudEntry.firstQuality != null) fill.firstQuality = cloudEntry.firstQuality;
      if (l.lastQuality == null && cloudEntry.lastQuality != null) fill.lastQuality = cloudEntry.lastQuality;
      if (Object.keys(fill).length) merged[e.word] = { ...l, ...fill };
    }
  }
  const pushBack = {};
  for (const [w, e] of Object.entries(merged)) {
    const c = cloudByWord[w];
    if (!c && !complete) continue; // 取り込みが途中で切れた＝「クラウドに無い」とは言えない
    if (localWinsPush(e, c)) pushBack[w] = e;
  }
  return { merged, pushBack };
}
