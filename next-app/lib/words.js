// マイ単語帳（拡張機能由来）と履歴単語のエピソード照合。js/app.js から移植。
// 拡張機能・Supabase が無い試作環境でも localStorage だけで完結するよう、
// chrome.storage / cloudSync 依存は app.js 同様にガードして無効化する。
import { tmdb } from './api';
import { deleteMyWordCloud, pushMyWord } from './supabase';
import { fetchJa } from './jatranslate';
import { fetchCtxJa } from './ctxtranslate';
import { myWordsKey, deletedWordsKey } from './storage';
import { subtitleCacheKey, trimExampleToSentence, EXAMPLE_MAX_CHARS } from './subtitles';

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
      let sentenceKept = false; // 既存例文を守った回か（時刻を道連れにするため覚えておく）
      for (const [k, v] of Object.entries(entry)) {
        if (v == null) continue;
        if (v === '') {
          if (k === 'sentence') { if (sameEp && old.sentence) { sentenceKept = true; continue; } } // 別場面は意図的リセット
          else if ((k === 'ja' || k === 'definition' || k === 'phonetic' || k === 'pos' || k === 'example_ja') && old[k]) continue;
        }
        patch[k] = v;
      }
      // 📍時刻は「その例文の時刻」。例文を据え置いた回は時刻も据え置く（ねじれ防止）。
      // 逆に別場面として例文をリセットした回は、今回時刻が取れていなくても旧場面の時刻を
      // 残さない（S/E と例文は新しい場面なのに📍だけ前の話、という行を作らない）。
      if (sentenceKept) delete patch.tsSec;
      else if (!sameEp && patch.tsSec == null) patch.tsSec = entry.tsSec ?? null;
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
  // "_" 始まりは push への制御フラグ（_clearExampleJa 等）＝端末には保存しない。
  const stored = Object.fromEntries(Object.entries(patch).filter(([k]) => !k.startsWith('_')));
  let merged = null;
  for (const key of keys) {
    const words = (await store.get(key)) || [];
    const idx = words.findIndex((w) => String(w.word || '').toLowerCase() === lower);
    if (idx < 0) continue;
    words[idx] = { ...words[idx], ...stored };
    merged = { ...words[idx], ...patch };
    await store.set(key, words);
  }
  if (!merged) return false;
  pushMyWord(merged); // ログイン時のみクラウドへ（fire-and-forget・未ログインは内部 no-op）
  return true;
}

// 保存済みの語で、例文が段落まるごと（複数話者の会話が数百字）になっているものを
// 「その語を含む1文」へ詰め直して永続化する（2026-08-07・実データで391字の例文を確認）。
// 例文が変われば和訳は無効になるので example_ja を落とし、既存の後埋め経路に取り直させる。
// クラウドへは _clearExampleJa で明示的に null を送る（送らない＝据え置きで古い訳が残るため）。
export async function repairLongExamples(words, profileId) {
  let changed = false;
  for (const w of words || []) {
    if (!w?.word) continue;
    const ex = w.example || w.sentence || '';
    if (!ex || ex.length <= EXAMPLE_MAX_CHARS) continue;
    const trimmed = trimExampleToSentence(ex, w.word);
    if (!trimmed || trimmed === ex) continue; // 1文に割れない＝触らない（壊さない）
    const patch = { example_ja: '' };
    if (w.sentence) patch.sentence = trimmed;
    if (w.example) patch.example = trimmed;
    Object.assign(w, patch); // 呼び出し元が今表示している行にも即反映
    await saveWordTranslation(profileId, w.word, { ...patch, _clearExampleJa: true });
    changed = true;
  }
  return changed;
}

