// 状態管理
let selectedServices = [];
let selectedGenres = ['Crime Thriller'];
let selectedDrama = null;
let myDramas = []; // 追加したドラマの永続リスト
let selectedSeason = 1;
let selectedEpisode = 1;
let quizData = [];
let currentQ = 0;
let score = 0;
let answered = false;
let userLevel = 'B1';
let toeicScore = 0;
let targetToeicScore = 0; // 目標TOEICスコア（未入力時は0）
let targetLevel = 'B1';   // 目標レベル
let vocabCount = 30;      // 生成する単語数（目標スコアから自動計算）
let vocabWords = [];
let dramaSeasonInfo = [];
let selectedViewingService = null; // 今回視聴するサービス
// テストに含める単語階層（core / advanced / context）
let testTiers = ['core', 'advanced'];

// 履歴管理
const HISTORY_KEY = 'cl_history';
// 現在操作中の履歴エントリID（保存・スコア更新に使う）
let currentHistoryId = null;

// HTMLエスケープ（XSS対策）。innerHTML に外部・AI・ユーザー由来のテキストを
// 埋め込む箇所は必ずこれを通す（字幕やドラマ名にHTMLが混ざっても無害化する）。
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ─────────────────────────────────────────
// SRS（間隔反復システム）
// ─────────────────────────────────────────
const SRS_KEY = 'cl_srs';

function loadSrs()  { try { return JSON.parse(localStorage.getItem(SRS_KEY) || '{}'); } catch { return {}; } }
function saveSrs(d) {
  localStorage.setItem(SRS_KEY, JSON.stringify(d));
  if (typeof cloudSync !== 'undefined' && isLoggedIn()) cloudSync.srs(d);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── 日付形式の統一 ──────────────────────────────────────────
// 保存は常に ISO（YYYY-MM-DD）、表示時だけ日本語形式に変換する。
// 過去データには ja-JP 形式（2026/6/11）が混在するため、両形式を扱う。

// どちらの形式でも ISO に正規化する（不明な形式はそのまま返す）
function toIsoDate(s) {
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // 既にISO
  const m = String(s).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); // 旧 ja-JP形式
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}
// 表示用：ISO → 2026/6/11（タイムゾーンに依存しないよう文字列で組み立てる）
function formatDateJa(s) {
  const iso = toIsoDate(s);
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || '';
  return `${m[1]}/${parseInt(m[2])}/${parseInt(m[3])}`;
}

// 2段階の習得システム
//   レベル1「覚えた」(isLearned)  : 2回以上成功（早期の達成感）
//   レベル2「マスター」(isMastered): 3回以上 + 間隔21日 + 易しさ2.0（長期定着）
function isMastered(e)  { return !!e && !e.skipped && e.repetitions >= 3 && e.interval >= 21 && e.easeFactor >= 2.0; }
function isLearned(e)   { return !!e && !e.skipped && e.repetitions >= 2; } // マスターも包含
function isDue(e)       { if (!e || e.skipped || isMastered(e)) return false; return !e.dueDate || e.dueDate <= todayStr(); }

// srs はループ内で繰り返し呼ぶ場合に loadSrs() の結果を渡す（毎回のJSON.parseを避ける）
function getWordStatus(word, srs = loadSrs()) {
  const e = srs[word.toLowerCase()];
  if (!e)                              return 'new';        // 🌱 未学習
  if (e.skipped)                       return 'skipped';
  if (isMastered(e))                   return 'mastered';   // ⭐ マスター
  if (isLearned(e))                    return 'learned';    // ✅ 覚えた
  if (isDue(e))                        return 'due';        // 🔄 学習中（要復習）
  if (e.lastReview === todayStr())     return 'reviewed_today';
  return 'scheduled';                                       // 🔄 学習中（予定）
}

// ステータスバッジ（優先順位: ⭐マスター > ✅覚えた > 🔄学習中 > 🌱未学習）
function statusBadgeHTML(status) {
  switch (status) {
    case 'mastered': return '<span class="srs-badge badge-mastered">⭐ マスター</span>';
    case 'learned':  return '<span class="srs-badge badge-learned">✅ 覚えた</span>';
    case 'skipped':  return ''; // スキップは vocab-skipped クラスで表現
    case 'new':      return '<span class="srs-badge badge-new">🌱 未学習</span>';
    default:         return '<span class="srs-badge badge-learning">🔄 学習中</span>'; // due/scheduled/reviewed_today
  }
}

// 次回復習日を人間が読みやすい文字列で返す
function nextReviewLabel(word, srs = loadSrs()) {
  const e = srs[word.toLowerCase()];
  if (!e || !e.dueDate || e.skipped || isMastered(e)) return null;
  const diff = Math.round(
    (new Date(e.dueDate) - new Date(todayStr())) / (1000 * 60 * 60 * 24)
  );
  if (diff <= 0) return null; // 今日以前 → 🔴 で示す
  if (diff === 1) return '明日';
  if (diff < 7)  return `${diff}日後`;
  const d = new Date(e.dueDate);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function skipWord(word) {
  const all = loadSrs(), k = word.toLowerCase();
  all[k] = { interval: 1, repetitions: 0, easeFactor: 2.5, ...(all[k] || {}), skipped: true };
  saveSrs(all);
}
function unskipWord(word) {
  const all = loadSrs(), k = word.toLowerCase();
  if (all[k]) { all[k].skipped = false; saveSrs(all); }
}

// SM-2アルゴリズム: quality 0=失敗, 3=うろ覚え, 5=完璧
function reviewWord(word, quality) {
  const all = loadSrs(), k = word.toLowerCase();
  let e = all[k] || { interval: 1, repetitions: 0, easeFactor: 2.5, skipped: false };

  // 同日ガード（Ankiのlearning steps相当）:
  // 間隔反復の核心は「時間を置いて思い出せたか」なので、同じ日の2回目以降の
  // 成功は「練習」扱いにし、スケジュール（repetitions/interval/dueDate）を
  // 進めない（数分前に見た答えを思い出せても長期記憶の証拠にならないため）。
  // 失敗（quality<3）は「忘れていた」事実として同日でも常に反映する。
  if (e.lastReview === todayStr() && quality >= 3) {
    e.lastQuality = quality;
    e.reviewCount = (e.reviewCount || 0) + 1;
    all[k] = e;
    saveSrs(all);
    return;
  }

  if (quality < 3) {
    e.repetitions = 0;
    e.interval    = 1;
  } else {
    if      (e.repetitions === 0) e.interval = 1;
    else if (e.repetitions === 1) e.interval = 6;
    else                          e.interval = Math.round(e.interval * e.easeFactor);
    e.easeFactor = Math.max(1.3, e.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    e.repetitions++;
  }
  const d = new Date(); d.setDate(d.getDate() + e.interval);
  e.dueDate      = d.toISOString().slice(0, 10);
  e.lastReview   = todayStr();
  e.lastQuality  = quality;
  e.reviewCount  = (e.reviewCount || 0) + 1;
  all[k] = e;
  saveSrs(all);
}

function episodeStats(words) {
  const srs = loadSrs();
  let mastered = 0, learned = 0, due = 0, skipped = 0, reviewedToday = 0;
  (words || []).forEach(w => {
    const e = srs[w.word.toLowerCase()];
    if (isMastered(e)) mastered++;   // マスターは「覚えた」も兼ねる
    if (isLearned(e))  learned++;    // ← マスター済みも learned に含む
    if (e?.skipped)    skipped++;
    // 復習対象（未学習 or 期日到来）。startReview と同基準。
    if (!e || isDue(e))                   due++;
    else if (e.lastReview === todayStr()) reviewedToday++;
  });
  return { total: (words || []).length, mastered, learned, due, skipped, reviewedToday };
}

// ─────────────────────────────────────────
// ダッシュボード（今日の復習・ストリーク・週次）
// ─────────────────────────────────────────
const ACTIVITY_KEY      = 'cl_activity_dates';
const DAILY_REVIEW_CAP  = 20; // 1日の復習はこの数までに抑える（負担を減らす）

function loadActivityDates() {
  try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]'); } catch { return []; }
}
// 今日を「学習した日」として記録（復習完了・単語生成時に呼ぶ）
function markActivityToday() {
  const arr = loadActivityDates();
  const d = todayStr();
  if (!arr.includes(d)) { arr.push(d); localStorage.setItem(ACTIVITY_KEY, JSON.stringify(arr)); }
}
// 既存ユーザー向け：復習ログの日付を活動日に取り込む（初回のみ）
function backfillActivityDates() {
  const set = new Set(loadActivityDates());
  let changed = false;
  loadReviewLog().forEach(s => { if (s.date && !set.has(s.date)) { set.add(s.date); changed = true; } });
  if (changed) localStorage.setItem(ACTIVITY_KEY, JSON.stringify([...set]));
}
// 連続学習日数（今日 or 昨日を起点に遡る。今日未実施でも昨日まで連続なら維持）
function getStreak() {
  const set = new Set(loadActivityDates());
  if (!set.size) return 0;
  const iso = x => x.toISOString().slice(0, 10);
  let d = new Date();
  if (!set.has(iso(d))) {
    d.setDate(d.getDate() - 1);
    if (!set.has(iso(d))) return 0; // 昨日も無ければ途切れ
  }
  let n = 0;
  while (set.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// 全履歴の単語を重複排除して集約
function getAllVocabWords() {
  const map = new Map();
  loadHistory().forEach(h => (h.words || []).forEach(w => {
    const k = w.word?.toLowerCase();
    if (k && !map.has(k)) map.set(k, w);
  }));
  return [...map.values()];
}
// 今日復習すべき単語（startReview と同基準：未学習 or 期日到来）。
// 期日到来(scheduled)を未学習(new)より優先して並べる。
function getDueReviewWords() {
  const srs = loadSrs();
  const eligible = getAllVocabWords().filter(w => {
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
function getWeekStats() {
  const srs = loadSrs();
  const wa = new Date(); wa.setDate(wa.getDate() - 6);
  const wk = wa.toISOString().slice(0, 10);
  let reviewedThisWeek = 0, mastered = 0;
  Object.values(srs).forEach(e => {
    if (e?.lastReview && e.lastReview >= wk) reviewedThisWeek++;
    if (isMastered(e)) mastered++;
  });
  return { reviewedThisWeek, mastered };
}

// 横断復習（特定エピソードに紐づかない）を開始
function startGlobalReview(words) {
  currentHistoryId = null;
  startReview(words);
}

// ダッシュボード上部の「今日パネル」を描画
function renderTodayPanel() {
  const el = document.getElementById('todayPanel');
  if (!el) return;

  const streak     = getStreak();
  const hasAnyWord = getAllVocabWords().length > 0;
  const due        = getDueReviewWords();
  const todayCount = Math.min(due.length, DAILY_REVIEW_CAP);
  const { reviewedThisWeek, mastered } = getWeekStats();

  const streakHTML = streak > 0
    ? `<div class="today-streak">🔥 <b>${streak}</b>日連続</div>`
    : `<div class="today-streak today-streak-zero">今日から連続記録をはじめよう</div>`;

  let reviewHTML;
  if (!hasAnyWord) {
    // まだ単語が無い新規ユーザー → 予習へ誘導
    reviewHTML = `<div class="today-review-card done-review">
         <div class="today-review-title">👋 さっそく始めよう</div>
         <div class="today-review-sub">ドラマのエピソードを選んで単語を予習しましょう</div>
       </div>`;
  } else if (todayCount > 0) {
    reviewHTML = `<div class="today-review-card has-review">
         <div class="today-review-title">📖 今日の復習 <b>${todayCount}</b>単語</div>
         <button class="btn-today-review" id="btnTodayReview">復習をはじめる →</button>
       </div>`;
  } else {
    reviewHTML = `<div class="today-review-card done-review">
         <div class="today-review-title">✅ 今日の復習は完了！</div>
         <div class="today-review-sub">新しいエピソードを予習してみましょう</div>
       </div>`;
  }

  // 統計は単語がある場合のみ表示
  const statsHTML = hasAnyWord
    ? `<div class="today-stats">今週 <b>${reviewedThisWeek}</b>単語復習 · 習得 <b>${mastered}</b>語</div>`
    : '';

  el.innerHTML = streakHTML + reviewHTML + statsHTML;

  const btn = document.getElementById('btnTodayReview');
  if (btn) btn.addEventListener('click', () => startGlobalReview(due.slice(0, DAILY_REVIEW_CAP)));
}

function buildProgressHTML(words) {
  const { total, mastered, learned, due, skipped, reviewedToday } = episodeStats(words);
  // 進捗バーは「覚えた」ベース（達成感を早く出すため）
  const pct = total === 0 ? 0 : Math.round(learned / total * 100);
  const barColor = pct === 100 ? '#f5c518'
    : pct > 60  ? '#4fc3f7'
    : pct > 30  ? 'var(--accent)'
    : 'var(--text-muted)';
  const epLabel = selectedDrama
    ? `${selectedDrama.title} S${selectedSeason}E${selectedEpisode} の単語リスト`
    : '単語リスト';
  const completeMsg = (total > 0 && learned === total)
    ? (mastered === total
        ? '<div class="srs-complete">🌟 全単語マスター達成！</div>'
        : '<div class="srs-complete">✨ 全単語「覚えた」達成！</div>')
    : '';
  const reviewedPart = reviewedToday > 0 ? ` / 今日復習済み：${reviewedToday}単語` : '';
  return `
    <div class="srs-progress-wrap">
      <div class="srs-progress-header">
        <span class="srs-ep-label">${epLabel}</span>
        <span class="srs-pct" style="color:${barColor}">${pct}% 覚えた</span>
      </div>
      <div class="srs-bar"><div class="srs-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="srs-counts">
        <span class="srs-count-learned">✅ 覚えた: <b>${learned}</b>/${total}</span>
        <span class="srs-count-mastered">⭐ マスター: <b>${mastered}</b>/${total}</span>
      </div>
      <div class="srs-stats">復習対象：${due}単語 / スキップ：${skipped}単語${reviewedPart}</div>
      ${completeMsg}
    </div>
  `;
}

// ─────────────────────────────────────────
// プロフィール管理
// ─────────────────────────────────────────
const PROFILES_KEY = 'cl_profiles';
let currentProfileId = null;

const AVATAR_COLORS = [
  '#E50914','#1A73E8','#2E7D32','#7B1FA2',
  '#E65100','#00695C','#F57F17','#AD1457',
];

function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || []; }
  catch { return []; }
}
function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  if (typeof cloudSync !== 'undefined' && isLoggedIn()) cloudSync.profiles(profiles);
}

// 現在プロフィールに設定を保存する
function saveSettings() {
  if (!currentProfileId) return;
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === currentProfileId);
  if (idx < 0) return;
  profiles[idx].settings = {
    toeicScore, targetToeicScore, userLevel, targetLevel, vocabCount,
    selectedServices, selectedGenres, selectedDrama,
    selectedSeason, selectedEpisode, vocabWords, dramaSeasonInfo,
    testTiers, selectedViewingService, myDramas,
  };
  saveProfiles(profiles);
}

// プロフィールの設定を状態変数＋UIに適用する
async function applyProfileSettings(s) {
  // ── デフォルトにリセット ──
  toeicScore = 0; targetToeicScore = 0; userLevel = 'B1'; targetLevel = 'B1';
  vocabCount = 30; selectedServices = []; selectedGenres = ['Crime Thriller'];
  selectedDrama = null; selectedSeason = 1; selectedEpisode = 1;
  vocabWords = []; dramaSeasonInfo = []; testTiers = ['core', 'advanced'];
  myDramas = [];

  if (!s || !Object.keys(s).length) { goToStep(1); return; }

  // ── 状態変数を復元 ──
  if (s.toeicScore > 0)           toeicScore       = s.toeicScore;
  if (s.targetToeicScore > 0)     targetToeicScore = s.targetToeicScore;
  if (s.userLevel)                userLevel        = s.userLevel;
  if (s.targetLevel)              targetLevel      = s.targetLevel;
  if (s.vocabCount)               vocabCount       = s.vocabCount;
  if (s.selectedServices?.length) selectedServices = s.selectedServices;
  if (s.selectedGenres?.length)   selectedGenres   = s.selectedGenres;
  if (s.selectedDrama)            selectedDrama    = s.selectedDrama;
  if (s.selectedSeason)           selectedSeason   = s.selectedSeason;
  if (s.selectedEpisode)          selectedEpisode  = s.selectedEpisode;
  if (s.vocabWords?.length)       vocabWords       = s.vocabWords;
  if (s.dramaSeasonInfo?.length)  dramaSeasonInfo  = s.dramaSeasonInfo;
  if (s.testTiers?.length)        testTiers        = s.testTiers;
  if (s.selectedViewingService)   selectedViewingService = s.selectedViewingService;
  if (s.myDramas?.length)         myDramas         = s.myDramas;

  // ── UI復元：TOEICスコア ──
  if (s.toeicScore > 0) {
    document.getElementById('toeicScore').value = s.toeicScore;
    showLevelResult(s.userLevel);
  }
  // ── UI復元：目標スコア ──
  if (s.targetToeicScore > 0) {
    document.getElementById('targetScore').value = s.targetToeicScore;
    const labels = { 'A2': 'A2（初級）', 'B1': 'B1（中級）', 'B2': 'B2（中上級）', 'C1': 'C1（上級）' };
    document.getElementById('vocabCountHint').textContent =
      `目標 ${labels[s.targetLevel]}（${s.targetToeicScore}点）→ 単語${s.vocabCount}個を生成します`;
  }
  // ── UI復元：サービスカード ──
  if (s.selectedServices?.length) {
    document.querySelectorAll('.service-card').forEach(card => {
      card.classList.toggle('selected', s.selectedServices.includes(card.dataset.service));
    });
    document.getElementById('serviceNextBtn').disabled = false;
  }
  // ── UI復元：ジャンルタグ ──
  if (s.selectedGenres?.length) {
    document.querySelectorAll('.tag').forEach(tag => {
      tag.classList.toggle('active', s.selectedGenres.includes(tag.dataset.genre));
    });
  }
  // ── 未設定ユーザーは設定モーダルを開いてメイン画面へ ──
  if (!toeicScore || !selectedServices.length) {
    goToStep('main');
    openSettings();
    return;
  }
  // ── 常にドラマライブラリ（メイン画面）へ ──
  goToStep('main');
}

// プロフィールを選択してアプリに入る
function selectProfile(id) {
  currentProfileId = id;
  window._clProfileId = id; // supabase.js から参照できるよう公開
  // 拡張機能がプロフィール別キーに保存できるよう共有する
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ cl_active_profile: id });
  }

  // Supabase から取得した単語（cl_my_words）をプロフィール別キーに移行する
  // ※ 常に上書きして最新のクラウドデータを反映する
  const profileKey = `cl_my_words_${id}`;
  const cloudWords = localStorage.getItem('cl_my_words');
  if (cloudWords) {
    const parsed = JSON.parse(cloudWords);
    if (parsed.length > 0) localStorage.setItem(profileKey, cloudWords);
  }
  // badge を正しい件数に更新（非同期・エラー無視）
  if (typeof updateWordbookBadge === 'function') updateWordbookBadge();

  const profile = loadProfiles().find(p => p.id === id);
  if (!profile) return;

  // ヘッダーのプロフィール表示を更新
  const btn = document.getElementById('btnProfileSwitch');
  const avatar = document.getElementById('headerAvatar');
  const nameEl = document.getElementById('headerProfileName');
  btn.style.display = 'flex';
  avatar.textContent = profile.name.charAt(0);
  avatar.style.background = profile.color;
  nameEl.textContent = profile.name;

  applyProfileSettings(profile.settings || {});

  // クラウド同期後にバックグラウンドで未割当単語を自動解決
  setTimeout(() => resolveUnassignedWords().catch(() => {}), 3000);
}

// プロフィール選択画面を描画する
function renderProfileScreen() {
  const profiles = loadProfiles();
  const grid = document.getElementById('profileGrid');
  grid.innerHTML = '';

  profiles.forEach(p => {
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.innerHTML = `
      <div class="profile-avatar" style="background:${p.color}">${p.name.charAt(0)}</div>
      <div class="profile-name">${p.name}</div>
    `;
    // 削除ボタン
    const delBtn = document.createElement('button');
    delBtn.className = 'profile-delete-btn';
    delBtn.textContent = '✕';
    delBtn.title = '削除';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`「${p.name}」を削除しますか？`)) {
        saveProfiles(loadProfiles().filter(x => x.id !== p.id));
        renderProfileScreen();
      }
    });
    card.appendChild(delBtn);
    card.addEventListener('click', () => selectProfile(p.id));
    grid.appendChild(card);
  });

  // 「追加」カード
  const addCard = document.createElement('div');
  addCard.className = 'profile-card profile-add-card';
  addCard.innerHTML = `
    <div class="profile-avatar profile-avatar-add">+</div>
    <div class="profile-name">追加</div>
  `;
  addCard.addEventListener('click', () => {
    const name = prompt('プロフィール名を入力してください（例：しゅん、パパ）');
    if (!name?.trim()) return;
    const color = AVATAR_COLORS[loadProfiles().length % AVATAR_COLORS.length];
    const profile = { id: 'p_' + Date.now(), name: name.trim(), color, settings: {} };
    const profiles = loadProfiles();
    profiles.push(profile);
    saveProfiles(profiles);
    // 新規プロフィールはオンボーディングへ
    currentProfileId = profile.id;
    window._clProfileId = profile.id;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ cl_active_profile: profile.id });
    }
    startOnboarding();
  });
  grid.appendChild(addCard);
}


// ─────────────────────────────────────────
// オンボーディング（新規プロフィール作成後）
// ─────────────────────────────────────────
let obSelectedServices = [];

function startOnboarding() {
  obSelectedServices = [];
  goToStep('onboarding');

  // ステップインジケーターをリセット
  document.getElementById('ob-step-dot-1').classList.add('active');
  document.getElementById('ob-step-dot-2').classList.remove('active');
  document.getElementById('ob-step-1').style.display = '';
  document.getElementById('ob-step-2').style.display = 'none';

  // TOEICスコア入力
  const scoreInput = document.getElementById('ob-toeicScore');
  const nextBtn    = document.getElementById('ob-next-btn');
  scoreInput.value = '';
  document.getElementById('ob-levelResult').style.display = 'none';
  document.getElementById('ob-targetWrap').style.display  = 'none';
  nextBtn.disabled = true;

  scoreInput.oninput = () => {
    const val = parseInt(scoreInput.value);
    if (val >= 10 && val <= 990) {
      const level = getToeicLevel(val);
      const labels = { A2: 'A2（初級）', B1: 'B1（中級）', B2: 'B2（中上級）', C1: 'C1（上級）' };
      document.getElementById('ob-levelResult').style.display = 'flex';
      document.getElementById('ob-levelResultValue').textContent = labels[level];
      document.getElementById('ob-targetWrap').style.display = 'block';
      nextBtn.disabled = false;
    } else {
      document.getElementById('ob-levelResult').style.display = 'none';
      document.getElementById('ob-targetWrap').style.display  = 'none';
      nextBtn.disabled = true;
    }
  };

  // TOEICレベル行クリック
  document.querySelectorAll('#ob-step-1 .toeic-level-row').forEach(row => {
    row.onclick = () => {
      scoreInput.value = row.dataset.score;
      scoreInput.dispatchEvent(new Event('input'));
    };
  });

  // 次へ
  nextBtn.onclick = () => showObStep2();

  // スキップ（スコアなしでサービス選択へ）
  document.getElementById('ob-skip-score-btn').onclick = () => showObStep2();

  // サービスカード（step2）— グローバルの toggleService とは独立したハンドラ
  document.getElementById('ob-step-2').addEventListener('click', e => {
    const card = e.target.closest('.service-card');
    if (!card) return;
    card.classList.toggle('selected');
    obSelectedServices = [...document.querySelectorAll('#ob-step-2 .service-card.selected')]
      .map(c => c.dataset.service);
    document.getElementById('ob-done-btn').disabled = obSelectedServices.length === 0;
  });

  // 戻る
  document.getElementById('ob-back-btn').onclick = () => {
    document.getElementById('ob-step-dot-1').classList.add('active');
    document.getElementById('ob-step-dot-2').classList.remove('active');
    document.getElementById('ob-step-1').style.display = '';
    document.getElementById('ob-step-2').style.display = 'none';
  };

  // 完了
  document.getElementById('ob-done-btn').onclick = () => finishOnboarding();
}

