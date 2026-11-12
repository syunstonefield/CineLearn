// Supabase 連携。js/supabase.js から移植。
// 認証（サインイン/リフレッシュ）＋学習データの双方向同期。
// - history: 双方向（pushHistoryEntry / deleteHistoryRow）。pull が丸ごと上書きのため。
// - srs: 双方向（reviewWord 等の書込ごとに pushSrsWords / pull は語単位マージ）。
//   朝の復習リマインダー（/api/push-notify morning）が srs_data の due_date を読むため、
//   クラウド側を最新に保つことが通知の前提になる。
// - user_state: 半券/お気に入り/学習時間/予習完了/席番号の汎用 key-value 同期
//   （queueStatePush / pull は種類別マージ＝union・max でデバイス間のクラバー防止）。
// - profiles: 双方向（pushProfiles / deleteProfileRow）。プロフィール別 localStorage キー
//   （cl_tickets_{pid} 等）がデバイス跨ぎで成立するには pid の同期が前提。
//   pull は時刻比較（cl_profiles_updated_at vs updated_at）で新しい方を採用＋myDramas 合体
//   （lib/profileMerge.js）。push 失敗後に古いクラウドで設定が巻き戻る事故を防ぐ。
// - my_words: pull のみ（書込は拡張が直接 Supabase へ）。
import { PROFILES_AT_KEY, mergeProfileArrays, cloudWins } from './profileMerge';
import { ticketEpKey, trimTickets } from './ticketRules';
import { mergeActivityDates, mergeReviewLog, mergeQuizAwarded, mergeTitleToggles, mergeRingMetReset } from './stateMergeRules';
import { fetchAllSrs, mergeSrs } from './srsMerge';
import { pgrstInFilter } from './wordbookFlags';
import { HISTORY_BUDGET_CHARS, trimHistoryToBudget } from './historyBudget';

const SUPABASE_URL = 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';

const SB_SESSION_KEY = 'cl_sb_session';

export function getSession() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(SB_SESSION_KEY));
  } catch {
    return null;
  }
}
function setSession(d) {
  localStorage.setItem(SB_SESSION_KEY, JSON.stringify(d));
}
export function clearSession() {
  localStorage.removeItem(SB_SESSION_KEY);
}
export function getCurrentUser() {
  return getSession()?.user || null;
}
export function isLoggedIn() {
  const s = getSession();
  if (!s?.access_token) return false;
  if (s.expires_at && Date.now() / 1000 > s.expires_at - 60) return false;
  return true;
}

function sbHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, ...extra };
  const s = getSession();
  if (s?.access_token) h['Authorization'] = `Bearer ${s.access_token}`;
  return h;
}

// REST の 401（トークンが無効）は、まず更新を1回試して同じ要求をやり直し、それでも 401 の時だけ失効を知らせる（案C・2026-11-07）。
//   更新が通信エラーで失敗した時は失効ではないので知らせない（ensureFreshSession が区別する）。
export async function sbFetch(path, opts = {}) {
  const { _retried, ...init } = opts;
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: sbHeaders(init.headers || {}) });
    if (res.status === 401 && getSession()?.access_token && !path.startsWith('/auth/')) {
      if (!_retried && (await ensureFreshSession({ force: true }))) return sbFetch(path, { ...init, _retried: true });
      if (_retried) notifySessionExpired(); // 更新後も 401＝本当に無効
    }
    if (res.status === 204 || res.status === 201) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function supaSignIn(email, password) {
  const d = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (d?.access_token) setSession(d);
  return d;
}

export async function supaSignUp(email, password) {
  const d = await sbFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (d?.access_token) setSession(d);
  return d;
}

export async function supaSignOut() {
  await sbFetch('/auth/v1/logout', { method: 'POST' });
  clearSession();
}

// セッションを有効に保つ（オートログインの核）。戻り値: ログイン維持できたか。
// セッション失効の通知（2026-11-07・候補C）。更新に失敗した／401 を受けた時に window へ出し、AppProvider が
// 「ログイン表示を落として期限切れの帯を出す」。以前は失敗しても黙って古いままで、送信は捨てられ取り込みも止まっていた。
export const SESSION_EXPIRED_EVENT = 'cl:session-expired';
function notifySessionExpired() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } catch {
    /* ignore */
  }
}

// 更新を一本化（同時に複数の送信が失効を見ても refresh_token を二度使わない＝使い捨てトークンの再利用拒否を避ける）
let _refreshing = null;
// 更新に失敗した時、拡張（bridge v1.2.12〜）の書き戻しを待つ時間（テストから短くできる）
export const sessionRetry = { delayMs: 1500 };
// 拡張が localStorage へ書き戻した直後に出すイベント名（同じタブでは storage イベントが来ないため）。AppProvider が受けて判定し直す。
export const SESSION_UPDATED_EVENT = 'cl-session-updated';
//   force: 期限がまだ先でも更新する（REST が 401 を返した＝サーバ側で無効になった／端末の時計がずれている時）。
export async function ensureFreshSession({ force = false } = {}) {
  const s = getSession();
  if (!s?.access_token) return false;
  const now = Date.now() / 1000;
  if (!force && s.expires_at && s.expires_at - now > 600) return true;
  if (!s.refresh_token) {
    notifySessionExpired();
    return false;
  }
  if (!_refreshing) {
    _refreshing = (async () => {
      try {
        // 更新は HTTP の結果を自分で見る: 通信エラー（オフライン・fetch 失敗）と 5xx／429 は「失効」ではない＝帯を出さず、
        // 通信が戻った時（online・タブ復帰・次の送信）にやり直す。帯を出すのは、サーバが refresh_token を明確に拒否した時だけ。
        let d = null;
        let rejected = false;
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: sbHeaders(),
            body: JSON.stringify({ refresh_token: s.refresh_token }),
          });
          if (res.status >= 500 || res.status === 429) return false; // 一時的な不調
          try {
            d = await res.json();
          } catch {
            d = null;
          }
          rejected = !res.ok; // 400/401/403＝トークンが無効（used / invalid / revoked）
        } catch {
          return false; // オフライン・通信エラー
        }
        if (d?.access_token) {
          setSession(d);
          return true;
        }
        if (!rejected) return false; // 2xx なのに access_token が無い（想定外）＝失効とは言い切れない
        // 失敗。Chrome 拡張（bridge.js v1.2.12〜）が先に更新して新しいセッションを localStorage に書き戻していれば、それを採る
        // （同じ refresh_token を拡張が先に使うと、こちらの更新は「使用済み」で拒否される）。ほぼ同時に更新した場合の救済として
        // 少し待ってから読み直す。セッションは消さない。古い拡張（書き戻さない）でも動きは従来どおり（失敗→失効の通知）。
        const fresher = () => {
          const s2 = getSession();
          return !!(s2?.access_token && s2.refresh_token !== s.refresh_token && s2.expires_at && s2.expires_at - Date.now() / 1000 > 60);
        };
        if (fresher()) return true;
        await new Promise((r) => setTimeout(r, sessionRetry.delayMs));
        if (fresher()) return true;
        notifySessionExpired();
        return false;
      } finally {
        _refreshing = null;
      }
    })();
  }
  return _refreshing;
}

