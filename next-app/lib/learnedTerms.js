// 「覚えた」「マスター」の意味（オーナー確定 2026-11-12・外の AI の画面評価を受けた直し A）。
//   ホーム・あゆみ・復習の完了画面で同じ言葉を使う（文はここ1か所だけ・変える時はここを直す）。
//   決まり（lib/storage.js）: 覚えた＝isLearned（日をあけた成功が2回つづいた・repetitions >= 2）。
//   マスター＝isMastered（成功3回以上・次の間隔21日以上・easeFactor 2.0 以上＝「うろ覚え」ばかりでは届かない）。
//   「思い出せた」は「知ってた」「うろ覚え」の両方。同じ日の2回目と「もう一度」は数えない。「知らなかった」で数え直し。
export const LEARNED_LABEL = '覚えた';
export const MASTERED_LABEL = 'マスター';
// 作品の画面の札と線（2026-11-13 オーナー決定）: 学習中＝答えたことがあり、まだ覚えたになっていない語（覚えたとは重ならない）。
//   うち マスター＝覚えたの内側の数。意味の文は画面に出さない（オーナー決定）ので、ここも名前だけ。
export const LEARNING_LABEL = '学習中';
export const MASTERED_OF_LEARNED_LABEL = 'うち マスター';
export const LEARNED_MEANING = '日をあけた復習で、2回つづけて思い出せた語';
export const MASTERED_MEANING = 'すっと思い出せて、次の復習が3週間以上先になった語';
// 「覚えた＝…」の形の1行（画面にそのまま出す用）
export const LEARNED_LINE = `${LEARNED_LABEL}＝${LEARNED_MEANING}`;
export const MASTERED_LINE = `${MASTERED_LABEL}＝${MASTERED_MEANING}`;