function showObStep2() {
  document.getElementById('ob-step-dot-1').classList.remove('active');
  document.getElementById('ob-step-dot-2').classList.add('active');
  document.getElementById('ob-step-1').style.display = 'none';
  document.getElementById('ob-step-2').style.display = '';
  document.getElementById('ob-done-btn').disabled = true;
}

function finishOnboarding() {
  // スコア反映
  const scoreVal = parseInt(document.getElementById('ob-toeicScore').value);
  if (scoreVal >= 10 && scoreVal <= 990) {
    toeicScore = scoreVal;
    userLevel  = getToeicLevel(scoreVal);
    document.getElementById('toeicScore').value = scoreVal;
    const targetVal = parseInt(document.getElementById('ob-targetScore').value);
    if (targetVal >= scoreVal && targetVal <= 990) {
      targetToeicScore = targetVal;
      targetLevel      = getToeicLevel(targetVal);
    }
  }

  // サービス反映
  selectedServices = obSelectedServices;
  document.querySelectorAll('#settingsModal .service-card').forEach(card => {
    card.classList.toggle('selected', selectedServices.includes(card.dataset.service));
  });

  saveSettings();

  // ドラマ追加モーダルを開いてタイトル検索タブへ
  goToStep('main');
  setTimeout(() => {
    openAddDrama();
    // タイトル検索タブを選択
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="search"]').classList.add('active');
    document.getElementById('tabSearch').classList.add('active');
    setTimeout(() => {
      const inp = document.getElementById('manualSearchInput');
      if (inp) inp.focus();
    }, 100);
  }, 300);
}

// TOEICスコアからレベルを判定する
function getToeicLevel(score) {
  if (score < 400) return 'A2';
  if (score < 600) return 'B1';
  if (score < 800) return 'B2';
  return 'C1';
}

// 目標TOEICスコアから生成する単語数を決める（最大50個）
function getVocabCount(score) {
  if (!score || score <= 0) return 30; // 未入力時のデフォルト
  if (score <= 400) return 20;
  if (score <= 600) return 30;
  if (score <= 800) return 40;
  return 50; // 800点以上（C1目標）
}

// TOEICスコア → CEFRレベル（語彙難易度の指定に使う。CEFRの方がLLMの判定が正確）
function toeicToCefr(score) {
  if (!score || score <= 0) return null;
  if (score < 225) return 'A1';
  if (score < 550) return 'A2';
  if (score < 785) return 'B1';
  if (score < 945) return 'B2';
  return 'C1';
}
// 目標帯（現在帯＋1つ上をねらい目にする）
function cefrTargetBand(cur, tgt) {
  const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const c = toeicToCefr(cur) || 'A2';
  const t = toeicToCefr(tgt) || order[Math.min(order.indexOf(c) + 1, order.length - 1)];
  const lo = order.indexOf(c);
  const hi = Math.max(order.indexOf(t), lo + 1);
  return `${order[lo]}〜${order[Math.min(hi, order.length - 1)]}`;
}

// TOEICスコア入力時の処理
function onToeicInput() {
  const val = parseInt(document.getElementById('toeicScore').value);
  if (!val || val < 10 || val > 990) {
    document.getElementById('levelResult').style.display = 'none';
    const nb = document.getElementById('toeicNextBtn');
    if (nb) nb.disabled = true;
    return;
  }
  toeicScore = val;
  userLevel = getToeicLevel(val);
  showLevelResult(userLevel);
  saveSettings();
}

// スコアを直接セットする
function setToeic(score) {
  document.getElementById('toeicScore').value = score;
  toeicScore = score;
  userLevel = getToeicLevel(score);
  showLevelResult(userLevel);
  saveSettings();
}

// レベル判定結果を表示する
function showLevelResult(level) {
  const labels = {
    'A2': 'A2（初級）',
    'B1': 'B1（中級）',
    'B2': 'B2（中上級）',
    'C1': 'C1（上級）'
  };
  document.getElementById('levelResultValue').textContent = labels[level];
  document.getElementById('levelResultValue').className =
    'level-result-value level-pill level-' + level;
  document.getElementById('levelResult').style.display = 'flex';
  const toeicNextBtn = document.getElementById('toeicNextBtn');
  if (toeicNextBtn) toeicNextBtn.disabled = false;
  const levelDisplay = document.getElementById('levelDisplay');
  if (levelDisplay) levelDisplay.textContent = labels[level];
  // 現在のレベルが確定したら目標スコア入力欄を表示する
  document.getElementById('targetWrap').style.display = 'block';
}

// 目標TOEICスコア入力時の処理
function onTargetInput() {
  const val = parseInt(document.getElementById('targetScore').value);
  const hint = document.getElementById('vocabCountHint');
  const labels = {
    'A2': 'A2（初級）', 'B1': 'B1（中級）',
    'B2': 'B2（中上級）', 'C1': 'C1（上級）'
  };

  if (!val || val < 10 || val > 990) {
    // 未入力・無効値のときはデフォルトに戻す
    targetToeicScore = 0;
    targetLevel = userLevel;
    vocabCount = 30;
    hint.textContent = '未入力の場合：単語30個を生成します';
    return;
  }

  targetToeicScore = val;
  targetLevel = getToeicLevel(val);
  vocabCount = getVocabCount(val);
  hint.textContent = `目標 ${labels[targetLevel]}（${val}点）→ 単語${vocabCount}個を生成します`;
  saveSettings();
}


// ステータスメッセージを表示する
function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status-msg ' + type;
  setTimeout(() => { el.className = 'status-msg'; }, 3000);
}

// アプリを開始する
function startApp() {
  goToStep(1);
}

// 画面を切り替える（step は数字または 'main'）
function goToStep(step) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const id = step === 'main' ? 'screen-main' : 'screen-' + step;
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
  if (step === 'main') { renderTodayPanel(); renderDramaLibrary(); }
  // screen-4（単語リスト）ではポーリング開始、それ以外では停止
  if (step === 4) startExtPoll(); else stopExtPoll();
}

// ── ドラマライブラリ（メイン画面） ──────────────────────────

// プラットフォームに対応する背景色
function platformColor(platform) {
  const map = {
    'Netflix': '#E50914', 'Amazon Prime': '#00A8E0',
    'Disney+': '#113CCF', 'Apple TV+': '#555', 'Hulu': '#1CE783',
    'U-NEXT': '#FF0032',
  };
  return map[platform] || '#c17f3b';
}

// 履歴からドラマ一覧を描画する
function renderDramaLibrary() {
  const container = document.getElementById('dramaLibrary');
  if (!container) return;

  const history = loadHistory();
  // ドラマタイトルでグループ化
  const map = new Map();
  history.forEach(h => {
    const key = h.drama.title;
    if (!map.has(key)) {
      map.set(key, { drama: h.drama, episodes: [], bestScore: null, lastDate: h.date });
    }
    const d = map.get(key);
    d.episodes.push({ season: h.season, episode: h.episode, score: h.quizScore });
    if (h.quizScore !== null && (d.bestScore === null || h.quizScore > d.bestScore)) d.bestScore = h.quizScore;
    if (h.date > d.lastDate) d.lastDate = h.date;
  });

  // myDramas に登録済みで履歴にないドラマも表示
  myDramas.forEach(d => {
    if (!map.has(d.title)) {
      map.set(d.title, { drama: d, episodes: [], bestScore: null, lastDate: null });
    }
  });
  // 後方互換：selectedDrama が myDramas 未登録なら表示
  if (selectedDrama && !map.has(selectedDrama.title)) {
    map.set(selectedDrama.title, { drama: selectedDrama, episodes: [], bestScore: null, lastDate: null });
  }

  if (map.size === 0) {
    container.innerHTML = `
      <div class="library-empty">
        <div style="font-size:48px;margin-bottom:16px">🎬</div>
        <div>まだドラマが登録されていません</div>
        <div style="font-size:13px;margin-top:8px;color:var(--text-muted)">「＋ ドラマを追加」で学習を始めましょう</div>
      </div>`;
    return;
  }

  container.innerHTML = '';
  map.forEach(data => container.appendChild(buildLibraryCard(data)));

  // posterPath が未設定 or 古い縦長画像（w500）のドラマを再取得
  const missing = [...map.values()].filter(d =>
    !d.drama.posterPath || d.drama.posterPath.includes('/w500')
  );
  if (missing.length) fetchMissingPosters(missing);
}

async function fetchMissingPosters(entries) {
  for (const { drama } of entries) {
    try {
      const res = await fetch(`${API_BASE}/api/tmdb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', query: drama.englishTitle || drama.title }),
      });
      const data = await res.json();
      const hit  = data.results?.[0];
      if (!hit?.backdrop_path && !hit?.poster_path) continue;

      const imgPath = hit.backdrop_path || hit.poster_path;
      const p = `https://image.tmdb.org/t/p/w780${imgPath}`;
      drama.posterPath = p;
      if (!hit.id) continue;
      drama.tmdbId = hit.id;

      // myDramas にも反映
      const md = myDramas.find(d => d.title === drama.title);
      if (md) { md.posterPath = p; md.tmdbId = hit.id; }

      // カードのバナーを即時更新
      const banner = document.querySelector(
        `.library-card-banner[data-title="${CSS.escape(drama.title)}"]`
      );
      if (banner) {
        banner.style.background = `url('${p}') center/cover no-repeat`;
        // 頭文字のspanだけ消す（textContent='' だと✕削除ボタンまで消えるバグがあった）
        banner.querySelector('.library-card-letter')?.remove();
      }
    } catch { /* 取得失敗は無視 */ }
  }
  saveSettings();
}

function buildLibraryCard({ drama, episodes, bestScore, lastDate }) {
  const card = document.createElement('div');
  card.className = 'library-card';

  const recent = episodes.slice(-3).map(e => `S${e.season}E${e.episode}`).join(' · ');
  const scoreHtml = bestScore !== null
    ? `<span class="history-score ${bestScore >= 80 ? 'score-high' : bestScore >= 60 ? 'score-mid' : 'score-low'}">${bestScore}%</span>`
    : '';

  const bannerStyle = drama.posterPath
    ? `background:url('${drama.posterPath}') center/cover no-repeat;`
    : `background:${platformColor(drama.platform)};`;
  // 頭文字は span に包む（ポスター取得時にこの span だけを消すため。
  // バナー直下のテキストにすると textContent='' で✕ボタンまで消えてしまう）
  const bannerInner = drama.posterPath
    ? '' : `<span class="library-card-letter">${esc(drama.title.charAt(0))}</span>`;

  card.innerHTML = `
    <div class="library-card-banner" style="${bannerStyle}" data-title="${drama.title.replace(/"/g, '&quot;')}">
      ${bannerInner}
      <button class="library-card-delete" title="削除">✕</button>
    </div>
    <div class="library-card-body">
      <div class="library-card-title">${esc(drama.title)}</div>
      <div class="library-card-meta">
        <span class="history-score score-none" style="font-size:11px">${drama.platform}</span>
        ${scoreHtml}
      </div>
      ${recent ? `<div class="library-card-episodes">📚 ${recent}</div>` : '<div class="library-card-episodes" style="color:var(--text-muted)">未学習</div>'}
    </div>
    <div class="library-card-footer">
      <span class="library-card-date">${lastDate ? formatDateJa(lastDate) : ''}</span>
      <button class="library-card-action">${episodes.length > 0 ? '続きを学習 →' : '学習を始める →'}</button>
    </div>`;

  card.querySelector('.library-card-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteDramaFromLibrary(drama.title);
  });
  card.addEventListener('click', () => loadDramaFromLibrary(drama));
  return card;
}

// ドラマをライブラリから削除する（履歴も含めて）
function deleteDramaFromLibrary(title) {
  if (!confirm(`「${title}」をライブラリから削除しますか？\n学習履歴もすべて消えます。`)) return;
  const history = loadHistory();
  const toDelete = history.filter(h => h.drama?.title === title);
  const newHistory = history.filter(h => h.drama?.title !== title);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));

  // Supabase から該当IDを削除
  if (typeof sbFetch !== 'undefined' && isLoggedIn() && toDelete.length) {
    const ids = toDelete.map(h => h.id).filter(Boolean);
    if (ids.length) {
      sbFetch(`/rest/v1/history?id=in.(${ids.join(',')})`, { method: 'DELETE' }).catch(() => {});
    }
  }

  myDramas = myDramas.filter(d => d.title !== title);

  if (selectedDrama?.title === title) {
    selectedDrama = null;
    dramaSeasonInfo = [];
    saveSettings();
  }
  renderDramaLibrary();
}

// ライブラリのドラマカードをクリックして学習へ（サービス選択画面を経由）
async function loadDramaFromLibrary(drama) {
  selectedDrama = drama;
  dramaSeasonInfo = [];
  // myDramas に未登録なら追加
  if (!myDramas.some(d => d.title === drama.title)) {
    myDramas.push(drama);
  }
  saveSettings();

  // サービス選択画面へ
  goToStep('service-select');
  document.getElementById('serviceSelectDramaTitle').textContent =
    `「${drama.title}」をどのサービスで視聴しますか？`;

  // TMDb の provider_id → CineLearnサービス名のマッピング（JP向け）
  const PROVIDER_MAP = {
    8:    'Netflix',
    1796: 'Netflix',      // Netflix Standard with Ads
    10:   'Amazon Prime', // Amazon Video
    9:    'Amazon Prime', // Amazon Prime Video（念のため）
    337:  'Disney+',
    350:  'Apple TV+',
    2:    'Apple TV+',    // Apple iTunes（念のため）
    15:   'Hulu',
    269:  'Hulu',         // Hulu Japan（念のため）
    97:   'U-NEXT',
    192:  'YouTube',
    3:    'YouTube',      // Google Play Movies
  };

  const ALL_SERVICES = [
    { name: 'Netflix',      icon: '🔴' },
    { name: 'Amazon Prime', icon: '🔵' },
    { name: 'Disney+',      icon: '🔷' },
    { name: 'Apple TV+',    icon: '🍎' },
    { name: 'Hulu',         icon: '🟢' },
    { name: 'U-NEXT',       icon: '🟣' },
    { name: 'YouTube',      icon: '▶️' },
  ];

  const grid = document.getElementById('viewingServiceGrid');
  grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:12px">視聴サービスを確認中...</div>';

  // TMDb で視聴可能サービスを取得
  let availableNames = new Set();
  try {
    // tmdbId が未取得なら先にタイトル検索してIDを取得（TV → 映画の順）
    let tmdbId = drama.tmdbId;
    let isMovie = drama.type === 'movie';
    if (!tmdbId) {
      const searchRes = await fetch(`${API_BASE}/api/tmdb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', query: drama.title }),
      });
      const searchData = await searchRes.json();
      let firstResult = searchData.results?.[0];
      // TV で見つからなければ映画として検索
      if (!firstResult) {
        const mvRes = await fetch(`${API_BASE}/api/tmdb`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'search_movie', query: drama.title }),
        });
        const mvData = await mvRes.json();
        firstResult = mvData.results?.[0];
        if (firstResult) isMovie = true;
      }
      tmdbId = firstResult?.id;
      if (tmdbId) { drama.tmdbId = tmdbId; selectedDrama.tmdbId = tmdbId; }
      if ((firstResult?.backdrop_path || firstResult?.poster_path) && !drama.posterPath) {
        const imgPath = firstResult.backdrop_path || firstResult.poster_path;
        const p = `https://image.tmdb.org/t/p/w780${imgPath}`;
        drama.posterPath = p; selectedDrama.posterPath = p;
        const md = myDramas.find(d => d.title === drama.title);
        if (md) md.posterPath = p;
      }
    }
    if (tmdbId) {
      const r = await fetch(`${API_BASE}/api/tmdb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isMovie
            ? { action: 'movie_watch_providers', movieId: tmdbId }
            : { action: 'watch_providers', tvId: tmdbId }
        ),
      });
      const data = await r.json();
      const jpProviders = data.results?.JP;
      const providers = [
        ...(jpProviders?.flatrate || []),
        ...(jpProviders?.rent     || []),
        ...(jpProviders?.buy      || []),
      ];
      providers.forEach(p => {
        if (PROVIDER_MAP[p.provider_id]) availableNames.add(PROVIDER_MAP[p.provider_id]);
      });
    }
  } catch { /* 取得失敗時は全サービス表示 */ }

  grid.innerHTML = '';

  const confirmed = ALL_SERVICES.filter(s => availableNames.has(s.name));
  const others    = ALL_SERVICES.filter(s => !availableNames.has(s.name));

  const makeCard = (svc, highlight) => {
    const card2 = document.createElement('div');
    card2.className = 'viewing-service-card';
    const isRegistered = selectedServices.includes(svc.name);
    const isSelected   = svc.name === selectedViewingService;

    if (isSelected) {
      card2.style.borderColor = 'var(--accent)';
      card2.style.background  = 'rgba(193,127,59,0.07)';
    } else if (highlight) {
      card2.style.borderColor = 'rgba(52,199,89,0.5)';
    }
    if (!isRegistered) {
      card2.style.opacity = '0.35';
    }

    const sub = isSelected
      ? '<div style="font-size:10px;color:var(--accent);margin-top:3px">前回使用</div>'
      : highlight
        ? '<div style="font-size:10px;color:#2da87c;margin-top:3px">✓ 配信中</div>'
        : !isRegistered
          ? '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">未登録</div>'
          : '';
    card2.innerHTML = `<div class="vs-icon">${svc.icon}</div><div class="vs-name">${svc.name}</div>${sub}`;
    card2.addEventListener('click', () => selectViewingService(svc.name, drama));
    return card2;
  };

  const makeSection = (label, services, highlight) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:8px';
    lbl.textContent = label;
    wrap.appendChild(lbl);

    const innerGrid = document.createElement('div');
    innerGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px';
    services.forEach(svc => innerGrid.appendChild(makeCard(svc, highlight)));
    wrap.appendChild(innerGrid);
    return wrap;
  };

  // グリッド自体はflex縦並びに変更
  grid.style.cssText = 'display:flex;flex-direction:column;gap:16px';

  if (confirmed.length > 0) {
    grid.appendChild(makeSection('✓ 配信確認済み', confirmed, true));
    if (others.length > 0) {
      const sep = document.createElement('div');
      sep.style.cssText = 'border-top:1px solid var(--border);padding-top:16px;width:100%';
      grid.appendChild(sep);
      grid.appendChild(makeSection('その他のサービス', others, false));
    }
  } else {
    // TMDBで取得できなかった場合は全サービスを1グリッドで表示
    const innerGrid = document.createElement('div');
    innerGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px';
    ALL_SERVICES.forEach(svc => innerGrid.appendChild(makeCard(svc, false)));
    grid.appendChild(innerGrid);
  }
}

// ※ 旧実装（使用停止・selectViewingService に統合）
// eslint-disable-next-line no-unused-vars
async function _loadDramaFromLibrary_unused(drama) {
  goToStep(4);

  document.getElementById('vocabDramaTitle').textContent =
    `「${drama.title}」のエピソードを選んで単語を予習する`;

  document.getElementById('vocabNextBtn').style.display = 'none'; document.getElementById('vocabDeleteBtn').style.display = 'none';

  if (dramaSeasonInfo.length && selectedDrama?.title === drama.title) {
    buildSeasonEpisodeSelectors(dramaSeasonInfo);
    document.getElementById('seasonSelect').value = selectedSeason;
    const sd = dramaSeasonInfo.find(s => s.season === selectedSeason);
    if (sd) updateEpisodeSelector(sd.episodes);
    document.getElementById('episodeSelect').value = selectedEpisode;
    // 保存済み単語があれば即表示
    if (!(await checkAndShowSavedVocab())) {
      document.getElementById('episodeSelected').textContent =
        `Season ${selectedSeason} Episode ${selectedEpisode}`;
      document.getElementById('vocabGenBtn').style.display = '';
      document.getElementById('vocabGenBtn').disabled = false;
      document.getElementById('vocabGenBtn').textContent = '単語を生成';
      document.getElementById('vocabSection').innerHTML =
        '<div class="empty-state">「単語を生成」を押してください</div>';
    }
  } else {
    // シーズン情報を再取得
    document.getElementById('episodeSelected').textContent = 'シーズン情報を取得中...';
    document.getElementById('vocabGenBtn').style.display = '';
    document.getElementById('vocabGenBtn').disabled = true;
    document.getElementById('vocabSection').innerHTML =
      '<div class="loading"><div class="spinner"></div>シーズン情報を取得中...</div>';
    (async () => {
      try {
        const prompt = `「${drama.title}」のシーズンとエピソード数を教えてください。
JSON形式のみで返答: { "seasons": [{ "season": 1, "episodes": 10 }] }`;
        const text = await callClaude(prompt);
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
        dramaSeasonInfo = json.seasons;
        buildSeasonEpisodeSelectors(json.seasons);
      } catch {
        dramaSeasonInfo = [{ season: 1, episodes: 10 }, { season: 2, episodes: 10 }];
        buildSeasonEpisodeSelectors(dramaSeasonInfo);
      }
      selectedSeason = 1; selectedEpisode = 1;
      saveSettings();
      try {
        if (!(await checkAndShowSavedVocab())) await preloadSubtitle();
      } catch {
        const b = document.getElementById('vocabGenBtn');
        if (b) { b.style.display = ''; b.disabled = false; b.textContent = '単語を生成'; }
      }
    })();
  }
}

// ── 設定モーダル ──────────────────────────────────────────────
function openSettings() {
  document.getElementById('settingsModal').style.display = 'flex';
  // 現在の testTiers をチェックボックスに反映
  document.querySelectorAll('.tier-checkbox').forEach(cb => {
    cb.checked = testTiers.includes(cb.value);
  });
}
function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

function saveSettingsFromModal() {
  if (!toeicScore) {
    alert('TOEICスコアを入力してください（目安でOKです）');
    return;
  }
  if (!selectedServices.length) {
    alert('利用サービスを1つ以上選択してください');
    return;
  }
  saveSettings();
  closeSettings();
  goToStep('main');
}

// ── ドラマ追加モーダル ────────────────────────────────────────
function openAddDrama() {
  document.getElementById('addDramaModal').style.display = 'flex';
}
function closeAddDrama() {
  document.getElementById('addDramaModal').style.display = 'none';
  document.getElementById('dramaList').innerHTML =
    '<div class="empty-state">ジャンルを選んでおすすめを取得してください</div>';
  document.getElementById('manualSearchResults').innerHTML =
    '<div class="empty-state">タイトルを入力して検索してください</div>';
}

function switchAddDramaTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

// タイトル検索（Claude APIで単作品の情報を取得）
async function manualSearchDrama() {
  const title = document.getElementById('manualSearchInput').value.trim();
  if (!title) return;
  const btn = document.getElementById('btnManualSearch');
  const results = document.getElementById('manualSearchResults');
  btn.disabled = true;
  results.innerHTML = '<div class="loading"><div class="spinner"></div>検索中...</div>';

  const svcs = selectedServices.length ? selectedServices.join(', ') : 'Netflix, Amazon Prime';
  try {
    const prompt = `「${title}」について以下のJSON形式で返してください（見つからない場合は[]）。
[{"title":"${title}","genre":"ジャンル","level":"${userLevel}","platform":"視聴可能なサービス（${svcs}のいずれか）","seasons":1,"reason":"おすすめの理由（日本語・1文）","speech_feature":"英語の特徴"}]`;
    const text = await callClaude(prompt);
    const json = JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
    renderDramas(json, 'manualSearchResults');
  } catch (e) {
    results.innerHTML = `<div class="empty-state" style="color:var(--red)">${e.message}</div>`;
  }
  btn.disabled = false;
}

// サービスカードの選択
function toggleService(card) {
  card.classList.toggle('selected');
  const service = card.dataset.service;
  if (card.classList.contains('selected')) {
    selectedServices.push(service);
  } else {
    selectedServices = selectedServices.filter(s => s !== service);
  }
  document.getElementById('serviceNextBtn').disabled = selectedServices.length === 0;
  saveSettings();
}

// ジャンルタグは initEventListeners() で登録

// Claude APIを呼び出す（Netlify Function プロキシ経由・過負荷時は最大3回リトライ）
// 拡張機能内（chrome-extension://）から開いた場合は絶対URLを使う
const API_BASE = (typeof chrome !== 'undefined' && chrome.runtime?.id)
  ? 'https://cine-learn.vercel.app'
  : '';

// TMDb API でシーズン・エピソード情報を取得する
async function fetchSeasonInfoFromTMDb(title) {
  try {
    // ① タイトルで検索
    const searchRes = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query: title })
    });
    const searchData = await searchRes.json();
    const show = searchData.results?.[0];
    if (!show) return null;

    // ② シーズン詳細を取得
    const detailRes = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seasons', tvId: show.id })
    });
    const detail = await detailRes.json();
    if (!detail.seasons) return null;

    // Specials（season_number=0）を除外して整形
    const seasons = detail.seasons
      .filter(s => s.season_number > 0 && s.episode_count > 0)
      .map(s => ({ season: s.season_number, episodes: s.episode_count }));

    const englishTitle = detail.name || show.original_name || title;
    const imgPath    = show.backdrop_path || show.poster_path;
    const posterPath = imgPath ? `https://image.tmdb.org/t/p/w780${imgPath}` : null;
    return seasons.length ? { seasons, englishTitle, tmdbId: show.id, posterPath } : null;
  } catch {
    return null;
  }
}

// TMDb で映画を検索して英語タイトル等を取得する
async function fetchMovieInfoFromTMDb(title) {
  try {
    const r = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search_movie', query: title })
    });
    const data  = await r.json();
    const movie = data.results?.[0];
    if (!movie) return null;
    const englishTitle = movie.title || movie.original_title || title;
    const imgPath      = movie.backdrop_path || movie.poster_path;
    const posterPath   = imgPath ? `https://image.tmdb.org/t/p/w780${imgPath}` : null;
    return { englishTitle, tmdbId: movie.id, posterPath };
  } catch {
    return null;
  }
}

