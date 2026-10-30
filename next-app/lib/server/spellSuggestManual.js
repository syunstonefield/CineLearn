// 手動追加の綴りミス候補（サーバ側・2026-10-30 オーナー決定＝案B・法務「条件付きOK」）。
//   /api/example mode:'manual' で、入力した語の完全一致が層1（vocab_cache）にも層2（raw）にも無い時だけ呼ぶ。
//   設計と実測: docs/research-2026-10-add-word-spell-suggest.md。近さの判定は lib/spellSuggest.js（純関数）。
//
// ⚠ 法務の条件（2026-10-30）:
//   1. まず vocab_cache の字幕語（drama・AI のおすすめ語 plus は除く）から。そこに無い時だけ字幕全体（raw）の語から。
//   2. 入力は今の手動追加の関門（ログイン・1語・頻出語は不可）を通った語だけ（呼び出し側）。入力4字以上（suggestSpellings）。
//   3. 距離 5字以下=1・6字以上=2・COMMON_WORDS と3字以下は除く・最大3語（suggestSpellings）。
//   4. 例文は最も近い1候補だけ（ほかは語だけ。押したら画面が別の問い合わせで1文を取る）。「別の例文」は作らない。
//      上限は見せた文の数で数え、語だけの候補一覧も1回に数える＝ここで charge()（手動追加の上限）をもう1回。
//      超えたら候補を付けない（今までどおりの no_match）。文は cap（capSentence・200字）を通す。
//   5. 出典は画面が “ ” と 📺作品SxE（字幕：OpenSubtitles）を付ける（映画は話数なし）。
//   6. 選ばれなかった候補の文は保存しない（画面側）。ログは件数だけ（呼び出し側）。
//   7. raw の取り直しは呼び出し側の EXAMPLE_MANUAL_DL_LIMITS の枠の中だけ（ここでは取りに行かない）。
import { COMMON_WORDS } from './commonWords.js';
import { suggestSpellings, wordsFromSubtitle } from '../spellSuggest.js';
import { findExampleForWord } from '../subtitles.js';

const exclude = (w) => COMMON_WORDS.has(w);

// word: 入力した語 / cached: vocab_cache の words（無ければ null） / raw: 生 SRT（無ければ null）
// charge: () => Promise<{ ok }>（手動追加の上限を1つ数える） / cap: (sentence, word, exact) => 200字の1文
// 戻り値: [{ word, sentence, source, tsSec, tsLabel }, { word }, { word }] / 候補なし・上限超えは []
export async function manualSpellSuggestions(word, { cached, raw, charge, cap }) {
  const drama = (cached || []).filter((w) => w && w.source === 'drama' && w.word && w.example);
  let words = suggestSpellings(word, drama.map((w) => ({ word: w.word })), { exclude });
  const fromCache = words.length > 0;
  if (!fromCache && raw) words = suggestSpellings(word, wordsFromSubtitle(raw), { exclude });
  if (!words.length) return [];
  const charged = await charge();
  if (!charged?.ok) return [];
  const top = words[0];
  let ex = null;
  if (fromCache) {
    // 層1が配っているのと同じ例文（その語の vocab_cache の例文）
    const w = drama.find((x) => String(x.word).toLowerCase() === top);
    if (w) ex = { sentence: cap(w.example, top, false), tsSec: w.tsSec ?? null, tsLabel: w.tsLabel ?? null };
  } else {
    // 候補は字幕に出た形そのもの＝その形の完全一致で1文
    const h = findExampleForWord(raw, top, undefined, undefined, { exact: true });
    if (h) ex = { sentence: cap(h.sentence, top, true), tsSec: h.sec, tsLabel: h.label };
  }
  return words.map((w, i) =>
    i === 0 && ex?.sentence ? { word: w, sentence: ex.sentence, source: 'opensubtitles', tsSec: ex.tsSec, tsLabel: ex.tsLabel } : { word: w }
  );
}
