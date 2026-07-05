// 既存アプリ（js/app.js）からの移植。
// localStorage のキー・データ構造は既存実装と完全に同一に保つこと。

import { pushHistoryEntry, deleteHistoryRow, pushSrsWords, pushProfiles } from './supabase';
import { PROFILES_AT_KEY } from './profileMerge';

export const HISTORY_KEY = 'cl_history';
export const SRS_KEY = 'cl_srs';
export const PROFILES_KEY = 'cl_profiles';
export const ACTIVITY_KEY = 'cl_activity_dates';
export const DAILY_REVIEW_CAP = 20; // 1日の復習はこの数までに抑える（負担を減らす）

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

// localStorage への安全な書き込み。QuotaExceeded（字幕キャッシュ等で容量超過）でも
// 例外を投げず黙って失敗させ、保存処理がアプリのクラッシュにつながらないようにする。
// 成功可否を真偽で返す。
function safeSet(key, value) {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false; // QuotaExceeded など：永続化は諦めるがアプリは止めない
  }
}

// ── 日付形式の統一 ──────────────────────────────────────────
// 保存は常に ISO（YYYY-MM-DD）、表示時だけ日本語形式に変換する。
// 過去データには ja-JP 形式（2026/6/11）が混在するため、両形式を扱う。

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function toIsoDate(s) {
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = String(s).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // ISO日時文字列（例: 2026-06-16T06:05:02.573Z、クラウド/シード由来）は
  // 日付部分(YYYY-MM-DD)だけ取り出す。これが無いと formatDateJa が生文字列を返す。
  const iso = String(s).match(/^(\d{4}-\d{2}-\d{2})T/);
  if (iso) return iso[1];
  return s;
}

export function formatDateJa(s) {
  const iso = toIsoDate(s);
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || '';
  return `${m[1]}/${parseInt(m[2])}/${parseInt(m[3])}`;
}

// ── 読み込み ────────────────────────────────────────────────

export function loadHistory() {
  const h = readJson(HISTORY_KEY, []);
  h.forEach((e) => {
    if (e.date) e.date = toIsoDate(e.date);
    if (e.quizDate) e.quizDate = toIsoDate(e.quizDate);
  });
  return h;
}

export function loadSrs() {
  return readJson(SRS_KEY, {});
}

export function loadProfiles() {
  return readJson(PROFILES_KEY, []);
}

export function saveProfiles(profiles) {
  const now = new Date().toISOString();
  safeSet(PROFILES_KEY, JSON.stringify(profiles));
  // ローカルの更新時刻を記録し、クラウドにも同じ時刻で upsert する。
  // push が失敗しても、次回 pull がこの時刻を見るので「古いクラウドが新しいローカルを
  // 丸ごと潰す」事故（設定・マイリスト消失）が起きない。
  safeSet(PROFILES_AT_KEY, now);
  pushProfiles(profiles, now); // クラウドへ upsert（未ログイン時は no-op・fire-and-forget）
}

export function loadActivityDates() {
  return readJson(ACTIVITY_KEY, []);
}

// ── SRS（2段階の習得システム） ──────────────────────────────
//   レベル1「覚えた」(isLearned)  : 2回以上成功（早期の達成感）
//   レベル2「マスター」(isMastered): 3回以上 + 間隔21日 + 易しさ2.0（長期定着）

export function isMastered(e) {
  return !!e && !e.skipped && e.repetitions >= 3 && e.interval >= 21 && e.easeFactor >= 2.0;
}

export function isLearned(e) {
  return !!e && !e.skipped && e.repetitions >= 2;
}

// よく忘れる単語（⭐優先表示用）。easeFactor は既定2.5・失敗(quality<3)で初めて2.0未満まで下がる
// ＝「一度でも思い出せなかった＝苦手」の代理指標。lapse専用カウンタは持っていないためこれで判定。
export function isStruggling(e) {
  return !!e && !e.skipped && typeof e.easeFactor === 'number' && e.easeFactor < 2.0;
}

export function isDue(e) {
  if (!e || e.skipped || isMastered(e)) return false;
  return !e.dueDate || e.dueDate <= todayStr();
}

// ── ダッシュボード集計 ──────────────────────────────────────