// /search/multi で TVと映画の最上位候補をそれぞれ取得する
async function fetchTitleCandidatesFromTMDb(title) {
  const posterOf = (x) => {
    const p = x.backdrop_path || x.poster_path;
    return p ? `https://image.tmdb.org/t/p/w780${p}` : null;
  };
  const yearOf = (x) => (x.first_air_date || x.release_date || '').slice(0, 4);
  try {
    const r = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search_multi', query: title })
    });
    const data    = await r.json();
    const results = (data.results || []).filter(x => x.media_type === 'movie' || x.media_type === 'tv');
    const shape = (x) => x && {
      type: x.media_type,
      tmdbId: x.id,
      englishTitle: x.title || x.name || x.original_title || x.original_name || title,
      year: yearOf(x),
      posterPath: posterOf(x),
    };
    return {
      tv:    shape(results.find(x => x.media_type === 'tv')),
      movie: shape(results.find(x => x.media_type === 'movie')),
    };
  } catch { return { tv: null, movie: null }; }
}

// ドラマ版・映画版の両方が見つかった場合にユーザーに選ばせる
// （例：The Mandalorian にはドラマ版と映画版 The Mandalorian & Grogu がある。
//   人気順の自動判定だと新作映画がドラマを上書きしてしまう）
function askMediaTypeChoice(tvC, mvC) {
  return new Promise(resolve => {
    const sect = document.getElementById('vocabSection');
    document.getElementById('episodeSelected').textContent = 'どちらの作品か選んでください';
    sect.innerHTML = `
      <div class="media-type-choice">
        <div class="media-type-title">この作品にはドラマ版と映画版があります。どちらを学習しますか？</div>
        <div class="media-type-options">
          <button class="media-type-btn" data-pick="tv">
            <span class="media-type-icon">📺</span>
            <span class="media-type-label">ドラマ</span>
            <span class="media-type-name">${esc(tvC.englishTitle)}${tvC.year ? `（${esc(tvC.year)}）` : ''}</span>
          </button>
          <button class="media-type-btn" data-pick="movie">
            <span class="media-type-icon">🎬</span>
            <span class="media-type-label">映画</span>
            <span class="media-type-name">${esc(mvC.englishTitle)}${mvC.year ? `（${esc(mvC.year)}）` : ''}</span>
          </button>
        </div>
      </div>`;
    sect.querySelectorAll('.media-type-btn').forEach(b =>
      b.addEventListener('click', () => {
        sect.innerHTML = '<div class="loading"><div class="spinner"></div>シーズン情報を取得中...</div>';
        resolve(b.dataset.pick === 'tv' ? tvC : mvC);
      })
    );
  });
}

// 候補からメタ情報を解決する（TVはシーズン詳細を追加取得）
async function resolveTitleCandidate(cand, title) {
  if (!cand) return null;
  if (cand.type === 'movie') return cand;
  try {
    const detailRes = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seasons', tvId: cand.tmdbId })
    });
    const detail  = await detailRes.json();
    const seasons = (detail.seasons || [])
      .filter(s => s.season_number > 0 && s.episode_count > 0)
      .map(s => ({ season: s.season_number, episodes: s.episode_count }));
    return {
      ...cand,
      englishTitle: detail.name || cand.englishTitle || title,
      seasons: seasons.length ? seasons : [{ season: 1, episodes: 10 }],
    };
  } catch { return null; }
}

// タイトルが TV か映画かを判定しつつメタ情報を返す。
// mediaTypeHint（過去の選択 'tv'/'movie'）があればそれを優先し、
// なければ両タイプ存在時にユーザーへ選択UIを出す。
async function fetchTitleInfoFromTMDb(title, mediaTypeHint = null) {
  const { tv, movie } = await fetchTitleCandidatesFromTMDb(title);

  let pick = null;
  if (mediaTypeHint === 'tv')         pick = tv || movie;
  else if (mediaTypeHint === 'movie') pick = movie || tv;
  else if (tv && movie)               pick = await askMediaTypeChoice(tv, movie);
  else                                pick = tv || movie;

  const resolved = await resolveTitleCandidate(pick, title);
  if (resolved) return resolved;

  // フォールバック：従来の TV → 映画 個別検索
  const tvFb = await fetchSeasonInfoFromTMDb(title);
  if (tvFb) return { type: 'tv', ...tvFb };
  const mvFb = await fetchMovieInfoFromTMDb(title);
  if (mvFb) return { type: 'movie', ...mvFb };
  return null;
}

async function callClaude(prompt, maxTokens = 2000, onRetry = null) {
  const delays = [3000, 6000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(`${API_BASE}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, maxTokens })
    });
    if (res.ok) {
      const data = await res.json();
      return data.content[0].text;
    }
    const err = await res.json();
    if ((res.status === 529 || res.status === 429) && attempt < delays.length) {
      const waitSec = delays[attempt] / 1000;
      if (onRetry) onRetry(attempt + 1, waitSec);
      await new Promise(r => setTimeout(r, delays[attempt]));
      continue;
    }
    throw new Error(err.error?.message || 'APIエラー');
  }
}

// Open Subtitles APIで字幕を検索する（Netlify Function プロキシ経由）
// type='movie' の場合は season/episode を送らず、tmdbId があればそれで厳密検索する
async function searchSubtitles(title, season, episode, type = 'tv', tmdbId = null) {
  const body = { action: 'search', query: title };
  if (type === 'movie') {
    body.type = 'movie';
    if (tmdbId) body.tmdbId = tmdbId;
  } else {
    body.season = season;
    body.episode = episode;
  }
  const res = await fetch(`${API_BASE}/api/subtitles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('字幕の検索に失敗しました');
  const data = await res.json();
  return data.data;
}

// 字幕ファイルをダウンロードする（Netlify Function プロキシ経由）
async function downloadSubtitle(fileId) {
  const res = await fetch(`${API_BASE}/api/subtitles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'download', fileId })
  });
  if (!res.ok) throw new Error('字幕のダウンロードに失敗しました');
  return await res.text();
}

// SRTテキストからセリフだけ抽出する
function parseSrt(srtText) {
  const lines = srtText.split('\n');
  const dialogues = [];
  let isDialogue = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      isDialogue = false;
    } else if (/-->/.test(trimmed)) {
      isDialogue = true;
    } else if (trimmed && isDialogue) {
      const clean = trimmed.replace(/<[^>]+>/g, '');
      if (clean) dialogues.push(clean);
    }
  }
  return dialogues.join(' ');
}

// ── 活用形バリアント生成 ──────────────────────────────────────────────────────

// 不規則動詞テーブル（原形 → 活用形リスト）
const IRREGULAR_VERBS = {
  be:['am','is','are','was','were','been','being'],
  have:['has','had','having'],
  do:['does','did','done','doing'],
  go:['goes','went','gone','going'],
  say:['says','said','saying'],
  get:['gets','got','gotten','getting'],
  make:['makes','made','making'],
  know:['knows','knew','known','knowing'],
  think:['thinks','thought','thinking'],
  take:['takes','took','taken','taking'],
  see:['sees','saw','seen','seeing'],
  come:['comes','came','coming'],
  give:['gives','gave','given','giving'],
  find:['finds','found','finding'],
  tell:['tells','told','telling'],
  feel:['feels','felt','feeling'],
  keep:['keeps','kept','keeping'],
  run:['runs','ran','running'],
  leave:['leaves','left','leaving'],
  hear:['hears','heard','hearing'],
  let:['lets','letting'],
  begin:['begins','began','begun','beginning'],
  show:['shows','showed','shown','showing'],
  lead:['leads','led','leading'],
  mean:['means','meant','meaning'],
  meet:['meets','met','meeting'],
  lose:['loses','lost','losing'],
  pay:['pays','paid','paying'],
  sit:['sits','sat','sitting'],
  stand:['stands','stood','standing'],
  understand:['understands','understood','understanding'],
  speak:['speaks','spoke','spoken','speaking'],
  write:['writes','wrote','written','writing'],
  read:['reads','reading'],
  bring:['brings','brought','bringing'],
  buy:['buys','bought','buying'],
  send:['sends','sent','sending'],
  build:['builds','built','building'],
  fall:['falls','fell','fallen','falling'],
  hold:['holds','held','holding'],
  spend:['spends','spent','spending'],
  cut:['cuts','cutting'],
  put:['puts','putting'],
  set:['sets','setting'],
  try:['tries','tried','trying'],
  become:['becomes','became','becoming'],
  happen:['happens','happened','happening'],
  suppose:['supposes','supposed','supposing'],
};

// 活用形 → 原形の逆引きマップを構築
const IRREGULAR_REVERSE = {};
for (const [base, forms] of Object.entries(IRREGULAR_VERBS)) {
  for (const f of forms) IRREGULAR_REVERSE[f] = base;
}

// 単語の検索候補セットを生成（原形・活用形・語幹）
function getWordVariants(word) {
  const w = word.toLowerCase();
  const v = new Set([w]);

  // ── 不規則動詞 ──
  if (IRREGULAR_VERBS[w]) IRREGULAR_VERBS[w].forEach(f => v.add(f));
  if (IRREGULAR_REVERSE[w]) {
    const base = IRREGULAR_REVERSE[w];
    v.add(base);
    IRREGULAR_VERBS[base]?.forEach(f => v.add(f));
  }

  // ── 語幹から全活用形を展開するヘルパー ──
  // 語幹が判明したらここに渡すと s/ing/ed/es などを全部追加する
  function expandBase(base) {
    if (!base || base.length < 2) return;
    v.add(base);
    if (base.endsWith('e')) {
      // incorporate → incorporates / incorporating / incorporated
      v.add(base + 's');
      v.add(base.slice(0, -1) + 'ing');
      v.add(base.slice(0, -1) + 'ed');
    } else if (base.endsWith('y') && !/[aeiou]y$/.test(base)) {
      // study → studies / studied / studying
      v.add(base.slice(0, -1) + 'ies');
      v.add(base.slice(0, -1) + 'ied');
      v.add(base + 'ing');
    } else {
      v.add(base + 's');
      v.add(base + 'ing');
      v.add(base + 'ed');
      v.add(base + 'd');
      // 短母音+子音の重子音: run → running
      if (/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(base)) {
        v.add(base + base.slice(-1) + 'ing');
        v.add(base + base.slice(-1) + 'ed');
      }
    }
  }

  // 入力単語そのものを語幹として展開
  expandBase(w);

  // ── 活用形から語幹を逆算して再展開 ──

  // -ing → 語幹
  if (w.endsWith('ing') && w.length > 5) {
    const stem = w.slice(0, -3);
    expandBase(stem + 'e');   // making → make
    expandBase(stem);          // think → think（eなし）
    // running → run（重子音）
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
      expandBase(stem.slice(0, -1));
    }
  }
  // -ed → 語幹
  if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2);
    expandBase(stem + 'e');   // incorporated → incorporate
    expandBase(stem);          // walked → walk
    // stopped → stop（重子音）
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1)) {
      expandBase(stem.slice(0, -1));
    }
  }
  // -ies → -y語幹
  if (w.endsWith('ies') && w.length > 4) expandBase(w.slice(0, -3) + 'y');
  // -ied → -y語幹
  if (w.endsWith('ied') && w.length > 4) expandBase(w.slice(0, -3) + 'y');
  // -s/-es → 語幹
  if (w.endsWith('es') && w.length > 4)  expandBase(w.slice(0, -2));
  if (w.endsWith('s')  && w.length > 3 && !w.endsWith('ss')) expandBase(w.slice(0, -1));

  return v;
}

// SRTから「単語が登場する最初のタイムスタンプ」を返す
// 戻り値: "3:24" 形式の文字列、見つからなければ null
function findWordTimestampInSrt(srtText, word) {
  const tokens = word.toLowerCase().trim().split(/\s+/);

  // 単一単語：バリアント正規表現でマッチ
  // フレーズ（複数単語）：各トークンが行内に存在するか個別チェック
  //   例: "put out" → "put it out" の行でも "put" と "out" が両方あれば✅
  //   例: "speak for" → "speaks for" でも "speak"バリアントと "for" が両方あれば✅
  const makeChecker = (tokens) => {
    if (tokens.length === 1) {
      const variants = getWordVariants(tokens[0]);
      const escaped  = [...variants].map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
      return (clean) => re.test(clean);
    }
    // フレーズ：各トークンのバリアントが行内に全部あるか
    const checkers = tokens.map(tok => {
      const variants = getWordVariants(tok);
      const escaped  = [...variants].map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
    });
    return (clean) => checkers.every(re => re.test(clean));
  };

  const matches = makeChecker(tokens);
  const lines   = srtText.split('\n');
  let currentTime = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // タイムスタンプ行: 00:03:24,500 --> 00:03:27,200
    const tsMatch = line.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d+)\s*-->/);
    if (tsMatch) {
      const h = parseInt(tsMatch[1]);
      const m = parseInt(tsMatch[2]);
      const s = parseInt(tsMatch[3]);
      const totalSec = h * 3600 + m * 60 + s;
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      currentTime = `${mins}:${String(secs).padStart(2, '0')}`;
      continue;
    }
    // セリフ行
    if (currentTime && line && !/^\d+$/.test(line)) {
      const clean = line.replace(/<[^>]+>/g, '').replace(/[♪♫]/g, '');
      if (matches(clean)) return currentTime;
    }
  }
  return null;
}

// 現在のエピソードの生SRTを取得（メモリ優先→該当回のlocalStorageキャッシュ）
function getCurrentRawSrt() {
  const title     = selectedDrama?.englishTitle || selectedDrama?.title;
  const expectKey = subtitleCacheKey(title, selectedSeason, selectedEpisode);
  if (cachedRawSrt && cachedSubtitleKey === expectKey) return cachedRawSrt;
  const rawKey = subtitleRawCacheKey(title, selectedSeason, selectedEpisode);
  const raw = localStorage.getItem(rawKey) || '';
  if (raw) touchSubCache(rawKey); // よく見る回はLRUで残す
  return raw;
}

// 生SRTを {sec, text} のキュー配列にして「時刻昇順」で返す。
// 一部の字幕はブロックが時刻順に並んでいない（連結ファイル等）ため、必ず時刻でソートし直す。
// 同一エピソードの間はキャッシュして毎回パースしない。
let _cueCacheSig = '';
let _cueCacheArr = [];
function getSubtitleCues() {
  const title = selectedDrama?.englishTitle || selectedDrama?.title;
  const raw   = getCurrentRawSrt();
  const sig   = subtitleRawCacheKey(title, selectedSeason, selectedEpisode) + ':' + raw.length;
  if (_cueCacheSig === sig) return _cueCacheArr;

  const cues = [];
  raw.split(/\r?\n\r?\n/).forEach(block => {
    const lines = block.split(/\r?\n/);
    const tIdx  = lines.findIndex(l => /-->/.test(l));
    if (tIdx === -1) return;
    const mt = lines[tIdx].match(/(\d{2}):(\d{2}):(\d{2})/);
    if (!mt) return;
    const sec  = (+mt[1]) * 3600 + (+mt[2]) * 60 + (+mt[3]);
    const text = lines.slice(tIdx + 1).join(' ')
      .replace(/<[^>]+>/g, '').replace(/[♪♫]/g, '')
      .replace(/[’'`]/g, "'").replace(/\s+/g, ' ')
      .trim().toLowerCase();
    if (text) cues.push({ sec, text });
  });
  cues.sort((a, b) => a.sec - b.sec); // 時刻順に整える（順序の乱れを補正）

  _cueCacheSig = sig;
  _cueCacheArr = cues;
  return cues;
}

function secToTimeLabel(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 単語が最初に登場する秒数。見つからなければ null。
// 単語（フレーズは全トークン）のバリアントが同一キューに揃う最初の時刻を返す。
// ※以前は example（例文）一致を優先していたが、例文先頭が別の早い行に偶然一致して
//   時刻が早くズレる不具合があったため、単語ベースのマッチのみにする。
function findWordCueSec(word) {
  const cues = getSubtitleCues();
  if (!cues.length) return null;
  const res = word.toLowerCase().trim().split(/\s+/).map(tok => {
    const variants = [...getWordVariants(tok)].map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`\\b(${variants.join('|')})\\b`, 'i');
  });
  for (const c of cues) if (res.every(re => re.test(c.text))) return c.sec;
  return null;
}

// ── VOD実時刻によるタイムスタンプ補正（ハイブリッド）──────────────────────
// 拡張機能が視聴中に記録した「字幕テキスト ↔ VODの実時刻」のアンカーを使い、
// OpenSubtitles の時刻を VOD の時間軸に補正する。
//   vod ≈ a × os + b   （a=傾き：フレームレート差、b=オフセット：あらすじ尺差）
// アンカー1点 → オフセットのみ(a=1)。2点以上が時間軸に散れば傾きも推定。
function fitVodSync(pairs) {
  if (!pairs.length) return null;
  const offsets = pairs.map(p => p.vod - p.os).sort((x, y) => x - y);
  const medianOffset = { a: 1, b: offsets[Math.floor(offsets.length / 2)] };
  if (pairs.length < 2) return medianOffset;

  const xs   = pairs.map(p => p.os);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 120) return medianOffset; // 散らばりが2分未満なら傾き推定は不安定

  // 最小二乗で a,b を推定
  const n   = pairs.length;
  const sx  = xs.reduce((s, x) => s + x, 0);
  const sy  = pairs.reduce((s, p) => s + p.vod, 0);
  const sxx = pairs.reduce((s, p) => s + p.os * p.os, 0);
  const sxy = pairs.reduce((s, p) => s + p.os * p.vod, 0);
  const a   = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b   = (sy - a * sx) / n;
  // 異常な傾きは信頼せずオフセットのみにフォールバック
  if (!isFinite(a) || a < 0.8 || a > 1.25) return medianOffset;
  return { a, b };
}

let _syncFitSig = '';
let _syncFit    = null;
function getVodSyncFit() {
  const cues = getSubtitleCues();
  const sig  = `${selectedDrama?.englishTitle || selectedDrama?.title}_s${selectedSeason}e${selectedEpisode}_${cues.length}`;
  if (_syncFitSig === sig) return _syncFit;
  _syncFitSig = sig;
  _syncFit    = null;
  if (!cues.length) return null;

  // 該当S/Eの cl_vodsync_* アンカーを集める（タイトル表記差に強くするため
  // キーは S/E で絞り、実際の対応付けは字幕テキスト一致で行う）
  const suffix = `_s${selectedSeason}e${selectedEpisode}`;
  const anchors = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('cl_vodsync_') || !k.endsWith(suffix)) continue;
    try { (JSON.parse(localStorage.getItem(k)) || []).forEach(a => anchors.push(a)); } catch {}
  }
  if (!anchors.length) return null;

  // 文字列を「英数字＋スペース」だけに正規化（話者ダッシュ・記号・改行を除去）
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[’'`]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

  // アンカーの字幕を OpenSubtitles cue に照合 → (os, vod) ペア
  // VOD字幕は話者ダッシュや複数行連結で表記が揺れるため、記号を落として
  // 「先頭の数語」で照合する（前半5語→無理なら3語）。
  const pairs = [];
  for (const a of anchors) {
    const words = norm(a.text).split(' ').filter(w => w.length > 1);
    if (words.length < 3) continue;
    const key5 = words.slice(0, 5).join(' ');
    const key3 = words.slice(0, 3).join(' ');
    const c = cues.find(c => norm(c.text).includes(key5))
           || cues.find(c => norm(c.text).includes(key3));
    if (c) pairs.push({ os: c.sec, vod: a.t });
  }
  // 偏りガード：アンカーが時間軸の一部に固まっていると、傾き推定が不安定で
  // 範囲外（特に冒頭）に外挿すると時刻が壊れる。前半と後半の両方をカバー、
  // または全体の50%以上にまたがる場合のみ補正を信頼する。
  if (pairs.length) {
    const total  = cues[cues.length - 1].sec || 1;
    const osv    = pairs.map(p => p.os);
    const minOs  = Math.min(...osv), maxOs = Math.max(...osv);
    const spread = (maxOs - minOs) / total;
    const trustworthy = (minOs < total * 0.35 && maxOs > total * 0.65) || spread > 0.5;
    if (!trustworthy) {
      console.log(`[vodsync] アンカーが時間軸の一部（約${Math.round(minOs/60)}〜${Math.round(maxOs/60)}分）に偏っているため補正を見送り、原時刻を使います。前半と後半の両方を視聴すると補正できます。`);
      return null; // 補正せず OpenSubtitles 原時刻を使う
    }
  }

  _syncFit = fitVodSync(pairs);
  if (_syncFit) {
    console.log(`[vodsync] 補正 a=${_syncFit.a.toFixed(3)} b=${Math.round(_syncFit.b)}秒 (照合${pairs.length}点)`);
  }
  return _syncFit;
}
function applyVodSync(sec) {
  const f = getVodSyncFit();
  return f ? Math.max(0, Math.round(f.a * sec + f.b)) : sec;
}

