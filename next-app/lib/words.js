// マイ単語帳（拡張機能由来）と履歴単語のエピソード照合。js/app.js から移植。
// 拡張機能・Supabase が無い試作環境でも localStorage だけで完結するよう、
// chrome.storage / cloudSync 依存は app.js 同様にガードして無効化する。
import { tmdb } from './api';
import { deleteMyWordCloud, pushMyWord } from './supabase';
import { fetchJa } from './jatranslate';
import { fetchCtxJa } from './ctxtranslate';
import { myWordsKey, deletedWordsKey } from './storage';
import { subtitleCacheKey } from './subtitles';

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

// 単語を1件削除（既存 deleteMyWord 相当）。
// 2026-07-15拡充: ①グローバル/プロフィール両キーから消す（selectProfile のグローバル→
// プロフィールコピーで復活しないように）②ログイン時はクラウドの行も消す（pull 全量上書きで
// タイポ語が復活する既知の穴を、明示削除に限り塞ぐ）。
export async function deleteMyWord(profileId, wordText) {
  addToDeletedWords(profileId, wordText);
  const lower = String(wordText || '').toLowerCase();
  const keys = [myWordsKey(null)];
  if (profileId) keys.push(myWordsKey(profileId));
  for (const key of keys) {
    const words = (await store.get(key)) || [];
    // 大文字小文字を区別しない（保存経路によりケース違いで入っていても取り逃さない）
    await store.set(key, words.filter((w) => String(w.word).toLowerCase() !== lower));
  }
  deleteMyWordCloud(wordText); // fire-and-forget（未ログインは内部で no-op）
}

// 手動追加した単語をローカル単語帳へ upsert する（#20 スマホからの単語追加・拡張の保存と同形）。
// グローバル/プロフィール別の両キーへ書く（pull・selectProfile がグローバルを正とするため）。
// 削除済みリストからの復帰は getActiveWords の resaved 自動掃除に任せる。
// my_words は1語1レコード（PK=user_id,word）のため、既存レコードとのマージは拡張 saveWord と
// 同じ規則を守る: ①別の場面での再保存は旧場面を encounters へ退避（リユニオン用・直近10）
// ②取れなかった値（空sentence/ja等）で既存の確定値を潰さない。
// 戻り値=マージ後のレコード（呼び出し側はこれを pushMyWord でクラウドへ送る＝ローカルと一致）。
export async function addManualWord(profileId, entry) {
  if (!entry?.word) return null;
  let merged = entry;
  const upsert = async (key) => {
    const words = (await store.get(key)) || [];
    const idx = words.findIndex((w) => w.word.toLowerCase() === entry.word.toLowerCase());
    if (idx >= 0) {
      const old = words[idx];
      const sameEp =
        old.dramaTitle === entry.dramaTitle &&
        ((old.season === entry.season && old.episode === entry.episode) ||
          entry.season == null ||
          old.season == null);
      const prevEnc = Array.isArray(old.encounters) ? old.encounters : [];
      const encounters = sameEp || !old.dramaTitle
        ? prevEnc
        : [...prevEnc, {
            dramaTitle: old.dramaTitle,
            season: old.season ?? null,
            episode: old.episode ?? null,
            savedAt: old.savedAt ?? null,
            tsSec: old.tsSec ?? null,
          }].slice(-10);
      const patch = {};
      for (const [k, v] of Object.entries(entry)) {
        if (v == null) continue;
        if (v === '') {
          if (k === 'sentence') { if (sameEp && old.sentence) continue; } // 別場面は意図的リセット
          else if ((k === 'ja' || k === 'definition' || k === 'phonetic' || k === 'pos' || k === 'example_ja') && old[k]) continue;
        }
        patch[k] = v;
      }
      words[idx] = { ...old, ...patch, encounters };
      merged = words[idx];
    } else {
      words.unshift(entry);
    }
    await store.set(key, words.slice(0, 2000));
  };
  await upsert(myWordsKey(null));
  if (profileId) await upsert(myWordsKey(profileId));
  return merged;
}