// 連続学習日数（今日 or 昨日を起点に遡る。今日未実施でも昨日まで連続なら維持）
export function getStreak(activityDates = loadActivityDates()) {
  const set = new Set(activityDates);
  if (!set.size) return 0;
  const iso = (x) => x.toISOString().slice(0, 10);
  let d = new Date();
  if (!set.has(iso(d))) {
    d.setDate(d.getDate() - 1);
    if (!set.has(iso(d))) return 0;
  }
  let n = 0;
  while (set.has(iso(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// 全履歴の単語を重複排除して集約
export function getAllVocabWords(history = loadHistory()) {
  const map = new Map();
  history.forEach((h) =>
    (h.words || []).forEach((w) => {
      const k = w.word?.toLowerCase();
      // 例文（字幕の逐語引用）の出所明示（著作権法48条）用に、語が属する作品/話を付帯。
      // _src は集約コピー上のメタで、保存データ自体は変更しない。
      if (k && !map.has(k))
        map.set(k, {
          ...w,
          _src: { title: h.drama?.title, season: h.season, episode: h.episode, type: h.drama?.type },
        });
    })
  );
  return [...map.values()];
}

// 例文（字幕の逐語引用）の出所表示文字列。著作権法48条の出所明示に用いる。
// plus 語の例文は Claude 生成（字幕外）なので空文字＝出典を出さない。
export function subtitleCredit(w) {
  if (!w || w.source === 'plus') return '';
  const s = w._src || {};
  if (!s.title) return '';
  const ep = s.type === 'movie' ? '' : ` S${s.season}E${s.episode}`;
  return `📺 ${s.title}${ep}（字幕：OpenSubtitles）`;
}

// 今日復習すべき単語（未学習 or 期日到来）。期日到来を未学習より優先して並べる。
export function getDueReviewWords(history = loadHistory(), srs = loadSrs()) {
  const eligible = getAllVocabWords(history).filter((w) => {
    const e = srs[w.word.toLowerCase()];
    return !e || isDue(e);
  });
  eligible.sort((a, b) => {
    const pa = srs[a.word.toLowerCase()] ? 0 : 1;
    const pb = srs[b.word.toLowerCase()] ? 0 : 1;
    return pa - pb;
  });
  return eligible;
}

// 今週の進捗（今日含む直近7日に復習した単語数・累計の習得語数）
export function getWeekStats(srs = loadSrs()) {
  const wa = new Date();
  wa.setDate(wa.getDate() - 6);
  const wk = wa.toISOString().slice(0, 10);
  let reviewedThisWeek = 0;
  let mastered = 0;
  Object.values(srs).forEach((e) => {
    if (e?.lastReview && e.lastReview >= wk) reviewedThisWeek++;
    if (isMastered(e)) mastered++;
  });
  return { reviewedThisWeek, mastered };
}

// ── マイ単語帳（プロフィール別キー） ────────────────────────

export function myWordsKey(profileId) {
  return profileId ? `cl_my_words_${profileId}` : 'cl_my_words';
}

export function deletedWordsKey(profileId) {
  return profileId ? `cl_deleted_words_${profileId}` : 'cl_deleted_words';
}

// ヘッダーバッジ用の件数（削除済みを除く）。
// 既存 getActiveWords と同じ判定で、削除リストにあっても再保存された単語が
// あれば全件を有効扱いにする（こちらは読み取りのみで書き戻しはしない）。
export function getActiveWordCount(profileId) {
  const all = readJson(myWordsKey(profileId), []);
  const deleted = readJson(deletedWordsKey(profileId), []);
  if (!deleted.length) return all.length;
  const resaved = all.some((w) => deleted.includes(w.word));
  if (resaved) return all.length;
  return all.filter((w) => !deleted.includes(w.word)).length;
}

// ── ドラマライブラリ ────────────────────────────────────────

// プラットフォームに対応する背景色
export function platformColor(platform) {
  const map = {
    Netflix: '#E50914',
    'Amazon Prime': '#00A8E0',
    'Disney+': '#113CCF',
    'Apple TV+': '#555',
    Hulu: '#1CE783',
    'U-NEXT': '#FF0032',
  };
  return map[platform] || '#c17f3b';
}

// 履歴 + myDramas からライブラリカード用のエントリ一覧を作る
// （既存 renderDramaLibrary のグループ化部分と同じロジック）
export function buildLibraryEntries(history, myDramas) {
  // myDramas はタイトル→詳細（tmdbId / posterPath / totalEpisodes 等）の参照に使う。
  const byTitle = new Map((myDramas || []).map((d) => [d.title, d]));
  const map = new Map();
  history.forEach((h) => {
    const key = h.drama?.title;
    if (!key) return; // drama 欠落エントリ（過去の同期巻き戻りの残骸）は走査対象外
    if (!map.has(key)) {
      // 履歴の drama は {title,genre,platform} のみ。myDramas 側の
      // tmdbId/posterPath/totalEpisodes を引き継ぎ、ポスター取得や進捗バーを出せるようにする。
      const extra = byTitle.get(key);
      const drama = extra ? { ...extra, ...h.drama } : h.drama;
      // 履歴側の drama が tmdbId を null で持っていても myDramas 側の値を潰さない（保険）。
      if (drama.tmdbId == null && extra?.tmdbId != null) drama.tmdbId = extra.tmdbId;
      map.set(key, { drama, episodes: [], bestScore: null, lastDate: h.date });
    }
    const d = map.get(key);
    d.episodes.push({ season: h.season, episode: h.episode, score: h.quizScore });
    if (h.quizScore !== null && (d.bestScore === null || h.quizScore > d.bestScore)) {
      d.bestScore = h.quizScore;
    }
    if (h.date > d.lastDate) d.lastDate = h.date;
  });

  (myDramas || []).forEach((d) => {
    if (!map.has(d.title)) {
      map.set(d.title, { drama: d, episodes: [], bestScore: null, lastDate: null });
    }
  });

  return [...map.values()];
}

// ドラマをライブラリから削除する（履歴も含めて）。
// ※ Supabase 側の削除は既存アプリが担当（試作はローカルのみ）
// ※ マイリストの「棚から外す」はアーカイブ（archiveDrama）に移行したため、
//    現在この破壊的削除は UI から呼ばれない（履歴を残す方針）。互換のため残置。
export function deleteDramaLocal(title) {
  const history = loadHistory();
  const newHistory = history.filter((h) => h.drama?.title !== title);
  safeSet(HISTORY_KEY, JSON.stringify(newHistory));
}

// ── アーカイブ（棚から外す） ────────────────────────────────
// 「棚から外す」は学習履歴・単語・スコアを一切消さず、マイリストの表示からだけ隠す。
// タイトル名の配列を端末ローカルに保持する（単一ユーザー運用＝グローバルキー）。
export const ARCHIVED_KEY = 'cl_archived';

export function loadArchived() {
  return readJson(ARCHIVED_KEY, []);
}

export function archiveDrama(title) {
  const arr = loadArchived();
  if (!arr.includes(title)) {
    arr.push(title);
    safeSet(ARCHIVED_KEY, JSON.stringify(arr));
  }
}

export function unarchiveDrama(title) {
  const arr = loadArchived();
  if (arr.includes(title)) {
    safeSet(ARCHIVED_KEY, JSON.stringify(arr.filter((t) => t !== title)));
  }
}

// 作品（タイトル）ごとの保存単語数。履歴の各エピソードの words を合算する。
// カード上の「🔤 N語」表示用（エピソード間の重複は素朴に加算＝学習量の目安）。
export function wordCountByTitle(history = loadHistory()) {
  const m = new Map();
  history.forEach((h) => {
    const t = h.drama?.title;
    if (!t) return;
    m.set(t, (m.get(t) || 0) + (h.words?.length || 0));
  });
  return m;
}

// 作品（タイトル）ごとの学習状況を、全エピソードの単語を重複排除して集計する。
// 戻り値: Map<title, { total, learned, mastered }>。
//   total   = その作品で保存したユニーク単語数（全エピソード合算）
//   learned = 「覚えた」(isLearned) 以上の語数（マスターも含む）
//   mastered= 「マスター」(isMastered) の語数
export function learningStatsByTitle(history = loadHistory(), srs = loadSrs()) {
  const acc = new Map(); // title → { total, learned, mastered, seen:Set }
  history.forEach((h) => {
    const t = h.drama?.title;
    if (!t) return;
    let s = acc.get(t);
    if (!s) {
      s = { total: 0, learned: 0, mastered: 0, seen: new Set() };
      acc.set(t, s);
    }
    (h.words || []).forEach((w) => {
      const k = w.word?.toLowerCase();
      if (!k || s.seen.has(k)) return; // 同じ語は作品内で1回だけ数える
      s.seen.add(k);
      s.total++;
      const e = srs[k];
      if (isMastered(e)) s.mastered++;
      if (isLearned(e)) s.learned++;
    });
  });
  const out = new Map();
  acc.forEach((v, k) => out.set(k, { total: v.total, learned: v.learned, mastered: v.mastered }));
  return out;
}

// プロフィールの settings に部分的な変更をマージして保存する
export function patchProfileSettings(profileId, patch) {
  if (!profileId) return;
  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx < 0) return;
  profiles[idx].settings = { ...(profiles[idx].settings || {}), ...patch };
  saveProfiles(profiles);
}

// ── SRS ステータス判定（単語リスト描画用）──────────────────
export function saveSrs(d) {
  safeSet(SRS_KEY, JSON.stringify(d));
  // クラウド同期は既存アプリが担当（試作はローカルのみ）
}

// ステータス: new / skipped / mastered / learned / due / reviewed_today / scheduled
export function getWordStatus(word, srs = loadSrs()) {
  const e = srs[word.toLowerCase()];
  if (!e) return 'new';
  if (e.skipped) return 'skipped';
  if (isMastered(e)) return 'mastered';
  if (isLearned(e)) return 'learned';
  if (isDue(e)) return 'due';
  if (e.lastReview === todayStr()) return 'reviewed_today';
  return 'scheduled';
}

// ステータスバッジの絵文字＋ラベル＋CSSクラス（既存 statusBadgeHTML 準拠）
export function statusBadge(status) {
  switch (status) {
    case 'mastered':
      return { cls: 'badge-mastered', text: '⭐ マスター' };
    case 'learned':
      return { cls: 'badge-learned', text: '✅ 覚えた' };
    case 'skipped':
      return null; // スキップは vocab-skipped クラスで表現
    case 'new':
      return { cls: 'badge-new', text: '🌱 未学習' };
    default:
      return { cls: 'badge-learning', text: '🔄 学習中' };
  }
}

// 次回復習日を読みやすい文字列で返す
export function nextReviewLabel(word, srs = loadSrs()) {
  const e = srs[word.toLowerCase()];
  if (!e || !e.dueDate || e.skipped || isMastered(e)) return null;
  const diff = Math.round(
    (new Date(e.dueDate) - new Date(todayStr())) / (1000 * 60 * 60 * 24)
  );
  if (diff <= 0) return null;
  if (diff === 1) return '明日';
  if (diff < 7) return `${diff}日後`;
  const d = new Date(e.dueDate);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function skipWord(word) {
  const all = loadSrs();
  const k = word.toLowerCase();
  all[k] = { interval: 1, repetitions: 0, easeFactor: 2.5, ...(all[k] || {}), skipped: true };
  saveSrs(all);
  pushSrsWords({ [k]: all[k] }); // クラウドへ（未ログイン時は no-op・fire-and-forget）
}
export function unskipWord(word) {
  const all = loadSrs();
  const k = word.toLowerCase();
  if (all[k]) {
    all[k].skipped = false;
    saveSrs(all);
    pushSrsWords({ [k]: all[k] });
  }
}

// エピソード単位の集計（進捗バー・復習対象数）
export function episodeStats(words, srs = loadSrs()) {
  let mastered = 0;
  let learned = 0;
  let due = 0;
  let skipped = 0;
  let reviewedToday = 0;
  (words || []).forEach((w) => {
    const e = srs[w.word.toLowerCase()];
    if (isMastered(e)) mastered++;
    if (isLearned(e)) learned++;
    if (e?.skipped) skipped++;
    if (!e || isDue(e)) due++;
    else if (e.lastReview === todayStr()) reviewedToday++;
  });
  return { total: (words || []).length, mastered, learned, due, skipped, reviewedToday };
}

// ── 活動日（ストリーク用）──────────────────────────────────
export function markActivityToday() {
  const arr = loadActivityDates();
  const d = todayStr();
  if (!arr.includes(d)) {
    arr.push(d);
    safeSet(ACTIVITY_KEY, JSON.stringify(arr));
  }
}

// ── 復習ログ ────────────────────────────────────────────────
const REVIEW_LOG_KEY = 'cl_review_log';
export function loadReviewLog() {
  return readJson(REVIEW_LOG_KEY, []);
}
export function todaySessionCount(historyId) {
  const today = todayStr();
  return loadReviewLog().filter((s) => s.date === today && s.historyId === historyId).length;
}
export function getTodaySessions(historyId) {
  const today = todayStr();
  return loadReviewLog().filter((s) => s.date === today && s.historyId === historyId);
}

// 復習セッションを記録（ストリークも更新）。戻り値: 今日の通算セッション番号
export function recordReviewSession(historyId, easy, hard, fail) {
  const log = loadReviewLog();
  const today = todayStr();
  const todayCount = log.filter((s) => s.date === today && s.historyId === historyId).length;
  log.push({ date: today, historyId, sessionNum: todayCount + 1, easy, hard, fail, total: easy + hard + fail });
  safeSet(REVIEW_LOG_KEY, JSON.stringify(log));
  markActivityToday();
  return todayCount + 1;
}

// SM-2アルゴリズム（同日復習ガードつき）。quality 0=失敗 / 3=うろ覚え / 5=完璧
export function reviewWord(word, quality) {
  const all = loadSrs();
  const k = word.toLowerCase();
  let e = all[k] || { interval: 1, repetitions: 0, easeFactor: 2.5, skipped: false };

  // 同日2回目以降の成功は「練習」扱い（スケジュールを進めない）。失敗は常に反映。
  if (e.lastReview === todayStr() && quality >= 3) {
    e.lastQuality = quality;
    e.reviewCount = (e.reviewCount || 0) + 1;
    all[k] = e;
    saveSrs(all);
    pushSrsWords({ [k]: e }); // クラウドへ（未ログイン時は no-op・fire-and-forget）
    return;
  }

  if (quality < 3) {
    e.repetitions = 0;
    e.interval = 1;
  } else {
    if (e.repetitions === 0) e.interval = 1;
    else if (e.repetitions === 1) e.interval = 6;
    else e.interval = Math.round(e.interval * e.easeFactor);
    e.easeFactor = Math.max(1.3, e.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    e.repetitions++;
  }
  const d = new Date();
  d.setDate(d.getDate() + e.interval);
  e.dueDate = d.toISOString().slice(0, 10);
  e.lastReview = todayStr();
  e.lastQuality = quality;
  e.reviewCount = (e.reviewCount || 0) + 1;
  all[k] = e;
  saveSrs(all);
  pushSrsWords({ [k]: e }); // クラウドへ（未ログイン時は no-op・fire-and-forget）
}

// ── 履歴の保存・更新（saveToHistory 相当）──────────────────
// ctx = { drama, season, episode, userLevel, targetLevel, words }
// 戻り値: currentHistoryId（保存したエントリのID）
export function saveHistoryEntry(ctx) {
  const { drama, season, episode, userLevel, targetLevel, words } = ctx;
  if (!drama || !words?.length) return null;

  const history = loadHistory();
  const newId = Date.now().toString();
  const entry = {
    id: newId,
    date: todayStr(),
    drama: { title: drama.title, genre: drama.genre, platform: drama.platform },
    season,
    episode,
    level: userLevel,
    targetLevel: targetLevel || null,
    words,
    quiz: [],
    quizScore: null,
    quizDate: null,
  };

  const existingIdx = history.findIndex(
    (h) => h.drama?.title === entry.drama?.title && h.season === entry.season && h.episode === entry.episode
  );

  let resultId;
  let pushed;
  if (existingIdx >= 0) {
    const kept = history[existingIdx];
    history[existingIdx] = { ...entry, id: kept.id, quizScore: kept.quizScore, quizDate: kept.quizDate };
    resultId = kept.id;
    pushed = history[existingIdx];
  } else {
    history.unshift(entry);
    resultId = newId;
    pushed = entry;
  }

  const saved = history.slice(0, 50);
  safeSet(HISTORY_KEY, JSON.stringify(saved));
  markActivityToday();
  pushHistoryEntry(pushed); // クラウド history へ反映（ログイン時・fire-and-forget）
  return resultId;
}

export function updateHistoryWords(id, words) {
  if (!id) return;
  const history = loadHistory();
  const idx = history.findIndex((h) => h.id === id);
  if (idx >= 0) {
    history[idx].words = words;
    safeSet(HISTORY_KEY, JSON.stringify(history));
    pushHistoryEntry(history[idx]); // 完全なエントリでクラウドへ upsert
  }
}

export function updateHistoryQuizData(id, quiz) {
  if (!id) return;
  const history = loadHistory();
  const idx = history.findIndex((h) => h.id === id);
  if (idx >= 0) {
    history[idx].quiz = quiz;
    safeSet(HISTORY_KEY, JSON.stringify(history));
    pushHistoryEntry(history[idx]);
  }
}

// テスト終了後にスコアを履歴へ保存
export function updateHistoryScore(id, pct) {
  if (!id) return;
  const history = loadHistory();
  const idx = history.findIndex((h) => h.id === id);
  if (idx >= 0) {
    history[idx].quizScore = pct;
    history[idx].quizDate = todayStr();
    safeSet(HISTORY_KEY, JSON.stringify(history));
    pushHistoryEntry(history[idx]);
  }
}

// 単語リスト削除（vocabDeleteBtn 相当・ローカルのみ）
export function deleteHistoryEntry(id, drama, season, episode) {
  if (id) {
    const history = loadHistory().filter((h) => h.id !== id);
    safeSet(HISTORY_KEY, JSON.stringify(history));
    deleteHistoryRow(id); // クラウドからも削除（ログイン時・fire-and-forget）
  }
  if (drama && season && episode) {
    const title = (drama.englishTitle || drama.title).toLowerCase().replace(/[^a-z0-9]/g, '_');
    localStorage.removeItem(`cl_sub_${title}_s${season}e${episode}`);
  }
}