// 表示用タイムスタンプ "分:秒"（見つからなければ null。VOD補正を適用）
function findWordTimestamp(word) {
  const sec = findWordCueSec(word);
  return sec == null ? null : secToTimeLabel(applyVodSync(sec));
}

// 並べ替え用の秒数（時刻なしは末尾に回すため Infinity。VOD補正を適用）
function wordSortSeconds(word) {
  const sec = findWordCueSec(word);
  return sec == null ? Infinity : applyVodSync(sec);
}

// シーズン・エピソード選択肢を動的に構築する
// 映画/ドラマで シーズン・エピソード セレクターの表示を切り替える
function setEpisodeSelectorMode(isMovie) {
  const fields = document.getElementById('seasonEpisodeFields');
  const label  = document.getElementById('episodeSelectorLabel');
  if (fields) fields.style.display = isMovie ? 'none' : 'contents';
  if (label)  label.textContent = isMovie
    ? '🎬 映画（字幕から単語を予習）'
    : '視聴するエピソードを選択';
}

// 表示用の S/E ラベル（映画は空文字）
function episodeLabelText() {
  return selectedDrama?.type === 'movie'
    ? '' : ` S${selectedSeason}E${selectedEpisode}`;
}

function buildSeasonEpisodeSelectors(seasons) {
  const seasonSelect = document.getElementById('seasonSelect');
  seasonSelect.innerHTML = '';
  seasons.forEach(s => {
    seasonSelect.innerHTML += `<option value="${s.season}">Season ${s.season}</option>`;
  });
  // 最初のシーズンのエピソード数をセット
  updateEpisodeSelector(seasons[0].episodes);
  document.getElementById('episodeSelected').textContent =
    'Season 1 Episode 1 を選択中';
}

// エピソード選択肢を更新する
function updateEpisodeSelector(episodeCount) {
  const episodeSelect = document.getElementById('episodeSelect');
  episodeSelect.innerHTML = '';
  for (let i = 1; i <= episodeCount; i++) {
    episodeSelect.innerHTML += `<option value="${i}">Episode ${i}</option>`;
  }
}

// エピソード変更時：字幕を即座に読み込む
// ※ シーズン変更は onSeasonChange() が担当するためここでは不要
async function onEpisodeChange() {
  await triggerEpisodeLoad();
}

// エピソード読み込みをトリガーする
async function triggerEpisodeLoad() {
  selectedSeason = parseInt(document.getElementById('seasonSelect').value);
  selectedEpisode = parseInt(document.getElementById('episodeSelect').value);
  saveSettings();

  document.getElementById('vocabNextBtn').style.display = 'none'; document.getElementById('vocabDeleteBtn').style.display = 'none';
  document.getElementById('vocabGenBtn').style.display = '';
  vocabWords = [];
  quizData = [];

  // 保存済み単語があれば即表示して字幕ロードをスキップ
  if (await checkAndShowSavedVocab()) {
    const cacheKey = subtitleCacheKey(
      selectedDrama?.englishTitle || selectedDrama?.title,
      selectedSeason, selectedEpisode
    );
    if (selectedDrama && !localStorage.getItem(cacheKey)) {
      preloadSubtitleSilent(cacheKey);
    }
    return;
  }

  document.getElementById('episodeSelected').textContent =
    `Season ${selectedSeason} Episode ${selectedEpisode} を選択中`;
  document.getElementById('vocabSection').innerHTML =
    '<div class="loading"><div class="spinner"></div>字幕を読み込み中...</div>';
  document.getElementById('vocabGenBtn').disabled = true;
  document.getElementById('vocabGenBtn').textContent = '読み込み中...';

  await preloadSubtitle();
}

// 字幕キャッシュのキー
function subtitleCacheKey(title, season, episode) {
  const safe = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `cl_sub_${safe}_s${season}e${episode}`;
}
function subtitleRawCacheKey(title, season, episode) {
  const safe = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `cl_sub_raw_${safe}_s${season}e${episode}`;
}

// ── 字幕キャッシュのLRU上限 ─────────────────────────────────────
// 字幕は1話≈100KB（生SRT70KB＋パース済30KB）と重く、無制限に貯まると
// localStorage（≈5MB）を圧迫して QuotaExceeded で保存が壊れる。
// 最終利用時刻を cl_sub_lru に記録し、古いものから自動削除する。
const SUB_LRU_KEY     = 'cl_sub_lru';
const SUB_RAW_MAX     = 10; // 生SRT（重い）は直近10話分
const SUB_PARSED_MAX  = 20; // パース済は直近20話分

function touchSubCache(...keys) {
  try {
    const lru = JSON.parse(localStorage.getItem(SUB_LRU_KEY) || '{}');
    keys.forEach(k => { if (k) lru[k] = Date.now(); });
    localStorage.setItem(SUB_LRU_KEY, JSON.stringify(lru));
  } catch { /* LRU記録の失敗は無視（次回touchで回復） */ }
}

function evictSubCaches() {
  try {
    const lru = JSON.parse(localStorage.getItem(SUB_LRU_KEY) || '{}');
    const rawKeys = [], parsedKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k === SUB_LRU_KEY) continue;
      if (k.startsWith('cl_sub_raw_'))   rawKeys.push(k);
      else if (k.startsWith('cl_sub_'))  parsedKeys.push(k);
    }
    // 最終利用が古い順に並べ、上限超過分を削除（LRU未記録は最古扱い）
    const evict = (keys, max) => {
      if (keys.length <= max) return;
      keys.sort((a, b) => (lru[a] || 0) - (lru[b] || 0));
      keys.slice(0, keys.length - max).forEach(k => {
        localStorage.removeItem(k);
        delete lru[k];
        console.log('[subCache] LRU削除:', k);
      });
    };
    evict(rawKeys, SUB_RAW_MAX);
    evict(parsedKeys, SUB_PARSED_MAX);
    localStorage.setItem(SUB_LRU_KEY, JSON.stringify(lru));
  } catch { /* 失敗しても致命的ではない */ }
}

// 拡張機能で保存した単語のうち、現ドラマ・エピソードに一致するものを返す
// S/E 不明の単語は字幕キャッシュで出現を確認してフィルタリング
// ─── タイトル名寄せ（日本語 → 英語）────────────────────────────────────────
// アマプラは日本語タイトル（例：オフキャンパス）で保存する一方、Webアプリの
// ドラマは英語/TMDB名（例：Off Campus）。文字列では一致しないため、TMDB で
// 日本語タイトルを英語名に解決し localStorage にキャッシュして名寄せする。
function getTitleAliasMap() {
  try { return JSON.parse(localStorage.getItem('cl_title_alias') || '{}'); }
  catch { return {}; }
}
function saveTitleAlias(jp, en) {
  if (!jp || !en) return;
  const map = getTitleAliasMap();
  if (map[jp] === en) return;
  map[jp] = en;
  try { localStorage.setItem('cl_title_alias', JSON.stringify(map)); } catch {}
}
async function resolveEnglishTitle(jpTitle) {
  if (!jpTitle) return null;
  // ASCII のみ（既に英語）なら解決不要
  if (/^[\x00-\x7F]+$/.test(jpTitle)) return jpTitle;
  const cache = getTitleAliasMap();
  if (cache[jpTitle]) return cache[jpTitle];
  try {
    const searchRes = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query: jpTitle })
    });
    const searchData = await searchRes.json();
    const show = searchData.results?.[0];
    if (!show) return null;
    const detailRes = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seasons', tvId: show.id })
    });
    const detail = await detailRes.json();
    const en = detail.name || show.original_name || null;
    if (en) saveTitleAlias(jpTitle, en);
    return en;
  } catch { return null; }
}

async function getMyWordsForEpisode(dramaTitle, season, episode) {
  if (!dramaTitle) return [];
  const words = await getActiveWords();

  // 比較用タイトル候補（選択中ドラマの title と englishTitle 両方）
  const titleCandidates = [
    dramaTitle,
    selectedDrama?.title,
    selectedDrama?.englishTitle,
  ].filter(Boolean).map(t => t.toLowerCase());

  // この回（S/E 一致）の単語の日本語タイトルを TMDB で英語名に名寄せ（キャッシュ優先）。
  // ネットワークは未キャッシュの日本語タイトルのみ・該当回の単語に限定する。
  const seWords = words.filter(w =>
    w.dramaTitle && w.season != null && w.episode != null &&
    w.season == season && w.episode == episode
  );
  const aliasCache = getTitleAliasMap();
  const toResolve = [...new Set(
    seWords.map(w => w.dramaTitle)
      .filter(t => !/^[\x00-\x7F]+$/.test(t) && !aliasCache[t])
  )];
  for (const t of toResolve) { await resolveEnglishTitle(t); }
  const alias = getTitleAliasMap();

  // 元タイトル + 名寄せ後タイトルのいずれかが候補と相互包含すれば一致
  const titleMatches = (w) => {
    const names = [w.dramaTitle, alias[w.dramaTitle]]
      .filter(Boolean).map(s => s.toLowerCase());
    return names.some(wl => titleCandidates.some(tc => wl.includes(tc) || tc.includes(wl)));
  };

  // 現エピソードの字幕キャッシュ（S/E 不明な単語の照合にのみ使用）
  const episodeSub = (
    cachedSubtitleText ||
    localStorage.getItem(subtitleCacheKey(dramaTitle, season, episode)) ||
    localStorage.getItem(subtitleCacheKey(selectedDrama?.englishTitle, season, episode)) ||
    ''
  ).toLowerCase();

  const result = words.filter(w => {
    if (!w.dramaTitle) return false;
    // タイトル一致が必須（名寄せ込み）。これにより別作品の同 S/E 単語の混入を防ぐ。
    if (!titleMatches(w)) return false;
    if (w.season != null && w.episode != null) {
      return w.season == season && w.episode == episode; // 数値/文字列差に == で対応
    }
    // S/E 不明の単語のみ：字幕に登場するかで判定
    return episodeSub ? episodeSub.includes(w.word.toLowerCase()) : false;
  });
  return result;
}