// 追加語（拡張のクリック保存・手動追加）の和訳を後埋めして永続化する。
// 旧 translateExtWordDefinitions は独自のバッチプロンプトを callClaude に投げていたため
// サーバの共有キャッシュ（sense_hash）に一切乗らず、端末やユーザーが変わるたびに再課金され、
// さらにクラウドへ書き戻さないので毎回作り直しになっていた（2026-08-06 実測）。
// 新実装は共有キャッシュに乗る経路だけを使い、結果を my_words に保存する:
//   - 単語の意味 : fetchCtxJa(語, 例文)＝多義語をその場面の意味に解決 → 取れなければ1語訳
//   - 例文の和訳 : fetchJa(例文)
// どちらもキーは (語, 文) 単位なので、同じ語でも場面が違えば別の訳が生成・保存される。
// 訳を取る前に、段落化した例文を1文へ詰め直す（詰めた行は訳を取り直す＝ペアを保つ）。
export async function fillExtWordJa(extWords, profileId) {
  let changed = await repairLongExamples(extWords, profileId);
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
// v2: 旧キー cl_title_alias は /search/tv 固定時代の誤エイリアス（例: アベンジャーズ→
// "Marvel's Avengers"=TVアニメ名）を含み得るため、キーを改めて作り直す（再解決は作品ごと1回）。
function getTitleAliasMap() {
  try {
    return JSON.parse(localStorage.getItem('cl_title_alias2') || '{}');
  } catch {
    return {};
  }
}
// 解決先の media_type（movie/tv）。resolveUnassignedWords が映画語を
// S/E 付与対象から外すために参照する（映画は season=null が不変則）。
function getTitleMediaMap() {
  try {
    return JSON.parse(localStorage.getItem('cl_title_media2') || '{}');
  } catch {
    return {};
  }
}
function saveTitleAlias(jp, en, media) {
  if (!jp || !en) return;
  const map = getTitleAliasMap();
  if (map[jp] !== en) {
    map[jp] = en;
    try {
      localStorage.setItem('cl_title_alias2', JSON.stringify(map));
    } catch {
      /* skip */
    }
  }
  if (media) {
    const mm = getTitleMediaMap();
    // 日本語キーに加えて解決先の英題キーでも引けるように登録する（history スナップ
    // ショット等は英題しか持たないことがあり、そこから「映画か？」を判定したいため）。
    let changed = false;
    for (const k of [jp, en]) {
      if (k && mm[k] !== media) {
        mm[k] = media;
        changed = true;
      }
    }
    if (changed) {
      try {
        localStorage.setItem('cl_title_media2', JSON.stringify(mm));
      } catch {
        /* skip */
      }
    }
  }
}
// TMDB のヒットから英語タイトルを取り出す（TV は詳細の en-US 名／映画はラテン原題）。
async function titleOf(hit) {
  if (hit.media_type === 'tv') {
    const detail = await tmdb({ action: 'seasons', tvId: hit.id });
    return detail.name || hit.original_name || null;
  }
  // 映画はラテン文字の原題を英題として使う（englishTitle のラテン原題化と同じ規則）。
  // 原題が非ラテン（邦画等）は localized title のままで実害なし＝直接照合と同値。
  const orig = hit.original_title || '';
  return orig && /^[\x00-\x7F]+$/.test(orig) ? orig : hit.title || null;
}

// セッション内メモ（TMDB障害・検索0件・非完全一致の結果を毎レンダー再照会しないため。
// 永続の負キャッシュにはしない＝次セッションで再試行の余地を残す）。
// 値は string | null | Promise。照会開始と同時に Promise を同期登録することで、
// 同一 tick 内の連続呼び出し（再会判定の語×履歴ループ等）が同じタイトルへ
// 並列リクエストを多重発火させない（in-flight dedup）。
const _aliasMem = new Map();
async function resolveEnglishTitle(jpTitle) {
  if (!jpTitle) return null;
  if (/^[\x00-\x7F]+$/.test(jpTitle)) return jpTitle;
  const cache = getTitleAliasMap();
  if (cache[jpTitle]) return cache[jpTitle];
  if (_aliasMem.has(jpTitle)) return _aliasMem.get(jpTitle); // 確定値 or 解決中 Promise
  const p = (async () => {
    try {
      // 配信サービスの DOM 由来タイトルは「マンダロリアン | Disney+(ディズニープラス)」の
      // ように配信元が付くことがある。素の検索では完全一致に至らないため、'|' の前だけの
      // クエリも試す（実データで ファインディング・ニモ | Disney+… が英題と照合できず失敗）。
      const queries = [jpTitle];
      const cleaned = jpTitle.split(/[|｜]/)[0].trim();
      if (cleaned && cleaned !== jpTitle) queries.push(cleaned);
      let fallback = null;
      for (const q of queries) {
        // 旧実装は /search/tv 固定＝映画タイトルが構造的に名寄せ不能だった
        // （2026-08-07 実機再現で確定: 作品側が英題・保存語側が邦題のスパイダーマンで
        //   追加語が単語リストに1件も出ない）。映画/TV横断の search_multi へ変更。
        const searchData = await tmdb({ action: 'search_multi', query: q });
        const results = (searchData.results || []).filter(
          (r) => r.media_type === 'tv' || r.media_type === 'movie'
        );
        // 同名異作の誤爆防止: 日本語タイトルの正規化完全一致を優先し、映画/TV 両方が
        // 完全一致する同名作（ドラマ⇄映画化）は TV を採る（TV 側の S/E 用途が壊れやすい）。
        const norm = normTitleForMatch(q);
        const exact = results.filter((r) => normTitleForMatch(r.name || r.title) === norm);
        const hit = exact.find((r) => r.media_type === 'tv') || exact[0];
        if (!hit) {
          if (!fallback) fallback = results[0] || null;
          continue;
        }
        const en = await titleOf(hit);
        // 恒久キャッシュは正規化完全一致で作品を特定できた時だけ。先頭ヒットへの
        // フォールバックを永続化すると、誤作品を無効化手段なしで抱え込むため。
        // キーは元のタイトル（呼び出し側は汚れたタイトルのまま引く）。
        if (en) saveTitleAlias(jpTitle, en, hit.media_type);
        if (en) return en;
      }
      return fallback ? await titleOf(fallback) : null;
    } catch {
      return null; // 失敗もメモ化される（毎レンダー再発火防止・永続はしない）
    }
  })();
  _aliasMem.set(jpTitle, p);
  const v = await p;
  _aliasMem.set(jpTitle, v);
  return v;
}

// 同期のタイトル照合（sameWorkTitle）の前に、日本語タイトルの英語 alias をまとめて
// 解決してキャッシュへ載せておく。解決済み・ASCII は即返り、失敗はセッション内
// 負キャッシュ＝呼び放題で安全（in-flight dedup により同時多重発火もしない）。
export async function prewarmTitleAliases(titles) {
  const jp = [...new Set((titles || []).filter((t) => t && !/^[\x00-\x7F]+$/.test(t)))];
  await Promise.all(jp.map((t) => resolveEnglishTitle(t).catch(() => {})));
}

// 拡張機能で保存した単語のうち、現ドラマ・エピソードに一致するものを返す。
// drama = 選択中ドラマ（title / englishTitle）, memSub = メモリ上の字幕（任意）
// タイトル照合用の正規化: 配信サービス由来と TMDB 由来の表記ゆれを吸収する。
// 実害例（2026-08-06 実機報告・クラウド実データで確定）: Netflix の document.title 由来
// 「スパイダーマン: ホームカミング」（半角コロン+スペース）と TMDB 由来
// 「スパイダーマン：ホームカミング」（全角コロン）が includes 双方向とも不一致になり、
// 映画の追加語が単語リストに一切出なかった（単語帳は照合なしのため出る）。
// 小文字化＋全半角スペース除去＋区切り記号（コロン/スラッシュ/中黒/ダッシュ等）除去で比較する。
export function normTitleForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[：:／/・･｜|〜~‐‑–—\-!！?？.。,、'’"”“…]+/g, '');
}

// 正規化済みタイトル同士の一致判定。短い正規化タイトル（Up／It 等の原題）を includes で
// 比べると "upload"⊃"up" のような包含誤爆で無関係作品が同一視されるため、4文字未満は
// 完全一致のみとする。
function titleHitNorm(a, b) {
  return a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)));
}

