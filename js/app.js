// 状態管理
let selectedServices = [];
let selectedGenres = ['Crime Thriller'];
let selectedDrama = null;
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
// テストに含める単語階層（core / advanced / context）
let testTiers = ['core', 'advanced'];

// 履歴管理
const HISTORY_KEY = 'cl_history';
// 現在操作中の履歴エントリID（保存・スコア更新に使う）
let currentHistoryId = null;

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

function isMastered(e)  { return !!e && !e.skipped && e.repetitions >= 3 && e.interval >= 21 && e.easeFactor >= 2.0; }
function isDue(e)       { if (!e || e.skipped || isMastered(e)) return false; return !e.dueDate || e.dueDate <= todayStr(); }

function getWordStatus(word) {
  const e = loadSrs()[word.toLowerCase()];
  if (!e)                              return 'new';
  if (e.skipped)                       return 'skipped';
  if (isMastered(e))                   return 'mastered';
  if (isDue(e))                        return 'due';
  if (e.lastReview === todayStr())     return 'reviewed_today';
  return 'scheduled';
}

// 次回復習日を人間が読みやすい文字列で返す
function nextReviewLabel(word) {
  const e = loadSrs()[word.toLowerCase()];
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
  e.dueDate    = d.toISOString().slice(0, 10);
  e.lastReview = todayStr();
  all[k] = e;
  saveSrs(all);
}

function episodeStats(words) {
  const srs = loadSrs();
  let mastered = 0, due = 0, skipped = 0, reviewedToday = 0;
  (words || []).forEach(w => {
    const e = srs[w.word.toLowerCase()];
    if (!e)                          { due++;           return; }
    if (e.skipped)                   { skipped++;       return; }
    if (isMastered(e))               { mastered++;      return; }
    if (isDue(e))                    { due++;           return; }
    if (e.lastReview === todayStr()) { reviewedToday++; return; }
  });
  return { total: (words || []).length, mastered, due, skipped, reviewedToday };
}

