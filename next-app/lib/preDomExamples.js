// 切り替え前（2026-07-03 より前）に拡張で保存した語の例文を、OpenSubtitles の1文に取り直す（2026-10-08）。
//   当時の拡張は Netflix 等の画面字幕（DOM）の行をそのまま sentence に保存していた。今は保存時に空で残し
//   OpenSubtitles 由来の1文で後から埋める（extension/content.js「経路②→①畳み込み #3」）。古い行が残ると
//   アプリ内で「字幕：OpenSubtitles」と誤った出所を表示してしまう（legal 指摘・オーナーデータで21語）。
//   ・今の例文を手がかり（lineText）にサーバへ問い合わせ、同じ場面の OpenSubtitles の行に置き換える。
//   ・字幕に無いと確定した語は例文を消す（出所の分からない文は出さない）。一時的な失敗は消さずに次回へ。
//   ・作品を確定できない語（マイリストに無い）も例文を消す（誤った作品を引かない）。
//   ・済んだ語は端末に記録（cl_predom_fix_<profile>）。1回の実行は MAX_PER_RUN 語まで。
import { authHeaders } from './api';
import { saveWordTranslation, sameWorkTitle } from './words';
import { toIsoDate } from './storage';

export const PREDOM_CUTOFF = '2026-07-03';
const MAX_PER_RUN = 8;
// 「この作品・話の字幕にこの語は無い」と確定した理由だけ（これ以外の失敗は一時的とみなして次回に再挑戦）
const DEFINITIVE = new Set(['no_match', 'no_subtitle_file']);

function doneKey(profileId) {
  return profileId ? `cl_predom_fix_${profileId}` : 'cl_predom_fix';
}
function loadDone(profileId) {
  try {
    const v = JSON.parse(localStorage.getItem(doneKey(profileId)) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}
function saveDone(profileId, set) {
  try {
    localStorage.setItem(doneKey(profileId), JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

// 対象＝切り替え前に保存され、まだ例文を持っている語（手動追加は除く）。純関数（テスト用）。
export function preDomTargets(words, done = new Set()) {
  return (words || []).filter((w) => {
    if (!w?.word || w.origin === 'manual') return false;
    // 古い保存語は savedAt が「2026/6/12」形式＝そのまま文字列で比べると '/' > '-' で「7/3 より後」と誤判定する
    const saved = toIsoDate(String(w.savedAt || '').trim().slice(0, 10)) || '';
    if (!saved || saved >= PREDOM_CUTOFF) return false;
    if (!String(w.sentence || '').trim()) return false;
    return !done.has(String(w.word).toLowerCase());
  });
}

async function fetchExample(payload) {
  try {
    const res = await fetch('/api/example', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    return await res.json();
  } catch {
    return { found: false, reason: 'network' };
  }
}

// words: getActiveWords(profileId) の配列。myDramas: settings.myDramas。戻り値: 1語でも書き換えたら true。
export async function refetchPreDomExamples(words, { profileId, myDramas = [] }) {
  const done = loadDone(profileId);
  const targets = preDomTargets(words, done).slice(0, MAX_PER_RUN);
  if (!targets.length) return false;
  let changed = false;
  for (const w of targets) {
    const key = String(w.word).toLowerCase();
    const known = w.dramaTitle
      ? myDramas.find((d) => sameWorkTitle(w.dramaTitle, d.title) || sameWorkTitle(w.dramaTitle, d.englishTitle))
      : null;
    let res = null;
    if (known) {
      const isMovie = known.type === 'movie' || known.mediaType === 'movie' || w.season == null;
      res = await fetchExample({
        word: w.word,
        title: known.englishTitle || known.title,
        tmdbId: known.tmdbId ?? undefined,
        season: isMovie ? null : w.season ?? null,
        episode: isMovie ? null : w.episode ?? null,
        currentTimeSec: Number.isFinite(w.tsSec) ? w.tsSec : undefined,
        lineText: w.sentence, // 今の例文を手がかりに、同じ場面の OpenSubtitles の行を探す
      });
      if (res?.reason === 'rate_limited' || res?.reason === 'network') break; // 次回に回す
      // 一時的な失敗（字幕の取得失敗・作品の同定失敗・上限など）は消さずに次回へ。消すのは「字幕に無い」と
      // 確定した時だけ（2026-10-08: API 鍵の無いローカルで試した時に、一時的な失敗で9語の例文を消してしまった反省）。
      if (!res?.found && !DEFINITIVE.has(res?.reason)) continue;
    }
    if (res?.found && res.sentence) {
      const patch = { sentence: res.sentence, example_ja: '', exampleFail: '' };
      if (Number.isFinite(res.tsSec)) patch.tsSec = res.tsSec;
      await saveWordTranslation(profileId, w.word, { ...patch, _clearExampleJa: true });
    } else {
      // 見つからない・作品を確定できない＝出所を示せないので例文を消す
      await saveWordTranslation(profileId, w.word, {
        sentence: '',
        example_ja: '',
        exampleFail: res?.reason || 'tmdb_unresolved',
        exampleFailAt: new Date().toISOString(),
        _clearExampleJa: true,
        _clearSentence: true,
      });
    }
    done.add(key);
    changed = true;
  }
  saveDone(profileId, done);
  return changed;
}