// 単語をすべて削除（既存 clearAllWords 相当）
export async function clearAllWords(profileId) {
  const words = (await store.get(myWordsKey(profileId))) || [];
  addToDeletedWords(profileId, words.map((w) => w.word));
  await store.set(myWordsKey(profileId), []);
}

// 後から付いた和訳を my_words へ書き戻す（同じ訳を二度と生成しないための永続化）。
// グローバル/プロフィール別の両キー＋クラウド（pushMyWord）へ同時に反映する。
// 例文の和訳は「その例文」の訳なので、必ず同じ行の sentence とペアで保存される
// （例文が差し替わった行は pull 側で古い訳を捨てる → 新しい例文で取り直す）。
export async function saveWordTranslation(profileId, wordText, patch) {
  if (!wordText || !patch || !Object.keys(patch).length) return false;
  const lower = String(wordText).toLowerCase();
  const keys = [myWordsKey(null)];
  if (profileId) keys.push(myWordsKey(profileId));
  let merged = null;
  for (const key of keys) {
    const words = (await store.get(key)) || [];
    const idx = words.findIndex((w) => String(w.word || '').toLowerCase() === lower);
    if (idx < 0) continue;
    words[idx] = { ...words[idx], ...patch };
    merged = words[idx];
    await store.set(key, words);
  }
  if (!merged) return false;
  pushMyWord(merged); // ログイン時のみクラウドへ（fire-and-forget・未ログインは内部 no-op）
  return true;
}

// 追加語（拡張のクリック保存・手動追加）の和訳を後埋めして永続化する。
// 旧 translateExtWordDefinitions は独自のバッチプロンプトを callClaude に投げていたため
// サーバの共有キャッシュ（sense_hash）に一切乗らず、端末やユーザーが変わるたびに再課金され、
// さらにクラウドへ書き戻さないので毎回作り直しになっていた（2026-08-06 実測）。
// 新実装は共有キャッシュに乗る経路だけを使い、結果を my_words に保存する:
//   - 単語の意味 : fetchCtxJa(語, 例文)＝多義語をその場面の意味に解決 → 取れなければ1語訳
//   - 例文の和訳 : fetchJa(例文)
// どちらもキーは (語, 文) 単位なので、同じ語でも場面が違えば別の訳が生成・保存される。
export async function fillExtWordJa(extWords, profileId) {
  let changed = false;
  for (const w of extWords) {
    if (!w?.word) continue;
    const sentence = w.example || w.sentence || '';
    const patch = {};

    // 意味（日本語）が未取得＝ ja が無く、definition も日本語を含まない（英語辞書定義 or 空）
    const hasJa = !!w.ja || (!!w.definition && /[぀-ヿ一-鿿]/.test(w.definition));
    if (!hasJa) {
      const ja = (sentence ? await fetchCtxJa(w.word, sentence) : null) ?? (await fetchJa(w.word));
      if (ja) {
        patch.ja = ja;
        w.ja = ja;
        w.definition = ja; // 表示（VocabItem）は definition を見る
        changed = true;
      }
    }

    if (!w.example_ja && sentence) {
      const exJa = await fetchJa(sentence);
      if (exJa) {
        patch.example_ja = exJa;
        w.example_ja = exJa;
        changed = true;
      }
    }

    if (Object.keys(patch).length) await saveWordTranslation(profileId, w.word, patch);
  }
  return changed;
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
// タイトル照合用の正規化: 配信サービス由来と TMDB 由来の表記ゆれを吸収する。
// 実害例（2026-08-06 実機報告・クラウド実データで確定）: Netflix の document.title 由来
// 「スパイダーマン: ホームカミング」（半角コロン+スペース）と TMDB 由来
// 「スパイダーマン：ホームカミング」（全角コロン）が includes 双方向とも不一致になり、
// 映画の追加語が単語リストに一切出なかった（単語帳は照合なしのため出る）。
// 小文字化＋全半角スペース除去＋区切り記号（コロン/スラッシュ/中黒/ダッシュ等）除去で比較する。
function normTitleForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[：:／/・･｜|〜~‐‑–—\-!！?？.。,、'’"”“…]+/g, '');
}

export async function getMyWordsForEpisode(drama, season, episode, profileId, memSub = '') {
  const dramaTitle = drama?.title;
  if (!dramaTitle) return [];
  const words = await getActiveWords(profileId);

  const titleCandidates = [dramaTitle, drama?.title, drama?.englishTitle]
    .map(normTitleForMatch)
    .filter(Boolean);

  // 映画は S/E の概念が無く、保存側が season/episode=null で書く（VocabScreen/拡張とも）。
  // 一方この画面の state は映画でも 1/1 なので、S/E 一致で絞ると映画の語が1つも拾えない
  // （2026-08-05 オーナー報告「追加した単語がリストに出ない」の実原因）。映画はタイトル一致で判定する。
  const isMovie = drama?.type === 'movie' || drama?.mediaType === 'movie';
  const seWords = isMovie
    ? words.filter((w) => w.dramaTitle)
    : words.filter(
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
    const names = [w.dramaTitle, alias[w.dramaTitle]].map(normTitleForMatch).filter(Boolean);
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
    if (isMovie) return true; // 映画はタイトル一致で十分（S/E は無い）
    if (w.season != null && w.episode != null) {
      return w.season == season && w.episode == episode;
    }
    return episodeSub ? episodeSub.includes(w.word.toLowerCase()) : false;
  });
}