function buildProgressHTML(words) {
  const { total, mastered, due, skipped, reviewedToday } = episodeStats(words);
  const pct = total === 0 ? 0 : Math.round(mastered / total * 100);
  const barColor = pct === 100 ? '#f5c518'
    : pct > 60  ? '#4fc3f7'
    : pct > 30  ? 'var(--accent)'
    : 'var(--text-muted)';
  const epLabel = selectedDrama
    ? `${selectedDrama.title} S${selectedSeason}E${selectedEpisode} の単語リスト`
    : '単語リスト';
  const completeMsg = pct === 100
    ? '<div class="srs-complete">✨ このエピソードをコンプリート！</div>' : '';
  const reviewedPart = reviewedToday > 0 ? ` / 今日復習済み：${reviewedToday}単語` : '';
  return `
    <div class="srs-progress-wrap">
      <div class="srs-progress-header">
        <span class="srs-ep-label">${epLabel}</span>
        <span class="srs-pct" style="color:${barColor}">${pct}% 習得</span>
      </div>
      <div class="srs-bar"><div class="srs-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="srs-stats">${total}単語中 ${mastered}単語習得済み（復習対象：${due}単語 / スキップ：${skipped}単語${reviewedPart}）</div>
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
    testTiers,
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
  // ── ドラマが選択済みなら（単語の有無に関わらず）Step 4 へ ──
  if (s.selectedDrama) {
    document.getElementById('vocabDramaTitle').textContent =
      `「${s.selectedDrama.title}」のエピソードを選んで単語を予習する`;
    if (s.dramaSeasonInfo?.length) {
      buildSeasonEpisodeSelectors(s.dramaSeasonInfo);
      document.getElementById('seasonSelect').value = s.selectedSeason;
      const seasonData = s.dramaSeasonInfo.find(si => si.season === s.selectedSeason);
      if (seasonData) updateEpisodeSelector(seasonData.episodes);
      document.getElementById('episodeSelect').value = s.selectedEpisode;
    }
    document.getElementById('vocabNextBtn').style.display = 'none';
    // 保存済み単語があれば即表示、なければ生成ボタン待機
    if (!(await checkAndShowSavedVocab())) {
      document.getElementById('episodeSelected').textContent =
        `Season ${s.selectedSeason} Episode ${s.selectedEpisode}`;
      document.getElementById('vocabGenBtn').style.display = '';
      document.getElementById('vocabGenBtn').disabled = false;
      document.getElementById('vocabGenBtn').textContent = '単語を生成';
      document.getElementById('vocabSection').innerHTML =
        '<div class="empty-state">「単語を生成」を押してください</div>';
    }
    goToStep(4);
    return;
  }
  // ── ドラマ未選択ならメイン画面へ ──
  goToStep('main');
}

// プロフィールを選択してアプリに入る
function selectProfile(id) {
  currentProfileId = id;
  // 拡張機能がプロフィール別キーに保存できるよう共有する
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ cl_active_profile: id });
  }
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
    renderProfileScreen();
  });
  grid.appendChild(addCard);
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
  if (step === 'main') renderDramaLibrary();
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

  // 現在選択中ドラマがまだ履歴にないなら追加
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
}

function buildLibraryCard({ drama, episodes, bestScore, lastDate }) {
  const card = document.createElement('div');
  card.className = 'library-card';

  const recent = episodes.slice(-3).map(e => `S${e.season}E${e.episode}`).join(' · ');
  const scoreHtml = bestScore !== null
    ? `<span class="history-score ${bestScore >= 80 ? 'score-high' : bestScore >= 60 ? 'score-mid' : 'score-low'}">${bestScore}%</span>`
    : '';

  card.innerHTML = `
    <div class="library-card-banner" style="background:${platformColor(drama.platform)}">
      ${drama.title.charAt(0)}
    </div>
    <div class="library-card-body">
      <div class="library-card-title">${drama.title}</div>
      <div class="library-card-meta">
        <span class="history-score score-none" style="font-size:11px">${drama.platform}</span>
        ${scoreHtml}
      </div>
      ${recent ? `<div class="library-card-episodes">📚 ${recent}</div>` : '<div class="library-card-episodes" style="color:var(--text-muted)">未学習</div>'}
    </div>
    <div class="library-card-footer">
      <span class="library-card-date">${lastDate || ''}</span>
      <button class="library-card-action">${episodes.length > 0 ? '続きを学習 →' : '学習を始める →'}</button>
    </div>`;

  card.addEventListener('click', () => loadDramaFromLibrary(drama));
  return card;
}

// ライブラリのドラマカードをクリックして学習へ
async function loadDramaFromLibrary(drama) {
  selectedDrama = drama;
  saveSettings();
  goToStep(4);

  document.getElementById('vocabDramaTitle').textContent =
    `「${drama.title}」のエピソードを選んで単語を予習する`;

  document.getElementById('vocabNextBtn').style.display = 'none';

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
async function callClaude(prompt, maxTokens = 2000, onRetry = null) {
  const delays = [3000, 6000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch('/api/claude', {
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
async function searchSubtitles(title, season, episode) {
  const res = await fetch('/api/subtitles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'search', query: title, season, episode })
  });
  if (!res.ok) throw new Error('字幕の検索に失敗しました');
  const data = await res.json();
  return data.data;
}

// 字幕ファイルをダウンロードする（Netlify Function プロキシ経由）
async function downloadSubtitle(fileId) {
  const res = await fetch('/api/subtitles', {
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

// シーズン・エピソード選択肢を動的に構築する
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

  document.getElementById('vocabNextBtn').style.display = 'none';
  document.getElementById('vocabGenBtn').style.display = '';
  vocabWords = [];
  quizData = [];

  // 保存済み単語があれば即表示して字幕ロードをスキップ
  if (await checkAndShowSavedVocab()) return;

  document.getElementById('episodeSelected').textContent =
    `Season ${selectedSeason} Episode ${selectedEpisode} を選択中`;
  document.getElementById('vocabSection').innerHTML =
    '<div class="loading"><div class="spinner"></div>字幕を読み込み中...</div>';
  document.getElementById('vocabGenBtn').disabled = true;
  document.getElementById('vocabGenBtn').textContent = '読み込み中...';

  await preloadSubtitle();
}

// 拡張機能で保存した単語のうち、現ドラマ・エピソードに一致するものを返す
// season/episode が null の単語（DOM取得不可の場合）はタイトル一致のみで表示する
async function getMyWordsForEpisode(dramaTitle, season, episode) {
  if (!dramaTitle) return [];
  const words = await store.get(myWordsKey()) || [];
  const tl = dramaTitle.toLowerCase();
  return words.filter(w => {
    if (!w.dramaTitle) return false;
    const wl = w.dramaTitle.toLowerCase();
    if (!(wl.includes(tl) || tl.includes(wl))) return false;
    // S/E が記録されている場合は完全一致必須
    if (w.season != null && w.episode != null) {
      return w.season === season && w.episode === episode;
    }
    // S/E が取得できなかった単語はタイトル一致のみで表示
    return true;
  });
}

// 「追加した単語」セクションを vocabSection の末尾に追加する
async function renderExtWordsSection(existingWords = []) {
  if (!selectedDrama) return;
  const extWords = await getMyWordsForEpisode(selectedDrama.title, selectedSeason, selectedEpisode);
  const existingSet = new Set(existingWords.map(w => w.word.toLowerCase()));
  const newExt = extWords.filter(w => !existingSet.has(w.word.toLowerCase()));
  if (newExt.length === 0) return;

  const sect = document.getElementById('vocabSection');
  if (!sect) return;
  // 前回の拡張機能単語セクションがあれば置き換え
  document.getElementById('ext-words-section')?.remove();

  const div = document.createElement('div');
  div.id = 'ext-words-section';
  div.innerHTML = `
    <div class="source-label" style="margin-top:14px">✏️ 追加した単語</div>
    <div class="vocab-list">
      ${newExt.map(w => `
        <div class="vocab-item">
          <div style="flex:1">
            <div class="vocab-word">${w.word}</div>
            ${w.sentence ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;font-style:italic">"${w.sentence}"</div>` : ''}
          </div>
          ${w.pos ? `<div class="vocab-pos">${w.pos}</div>` : ''}
          <div class="vocab-def">${w.definition || '（定義なし）'}</div>
        </div>
      `).join('')}
    </div>
  `;
  sect.appendChild(div);
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
    vocabWords       = entry.words;
    quizData         = entry.quiz || [];
    currentHistoryId = entry.id;
    document.getElementById('episodeSelected').textContent =
      `Season ${selectedSeason} Episode ${selectedEpisode} ✓ 保存済み`;
    document.getElementById('vocabGenBtn').style.display = 'none';
    renderVocab(entry.words, `${selectedDrama.title} S${selectedSeason}E${selectedEpisode}`, true);
    return true;
  }

  // 履歴単語なし → 拡張機能単語のみチェック
  const extWords = await getMyWordsForEpisode(selectedDrama.title, selectedSeason, selectedEpisode);
  if (extWords.length === 0) return false;

  // 拡張機能単語のみの場合：生成ボタンを表示しつつ追加単語セクションを表示
  document.getElementById('episodeSelected').textContent =
    `Season ${selectedSeason} Episode ${selectedEpisode}`;
  document.getElementById('vocabSection').innerHTML =
    '<div class="empty-state" style="padding:20px">「単語を生成」でAIの単語リストを追加できます</div>';
  document.getElementById('vocabGenBtn').style.display = '';
  document.getElementById('vocabGenBtn').disabled = false;
  document.getElementById('vocabGenBtn').textContent = '単語を生成';
  document.getElementById('vocabNextBtn').style.display = 'none';
  await renderExtWordsSection([]);
  return true;
}

