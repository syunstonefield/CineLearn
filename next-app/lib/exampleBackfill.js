// 「追加した単語」の例文を後から埋め直す（②再試行）＋失敗理由を記録する（③可観測性）
// ＋ 📍時刻の無い語の時刻を例文アンカーで引き直す（2026-09-12・A13）。
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
//
// ★2026-09-12: 📍の修復もここへ統合。以前は VocabScreen が端末の生SRT（cl_sub_raw_*）で
//   例文→時刻を引き直していたが、生SRTはクライアントに置かなくなった。例文がある語は
//   `lineText: w.example` を送り、サーバの anchor 照合（findExampleByAnchor）で同じキューの
//   時刻をもらう＝例文と📍がペアである不変則（memory「字幕tsSec二重パスの罠」）をサーバ側の
//   同じ照合器で保つ。この経路では応答の tsSec/tsLabel **だけ**を patch し、example/example_ja
//   には触らない（_clearExampleJa も付けない）。
import { saveWordTranslation } from './words';
import { authHeaders } from './api';

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
  login_required: 'ログインすると例文が付きます',
  no_raw: 'この話の字幕データが未取得です',
};

export function exampleFailLabel(reason) {
  return EXAMPLE_FAIL_LABEL[reason] || '例文を取得できませんでした';
}

// tsSec が「数値として有効か」の判定はここに統一する（null/undefined/NaN/文字列はすべて「無し」）。
export function hasTsSec(w) {
  return Number.isFinite(w?.tsSec);
}