// 正準名（TMDB 名寄せ後の英語タイトル・ASCII は自身）を正規化して返す（同期）。
// 永続キャッシュ→セッションメモの順に参照し、未解決の日本語タイトルは fire-and-forget で
// 解決を蒔く（in-flight dedup 済み）。未解決の間は null。
function cachedCanonTitle(t) {
  if (/^[\x00-\x7F]+$/.test(t)) return normTitleForMatch(t);
  const alias = getTitleAliasMap();
  if (alias[t]) return normTitleForMatch(alias[t]);
  const mem = _aliasMem.get(t);
  if (typeof mem === 'string') return normTitleForMatch(mem);
  resolveEnglishTitle(t);
  return null;
}

// 同一作品判定（日英・表記ゆれ横断／同期）。再会判定など「同じ作品か」を軽量に知りたい
// 場所向け。両側の正準名が分かる時は**等値のみ**で判定する＝「アベンジャーズ」と
// 「アベンジャーズ／エンドゲーム」のような続編（タイトル包含）は別作品になり、続編間の
// 語彙再会を祝える（2026-08-07 オーナー要望・シリーズ一気見は核ユースケース）。
// 表記ゆれは TMDB の作品同定が同じ正準名へ収束させる（例: ストレンジャー・シングス
// 未知の世界 → Stranger Things ← Stranger Things）。名寄せが未解決の側が残る時だけ
// 包含一致で保守的に同一視する（自作品との疑似再会の再発防止を優先）。
export function sameWorkTitle(a, b) {
  if (!a || !b) return false;
  const na = normTitleForMatch(a);
  const nb = normTitleForMatch(b);
  if (na === nb) return true; // 全半角コロン等の表記ゆれは正規化の等値で吸収
  const ca = cachedCanonTitle(a);
  const cb = cachedCanonTitle(b);
  if (ca !== null && cb !== null) return ca === cb;
  const A = [na, ca].filter(Boolean);
  const B = [nb, cb].filter(Boolean);
  return A.some((x) => B.some((y) => titleHitNorm(x, y)));
}

