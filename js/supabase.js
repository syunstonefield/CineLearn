'use strict';
/**
 * CineLearn — Supabase 同期レイヤー
 *
 * 役割:
 *   1. ユーザー認証（サインアップ / ログイン / ログアウト）
 *   2. localStorage のデータを Supabase にバックグラウンド同期
 *   3. 起動時に最新データをクラウドから引き下ろす
 *
 * 設定: SUPABASE_URL と SUPABASE_ANON_KEY を書き換えてください
 * → https://app.supabase.com > Settings > API
 */

// ─── プロジェクト設定 ─────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://mndyexwdevkpdssglwpl.supabase.co'; // 例: https://abcxyz.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4'; // 例: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

const SB_SESSION_KEY = 'cl_sb_session';

// Supabase が設定されているか
function sbEnabled() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }

// ─── セッション ────────────────────────────────────────────────────────────────
function getSession()    { try { return JSON.parse(localStorage.getItem(SB_SESSION_KEY)); } catch { return null; } }
function setSession(d) {
  localStorage.setItem(SB_SESSION_KEY, JSON.stringify(d));
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ [SB_SESSION_KEY]: d });
  }
}
function clearSession() {
  localStorage.removeItem(SB_SESSION_KEY);
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.remove(SB_SESSION_KEY);
  }
}
function getCurrentUser(){ return getSession()?.user || null; }
function isLoggedIn() {
  const s = getSession();
  if (!s?.access_token) return false;
  if (s.expires_at && Date.now() / 1000 > s.expires_at - 60) return false;
  return true;
}

// ─── HTTP ──────────────────────────────────────────────────────────────────────
function sbHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, ...extra };
  const s = getSession();
  if (s?.access_token) h['Authorization'] = `Bearer ${s.access_token}`;
  return h;
}

async function sbFetch(path, opts = {}) {
  if (!sbEnabled()) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: sbHeaders(opts.headers || {}) });
    if (res.status === 204 || res.status === 201) return null;
    return await res.json();
  } catch { return null; }
}

// ─── 認証 ─────────────────────────────────────────────────────────────────────
async function supaSignUp(email, password) {
  const d = await sbFetch('/auth/v1/signup', {
    method: 'POST', body: JSON.stringify({ email, password })
  });
  if (d?.access_token) setSession(d);
  return d;
}

async function supaSignIn(email, password) {
  const d = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email, password })
  });
  if (d?.access_token) setSession(d);
  return d;
}

async function supaSignOut() {
  await sbFetch('/auth/v1/logout', { method: 'POST' });
  clearSession();
}

async function supaRefreshSession() {
  const s = getSession();
  if (!s?.refresh_token) return;
  const d = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token })
  });
  if (d?.access_token) setSession(d);
}

// ─── クラウド同期（バックグラウンド・エラーは無視） ───────────────────────────
const cloudSync = {

  async profiles(profiles) {
    const uid = getCurrentUser()?.id;
    if (!uid || !profiles?.length) return;
    await sbFetch('/rest/v1/profiles', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(profiles.map(p => ({
        id: p.id, user_id: uid, name: p.name, color: p.color,
        settings: p.settings || {}, updated_at: new Date().toISOString()
      })))
    });
  },

  async history(history) {
    const uid = getCurrentUser()?.id;
    if (!uid || !history?.length) return;
    await sbFetch('/rest/v1/history', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(history.map(h => ({
        id: h.id, user_id: uid, drama: h.drama,
        season: h.season, episode: h.episode, level: h.level,
        target_level: h.targetLevel, words: h.words || [],
        quiz: h.quiz || [], quiz_score: h.quizScore,
        quiz_date: h.quizDate, date: h.date,
        updated_at: new Date().toISOString()
      })))
    });
  },

  async srs(srsData) {
    const uid = getCurrentUser()?.id;
    if (!uid || !srsData) return;
    const rows = Object.entries(srsData).map(([word, e]) => ({
      user_id: uid, word,
      interval: e.interval, repetitions: e.repetitions,
      ease_factor: e.easeFactor, due_date: e.dueDate,
      last_review: e.lastReview, skipped: e.skipped || false,
      updated_at: new Date().toISOString()
    }));
    if (!rows.length) return;
    await sbFetch('/rest/v1/srs_data', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(rows)
    });
  },

  // 1件削除
  async deleteWord(wordText) {
    const uid = getCurrentUser()?.id;
    if (!uid) return;
    await sbFetch(
      `/rest/v1/my_words?user_id=eq.${uid}&word=eq.${encodeURIComponent(wordText)}`,
      { method: 'DELETE' }
    );
  },

  // 全件削除
  async clearWords() {
    const uid = getCurrentUser()?.id;
    if (!uid) return;
    await sbFetch(`/rest/v1/my_words?user_id=eq.${uid}`, { method: 'DELETE' });
  },

  async myWords(words) {
    const uid = getCurrentUser()?.id;
    if (!uid) return;
    // 全削除してから現在のリストを挿入（置き換え戦略）
    // → 削除した単語が Supabase に残らないことを保証する
    await sbFetch(`/rest/v1/my_words?user_id=eq.${uid}`, { method: 'DELETE' });
    if (!words?.length) return;
    await sbFetch('/rest/v1/my_words', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(words.map(w => ({
        user_id: uid, word: w.word, sentence: w.sentence,
        phonetic: w.phonetic, pos: w.pos, definition: w.definition,
        saved_at: w.savedAt, source: w.source,
        drama_title: w.dramaTitle, season: w.season, episode: w.episode
      })))
    });
  }
};