async function fetchExample(payload) {
  try {
    const res = await fetch('/api/example', {
      method: 'POST',
      headers: authHeaders(), // ログイン JWT を添える（A18・層2はログイン必須）
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return { found: false, reason: 'network' };
  }
}

// 2つの例文が「同じ文」か（小文字化・記号除去・空白正規化のうえ、等しいか一方が他方を含む）。
function sameSentence(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[^a-z0-9' ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// 📍修復（例文あり・時刻なし）の同一セッション内の再試行抑止。
//   永続の失敗記録（exampleFail）は「例文が取れなかった理由」としてカードに出る欄なので、
//   例文が付いている語に流用すると誤表示になる。ここはメモリ上の集合で「1セッション1回」に留め、
//   次に開いた時に改めて試す（サーバ側の raw 在庫は日をまたいで増えるため）。
const _tsTried = new Set();

// words: VocabScreen / WordbookScreen が表示している「追加した単語」。
//   対象は「例文が無い語」または「例文はあるが tsSec が数値でない語」（A13）。
// drama: 表示中の作品（title/englishTitle/tmdbId/type）。season/episode は TV のみ意味を持つ。
// 戻り値: 1件でも更新したら true（呼び出し側は再描画する）。
export async function backfillMissingExamples(words, { drama, season, episode, isMovie, profileId }) {
  if (!Array.isArray(words) || !words.length || !drama) return false;
  // 失敗の記録は「毎回叩き直さない」ためのものであって、永久に諦めるためのものではない。
  // ★サーバ側を直しても再試行されない＝直った実感が出ない、という事故を起こしたので時限式にする
  //   （2026-08-08）。記録が古い（or 記録時刻が無い＝修正前の版で付いた）なら再挑戦する。
  const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
  const retryable = (w) => {
    if (!w.exampleFail) return true;
    const at = Date.parse(w.exampleFailAt || '');
    return !Number.isFinite(at) || Date.now() - at > RETRY_AFTER_MS;
  };
  const tsKey = (w) => `${String(w.word).toLowerCase()}|${drama.tmdbId ?? drama.title}|${w.season ?? ''}|${w.episode ?? ''}`;
  // 手動追加（origin 'manual'）は追加時に mode:'manual' で1回探している。anchor も near も無いので
  // ここで叩き直すと no_anchor_no_near（「保存時の再生位置が不明でした」）が永続化されて A4 の説明と矛盾する
  //（レビュー指摘）。例文の取り直しはしない（📍修復＝例文ありの語は対象のまま）。
  const needsExample = (w) => w.origin !== 'manual' && !(w.example || '').trim();
  const needsTs = (w) => !needsExample(w) && !hasTsSec(w) && !_tsTried.has(tsKey(w));
  const targets = words
    .filter((w) => w?.word && ((needsExample(w) && retryable(w)) || needsTs(w)))
    .slice(0, MAX_PER_RUN);
  if (!targets.length) return false;

  let changed = false;
  for (const w of targets) {
    const tsOnly = !needsExample(w);
    const payload = {
      word: w.word,
      // 作品名は英題を優先（OpenSubtitles は英題でしか当たらない）。tmdbId があれば
      // サーバはタイトル検索を行わずこの ID を使う＝邦題の曖昧検索を完全に迂回できる。
      title: drama.englishTitle || drama.title,
      tmdbId: drama.tmdbId ?? undefined,
      // ★S/E は「その語が保存された時の値」を最優先にする（2026-08-08）。
      //   画面側の season/episode は映画でも 1/1 が入っているため、映画と確定できていない作品では
      //   1/1 を送ってしまい、サーバは「S/Eあり＝TV」と解釈する（route.js）。すると層1の
      //   cache_key が :s1e1 になって必ずミスし、層2も TV の字幕を探して空振り＝その作品の語が
      //   全滅する。保存側は映画を必ず season=null で書くので、そちらを信じるのが正しい。
      season: isMovie ? null : w.season ?? (w.episode != null ? season : null),
      episode: isMovie ? null : w.episode ?? (w.season != null ? episode : null),
      // 保存時の📍があれば窓の手がかりとして渡す（サーバは near ±45秒で候補を絞る）
      currentTimeSec: hasTsSec(w) ? w.tsSec : undefined,
    };
    // 例文あり・時刻なし → 例文そのものをアンカーにして同じキューの時刻をもらう（照合のみ・保存されない）。
    if (tsOnly) {
      payload.lineText = w.example;
      _tsTried.add(tsKey(w));
    }
    const res = await fetchExample(payload);
    if (tsOnly) {
      // 応答の tsSec/tsLabel だけを patch。例文・和訳は「表示している例文が正」なので触らない。
      // ★サーバは層1（共有キャッシュの語一致）を先に見るため、同じ語の**別の出現**の例文と時刻が
      //   返ることがある。時刻は例文とペア（不変則）なので、応答文が保存済み例文と同じ文である
      //   時だけ採用する（片方が他方を含めば同一視＝trimExampleToSentence の詰め幅の差を吸収）。
      if (res?.found && Number.isFinite(res.tsSec) && sameSentence(res.sentence, w.example)) {
        const patch = { tsSec: res.tsSec };
        if (res.tsLabel) patch.tsLabel = res.tsLabel;
        Object.assign(w, patch);
        await saveWordTranslation(profileId, w.word, patch);
        changed = true;
      } else if (res?.reason === 'rate_limited') {
        break;
      }
      continue;
    }
    if (res?.found && res.sentence) {
      const patch = { sentence: res.sentence, example_ja: '', exampleFail: '' };
      if (Number.isFinite(res.tsSec) && !hasTsSec(w)) patch.tsSec = res.tsSec;
      Object.assign(w, patch, { example: res.sentence });
      await saveWordTranslation(profileId, w.word, { ...patch, _clearExampleJa: true });
      changed = true;
    } else if (res?.reason) {
      // 失敗理由を語に残す（③）。次回の再試行を止める役目も兼ねる＝同じ失敗を無限に叩かない。
      // レート制限だけは一時的な事情なので残さない（次に開いた時に再挑戦させる）。
      if (res.reason === 'rate_limited') break;
      const at = new Date().toISOString();
      Object.assign(w, { exampleFail: res.reason, exampleFailAt: at });
      await saveWordTranslation(profileId, w.word, { exampleFail: res.reason, exampleFailAt: at });
      changed = true;
    }
  }
  return changed;
}