// 未割当単語をキャッシュ済み字幕から自動解決してストアを更新する
async function resolveUnassignedWords() {
  const words = await getActiveWords();
  const unassigned = words.filter(w => w.dramaTitle && w.season == null);
  if (!unassigned.length) return;

  // 現在のエピソードの字幕（メモリ）を先頭に、その後 localStorage の全 cl_sub_* キーを検索
  // 履歴に存在しないエピソードも対象にするため history ではなく localStorage を直接スキャン
  const subEntries = []; // { titleKey, season, episode, sub }

  // ① 現在ロード済みの字幕（最優先）
  if (cachedSubtitleText && selectedDrama && selectedSeason && selectedEpisode) {
    subEntries.push({
      titleKey: (selectedDrama.englishTitle || selectedDrama.title).toLowerCase(),
      season:   selectedSeason,
      episode:  selectedEpisode,
      sub:      cachedSubtitleText.toLowerCase(),
    });
  }

  // ② localStorage の cl_sub_* キーをすべてスキャン（直近保存順は不定だが全件検索）
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('cl_sub_')) continue;
    // キー形式: cl_sub_{title}_s{N}e{N}
    const m = key.match(/^cl_sub_(.+)_s(\d+)e(\d+)$/);
    if (!m) continue;
    const sub = localStorage.getItem(key);
    if (!sub) continue;
    subEntries.push({
      titleKey: m[1],
      season:   parseInt(m[2]),
      episode:  parseInt(m[3]),
      sub:      sub.toLowerCase(),
    });
  }

  let changed = false;
  for (const w of unassigned) {
    const tl = w.dramaTitle.toLowerCase().replace(/[^a-z0-9]/g, '_');
    for (const entry of subEntries) {
      // タイトルの緩やかな一致
      if (!entry.titleKey.includes(tl.slice(0, 5)) && !tl.includes(entry.titleKey.slice(0, 5))) continue;
      if (entry.sub.includes(w.word.toLowerCase())) {
        w.season  = entry.season;
        w.episode = entry.episode;
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    await store.set(myWordsKey(), words);
    console.log('[CineLearn] 未割当単語のエピソードを自動解決しました');
  }
}

// 「追加した単語」セクションを vocabSection の末尾に追加する
// buildWordHTML の外部版（拡張機能単語・マイ単語帳など renderVocab 外で使用）
// srs: ループで呼ぶ場合は loadSrs() の結果を渡す（毎回のJSON.parseを避ける）
function buildExtWordHTML(w, srs = loadSrs()) {
  const status     = getWordStatus(w.word, srs);
  const isMast     = status === 'mastered';
  const isSkip     = status === 'skipped';
  const srsEntry   = srs[w.word.toLowerCase()];
  const reviewCount = srsEntry?.reviewCount || 0;
  const hasReviewed = !!srsEntry?.lastReview;
  const reviewCountLabel = reviewCount > 0
    ? `<span class="review-count-label">${reviewCount}回復習済み</span>`
    : hasReviewed ? `<span class="review-count-label">復習済み</span>` : '';
  const srsBadge = statusBadgeHTML(status);
  const nextReview = nextReviewLabel(w.word, srs);
  const nextLabel  = nextReview ? `<span class="srs-next-review">📅 次回: ${nextReview}</span>` : '';
  const timestamp  = findWordTimestamp(w.word);
  const tsLabel    = timestamp ? `<span class="word-timestamp" data-time="${timestamp}">📍 ${timestamp}</span>` : '';
  const tier = w.tier || 'core';
  const tierBadge = tier === 'context'  ? '<span class="tier-pill tier-context">Context</span>'
                  : tier === 'advanced' ? '<span class="tier-pill tier-advanced">Advanced</span>'
                  :                      '<span class="tier-pill tier-core">Core</span>';
  return `
    <div class="vocab-item${isMast ? ' vocab-mastered' : ''}${status === 'learned' ? ' vocab-learned' : ''}${isSkip ? ' vocab-skipped' : ''}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${srsBadge}
          <div class="vocab-word">${esc(w.word)}</div>
          ${tierBadge}
          ${nextLabel}
          ${reviewCountLabel}
          ${tsLabel}
        </div>
        ${w.example ? `<div class="word-example-wrap">
          <span class="word-example-en">${esc(w.example)}</span>
          ${w.example_ja ? `<span class="word-example-ja">${esc(w.example_ja)}</span>` : ''}
        </div>` : ''}
      </div>
      <div class="vocab-pos">${esc(w.pos || '')}</div>
      <div class="vocab-def">${esc(w.definition || '')}</div>
      <div class="vocab-card-actions">
        <button class="btn-speak" data-word="${esc(w.word)}">🔊</button>
        <button class="btn-srs-skip${isSkip ? ' btn-srs-resume' : ''}" data-word="${esc(w.word)}">${isSkip ? 'Resume' : 'Skip'}</button>
      </div>
    </div>`;
}

// 英語定義を日本語に翻訳してlocalStorageに保存する
async function translateExtWordDefinitions(extWords) {
  // 日本語文字を含まない定義（＝英語）を持つ単語だけ対象
  const needsTranslation = extWords.filter(w =>
    w.definition && !/[぀-ヿ一-鿿]/.test(w.definition)
  );
  if (!needsTranslation.length) return;

  const BATCH = 10;
  for (let i = 0; i < needsTranslation.length; i += BATCH) {
    const batch = needsTranslation.slice(i, i + BATCH);
    const inputArr = batch.map(w => ({ word: w.word, definition: w.definition, definition_ja: '' }));
    const prompt = `以下のJSON配列の各単語について、definition（英語の意味説明）を簡潔な日本語に翻訳してdefinition_jaに入れてください。
- 簡潔に（10文字以内が理想）
- JSON配列のみ返答（説明不要）

${JSON.stringify(inputArr)}`;

    try {
      const text   = await callClaude(prompt, 800);
      const rawArr = text.match(/\[[\s\S]*\]/)?.[0] || '[]';
      let arr = [];
      try { arr = JSON.parse(rawArr); } catch { arr = JSON.parse(repairJson(rawArr)); }

      // 翻訳結果を元の extWords に反映して localStorage に保存
      const store = window._clStore || { get: k => JSON.parse(localStorage.getItem(k)||'[]'), set: (k,v) => localStorage.setItem(k, JSON.stringify(v)) };
      const allWords = await store.get(myWordsKey()) || [];
      let changed = false;
      arr.forEach(item => {
        if (!item?.word || !item?.definition_ja?.trim()) return;
        const orig = extWords.find(w => w.word.toLowerCase() === item.word.toLowerCase());
        if (orig) { orig.definition = item.definition_ja.trim(); }
        const stored = allWords.find(w => w.word?.toLowerCase() === item.word.toLowerCase());
        if (stored) { stored.definition = item.definition_ja.trim(); changed = true; }
      });
      if (changed) {
        await store.set(myWordsKey(), allWords);
        // 翻訳完了後に表示を更新
        if (selectedDrama && document.getElementById('screen-4')?.classList.contains('active')) {
          document.getElementById('ext-words-section')?.remove();
          renderExtWordsSection(vocabWords);
        }
      }
    } catch(e) { console.error('[translateExtWordDefs]', e); }
  }
}

async function renderExtWordsSection(existingWords = []) {
  if (!selectedDrama) return;
  const extWords = await getMyWordsForEpisode(selectedDrama.title, selectedSeason, selectedEpisode);

  // 英語定義をバックグラウンドで日本語に翻訳
  translateExtWordDefinitions(extWords);

  const existingSet = new Set(existingWords.map(w => w.word.toLowerCase()));
  const newExt = extWords.filter(w => !existingSet.has(w.word.toLowerCase()));
  if (newExt.length === 0) return;

  const sect = document.getElementById('vocabSection');
  if (!sect) return;
  // 前回の拡張機能単語セクションがあれば置き換え
  document.getElementById('ext-words-section')?.remove();

  // 拡張機能単語を buildWordHTML 互換の形式に変換
  const extNormalized = newExt.map(w => ({
    word:       w.word,
    pos:        w.pos        || '',
    definition: w.definition || '',
    example:    w.sentence   || '',   // sentence → example にマッピング
    example_ja: w.example_ja || '',
    tier:       w.tier       || 'core',
    source:     'ext',
  }));
  // 登場時刻順に並べ替え（時刻なしは末尾）
  extNormalized.sort((a, b) =>
    wordSortSeconds(a.word) - wordSortSeconds(b.word)
  );

  const div = document.createElement('div');
  div.id = 'ext-words-section';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'source-label';
  labelDiv.style.marginTop = '14px';
  labelDiv.textContent = '✏️ 追加した単語';
  div.appendChild(labelDiv);

  const listDiv = document.createElement('div');
  listDiv.className = 'vocab-list';
  // buildWordHTML を呼ぶために一時的に words コンテキストを利用
  // SRSを1回だけロードして全カードで共有し、HTMLは join で一括挿入する
  const extSrs = loadSrs();
  listDiv.innerHTML = extNormalized.map(w => buildExtWordHTML(w, extSrs)).join('');
  div.appendChild(listDiv);
  sect.appendChild(div);

  // 拡張機能単語を currentVocabWords にマージ（復習対象に含める）
  const existingWordSet = new Set(currentVocabWords.map(w => w.word.toLowerCase()));
  extNormalized.forEach(w => {
    if (!existingWordSet.has(w.word.toLowerCase())) {
      currentVocabWords.push(w);
    }
  });

  // スピーク・スキップ・タイムスタンプのイベントを付与
  listDiv.addEventListener('click', e => {
    const speakBtn = e.target.closest('.btn-speak');
    if (speakBtn && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(speakBtn.dataset.word);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
    const skipBtn = e.target.closest('.btn-srs-skip');
    if (skipBtn) {
      skipBtn.classList.contains('btn-srs-resume')
        ? unskipWord(skipBtn.dataset.word)
        : skipWord(skipBtn.dataset.word);
      renderExtWordsSection(existingWords);
    }
    const tsLabel = e.target.closest('.word-timestamp');
    if (tsLabel) {
      navigator.clipboard.writeText(tsLabel.dataset.time).then(() => {
        const orig = tsLabel.textContent;
        tsLabel.textContent = '✅ コピー完了';
        setTimeout(() => { tsLabel.textContent = orig; }, 1500);
      });
    }
  });
}

// 保存済み単語をチェックして表示する（履歴あり → true）
async function checkAndShowSavedVocab() {
  if (!selectedDrama) return false;
  const history = loadHistory();
  const entry = history.find(h =>
    h.drama.title === selectedDrama.title &&
    h.season === selectedSeason &&
    h.episode === selectedEpisode
  );

  if (entry?.words?.length) {
    let words = entry.words;

    // 自己修復：拡張機能由来(source:'ext')の単語を現在のロジックで再検証し、
    // 別作品混入などで無効になったものを除去する（AI生成語は対象外）。
    // 修正前に誤って焼き込まれた単語（例：別作品の同 S/E 語）を遡って掃除する。
    if (words.some(w => w.source === 'ext')) {
      try {
        const validExt = await getMyWordsForEpisode(
          selectedDrama.title, selectedSeason, selectedEpisode
        );
        const validSet = new Set(validExt.map(w => w.word.toLowerCase()));
        const cleaned = words.filter(w =>
          w.source !== 'ext' || validSet.has(w.word.toLowerCase())
        );
        if (cleaned.length !== words.length) {
          words = cleaned;
          entry.words = cleaned;
          localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
          // クラウド履歴も更新
          if (typeof sbFetch !== 'undefined' && isLoggedIn()) {
            sbFetch(`/rest/v1/history?id=eq.${entry.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ words: cleaned })
            }).catch(() => {});
          }
        }
      } catch { /* 再検証失敗時は元の単語をそのまま使う */ }
    }

    vocabWords       = words;
    quizData         = entry.quiz || [];
    currentHistoryId = entry.id;
    document.getElementById('episodeSelected').textContent =
      selectedDrama?.type === 'movie'
        ? '✓ 保存済み'
        : `Season ${selectedSeason} Episode ${selectedEpisode} ✓ 保存済み`;
    document.getElementById('vocabGenBtn').style.display = 'none';
    renderVocab(words, `${selectedDrama.title}${episodeLabelText()}`, true);
    return true;
  }

  // 履歴単語なし → 拡張機能単語のみチェック
  const extWords = await getMyWordsForEpisode(selectedDrama.title, selectedSeason, selectedEpisode);
  if (extWords.length === 0) return false;

  // 拡張機能単語のみの場合：生成ボタンを表示しつつ追加単語セクションを表示
  document.getElementById('episodeSelected').textContent =
    selectedDrama?.type === 'movie'
      ? '🎬 映画'
      : `Season ${selectedSeason} Episode ${selectedEpisode}`;
  document.getElementById('vocabSection').innerHTML =
    '<div class="empty-state" style="padding:20px">「単語を生成」でAIの単語リストを追加できます</div>';
  document.getElementById('vocabGenBtn').style.display = '';
  document.getElementById('vocabGenBtn').disabled = false;
  document.getElementById('vocabGenBtn').textContent = '単語を生成';
  document.getElementById('vocabNextBtn').style.display = 'none'; document.getElementById('vocabDeleteBtn').style.display = 'none';
  await renderExtWordsSection([]);
  return true;
}

// 字幕を事前に読み込んでおく
let cachedSubtitleText   = '';
let cachedSubtitleSource = '';
let cachedRawSrt         = ''; // タイムスタンプ検索用の生SRT
let cachedSubtitleKey    = ''; // cachedSubtitleText がどのエピソードの字幕かを示すキー

// 字幕候補の選別（全取得経路で共通）。
// TVは feature_details のシーズン・エピソードが「両方」一致する候補だけに絞り、
// HI字幕・メイキング/予告編などを減点したスコア降順で返す。
// 取得経路ごとに選別ロジックが分かれていると、再取得時に別品質・別エピソードの
// ファイルを掴む事故が起きるため、必ずこの関数を通すこと。
function selectSubtitleCandidates(subtitles, isMovie) {
  if (!Array.isArray(subtitles) || !subtitles.length) return [];

  let candidates = subtitles;
  if (!isMovie) {
    const matched = subtitles.filter(s => {
      const f = s.attributes.feature_details || {};
      return Number(f.season_number)  === Number(selectedSeason) &&
             Number(f.episode_number) === Number(selectedEpisode);
    });
    if (matched.length) candidates = matched;
    else console.warn('[subtitle] S/E一致候補が0件のため全候補から選択します');
  }

  // ランク方式：減点方式だとダウンロード数が大きいHI字幕等が通常字幕に勝って
  // しまうため、まず品質ランクで分類し、同ランク内だけDL数で順位付けする。
  //   rank 0: 本編のクリーンな字幕
  //   rank 1: HI字幕（聴覚障害者向け・効果音記述が多く学習に不向き）/ forced
  //   rank 2: メイキング・予告編等の本編以外 / 映画検索でのTV項目
  const rank = (sub) => {
    const attr = sub.attributes;
    const name = (attr.release || attr.files?.[0]?.file_name || '').toLowerCase();
    const featTitle = (attr.feature_details?.title || attr.feature_details?.movie_name || '').toLowerCase();
    if (/(making|behind.the.scenes|featurette|trailer|interview|documentary|deleted|bonus|extra|commentary|bloopers?|gag\s*reel|sample)/.test(name + ' ' + featTitle)) return 2;
    if (isMovie && attr.feature_details?.feature_type &&
        attr.feature_details.feature_type !== 'Movie') return 2;
    if (attr.hearing_impaired) return 1;
    if (/\b(hi|hearing|sdh|forced)\b/.test(name)) return 1;
    return 0;
  };
  return [...candidates].sort((a, b) =>
    rank(a) - rank(b) ||
    (b.attributes.download_count || 0) - (a.attributes.download_count || 0)
  );
}

async function preloadSubtitle() {
  cachedSubtitleText = '';
  cachedSubtitleSource = '';
  cachedSubtitleKey = '';


  try {
    const searchTitle = selectedDrama.englishTitle || selectedDrama.title;
    const isMovie = selectedDrama.type === 'movie';
    const subtitles = await searchSubtitles(
      searchTitle,
      selectedSeason,
      selectedEpisode,
      isMovie ? 'movie' : 'tv',
      isMovie ? selectedDrama.tmdbId : null
    );

    // S/E一致フィルタ＋品質スコアリング（全経路共通ヘルパー）
    const sorted = selectSubtitleCandidates(subtitles, isMovie);

    if (sorted.length > 0) {

      // 上位3候補を試して、♪が少ないものを採用
      let fileId = null, fileName = null, srtText = null, chosen = null;
      for (const cand of sorted.slice(0, 3)) {
        const fid   = cand.attributes.files[0].file_id;
        const fname = cand.attributes.release || cand.attributes.files[0]?.file_name || fid;
        const text  = await downloadSubtitle(fid);
        if (!text) continue;
        // ♪記号の割合が5%超 → 音楽字幕として却下
        const musicRatio = (text.match(/♪/g) || []).length / (text.length / 100);
        if (musicRatio > 5) { console.log(`[subtitle] skip music file: ${fname}`); continue; }
        fileId = fid; fileName = fname; srtText = text; chosen = cand;
        break;
      }
      if (!fileId) { chosen = sorted[0]; fileId = sorted[0].attributes.files[0].file_id; fileName = '(fallback)'; srtText = await downloadSubtitle(fileId); }
      cachedSubtitleText = parseSrt(srtText);
      cachedRawSrt       = srtText; // タイムスタンプ検索用に生SRTを保持
      cachedSubtitleSource = '実際の字幕データから';
      // 選んだ字幕の「実際の」シーズン・エピソードも併記（検証用）
      const cf = chosen?.attributes?.feature_details || {};
      const actualSE = isMovie ? 'movie' : `S${cf.season_number}E${cf.episode_number}`;
      console.log(`[subtitle] 要求 S${selectedSeason}E${selectedEpisode} / 実際 ${actualSE} → file: ${fileName} (id:${fileId})`);
      // 字幕テキストを永続キャッシュに保存（未割当単語のエピソード解決に使用）
      try {
        const title = selectedDrama.englishTitle || selectedDrama.title;
        const key    = subtitleCacheKey(title, selectedSeason, selectedEpisode);
        const rawKey = subtitleRawCacheKey(title, selectedSeason, selectedEpisode);
        localStorage.setItem(key, cachedSubtitleText);
        localStorage.setItem(rawKey, srtText); // 生SRTも保存
        cachedSubtitleKey = key; // メモリの字幕がどのエピソードか記録
        touchSubCache(key, rawKey);
        evictSubCaches(); // 上限超過分を古い順に削除
      } catch { /* QuotaExceeded は無視 */ }
      document.getElementById('episodeSelected').textContent =
        isMovie ? '✓ 字幕取得済み'
                : `Season ${selectedSeason} Episode ${selectedEpisode} ✓ 字幕取得済み`;
      const btn = document.getElementById('vocabGenBtn');
      if (btn) { btn.style.display = ''; btn.disabled = false; btn.textContent = '単語を生成'; }
      document.getElementById('vocabSection').innerHTML =
        '<div class="empty-state">「単語を生成」を押してください</div>';
      // 字幕取得直後に未割当単語を解決して拡張機能単語を即時表示
      resolveUnassignedWords()
        .then(() => renderExtWordsSection(vocabWords || []))
        .catch(() => {});
    } else {
      document.getElementById('episodeSelected').textContent =
        isMovie ? '⚠ 字幕なし'
                : `Season ${selectedSeason} Episode ${selectedEpisode} ⚠ 字幕なし`;
      document.getElementById('vocabSection').innerHTML =
        `<div class="empty-state" style="color:var(--text-muted)">${isMovie ? 'この映画' : 'このエピソード'}の字幕が見つかりませんでした。<br>${isMovie ? '別の作品を選択してください。' : '別のエピソードを選択してください。'}</div>`;
      const btn = document.getElementById('vocabGenBtn');
      if (btn) { btn.style.display = 'none'; }
    }
  } catch (e) {
    const isMovie = selectedDrama?.type === 'movie';
    document.getElementById('episodeSelected').textContent =
      isMovie ? '⚠ 字幕エラー'
              : `Season ${selectedSeason} Episode ${selectedEpisode} ⚠ 字幕エラー`;
    document.getElementById('vocabSection').innerHTML =
      '<div class="empty-state" style="color:var(--text-muted)">字幕の取得に失敗しました。<br>別のエピソードを選択してください。</div>';
    const btn = document.getElementById('vocabGenBtn');
    if (btn) { btn.style.display = 'none'; }
  }
}

// 字幕をサイレントにキャッシュ（UI 変更なし・拡張機能単語のエピソード照合用）
async function preloadSubtitleSilent(cacheKey) {
  try {
    const searchTitle = selectedDrama.englishTitle || selectedDrama.title;
    const isMovie = selectedDrama.type === 'movie';
    const subtitles = await searchSubtitles(
      searchTitle, selectedSeason, selectedEpisode,
      isMovie ? 'movie' : 'tv',
      isMovie ? selectedDrama.tmdbId : null
    );
    // S/E一致フィルタ＋品質スコアリング（全経路共通ヘルパー。
    // 従来はダウンロード数のみで選んでおりHI字幕等を掴む可能性があった）
    const sorted = selectSubtitleCandidates(subtitles, isMovie);
    if (!sorted.length) return;
    const best = sorted[0];
    const srtText = await downloadSubtitle(best.attributes.files[0].file_id);
    const text = parseSrt(srtText);
    if (!text) return;
    cachedSubtitleText = text;
    cachedRawSrt       = srtText;     // タイムスタンプ検索用に生SRTも保持
    cachedSubtitleKey  = cacheKey;
    try {
      localStorage.setItem(cacheKey, text);
      // 生SRTも該当回のキーで保存（タイムスタンプ検索に使用）
      const rawK = subtitleRawCacheKey(
        selectedDrama.englishTitle || selectedDrama.title,
        selectedSeason, selectedEpisode
      );
      localStorage.setItem(rawK, srtText);
      touchSubCache(cacheKey, rawK);
      evictSubCaches();
    } catch {}
    // キャッシュ取得後に拡張機能単語セクションを再描画
    await renderExtWordsSection(vocabWords || []);
    await resolveUnassignedWords();
  } catch {}
}

// ── 生成中ローディング画面（あらすじ＋学習Tips で待ち時間を体感させない） ──
const LEARNING_TIPS = [
  '復習はドラマを見た翌日の朝が最も定着します',
  '「わからない」が続いても大丈夫。最適なタイミングで再出題されます',
  '単語の🔊をタップすると発音が聞けます',
  '3週間後も思い出せたら⭐マスターです',
  '連続学習でストリークを伸ばしましょう🔥',
  '📍タイムスタンプはその単語が登場する時間です',
];
let _genTipTimer      = null;
let _genProgressTimer = null;
let _genPhaseFloor    = 5;   // 進捗バーの下限%（フェーズ進行で引き上げる）
let _synopsisCache    = {}; // tmdbId+S/E → あらすじ（再取得を防ぐ）

// ステータス文言から進捗バーの下限を決める（フェーズの目安）
function genPhaseFloorOf(status) {
  if (status.includes('字幕')) return 8;
  if (status.includes('分析') || status.includes('混雑')) return 30;
  return 5;
}

// あらすじをTMDBから取得（日本語優先はサーバー側で処理。失敗時は null）
async function fetchEpisodeSynopsis() {
  if (!selectedDrama?.tmdbId) return null;
  const isMovie = selectedDrama.type === 'movie';
  const key = `${selectedDrama.tmdbId}_${isMovie ? 'movie' : 's' + selectedSeason + 'e' + selectedEpisode}`;
  if (key in _synopsisCache) return _synopsisCache[key];
  try {
    const r = await fetch(`${API_BASE}/api/tmdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isMovie
        ? { action: 'episode_overview', movieId: selectedDrama.tmdbId }
        : { action: 'episode_overview', tvId: selectedDrama.tmdbId, season: selectedSeason, episode: selectedEpisode })
    });
    const d = await r.json();
    _synopsisCache[key] = d?.overview || null;
  } catch { _synopsisCache[key] = null; }
  return _synopsisCache[key];
}

// 生成中のリッチローディングを表示する。
// 既に表示中ならステータス文言と進捗フェーズだけ更新する（あらすじ・Tipsは維持）。
function showGenerationLoading(status) {
  const existing = document.getElementById('genLoadingStatus');
  if (existing) {
    existing.textContent = status;
    _genPhaseFloor = Math.max(_genPhaseFloor, genPhaseFloorOf(status));
    return;
  }

  document.getElementById('vocabSection').innerHTML = `
    <div class="gen-loading">
      <div class="loading"><div class="spinner"></div><span id="genLoadingStatus">${esc(status)}</span></div>
      <div class="gen-progress"><div class="gen-progress-fill" id="genProgressFill"></div></div>
      <div id="genSynopsis"></div>
      <div class="gen-tip-card">
        <div class="gen-tip-title">💡 学習Tips</div>
        <div class="gen-tip" id="genTip"></div>
      </div>
    </div>`;

  // 進捗バー：実際の進捗は取得できない（AIの1リクエスト待ち）ため、
  // 経過時間で95%まで漸近させる。完了時は画面ごと単語リストに置き換わる。
  // フェーズ変化（字幕→分析）で下限を引き上げて段階感を出す。
  _genPhaseFloor = genPhaseFloorOf(status);
  const startedAt = Date.now();
  clearInterval(_genProgressTimer);
  _genProgressTimer = setInterval(() => {
    const bar = document.getElementById('genProgressFill');
    if (!bar) { clearInterval(_genProgressTimer); _genProgressTimer = null; return; }
    const t   = (Date.now() - startedAt) / 1000;
    const pct = Math.min(95, _genPhaseFloor + (95 - _genPhaseFloor) * (1 - Math.exp(-t / 12)));
    bar.style.width = pct.toFixed(1) + '%';
  }, 250);

  // Tips：ランダム開始で4秒ごとにローテーション。
  // ローディング画面が消えたら（#genTip が無くなったら）自動停止する。
  let tipIdx = Math.floor(Math.random() * LEARNING_TIPS.length);
  const showTip = () => {
    const el = document.getElementById('genTip');
    if (!el) { clearInterval(_genTipTimer); _genTipTimer = null; return; }
    el.classList.remove('gen-tip-show');
    void el.offsetWidth; // フェードアニメーションを再トリガー
    el.textContent = LEARNING_TIPS[tipIdx % LEARNING_TIPS.length];
    el.classList.add('gen-tip-show');
    tipIdx++;
  };
  clearInterval(_genTipTimer);
  showTip();
  _genTipTimer = setInterval(showTip, 4000);

  // あらすじをAI生成と並行取得して即表示（取得失敗しても生成は止めない）
  fetchEpisodeSynopsis().then(ov => {
    const el = document.getElementById('genSynopsis');
    if (!el || !ov) return;
    const heading = selectedDrama?.type === 'movie'
      ? 'この映画のあらすじ' : 'このエピソードのあらすじ';
    el.innerHTML = `
      <div class="gen-synopsis">
        <div class="gen-synopsis-title">📖 ${heading}</div>
        <div class="gen-synopsis-text">${esc(ov)}</div>
      </div>`;
  }).catch(() => {});
}

// 単語を生成する（字幕はキャッシュ済み）
async function generateVocabFromEpisode() {
  if (!selectedDrama) return;

  const btn = document.getElementById('vocabGenBtn');
  btn.disabled = true;
  btn.textContent = '生成中...';

  showGenerationLoading('単語を分析中...');
  document.getElementById('vocabNextBtn').style.display = 'none'; document.getElementById('vocabDeleteBtn').style.display = 'none';

  try {
    // メモリ上の字幕が「現在のエピソード」のものか検証する。
    // エピソードを切り替えてもメモリ(cachedSubtitleText)が前の回のまま残ることがあり、
    // そのまま生成すると別エピソードの字幕で単語を作ってしまうため必ず突き合わせる。
    const expectKey = subtitleCacheKey(
      selectedDrama.englishTitle || selectedDrama.title,
      selectedSeason, selectedEpisode
    );
    if (!cachedSubtitleText || cachedSubtitleKey !== expectKey) {
      // まず該当エピソードの永続キャッシュ(localStorage)を見る
      const cached = localStorage.getItem(expectKey);
      if (cached) {
        cachedSubtitleText = cached;
        cachedSubtitleKey  = expectKey;
        cachedRawSrt       = localStorage.getItem(subtitleRawCacheKey(
          selectedDrama.englishTitle || selectedDrama.title,
          selectedSeason, selectedEpisode
        )) || '';
      } else {
        // キャッシュも無ければ取得
        btn.textContent = '字幕を読み込み中...';
        showGenerationLoading('字幕を読み込み中...');
        await preloadSubtitle();
        if (!cachedSubtitleText) {
          btn.disabled = false;
          btn.textContent = '単語を生成';
          return;
        }
      }
      btn.disabled = true;
      btn.textContent = '生成中...';
      // preloadSubtitle が vocabSection を書き換えるため、ローディングを再表示
      showGenerationLoading('単語を分析中...');
    }

    // TOEICスコア帯に基づく選択範囲を計算
    const cur  = toeicScore > 0 ? toeicScore : 0;
    const tgt  = targetToeicScore > 0 ? targetToeicScore : cur + 200;
    const lower = Math.max(0, cur - 200); // 現在スコアより200点下まで（復習帯）
    const upper = tgt;                    // 目標スコアが上限

    // 生成単語数：映画は尺が長いため増量（レベルに応じてスケールし最大150）。
    // ドラマ（TV）は従来通り vocabCount（20〜50）。
    const isMovieGen   = selectedDrama.type === 'movie';
    const genVocabCount = isMovieGen ? Math.min(150, vocabCount * 3) : vocabCount;
    // 最低総数（drama＋plus）。vocabCount を 30〜50 にクランプ。
    // drama が少ない回でも plus で補ってこの数以上にする。
    const minTotal = Math.min(50, Math.max(30, vocabCount));

    // ① TOEIC → CEFR に翻訳して指示（LLMは語彙難易度をCEFRで判断する方が正確）
    const curCefr    = toeicToCefr(cur);
    const targetBand = cefrTargetBand(cur, upper);

    // ②③ アンカー単語の例示＋簡単すぎる語の除外を明示
    const cefrAnchors = `語彙難易度の目安（CEFR）:
- A2: buy, start, happy, problem, important
- B1: decision, available, manage, schedule, suggest
- B2: negotiate, inevitable, comprehensive, deliberately, acknowledge
- C1: tenacity, scrutiny, paramount, ambivalent, meticulous
- C2: ineffable, perfunctory, recalcitrant`;

    const excludeList = `除外（ほぼ全ての学習者が既知のため絶対に選ばない）:
get, go, make, take, come, give, thing, good, bad, very, people, time, day, year,
know, want, like, need, look, see, say, tell, big, small, new, old, man, woman など中学英語レベルの基礎語`;

    const levelSpec = cur > 0
      ? `【学習者レベル】
- 現在のCEFR: ${curCefr}（TOEIC約${cur}点） / 目標: TOEIC約${upper}点
- ねらい目の難易度帯（最優先）: CEFR ${targetBand}
- 配分: ${targetBand} の上側の帯を約70%、復習として1つ下の帯を約30%
- 制約: ${targetBand} を大きく超える超難語は避け、A2未満の超基礎語は選ばない

${cefrAnchors}

${excludeList}`
      : `【学習者レベル】スコア未設定。中級〜中上級（CEFR B1〜B2）を中心に選ぶ。

${cefrAnchors}

${excludeList}`;

    // ④ 各単語に CEFR レベルを判定させて自己フィルタ（一貫性が上がる）
    const tierGuide = `各単語に必ず "level"（CEFR: A2/B1/B2/C1/C2 のいずれか）を付ける。
ねらい目帯（${targetBand}）を中心に選ぶ。ただし句動詞・イディオム・口語の比喩的用法・
ジャンル専門語は、単語の表層的な難易度に関わらず学習者がつまずきやすいので帯外でも含めてよい。
さらに "tier" を付ける：
- "core"    ：このエピソードの理解に必須の頻出語
- "advanced"：目標達成に向けて習得したい一段上の語
- "context" ：このドラマ・映画特有の専門語・固有表現・句動詞・イディオム`;

    const workLabel = selectedDrama.type === 'movie'
      ? `「${selectedDrama.title}」（映画）`
      : `「${selectedDrama.title}」Season ${selectedSeason} Episode ${selectedEpisode}`;
    const prompt = `以下は${workLabel} の実際の英語字幕テキストです。

---字幕テキスト---
${cachedSubtitleText}
---ここまで---

上記の字幕テキストを使って、以下のJSON形式のみで返答してください（説明不要）。

${levelSpec}

${tierGuide}

【重要ルール】
- drama の example は必ず字幕テキストから一字一句そのまま抜き出すこと（要約・言い換え禁止）
- example には必ず "word" に指定した単語（または活用形）が含まれていること
- example が見つからない場合は example を空文字 "" にすること（作文禁止）
- plus の example のみ自由に作文してよいが、必ず "word" を含めること

{
  "drama": [
    この字幕に実際に登場する単語を【最大${genVocabCount}個】。必ず字幕内に存在する単語のみ。
    数が足りなければ少なくてよく、数合わせのために字幕に無い単語をここ(drama)へ絶対に入れないこと（字幕に出てこない語をdramaに入れるのは禁止）。
    難易度は CEFR ${targetBand} を中心に選ぶ。内容語（名詞・動詞・形容詞・句動詞・イディオム）を優先し、機能語や固有名詞は避ける。
    特に次を積極的に拾うこと（字面の難易度が低くても学習者が調べたくなる）：
    句動詞・イディオム（例 pull off, get away with）、口語・スラング・比喩的な特殊用法（例 'shark'＝敏腕弁護士 のように、単語自体は平易でも文脈での意味を知らないと誤解する語を最優先）、この作品のジャンル特有の専門用語（法律・医療など）。
    重要：字幕の冒頭だけに偏らず、最初から最後まで全体を通して均等に選ぶこと。特に映画など長い字幕では、中盤・終盤に登場する単語も必ず含めること。
    { "word": "英単語（原形）", "level": "A2|B1|B2|C1|C2", "pos": "品詞（名詞/動詞/形容詞/副詞）", "definition": "日本語の意味（簡潔に）", "example": "字幕からそのままコピーした文（必ずwordの活用形を含む。見つからなければ空文字。ダブルクォートは使わず、シングルクォートに置換すること）", "example_ja": "exampleの自然な日本語訳（exampleが空なら空文字）", "tier": "core"|"advanced"|"context" }
  ],
  "plus": [
    この作品のテーマ・文脈に関連する字幕外の推奨単語。dramaの語数と合わせて【合計が最低${minTotal}語】になるように補うこと（dramaが少ない回ほど多めに。最低でも5個は出す・最大20個）。同じ CEFR ${targetBand} を中心に選ぶ。
    { "word": "英単語（原形）", "level": "A2|B1|B2|C1|C2", "pos": "品詞（名詞/動詞/形容詞/副詞）", "definition": "日本語の意味（簡潔に）", "example": "必ずwordを含む自然な英文を作文する（空にしないこと）", "example_ja": "exampleの自然な日本語訳（必須・空にしない）", "tier": "core"|"advanced"|"context" }
  ]
}`;

    // 出力トークン上限。実測：実際の字幕（長い例文を逐語抽出）では1単語あたり
    // ≈110〜120トークン必要（40語＋plus8で約4900トークン）。旧来の値（*80→3200,
    // *100→5000）は過小で、drama を出し切ると末尾の plus や各語の example が
    // 切り捨てられた（stop_reason=max_tokens）。変動に耐える余裕を持たせ、
    // モデル上限手前の 8000 で頭打ちにする。plus が最大20語まで増えるぶんも見込む。
    // 天井なので上げても実出力ぶんしか課金されない。
    const maxTokens = Math.min(8000, (genVocabCount + 25) * 120);
    const text = await callClaude(prompt, maxTokens, (attempt, waitSec) => {
      // ステータス行だけ更新（あらすじ・Tipsの表示は維持する）
      showGenerationLoading(`混雑中... ${waitSec}秒後に再試行 (${attempt}/3)`);
    });
    // JSON文字列内の不正クォート・制御文字を修正してからパース
    const rawJson = text.match(/\{[\s\S]*\}/)?.[0] || '{}';

    function repairJson(str) {
      let out = '';
      let inStr = false;
      let escaped = false;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (escaped) { out += ch; escaped = false; continue; }
        if (ch === '\\') { out += ch; escaped = true; continue; }
        if (ch === '"') {
          if (!inStr) { inStr = true; out += ch; continue; }
          // 文字列終了かどうかを判定：後続の非空白が : , } ] なら終了
          let j = i + 1;
          while (j < str.length && ' \t\r\n'.includes(str[j])) j++;
          const next = str[j];
          if (!next || ':,}]'.includes(next)) {
            inStr = false; out += ch;
          } else {
            // 埋め込みクォート → エスケープ
            out += '\\"';
          }
          continue;
        }
        if (inStr && (ch === '\n' || ch === '\r')) { out += ' '; continue; }
        if (inStr && ch === '\t') { out += ' '; continue; }
        out += ch;
      }
      return out;
    }

    // まず通常パースを試み、失敗したら個別オブジェクト抽出にフォールバック
    function extractWords(raw) {
      // 試行1: repairJson → JSON.parse
      try {
        const p = JSON.parse(repairJson(raw));
        if (p.drama || p.plus) return p;
      } catch {}

      // 試行2: drama/plus 配列の中身を個別に抽出
      // { "word": "...", ... } の形式のオブジェクトを正規表現で収集
      const drama = [], plus = [];
      // drama配列とplus配列の位置を特定
      const dramaMatch = raw.match(/"drama"\s*:\s*\[/);
      const plusMatch  = raw.match(/"plus"\s*:\s*\[/);
      const dramaStart = dramaMatch ? dramaMatch.index + dramaMatch[0].length : -1;
      const plusStart  = plusMatch  ? plusMatch.index  + plusMatch[0].length  : -1;

      function extractObjects(str, from, to) {
        const slice = str.slice(from, to > 0 ? to : undefined);
        const results = [];
        let depth = 0, objStart = -1;
        for (let i = 0; i < slice.length; i++) {
          if (slice[i] === '{') { if (depth === 0) objStart = i; depth++; }
          else if (slice[i] === '}') {
            depth--;
            if (depth === 0 && objStart >= 0) {
              try {
                const obj = JSON.parse(repairJson(slice.slice(objStart, i + 1)));
                if (obj.word) results.push(obj);
              } catch {}
              objStart = -1;
            }
          }
        }
        return results;
      }

      if (dramaStart >= 0) drama.push(...extractObjects(raw, dramaStart, plusStart));
      if (plusStart  >= 0) plus.push(...extractObjects(raw, plusStart));
      return { drama, plus };
    }

    const parsed   = extractWords(rawJson);
    const dramaWords = (parsed.drama || []).map(w => ({ ...w, source: 'drama', example_ja_ok: !!w.example_ja }));
    const plusWords  = (parsed.plus  || []).map(w => ({ ...w, source: 'plus',  example_ja_ok: !!w.example_ja }));
    let json = [...dramaWords, ...plusWords];

    // 後処理：例文に単語（または活用形）が含まれていない場合は例文を削除
    json = json.map(w => {
      if (!w.example) return w;
      const variants = getWordVariants(w.word);
      const exLower  = w.example.toLowerCase();
      const hasWord   = [...variants].some(v => {
        const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        return re.test(exLower);
      });
      return hasWord ? w : { ...w, example: '' };
    });

    // 後処理フィルター：除外語リストに含まれる単語を除去する
    if (typeof getExcludeSet === 'function' && toeicScore > 0) {
      const excluded = getExcludeSet(toeicScore);
      const before = json.length;
      json = json.filter(w => !excluded.has(w.word.toLowerCase()));
      if (json.length < before) {
        console.log(`[CineLearn] 除外語フィルター: ${before - json.length}語を除去 (${before}→${json.length}語)`);
      }
    }

    // CEFRバンド外フィルター：AIが付けた level を使い、目標帯から外れすぎる語を除去
    // （目標帯の1つ下＝復習帯までは許容。level未指定の語は残す）
    if (cur > 0) {
      const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      const band  = targetBand.split('〜');
      const loIdx = Math.max(0, order.indexOf(band[0]) - 1);
      const hiIdx = order.indexOf(band[band.length - 1]);
      if (hiIdx >= 0) {
        const before = json.length;
        json = json.filter(w => {
          // 句動詞・イディオム（複数語）と context（ジャンル専門語）は帯フィルター免除。
          // 単語頻度では測れず、学習者が最も調べる対象なので残す（予習の的中率重視）。
          if (/\s/.test(w.word) || w.tier === 'context') return true;
          const li = order.indexOf(String(w.level || '').toUpperCase());
          return li === -1 ? true : (li >= loIdx && li <= hiIdx);
        });
        if (json.length < before) {
          console.log(`[CineLearn] CEFRバンド外フィルター: ${before - json.length}語を除去 (目標 ${targetBand})`);
        }
      }
    }

    // ★柱1の確実な担保★ drama 語を字幕と突き合わせて精査する。
    // Haiku は「字幕内のみ」と指示しても字幕外の語を混ぜることがあるため、
    // 「字幕に実在しない drama 語を除外」「example が空/不正な語は字幕文で補完」する。
    // 字幕外の推奨語は plus が担当（drama は必ず字幕語＝必ず例文が付く）。
    const containsWordIn = (text, word) => {
      const tl = text.toLowerCase();
      return word.toLowerCase().trim().split(/\s+/).every(tok => {
        const variants = getWordVariants(tok);
        return [...variants].some(v =>
          new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tl)
        );
      });
    };
    if (cachedSubtitleText) {
      const sentences = cachedSubtitleText
        .split(/(?<=[.!?])\s+|(?:\s+-\s+)/)
        .map(s => s.trim())
        .filter(s => s.length >= 4 && s.length <= 200);
      const setSubExample = (w) => {
        const hit = sentences.find(s => containsWordIn(s, w.word));
        if (hit) { w.example = hit; w.example_ja = ''; w.example_ja_ok = false; }
        return !!hit;
      };
      json = json.filter(w => {
        const inSub = containsWordIn(cachedSubtitleText, w.word);
        if (w.source === 'drama' && !inSub) return false; // 字幕に無いdrama語＝水増し → 除外
        if (w.source === 'plus' && inSub) {
          // plus だが実際は字幕に存在 → drama に直し例文を字幕の逐語文に差し替える
          w.source = 'drama';
          setSubExample(w); // 見つからなければ既存（作例）を残す
        } else if (w.source === 'drama') {
          // 既存drama語：example が空/単語不含なら字幕文で補完
          if (!w.example || !w.example.trim() || !containsWordIn(w.example, w.word)) {
            if (!setSubExample(w)) { w.example = ''; w.example_ja = ''; w.example_ja_ok = false; }
          }
        }
        return true;
      });
    }

    // 字幕内(drama)だけで最低総数 minTotal に達していれば字幕外(plus)は足さない。
    // 足りない場合のみ不足分だけ plus を残す（drama が minTotal を超えるのは許容）。
    {
      const dramaCount = json.filter(w => w.source === 'drama').length;
      const needPlus = Math.max(0, minTotal - dramaCount);
      let keptPlus = 0;
      json = json.filter(w => {
        if (w.source !== 'plus') return true;
        if (keptPlus < needPlus) { keptPlus++; return true; }
        return false; // 余剰 plus を除外
      });
    }

    vocabWords = json;
    renderVocab(json, cachedSubtitleSource);

    // クイズをバックグラウンドで生成
    generateQuiz(selectedDrama, json);

  } catch (e) {
    document.getElementById('vocabSection').innerHTML =
      `<div class="empty-state" style="color:var(--red)">${e.message}</div>`;
  }

  btn.disabled = false;
  btn.textContent = '単語を再生成';
}

// vocabSection の Skip/Resume ボタン用イベントリスナーを管理
let vocabClickListener  = null;
let currentVocabLabel   = '';
let currentVocabWords   = [];

// 単語リストを表示する（skipHistory=true のときは履歴保存をスキップ）
async function renderVocab(words, sourceLabel, skipHistory = false) {
  currentVocabLabel = sourceLabel || '';

  // 大文字小文字を無視して重複を除去（先出し優先）
  const seen = new Set();
  words = words.filter(w => {
    const k = w.word.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 単語ごとの登場時刻を一度だけ計算（並べ替えと📍表示で共用する。
  // 字幕全文のスキャンは単語あたり1回に抑える）。
  const tsCache = new Map(); // word → { sec(ソート用・補正済), label(📍表示) }
  const tsOf = (w) => {
    if (!tsCache.has(w.word)) {
      const raw = findWordCueSec(w.word);
      tsCache.set(w.word, raw == null
        ? { sec: Infinity, label: null }
        : { sec: applyVodSync(raw), label: secToTimeLabel(applyVodSync(raw)) });
    }
    return tsCache.get(w.word);
  };
  words = [...words].sort((a, b) => tsOf(a).sec - tsOf(b).sec);

  currentVocabWords = words;

  // SRSは一度だけロードして全カードで共有する（単語ごとのJSON.parseを避ける）
  const srs = loadSrs();

  const buildWordHTML = (w) => {
    const status     = getWordStatus(w.word, srs);
    const isMast     = status === 'mastered';
    const isLrn      = status === 'learned';
    const isSkip     = status === 'skipped';
    const srsEntry = srs[w.word.toLowerCase()];
    const reviewCount = srsEntry?.reviewCount || 0;
    const hasReviewed = !!srsEntry?.lastReview;
    const reviewCountLabel = reviewCount > 0
      ? `<span class="review-count-label">${reviewCount}回復習済み</span>`
      : hasReviewed
        ? `<span class="review-count-label">復習済み</span>`
        : '';
    const srsBadge = statusBadgeHTML(status);
    const tier = w.tier || 'core';
    const tierBadge = tier === 'context'  ? '<span class="tier-pill tier-context">Context</span>'
                    : tier === 'advanced' ? '<span class="tier-pill tier-advanced">Advanced</span>'
                    :                      '<span class="tier-pill tier-core">Core</span>';
    const notInTest  = !testTiers.includes(tier);
    const nextReview = nextReviewLabel(w.word, srs);
    const nextLabel  = nextReview ? `<span class="srs-next-review">📅 次回: ${nextReview}</span>` : '';
    const timestamp  = tsOf(w).label;
    const tsLabel    = timestamp
      ? `<span class="word-timestamp" data-time="${timestamp}" title="タップしてコピー">📍 ${timestamp}</span>`
      : '';
    return `
      <div class="vocab-item${isMast ? ' vocab-mastered' : ''}${isLrn ? ' vocab-learned' : ''}${isSkip ? ' vocab-skipped' : ''}${notInTest ? ' vocab-no-test' : ''}">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${srsBadge}
            <div class="vocab-word">${esc(w.word)}</div>
            ${tierBadge}
            ${nextLabel}
            ${reviewCountLabel}
            ${tsLabel}
          </div>
          ${w.example ? `<div class="word-example-wrap">
            <span class="word-example-en">${esc(w.example)}</span>
            ${w.example_ja ? `<span class="word-example-ja">${esc(w.example_ja)}</span>` : ''}
          </div>` : ''}
        </div>
        <div class="vocab-pos">${esc(w.pos || '')}</div>
        <div class="vocab-def">${esc(w.definition || '')}</div>
        <div class="vocab-card-actions">
          <button class="btn-speak" data-word="${esc(w.word)}" title="発音を聞く">🔊</button>
          <button class="btn-srs-skip${isSkip ? ' btn-srs-resume' : ''}" data-word="${esc(w.word)}">${isSkip ? 'Resume' : 'Skip'}</button>
        </div>
      </div>`;
  };

  // source フィールドで分割（旧データは全て drama 扱い）
  const dramaWords = words.filter(w => w.source !== 'plus');
  const plusWords  = words.filter(w => w.source === 'plus');

  const dramaHTML = dramaWords.map(buildWordHTML).join('');
  const plusHTML  = plusWords.length > 0
    ? `<div class="plus-words-section">
        <div class="source-label" style="margin-top:16px;margin-bottom:6px">📌 関連おすすめ単語（字幕外）</div>
        <div class="vocab-list">${plusWords.map(buildWordHTML).join('')}</div>
      </div>`
    : '';

  const { due } = episodeStats(words);
  const doneToday = todaySessionCount(currentHistoryId);
  const sessionLabel = doneToday > 0 ? ` <span class="review-done-count">（今日${doneToday}回済み）</span>` : '';
  const reviewBtnHTML = due > 0
    ? `<button class="btn-review-start" id="btnStartReview">🔴 今日の復習 ${due}単語を始める${sessionLabel}</button>`
    : (doneToday > 0 ? `<div class="review-completed-today">✅ 今日の復習完了（${doneToday}回）</div>` : '');

  const sourceSection = !skipHistory && sourceLabel
    ? `<div class="source-label" style="margin-bottom:8px">📝 ${sourceLabel}から生成</div>` : '';

  const sect = document.getElementById('vocabSection');
  sect.innerHTML = `
    ${buildProgressHTML(words)}
    ${sourceSection}
    <div class="vocab-list">${dramaHTML}</div>
    ${plusHTML}
    ${reviewBtnHTML}
  `;

  document.getElementById('vocabNextBtn').style.display = 'block';
  document.getElementById('vocabGenBtn').style.display  = 'none';
  document.getElementById('vocabDeleteBtn').style.display = 'block';

  if (!skipHistory) saveToHistory();
  saveSettings();

  // Skip / Resume / 復習開始ボタンの委譲リスナーを付け替え
  if (vocabClickListener) sect.removeEventListener('click', vocabClickListener);
  vocabClickListener = (e) => {
    // Skip / Resume
    const skipBtn = e.target.closest('.btn-srs-skip');
    if (skipBtn) {
      skipBtn.classList.contains('btn-srs-resume')
        ? unskipWord(skipBtn.dataset.word)
        : skipWord(skipBtn.dataset.word);
      renderVocab(words, sourceLabel, true);
      return;
    }
    // 🔊 発音ボタン
    const speakBtn = e.target.closest('.btn-speak');
    if (speakBtn) {
      const word = speakBtn.dataset.word;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(word);
        utter.lang = 'en-US';
        window.speechSynthesis.speak(utter);
      }
      return;
    }
    // 📍 タイムスタンプ（タップでコピー）
    const tsLabel = e.target.closest('.word-timestamp');
    if (tsLabel) {
      const time = tsLabel.dataset.time;
      navigator.clipboard.writeText(time).then(() => {
        const orig = tsLabel.textContent;
        tsLabel.textContent = '✅ コピー完了';
        tsLabel.style.background = 'rgba(52,199,89,0.2)';
        setTimeout(() => {
          tsLabel.textContent = orig;
          tsLabel.style.background = '';
        }, 1500);
      });
      return;
    }
    if (e.target.id === 'btnStartReview') startReview(words);
  };
  sect.addEventListener('click', vocabClickListener);

  // 拡張機能で保存した単語のうち、この単語リストにないものを末尾に追加
  await renderExtWordsSection(words);

  // バックグラウンドで生SRTを取得（タイムスタンプ未表示の既存単語リスト対応）
  fetchRawSrtIfMissing(words, sourceLabel);

  // バックグラウンドで example_ja を補完（既存単語リスト対応）
  fillMissingExampleJa(words, sourceLabel);
}

// 生SRTが未保存の場合、バックグラウンドで取得して単語カードのタイムスタンプを補完する
// example_ja_ok フラグがない単語をAIで翻訳して補完する
let _fillJaRunning = false;
async function fillMissingExampleJa(words, sourceLabel) {
  if (_fillJaRunning) return;               // 二重実行防止
  const missing = words.filter(w => w.example && !w.example_ja_ok);
  if (!missing.length) return;

  _fillJaRunning = true;
  try {
    const BATCH = 10; // 一度に送る単語数（トークン制限対策）
    let changed = false;

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const inputArr = batch.map(w => ({ word: w.word, example: w.example, example_ja: '' }));
      const prompt = `以下のJSON配列の各要素について、example（ドラマの字幕の英文）を自然な日本語に翻訳してexample_jaに入れてください。
- example の文全体を翻訳すること（単語の意味説明は不要）
- JSON配列のみ返答（説明不要）

${JSON.stringify(inputArr)}`;

      try {
        const text   = await callClaude(prompt, 1500);
        const rawArr = text.match(/\[[\s\S]*\]/)?.[0] || '[]';
        let arr = [];
        try { arr = JSON.parse(rawArr); } catch { arr = JSON.parse(repairJson(rawArr)); }

        arr.forEach(item => {
          if (!item?.word || !item?.example_ja?.trim()) return;
          const w = words.find(x => x.word.toLowerCase() === item.word.toLowerCase());
          if (!w) return;
          w.example_ja    = item.example_ja.trim();
          w.example_ja_ok = true;
          changed = true;
        });
      } catch(e) { console.error('[fillMissingExampleJa batch]', e); }
    }

    if (changed) {
      updateHistoryWords(currentHistoryId, words);
      await renderVocab(words, sourceLabel, true);
    }
  } catch(e) { console.error('[fillMissingExampleJa]', e); }
  finally { _fillJaRunning = false; }
}

async function fetchRawSrtIfMissing(words, sourceLabel) {
  if (!selectedDrama || !selectedSeason || !selectedEpisode) return;
  const title  = selectedDrama.englishTitle || selectedDrama.title;
  const rawKey = subtitleRawCacheKey(title, selectedSeason, selectedEpisode);
  if (localStorage.getItem(rawKey)) return; // すでにキャッシュ済み

  try {
    // 映画/TVの区別と候補選別を本取得（preloadSubtitle）と同一にする。
    // 従来はダウンロード数最大を無条件選択しており、再取得時に
    // 別エピソード・HI字幕・メイキング等を掴む事故の原因だった。
    const isMovie = selectedDrama.type === 'movie';
    const subtitles = await searchSubtitles(
      title, selectedSeason, selectedEpisode,
      isMovie ? 'movie' : 'tv',
      isMovie ? selectedDrama.tmdbId : null
    );
    const sorted = selectSubtitleCandidates(subtitles, isMovie);
    if (!sorted.length) return;
    const srtText = await downloadSubtitle(sorted[0].attributes.files[0].file_id);
    if (!srtText) return;

    // 生SRTを保存
    cachedRawSrt = srtText;
    try { localStorage.setItem(rawKey, srtText); touchSubCache(rawKey); evictSubCaches(); } catch {}

    // タイムスタンプが取得できた単語があれば再描画
    const hasTimestamp = words.some(w => findWordTimestamp(w.word));
    if (hasTimestamp) renderVocab(words, sourceLabel, true);
  } catch { /* 取得失敗は無視 */ }
}

// ─────────────────────────────────────────
// 復習セッション（フラッシュカード）
// ─────────────────────────────────────────
const REVIEW_LOG_KEY = 'cl_review_log';
let reviewQueue      = [];
let reviewQIdx       = 0;
let reviewRatings    = {}; // word → quality (0/3/5)
let currentSessionNum = 0; // 今日の何回目か
let reviewPromotions = { learned: [], mastered: [] }; // このセッションでの昇格単語

function loadReviewLog() {
  try { return JSON.parse(localStorage.getItem(REVIEW_LOG_KEY) || '[]'); } catch { return []; }
}
function saveReviewLog(log) { localStorage.setItem(REVIEW_LOG_KEY, JSON.stringify(log)); }

function todaySessionCount(historyId) {
  const today = todayStr();
  return loadReviewLog().filter(s => s.date === today && s.historyId === historyId).length;
}

function recordReviewSession(historyId, easy, hard, fail) {
  const log = loadReviewLog();
  const today = todayStr();
  const todayCount = log.filter(s => s.date === today && s.historyId === historyId).length;
  log.push({ date: today, historyId, sessionNum: todayCount + 1, easy, hard, fail, total: easy + hard + fail });
  saveReviewLog(log);
  markActivityToday();        // ストリーク用に今日を学習日として記録
  renderTodayPanel();         // ダッシュボードの今日パネルを更新
  return todayCount + 1;
}

function getTodaySessions(historyId) {
  const today = todayStr();
  return loadReviewLog().filter(s => s.date === today && s.historyId === historyId);
}

function startReview(words) {
  const srs = loadSrs();
  reviewQueue   = words
    .filter(w => { const e = srs[w.word.toLowerCase()]; return !e || isDue(e); })
    .sort(() => Math.random() - 0.5);
  reviewQIdx    = 0;
  reviewRatings = {};
  reviewPromotions = { learned: [], mastered: [] };
  currentSessionNum = todaySessionCount(currentHistoryId) + 1;
  document.getElementById('reviewModal').style.display = 'flex';
  renderReviewCard();
}

function renderReviewCard() {
  const content = document.getElementById('reviewContent');

  // ── 完了画面 ──────────────────────────────
  if (reviewQIdx >= reviewQueue.length) {
    const failed = reviewQueue.filter(w => reviewRatings[w.word] === 0);
    const hard   = reviewQueue.filter(w => reviewRatings[w.word] === 3);
    const easy   = reviewQueue.filter(w => (reviewRatings[w.word] ?? 5) === 5);

    // セッションを記録
    const sessionNum = recordReviewSession(currentHistoryId, easy.length, hard.length, failed.length);
    const todaySessions = getTodaySessions(currentHistoryId);

    const makeGroup = (words, icon, label, cls) => {
      if (!words.length) return '';
      return `
        <div class="review-summary-group">
          <div class="review-summary-label ${cls}">${icon} ${label}（${words.length}単語）</div>
          ${words.map(w => `
            <div class="review-summary-item">
              <span class="review-summary-word">${esc(w.word)}</span>
              <span class="review-summary-def">${esc(w.definition || '')}</span>
            </div>`).join('')}
        </div>`;
    };

    const makeSessionHistory = (sessions) => {
      if (sessions.length <= 1) return '';
      const rows = sessions.map(s => `
        <tr>
          <td style="padding:4px 8px;color:var(--text-muted)">${s.sessionNum}回目</td>
          <td style="padding:4px 8px;text-align:center">✅ ${s.easy}</td>
          <td style="padding:4px 8px;text-align:center">🤔 ${s.hard}</td>
          <td style="padding:4px 8px;text-align:center">😰 ${s.fail}</td>
        </tr>`).join('');
      return `
        <details class="review-history-details" style="margin-bottom:12px">
          <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);margin-bottom:6px">今日の復習履歴（${sessions.length}回）</summary>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="color:var(--text-muted)">
              <th style="padding:4px 8px;text-align:left">回数</th>
              <th style="padding:4px 8px">知ってた</th>
              <th style="padding:4px 8px">うろ覚え</th>
              <th style="padding:4px 8px">知らなかった</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </details>`;
    };

    const allPerfect = failed.length === 0 && hard.length === 0;
    const gotMaster  = reviewPromotions.mastered.length > 0;
    const gotLearned = reviewPromotions.learned.length > 0;
    // 演出：マスター到達=金色の特別演出 / 「覚えた」到達=🎉 / それ以外は従来通り
    const heroEmoji = gotMaster ? '⭐' : (gotLearned || !allPerfect ? '🎉' : '🌟');
    const promoHTML = (gotLearned || gotMaster) ? `
      <div class="review-promotions">
        ${gotLearned ? `<div class="review-promo learned">✅ ${reviewPromotions.learned.length}単語が「覚えた」に昇格！</div>` : ''}
        ${gotMaster  ? `<div class="review-promo mastered">⭐ ${reviewPromotions.mastered.length}単語がマスターに到達！</div>` : ''}
      </div>` : '';
    content.innerHTML = `
      <div class="review-done${gotMaster ? ' review-done-gold' : ''}">
        <div class="review-hero-emoji" style="font-size:48px;margin-bottom:8px">${heroEmoji}</div>
        <div style="font-size:19px;font-weight:600;margin-bottom:4px">復習完了！（今日${sessionNum}回目）</div>
        <div style="color:var(--text-muted);font-size:13px;margin-bottom:8px">${reviewQueue.length}単語を復習しました</div>
        ${promoHTML}
        <div class="review-session-badges" style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
          <span class="badge-easy">✅ 知ってた ${easy.length}</span>
          <span class="badge-hard">🤔 うろ覚え ${hard.length}</span>
          <span class="badge-fail">😰 知らなかった ${failed.length}</span>
        </div>
        ${makeSessionHistory(todaySessions)}
        ${allPerfect
          ? '<div class="review-all-perfect">全問正解！すばらしい 🎊</div>'
          : `<div class="review-summary">
              ${makeGroup(failed, '😰', '知らなかった',  'label-fail')}
              ${makeGroup(hard,   '🤔', 'うろ覚え',      'label-hard')}
              ${makeGroup(easy,   '✅', '完璧！',         'label-easy')}
            </div>`}
        ${failed.length > 0
          ? `<button class="btn-secondary" id="btnRetryFailed" style="margin-bottom:8px;width:100%">
               😰 知らなかった ${failed.length}単語をもう一度
             </button>` : ''}
        <button class="btn-primary" id="btnDoneReview" style="max-width:100%;width:100%">完了して単語リストへ</button>
      </div>`;

    document.getElementById('btnDoneReview').addEventListener('click', () => {
      document.getElementById('reviewModal').style.display = 'none';
      renderVocab(currentVocabWords, currentVocabLabel, true);
    });
    if (failed.length > 0) {
      document.getElementById('btnRetryFailed').addEventListener('click', () => {
        reviewQueue   = failed;
        reviewQIdx    = 0;
        reviewRatings = {};
        renderReviewCard();
      });
    }
    return;
  }

  // ── カード表示 ──────────────────────────────
  const w = reviewQueue[reviewQIdx];
  content.innerHTML = `
    <div class="review-card">
      <div class="review-counter">${reviewQIdx + 1} / ${reviewQueue.length}</div>
      <div class="review-word-big">${esc(w.word)}</div>
      ${w.pos ? `<div class="review-pos-tag">${esc(w.pos)}</div>` : ''}
      <button class="review-flip" id="reviewFlip">タップして意味を確認 →</button>
      <div class="review-answer" id="reviewAnswer" style="display:none">
        <div class="review-def-text">${esc(w.definition || '')}</div>
        ${w.example ? `<div class="review-example-text">
          <div>"${esc(w.example)}"</div>
          ${w.example_ja ? `<div class="review-example-ja">${esc(w.example_ja)}</div>` : ''}
        </div>` : ''}
        <div class="review-rate-btns">
          <button class="btn-rate btn-rate-fail" data-q="0">😰<br><span>知らなかった</span></button>
          <button class="btn-rate btn-rate-hard" data-q="3">🤔<br><span>うろ覚え</span></button>
          <button class="btn-rate btn-rate-easy" data-q="5">✅<br><span>知ってた！</span></button>
        </div>
      </div>
    </div>`;

  document.getElementById('reviewFlip').addEventListener('click', () => {
    document.getElementById('reviewFlip').style.display = 'none';
    document.getElementById('reviewAnswer').style.display = 'block';
  });
  content.querySelectorAll('.btn-rate').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = parseInt(btn.dataset.q);
      // 昇格判定のため評価前の状態を記録
      const before    = loadSrs()[w.word.toLowerCase()];
      const wasLearned  = isLearned(before);
      const wasMastered = isMastered(before);
      reviewRatings[w.word] = q;
      reviewWord(w.word, q);
      // 評価後に新しく到達したら昇格として記録
      const after = loadSrs()[w.word.toLowerCase()];
      if (!wasLearned  && isLearned(after))  reviewPromotions.learned.push(w.word);
      if (!wasMastered && isMastered(after)) reviewPromotions.mastered.push(w.word);
      reviewQIdx++;
      renderReviewCard();
    });
  });
}