// 名寄せ結果から「映画と判明しているタイトルか」（日英どちらのキーでも引ける）
export function isKnownMovieTitle(t) {
  return !!t && getTitleMediaMap()[t] === 'movie';
}

export async function getMyWordsForEpisode(drama, season, episode, profileId, memSub = '') {
  const dramaTitle = drama?.title;
  if (!dramaTitle) return [];
  const words = await getActiveWords(profileId);

  // 照合は正規化ではなく生タイトルのまま持ち、sameWorkTitle（正準名の等値・未解決時のみ
  // 包含）に委ねる。作品側が日本語のみ（旧エントリ等）で保存語側が英語の逆方向にも
  // 名寄せが橋を架ける（解決結果は永続キャッシュ＝作品ごと一度きり）。
  const titleCandidates = [...new Set([dramaTitle, drama?.englishTitle].filter(Boolean))];

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
  // 同期の sameWorkTitle が正準名で判定できるよう、候補と保存語のタイトルを先に解決しておく。
  await prewarmTitleAliases([...titleCandidates, ...seWords.map((w) => w.dramaTitle)]);

  // 同一作品かどうかは再会判定と同じ規則（正準名の等値・未解決の側があれば包含で保守的に）。
  // 旧実装の包含固定は「アベンジャーズ」と「アベンジャーズ／エンドゲーム」を同一視し、
  // シリーズ続編の語が互いのリストに混入していた（2026-08-07）。
  const titleMatches = (w) => titleCandidates.some((tc) => sameWorkTitle(w.dramaTitle, tc));

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
  const mediaMap = getTitleMediaMap();
  for (const w of unassigned) {
    // 映画は season=null が正（S/E の概念なし）。名寄せが映画に解決した語は付与対象外
    // （search_multi 化で映画タイトルも alias が通るようになり、映画の字幕キャッシュ
    //   cl_sub_..._s1e1 と照合が成立して S1E1 を誤付与し得るため＝fail-closed の維持）。
    if (mediaMap[w.dramaTitle] === 'movie') continue;
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