// ─── 起動時プル ──────────────────────────────────────────────────────────────
async function pullFromCloud() {
  const uid = getCurrentUser()?.id;
  if (!uid) return;

  // profiles
  const profiles = await sbFetch(`/rest/v1/profiles?user_id=eq.${uid}&select=*`);
  if (Array.isArray(profiles) && profiles.length) {
    localStorage.setItem('cl_profiles', JSON.stringify(
      profiles.map(p => ({ id: p.id, name: p.name, color: p.color, settings: p.settings }))
    ));
  }

  // history
  const history = await sbFetch(
    `/rest/v1/history?user_id=eq.${uid}&select=*&order=updated_at.desc&limit=50`
  );
  if (Array.isArray(history) && history.length) {
    localStorage.setItem('cl_history', JSON.stringify(
      history.map(h => ({
        id: h.id, date: h.date, drama: h.drama,
        season: h.season, episode: h.episode, level: h.level,
        targetLevel: h.target_level, words: h.words, quiz: h.quiz,
        quizScore: h.quiz_score, quizDate: h.quiz_date
      }))
    ));
  }

  // srs
  const srs = await sbFetch(`/rest/v1/srs_data?user_id=eq.${uid}&select=*`);
  if (Array.isArray(srs) && srs.length) {
    const map = {};
    srs.forEach(e => {
      map[e.word] = {
        interval: e.interval, repetitions: e.repetitions,
        easeFactor: parseFloat(e.ease_factor),
        dueDate: e.due_date, lastReview: e.last_review, skipped: e.skipped
      };
    });
    localStorage.setItem('cl_srs', JSON.stringify(map));
  }

  // my_words（空配列でも必ず更新してローカルの削除済み単語を消す）
  const words = await sbFetch(
    `/rest/v1/my_words?user_id=eq.${uid}&select=*&order=created_at.desc&limit=500`
  );
  if (Array.isArray(words)) {
    const wordsList = JSON.stringify(
      words.map(w => ({
        word: w.word, sentence: w.sentence, phonetic: w.phonetic,
        pos: w.pos, definition: w.definition, savedAt: w.saved_at,
        source: w.source, dramaTitle: w.drama_title,
        season: w.season, episode: w.episode
      }))
    );
    const profileId = window._clProfileId || null;
    const profileKey = profileId ? `cl_my_words_${profileId}` : null;
    const parsed     = JSON.parse(wordsList);

    // localStorage に保存（モバイル・Netlify 版）
    localStorage.setItem('cl_my_words', wordsList);
    if (profileKey) localStorage.setItem(profileKey, wordsList);

    // chrome.storage.local にも保存（拡張機能版デスクトップ）
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = { 'cl_my_words': parsed };
      if (profileKey) data[profileKey] = parsed;
      chrome.storage.local.set(data);
    }

    // badge・単語帳を更新
    if (typeof updateWordbookBadge === 'function') updateWordbookBadge();
    if (typeof renderWordbook === 'function') {
      const modal = document.getElementById('wordbookModal');
      if (modal?.style.display === 'flex') renderWordbook();
    }
  }
}