// 送信・削除の前に呼ぶ: ログイン中ならそのまま、期限切れなら更新を試し、だめなら失効を知らせて false。
//   旧: isLoggedIn() が false だと何もせず捨てていた（失効に気づけない）。セッション自体が無い（未ログイン）時は静かに false。
export async function ensureSessionForSync() {
  if (isLoggedIn()) return true;
  if (!getSession()?.access_token) return false;
  return ensureFreshSession();
}

// my_words を created_at 降順で末尾までページ送りして集める（2026-09-22）。
// 1ページ 1000 行・上限 MY_WORDS_MAX。途中でネットワーク失敗したら null（呼び出し側は上書きしない）。
export const MY_WORDS_MAX = 5000;
const MY_WORDS_PAGE = 1000;
async function fetchAllMyWords(uid) {
  const all = [];
  for (let offset = 0; offset < MY_WORDS_MAX; offset += MY_WORDS_PAGE) {
    const page = await sbFetch(
      `/rest/v1/my_words?user_id=eq.${uid}&select=*&order=created_at.desc&limit=${MY_WORDS_PAGE}&offset=${offset}`
    );
    if (!Array.isArray(page)) return offset === 0 ? page : all; // 2ページ目以降の失敗は取れた分で確定
    all.push(...page);
    if (page.length < MY_WORDS_PAGE) break;
  }
  return all;
}

// クラウドの history の1行 → 端末の cl_history の形。
export function historyRowToLocal(h) {
  return {
    id: h.id,
    date: h.date,
    drama: h.drama,
    season: h.season,
    episode: h.episode,
    level: h.level,
    targetLevel: h.target_level,
    words: h.words,
    quiz: h.quiz,
    quizScore: h.quiz_score,
    quizDate: h.quiz_date,
  };
}

// 取り込み用: 更新が新しい順に HISTORY_PAGE 行ずつ、合計が端末の上限（2MB）を超えるまで取る。
//   1回の取得は Supabase の上限（1000行）より十分小さくする（infra-gotchas）。途中の失敗は null（＝上書きしない）。
const HISTORY_PAGE = 100;
const HISTORY_PULL_MAX_ROWS = 2000;
export async function fetchHistoryForPull(uid, fetchPage = sbFetch) {
  const all = [];
  let size = 0;
  for (let offset = 0; offset < HISTORY_PULL_MAX_ROWS; offset += HISTORY_PAGE) {
    const page = await fetchPage(
      `/rest/v1/history?user_id=eq.${uid}&select=*&order=updated_at.desc,id.desc&limit=${HISTORY_PAGE}&offset=${offset}`
    );
    if (!Array.isArray(page)) return offset === 0 ? page : null;
    for (const h of page) {
      all.push(h);
      size += JSON.stringify(h).length;
    }
    if (page.length < HISTORY_PAGE || size > HISTORY_BUDGET_CHARS) break;
  }
  return all;
}

// 作品を開いた時に端末にリストが無ければ、本人のクラウドの行（作品名＋話数）を1行だけ読む（2026-11-12）。
//   ログインしていない・見つからない・失敗は null（呼び出し側は「リストを生成」を出す）。
export async function fetchHistoryRowFromCloud(title, season, episode, fetchPage = sbFetch) {
  if (!title || !isLoggedIn()) return null;
  const uid = getCurrentUser()?.id;
  if (!uid) return null;
  const eq = (v) => (v == null ? 'is.null' : `eq.${encodeURIComponent(v)}`);
  const rows = await fetchPage(
    `/rest/v1/history?user_id=eq.${uid}&drama->>title=eq.${encodeURIComponent(title)}&season=${eq(season)}&episode=${eq(episode)}&select=*&order=updated_at.desc&limit=1`
  );
  const h = Array.isArray(rows) ? rows[0] : null;
  return h?.words?.length ? historyRowToLocal(h) : null;
}