// 字幕を事前に読み込んでおく
let cachedSubtitleText = '';
let cachedSubtitleSource = '';

async function preloadSubtitle() {
  cachedSubtitleText = '';
  cachedSubtitleSource = '';


  try {
    const subtitles = await searchSubtitles(
      selectedDrama.title,
      selectedSeason,
      selectedEpisode
    );

    if (subtitles && subtitles.length > 0) {
      const fileId = subtitles[0].attributes.files[0].file_id;
      const srtText = await downloadSubtitle(fileId);
      cachedSubtitleText = parseSrt(srtText);
      cachedSubtitleSource = '実際の字幕データから';
      document.getElementById('episodeSelected').textContent =
        `Season ${selectedSeason} Episode ${selectedEpisode} ✓ 字幕取得済み`;
    } else {
      cachedSubtitleSource = 'AIの推測（字幕が見つかりませんでした）';
      document.getElementById('episodeSelected').textContent =
        `Season ${selectedSeason} Episode ${selectedEpisode} ⚠ 字幕なし`;
    }
  } catch (e) {
    cachedSubtitleSource = 'AIの推測（字幕取得エラー）';
    document.getElementById('episodeSelected').textContent =
      `Season ${selectedSeason} Episode ${selectedEpisode} ⚠ 字幕エラー`;
  }

  const btn = document.getElementById('vocabGenBtn');
  if (btn) {
    btn.style.display = '';
    btn.disabled = false;
    btn.textContent = '単語を生成';
  }
  document.getElementById('vocabSection').innerHTML =
    '<div class="empty-state">「単語を生成」を押してください</div>';
}

