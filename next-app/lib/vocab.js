// 単語生成オーケストレーション（字幕→Claude→パース→フィルター）。
// js/app.js: generateVocabFromEpisode / generateQuiz から移植。
import { callClaude, translateSentences } from './api';
import { exampleContainsWord, trimExampleToSentence } from './subtitles';
import { getExcludeSet } from './wordlist';

// ── TOEIC/CEFR ヘルパー（app.js から移植）──────────────────
export function getToeicLevel(score) {
  if (score < 400) return 'A2';
  if (score < 600) return 'B1';
  if (score < 800) return 'B2';
  return 'C1';
}
export function getVocabCount(score) {
  if (!score || score <= 0) return 30;
  if (score <= 400) return 20;
  if (score <= 600) return 30;
  if (score <= 800) return 40;
  return 50;
}
function toeicToCefr(score) {
  if (!score || score <= 0) return null;
  if (score < 225) return 'A1';
  if (score < 550) return 'A2';
  if (score < 785) return 'B1';
  if (score < 945) return 'B2';
  return 'C1';
}
function cefrTargetBand(cur, tgt) {
  const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const c = toeicToCefr(cur) || 'A2';
  const t = toeicToCefr(tgt) || order[Math.min(order.indexOf(c) + 1, order.length - 1)];
  const lo = order.indexOf(c);
  const hi = Math.max(order.indexOf(t), lo + 1);
  return `${order[lo]}〜${order[Math.min(hi, order.length - 1)]}`;
}