// クラウド → localStorage に取り込む（★読み取り専用★）。
// js/supabase.js の pullFromCloud を移植。DOM 更新は React 側に任せて削除。
// profileId を渡すと my_words をプロフィール別キーにも反映する（既存挙動）。
export async function pullFromCloud(profileId = null) {
  const uid = getCurrentUser()?.id;
  if (!uid) return;

  // profiles（設定）: 「新しい方が勝つ」＋ myDramas 合体（無条件上書きはしない）。
  // かつては丸ごと上書きで、push 失敗後の起動時に古いクラウドが新しいローカルを潰し
  // 設定・マイリストが巻き戻る事故があった。時刻比較で新しい側を winner にし、
  // 負けた側からは myDramas と不足プロフィールだけ拾う（作品消失を絶対に防ぐ）。
  const profiles = await sbFetch(`/rest/v1/profiles?user_id=eq.${uid}&select=*`);
  if (Array.isArray(profiles) && profiles.length) {
    const cloudProfiles = profiles.map((p) => ({ id: p.id, name: p.name, color: p.color, settings: p.settings }));
    const cloudAt = profiles.reduce((m, p) => ((p.updated_at || '') > m ? p.updated_at : m), '');
    let localProfiles = [];
    try {
      localProfiles = JSON.parse(localStorage.getItem('cl_profiles') || '[]') || [];
    } catch {
      localProfiles = [];
    }
    const localAt = localStorage.getItem(PROFILES_AT_KEY) || '';
    const merged = cloudWins(localProfiles, localAt, cloudAt)
      ? mergeProfileArrays(cloudProfiles, localProfiles)
      : mergeProfileArrays(localProfiles, cloudProfiles);
    try {
      localStorage.setItem('cl_profiles', JSON.stringify(merged));
      // 時刻は「両者の新しい方」へ。now を打つと他端末の実変更に永久に勝ってしまうので不可。
      const maxAt = cloudAt > localAt ? cloudAt : localAt;
      if (maxAt) localStorage.setItem(PROFILES_AT_KEY, maxAt);
    } catch {
      /* プライベートモード等は無視 */
    }
    // マージ結果がクラウドと違う（ローカルが勝った/合体で増えた）→ クラウドへ書き戻す。
    if (JSON.stringify(merged) !== JSON.stringify(cloudProfiles)) {
      pushProfiles(merged, (cloudAt > localAt ? cloudAt : localAt) || undefined); // fire-and-forget
    }
  }

  // history（2026-11-12: 50行で切らず、端末の上限 2MB 分までページ送りで取る・lib/historyBudget.js）。
  //   途中で読み取りに失敗したら端末の履歴は上書きしない（少ない行で置き換えて消さないため）。
  const history = await fetchHistoryForPull(uid);
  if (Array.isArray(history) && history.length) {
    let srsNow = {};
    try {
      srsNow = JSON.parse(localStorage.getItem('cl_srs') || '{}') || {};
    } catch {
      /* 無視 */
    }
    // 同じ作品名＋話数の行が複数あれば、更新が新しい1行だけ（押し出された後に作り直した作品はクラウドに2行ある）
    const seenEp = new Set();
    const rows = history.map(historyRowToLocal).filter((h) => {
      const k = `${h.drama?.title}\u0000${h.season}\u0000${h.episode}`;
      if (seenEp.has(k)) return false;
      seenEp.add(k);
      return true;
    });
    const { history: kept } = trimHistoryToBudget(rows, srsNow);
    try {
      localStorage.setItem('cl_history', JSON.stringify(kept));
    } catch {
      // 容量オーバー＝さらに小さくして入れる（端末の他の保存を守る）
      try {
        const { history: smaller } = trimHistoryToBudget(kept, srsNow, { budget: Math.floor(HISTORY_BUDGET_CHARS / 2) });
        localStorage.setItem('cl_history', JSON.stringify(smaller));
      } catch {
        /* 諦める（端末の履歴はそのまま） */
      }
    }
  }

  // srs（語単位マージ・2026-11-07 lib/srsMerge.js に集約）。
  //   word 順に 1000 行ずつ全部読む（旧: limit=5000 の1回取得＝Supabase の行数上限で途中で切れ、取り込みに入らなかった語が
  //   端末の古い値のまま残り、さらにクラウドへ書き戻されていた）。クラウドの last_review が新しい方を採用、同じ日なら
  //   updated_at が新しい方、どちらも無ければ端末優先。全件取れた時だけ「ローカルにしか無い語」をクラウドへ吸い上げる。
  const { rows: srsRows, complete: srsComplete } = await fetchAllSrs((offset, limit) =>
    sbFetch(`/rest/v1/srs_data?user_id=eq.${uid}&select=*&order=word.asc&limit=${limit}&offset=${offset}`)
  );
  if (srsRows.length || srsComplete) {
    let local = {};
    try {
      local = JSON.parse(localStorage.getItem('cl_srs') || '{}') || {};
    } catch {
      local = {};
    }
    const { merged, pushBack } = mergeSrs(local, srsRows, { complete: srsComplete });
    localStorage.setItem('cl_srs', JSON.stringify(merged));
    if (!srsComplete) console.warn('[CL:SYNC] srs の取り込みが途中で切れた（吸い上げは見送り）', srsRows.length);
    if (Object.keys(pushBack).length) pushSrsWords(pushBack); // fire-and-forget
  }

  // my_words（グローバルキーに保存。プロフィール別キーは選択時にコピーする）
  // 2026-09-22: 固定天井 limit=2000 を廃し、1000行ずつ末尾までページ送りする（★で生成語も入る
  // ようになり、2001語目以降の古い語が黙って欠落する事故が現実的になった）。安全上限は
  // MY_WORDS_MAX（localStorage 約5MB/オリジンの制約・1語≈600B）。索引は
  // supabase_my_words_in_wordbook.sql の mywords_user_created。
  const words = await fetchAllMyWords(uid);
  if (Array.isArray(words)) {
    // example_ja は「その例文」の訳なので、例文と必ずペアで扱う。拡張が別の場面で例文を
    // 差し替えた行では訳だけ古いまま残り得るため、ローカルの旧レコードと例文を突き合わせ、
    // 変わっていたら訳を捨てる（＝新しい例文で取り直す。同じ文なら端末キャッシュ命中で無料）。
    const prevSentence = new Map();
    // 📍時刻（tsSec）はクラウドに列ができる前に保存された語では null で返る。全量上書きで
    // ローカルの値まで消さないよう、旧レコードの tsSec を控えておきクラウド側が空の時だけ残す
    // （手動追加で付いた📍が、タブ復帰の pull のたびに消えていた＝2026-08-08 の実害）。
    const prevTsSec = new Map();
    // 作品名も同じ理由で控える。拡張がタイトル未取得のまま保存した回の行は drama_title が
    // null で返り、全量上書きでローカルの作品名まで消える（消えた語は作品の単語リストから
    // 永久に外れ、自動で直す経路も無い）。クラウドが空の時だけローカル値を残す。
    const prevTitle = new Map();
    // 例文の失敗理由（クラウドに列が無いローカル専用フィールド）
    const prevFail = new Map();
    // ★単語帳メンバーシップ（in_wordbook）。列がまだ無いDBでは応答に載らない（undefined）ので、
    // その間はローカルの旗を残す（全量上書きで「外した」状態が毎回 true に戻らないように）。
    const prevInWordbook = new Map();
    // ♡（liked / likedAt・2026-11-07）。列が無い DB ではクラウドに載らないのでローカルの印を残す。
    const prevLiked = new Map();
    // 例文の注記（example_note: AI 作例／この回の別の場面・2026-10-31）。列がまだ無い DB では応答に載らない
    // （undefined）ので、その間はローカルの注記を残す（AI 作例が pull のたびに消えないように）。
    const prevNote = new Map();
    try {
      JSON.parse(localStorage.getItem('cl_my_words') || '[]').forEach((p) => {
        if (!p?.word) return;
        const k = String(p.word).toLowerCase();
        prevSentence.set(k, p.sentence || '');
        if (p.tsSec != null) prevTsSec.set(k, p.tsSec);
        // 例文の取得結果（成功=文／失敗=理由）は端末ローカルにしか無い。上書きで消さないよう控える。
        if (p.exampleFail) prevFail.set(k, { reason: p.exampleFail, at: p.exampleFailAt || '' });
        if (p.dramaTitle) prevTitle.set(k, { title: p.dramaTitle, season: p.season ?? null, episode: p.episode ?? null });
        if (p.inWordbook === false) prevInWordbook.set(k, false);
        if (p.liked === true) prevLiked.set(k, { liked: true, likedAt: p.likedAt || null });
        if (p.exampleNote) prevNote.set(k, p.exampleNote);
      });
    } catch {
      /* 旧データの破損は無視（例文訳を捨てる方向に倒れるだけ） */
    }
    const wordsList = JSON.stringify(
      words.map((w) => {
        const key = String(w.word || '').toLowerCase();
        const before = prevSentence.get(key);
        // ★例文はクラウドが空ならローカルを残す（2026-08-08）。tsSec・作品名と同じ救済を
        //   sentence にだけ入れ忘れていたため、アプリが後埋めした例文が **タブに戻るたびの pull**
        //   （10秒トロットル／単語帳は開いた直後と6秒後の2回）で毎回消えていた。
        //   クラウド側を空文字で潰す実行犯（拡張の無条件送信）も同時に塞ぐが、送信が着地する前の
        //   pull でも消えるため、受け取り側にも救済が要る。
        const cloudSentence = w.sentence || '';
        // ★切り替え前（2026-07-03 より前）に保存した語は救済しない＝クラウドが正（2026-10-09）。
        //   端末に残る当時の画面字幕の行が、取り直しで消した後に「空なら残す」でよみがえり、次の保存の
        //   ついでにクラウドへ送り返されていた（lib/preDomExamples.js の消去が効かなかった実害）。
        const savedIso = toIsoDateLite(w.saved_at);
        const preDom = !!savedIso && savedIso < '2026-07-03';
        const sentence = cloudSentence || (preDom ? '' : before) || '';
        // 「例文が差し替わった」＝クラウドに新しい文があり、それがローカルと違う時だけ。
        // クラウドが空（＝未着地）を差し替え扱いにすると、📍と例文訳まで道連れで消えていた。
        const sentenceChanged = !!cloudSentence && before !== undefined && before !== cloudSentence;
        // 例文が別の場面に差し替わった行では、旧場面の時刻を引き継がない（訳と同じ扱い）。
        const localTs = sentenceChanged ? null : prevTsSec.get(key) ?? null;
        // 場面座標は一組。クラウドに作品名があればクラウド優先、無ければローカルの組を丸ごと残す。
        const localSrc = prevTitle.get(key) || null;
        const scene = w.drama_title
          ? { title: w.drama_title, season: w.season, episode: w.episode }
          : localSrc || { title: w.drama_title, season: w.season, episode: w.episode };
        return {
          word: w.word,
          sentence,
          phonetic: w.phonetic,
          pos: w.pos,
          definition: w.definition,
          ja: w.ja ?? null, // 保存時の文脈訳（拡張v1.2.2から書き込み・旧行はnull）
          example_ja: sentenceChanged ? '' : w.example_ja || '', // 例文の和訳（アプリが後埋め・2026-08-06〜）
          encounters: Array.isArray(w.encounters) ? w.encounters : null, // 遭遇ログ（v1.2.2・再会カードの場面つき表示用）
          savedAt: w.saved_at,
          // 行を作った時刻（＝初めて保存した時刻）。棚から外す・消去の印より後に保存したかの判定に使う（lib/workRemoval.js）
          createdAt: w.created_at || null,
          source: w.source,
          dramaTitle: scene.title,
          season: scene.season,
          episode: scene.episode,
          // 📍場面時刻。クラウド優先・空ならローカルに在った値を残す（列追加前の語を守る）。
          tsSec: w.ts_sec ?? localTs,
          // 例文の失敗理由はローカル専用。例文が入ったら消し、まだ空なら据え置く
          // （毎回の pull で消えると「無言で例文なし」に戻り、可視化の投資が無駄になる）。
          exampleFail: sentence ? '' : prevFail.get(key)?.reason || '',
          exampleFailAt: sentence ? '' : prevFail.get(key)?.at || '',
          // ★単語帳に入っているか。クラウドが列を持てばそれが正、無ければローカルの旗を残す。
          inWordbook: typeof w.in_wordbook === 'boolean' ? w.in_wordbook : prevInWordbook.get(key) ?? true,
          // ♡ お気に入りの例文の印（supabase_my_words_wordbook.sql）。クラウドが列を持てばそれが正、無ければローカルの印を残す。
          liked: typeof w.liked === 'boolean' ? w.liked : prevLiked.get(key)?.liked ?? false,
          likedAt: typeof w.liked === 'boolean' ? w.liked_at || null : prevLiked.get(key)?.likedAt ?? null,
          // 例文の注記。クラウドが列を持てばそれが正（null 含む）、無ければローカルの注記を残す。
          exampleNote: w.example_note !== undefined ? normalizeExampleNote(w.example_note) : prevNote.get(key) ?? null,
        };
      })
    );
    localStorage.setItem('cl_my_words', wordsList);
    // 選択中プロフィールがあればプロフィール別キーにも反映
    // （拡張機能で増えた単語をフォーカス時の再取得で単語帳に出すため）
    if (profileId) localStorage.setItem(`cl_my_words_${profileId}`, wordsList);
  }

  // user_state（半券/お気に入り/学習時間/予習完了/席番号）：種類別マージ→ローカル反映。
  // マージ結果がクラウドと異なるキーだけ push（初回移行の吸い上げを兼ねる）。
  const stateRows = await sbFetch(`/rest/v1/user_state?user_id=eq.${uid}&select=key,value`);
  if (Array.isArray(stateRows)) {
    const cloudMap = {};
    stateRows.forEach((r) => {
      cloudMap[r.key] = r.value;
    });
    const keys = new Set([...localStateKeys(), ...Object.keys(cloudMap)]);
    const toPush = [];
    keys.forEach((key) => {
      const merged = mergeStateValue(key, readStateLocal(key), key in cloudMap ? cloudMap[key] : null);
      if (merged == null) return;
      try {
        localStorage.setItem(key, JSON.stringify(merged));
      } catch {
        /* プライベートモード等は無視 */
      }
      if (JSON.stringify(merged) !== JSON.stringify(cloudMap[key] ?? null)) {
        toPush.push({ user_id: uid, key, value: merged, updated_at: new Date().toISOString() });
      }
    });
    if (toPush.length) {
      sbFetch('/rest/v1/user_state', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(toPush),
      });
    }
  }
}