// 単語を生成する（字幕はキャッシュ済み）
async function generateVocabFromEpisode() {
  if (!selectedDrama) return;

  const btn = document.getElementById('vocabGenBtn');
  btn.disabled = true;
  btn.textContent = '生成中...';

  document.getElementById('vocabSection').innerHTML =
    '<div class="loading"><div class="spinner"></div>単語を分析中...</div>';
  document.getElementById('vocabNextBtn').style.display = 'none';

  try {
    // 目標スコアが入力されているかで説明文を切り替える
    const levelLabels = {
      'A2': 'A2（初級）', 'B1': 'B1（中級）',
      'B2': 'B2（中上級）', 'C1': 'C1（上級）'
    };
    const currentInfo = `現在 ${levelLabels[userLevel]}（TOEICスコア目安: ${toeicScore}点）`;
    const targetInfo = targetToeicScore > 0
      ? `目標 ${levelLabels[targetLevel]}（${targetToeicScore}点）`
      : `目標スコア未設定`;

    // 除外ヒント（wordlist.js）
    const excludeHint = typeof getExcludeHint === 'function' ? getExcludeHint(toeicScore) : '';

    let prompt = '';
    const tierGuide = `
各単語に以下のいずれかのtierを付けてください：
- "core"    ：目標レベルで頻出・必ず覚えるべき語
- "advanced"：やや高度または専門的だが理解を深める語
- "context" ：このドラマ特有の専門語・固有表現・低頻度語`;

    if (cachedSubtitleText) {
      const truncated = cachedSubtitleText.slice(0, 3000);
      prompt = `以下は「${selectedDrama.title}」Season ${selectedSeason} Episode ${selectedEpisode} の実際の英語字幕テキストです。

---字幕テキスト---
${truncated}
---ここまで---

この字幕から、${currentInfo}・${targetInfo}の日本人英語学習者が覚えるべき重要単語を${vocabCount}個選んでください。
実際にこのエピソードで使われている単語を優先してください。
目標レベルに向けてステップアップできる難易度の単語を選んでください。${excludeHint}
${tierGuide}

以下のJSON形式のみで返答（説明不要）:
[
  {
    "word": "英単語",
    "pos": "品詞（名詞/動詞/形容詞/副詞）",
    "definition": "日本語の意味（簡潔に）",
    "example": "字幕内の実際の例文またはそれに近い文（英語・短め）",
    "tier": "core"|"advanced"|"context"
  }
]`;
    } else {
      prompt = `英語学習アドバイザーとして、「${selectedDrama.title}」Season ${selectedSeason} Episode ${selectedEpisode} (${selectedDrama.genre})を${currentInfo}・${targetInfo}の日本人学習者が視聴する前に覚えるべき重要英単語を${vocabCount}個選んでください。
目標レベルに向けてステップアップできる難易度の単語を選んでください。${excludeHint}
${tierGuide}

以下のJSON形式のみで返答（説明不要）:
[
  {
    "word": "英単語",
    "pos": "品詞（名詞/動詞/形容詞/副詞）",
    "definition": "日本語の意味（簡潔に）",
    "example": "このエピソードで使われそうな例文（英語・短め）",
    "tier": "core"|"advanced"|"context"
  }
]`;
    }

    // 50単語のJSONは約4000トークン必要なため余裕を持たせる
    const text = await callClaude(prompt, Math.max(2000, vocabCount * 80), (attempt, waitSec) => {
      document.getElementById('vocabSection').innerHTML =
        `<div class="loading"><div class="spinner"></div>混雑中... ${waitSec}秒後に再試行 (${attempt}/3)</div>`;
    });
    let json = JSON.parse(text.match(/\[[\s\S]*\]/)[0]);

    // 後処理フィルター：除外語リストに含まれる単語を除去する
    if (typeof getExcludeSet === 'function' && toeicScore > 0) {
      const excluded = getExcludeSet(toeicScore);
      const before = json.length;
      json = json.filter(w => !excluded.has(w.word.toLowerCase()));
      if (json.length < before) {
        console.log(`[CineLearn] 除外語フィルター: ${before - json.length}語を除去 (${before}→${json.length}語)`);
      }
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
  currentVocabWords = words;

  const wordsHTML = words.map(w => {
    const status       = getWordStatus(w.word);
    const isMast       = status === 'mastered';
    const isDueNow     = status === 'due' || status === 'new';
    const isSkip       = status === 'skipped';
    const isReviewed   = status === 'reviewed_today';
    const srsBadge = isMast      ? '<span class="srs-badge badge-mastered">⭐</span>'
                   : isDueNow    ? '<span class="srs-badge badge-due">🔴</span>'
                   : isReviewed  ? '<span class="srs-badge badge-reviewed">✓</span>'
                   : '';
    const tier = w.tier || 'core';
    const tierBadge = tier === 'context'  ? '<span class="tier-pill tier-context">Context</span>'
                    : tier === 'advanced' ? '<span class="tier-pill tier-advanced">Advanced</span>'
                    :                      '<span class="tier-pill tier-core">Core</span>';
    // testTiers 対象外の単語はテキスト全体をやや淡色に
    const notInTest = !testTiers.includes(tier);
    const nextReview = nextReviewLabel(w.word);
    const nextLabel  = nextReview
      ? `<span class="srs-next-review">📅 次回: ${nextReview}</span>` : '';
    return `
      <div class="vocab-item${isMast ? ' vocab-mastered' : ''}${isSkip ? ' vocab-skipped' : ''}${notInTest ? ' vocab-no-test' : ''}">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${srsBadge}
            <div class="vocab-word">${w.word}</div>
            ${tierBadge}
            ${nextLabel}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${w.example || ''}</div>
        </div>
        <div class="vocab-pos">${w.pos || ''}</div>
        <div class="vocab-def">${w.definition || ''}</div>
        <button class="btn-srs-skip${isSkip ? ' btn-srs-resume' : ''}" data-word="${w.word}">${isSkip ? 'Resume' : 'Skip'}</button>
      </div>`;
  }).join('');

  const { due } = episodeStats(words);
  const reviewBtnHTML = due > 0
    ? `<button class="btn-review-start" id="btnStartReview">🔴 今日の復習 ${due}単語を始める</button>`
    : '';

  // 新規生成時のみソースラベルを表示（保存済みはプログレス欄がヘッダー代わり）
  const sourceSection = !skipHistory && sourceLabel
    ? `<div class="source-label" style="margin-bottom:8px">📝 ${sourceLabel}から生成</div>` : '';

  const sect = document.getElementById('vocabSection');
  sect.innerHTML = `
    ${buildProgressHTML(words)}
    ${sourceSection}
    <div class="vocab-list">${wordsHTML}</div>
    ${reviewBtnHTML}
  `;

  document.getElementById('vocabNextBtn').style.display = 'block';
  document.getElementById('vocabGenBtn').style.display  = 'none';

  if (!skipHistory) saveToHistory();
  saveSettings();

  // Skip / Resume / 復習開始ボタンの委譲リスナーを付け替え
  if (vocabClickListener) sect.removeEventListener('click', vocabClickListener);
  vocabClickListener = (e) => {
    const skipBtn = e.target.closest('.btn-srs-skip');
    if (skipBtn) {
      skipBtn.classList.contains('btn-srs-resume')
        ? unskipWord(skipBtn.dataset.word)
        : skipWord(skipBtn.dataset.word);
      renderVocab(words, sourceLabel, true);
      return;
    }
    if (e.target.id === 'btnStartReview') startReview(words);
  };
  sect.addEventListener('click', vocabClickListener);

  // 拡張機能で保存した単語のうち、この単語リストにないものを末尾に追加
  await renderExtWordsSection(words);
}

// ─────────────────────────────────────────
// 復習セッション（フラッシュカード）
// ─────────────────────────────────────────
let reviewQueue   = [];
let reviewQIdx    = 0;
let reviewRatings = {}; // word → quality (0/3/5)

function startReview(words) {
  const srs = loadSrs();
  reviewQueue   = words
    .filter(w => { const e = srs[w.word.toLowerCase()]; return !e || isDue(e); })
    .sort(() => Math.random() - 0.5);
  reviewQIdx    = 0;
  reviewRatings = {};
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

    const makeGroup = (words, icon, label, cls) => {
      if (!words.length) return '';
      return `
        <div class="review-summary-group">
          <div class="review-summary-label ${cls}">${icon} ${label}（${words.length}単語）</div>
          ${words.map(w => `
            <div class="review-summary-item">
              <span class="review-summary-word">${w.word}</span>
              <span class="review-summary-def">${w.definition || ''}</span>
            </div>`).join('')}
        </div>`;
    };

    const allPerfect = failed.length === 0 && hard.length === 0;
    content.innerHTML = `
      <div class="review-done">
        <div style="font-size:48px;margin-bottom:8px">${allPerfect ? '🌟' : '🎉'}</div>
        <div style="font-size:19px;font-weight:600;margin-bottom:4px">復習完了！</div>
        <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">${reviewQueue.length}単語を復習しました</div>
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
      <div class="review-word-big">${w.word}</div>
      ${w.pos ? `<div class="review-pos-tag">${w.pos}</div>` : ''}
      <button class="review-flip" id="reviewFlip">タップして意味を確認 →</button>
      <div class="review-answer" id="reviewAnswer" style="display:none">
        <div class="review-def-text">${w.definition || ''}</div>
        ${w.example ? `<div class="review-example-text">"${w.example}"</div>` : ''}
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
      reviewRatings[w.word] = q;
      reviewWord(w.word, q);
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
        <div class="drama-title">${d.title}</div>
        <span class="level-pill level-${d.level}">${d.level}</span>
      </div>
      <div class="drama-meta">
        <span>${d.platform}</span>
        <span>${d.genre}</span>
        <span>${d.speech_feature}</span>
      </div>
      <div class="drama-reason">${d.reason}</div>
    `;
    card.addEventListener('click', () => selectDrama(d, card));
    list.appendChild(card);
  });
}


