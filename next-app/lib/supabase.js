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
// - my_words: pull のみ（書込は拡張が直接 Supabase へ）。
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

  // srs（語単位マージ: lastReview が新しい方を採用・同日/欠落はローカル優先）。
  // 丸ごと上書きにしないのは、この端末で育てたローカル SRS（lastQuality/reviewCount 等の
  // 拡張フィールド含む）を、古いクラウド行で吹き飛ばさないため。
  // マージ後、ローカル側が勝った/ローカルにしか無い語はクラウドへ吸い上げる
  // （初回ログイン時の移行と、オフライン期間の追いつきを兼ねる）。
  const srs = await sbFetch(`/rest/v1/srs_data?user_id=eq.${uid}&select=*&limit=5000`);
  if (Array.isArray(srs)) {
    let local = {};
    try {
      local = JSON.parse(localStorage.getItem('cl_srs') || '{}') || {};
    } catch {
      local = {};
    }
    const merged = { ...local };
    const cloudByWord = {};
    srs.forEach((e) => {
      cloudByWord[e.word] = e;
      const cloudEntry = {
        interval: e.interval,
        repetitions: e.repetitions,
        easeFactor: parseFloat(e.ease_factor),
        dueDate: e.due_date,
        lastReview: e.last_review,
        skipped: e.skipped,
      };
      const l = local[e.word];
      // クラウドの方が新しい復習日を持つ場合のみ採用（YYYY-MM-DD の文字列比較）。
      if (!l || (e.last_review || '') > (l.lastReview || '')) merged[e.word] = cloudEntry;
    });
    const pushBack = {};
    Object.entries(merged).forEach(([w, e]) => {
      const c = cloudByWord[w];
      if (!c || (e.lastReview || '') > (c.last_review || '') || !!e.skipped !== !!c.skipped) {
        pushBack[w] = e;
      }
    });
    localStorage.setItem('cl_srs', JSON.stringify(merged));
    if (Object.keys(pushBack).length) pushSrsWords(pushBack); // fire-and-forget
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

// ── 学習データ同期のヘルパ ──────────────────────────────────────

// 同期対象の localStorage キー（user_state 1行=1キー）。
const STATE_KEY_RE =
  /^(cl_tickets|cl_fav_dramas|cl_study_sec|cl_study_drama)(_|$)|^cl_prepped$|^cl_seat_counter$/;

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

// 半券の同一話キー（lib/tickets.js の epKey と同じ定義）。
const ticketEpKey = (t) => `${t.title}|${t.season}|${t.episode}`;
const MAX_TICKETS = 30; // lib/tickets.js と同値

// 種類別マージ。デバイスA/Bで別々に育ったデータを last-write-wins で潰さず統合する。
function mergeStateValue(key, localV, cloudV) {
  if (localV == null) return cloudV;
  if (cloudV == null) return localV;
  if (key.startsWith('cl_tickets')) {
    // 半券: 同一話は createdAt が新しい方・全体は古い順で上限 FIFO（tickets.js と同じ規律）
    const m = new Map();
    [...(Array.isArray(cloudV) ? cloudV : []), ...(Array.isArray(localV) ? localV : [])]
      .filter((t) => t && t.id)
      .forEach((t) => {
        const k = ticketEpKey(t);
        const prev = m.get(k);
        if (!prev || (t.createdAt || 0) >= (prev.createdAt || 0)) m.set(k, t);
      });
    const arr = [...m.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    while (arr.length > MAX_TICKETS) arr.shift();
    return arr;
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
  if (key.startsWith('cl_study_drama')) {
    const out = { ...(cloudV || {}) };
    Object.entries(localV || {}).forEach(([t, s]) => {
      out[t] = Math.max(Number(out[t]) || 0, Number(s) || 0);
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
export function queueStatePush(key, delayMs = 3000) {
  if (typeof window === 'undefined' || !isLoggedIn()) return;
  if (stateTimers[key]) return;
  stateTimers[key] = setTimeout(() => {
    delete stateTimers[key];
    const uid = getCurrentUser()?.id;
    const v = readStateLocal(key);
    if (!uid || v == null) return;
    sbFetch('/rest/v1/user_state', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_id: uid, key, value: v, updated_at: new Date().toISOString() }]),
    });
  }, delayMs);
}

// SRS を語単位でクラウドへ upsert（entries = { word: srsEntry }）。
// スキーマ列のみ送る（lastQuality/reviewCount 等の拡張フィールドはローカル専用）。
export async function pushSrsWords(entries) {
  if (!isLoggedIn()) return;
  const uid = getCurrentUser()?.id;
  if (!uid || !entries) return;
  const rows = Object.entries(entries)
    .filter(([, e]) => e)
    .map(([word, e]) => ({
      user_id: uid,
      word,
      interval: e.interval ?? 1,
      repetitions: e.repetitions ?? 0,
      ease_factor: e.easeFactor ?? 2.5,
      due_date: e.dueDate ?? null,
      last_review: e.lastReview ?? null,
      skipped: !!e.skipped,
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  await sbFetch('/rest/v1/srs_data', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

// プロフィール一覧をクラウドへ upsert（pid のデバイス跨ぎ安定化）。
export async function pushProfiles(profiles) {
  if (!isLoggedIn()) return;
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
        updated_at: new Date().toISOString(),
      }))
    ),
  });
}

// プロフィール削除をクラウドへ反映（upsert だけだと次回 pull で復活してしまう）。
export async function deleteProfileRow(id) {
  if (!isLoggedIn() || !id) return;
  const uid = getCurrentUser()?.id;
  if (!uid) return;
  await sbFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
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