// 保存日の表記ゆれ（2026/6/12・ISO 日時）を YYYY-MM-DD に揃える（storage.js の toIsoDate と同じ規則・循環 import を避けて複製）
function toIsoDateLite(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

// ── 学習データ同期のヘルパ ──────────────────────────────────────

// 同期対象の localStorage キー（user_state 1行=1キー）。★足したら lib/deviceAccount.js LEARNING_KEY_RE にも足す（ログアウトで消す対象）。
//   2026-11-07: cl_removed_works（コレクションから消去した印）・cl_ring_met_reset（円の「出会った」を数え直す起点）を追加。
//   2026-11-05: cl_activity_dates（学習した日）・cl_review_log（復習の記録）・cl_quiz_exp_awarded（クイズ EXP の台帳）を追加
//   （ログアウトで端末から消すようにしたため、写しが無いと同じアカウントの入り直しで戻らない。規則は lib/stateMergeRules.js）。
export const STATE_KEY_RE =
  /^(cl_tickets|cl_fav_dramas|cl_study_sec|cl_study_drama|cl_watch_log|cl_frame_best)(_|$)|^cl_prepped$|^cl_seat_counter$|^cl_exp_ledger$|^cl_archived$|^cl_stats_daily$|^cl_activity_dates$|^cl_review_log$|^cl_quiz_exp_awarded$|^cl_removed_works$|^cl_ring_met_reset$/;

function localStateKeys() {
  try {
    return Object.keys(localStorage).filter((k) => STATE_KEY_RE.test(k));
  } catch {
    return [];
  }
}

function readStateLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw); // 数値キー（cl_study_sec 等）は "123" → 123 になる
  } catch {
    return null;
  }
}