// ドラマを選択してエピソード選択画面へ
function selectDrama(drama, card) {
  document.querySelectorAll('.drama-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedDrama = drama;
  cachedSubtitleText = '';
  cachedSubtitleSource = '';
  closeAddDrama(); // 追加モーダルを閉じる

  setTimeout(async () => {
    goToStep(4);
    document.getElementById('vocabDramaTitle').textContent =
      `「${drama.title}」のエピソードを選んで単語を予習する`;

    // シーズン・エピソード情報をAIに取得させる
    document.getElementById('episodeSelected').textContent = 'シーズン情報を取得中...';
    document.getElementById('vocabGenBtn').disabled = true;
    document.getElementById('vocabSection').innerHTML =
      '<div class="loading"><div class="spinner"></div>シーズン情報を取得中...</div>';

    try {
      const prompt = `「${drama.title}」（${drama.genre}）のシーズンとエピソード数を教えてください。

以下のJSON形式のみで返答（説明不要）:
{
  "seasons": [
    { "season": 1, "episodes": 10 },
    { "season": 2, "episodes": 8 }
  ]
}`;

      const text = await callClaude(prompt);
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
      dramaSeasonInfo = json.seasons;
      buildSeasonEpisodeSelectors(json.seasons);
    } catch (e) {
      // 取得失敗時はデフォルト3シーズン×10話
      dramaSeasonInfo = [
        { season: 1, episodes: 10 },
        { season: 2, episodes: 10 },
        { season: 3, episodes: 10 }
      ];
      buildSeasonEpisodeSelectors(dramaSeasonInfo);
    }

    selectedSeason = 1;
    selectedEpisode = 1;
    saveSettings();

    // S1E1の字幕を即座に読み込む
    await preloadSubtitle();
  }, 300);
}

// クイズを生成する（バックグラウンド）
async function generateQuiz(drama, words) {
  // testTiers に含まれる単語のみテスト対象（tier なしは core 扱い）
  const testableWords = words.filter(w => testTiers.includes(w.tier || 'core'));
  words = testableWords.length > 0 ? testableWords : words; // フィルター後が空なら全単語
  const wordList = words.map(w => w.word).join(', ');
  const prompt = `英語学習クイズを作成してください。
作品：「${drama.title}」Season ${selectedSeason} Episode ${selectedEpisode}
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
        ${q.question.replace('____', '<span class="quiz-blank">____</span>')}
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
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
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
    date: new Date().toLocaleDateString('ja-JP'),
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
}

// クイズ生成完了後に履歴のクイズデータを更新する
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
    history[idx].quizDate = new Date().toLocaleDateString('ja-JP');
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

  const levelLabels = { 'A2': 'A2', 'B1': 'B1', 'B2': 'B2', 'C1': 'C1' };

  // data-action + data-id でイベント委譲（onclick 属性を使わない）
  container.innerHTML = history.map(h => {
    const scoreHtml = h.quizScore !== null
      ? `<span class="history-score ${
          h.quizScore >= 80 ? 'score-high' : h.quizScore >= 60 ? 'score-mid' : 'score-low'
        }">${h.quizScore}%</span>`
      : `<span class="history-score score-none">未受験</span>`;

    const levelRange = h.targetLevel && h.targetLevel !== h.level
      ? `${levelLabels[h.level]} → ${levelLabels[h.targetLevel]}`
      : levelLabels[h.level] || h.level;

    const quizBtn = h.quiz.length > 0
      ? `<button class="btn-history-action btn-history-quiz"
           data-action="quiz" data-id="${h.id}">テストを受ける</button>`
      : `<span class="history-quiz-pending">クイズ準備中</span>`;

    return `
      <div class="history-card">
        <div class="history-card-top">
          <div class="history-card-info">
            <div class="history-drama">${h.drama.title}</div>
            <div class="history-ep">S${h.season} E${h.episode} · ${h.date}</div>
          </div>
          ${scoreHtml}
        </div>
        <div class="history-meta">
          <span>${levelRange}</span>
          <span>${h.words.length}単語</span>
          <span>${h.drama.platform}</span>
        </div>
        <div class="history-actions">
          <button class="btn-history-action" data-action="vocab" data-id="${h.id}">単語を見る</button>
          ${quizBtn}
          <button class="btn-history-delete" data-action="delete" data-id="${h.id}">削除</button>
        </div>
      </div>`;
  }).join('');

  // イベント委譲：コンテナ全体で1つのリスナーが全ボタンを処理する
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'vocab')  showHistoryVocab(id);
    if (action === 'quiz')   retakeHistoryQuiz(id);
    if (action === 'delete') deleteHistoryItem(id);
  }, { once: false });
}