// ドラマのおすすめを取得する
async function getRecommendations() {
  if (selectedGenres.length === 0) {
    alert('ジャンルを選んでください');
    return;
  }

  const btn = document.getElementById('recommendBtn');
  btn.disabled = true;
  btn.textContent = '生成中...';
  document.getElementById('dramaList').innerHTML =
    '<div class="loading"><div class="spinner"></div>AIが考えています...</div>';

  const prompt = `あなたは英語学習専門のアドバイザーです。
以下の条件で海外ドラマ・映画を3作品おすすめしてください。

ユーザーの英語レベル: ${userLevel}（TOEICスコア目安: ${toeicScore}点）
好きなジャンル: ${selectedGenres.join(', ')}
利用可能なサービス: ${selectedServices.join(', ')}

※必ず上記のサービスで視聴できる作品のみ選んでください。

以下のJSON形式のみで返答してください（説明文不要）:
[
  {
    "title": "作品名（英語）",
    "genre": "ジャンル",
    "level": "${userLevel}",
    "platform": "視聴できるサービス名",
    "seasons": シーズン数（数字のみ）,
    "reason": "このレベルの学習者におすすめの理由（日本語・1文）",
    "speech_feature": "英語の特徴（例：はっきりした発音、スラング多め）"
  }
]`;

  const dramaList = document.getElementById('dramaList');
  try {
    const text = await callClaude(prompt, 2000, (attempt, waitSec) => {
      dramaList.innerHTML = `<div class="loading"><div class="spinner"></div>混雑中... ${waitSec}秒後に再試行 (${attempt}/3)</div>`;
    });
    const json = JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
    renderDramas(json);
  } catch (e) {
    document.getElementById('dramaList').innerHTML =
      `<div class="empty-state" style="color:var(--red)">${e.message}</div>`;
  }

  btn.disabled = false;
  btn.textContent = 'AIにおすすめを聞く';
}