// 種類別マージ。デバイスA/Bで別々に育ったデータを last-write-wins で潰さず統合する。
function mergeStateValue(key, localV, cloudV) {
  if (localV == null) return cloudV;
  if (cloudV == null) return localV;
  if (key.startsWith('cl_watch_log')) {
    // 「観終わった」の申告（lib/watchlog.js）。端末ローカルだったため、スマホで申告した話が PC では
    // 「観終わりましたか？」のまま出ていた（2026-10-08 オーナー報告）→ 同期する。
    // 同じ話（作品名|S|E）は新しい申告を1件だけ残す（tmdbId は片側だけ持つことがあるので題名で照合）。
    const m = new Map();
    [...(Array.isArray(cloudV) ? cloudV : []), ...(Array.isArray(localV) ? localV : [])]
      .filter((e) => e && (e.title || e.tmdbId != null))
      .forEach((e) => {
        const k = `${e.title || e.tmdbId}|${e.season ?? ''}|${e.episode ?? ''}`;
        const prev = m.get(k);
        if (!prev || (e.confirmedAt || 0) >= (prev.confirmedAt || 0)) m.set(k, { ...prev, ...e, tmdbId: e.tmdbId ?? prev?.tmdbId ?? null });
      });
    return [...m.values()].sort((a, b) => (a.confirmedAt || 0) - (b.confirmedAt || 0)).slice(-200);
  }
  if (key.startsWith('cl_tickets')) {
    // 半券: 同一話は createdAt が新しい方を採る（保持規律は ticketRules に集約）。
    // ⚠同一話で words を持つ側と落とした側が出会った場合は、words がある方を優先する
    //   （新しい端末が軽い記録を先に作っても、もう片方が持つ出題語を消さない）。
    const m = new Map();
    [...(Array.isArray(cloudV) ? cloudV : []), ...(Array.isArray(localV) ? localV : [])]
      .filter((t) => t && t.id)
      .forEach((t) => {
        const k = ticketEpKey(t);
        const prev = m.get(k);
        if (!prev) return void m.set(k, t);
        const better =
          (t.words?.length ? 1 : 0) - (prev.words?.length ? 1 : 0) ||
          (t.createdAt || 0) - (prev.createdAt || 0);
        if (better >= 0) m.set(k, t);
      });
    return trimTickets([...m.values()]);
  }
  if (key.startsWith('cl_fav_dramas')) {
    const l = Array.isArray(localV) ? localV : [];
    const c = Array.isArray(cloudV) ? cloudV : [];
    return [...new Set([...l, ...c])];
  }
  if (key.startsWith('cl_study_sec') || key === 'cl_seat_counter') {
    // 積算カウンタは max（合算だと同期のたびに二重計上する）
    return Math.max(Number(localV) || 0, Number(cloudV) || 0);
  }
  if (key.startsWith('cl_study_drama') || key.startsWith('cl_frame_best') || key === 'cl_exp_ledger') {
    // 半券の額縁（cl_frame_best・作品→届いた段階）も上がるだけなのでキー別 max（2026-10-31）。
    // キー別 max。EXP台帳は「日付|端末キー」ごとに単調増加なので max が正しい
    // （合算だと同期のたびに二重計上・スカラーmaxだと別端末の増分が消える）。
    const out = { ...(cloudV || {}) };
    Object.entries(localV || {}).forEach(([t, s]) => {
      out[t] = Math.max(Number(out[t]) || 0, Number(s) || 0);
    });
    return out;
  }
  if (key === 'cl_activity_dates') return mergeActivityDates(localV, cloudV);
  if (key === 'cl_review_log') return mergeReviewLog(localV, cloudV);
  if (key === 'cl_quiz_exp_awarded') return mergeQuizAwarded(localV, cloudV);
  // コレクションから消去した印（作品ごとに新しい方）と、円の「出会った」を数え直す起点（2026-11-07・lib/workRemoval.js）。
  if (key === 'cl_removed_works') return mergeTitleToggles(localV, cloudV);
  if (key === 'cl_ring_met_reset') return mergeRingMetReset(localV, cloudV);
  if (key === 'cl_stats_daily') {
    // 日ごとの学習記録（storage.js STATS_DAILY_KEY）: 「日付|端末キー」の行ごと・フィールドごとの max。
    // 行はその端末だけが書き、各フィールドは単調増加＝max で正しい（cl_exp_ledger の数値 max は入れ子に効かない）。
    const out = { ...(cloudV && typeof cloudV === 'object' ? cloudV : {}) };
    Object.entries(localV && typeof localV === 'object' ? localV : {}).forEach(([k, row]) => {
      const base = out[k] && typeof out[k] === 'object' ? out[k] : {};
      const m = { ...base };
      Object.entries(row && typeof row === 'object' ? row : {}).forEach(([f, n]) => {
        m[f] = Math.max(Number(base[f]) || 0, Number(n) || 0);
      });
      out[k] = m;
    });
    return out;
  }
  if (key === 'cl_archived') {
    // 棚から外す/戻す: 作品ごとに at が新しい方。旧形式（配列）は at:0 として読む
    // （storage.js normalizeArchived と同じ解釈＝循環 import を避けてここに複製）。
    const norm = (v) =>
      Array.isArray(v)
        ? Object.fromEntries(v.filter(Boolean).map((t) => [t, { on: true, at: 0 }]))
        : v && typeof v === 'object'
          ? v
          : {};
    const out = { ...norm(cloudV) };
    Object.entries(norm(localV)).forEach(([t, v]) => {
      if (!out[t] || (v?.at || 0) >= (out[t]?.at || 0)) out[t] = v;
    });
    return out;
  }
  if (key === 'cl_prepped') {
    // 予習完了: union。両方にあれば at が古い方（＝初回予習の記録・席番号を安定させる）
    const out = { ...(localV || {}) };
    Object.entries(cloudV || {}).forEach(([ep, v]) => {
      if (!out[ep] || (v?.at || 0) < (out[ep]?.at || 0)) out[ep] = v;
    });
    return out;
  }
  return localV; // 未知キーはローカル優先
}

