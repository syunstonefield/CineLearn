// 単語生成オーケストレーション（字幕→Claude→パース→フィルター）。
// js/app.js: generateVocabFromEpisode / generateQuiz から移植。
import { callClaude } from './api';
import { exampleContainsWord } from './subtitles';
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
            if (obj.word) results.push(obj);
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
- drama の example は必ず字幕テキストから一字一句そのまま抜き出すこと（要約・言い換え禁止）
- example には必ず "word" に指定した単語（または活用形）が含まれていること
- example が見つからない場合は example を空文字 "" にすること（作文禁止）
- plus の example のみ自由に作文してよいが、必ず "word" を含めること

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
    { "word": "英単語（原形）", "level": "A2|B1|B2|C1|C2", "pos": "品詞（名詞/動詞/形容詞/副詞）", "definition": "日本語の意味（簡潔に）", "example": "字幕からそのままコピーした文（必ずwordの活用形を含む。見つからなければ空文字。ダブルクォートは使わず、シングルクォートに置換すること）", "example_ja": "exampleの自然な日本語訳（exampleが空なら空文字）", "tier": "core"|"advanced"|"context" }
  ],
  "plus": [
    ${plusInstruction}
    { "word": "英単語（原形）", "level": "A2|B1|B2|C1|C2", "pos": "品詞（名詞/動詞/形容詞/副詞）", "definition": "日本語の意味（簡潔に）", "example": "必ずwordを含む自然な英文を作文する（空にしないこと）", "example_ja": "exampleの自然な日本語訳（必須・空にしない）", "tier": "core"|"advanced"|"context" }
  ]
}`;

  // 出力トークン上限。実測：実際の字幕（長い例文を逐語抽出）では 1単語あたり≈110〜120トークン。
  // Haiku 4.5 のモデル上限は 64K だが、api/claude.js は非ストリーミング＝Vercel関数の
  // タイムアウトが実際の制約。現状 8000 は本番で稼働実績あり。スーパーセット(~90語)を
  // 切り捨てずに出すため 12000 まで引き上げる（~100語相当）。万一タイムアウトするなら
  // vercel.json の maxDuration 引き上げか生成2分割で対処。max_tokens は天井なので
  // 大きくしても実出力ぶんしか課金されない。
  const maxTokens = Math.min(12000, (genVocabCount + 25) * 120);
  return { prompt, maxTokens };
}

// Claude の生出力をパースし、字幕と突き合わせて精査する（レベル絞りはしない）。
//  - 例文に単語が含まれなければ example を空に
//  - ★柱1★ refineDramaWords：字幕に実在しない drama 語を除外・空exampleを字幕文で補完・
//    実在する plus を drama へ再分類（Haikuが字幕外語を混ぜるのを決定的に排除）
function parseAndRefineWords(text, subtitleText) {
  const rawJson = text.match(/\{[\s\S]*\}/)?.[0] || '{}';
  const parsed = extractWords(rawJson);
  const dramaWords = (parsed.drama || []).map((w) => ({ ...w, source: 'drama', example_ja_ok: !!w.example_ja }));
  const plusWords = (parsed.plus || []).map((w) => ({ ...w, source: 'plus', example_ja_ok: !!w.example_ja }));
  let json = [...dramaWords, ...plusWords];

  json = json.map((w) => {
    if (!w.example) return w;
    return exampleContainsWord(w.example, w.word) ? w : { ...w, example: '' };
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
// ctx = { drama, season, episode, subtitleText, vocabCount? }
export async function generateSuperset(ctx, onRetry) {
  const { drama, season, episode, subtitleText, vocabCount } = ctx;
  const isMovieGen = drama.type === 'movie';
  const baseCount = vocabCount || 40;
  // 各帯(A2〜C2)を網羅し、上級者の帯(B2〜C1)でも floor(最大50)に届くよう多めに採る。
  // drama ~70 + plus 18〜20 で合計 ~90。cap 12000(≈100語)に収まる。
  const genVocabCount = isMovieGen ? Math.min(150, baseCount * 3) : 70;
  const minTotal = isMovieGen ? Math.min(80, genVocabCount) : 50;

  // superset は levelSpec が A2〜C2 固定のため cur/upper（バンド絞り用）は使わない。
  const { prompt, maxTokens } = buildVocabPrompt({
    drama, season, episode, subtitleText, mode: 'superset', cur: 0, upper: 0, genVocabCount, minTotal,
  });
  const text = await callClaude(prompt, maxTokens, onRetry);
  return parseAndRefineWords(text, subtitleText);
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

// ── クイズ生成（バックグラウンド）──────────────────────────
// testTiers に含まれる単語のみ対象。戻り値: { quizData, rawQuiz }
export async function generateQuiz(drama, words, season, episode, testTiers) {
  const testableWords = words.filter((w) => testTiers.includes(w.tier || 'core'));
  const useWords = testableWords.length > 0 ? testableWords : words;
  const wordList = useWords.map((w) => w.word).join(', ');
  const workLabel =
    drama?.type === 'movie'
      ? `「${drama.title}」（映画）`
      : `「${drama.title}」Season ${season} Episode ${episode}`;
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
    const rawQuiz = JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
    const quizData = rawQuiz.map((q) => ({ ...q, choices: q.choices.sort(() => Math.random() - 0.5) }));
    return { quizData, rawQuiz };
  } catch {
    return { quizData: [], rawQuiz: [] };
  }
}

// ── example_ja のバックグラウンド補完（既存 fillMissingExampleJa）──────────
// example_ja_ok フラグがない単語をAIで翻訳して補完する。
// words の要素を直接更新し、変更があれば true を返す（履歴保存・再描画は呼び出し側）。
export async function fillMissingExampleJa(words) {
  const missing = words.filter((w) => w.example && !w.example_ja_ok);
  if (!missing.length) return false;

  const BATCH = 10; // 一度に送る単語数（トークン制限対策）
  let changed = false;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const inputArr = batch.map((w) => ({ word: w.word, example: w.example, example_ja: '' }));
    const prompt = `以下のJSON配列の各要素について、example（ドラマの字幕の英文）を自然な日本語に翻訳してexample_jaに入れてください。
- example の文全体を翻訳すること（単語の意味説明は不要）
- JSON配列のみ返答（説明不要）

${JSON.stringify(inputArr)}`;

    try {
      const text = await callClaude(prompt, 1500);
      const rawArr = text.match(/\[[\s\S]*\]/)?.[0] || '[]';
      let arr = [];
      try {
        arr = JSON.parse(rawArr);
      } catch {
        arr = JSON.parse(repairJson(rawArr));
      }

      arr.forEach((item) => {
        if (!item?.word || !item?.example_ja?.trim()) return;
        const w = words.find((x) => x.word.toLowerCase() === item.word.toLowerCase());
        if (!w) return;
        w.example_ja = item.example_ja.trim();
        w.example_ja_ok = true;
        changed = true;
      });
    } catch {
      /* バッチ失敗は無視して次へ */
    }
  }
  return changed;
}
