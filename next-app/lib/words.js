// マイ単語帳（拡張機能由来）と履歴単語のエピソード照合。js/app.js から移植。
// 拡張機能・Supabase が無い試作環境でも localStorage だけで完結するよう、
// chrome.storage / cloudSync 依存は app.js 同様にガードして無効化する。
import { tmdb, callClaude } from './api';
import { myWordsKey, deletedWordsKey } from './storage';
import { subtitleCacheKey } from './subtitles';
import { repairJson } from './vocab';

// ── ストレージ抽象化（chrome.storage があれば使う・無ければ localStorage）──
export const store = {
  get(key) {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return new Promise((resolve) =>
        chrome.storage.local.get([key], (result) => resolve(result[key] ?? null))
      );
    }
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(key)) ?? null);
    } catch {
      return Promise.resolve(null);
    }
  },
  set(key, value) {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
    }
    localStorage.setItem(key, JSON.stringify(value));
    return Promise.resolve();
  },
};

function getDeletedWords(profileId) {
  try {
    return JSON.parse(localStorage.getItem(deletedWordsKey(profileId)) || '[]');
  } catch {
    return [];
  }
}

// 削除済みを除いた単語リストを返す（既存 getActiveWords 準拠）
export async function getActiveWords(profileId) {
  const all = (await store.get(myWordsKey(profileId))) || [];
  const deleted = getDeletedWords(profileId);
  if (!deleted.length) return all;

  const resaved = all.filter((w) => deleted.includes(w.word));
  if (resaved.length) {
    const resavedSet = new Set(resaved.map((w) => w.word));
    const newDeleted = deleted.filter((w) => !resavedSet.has(w));
    localStorage.setItem(deletedWordsKey(profileId), JSON.stringify(newDeleted));
    return all;
  }
  return all.filter((w) => !deleted.includes(w.word));
}

// 削除済みリストに追加（再保存された単語の非表示フィルタ用）
function addToDeletedWords(profileId, wordTexts) {
  const list = Array.isArray(wordTexts) ? wordTexts : [wordTexts];
  const current = getDeletedWords(profileId);
  localStorage.setItem(deletedWordsKey(profileId), JSON.stringify([...new Set([...current, ...list])]));
}

// 単語を1件削除（既存 deleteMyWord 相当）
export async function deleteMyWord(profileId, wordText) {
  addToDeletedWords(profileId, wordText);
  const words = (await store.get(myWordsKey(profileId))) || [];
  await store.set(myWordsKey(profileId), words.filter((w) => w.word !== wordText));
}

// 単語をすべて削除（既存 clearAllWords 相当）
export async function clearAllWords(profileId) {
  const words = (await store.get(myWordsKey(profileId))) || [];
  addToDeletedWords(profileId, words.map((w) => w.word));
  await store.set(myWordsKey(profileId), []);
}

// 拡張機能単語の英語定義をバックグラウンドで日本語に翻訳して保存する
// （既存 translateExtWordDefinitions）。変更があれば true を返す。
export async function translateExtWordDefinitions(extWords, profileId) {
  // 日本語文字を含まない定義（＝英語）を持つ単語だけ対象
  const needsTranslation = extWords.filter((w) => w.definition && !/[぀-ヿ一-鿿]/.test(w.definition));
  if (!needsTranslation.length) return false;

  const BATCH = 10;
  let anyChanged = false;
  for (let i = 0; i < needsTranslation.length; i += BATCH) {
    const batch = needsTranslation.slice(i, i + BATCH);
    const inputArr = batch.map((w) => ({ word: w.word, definition: w.definition, definition_ja: '' }));
    const prompt = `以下のJSON配列の各単語について、definition（英語の意味説明）を簡潔な日本語に翻訳してdefinition_jaに入れてください。
- 簡潔に（10文字以内が理想）
- JSON配列のみ返答（説明不要）

${JSON.stringify(inputArr)}`;

    try {
      const text = await callClaude(prompt, 800);
      const rawArr = text.match(/\[[\s\S]*\]/)?.[0] || '[]';
      let arr = [];
      try {
        arr = JSON.parse(rawArr);
      } catch {
        arr = JSON.parse(repairJson(rawArr));
      }

      const allWords = (await store.get(myWordsKey(profileId))) || [];
      let changed = false;
      arr.forEach((item) => {
        if (!item?.word || !item?.definition_ja?.trim()) return;
        const orig = extWords.find((w) => w.word.toLowerCase() === item.word.toLowerCase());
        if (orig) orig.definition = item.definition_ja.trim();
        const stored = allWords.find((w) => w.word?.toLowerCase() === item.word.toLowerCase());
        if (stored) {
          stored.definition = item.definition_ja.trim();
          changed = true;
        }
      });
      if (changed) {
        await store.set(myWordsKey(profileId), allWords);
        anyChanged = true;
      }
    } catch {
      /* バッチ失敗は無視 */
    }
  }
  return anyChanged;
}