// localStorage キー1件をクラウドへ（トロットル型: 窓内の連続書込は1回に畳む。
// デバウンスだと学習時間ティックのような定期書込で永久に飢餓するため、
// 既にタイマーが走っていれば延長しない）。値は flush 時点の localStorage を読む。
const stateTimers = {};
// 戻り値＝送れたか（送るものが無い時も true）。sbFetch は 204 と失敗をどちらも null で返すので、ここだけ HTTP の結果を見る。
async function sendStateKey(key) {
  if (!(await ensureSessionForSync())) return false;
  const uid = getCurrentUser()?.id;
  const v = readStateLocal(key);
  if (!uid || v == null) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_state`, {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ user_id: uid, key, value: v, updated_at: new Date().toISOString() }]),
    });
    return res.ok;
  } catch {
    return false;
  }
}
export function queueStatePush(key, delayMs = 3000) {
  if (typeof window === 'undefined' || !getSession()?.access_token) return; // 期限切れでも積む（送る時に更新を試す）
  if (stateTimers[key]) return;
  stateTimers[key] = setTimeout(async () => {
    delete stateTimers[key];
    const ok = await sendStateKey(key).catch(() => false);
    // 送れなかった（オフライン・失効の更新待ち）時は 60 秒後にもう一度（失効が確定していれば isLoggedIn が false でも積む＝通信復帰で送れる）
    if (!ok && getSession()?.access_token) queueStatePush(key, 60 * 1000);
  }, delayMs);
}
// 待ちになっている同期を今すぐ送る（ログアウトの直前に呼ぶ＝消す前に失わない・2026-11-05 lib/deviceAccount.js）。
//   セッションが有効なうちに送る必要があるので、supaSignOut / clearSession より前に await する。
//   戻り値 { sent:[送れたキー], failed:[送れなかったキー] }。送れなかったキーは待ちに戻す（ログアウトを止めた時に次の契機で再送できる）。
export async function flushStatePushQueue() {
  const keys = Object.keys(stateTimers);
  for (const k of keys) {
    clearTimeout(stateTimers[k]);
    delete stateTimers[k];
  }
  const sent = [];
  const failed = [];
  await Promise.all(
    keys.map(async (k) => {
      if (await sendStateKey(k)) sent.push(k);
      else failed.push(k);
    })
  );
  for (const k of failed) queueStatePush(k, 3000);
  return { sent, failed };
}

// SRS を語単位でクラウドへ upsert（entries = { word: srsEntry }）。
// スキーマ列のみ送る（lastQuality/reviewCount 等の拡張フィールドはローカル専用）。
// origin_*（最初に出会った作品/話・supabase_srs_origin.sql）と first_quality（初回の答え・
// supabase_srs_first_quality.sql）は後から足した列。列が無いDBでは PGRST204 で行ごと弾かれるので、
// 一度弾かれたらセッション中はその列を送らない（ts_sec / in_wordbook と同じ作法）。
// 列が無い DB（SQL の適用前）で弾かれた列は、しばらく送らない。★ページを閉じるまでではなく SRS_COLUMN_RETRY_MS たったら
//   もう一度送ってみる（2026-11-12: デプロイ→SQL の間に開いていたページが、列を足した後も last_quality を送らなかった・オーナー決定）。
//   値＝その時刻まで送らない（Date.now() のミリ秒）。0＝送る。
export const SRS_COLUMN_RETRY_MS = 10 * 60 * 1000;
const _srsColumnOffUntil = { origin: 0, firstQuality: 0, lastQuality: 0 };
// origin_*（最初に出会った作品/話）・first_quality（初回の答え）・last_quality（最後の答え・「知らなかった／うろ覚えの語を
//   もう一度」2026-11-12・supabase_srs_last_quality.sql）。どれも後から足した列で、列が無い間は外して送る＝端末の値だけで動く。
const srsColumnOff = (name) => Date.now() < _srsColumnOffUntil[name];
function missingSrsColumn(res) {
  const msg = `${res?.code || ''} ${res?.message || ''}`;
  if (!/PGRST204/.test(msg)) return null;
  if (/origin_/.test(msg)) return 'origin';
  if (/first_quality/.test(msg)) return 'firstQuality';
  if (/last_quality/.test(msg)) return 'lastQuality';
  return null;
}

export async function pushSrsWords(entries) {
  if (!(await ensureSessionForSync())) return;
  const uid = getCurrentUser()?.id;
  if (!uid || !entries) return;
  const build = (words) =>
    words.map((word) => {
      const e = entries[word];
      const row = {
        user_id: uid,
        word,
        interval: e.interval ?? 1,
        repetitions: e.repetitions ?? 0,
        ease_factor: e.easeFactor ?? 2.5,
        due_date: e.dueDate ?? null,
        last_review: e.lastReview ?? null,
        skipped: !!e.skipped,
        // 採点した時刻（storage.js が付ける・無ければ今）。同じ日に別の端末でも採点した語の決着に使う（lib/srsMerge.js）
        updated_at: e.updatedAt || new Date().toISOString(),
      };
      // 出所は持っている時だけ送る（省略＝据え置き・merge-duplicates）。最初に出会った作品を上書きしない
      if (!srsColumnOff('origin') && e.origin?.title) {
        row.origin_title = e.origin.title;
        row.origin_season = e.origin.season ?? null;
        row.origin_episode = e.origin.episode ?? null;
      }
      // 初回の答えも持っている時だけ送る（省略＝据え置き）。先に入った値を null で潰さない
      if (!srsColumnOff('firstQuality') && e.firstQuality != null) row.first_quality = e.firstQuality;
      // 最後の答えも持っている時だけ送る（省略＝据え置き）
      if (!srsColumnOff('lastQuality') && e.lastQuality != null) row.last_quality = e.lastQuality;
      return row;
    });
  const words = Object.keys(entries).filter((w) => entries[w]);
  if (!words.length) return;
  // ★項目のそろった行ごとに分けて送る（2026-11-12）。PostgREST はまとめて送る行の項目がそろっていることを前提にしている
  //   （docs「a JSON array of objects having uniform keys」）。開いた時の同期（mergeSrs の pushBack）は作品名や初回・最後の答えを
  //   持つ語と持たない語が混ざる＝1回にまとめると丸ごと受け付けられないおそれがあった（端末に残っていた最後の答えが吸い上がらない）。
  //   省いた項目は送らない（merge-duplicates で据え置き）＝足りない項目を null で埋めて送る方法（?columns=）は使わない。
  for (const group of groupRowsByKeys(build(words))) await postSrsGroup(group.map((r) => r.word), build);
}

// 行を項目の組み合わせごとに分ける（並びは最初に出た順）。テスト用に export
export function groupRowsByKeys(rows) {
  const groups = new Map();
  for (const r of rows) {
    const sig = Object.keys(r).sort().join(',');
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(r);
  }
  return [...groups.values()];
}

// 1組を送る。列が無い DB では、弾かれた列を外して送り直す（origin_*／first_quality／last_quality が全部無ければ最大3回）。
//   外すとその組の行はまだ項目がそろっている（同じ列を全行から外すだけ）。
async function postSrsGroup(words, build) {
  let rows = build(words);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await sbFetch('/rest/v1/srs_data', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    const missing = missingSrsColumn(res);
    if (!missing || srsColumnOff(missing)) return; // 列の不足以外（成功・ほかの失敗）／同じ列が二度弾かれた＝やめる
    _srsColumnOffUntil[missing] = Date.now() + SRS_COLUMN_RETRY_MS;
    rows = build(words);
  }
}

// 手動追加した単語を my_words へ upsert（#20 スマホからの単語追加）。
// my_words の書込は従来拡張のみだったが、手動追加はアプリ本体からも書く
// （pull はクラウド全量で cl_my_words を上書きするため、ローカル保存だけだと
// 次の pull で消える＝ログイン時はクラウド反映が必須）。
// 一意キーは (user_id, word)。値の無い列はキーごと省き、クラウド側の既存値を潰さない
// （拡張 background.js の同名規則と揃える）。
// my_words.ts_sec（📍場面時刻）が実DBにまだ無い時に true になる。列が無いまま送ると
// PostgREST が行ごと弾くため、一度でも弾かれたらセッション中は送らない（下の再送を参照）。
let _tsSecUnsupported = false;
function isMissingTsSec(res) {
  const msg = `${res?.code || ''} ${res?.message || ''}`;
  return /PGRST204/.test(msg) || /ts_sec/.test(msg);
}
// in_wordbook（★単語帳メンバーシップ・supabase_my_words_in_wordbook.sql）も同じ作法。
// 列が無いDBでは PGRST204 で行ごと弾かれるので、一度弾かれたらセッション中は送らない。
let _inWordbookUnsupported = false;
// liked / liked_at（♡・supabase_my_words_wordbook.sql）も同じ作法。
let _likedUnsupported = false;
function isMissingLiked(res) {
  const msg = `${res?.code || ''} ${res?.message || ''}`;
  return /PGRST204/.test(msg) && /liked/.test(msg);
}
let _exampleNoteUnsupported = false;
function isMissingExampleNote(res) {
  const msg = `${res?.code || ''} ${res?.message || ''}`;
  return /PGRST204/.test(msg) && /example_note/.test(msg);
}
// 例文の注記の形を検める（壊れた値・知らない種類は null）。
//   { kind:'ai', en, ja }           … AI 作例（字幕の引用ではない）。例文欄が空の時だけ表示する。
//   { kind:'other_scene', of }      … 例文がこの回の別の場面の台詞。of＝その例文の先頭40字（例文が差し替わったら無効）。
export function normalizeExampleNote(n) {
  if (!n || typeof n !== 'object') return null;
  if (n.kind === 'ai' && typeof n.en === 'string' && n.en.trim() && typeof n.ja === 'string') {
    return { kind: 'ai', en: n.en.slice(0, 200), ja: n.ja.slice(0, 200) };
  }
  if (n.kind === 'other_scene' && typeof n.of === 'string' && n.of) return { kind: 'other_scene', of: n.of.slice(0, 40) };
  return null;
}
function isMissingInWordbook(res) {
  const msg = `${res?.code || ''} ${res?.message || ''}`;
  return /PGRST204/.test(msg) && /in_wordbook/.test(msg);
}

export async function pushMyWord(w) {
  if (!(await ensureSessionForSync())) return false;
  const uid = getCurrentUser()?.id;
  if (!uid || !w?.word) return false;
  // 「取れなかった値は列ごと省く」＝拡張 background.js と同じ規則に揃える（2026-08-08）。
  // 旧実装は sentence/source を無条件に送っていたため、和訳の後埋めなど**例文をまだ持たない
  // スナップショット**から push すると、拡張が数秒後にバックフィルした例文を空文字で上書きして
  // いた（merge-duplicates は送った列を必ず更新する）。例文が消えると出所表示も道連れになる。
  const row = { user_id: uid, word: w.word, saved_at: w.savedAt || '' };
  if (w.sentence) row.sentence = w.sentence;
  // 例文を意図して消す時だけ null を送る（切り替え前の画面字幕の例文の取り直し・lib/preDomExamples.js）
  else if (w._clearSentence) row.sentence = null;
  if (w.source) row.source = w.source;
  if (w.ja) row.ja = w.ja;
  if (w.example_ja) row.example_ja = w.example_ja; // 例文の和訳（同じ行の sentence とペア）
  // 例文を差し替えた保存では古い訳を明示的に消す。送らない＝据え置き（merge-duplicates）なので、
  // 黙っていると新しい例文に前の例文の訳が付いたままクラウドに残る（拡張 background.js と同じ規則）。
  else if (w._clearExampleJa) row.example_ja = null;
  if (w.definition) row.definition = w.definition;
  if (Array.isArray(w.encounters) && w.encounters.length) row.encounters = w.encounters; // 遭遇ログ（拡張と同じ）
  // ★単語帳に入っているか。boolean で明示された時だけ送る（省略＝据え置き・DB既定は true）。
  if (typeof w.inWordbook === 'boolean' && !_inWordbookUnsupported) row.in_wordbook = w.inWordbook;
  // ♡ お気に入りの例文の印（2026-11-07）。boolean で明示された時だけ送る（省略＝据え置き・DB 既定は false）。
  if (typeof w.liked === 'boolean' && !_likedUnsupported) {
    row.liked = w.liked;
    row.liked_at = w.liked ? w.likedAt || null : null;
  }
  // 例文の注記（AI 作例／この回の別の場面）。持っている時だけ送り、消す時だけ null（送らない＝据え置き）。
  //   AI 作例は sentence 列には入れない＝字幕の出所表示（字幕：OpenSubtitles）が付かない。列が無い DB では外して再送
  //   ＝AI 作例はその端末だけに残る（同期は壊れない）。
  if (!_exampleNoteUnsupported) {
    const note = normalizeExampleNote(w.exampleNote);
    if (note) row.example_note = note;
    else if (w._clearExampleNote) row.example_note = null;
  }
  if (w.dramaTitle) {
    // 場面座標（作品・S/E・📍時刻）は一組で送る（拡張 background.js と同じ規則）。
    // ts_sec も同組に入れる＝作品が変わって場面座標が消えた再保存で、古い時刻だけが
    // residue として残るのを防ぐ。
    row.drama_title = w.dramaTitle;
    row.season = w.season ?? null;
    row.episode = w.episode ?? null;
    if (!_tsSecUnsupported) row.ts_sec = w.tsSec ?? null;
  }
  const res = await sbFetch('/rest/v1/my_words', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row]),
  });
  // ts_sec 列がまだ無いDB（supabase_my_words_tssec.sql 未実行）では PostgREST が
  // PGRST204 を返して行ごと保存されない。列を外して1回だけ再送し、以後は送らない
  // （＝migration 前後どちらの順でデプロイしても単語の同期自体は壊れない）。
  // 列が足りない時は1列ずつ外して再送する（最大4回＝liked / in_wordbook / ts_sec / example_note）。
  let cur = res;
  for (let i = 0; i < 4; i++) {
    let retry = false;
    if (isMissingLiked(cur) && 'liked' in row) {
      _likedUnsupported = true;
      delete row.liked;
      delete row.liked_at;
      retry = true;
    } else if (isMissingInWordbook(cur) && 'in_wordbook' in row) {
      _inWordbookUnsupported = true;
      delete row.in_wordbook;
      retry = true;
    } else if (isMissingTsSec(cur) && 'ts_sec' in row) {
      _tsSecUnsupported = true;
      delete row.ts_sec;
      retry = true;
    } else if (isMissingExampleNote(cur) && 'example_note' in row) {
      _exampleNoteUnsupported = true;
      delete row.example_note;
      retry = true;
    }
    if (!retry) break;
    cur = await sbFetch('/rest/v1/my_words', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([row]),
    });
  }
  return true;
}

// 単語帳の旗だけを複数語まとめてクラウドへ（初回の整理「★の語だけにする」・2026-11-07）。
//   既にある行だけを PATCH で書き換える（行は作らない）。語は端末の綴りそのまま（大文字小文字を変えない）を渡すこと。
//   ⚠ 以前は upsert（POST＋merge-duplicates）で、小文字にした語を送っていた → (user_id, word) は大文字小文字を区別するため
//   大文字を含む語で「小文字の空の行」が新しくでき、取り込み後に今保存された語に見えていた（2026-11-10・⑤の連絡）。
//   100 語ずつ（URL の長さ）。列が無い DB（PGRST204）は黙って諦める。
export async function pushWordbookFlags(wordTexts, inWordbook) {
  if (!(await ensureSessionForSync())) return false;
  const uid = getCurrentUser()?.id;
  if (!uid || !Array.isArray(wordTexts) || !wordTexts.length) return false;
  for (let i = 0; i < wordTexts.length; i += 100) {
    const filter = pgrstInFilter(wordTexts.slice(i, i + 100));
    const res = await sbFetch(`/rest/v1/my_words?user_id=eq.${uid}&word=${encodeURIComponent(filter)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ in_wordbook: !!inWordbook }),
    });
    if (isMissingInWordbook(res)) return false;
  }
  return true;
}