// ─── サブ画面：単語リスト表示 ───

// 履歴から単語リストをモーダル内に表示する
function showHistoryVocab(id) {
  const entry = loadHistory().find(h => h.id === id);
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
      📅 ${entry.date} · ${entry.words.length}単語
    </div>
    <div class="vocab-list" style="padding:0 16px 16px">
      ${entry.words.map(w => `
        <div class="vocab-item">
          <div style="flex:1">
            <div class="vocab-word">${w.word}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${w.example}</div>
          </div>
          <div class="vocab-pos">${w.pos}</div>
          <div class="vocab-def">${w.definition}</div>
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

// 起動時にバッジを初期化する
updateHistoryBadge();

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

// 単語帳の内容を描画する
async function renderWordbook() {
  const words = await store.get(myWordsKey()) || [];
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
          <div class="vocab-word">${w.word}</div>
          ${w.phonetic ? `<span style="font-size:11px;color:var(--text-muted)">${w.phonetic}</span>` : ''}
        </div>
        ${w.sentence ? `
          <div class="wordbook-sentence">"${w.sentence}"</div>` : ''}
        <div class="wordbook-meta">
          ${w.dramaTitle
            ? `<span>📺 ${w.dramaTitle}${w.season != null ? ` S${w.season}` : ''}${w.episode != null ? `E${w.episode}` : ''}</span>`
            : (w.source ? `<span>${w.source}</span>` : '')}
          <span>${w.savedAt}</span>
        </div>
      </div>
      ${w.pos ? `<div class="vocab-pos">${w.pos}</div>` : ''}
      <div class="vocab-def">${w.definition || '（定義なし）'}</div>
      <button class="btn-word-delete" data-word="${w.word}" title="削除">×</button>`;

    // 削除ボタンに addEventListener（特殊文字があっても安全）
    item.querySelector('.btn-word-delete').addEventListener('click', (e) => {
      deleteMyWord(e.currentTarget.dataset.word);
    });

    listEl.appendChild(item);
  });
}

