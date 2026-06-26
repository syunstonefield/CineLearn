// 学習時間（今から計測）。アプリを前景で開いている時間を秒で積算する。
// 過去分は計測していないため 0 から開始（ユーザー合意・2026-06-26）。
// クラウド同期はしない（端末ローカル・装飾的指標）。プロフィール別キー。

export function studyTimeKey(profileId) {
  return profileId ? `cl_study_sec_${profileId}` : 'cl_study_sec';
}

export function getStudySeconds(profileId) {
  try {
    return parseInt(localStorage.getItem(studyTimeKey(profileId)) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function addStudySeconds(profileId, sec) {
  if (!sec || sec <= 0) return;
  try {
    const cur = getStudySeconds(profileId);
    localStorage.setItem(studyTimeKey(profileId), String(cur + Math.round(sec)));
  } catch {
    /* SSR / プライベートモード等は無視 */
  }
}

// ── 作品別の学習時間（Phase 2 詳細ページ用・今から計測・過去0） ──
// プロフィール別に { ドラマタイトル: 秒 } のマップで持つ。
export function dramaStudyKey(profileId) {
  return profileId ? `cl_study_drama_${profileId}` : 'cl_study_drama';
}
export function getDramaStudyMap(profileId) {
  try {
    const m = JSON.parse(localStorage.getItem(dramaStudyKey(profileId)) || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}
export function getDramaStudySeconds(profileId, title) {
  if (!title) return 0;
  return getDramaStudyMap(profileId)[title] || 0;
}
export function addDramaStudySeconds(profileId, title, sec) {
  if (!title || !sec || sec <= 0) return;
  try {
    const m = getDramaStudyMap(profileId);
    m[title] = (m[title] || 0) + Math.round(sec);
    localStorage.setItem(dramaStudyKey(profileId), JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

// 表示用: 秒 → 「X.X時間」/「X分」/「0分」。
export function formatStudyTime(sec) {
  const s = Math.max(0, sec || 0);
  if (s < 60) return '0分';
  if (s < 3600) return `${Math.round(s / 60)}分`;
  return `${(s / 3600).toFixed(1)}時間`;
}