// 未割当単語をキャッシュ済み字幕から自動解決してストアを更新する
// 2026-08-06 fail-closed 設計へ変更。旧実装は日本語タイトルが safe キー化（[^a-z0-9]→_）で
// 全て "_" に潰れ、先頭5文字比較が日本語作品同士で常に一致→他作品の字幕に語があれば
// 誤った S/E を付与し得た。新設計の原則は「確信がある時だけ書く」:
//   ① 作品照合は英語 alias（resolveEnglishTitle）を解決してから safe キーの実質比較
//      （"_" を除いて3文字未満のキーは照合に使わない＝英題が取れない作品は付与しない）
//   ② 語が複数エピソードの字幕にヒットしたら付与しない（一意な時だけ）
//   ③ 確定した付与は pushMyWord でクラウドへも永続化
//      （従来はローカルのみ＝ログイン中は次の pull 全量上書きで消えていて実質無効だった）
export async function resolveUnassignedWords(profileId, memSub = '', memTitle = '', memSeason = null, memEpisode = null) {
  const words = await getActiveWords(profileId);
  const unassigned = words.filter((w) => w.dramaTitle && w.season == null);
  if (!unassigned.length) return;

  const safeKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const meaningful = (k) => k.replace(/_/g, '').length >= 3;

  const subEntries = [];
  if (memSub && memTitle && memSeason && memEpisode) {
    subEntries.push({
      titleKey: safeKey(memTitle),
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
  if (!subEntries.length) return;

  // 日本語タイトルは英語 alias に解決してからキー比較（safe キーは日本語を保持できない）
  const aliasCache = getTitleAliasMap();
  const toResolve = [
    ...new Set(
      unassigned.map((w) => w.dramaTitle).filter((t) => !/^[\x00-\x7F]+$/.test(t) && !aliasCache[t])
    ),
  ];
  for (const t of toResolve) await resolveEnglishTitle(t);
  const alias = getTitleAliasMap();

  let changed = false;
  for (const w of unassigned) {
    const cands = [w.dramaTitle, alias[w.dramaTitle]].map(safeKey).filter(meaningful);
    if (!cands.length) continue; // 実質キーが作れない（英題未解決の日本語作品）→ 付与しない
    const scoped = subEntries.filter(
      (e) => meaningful(e.titleKey) && cands.some((c) => e.titleKey.includes(c) || c.includes(e.titleKey))
    );
    const hits = scoped.filter((e) => e.sub.includes(w.word.toLowerCase()));
    const uniqEps = [...new Set(hits.map((e) => `${e.season}-${e.episode}`))];
    if (uniqEps.length !== 1) continue; // 0件 or 複数エピソード該当 → 見送り
    w.season = hits[0].season;
    w.episode = hits[0].episode;
    changed = true;
    pushMyWord(w); // ログイン時はクラウドへ永続化（fire-and-forget・未ログインは内部 no-op）
  }

  if (changed) await store.set(myWordsKey(profileId), words);
}