// 単語の削除をクラウドへ伝搬（🗑削除ボタン用）。ローカル削除だけだと、pull がクラウド全量で
// cl_my_words を上書き→getActiveWords の「再保存された語は削除リストから外す」掃除が発動し、
// 削除した語（タイポ等）が必ず復活する。ユーザーの明示削除は行ごと消すのが正。
export async function deleteMyWordCloud(word) {
  if (!(await ensureSessionForSync())) return false;
  const uid = getCurrentUser()?.id;
  if (!uid || !word) return false;
  // ilike（ワイルドカード無し＝大小無視の完全一致）: PK は case-sensitive のため、
  // 保存経路のケース違い（"Objection"/"objection"）で行が並存しても全部消す。
  await sbFetch(
    `/rest/v1/my_words?user_id=eq.${uid}&word=ilike.${encodeURIComponent(word)}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
  );
  return true;
}

// プロフィール一覧をクラウドへ upsert（pid のデバイス跨ぎ安定化）。
// updatedAt にはローカル保存時の時刻（cl_profiles_updated_at と同値）を渡す。
// pull 側が同じ時刻軸で「新しい方が勝つ」比較をするため、push 時に時刻を作り直さない。
export async function pushProfiles(profiles, updatedAt = null) {
  if (!(await ensureSessionForSync())) return;
  const uid = getCurrentUser()?.id;
  if (!uid || !Array.isArray(profiles) || !profiles.length) return;
  await sbFetch('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(
      profiles.map((p) => ({
        id: p.id,
        user_id: uid,
        name: p.name,
        color: p.color,
        settings: p.settings || {},
        updated_at: updatedAt || new Date().toISOString(),
      }))
    ),
  });
}

// プロフィール削除をクラウドへ反映（upsert だけだと次回 pull で復活してしまう）。
export async function deleteProfileRow(id) {
  if (!id || !(await ensureSessionForSync())) return;
  const uid = getCurrentUser()?.id;
  if (!uid) return;
  await sbFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

// ── 登録・ログイン直後の引き継ぎ（初回体験 A・2026-11-05 docs/design-first-run-trial-2026-11-05.md）──
// pullFromCloud は history をクラウドに行がある時だけ上書きし、ローカルの履歴は送らない。profiles もクラウドに
// 行がある時だけマージして差分を送る。＝新規アカウントでは、登録前に端末で作った単語リストの履歴とプロフィール
// （レベル・マイリスト）がクラウドに乗らず、別の端末や再ログインで消える。
// そこで AuthModal のログイン／登録成功時に pullFromCloud の**前**に1回呼ぶ（体験で端末に書いた分を先に乗せる）:
//   * クラウドの history が0件の時だけ、ローカルの history（最大50件・drama/season/episode が揃う行だけ）を送る。
//     既存アカウントへの再ログインで無条件に送ると、他端末で消した履歴が復活し得るため「0件の時だけ」。
//   * クラウドの profiles が0件の時だけ、ローカルの profiles を一度送る（更新時刻はローカルの値）。
// 冪等（クラウドに行ができた後は何もしない）。失敗は握りつぶす（学習体験を壊さない）。
export async function migrateLocalToCloudAfterLogin() {
  if (!isLoggedIn()) return { history: 0, profiles: 0 };
  const uid = getCurrentUser()?.id;
  if (!uid) return { history: 0, profiles: 0 };
  const out = { history: 0, profiles: 0 };
  const read = (key, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v ?? fallback;
    } catch {
      return fallback;
    }
  };
  try {
    const cloudHistory = await sbFetch(`/rest/v1/history?user_id=eq.${uid}&select=id&limit=1`);
    if (Array.isArray(cloudHistory) && cloudHistory.length === 0) {
      const local = read('cl_history', []);
      const rows = (Array.isArray(local) ? local : [])
        .filter((h) => h && h.id && h.drama && h.drama.title && h.season != null && h.episode != null)
        .slice(0, 50);
      for (const h of rows) {
        // eslint-disable-next-line no-await-in-loop
        await pushHistoryEntry(h);
        out.history++;
      }
    }
  } catch {
    /* 次のログインで（まだ0件なら）やり直す */
  }
  try {
    const cloudProfiles = await sbFetch(`/rest/v1/profiles?user_id=eq.${uid}&select=id&limit=1`);
    if (Array.isArray(cloudProfiles) && cloudProfiles.length === 0) {
      const local = read('cl_profiles', []);
      if (Array.isArray(local) && local.length) {
        await pushProfiles(local, localStorage.getItem(PROFILES_AT_KEY) || undefined);
        out.profiles = local.length;
      }
    }
  } catch {
    /* 同上 */
  }
  return out;
}

// ── history のみ双方向（★書き込み★）─────────────────────────────
// 学習履歴の作成/更新をクラウド history テーブルへ upsert（主キー id で衝突解決）。
// ログイン時のみ・fire-and-forget（失敗は握りつぶす＝学習体験を壊さない）。
// drama/season/episode は schema 上 NOT NULL なので、必ず「完全なエントリ」を渡すこと
// （部分更新を merge-duplicates で送ると NOT NULL を壊す）。
export async function pushHistoryEntry(entry) {
  if (!entry?.id || !(await ensureSessionForSync())) return;
  const uid = getCurrentUser()?.id;
  if (!uid) return;
  await sbFetch('/rest/v1/history', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      {
        id: entry.id,
        user_id: uid,
        drama: entry.drama,
        season: entry.season,
        episode: entry.episode,
        level: entry.level ?? null,
        target_level: entry.targetLevel ?? null,
        words: entry.words || [],
        quiz: entry.quiz || [],
        quiz_score: entry.quizScore ?? null,
        quiz_date: entry.quizDate ?? null,
        date: entry.date ?? null,
        updated_at: new Date().toISOString(),
      },
    ]),
  });
}

// 履歴エントリをクラウドから削除（自分の行のみ）。ログイン時のみ。
// 採点取り消しで「新規語の初採点」を戻す時だけ使う（行が無かった状態に戻す）。
// pushSrsWords は upsert のみで削除できないため専用に用意。GRANT DELETE は supabase_user_state.sql 済み。
export async function deleteSrsWord(word) {
  if (!word || !(await ensureSessionForSync())) return;
  const uid = getCurrentUser()?.id;
  if (!uid) return;
  await sbFetch(`/rest/v1/srs_data?user_id=eq.${uid}&word=eq.${encodeURIComponent(word)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

// 作品の単語リスト（履歴）をクラウドから作品名でまとめて削除（全エピソード一括削除用）。
// drama は JSONB なので drama->>title で絞る。端末に無いクラウド側の同作品行も消す＝次の pull で生き返らない。
export async function deleteHistoryRowsByTitle(title) {
  if (!title || !(await ensureSessionForSync())) return;
  const uid = getCurrentUser()?.id;
  if (!uid) return;
  await sbFetch(`/rest/v1/history?user_id=eq.${uid}&drama->>title=eq.${encodeURIComponent(title)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

export async function deleteHistoryRow(id) {
  if (!id || !(await ensureSessionForSync())) return;
  const uid = getCurrentUser()?.id;
  if (!uid) return;
  await sbFetch(`/rest/v1/history?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}