// ─── 初回ログイン時：ローカルデータを Supabase に一括アップロード ─────────────
async function pushLocalToCloud() {
  try {
    const profiles = JSON.parse(localStorage.getItem('cl_profiles') || '[]');
    const history  = JSON.parse(localStorage.getItem('cl_history')  || '[]');
    const srs      = JSON.parse(localStorage.getItem('cl_srs')      || '{}');
    const myWords  = JSON.parse(localStorage.getItem('cl_my_words') || '[]');

    if (profiles.length)            await cloudSync.profiles(profiles);
    if (history.length)             await cloudSync.history(history);
    if (Object.keys(srs).length)    await cloudSync.srs(srs);
    if (myWords.length)             await cloudSync.myWords(myWords);
  } catch (e) {
    console.warn('[CineLearn] pushLocalToCloud error:', e);
  }
}

// ─── 認証モーダル UI ──────────────────────────────────────────────────────────
function showAuthModal() {
  const el = document.getElementById('authModal');
  if (el) el.style.display = 'flex';
}

function hideAuthModal() {
  const el = document.getElementById('authModal');
  if (el) el.style.display = 'none';
}

function initAuthModal() {
  const modal     = document.getElementById('authModal');
  const emailEl   = document.getElementById('authEmail');
  const passEl    = document.getElementById('authPassword');
  const submitBtn = document.getElementById('btnAuthSubmit');
  const errorEl   = document.getElementById('authError');
  const skipBtn   = document.getElementById('btnAuthSkip');
  const tabLogin  = document.getElementById('tabLogin');
  const tabSignup = document.getElementById('tabSignup');
  if (!modal) return;

  let mode = 'login'; // 'login' | 'signup'

  function setMode(m) {
    mode = m;
    tabLogin.classList.toggle('active', m === 'login');
    tabSignup.classList.toggle('active', m === 'signup');
    submitBtn.textContent = m === 'login' ? 'ログイン' : 'アカウントを作成';
    errorEl.style.display = 'none';
  }

  tabLogin.addEventListener('click',  () => setMode('login'));
  tabSignup.addEventListener('click', () => setMode('signup'));

  submitBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    const pass  = passEl.value;
    if (!email || !pass) { showError('メールアドレスとパスワードを入力してください'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = '処理中...';
    errorEl.style.display = 'none';

    const result = mode === 'login'
      ? await supaSignIn(email, pass)
      : await supaSignUp(email, pass);

    submitBtn.disabled = false;
    submitBtn.textContent = mode === 'login' ? 'ログイン' : 'アカウントを作成';

    if (result?.access_token) {
      hideAuthModal();
      // クラウドから最新データを取得（他デバイスで使用済みの場合）
      await pullFromCloud();
      // ローカルに既存データがあれば Supabase に初回アップロード
      await pushLocalToCloud();
      if (typeof renderProfileScreen === 'function') renderProfileScreen();
    } else {
      const msg = result?.error_description || result?.msg || 'エラーが発生しました';
      showError(msg);
    }
  });

  // Enter キーでログイン
  [emailEl, passEl].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
  });

  // スキップ（ローカルのみ）
  skipBtn.addEventListener('click', () => {
    hideAuthModal();
    if (typeof renderProfileScreen === 'function') renderProfileScreen();
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }

  // ヘッダーのログアウトボタン
  const signOutBtn = document.getElementById('btnSignOut');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await supaSignOut();
      clearSession();
      localStorage.removeItem('cl_profiles');
      localStorage.removeItem('cl_history');
      localStorage.removeItem('cl_srs');
      localStorage.removeItem('cl_my_words');
      location.reload();
    });
  }
}

// ─── 初期化エントリーポイント ─────────────────────────────────────────────────
async function initSupabase() {
  if (!sbEnabled()) return; // URL/KEY 未設定ならスキップ

  initAuthModal();

  if (!isLoggedIn()) {
    showAuthModal();
    return;
  }

  // セッション更新（バックグラウンド）
  supaRefreshSession().catch(() => {});

  // クラウドから最新データを引き下ろして localStorage を更新
  await pullFromCloud();
}