// ドラマカードを表示する（containerId 省略時は 'dramaList'）
function renderDramas(dramas, containerId = 'dramaList') {
  const list = document.getElementById(containerId);
  list.innerHTML = '';
  dramas.forEach(d => {
    const card = document.createElement('div');
    card.className = 'drama-card';
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="drama-title">${esc(d.title)}</div>
        <span class="level-pill level-${esc(d.level)}">${esc(d.level)}</span>
      </div>
      <div class="drama-meta">
        <span>${esc(d.platform)}</span>
        <span>${esc(d.genre)}</span>
        <span>${esc(d.speech_feature)}</span>
      </div>
      <div class="drama-reason">${esc(d.reason)}</div>
    `;
    card.addEventListener('click', () => selectDrama(d, card));
    list.appendChild(card);
  });
}


// ドラマを選択してエピソード選択画面へ
function selectDrama(drama, card) {
  document.querySelectorAll('.drama-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  cachedSubtitleText = '';
  cachedSubtitleSource = '';
  cachedSubtitleKey = '';
  selectedViewingService = null;
  dramaSeasonInfo = [];
  closeAddDrama();
  loadDramaFromLibrary(drama);
}

// サービスが選ばれた後にシーズン情報を取得してscreen-4へ
async function selectViewingService(service, drama) {
  selectedViewingService = service;
  saveSettings();

  goToStep(4);
  document.getElementById('vocabDramaTitle').textContent =
    `「${drama.title}」（${service}）のエピソードを選んで単語を予習する`;

  document.getElementById('episodeSelected').textContent = 'シーズン情報を取得中...';
  document.getElementById('vocabGenBtn').style.display = '';
  document.getElementById('vocabGenBtn').disabled = true;
  document.getElementById('vocabSection').innerHTML =
    '<div class="loading"><div class="spinner"></div>シーズン情報を取得中...</div>';

  // ドラマ/映画の判定・シーズン構築が終わるまでエピソード選択枠ごと隠す。
  // 確定前にエピソードを操作されると、未確定のドラマ状態（englishTitle/type
  // 未設定）で字幕取得が走って壊れるため。
  // 流れ：サービス選択 → ドラマ/映画選択 → シーズン選択
  const epSelector = document.querySelector('.episode-selector');
  if (epSelector) epSelector.style.display = 'none';

  try {
    // TMDb でタイトル情報を取得（TV/映画を判定。Claude より正確）。
    // 過去にユーザーが選んだ mediaType があれば再質問せずそれを使う。
    const tmdbResult = await fetchTitleInfoFromTMDb(drama.title, drama.mediaType);
    if (tmdbResult) {
      // 判定/選択の結果を記憶（次回から選択UIをスキップ）
      drama.mediaType = tmdbResult.type;
      selectedDrama.mediaType = tmdbResult.type;
    }
    if (tmdbResult?.type === 'movie') {
      // 映画：シーズン・エピソードの概念なし
      selectedDrama.type = 'movie';
      if (tmdbResult.englishTitle) selectedDrama.englishTitle = tmdbResult.englishTitle;
      if (tmdbResult.tmdbId)       selectedDrama.tmdbId       = tmdbResult.tmdbId;
      if (tmdbResult.posterPath)   selectedDrama.posterPath   = tmdbResult.posterPath;
      dramaSeasonInfo = [];
      setEpisodeSelectorMode(true);
    } else if (tmdbResult) {
      selectedDrama.type = 'tv';
      const { seasons: tmdbSeasons, englishTitle, tmdbId, posterPath } = tmdbResult;
      if (englishTitle) selectedDrama.englishTitle = englishTitle;
      if (tmdbId)       selectedDrama.tmdbId       = tmdbId;
      if (posterPath)   selectedDrama.posterPath   = posterPath;
      dramaSeasonInfo = tmdbSeasons;
      setEpisodeSelectorMode(false);
      buildSeasonEpisodeSelectors(tmdbSeasons);
    } else {
      // TMDb で見つからない場合は Claude にフォールバック（TVとして扱う）
      selectedDrama.type = 'tv';
      const prompt = `「${drama.title}」のシーズンとエピソード数をJSON形式のみで返答してください。
{ "seasons": [{ "season": 1, "episodes": 10 }] }`;
      const text = await callClaude(prompt);
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
      dramaSeasonInfo = json.seasons;
      setEpisodeSelectorMode(false);
      buildSeasonEpisodeSelectors(json.seasons);
    }
  } catch (e) {
    selectedDrama.type = 'tv';
    dramaSeasonInfo = [
      { season: 1, episodes: 10 },
      { season: 2, episodes: 10 },
      { season: 3, episodes: 10 }
    ];
    setEpisodeSelectorMode(false);
    buildSeasonEpisodeSelectors(dramaSeasonInfo);
  }

  // タイプ確定・シーズン構築が済んだのでエピソード選択枠を表示する
  if (epSelector) epSelector.style.display = '';

  selectedSeason = 1;
  selectedEpisode = 1;
  saveSettings();

  try {
    const hasSaved = await checkAndShowSavedVocab();
    if (!hasSaved) {
      await preloadSubtitle();
    } else {
      // 保存済み単語がある場合でも字幕キャッシュをバックグラウンドで取得
      // （拡張機能単語のエピソード照合に使用）
      const cacheKey = subtitleCacheKey(
        selectedDrama.englishTitle || selectedDrama.title,
        selectedSeason, selectedEpisode
      );
      if (!localStorage.getItem(cacheKey)) {
        preloadSubtitleSilent(cacheKey);
      }
    }
  } catch {
    const b = document.getElementById('vocabGenBtn');
    if (b) { b.style.display = ''; b.disabled = false; b.textContent = '単語を生成'; }
  }
}

// クイズを生成する（バックグラウンド）
async function generateQuiz(drama, words) {
  // testTiers に含まれる単語のみテスト対象（tier なしは core 扱い）
  const testableWords = words.filter(w => testTiers.includes(w.tier || 'core'));
  words = testableWords.length > 0 ? testableWords : words; // フィルター後が空なら全単語
  const wordList = words.map(w => w.word).join(', ');
  const workLabel = selectedDrama?.type === 'movie'
    ? `「${drama.title}」（映画）`
    : `「${drama.title}」Season ${selectedSeason} Episode ${selectedEpisode}`;
  const prompt = `英語学習クイズを作成してください。
作品：${workLabel}
単語リスト：${wordList}

上記の単語から5問の4択穴埋め問題を作成してください。

以下のJSON形式のみで返答（説明不要）:
[
  {
    "question": "穴埋め問題の文（____を使う）",
    "answer": "正解の単語",
    "choices": ["正解", "不正解1", "不正解2", "不正解3"],
    "explanation": "正解の解説（日本語・1文）"
  }
]`;

  try {
    const text = await callClaude(prompt);
    const json = JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
    quizData = json.map(q => ({
      ...q,
      choices: q.choices.sort(() => Math.random() - 0.5)
    }));
    currentQ = 0;
    score = 0;
    // クイズデータを履歴に保存する（シャッフル前の元データを保存）
    updateHistoryQuizData(currentHistoryId, json);
  } catch (e) {
    quizData = [];
  }
}

// テスト画面へ移動する
function goToQuiz() {
  goToStep(5);
  if (quizData.length > 0) {
    renderQuiz();
  } else {
    document.getElementById('quizSection').innerHTML =
      '<div class="loading"><div class="spinner"></div>クイズを準備中...</div>';
    const wait = setInterval(() => {
      if (quizData.length > 0) {
        clearInterval(wait);
        renderQuiz();
      }
    }, 500);
    setTimeout(() => {
      clearInterval(wait);
      if (quizData.length === 0) {
        document.getElementById('quizSection').innerHTML =
          '<div class="empty-state" style="color:var(--red)">クイズの生成に失敗しました。単語リストに戻って再試行してください。</div>';
      }
    }, 15000);
  }
}

// クイズを表示する
function renderQuiz() {
  if (currentQ >= quizData.length) {
    renderScore();
    return;
  }
  const q = quizData[currentQ];
  answered = false;

  // まずクイズの枠組みだけ innerHTML で作る（選択肢は後で安全に追加）
  document.getElementById('quizSection').innerHTML = `
    <div class="quiz-card">
      <div class="quiz-q">
        ${esc(q.question).replace('____', '<span class="quiz-blank">____</span>')}
      </div>
      <div class="quiz-choices" id="quizChoices"></div>
      <div class="quiz-nav">
        <span class="quiz-progress">${currentQ + 1} / ${quizData.length}</span>
        <button class="btn-next" id="nextBtn" style="display:none">次の問題 →</button>
      </div>
      <div class="explanation-box" id="explanationBox"></div>
    </div>
  `;
  document.getElementById('nextBtn').addEventListener('click', nextQuestion);

  // 選択肢ボタンを createElement + textContent で安全に生成
  // → ' " などの特殊文字が含まれていてもクラッシュしない
  const choicesEl = document.getElementById('quizChoices');
  q.choices.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = c; // innerHTML ではなく textContent で安全に代入
    btn.addEventListener('click', () => answer(btn, c, q.answer, q.explanation));
    choicesEl.appendChild(btn);
  });
}

// 回答を処理する
function answer(btn, selected, correct, explanation) {
  if (answered) return;
  answered = true;
  document.querySelectorAll('.choice-btn').forEach(b => {
    b.disabled = true;
    // textContent で設定したので trim() 不要、直接比較でOK
    if (b.textContent === correct) b.classList.add('correct');
  });
  if (selected === correct) {
    btn.classList.add('correct');
    score++;
  } else {
    btn.classList.add('wrong');
  }
  const expBox = document.getElementById('explanationBox');
  expBox.textContent = explanation;
  expBox.style.display = 'block';
  document.getElementById('nextBtn').style.display = 'block';
}

// 次の問題へ
function nextQuestion() {
  currentQ++;
  renderQuiz();
}

// スコアを表示する
function renderScore() {
  const pct = Math.round((score / quizData.length) * 100);
  const comment = pct >= 80
    ? '素晴らしい！視聴準備完了です。ドラマを楽しんでください。'
    : pct >= 60
    ? 'よくできました。視聴しながら復習しましょう。'
    : '単語をもう一度確認してから視聴しましょう。';

  // テスト結果を履歴に保存する
  updateHistoryScore(currentHistoryId, pct);

  const section = document.getElementById('quizSection');
  section.innerHTML = `
    <div class="quiz-card">
      <div class="score-display">
        <span class="score-num">${pct}%</span>
        <div style="color:var(--text-muted);font-size:14px;margin-top:8px">
          ${score} / ${quizData.length} 正解
        </div>
        <div class="score-comment">${comment}</div>
      </div>
      <button class="btn-primary" id="retryQuizBtn" style="margin-top:20px">もう一度挑戦する</button>
      <button class="btn-secondary" id="backToMainBtn" style="margin-top:8px">← マイドラマへ</button>
    </div>
  `;
  section.querySelector('#retryQuizBtn').addEventListener('click', () => { currentQ = 0; score = 0; renderQuiz(); });
  section.querySelector('#backToMainBtn').addEventListener('click', () => goToStep('main'));
}

// シーズン変更時の処理
async function onSeasonChange() {
  selectedSeason = parseInt(document.getElementById('seasonSelect').value);
  const seasonInfo = dramaSeasonInfo.find(s => s.season === selectedSeason);
  if (seasonInfo) {
    updateEpisodeSelector(seasonInfo.episodes);
  }
  selectedEpisode = 1;
  document.getElementById('episodeSelect').value = 1;
  await triggerEpisodeLoad();
}

// ─────────────────────────────────────────
// 学習履歴管理
// ─────────────────────────────────────────

// localStorage から履歴を読み込む
// 日付は読み込み時に必ず ISO へ正規化する（過去データ・クラウド由来の
// ja-JP 形式が混在しても、利用側は常に ISO 前提で比較・表示できる）
function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    h.forEach(e => {
      if (e.date)     e.date     = toIsoDate(e.date);
      if (e.quizDate) e.quizDate = toIsoDate(e.quizDate);
    });
    return h;
  } catch {
    return [];
  }
}

// 単語生成後に履歴を保存する（同じドラマ・エピソードは上書き）
function saveToHistory() {
  if (!selectedDrama || vocabWords.length === 0) return;

  const history = loadHistory();
  const newId = Date.now().toString();
  const entry = {
    id: newId,
    date: todayStr(), // ISO（表示時に formatDateJa で変換）
    drama: {
      title: selectedDrama.title,
      genre: selectedDrama.genre,
      platform: selectedDrama.platform
    },
    season: selectedSeason,
    episode: selectedEpisode,
    level: userLevel,
    targetLevel: targetToeicScore > 0 ? targetLevel : null,
    words: vocabWords,
    quiz: [],       // クイズはバックグラウンド生成後に updateHistoryQuizData() で追加
    quizScore: null,
    quizDate: null
  };

  // 同じドラマ・エピソードが既にあれば上書き（IDを引き継いでスコアを保持）
  const existingIdx = history.findIndex(h =>
    h.drama.title === entry.drama.title &&
    h.season === entry.season &&
    h.episode === entry.episode
  );

  if (existingIdx >= 0) {
    const kept = history[existingIdx];
    history[existingIdx] = {
      ...entry,
      id: kept.id,
      quizScore: kept.quizScore, // 過去のスコアは保持
      quizDate: kept.quizDate
    };
    currentHistoryId = kept.id;
  } else {
    history.unshift(entry); // 新しいものを先頭に追加
    currentHistoryId = newId;
  }

  const saved = history.slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(saved));
  if (typeof cloudSync !== 'undefined' && isLoggedIn()) cloudSync.history(saved);
  updateHistoryBadge();
  markActivityToday(); // 単語生成も学習活動としてストリークに記録
}

// クイズ生成完了後に履歴のクイズデータを更新する
function updateHistoryWords(id, words) {
  if (!id) return;
  const history = loadHistory();
  const idx = history.findIndex(h => h.id === id);
  if (idx >= 0) {
    history[idx].words = words;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    if (typeof cloudSync !== 'undefined' && isLoggedIn()) cloudSync.history(history);
  }
}

function updateHistoryQuizData(id, quiz) {
  if (!id) return;
  const history = loadHistory();
  const idx = history.findIndex(h => h.id === id);
  if (idx >= 0) {
    history[idx].quiz = quiz;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    if (typeof cloudSync !== 'undefined' && isLoggedIn()) cloudSync.history(history);
  }
}

// テスト終了後に履歴のスコアを更新する
function updateHistoryScore(id, pct) {
  if (!id) return;
  const history = loadHistory();
  const idx = history.findIndex(h => h.id === id);
  if (idx >= 0) {
    history[idx].quizScore = pct;
    history[idx].quizDate = todayStr(); // ISO（表示時に formatDateJa で変換）
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    if (typeof cloudSync !== 'undefined' && isLoggedIn()) cloudSync.history(history);
  }
}

// ヘッダーの件数バッジを更新する
function updateHistoryBadge() {
  const count = loadHistory().length;
  const badge = document.getElementById('historyBadge');
  if (badge) badge.textContent = count > 0 ? count : '';
}

// ─── モーダル操作 ───

// 履歴モーダルを開く
function openHistory() {
  document.getElementById('historyModal').style.display = 'flex';
  renderHistoryList();
}

// 履歴モーダルを閉じる
function closeHistory() {
  document.getElementById('historyModal').style.display = 'none';
  document.getElementById('modalTitle').textContent = '学習履歴';
}

// オーバーレイ（暗い背景）クリックで閉じる
function closeHistoryOnOverlay(e) {
  if (e.target === document.getElementById('historyModal')) closeHistory();
}

// ─── 履歴一覧の表示 ───

// 履歴一覧をモーダル内に描画する
// クラウドから追加読み込みした古い履歴（閲覧用・ローカルには保存しない）
// ローカルは最新50件のキャッシュ、クラウドが全件を保持する「本棚」という役割分担。
let cloudOnlyHistory = [];

function buildHistoryCardHTML(h, cloudOnly = false) {
  const levelLabels = { 'A2': 'A2', 'B1': 'B1', 'B2': 'B2', 'C1': 'C1' };
  const scoreHtml = h.quizScore !== null
    ? `<span class="history-score ${
        h.quizScore >= 80 ? 'score-high' : h.quizScore >= 60 ? 'score-mid' : 'score-low'
      }">${h.quizScore}%</span>`
    : `<span class="history-score score-none">未受験</span>`;

  const levelRange = h.targetLevel && h.targetLevel !== h.level
    ? `${levelLabels[h.level]} → ${levelLabels[h.targetLevel]}`
    : levelLabels[h.level] || h.level;

  // クラウド閲覧分は「単語を見る」のみ（クイズ・削除はローカル保存分だけ）
  const actions = cloudOnly
    ? `<button class="btn-history-action" data-action="vocab" data-id="${h.id}">単語を見る</button>
       <span class="history-quiz-pending">☁️ クラウド保存分</span>`
    : `<button class="btn-history-action" data-action="vocab" data-id="${h.id}">単語を見る</button>
       ${(h.quiz || []).length > 0
         ? `<button class="btn-history-action btn-history-quiz"
              data-action="quiz" data-id="${h.id}">テストを受ける</button>`
         : `<span class="history-quiz-pending">クイズ準備中</span>`}
       <button class="btn-history-delete" data-action="delete" data-id="${h.id}">削除</button>`;

  return `
    <div class="history-card">
      <div class="history-card-top">
        <div class="history-card-info">
          <div class="history-drama">${esc(h.drama?.title || '')}</div>
          <div class="history-ep">S${h.season} E${h.episode} · ${formatDateJa(h.date)}</div>
        </div>
        ${scoreHtml}
      </div>
      <div class="history-meta">
        <span>${levelRange}</span>
        <span>${(h.words || []).length}単語</span>
        <span>${esc(h.drama?.platform || '')}</span>
      </div>
      <div class="history-actions">${actions}</div>
    </div>`;
}

function renderHistoryList() {
  const history = loadHistory();
  const container = document.getElementById('historyContent');
  document.getElementById('modalTitle').textContent = '学習履歴';

  if (history.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="margin:24px">
        まだ学習履歴がありません。<br>単語を生成すると自動で保存されます。
      </div>`;
    return;
  }

  // フッター：ローカル上限（50件）に達している場合の案内
  //  - ログイン済み → クラウドの続きを読み込むボタン
  //  - 未ログイン  → 古い履歴が消える旨＋ログイン誘導
  let footer = '';
  if (history.length >= 50) {
    footer = (typeof isLoggedIn === 'function' && isLoggedIn())
      ? `<button class="btn-secondary" data-action="loadmore" style="width:100%;margin-top:8px">
           ☁️ さらに古い履歴を読み込む
         </button>`
      : `<div class="empty-state" style="margin:12px;font-size:12px">
           ⚠️ 履歴はこの端末に最新50件まで保存されます。<br>
           ログインすると古い履歴もクラウドに残ります。
         </div>`;
  }

  container.innerHTML =
    history.map(h => buildHistoryCardHTML(h)).join('') +
    cloudOnlyHistory.map(h => buildHistoryCardHTML(h, true)).join('') +
    footer;

  // イベント委譲：リスナーは1度だけ登録する（再描画のたびに増える重複バグを修正）
  if (!container.dataset.historyBound) {
    container.dataset.historyBound = '1';
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === 'vocab')    showHistoryVocab(id);
      if (action === 'quiz')     retakeHistoryQuiz(id);
      if (action === 'delete')   deleteHistoryItem(id);
      if (action === 'loadmore') loadOlderHistory(btn);
    });
  }
}

// クラウドから次の50件を取得して一覧に追記する（表示のみ・ローカル未保存）
async function loadOlderHistory(btn) {
  if (typeof sbFetch === 'undefined' || !isLoggedIn()) return;
  btn.disabled = true;
  btn.textContent = '読み込み中...';
  try {
    const uid    = getCurrentUser()?.id;
    const offset = loadHistory().length + cloudOnlyHistory.length;
    const rows = await sbFetch(
      `/rest/v1/history?user_id=eq.${uid}&select=*&order=updated_at.desc&offset=${offset}&limit=50`
    );
    const seen = new Set([
      ...loadHistory().map(h => String(h.id)),
      ...cloudOnlyHistory.map(h => String(h.id)),
    ]);
    const older = (Array.isArray(rows) ? rows : [])
      .filter(r => !seen.has(String(r.id)))
      .map(r => ({
        id: r.id, date: toIsoDate(r.date), drama: r.drama,
        season: r.season, episode: r.episode, level: r.level,
        targetLevel: r.target_level, words: r.words || [], quiz: r.quiz || [],
        quizScore: r.quiz_score, quizDate: r.quiz_date,
      }));
    if (older.length === 0) {
      btn.textContent = 'これ以上古い履歴はありません';
      return; // disabled のまま
    }
    cloudOnlyHistory.push(...older);
    renderHistoryList(); // 追記分を含めて再描画
  } catch {
    btn.disabled = false;
    btn.textContent = '☁️ さらに古い履歴を読み込む（再試行）';
  }
}

// ─── サブ画面：単語リスト表示 ───

// 履歴から単語リストをモーダル内に表示する
function showHistoryVocab(id) {
  // ローカル → クラウド閲覧分の順で検索（IDは文字列比較で統一）
  const entry = loadHistory().find(h => String(h.id) === String(id))
             || cloudOnlyHistory.find(h => String(h.id) === String(id));
  if (!entry) return;

  document.getElementById('modalTitle').textContent =
    `${entry.drama.title} S${entry.season}E${entry.episode}`;

  const historyContent = document.getElementById('historyContent');
  historyContent.innerHTML = `
    <button class="btn-modal-back" id="btnHistoryBack">← 一覧に戻る</button>
  `;
  historyContent.querySelector('#btnHistoryBack').addEventListener('click', renderHistoryList);
  historyContent.insertAdjacentHTML('beforeend', `
    <div class="source-label" style="margin:0 16px 8px">
      📅 ${formatDateJa(entry.date)} · ${entry.words.length}単語
    </div>
    <div class="vocab-list" style="padding:0 16px 16px">
      ${entry.words.map(w => `
        <div class="vocab-item">
          <div style="flex:1">
            <div class="vocab-word">${esc(w.word)}</div>
            ${w.example ? `<div class="word-example-wrap">
              <span class="word-example-en">${esc(w.example)}</span>
              ${w.example_ja ? `<span class="word-example-ja">${esc(w.example_ja)}</span>` : ''}
            </div>` : ''}
          </div>
          <div class="vocab-pos">${esc(w.pos)}</div>
          <div class="vocab-def">${esc(w.definition)}</div>
        </div>
      `).join('')}
    </div>
  `);
}

// ─── サブ操作：クイズ再受験 ───

// 履歴のクイズを再受験する（選択肢を再シャッフルして Step5 へ）
function retakeHistoryQuiz(id) {
  const entry = loadHistory().find(h => h.id === id);
  if (!entry || entry.quiz.length === 0) return;

  quizData = entry.quiz.map(q => ({
    ...q,
    choices: [...q.choices].sort(() => Math.random() - 0.5) // 毎回違う並び
  }));
  currentQ = 0;
  score = 0;
  currentHistoryId = id; // スコア更新先を履歴エントリに切り替え

  closeHistory();
  goToStep(5);
  renderQuiz();
}

// 履歴エントリを削除する
function deleteHistoryItem(id) {
  if (!confirm('この履歴を削除しますか？')) return;
  const history = loadHistory().filter(h => h.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  updateHistoryBadge();
  renderHistoryList(); // 一覧を再描画
}

// 単語リスト削除ボタン
document.getElementById('vocabDeleteBtn').addEventListener('click', async () => {
  if (!confirm('この単語リストを削除しますか？')) return;
  if (currentHistoryId) {
    const history = loadHistory().filter(h => h.id !== currentHistoryId);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    // Supabaseからも削除
    if (typeof sbFetch !== 'undefined' && isLoggedIn()) {
      sbFetch(`/rest/v1/history?id=eq.${currentHistoryId}`, { method: 'DELETE' }).catch(() => {});
    }
    currentHistoryId = null;
    updateHistoryBadge();
  }
  // 字幕キャッシュも削除
  if (selectedDrama && selectedSeason && selectedEpisode) {
    const title = (selectedDrama.englishTitle || selectedDrama.title).toLowerCase().replace(/[^a-z0-9]/g, '_');
    localStorage.removeItem(`cl_sub_${title}_s${selectedSeason}e${selectedEpisode}`);
  }
  vocabWords = [];
  quizData = [];
  document.getElementById('vocabSection').innerHTML = '<div class="empty-state">エピソードを選んでください</div>';
  document.getElementById('vocabNextBtn').style.display = 'none';
  document.getElementById('vocabDeleteBtn').style.display = 'none';
  document.getElementById('vocabGenBtn').style.display = '';
  document.getElementById('vocabGenBtn').disabled = false;
  document.getElementById('vocabGenBtn').textContent = '単語を生成';
  document.getElementById('episodeSelected').textContent = '';
});

// 起動時にバッジを初期化する
updateHistoryBadge();
// 既存ユーザーのストリークを復習ログから補完
backfillActivityDates();
// 旧 ja-JP 形式の日付を ISO へ移行（loadHistory が正規化した結果を書き戻す。
// 次回の履歴保存時にクラウド側も ISO に揃う）
try {
  const rawHist = localStorage.getItem(HISTORY_KEY);
  if (rawHist && rawHist.includes('/')) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory()));
  }
} catch { /* 移行失敗時は読み込み時の正規化で吸収される */ }

// ─────────────────────────────────────────
// ストレージ抽象化
// 拡張機能ページ（chrome-extension://）では chrome.storage.local を使用
// 通常のWebページでは localStorage にフォールバック
// ─────────────────────────────────────────

const store = {
  get(key) {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return new Promise(resolve =>
        chrome.storage.local.get([key], result => resolve(result[key] ?? null))
      );
    }
    try { return Promise.resolve(JSON.parse(localStorage.getItem(key))); }
    catch { return Promise.resolve(null); }
  },
  set(key, value) {
    // マイ単語帳は Supabase にも同期
    if (key.startsWith('cl_my_words') && typeof cloudSync !== 'undefined' && isLoggedIn()) {
      cloudSync.myWords(value);
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return new Promise(resolve =>
        chrome.storage.local.set({ [key]: value }, resolve)
      );
    }
    localStorage.setItem(key, JSON.stringify(value));
    return Promise.resolve();
  }
};

function myWordsKey() {
  return currentProfileId ? `cl_my_words_${currentProfileId}` : 'cl_my_words';
}

// ── 削除済み単語リスト（ローカル保持・非表示フィルタ用） ──────────────────────
function deletedWordsKey() {
  return currentProfileId ? `cl_deleted_words_${currentProfileId}` : 'cl_deleted_words';
}
function getDeletedWords() {
  try { return JSON.parse(localStorage.getItem(deletedWordsKey()) || '[]'); }
  catch { return []; }
}
function addToDeletedWords(wordTexts) {
  const list = Array.isArray(wordTexts) ? wordTexts : [wordTexts];
  const current = getDeletedWords();
  localStorage.setItem(deletedWordsKey(), JSON.stringify([...new Set([...current, ...list])]));
}
// 削除済みを除いた単語リストを返す
async function getActiveWords() {
  const all     = await store.get(myWordsKey()) || [];
  const deleted = getDeletedWords();
  if (!deleted.length) return all;

  // 削除リストにあっても再保存された単語は削除リストから除外して表示する
  const resaved = all.filter(w => deleted.includes(w.word));
  if (resaved.length) {
    const resavedSet = new Set(resaved.map(w => w.word));
    const newDeleted = deleted.filter(w => !resavedSet.has(w));
    localStorage.setItem(deletedWordsKey(), JSON.stringify(newDeleted));
    // Supabase にも反映（再保存された単語を含むリストで上書き）
    if (typeof cloudSync !== 'undefined' && isLoggedIn()) {
      cloudSync.myWords(all).catch(() => {});
    }
    return all; // 再保存された単語を含む全件を返す
  }

  return all.filter(w => !deleted.includes(w.word));
}

// ─────────────────────────────────────────
// 単語帳（マイ単語帳）
// ─────────────────────────────────────────

// 単語帳モーダルを開く
async function openWordbook() {
  document.getElementById('wordbookModal').style.display = 'flex';
  await renderWordbook();
}

// 単語帳モーダルを閉じる
function closeWordbook() {
  document.getElementById('wordbookModal').style.display = 'none';
}

// オーバーレイクリックで閉じる
function closeWordbookOnOverlay(e) {
  if (e.target === document.getElementById('wordbookModal')) closeWordbook();
}

// 単語帳の内容を描画する（削除済みを除く）
async function renderWordbook() {
  const words = await getActiveWords();
  const container = document.getElementById('wordbookContent');

  if (words.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="margin:24px">
        まだ単語が保存されていません。<br><br>
        拡張機能をインストールして Netflix などで<br>
        動画を再生すると、字幕の各単語をクリックして<br>
        ここに保存できます。
      </div>`;
    return;
  }

  // 一覧ヘッダー（件数 + 全削除ボタン）
  container.innerHTML = `
    <div class="wordbook-header">
      <span style="font-size:13px;color:var(--text-muted)">${words.length}単語</span>
      <button class="btn-clear-all" id="btnClearAll">すべて削除</button>
    </div>
    <div class="vocab-list" style="padding:12px 16px" id="wordbookList"></div>`;

  // 全削除ボタン
  document.getElementById('btnClearAll').addEventListener('click', clearAllWords);

  // 単語リストを生成（data属性でwordを渡し、addEventListener で安全に処理）
  const listEl = document.getElementById('wordbookList');
  words.forEach((w) => {
    const item = document.createElement('div');
    item.className = 'vocab-item wordbook-item';
    item.innerHTML = `
      <div style="flex:1">
        <div style="display:flex;align-items:baseline;gap:8px">
          <div class="vocab-word">${esc(w.word)}</div>
          ${w.phonetic ? `<span style="font-size:11px;color:var(--text-muted)">${esc(w.phonetic)}</span>` : ''}
        </div>
        ${w.sentence ? `
          <div class="wordbook-sentence">"${esc(w.sentence)}"</div>` : ''}
        <div class="wordbook-meta">
          ${w.dramaTitle
            ? `<span>📺 ${esc(w.dramaTitle)}${w.season != null ? ` S${esc(w.season)}` : ''}${w.episode != null ? `E${esc(w.episode)}` : ''}</span>`
            : (w.source ? `<span>${esc(w.source)}</span>` : '')}
          <span>${esc(formatDateJa(w.savedAt))}</span>
        </div>
      </div>
      ${w.pos ? `<div class="vocab-pos">${esc(w.pos)}</div>` : ''}
      <div class="vocab-def">${esc(w.definition || '（定義なし）')}</div>
      <button class="btn-word-delete" data-word="${esc(w.word)}" title="削除">×</button>`;

    // 削除ボタンに addEventListener（特殊文字があっても安全）
    item.querySelector('.btn-word-delete').addEventListener('click', (e) => {
      deleteMyWord(e.currentTarget.dataset.word);
    });

    listEl.appendChild(item);
  });
}

// 単語を1件削除する（削除リストに追加 + ストア更新 → store.set が cloudSync.myWords を呼ぶ）
async function deleteMyWord(wordText) {
  addToDeletedWords(wordText);
  const words = await store.get(myWordsKey()) || [];
  await store.set(myWordsKey(), words.filter(w => w.word !== wordText));
  await renderWordbook();
  updateWordbookBadge();
}

// 単語をすべて削除する
async function clearAllWords() {
  if (!confirm('保存した単語をすべて削除しますか？')) return;
  const words = await store.get(myWordsKey()) || [];
  addToDeletedWords(words.map(w => w.word));
  await store.set(myWordsKey(), []);
  await renderWordbook();
  updateWordbookBadge();
}

// ヘッダーの件数バッジを更新する（削除済みを除く）
async function updateWordbookBadge() {
  const words = await getActiveWords();
  const badge = document.getElementById('wordbookBadge');
  if (badge) badge.textContent = words.length > 0 ? words.length : '';
}

// 起動時にバッジを初期化する
updateWordbookBadge();

// 拡張機能が単語を追加したとき、リアルタイムでバッジ・一覧を更新する
function onMyWordsChanged() {
  updateWordbookBadge();
  if (document.getElementById('wordbookModal').style.display === 'flex') {
    renderWordbook();
  }
  if (selectedDrama && document.getElementById('screen-4')?.classList.contains('active')) {
    document.getElementById('ext-words-section')?.remove();
    renderExtWordsSection(vocabWords);
  }
}

// chrome.storage 経由（拡張機能からの保存）
if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (Object.keys(changes).some(k => k.startsWith('cl_my_words'))) onMyWordsChanged();
  });
}