// 単語を1件削除する
async function deleteMyWord(wordText) {
  const words = await store.get(myWordsKey()) || [];
  await store.set(myWordsKey(), words.filter(w => w.word !== wordText));
  await renderWordbook();
  updateWordbookBadge();
}

// 単語をすべて削除する
async function clearAllWords() {
  if (!confirm('保存した単語をすべて削除しますか？')) return;
  await store.set(myWordsKey(), []);
  await renderWordbook();
  updateWordbookBadge();
}

// ヘッダーの件数バッジを更新する
async function updateWordbookBadge() {
  const words = await store.get(myWordsKey()) || [];
  const badge = document.getElementById('wordbookBadge');
  if (badge) badge.textContent = words.length > 0 ? words.length : '';
}

// 起動時にバッジを初期化する
updateWordbookBadge();

// 拡張機能が単語を追加したとき、リアルタイムでバッジ・一覧を更新する
if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (!Object.keys(changes).some(k => k.startsWith('cl_my_words'))) return;

    updateWordbookBadge();

    // 単語帳モーダルが開いていれば再描画
    if (document.getElementById('wordbookModal').style.display === 'flex') {
      renderWordbook();
    }

    // screen-4 が表示中で現エピソードに一致する単語が追加されたら追加単語セクションを更新
    if (selectedDrama && document.getElementById('screen-4').classList.contains('active')) {
      document.getElementById('ext-words-section')?.remove();
      renderExtWordsSection(vocabWords);
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// イベントリスナー登録
// Manifest V3 の拡張機能ページは onclick 属性をセキュリティポリシーで禁止するため
// 全てのボタン操作をここで addEventListener に変換する
// ─────────────────────────────────────────────────────────────────
function initEventListeners() {
  // ─ ヘッダー ─
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
  document.querySelectorAll('.service-card').forEach(card => {
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
  document.getElementById('btnBackToMain').addEventListener('click', () => goToStep('main'));
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

initEventListeners();
// Supabase が設定されていればログイン確認・データ同期
if (typeof initSupabase === 'function') initSupabase();
// ログイン済みならログアウトボタンを表示
if (typeof isLoggedIn === 'function' && isLoggedIn()) {
  const btn = document.getElementById('btnSignOut');
  if (btn) btn.style.display = 'inline-flex';
}
renderProfileScreen();