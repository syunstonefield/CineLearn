// 「追加した単語」の例文を後から埋め直す（②再試行）＋失敗理由を記録する（③可観測性）。
//
// 背景（2026-08-08）: 拡張は保存直後にサーバへ例文を取りに行くが、失敗しても無言で諦めていた。
// そのため「作品名が出ない」「例文が付かない」「リストが後半だけ」の3件とも、ユーザーからは
// 一様に『なんか出ない』としか見えず、原因の切り分けにコードの読み下しが必要だった。
// ここでは (1) 例文の無い語をアプリ側から取り直し (2) 失敗したら理由を語に残す。
//
// ★アプリから叩く利点（④の先取り）: 拡張は作品名（配信サイトの表示名＝邦題）しか送れないが、
//   アプリは同じ作品を **確定した tmdbId** で持っている。それを渡せば曖昧検索そのものを迂回でき、
//   「邦題が別作品に解決される」種類の事故が構造的に起きない。
//   （拡張に作品同定を持たせる案(④)は、この経路で大半の効果が得られるため優先度が下がる）
import { saveWordTranslation } from './words';

// 1画面あたりの取得上限。OpenSubtitles の DL 枠とレート制限（60/分）を焼かないための保険。
const MAX_PER_RUN = 5;

export const EXAMPLE_FAIL_LABEL = {
  tmdb_unresolved: '作品を特定できませんでした',
  no_subtitle_file: 'この作品の字幕が見つかりませんでした',
  subtitle_fetch_failed: '字幕を取得できませんでした',
  no_match: '字幕にこの語が見つかりませんでした',
  no_anchor_no_near: '保存時の再生位置が不明でした',
  rate_limited: '混み合っています（時間をおいて再取得します）',
  missing_params: '作品情報が足りませんでした',
  network: '通信に失敗しました',
};

export function exampleFailLabel(reason) {
  return EXAMPLE_FAIL_LABEL[reason] || '例文を取得できませんでした';
}

async function fetchExample(payload) {
  try {
    const res = await fetch('/api/example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return { found: false, reason: 'network' };
  }
}

// words: VocabScreen が表示している「追加した単語」（例文が空のものだけ対象）。
// drama: 表示中の作品（title/englishTitle/tmdbId/type）。season/episode は TV のみ意味を持つ。
// 戻り値: 1件でも更新したら true（呼び出し側は再描画する）。
export async function backfillMissingExamples(words, { drama, season, episode, isMovie, profileId }) {
  if (!Array.isArray(words) || !words.length || !drama) return false;
  const targets = words
    .filter((w) => w?.word && !(w.example || '').trim() && !w.exampleFail)
    .slice(0, MAX_PER_RUN);
  if (!targets.length) return false;

  let changed = false;
  for (const w of targets) {
    const payload = {
      word: w.word,
      // 作品名は英題を優先（OpenSubtitles は英題でしか当たらない）。tmdbId があれば
      // サーバはタイトル検索を行わずこの ID を使う＝邦題の曖昧検索を完全に迂回できる。
      title: drama.englishTitle || drama.title,
      tmdbId: drama.tmdbId ?? undefined,
      season: isMovie ? null : season,
      episode: isMovie ? null : episode,
      // 保存時の📍があれば窓の手がかりとして渡す（サーバは near ±45秒で候補を絞る）
      currentTimeSec: w.tsSec ?? undefined,
    };
    const res = await fetchExample(payload);
    if (res?.found && res.sentence) {
      const patch = { sentence: res.sentence, example_ja: '', exampleFail: '' };
      if (res.tsSec != null && w.tsSec == null) patch.tsSec = res.tsSec;
      Object.assign(w, patch, { example: res.sentence });
      await saveWordTranslation(profileId, w.word, { ...patch, _clearExampleJa: true });
      changed = true;
    } else if (res?.reason) {
      // 失敗理由を語に残す（③）。次回の再試行を止める役目も兼ねる＝同じ失敗を無限に叩かない。
      // レート制限だけは一時的な事情なので残さない（次に開いた時に再挑戦させる）。
      if (res.reason === 'rate_limited') break;
      Object.assign(w, { exampleFail: res.reason });
      await saveWordTranslation(profileId, w.word, { exampleFail: res.reason });
      changed = true;
    }
  }
  return changed;
}
