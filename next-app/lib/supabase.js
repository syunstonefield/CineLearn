// Supabase 連携。js/supabase.js から移植。
// 原則 pull（クラウド→localStorage）＋認証（サインイン/リフレッシュ）。
// 例外：学習履歴(history)のみ双方向にする（pushHistoryEntry / deleteHistoryRow）。
//   理由: pull は cl_history を丸ごと上書きするため、push が無いと端末での
//   削除/再生成が次回 pull で失われ、クラウドに残った破損行が復活してしまう
//   （別話の単語が表示されるバグ）。history 以外（profiles/srs/my_words）は
//   従来どおり読み取り専用のまま。
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

async function sbFetch(path, opts = {}) {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: sbHeaders(opts.headers || {}) });
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
export async function ensureFreshSession() {
  const s = getSession();
  if (!s?.access_token) return false;
  const now = Date.now() / 1000;
  if (s.expires_at && s.expires_at - now > 600) return true;
  if (!s.refresh_token) return false;
  const d = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (d?.access_token) {
    setSession(d);
    return true;
  }
  return false;
}

// クラウド → localStorage に取り込む（★読み取り専用★）。
// js/supabase.js の pullFromCloud を移植。DOM 更新は React 側に任せて削除。
// profileId を渡すと my_words をプロフィール別キーにも反映する（既存挙動）。
export async function pullFromCloud(profileId = null) {
  const uid = getCurrentUser()?.id;
  if (!uid) return;

  // profiles
  const profiles = await sbFetch(`/rest/v1/profiles?user_id=eq.${uid}&select=*`);
  if (Array.isArray(profiles) && profiles.length) {
    localStorage.setItem(
      'cl_profiles',
      JSON.stringify(profiles.map((p) => ({ id: p.id, name: p.name, color: p.color, settings: p.settings })))
    );
  }

  // history
  const history = await sbFetch(
    `/rest/v1/history?user_id=eq.${uid}&select=*&order=updated_at.desc&limit=50`
  );
  if (Array.isArray(history) && history.length) {
    localStorage.setItem(
      'cl_history',
      JSON.stringify(
        history.map((h) => ({
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
        }))
      )
    );
  }

  // srs
  const srs = await sbFetch(`/rest/v1/srs_data?user_id=eq.${uid}&select=*`);
  if (Array.isArray(srs) && srs.length) {
    const map = {};
    srs.forEach((e) => {
      map[e.word] = {
        interval: e.interval,
        repetitions: e.repetitions,
        easeFactor: parseFloat(e.ease_factor),
        dueDate: e.due_date,
        lastReview: e.last_review,
        skipped: e.skipped,
      };
    });
    localStorage.setItem('cl_srs', JSON.stringify(map));
  }

  // my_words（グローバルキーに保存。プロフィール別キーは選択時にコピーする）
  const words = await sbFetch(
    `/rest/v1/my_words?user_id=eq.${uid}&select=*&order=created_at.desc&limit=2000`
  );
  if (Array.isArray(words)) {
    const wordsList = JSON.stringify(
      words.map((w) => ({
        word: w.word,
        sentence: w.sentence,
        phonetic: w.phonetic,
        pos: w.pos,
        definition: w.definition,
        savedAt: w.saved_at,
        source: w.source,
        dramaTitle: w.drama_title,
        season: w.season,
        episode: w.episode,
      }))
    );
    localStorage.setItem('cl_my_words', wordsList);
    // 選択中プロフィールがあればプロフィール別キーにも反映
    // （拡張機能で増えた単語をフォーカス時の再取得で単語帳に出すため）
    if (profileId) localStorage.setItem(`cl_my_words_${profileId}`, wordsList);
  }
}

// ── history のみ双方向（★書き込み★）─────────────────────────────
// 学習履歴の作成/更新をクラウド history テーブルへ upsert（主キー id で衝突解決）。
// ログイン時のみ・fire-and-forget（失敗は握りつぶす＝学習体験を壊さない）。
// drama/season/episode は schema 上 NOT NULL なので、必ず「完全なエントリ」を渡すこと
// （部分更新を merge-duplicates で送ると NOT NULL を壊す）。
export async function pushHistoryEntry(entry) {
  if (!isLoggedIn() || !entry?.id) return;
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
export async function deleteHistoryRow(id) {
  if (!isLoggedIn() || !id) return;
  const uid = getCurrentUser()?.id;
  if (!uid) return;
  await sbFetch(`/rest/v1/history?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}