// ── タイトル名寄せ（日本語 → 英語）─────────────────────────
function getTitleAliasMap() {
  try {
    return JSON.parse(localStorage.getItem('cl_title_alias') || '{}');
  } catch {
    return {};
  }
}
function saveTitleAlias(jp, en) {
  if (!jp || !en) return;
  const map = getTitleAliasMap();
  if (map[jp] === en) return;
  map[jp] = en;
  try {
    localStorage.setItem('cl_title_alias', JSON.stringify(map));
  } catch {
    /* skip */
  }
}
async function resolveEnglishTitle(jpTitle) {
  if (!jpTitle) return null;
  if (/^[\x00-\x7F]+$/.test(jpTitle)) return jpTitle;
  const cache = getTitleAliasMap();
  if (cache[jpTitle]) return cache[jpTitle];
  try {
    const searchData = await tmdb({ action: 'search', query: jpTitle });
    const show = searchData.results?.[0];
    if (!show) return null;
    const detail = await tmdb({ action: 'seasons', tvId: show.id });
    const en = detail.name || show.original_name || null;
    if (en) saveTitleAlias(jpTitle, en);
    return en;
  } catch {
    return null;
  }
}

// 拡張機能で保存した単語のうち、現ドラマ・エピソードに一致するものを返す。
// drama = 選択中ドラマ（title / englishTitle）, memSub = メモリ上の字幕（任意）
export async function getMyWordsForEpisode(drama, season, episode, profileId, memSub = '') {
  const dramaTitle = drama?.title;
  if (!dramaTitle) return [];
  const words = await getActiveWords(profileId);

  const titleCandidates = [dramaTitle, drama?.title, drama?.englishTitle]
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  const seWords = words.filter(
    (w) =>
      w.dramaTitle &&
      w.season != null &&
      w.episode != null &&
      w.season == season &&
      w.episode == episode
  );
  const aliasCache = getTitleAliasMap();
  const toResolve = [
    ...new Set(
      seWords.map((w) => w.dramaTitle).filter((t) => !/^[\x00-\x7F]+$/.test(t) && !aliasCache[t])
    ),
  ];
  for (const t of toResolve) await resolveEnglishTitle(t);
  const alias = getTitleAliasMap();

  const titleMatches = (w) => {
    const names = [w.dramaTitle, alias[w.dramaTitle]].filter(Boolean).map((s) => s.toLowerCase());
    return names.some((wl) => titleCandidates.some((tc) => wl.includes(tc) || tc.includes(wl)));
  };

  const episodeSub = (
    memSub ||
    localStorage.getItem(subtitleCacheKey(dramaTitle, season, episode)) ||
    localStorage.getItem(subtitleCacheKey(drama?.englishTitle, season, episode)) ||
    ''
  ).toLowerCase();

  return words.filter((w) => {
    if (!w.dramaTitle) return false;
    if (!titleMatches(w)) return false;
    if (w.season != null && w.episode != null) {
      return w.season == season && w.episode == episode;
    }
    return episodeSub ? episodeSub.includes(w.word.toLowerCase()) : false;
  });
}

// 未割当単語をキャッシュ済み字幕から自動解決してストアを更新する
export async function resolveUnassignedWords(profileId, memSub = '', memTitle = '', memSeason = null, memEpisode = null) {
  const words = await getActiveWords(profileId);
  const unassigned = words.filter((w) => w.dramaTitle && w.season == null);
  if (!unassigned.length) return;

  const subEntries = [];
  if (memSub && memTitle && memSeason && memEpisode) {
    subEntries.push({
      titleKey: memTitle.toLowerCase(),
      season: memSeason,
      episode: memEpisode,
      sub: memSub.toLowerCase(),
    });
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('cl_sub_')) continue;
    const m = key.match(/^cl_sub_(.+)_s(\d+)e(\d+)$/);
    if (!m) continue;
    const sub = localStorage.getItem(key);
    if (!sub) continue;
    subEntries.push({
      titleKey: m[1],
      season: parseInt(m[2]),
      episode: parseInt(m[3]),
      sub: sub.toLowerCase(),
    });
  }

  let changed = false;
  for (const w of unassigned) {
    const tl = w.dramaTitle.toLowerCase().replace(/[^a-z0-9]/g, '_');
    for (const entry of subEntries) {
      if (!entry.titleKey.includes(tl.slice(0, 5)) && !tl.includes(entry.titleKey.slice(0, 5))) continue;
      if (entry.sub.includes(w.word.toLowerCase())) {
        w.season = entry.season;
        w.episode = entry.episode;
        changed = true;
        break;
      }
    }
  }

  if (changed) await store.set(myWordsKey(profileId), words);
}