// ── JSON 修復・抽出（app.js の repairJson / extractWords）────
export function repairJson(str) {
  let out = '';
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (!inStr) {
        inStr = true;
        out += ch;
        continue;
      }
      let j = i + 1;
      while (j < str.length && ' \t\r\n'.includes(str[j])) j++;
      const next = str[j];
      if (!next || ':,}]'.includes(next)) {
        inStr = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    if (inStr && (ch === '\n' || ch === '\r')) {
      out += ' ';
      continue;
    }
    if (inStr && ch === '\t') {
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

function extractWords(raw) {
  try {
    const p = JSON.parse(repairJson(raw));
    if (p.drama || p.plus) return p;
  } catch {
    /* fall through */
  }

  const drama = [];
  const plus = [];
  const dramaMatch = raw.match(/"drama"\s*:\s*\[/);
  const plusMatch = raw.match(/"plus"\s*:\s*\[/);
  const dramaStart = dramaMatch ? dramaMatch.index + dramaMatch[0].length : -1;
  const plusStart = plusMatch ? plusMatch.index + plusMatch[0].length : -1;

  function extractObjects(str, from, to) {
    const slice = str.slice(from, to > 0 ? to : undefined);
    const results = [];
    let depth = 0;
    let objStart = -1;
    for (let i = 0; i < slice.length; i++) {
      if (slice[i] === '{') {
        if (depth === 0) objStart = i;
        depth++;
      } else if (slice[i] === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          try {
            const obj = JSON.parse(repairJson(slice.slice(objStart, i + 1)));
            // 短キー(w)も拾う。★ここが `obj.word` だけを見ていたため、応答が max_tokens で
            //   途中切れ → JSON.parse 失敗 → このサルベージ経路に来ても**必ず0語**を返していた。
            //   分割生成の映画では「担当区間が丸ごと消えたのに成功扱い」になる（アイアンマンの
            //   前半57分が消えた実害の直接原因・2026-08-08）。expandShortKeys が後段で両形式を吸収する。
            if (obj.word || obj.w) results.push(obj);
          } catch {
            /* skip */
          }
          objStart = -1;
        }
      }
    }
    return results;
  }

  if (dramaStart >= 0) drama.push(...extractObjects(raw, dramaStart, plusStart));
  if (plusStart >= 0) plus.push(...extractObjects(raw, plusStart));
  return { drama, plus };
}

// ── 単語生成（共有キャッシュ・スーパーセット方式）─────────────────
// 設計（docs/shared-cache-design.md §8.3）:
//   generateSuperset … レベル非依存に CEFR A2〜C2 を広く生成する（シード/共有キャッシュ用）。
//   personalizeWords … 生成済みスーパーセットを学習者レベルで絞る（読み取り時・AI呼び出しなし）。
//   generateVocab    … 従来の都度生成（クライアントfallback）。targeted生成 → personalizeWords。
//                      ※ 既存挙動を維持（targetedプロンプト＋同一フィルタ）。フィルタ順は
//                        除外/帯フィルタが refineDramaWords の後段に移ったが、各述語は source 非依存
//                        （帯フィルタは複数語/context免除）のため最終集合は従来と等価。

// targeted/superset 共通のプロンプト生成。mode で「学習者レベル狙い撃ち」と「A2〜C2を広く」を切替。
function buildVocabPrompt({ drama, season, episode, subtitleText, mode, cur, upper, genVocabCount, minTotal }) {
  const curCefr = toeicToCefr(cur);
  const targetBand = cefrTargetBand(cur, upper);

  const cefrAnchors = `語彙難易度の目安（CEFR）:
- A2: buy, start, happy, problem, important
- B1: decision, available, manage, schedule, suggest
- B2: negotiate, inevitable, comprehensive, deliberately, acknowledge
- C1: tenacity, scrutiny, paramount, ambivalent, meticulous
- C2: ineffable, perfunctory, recalcitrant`;

  const excludeList = `除外（ほぼ全ての学習者が既知のため絶対に選ばない）:
get, go, make, take, come, give, thing, good, bad, very, people, time, day, year,
know, want, like, need, look, see, say, tell, big, small, new, old, man, woman など中学英語レベルの基礎語`;

  const levelSpec =
    mode === 'superset'
      ? `【語彙カバレッジ】学習者レベルに依存せず、CEFR A2〜C2 を幅広く網羅する（読み取り時に学習者レベルで絞り込むため、ここでは絞らない）。
- どのレベルの学習者にも十分な語数が渡るよう各帯をまんべんなく拾う。特に上級者向けに B2・C1 を厚めに（C2 は少数でよい）。A2 を多くしすぎない。
- level は「一般的な使用頻度・学習者にとっての難しさ」で正直に判定する。法務・医療・ビジネス等の専門語や文脈特有の比喩的用法は一般頻度が低く難しいため、安易に B2 以下へ下げず C1（必要なら C2）として正しく評価すること。
- 中学英語レベルの超基礎語は選ばない（下記除外）。
- 句動詞・イディオム・口語の比喩的用法・ジャンル専門語は、表層的な難易度に関わらず学習者がつまずきやすいので積極的に拾う。

${cefrAnchors}
（専門語の目安：litigation / deposition / injunction / liability / subpoena ＝法務、prognosis / malignant / diagnosis ＝医療、leverage / acquisition / liquidity ＝ビジネス などは C1 以上として扱う）

${excludeList}`
      : cur > 0
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

  const tierGuide =
    mode === 'superset'
      ? `各単語に必ず "level"（CEFR: A2/B1/B2/C1/C2 のいずれか）を正しく付ける（後で読み取り時にこの level で絞り込む）。
特定の帯に偏らせず A2〜C2 を広く拾う。句動詞・イディオム・口語の比喩的用法・ジャンル専門語は帯に関わらず含めてよい。
さらに "tier" を付ける：
- "core"    ：このエピソードの理解に必須の頻出語
- "advanced"：一段上の習得目標になる語
- "context" ：このドラマ・映画特有の専門語・固有表現・句動詞・イディオム`
      : `各単語に必ず "level"（CEFR: A2/B1/B2/C1/C2 のいずれか）を付ける。
ねらい目帯（${targetBand}）を中心に選ぶ。ただし句動詞・イディオム・口語の比喩的用法・
ジャンル専門語は、単語の表層的な難易度に関わらず学習者がつまずきやすいので帯外でも含めてよい。
さらに "tier" を付ける：
- "core"    ：このエピソードの理解に必須の頻出語
- "advanced"：目標達成に向けて習得したい一段上の語
- "context" ：このドラマ・映画特有の専門語・固有表現・句動詞・イディオム`;

  // drama / plus の難易度指定。superset はバンドを絞らない。
  const dramaBandLine =
    mode === 'superset'
      ? 'CEFR A2〜C2 を幅広く選ぶ（特定の帯に偏らせず、各帯から拾う）。'
      : `難易度は CEFR ${targetBand} を中心に選ぶ。`;
  const plusInstruction =
    mode === 'superset'
      ? 'plus（字幕外の推奨語）は、字幕に出にくい上位帯を補うため必ず 18〜20 語出す。B2〜C1（一部 C2）の専門語・抽象語・ビジネス/法務/医療語を中心に、上級者の底上げになる語を選ぶ（数合わせではなく上級者に十分な難語を渡すのが目的。各語に正しい level を付ける）。'
      : `この作品のテーマ・文脈に関連する字幕外の推奨単語。dramaの語数と合わせて【合計が最低${minTotal}語】になるように補うこと（dramaが少ない回ほど多めに。最低でも5個は出す・最大20個）。同じ CEFR ${targetBand} を中心に選ぶ。`;

  const workLabel =
    drama.type === 'movie'
      ? `「${drama.title}」（映画）`
      : `「${drama.title}」Season ${season} Episode ${episode}`;

  const prompt = `以下は${workLabel} の実際の英語字幕テキストです。

---字幕テキスト---
${subtitleText}
---ここまで---

上記の字幕テキストを使って、以下のJSON形式のみで返答してください（説明不要）。

${levelSpec}

${tierGuide}

【重要ルール】
- キーは短縮形を使う: w=単語, l=レベル, p=品詞, d=日本語の意味, e=例文, t=tier, c=チャンク
- drama の e（例文）は必ず字幕テキストから一字一句そのまま抜き出すこと（要約・言い換え禁止）
- e には必ず w に指定した単語（または活用形）が含まれていること
- e は「w を含む1文」だけにすること（前後のセリフや別の話者の発言までつなげない・目安200字以内）
- e が見つからない場合は e を空文字 "" にすること（作文禁止）
- plus の e のみ自由に作文してよいが、必ず w を含めること
- 例文の日本語訳は出力しないこと（別処理で行う）
- c（チャンク）= w を含む「他の場面でもそのまま使い回せる定型連語」2〜4語。品詞で基準を変える:
  【動詞】決まった前置詞・パーティクル・目的語型を取るなら必ず c を出す（owe → 'owe you',
  aim → 'aim for', encode → 'encode in', rely → 'rely on', accuse → 'accuse A of'）。
  句動詞はそれ自体が c（pull it off, get away with）。動詞で c が空なのは
  単独他動詞で型が無い場合だけにすること。
  【形容詞】定型の前置詞パターンがあれば出す（familiar with, guilty of, capable of）。
  【名詞】一般常識レベルの定型の動詞コロケーションがある場合のみ（lawsuit → 'file a lawsuit',
  objection → 'raise an objection'）。無ければ空文字。名詞は迷ったら空
  （誤った定型を教えるより単語単体の方が良い）。
  【禁止（全品詞）】場面限定の修飾語＋名詞の組（'tracking beacon', 'last shipment' のような
  一時的な組み合わせ）・固有名詞や作品固有語を含むもの（'Mandalorian creed' は絶対に禁止）

{
  "drama": [
    この字幕に実際に登場する単語を【最大${genVocabCount}個】。必ず字幕内に存在する単語のみ。
    数が足りなければ少なくてよく、数合わせのために字幕に無い単語をここ(drama)へ絶対に入れないこと（字幕に出てこない語をdramaに入れるのは禁止）。
    ${dramaBandLine}内容語（名詞・動詞・形容詞・句動詞・イディオム）を優先する。
    【固有名詞・作品固有の造語は絶対に選ばない（最重要ルール）】次は TOEIC・日常会話・ビジネスで
    使えず学習価値が無いため、たとえ字幕に頻出しても選ばないこと：
    (1) 固有名詞＝人名・地名・組織名・商品名（実在・架空を問わない）。
    (2) その作品の架空世界でしか通じない造語・固有概念＝架空の生物・種族・技術・道具・組織・
        場所・呪文・勢力などの名前（SF/ファンタジー等の専門用語・造語。例: Star Wars や
        Stranger Things に出てくる作品世界だけの語）。
    → 現実世界で実際に通用する汎用的な英単語だけを選ぶこと。
    特に次を積極的に拾うこと（字面の難易度が低くても学習者が調べたくなる）：
    句動詞・イディオム（例 pull off, get away with）、口語・スラング・比喩的な特殊用法（例 'shark'＝敏腕弁護士 のように、単語自体は平易でも文脈での意味を知らないと誤解する語を最優先）、現実に存在する分野の専門用語（法律・医療・ビジネス等。※架空世界の専門用語・造語は含めない）。
    重要：字幕の冒頭だけに偏らず、最初から最後まで全体を通して均等に選ぶこと。特に映画など長い字幕では、中盤・終盤に登場する単語も必ず含めること。
    { "w": "英単語（原形）", "l": "A2|B1|B2|C1|C2", "p": "品詞（名詞/動詞/形容詞/副詞）", "d": "日本語の意味（簡潔に）", "e": "字幕からそのままコピーした文（必ずwの活用形を含む。見つからなければ空文字。ダブルクォートは使わず、シングルクォートに置換すること）", "t": "core"|"advanced"|"context", "c": "wを含む2〜4語のチャンク（無ければ空文字）" }
  ],
  "plus": [
    ${plusInstruction}
    { "w": "英単語（原形）", "l": "A2|B1|B2|C1|C2", "p": "品詞（名詞/動詞/形容詞/副詞）", "d": "日本語の意味（簡潔に）", "e": "必ずwを含む自然な英文を作文する（空にしないこと）", "t": "core"|"advanced"|"context", "c": "wを含む2〜4語のチャンク（無ければ空文字）" }
  ]
}`;

  // 出力トークン上限。短キー化＋example_ja分離（docs/design-context-translation.md §7）後の
  // 見積り: 1単語あたり≈70〜80トークン（旧形式は≈110〜120）＋チャンク欄 c で≈8〜11。
  // 安全側に100で計算（#19チャンク欄追加・2026-07-16）。
  // Haiku 4.5 のモデル上限は 64K だが、api/claude.js は非ストリーミング＝Vercel関数の
  // タイムアウトが実際の制約。max_tokens は天井なので大きくしても実出力ぶんしか課金されない。
  // ★係数を100→140へ（2026-08-08）。実測でチャンク1の出力が 7,166 / 上限 8,500＝84%消費と
  //   余裕が16%しかなく、例文が長い回は天井に当たって応答が途中で切れていた。切れると JSON が
  //   壊れてそのチャンクが0語になり、映画の担当区間が丸ごと消える。max_tokens は天井なので
  //   上げても実出力ぶんしか課金されない（サーバ側の天井は 13,000）。
  const maxTokens = Math.min(13000, (genVocabCount + 25) * 140);
  return { prompt, maxTokens };
}

// Claude の生出力をパースし、字幕と突き合わせて精査する（レベル絞りはしない）。
//  - 例文に単語が含まれなければ example を空に
//  - ★柱1★ refineDramaWords：字幕に実在しない drama 語を除外・空exampleを字幕文で補完・
//    実在する plus を drama へ再分類（Haikuが字幕外語を混ぜるのを決定的に排除）
// 生成JSONの短キー（w/l/p/d/e/t＝出力トークン圧縮・§7）を従来のフィールド名へ復元する。
// 旧形式（word等・過去キャッシュや旧プロンプトの出力）はそのまま通す＝後方互換。
// example_ja は生成から分離済み＝常に空で初期化し、既存の fillMissingExampleJa が
// 表示中のリスト分だけ後埋めする（スーパーセット全語を前払い翻訳しない）。
function expandShortKeys(w) {
  if (!w || typeof w !== 'object') return null;
  if (w.word != null) return w; // 旧形式
  if (w.w == null) return null; // 単語なしは捨てる
  return {
    word: w.w,
    level: w.l || '',
    pos: w.p || '',
    definition: w.d || '',
    example: w.e || '',
    example_ja: '',
    tier: w.t || 'core',
    // #19: チャンク（wを含む連語・コロケーション）。additive＝旧キャッシュには無い（表示側で
    // 単語のみへフォールバック）。VOCAB_CACHE_VERSION は上げない（既存カタログ再生成コスト回避）。
    chunk: w.c || '',
  };
}

function parseAndRefineWords(text, subtitleText) {
  const rawJson = text.match(/\{[\s\S]*\}/)?.[0] || '{}';
  const parsed = extractWords(rawJson);
  const dramaWords = (parsed.drama || [])
    .map(expandShortKeys)
    .filter(Boolean)
    .map((w) => ({ ...w, source: 'drama', example_ja_ok: !!w.example_ja }));
  const plusWords = (parsed.plus || [])
    .map(expandShortKeys)
    .filter(Boolean)
    .map((w) => ({ ...w, source: 'plus', example_ja_ok: !!w.example_ja }));
  let json = [...dramaWords, ...plusWords];

  // 0語＝Claude応答の拒否/形式崩れの可能性。沈黙させず一次切り分け材料をconsoleに残す
  // （実機のconsoleで原因を確定できるように・debug-with-real-data）。
  if (!json.length) {
    console.warn('[CL:GEN] 生成0語: 応答先頭200字 =', String(text).slice(0, 200));
  }

  json = json.map((w) => {
    if (!w.example) return w;
    if (!exampleContainsWord(w.example, w.word)) return { ...w, example: '' };
    // 「字幕から一字一句抜き出す」指示の副作用で、複数キューがつながった段落（数百字）が
    // 返ることがある。カードとして読める1文へ詰める（2026-08-07・実データ391字）。
    return { ...w, example: trimExampleToSentence(w.example, w.word) };
  });

  return refineDramaWords(json, subtitleText);
}

// 生成済みスーパーセットを学習者レベルで絞る（読み取り時・AI呼び出しなし）。
//  - 既知語の除外（getExcludeSet, スコア依存）
//  - CEFRバンド外フィルタ（複数語/context tier は免除）
//  - 字幕内(drama)で minTotal に達していれば余剰 plus を落とす
export function personalizeWords(words, { toeicScore = 0, targetToeicScore = 0, vocabCount = 30 } = {}) {
  const cur = toeicScore > 0 ? toeicScore : 0;
  const upper = targetToeicScore > 0 ? targetToeicScore : cur + 200;
  const targetBand = cefrTargetBand(cur, upper);
  const minTotal = Math.min(50, Math.max(30, vocabCount));

  let json = Array.isArray(words) ? words.slice() : [];

  // 除外語フィルター
  if (toeicScore > 0) {
    const excluded = getExcludeSet(toeicScore);
    json = json.filter((w) => !excluded.has(w.word.toLowerCase()));
  }

  // CEFRバンド外フィルター
  if (cur > 0) {
    const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const band = targetBand.split('〜');
    const loIdx = Math.max(0, order.indexOf(band[0]) - 1);
    const hiIdx = order.indexOf(band[band.length - 1]);
    if (hiIdx >= 0) {
      json = json.filter((w) => {
        // 句動詞・イディオム（複数語）と context（ジャンル専門語）は帯フィルター免除。
        // 単語頻度では測れず、学習者が最も調べる対象なので残す（再現率＝予習の的中率重視）。
        if (/\s/.test(w.word) || w.tier === 'context') return true;
        const li = order.indexOf(String(w.level || '').toUpperCase());
        return li === -1 ? true : li >= loIdx && li <= hiIdx;
      });
    }
  }

  // 字幕内(drama)だけで最低総数 minTotal に達していれば字幕外(plus)は足さない。
  // 足りない場合のみ不足分だけ plus を残す（drama が minTotal を超えるのは許容）。
  const dramaCount = json.filter((w) => w.source === 'drama').length;
  const needPlus = Math.max(0, minTotal - dramaCount);
  let keptPlus = 0;
  json = json.filter((w) => {
    if (w.source !== 'plus') return true;
    if (keptPlus < needPlus) {
      keptPlus++;
      return true;
    }
    return false; // 余剰 plus を除外
  });

  return json;
}

// レベル非依存に CEFR A2〜C2 を広く生成（シード/共有キャッシュ用）。
// personalizeWords で読み取り時に学習者レベルへ絞る前提なので、ここでは
// 除外/帯/plus間引きをしない（各語に level/tier タグだけ付けて広く保存する）。
// ctx = { drama, season, episode, subtitleText, vocabCount?, onProgress? }
async function generateSupersetOnce(ctx, onRetry) {
  const { drama, season, episode, subtitleText, vocabCount, quotaDiv = 1 } = ctx;
  const isMovieGen = drama.type === 'movie';
  const baseCount = vocabCount || 40;
  // 各帯(A2〜C2)を網羅し、上級者の帯(B2〜C1)でも floor(最大50)に届くよう多めに採る。
  // drama ~70 + plus 18〜20 で合計 ~90。cap 12000(≈100語)に収まる。
  // quotaDiv=分割生成時の按分（結合後の総語数が従来と同水準になるように）。
  const fullCount = isMovieGen ? Math.min(150, baseCount * 3) : 70;
  const fullMin = isMovieGen ? Math.min(80, fullCount) : 50;
  const genVocabCount = Math.max(20, Math.ceil(fullCount / quotaDiv));
  const minTotal = Math.max(12, Math.ceil(fullMin / quotaDiv));

  // superset は levelSpec が A2〜C2 固定のため cur/upper（バンド絞り用）は使わない。
  const { prompt, maxTokens } = buildVocabPrompt({
    drama, season, episode, subtitleText, mode: 'superset', cur: 0, upper: 0, genVocabCount, minTotal,
  });
  const text = await callClaude(prompt, maxTokens, onRetry);
  return parseAndRefineWords(text, subtitleText);
}

// 長編（映画等）は字幕を等分チャンクに割り、語数を按分して生成→結合する。
// 2026-08-05 実測（スパイダーマン:ホームカミング）: 2時間分の字幕全文を一括で渡すと
// 選定が前半に偏る（0-60分に63語・60-133分に2語の崖）。切り詰めはどこにも無く、
// 長い入力でモデルが前半から選ぶ癖が原因＝入力側を割って全編から選ばせるのが対策。
// TV1話（字幕≦25k字程度）は1チャンク＝従来と完全に同じ挙動・コスト。
const CHUNK_CHARS = 45000;

export async function generateSuperset(ctx, onRetry) {
  const subText = ctx.subtitleText || '';
  const nChunks = Math.min(3, Math.max(1, Math.ceil(subText.length / CHUNK_CHARS)));
  if (nChunks === 1) return generateSupersetOnce(ctx, onRetry);

  const size = Math.ceil(subText.length / nChunks);
  const merged = [];
  const seen = new Map(); // 小文字の語 → merged 内の添字
  for (let i = 0; i < nChunks; i++) {
    ctx.onProgress?.(i + 1, nChunks);
    // チャンク境界の文切れは許容（refineDramaWords の逐語チェックは各チャンク文に対して働く）。
    // 直列実行＝APIレート制限内に収める（映画1本=2〜3コール・初回のみ・以後は共有キャッシュ）。
    const chunkText = subText.slice(i * size, (i + 1) * size);
    let part = await generateSupersetOnce({ ...ctx, subtitleText: chunkText, quotaDiv: nChunks }, onRetry);
    // ★0語チャンクを黙って捨てない（2026-08-08）。捨てていたため「映画の前半57分が丸ごと
    //   欠けたリスト」が成功扱いで完成し、共有キャッシュに焼き付いて全ユーザーに配られていた
    //   （アイアンマン）。1回だけ引き直し、それでも0なら生成全体を失敗させて再生成導線に戻す。
    if (!part.length) {
      console.warn(`[CL:GEN] chunk ${i + 1}/${nChunks} が0語。1回だけ再試行します`);
      part = await generateSupersetOnce({ ...ctx, subtitleText: chunkText, quotaDiv: nChunks }, onRetry);
    }
    console.info(
      `[CL:GEN] chunk ${i + 1}/${nChunks} chars ${i * size}-${Math.min((i + 1) * size, subText.length)} → ${part.length}語` +
        `（drama ${part.filter((w) => w.source === 'drama').length}）`
    );
    if (!part.length) {
      throw new Error(`単語の生成に失敗しました（${nChunks}分割中${i + 1}番目が0語）。もう一度お試しください`);
    }
    for (const w of part) {
      const k = String(w.word || '').toLowerCase();
      if (!k) continue;
      const prev = seen.get(k);
      if (prev == null) {
        seen.set(k, merged.length);
        merged.push(w);
      } else if (merged[prev].source === 'plus' && w.source === 'drama') {
        // 前のチャンクで plus（AI作例）だった語が後のチャンクの字幕に実在＝drama（逐語例文＋📍）を採る。
        // 旧実装は先着優先で、字幕に実在する語が作例つきの plus のまま固定されていた。
        merged[prev] = w;
      }
    }
  }
  // 各チャンクの精査は「そのチャンクの本文」に対してだけ行われる。plus と判定された語が
  // 別区間の字幕に実在することがあるため、結合後に全編本文でもう一度 drama/plus を確定する
  // （実在すれば drama に再分類し例文を字幕の逐語文へ）。AI 呼び出しは無い＝コスト0。
  return refineDramaWords(merged, subText);
}

// 従来の都度生成（クライアントfallback）。targeted生成 → 学習者レベルで絞る。
export async function generateVocab(ctx, onRetry) {
  const { drama, season, episode, subtitleText, toeicScore, targetToeicScore, vocabCount } = ctx;
  const cur = toeicScore > 0 ? toeicScore : 0;
  const upper = targetToeicScore > 0 ? targetToeicScore : cur + 200;

  const isMovieGen = drama.type === 'movie';
  const genVocabCount = isMovieGen ? Math.min(150, vocabCount * 3) : vocabCount;
  const minTotal = Math.min(50, Math.max(30, vocabCount));

  const { prompt, maxTokens } = buildVocabPrompt({
    drama, season, episode, subtitleText, mode: 'targeted', cur, upper, genVocabCount, minTotal,
  });
  const text = await callClaude(prompt, maxTokens, onRetry);
  const refined = parseAndRefineWords(text, subtitleText);
  return personalizeWords(refined, { toeicScore, targetToeicScore, vocabCount });
}

// drama/plus を字幕本文で検証・再分類する：
//  - drama なのに字幕に実在しない語 → 除外（水増し排除）
//  - plus なのに字幕に実在する語     → drama に再分類し、例文を字幕の逐語文へ
//  - drama で example が空/不正       → 字幕文で補完
// 「字幕内＝drama＝逐語例文＋📍」「字幕外＝plus＝AI作例」を実態に一致させる。
function refineDramaWords(words, subtitleText) {
  if (!subtitleText) return words;
  // 例文候補：文末(.!?)か台詞区切りで分割した短〜中尺の文。
  const sentences = subtitleText
    .split(/(?<=[.!?])\s+|(?:\s+-\s+)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 200);
  const setSubExample = (w) => {
    const hit = sentences.find((s) => exampleContainsWord(s, w.word));
    if (hit) {
      w.example = hit;
      w.example_ja = ''; // 未訳 → fillMissingExampleJa が後で翻訳補完
      w.example_ja_ok = false;
    }
    return !!hit;
  };
  const out = [];
  for (const w of words) {
    const inSub = exampleContainsWord(subtitleText, w.word);
    if (w.source === 'drama' && !inSub) continue; // 字幕に無い drama 語＝水増し → 除外
    if (w.source === 'plus' && inSub) {
      // plus だが実際は字幕に存在 → drama に直して例文を字幕の逐語文に差し替える
      w.source = 'drama';
      setSubExample(w); // 見つからなければ既存（作例）を残す
    } else if (w.source === 'drama') {
      // 既存 drama 語：example が空/単語不含なら字幕文で補完
      if (!w.example || !w.example.trim() || !exampleContainsWord(w.example, w.word)) {
        if (!setSubExample(w)) {
          w.example = '';
          w.example_ja = '';
          w.example_ja_ok = false;
        }
      }
    }
    out.push(w);
  }
  return out;
}

// クイズ生成は 2026-08-07 にローカル作問（lib/prep.js の buildLocalQuiz）へ移行した。
// 穴埋め文・選択肢は単語リストの実セリフ例文から組めるため、Claude 呼び出し
// （1回≈¥1・レート制限あり・生成待ちあり）は不要になった。旧 generateQuiz は削除。

// ── example_ja のバックグラウンド補完（fillMissingExampleJa）──────────
// 例文和訳が未確定（example_ja_ok が無い）語を埋める。words の要素を直接更新し、
// 表示中の語に変更があれば true を返す（履歴保存・再描画は呼び出し側）。
//
// 2026-09-11 に経路を /api/claude mode:'sentences' へ切替。旧実装はクライアント組みの
// プロンプトを既定モードへ投げていたため、共有キャッシュに乗らず・生成用のレート枠を食い・
// 結果は本人の履歴にしか残らなかった（同じ話を開く各ユーザーが毎回 ¥6〜9 払う）。
// 新経路は文ごとに共有キャッシュを引き、未命中だけをサーバが訳し、ctx に {tmdbId,season,
// episode,type} があれば共有キャッシュ行（vocab_cache）の空欄も埋める＝2人目以降は AI 呼び出し 0。
//   ctx.rowWords: 表示語に加えて「行の全語」を渡すと、最初の1人で行が完成する（任意）。
export async function fillMissingExampleJa(words, ctx = {}) {
  const display = (words || []).filter((w) => w && w.example && !w.example_ja_ok);
  // 既に訳がある語は確定扱い（履歴の旧データ等）＝要求しない
  let changed = false;
  for (const w of display) {
    if (w.example_ja) {
      w.example_ja_ok = true;
      changed = true;
    }
  }
  const need = display.filter((w) => !w.example_ja);
  const row = (ctx.rowWords || []).filter((w) => w && w.example && !w.example_ja);
  if (!need.length && !row.length) return changed;

  const keyOf = (s) => String(s || '').trim().slice(0, 300); // サーバのハッシュ入力と同じ正規化
  // 文 → その文を持つ語（表示語を先に・行の語は後ろに。同じ文の語はまとめて埋まる）
  const bySentence = new Map();
  for (const w of [...need, ...row]) {
    const k = keyOf(w.example);
    if (!k) continue;
    if (!bySentence.has(k)) bySentence.set(k, []);
    bySentence.get(k).push(w);
  }
  const sentences = [...bySentence.keys()];
  const BATCH = 10;
  for (let i = 0; i < sentences.length; i += BATCH) {
    const batch = sentences.slice(i, i + BATCH);
    const res = await translateSentences({
      sentences: batch,
      tmdbId: ctx.tmdbId,
      season: ctx.season,
      episode: ctx.episode,
      type: ctx.type,
    });
    batch.forEach((s, j) => {
      const ja = res.ja?.[j];
      if (!ja) return; // null＝形式崩れ/未訳 → example_ja_ok を立てず次回に再試行
      for (const w of bySentence.get(s)) {
        if (w.example_ja) continue;
        w.example_ja = ja;
        w.example_ja_ok = true;
        if (need.includes(w)) changed = true;
      }
    });
    if (res.rateLimited || res.unsupported) break; // 静かに打ち切る（残りは次回・別ユーザー・backfill が埋める）
  }
  return changed;
}