// localStorage 経由（直接保存された場合のフォールバック）
window.addEventListener('storage', (e) => {
  if (e.key?.startsWith('cl_my_words')) onMyWordsChanged();
});

// pullFromCloud 後に supabase.js から発火されるカスタムイベント
window.addEventListener('cl_my_words_updated', () => onMyWordsChanged());

// bridge.js（拡張機能コンテンツスクリプト）から chrome.storage 変化を受け取る
window.addEventListener('cl_storage_bridge', (e) => {
  if (e.detail?.key?.startsWith('cl_my_words')) onMyWordsChanged();
});

// ─────────────────────────────────────────────────────────────────
// イベントリスナー登録
// Manifest V3 の拡張機能ページは onclick 属性をセキュリティポリシーで禁止するため
// 全てのボタン操作をここで addEventListener に変換する
// ─────────────────────────────────────────────────────────────────
function initEventListeners() {
  // ─ ヘッダー ─
  document.getElementById('btnLogo').addEventListener('click', () => goToStep('main'));
  document.getElementById('btnWordbook').addEventListener('click', openWordbook);
  document.getElementById('btnOpenSettings').addEventListener('click', openSettings);
  document.getElementById('btnProfileSwitch').addEventListener('click', () => {
    currentProfileId = null;
    document.getElementById('btnProfileSwitch').style.display = 'none';
    goToStep(0);
    renderProfileScreen();
  });

  // ─ 設定モーダル ─
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('settingsModal')) closeSettings();
  });
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettingsFromModal);
  document.getElementById('toeicScore').addEventListener('input', onToeicInput);
  document.querySelectorAll('.toeic-level-row').forEach(row => {
    row.addEventListener('click', () => setToeic(parseInt(row.dataset.score)));
  });
  document.getElementById('targetScore').addEventListener('input', onTargetInput);
  // オンボーディング画面のカードは除外（専用ハンドラあり）
  document.querySelectorAll('.service-card:not(#ob-step-2 .service-card)').forEach(card => {
    card.addEventListener('click', () => toggleService(card));
  });

  // ─ メイン画面 ─
  document.getElementById('btnAddDrama').addEventListener('click', openAddDrama);
  document.getElementById('btnMainSearch').addEventListener('click', () => {
    const q = document.getElementById('mainSearchInput').value.trim();
    if (!q) return;
    document.getElementById('manualSearchInput').value = q;
    openAddDrama();
    switchAddDramaTab('search');
    manualSearchDrama();
  });
  document.getElementById('mainSearchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btnMainSearch').click();
  });

  // ─ ドラマ追加モーダル ─
  document.getElementById('btnCloseAddDrama').addEventListener('click', closeAddDrama);
  document.getElementById('addDramaModal').addEventListener('click', e => {
    if (e.target === document.getElementById('addDramaModal')) closeAddDrama();
  });
  document.getElementById('recommendBtn').addEventListener('click', getRecommendations);
  document.getElementById('btnManualSearch').addEventListener('click', manualSearchDrama);
  document.getElementById('manualSearchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') manualSearchDrama();
  });
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAddDramaTab(tab.dataset.tab));
  });

  // ─ ジャンルタグ ─
  document.querySelectorAll('.tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('active');
      const genre = tag.dataset.genre;
      if (tag.classList.contains('active')) {
        selectedGenres.push(genre);
      } else {
        selectedGenres = selectedGenres.filter(g => g !== genre);
      }
      saveSettings();
    });
  });

  // ─ screen-4 ─
  document.getElementById('btnBackToMain').addEventListener('click', () => goToStep('service-select'));
  document.getElementById('btnBackToMainFromService').addEventListener('click', () => goToStep('main'));
  document.getElementById('seasonSelect').addEventListener('change', onSeasonChange);
  document.getElementById('episodeSelect').addEventListener('change', onEpisodeChange);
  document.getElementById('vocabGenBtn').addEventListener('click', generateVocabFromEpisode);
  document.getElementById('vocabNextBtn').addEventListener('click', goToQuiz);

  // ─ screen-5 ─
  document.getElementById('btnBackToVocab').addEventListener('click', () => goToStep(4));

  // ─ 単語帳モーダル ─
  document.getElementById('wordbookModal').addEventListener('click', e => {
    if (e.target === document.getElementById('wordbookModal')) closeWordbook();
  });
  document.getElementById('btnCloseWordbook').addEventListener('click', closeWordbook);

  // ─ 学習履歴モーダル ─
  document.getElementById('historyModal').addEventListener('click', e => {
    if (e.target === document.getElementById('historyModal')) closeHistory();
  });
  document.getElementById('btnCloseHistory').addEventListener('click', closeHistory);

  // ─ 単語階層チェックボックス ─
  document.querySelectorAll('.tier-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      testTiers = Array.from(document.querySelectorAll('.tier-checkbox:checked')).map(c => c.value);
      if (testTiers.length === 0) { cb.checked = true; testTiers = [cb.value]; } // 最低1つ必須
      saveSettings();
      // 現在単語リストが表示中なら tier バッジを再描画
      if (vocabWords.length && document.getElementById('screen-4').classList.contains('active')) {
        renderVocab(vocabWords, currentVocabLabel, true);
      }
    });
  });

  // ─ 復習モーダル ─
  document.getElementById('btnCloseReview').addEventListener('click', () => {
    document.getElementById('reviewModal').style.display = 'none';
  });
  document.getElementById('reviewModal').addEventListener('click', e => {
    if (e.target === document.getElementById('reviewModal'))
      document.getElementById('reviewModal').style.display = 'none';
  });
}

// ── Web Push 通知 ──────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = 'BDvzao62EPn3UHluB_1UgyWnnmVyX3BGwnLg7q-TyfHYkQYRC0sAC4HU0bsLAAABQ_FfQkwvWRWLJRATiDuAslk';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function initPushNotify() {
  const btn    = document.getElementById('btnEnableNotify');
  const status = document.getElementById('notifyStatus');
  if (!btn) return;

  // 通知非対応ブラウザはボタンを隠す
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    btn.textContent = '⚠️ このブラウザは通知非対応です';
    btn.disabled = true;
    return;
  }

  // 既に許可済みの場合 → 購読情報をSupabaseに保存し直す
  if (Notification.permission === 'granted') {
    btn.textContent = '✅ 通知は有効です';
    btn.disabled = true;
    btn.style.opacity = '0.6';
    // 購読情報が未保存の可能性があるので再保存を試みる
    try {
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
      if (user && subscription) {
        const r = await fetch('/api/push-subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ subscription, user_id: user.id }),
        });
        if (r.ok) {
          status.textContent = '毎朝8時に復習日をお知らせします 🎬';
          status.style.display = 'block';
        }
      }
    } catch (e) { console.error('re-subscribe error:', e); }
    return;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '設定中...';

    // 通知許可を求める
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      btn.textContent = '🔕 通知が拒否されました';
      status.textContent = 'ブラウザの設定から通知を許可してください';
      status.style.display = 'block';
      return;
    }

    try {
      // Service Worker の購読を取得
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Supabase に保存（ログイン中のみ）
      const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
      if (user) {
        const r = await fetch('/api/push-subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ subscription, user_id: user.id }),
        });
        if (!r.ok) {
          const err = await r.text();
          console.error('push-subscribe failed:', err);
          throw new Error('保存失敗: ' + err);
        }
        btn.textContent = '✅ 通知を有効にしました';
        status.textContent = '毎朝8時に復習日をお知らせします 🎬';
      } else {
        btn.textContent = '✅ 通知を有効にしました';
        status.textContent = 'ログインすると通知がサーバーから届きます';
      }
      status.style.display = 'block';
      btn.disabled = true;
      btn.style.opacity = '0.6';
    } catch (err) {
      console.error('Push subscribe error:', err);
      btn.textContent = '⚠️ 通知の設定に失敗しました';
      btn.disabled = false;
      status.textContent = err.message;
      status.style.display = 'block';
    }
  });
}

initEventListeners();
initPushNotify();

// Supabase が設定されていればログイン確認・データ同期
if (typeof initSupabase === 'function') initSupabase();
// ログイン済みならログアウトボタンを表示
if (typeof isLoggedIn === 'function' && isLoggedIn()) {
  const btn = document.getElementById('btnSignOut');
  if (btn) btn.style.display = 'inline-flex';
}

// タブ・アプリが再表示されたとき（他デバイスの変更を反映するため）自動同期
let _lastPullAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (typeof pullFromCloud !== 'function') return;
  if (typeof isLoggedIn !== 'function') return;
  // スリープ中にトークンが失効していたら refresh_token で復活させてから同期する
  // （PCスリープ中は setInterval が止まるため、復帰時のここが復活の入口になる）
  if (!isLoggedIn()) {
    if (typeof ensureFreshSession !== 'function' || !(await ensureFreshSession())) return;
  }
  const now = Date.now();
  if (now - _lastPullAt < 30_000) return; // 30秒以内は再実行しない
  _lastPullAt = now;
  pullFromCloud();
});

// ── 追加単語ポーリング ──────────────────────────────────────────────
// screen-4 表示中に5秒ごと単語・定義の変化を検知して再描画
let _extPollTimer = null;
let _extPollSnapshot = '';

function startExtPoll() {
  stopExtPoll();
  _extPollTimer = setInterval(async () => {
    if (!selectedDrama) return;
    const words = await store.get(myWordsKey()) || [];
    // タイトル比較は部分一致・大文字小文字無視（拡張機能が保存するタイトルと差異がある場合に対応）
    const tl = (selectedDrama.title || '').toLowerCase();
    const snapshot = JSON.stringify(
      words.filter(w => {
        if (!w.dramaTitle) return false;
        const wl = w.dramaTitle.toLowerCase();
        if (!(wl.includes(tl) || tl.includes(wl))) return false;
        return w.season == selectedSeason && w.episode == selectedEpisode;
      }).map(w => w.word + '|' + w.definition)
    );
    if (snapshot !== _extPollSnapshot) {
      _extPollSnapshot = snapshot;
      document.getElementById('ext-words-section')?.remove();
      renderExtWordsSection(vocabWords);
    }
  }, 5000);
}

function stopExtPoll() {
  if (_extPollTimer) { clearInterval(_extPollTimer); _extPollTimer = null; }
  _extPollSnapshot = '';
}
renderProfileScreen();