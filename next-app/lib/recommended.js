// おすすめ作品サジェスト（Phase A）。
// services は「代表的な配信先」の静的データ。
// ★将来★ この services フィルタは TMDB の
//   /tv/{id}/watch/providers?region=JP（lib/tmdb.js: fetchAvailableServices 相当）
// に置き換えて、実際の配信状況で絞り込む想定。
// （= ServiceSelect 画面が視聴時に行っている配信確認をサジェスト段階にも前倒しする）
// reason は「なぜ学習に向くか」の1行。自作の文で、効果の言い切りや根拠のない最上級を書かず、作品の事実だけ
//   （TMDB のあらすじや配信サービスの紹介文は写さない・俳優名は出さない・「1話約○分」は TMDB の値が変わったら直す）。
//   2026-11-10 法務確認済みの短い版（オーナー選択）。
export const RECOMMENDED = [
  { title: 'Friends', tmdbId: 1668, level: ['A2', 'B1'], services: ['Netflix', 'U-NEXT'], genre: 'Comedy', reason: 'ニューヨークの友人6人の日常。アメリカ英語の日常会話が中心' },
  { title: 'Modern Family', tmdbId: 1421, level: ['A2', 'B1'], services: ['Netflix', 'Disney+', 'Hulu'], genre: 'Comedy', reason: '3つの家族の日常を描くコメディ。家族の会話が多い' },
  { title: 'Emily in Paris', tmdbId: 82596, level: ['A2', 'B1'], services: ['Netflix'], genre: 'Romance', reason: 'パリで働くアメリカ人が主人公。仕事と恋愛の会話が中心' },
  { title: 'The Good Place', tmdbId: 66573, level: ['B1'], services: ['Netflix'], genre: 'Comedy', reason: '死後の世界が舞台。哲学や倫理の話題も。1話約22分' },
  { title: 'Brooklyn Nine-Nine', tmdbId: 48891, level: ['B1'], services: ['Netflix', 'Amazon Prime'], genre: 'Comedy', reason: '警察署が舞台の職場コメディ。同僚どうしのくだけた会話' },
  { title: 'Never Have I Ever', tmdbId: 100883, level: ['A2', 'B1'], services: ['Netflix'], genre: 'Comedy', reason: '高校生が主人公。学校と家庭の会話、若者の言い方が多い' },
  { title: 'Suits', tmdbId: 37680, level: ['B2', 'C1'], services: ['Netflix', 'Amazon Prime'], genre: 'Legal', reason: '法律事務所が舞台。ビジネスの会話と法律の用語が多い' },
  { title: 'Stranger Things', tmdbId: 66732, level: ['B1', 'B2'], services: ['Netflix'], genre: 'Sci-Fi', reason: '1980年代のアメリカの町が舞台。子どもたちの会話と当時の言い回し' },
  { title: 'The Crown', tmdbId: 65494, level: ['B2', 'C1'], services: ['Netflix'], genre: 'Historical Drama', reason: 'エリザベス2世の時代の歴史ドラマ。改まったイギリス英語' },
  { title: 'Sex Education', tmdbId: 81356, level: ['B1', 'B2'], services: ['Netflix'], genre: 'Comedy', reason: 'イギリスの高校が舞台。生徒どうしの会話が中心' },
  { title: 'The Office', tmdbId: 2316, level: ['B1', 'B2'], services: ['Netflix', 'Amazon Prime'], genre: 'Comedy', reason: '会社の支店が舞台の職場コメディ。皮肉や冗談の多い会話' },
  { title: 'Ted Lasso', tmdbId: 97546, level: ['B2'], services: ['Apple TV+'], genre: 'Comedy', reason: 'イギリスのサッカーチームが舞台。米英両方の英語が出てくる' },
  { title: 'Gossip Girl', tmdbId: 1395, level: ['B1', 'B2'], services: ['Netflix', 'U-NEXT'], genre: 'Romance', reason: 'ニューヨークの高校生が主人公。若者の会話と改まった場面の会話' },
  { title: "Grey's Anatomy", tmdbId: 1416, level: ['B2', 'C1'], services: ['Netflix', 'Disney+', 'Hulu'], genre: 'Medical', reason: 'シアトルの病院が舞台。医療の用語と医師どうしの会話' },
  { title: 'Breaking Bad', tmdbId: 1396, level: ['B2', 'C1'], services: ['Netflix'], genre: 'Crime Thriller', reason: '化学の教師が主人公の犯罪ドラマ。家庭から緊迫した場面まで' },
  { title: 'Sherlock', tmdbId: 19885, level: ['C1'], services: ['Netflix', 'U-NEXT'], genre: 'Crime Thriller', reason: '現代のロンドンが舞台の推理ドラマ。推理の場面は早口。1話約90分' },
  { title: 'House of Cards', tmdbId: 1425, level: ['C1'], services: ['Netflix'], genre: 'Political Drama', reason: 'ワシントンの政界が舞台。政治の用語と改まった言い方' },
  { title: 'Better Call Saul', tmdbId: 60059, level: ['B2', 'C1'], services: ['Netflix'], genre: 'Legal', reason: '弁護士が主人公の犯罪ドラマ。法律の用語と交渉の場面' },
  { title: 'Mad Men', tmdbId: 1104, level: ['C1'], services: ['Amazon Prime', 'Apple TV+'], genre: 'Drama', reason: '1960年代の広告会社が舞台。仕事の会話と大人の改まった言い方' },
  { title: 'The Big Bang Theory', tmdbId: 1418, level: ['B1', 'B2'], services: ['Netflix', 'U-NEXT'], genre: 'Comedy', reason: '科学者の友人たちのコメディ。科学の用語も。1話約22分' },
];

// ユーザーのレベルと契約サービスで絞り込み、最大6件返す。
// サービス未設定（空）なら絞り込まない（設定画面へ飛ばす分岐を外したため・2026-11-01）。
export function getRecommendations(userLevel, userServices) {
  const onService = (d) => !userServices?.length || d.services.some((s) => userServices.includes(s));
  let list = RECOMMENDED
    .filter((d) => d.level.includes(userLevel))
    .filter(onService);
  // 6件未満なら隣接レベルまで緩める
  if (list.length < 6) {
    const adjacent = { A2: ['B1'], B1: ['A2', 'B2'], B2: ['B1', 'C1'], C1: ['B2'] };
    const extra = RECOMMENDED
      .filter((d) => adjacent[userLevel]?.some((lv) => d.level.includes(lv)))
      .filter(onService)
      .filter((d) => !list.includes(d));
    list = [...list, ...extra];
  }
  return list.slice(0, 6);
}

// おすすめ作品 → 既存ドラマ選択フローが扱う selectedDrama 形式へ変換する。
// 既存の AI推薦カード（AddDramaModal）と同じフィールド構成に合わせ、
// VocabScreen 側が drama.title から TMDB でシーズン/英語タイトル/型を再解決できるようにする。
export function recommendedToDrama(item, userLevel) {
  // バッジ・予習レベルは、ユーザーのレベルが候補に含まれればそれを、無ければ先頭を代表値にする
  const level = item.level.includes(userLevel) ? userLevel : item.level[0];
  return {
    title: item.title,
    genre: item.genre,
    level,
    platform: item.services[0], // 代表配信先（ServiceSelect で実際の配信を再確認する）
    reason: item.reason,
    tmdbId: item.tmdbId,
    posterPath: item.posterPath || null, // 取得済みなら埋める（無ければ ServiceSelect/Dashboard が後で補完）
    mediaType: 'tv', // 全作品 TVシリーズ → 映画/ドラマ選択プロンプトを省略
  };
}
