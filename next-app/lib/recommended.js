// おすすめ作品サジェスト（Phase A）。
// services は「代表的な配信先」の静的データ。
// ★将来★ この services フィルタは TMDB の
//   /tv/{id}/watch/providers?region=JP（lib/tmdb.js: fetchAvailableServices 相当）
// に置き換えて、実際の配信状況で絞り込む想定。
// （= ServiceSelect 画面が視聴時に行っている配信確認をサジェスト段階にも前倒しする）
export const RECOMMENDED = [
  { title: 'Friends', tmdbId: 1668, level: ['A2', 'B1'], services: ['Netflix', 'U-NEXT'], genre: 'Comedy', reason: '明瞭な発音と日常会話の宝庫。英語学習の定番中の定番' },
  { title: 'Modern Family', tmdbId: 1421, level: ['A2', 'B1'], services: ['Netflix', 'Disney+', 'Hulu'], genre: 'Comedy', reason: '家族の日常会話が中心。1話22分で続けやすい' },
  { title: 'Emily in Paris', tmdbId: 82596, level: ['A2', 'B1'], services: ['Netflix'], genre: 'Romance', reason: 'ゆっくりした発音で聞き取りやすい。短めの会話が中心' },
  { title: 'The Good Place', tmdbId: 66573, level: ['B1'], services: ['Netflix'], genre: 'Comedy', reason: 'クリアな発音と倫理がテーマ。知的な語彙も自然に学べる' },
  { title: 'Brooklyn Nine-Nine', tmdbId: 48891, level: ['B1'], services: ['Netflix', 'Amazon Prime'], genre: 'Comedy', reason: 'テンポの良い職場コメディ。口語表現が豊富' },
  { title: 'Never Have I Ever', tmdbId: 100883, level: ['A2', 'B1'], services: ['Netflix'], genre: 'Comedy', reason: '高校生の日常で現代的なスラングと日常会話が学べる' },
  { title: 'Suits', tmdbId: 37680, level: ['B2', 'C1'], services: ['Netflix', 'Amazon Prime'], genre: 'Legal', reason: 'ビジネス英語と法廷用語が自然に身につく。会話のテンポが速い' },
  { title: 'Stranger Things', tmdbId: 66732, level: ['B1', 'B2'], services: ['Netflix'], genre: 'Sci-Fi', reason: '80年代設定の口語表現。人気作で続きが気になり継続しやすい' },
  { title: 'The Crown', tmdbId: 65494, level: ['B2', 'C1'], services: ['Netflix'], genre: 'Historical Drama', reason: '格調高いイギリス英語。フォーマルな表現の宝庫' },
  { title: 'Sex Education', tmdbId: 81356, level: ['B1', 'B2'], services: ['Netflix'], genre: 'Comedy', reason: 'イギリス英語の日常会話。多様な話し方に触れられる' },
  { title: 'The Office', tmdbId: 2316, level: ['B1', 'B2'], services: ['Netflix', 'Amazon Prime'], genre: 'Comedy', reason: 'オフィス英語と皮肉・ジョーク。アメリカ英語の定番教材' },
  { title: 'Ted Lasso', tmdbId: 97546, level: ['B2'], services: ['Apple TV+'], genre: 'Comedy', reason: '米英両方の英語が登場。前向きな表現と慣用句が豊富' },
  { title: 'Gossip Girl', tmdbId: 1395, level: ['B1', 'B2'], services: ['Netflix', 'U-NEXT'], genre: 'Romance', reason: '若者言葉と洗練された会話。長く続けられるエピソード数' },
  { title: "Grey's Anatomy", tmdbId: 1416, level: ['B2', 'C1'], services: ['Netflix', 'Disney+', 'Hulu'], genre: 'Medical', reason: '医療英語と感情表現。エピソード数が多く継続学習に最適' },
  { title: 'Breaking Bad', tmdbId: 1396, level: ['B2', 'C1'], services: ['Netflix'], genre: 'Crime Thriller', reason: '緊張感ある会話と多彩な語彙。世界的高評価で没入感が高い' },
  { title: 'Sherlock', tmdbId: 19885, level: ['C1'], services: ['Netflix', 'U-NEXT'], genre: 'Crime Thriller', reason: '高速で高度なイギリス英語。上級者の聞き取り訓練に最適' },
  { title: 'House of Cards', tmdbId: 1425, level: ['C1'], services: ['Netflix'], genre: 'Political Drama', reason: '政治・知的な語彙が満載。フォーマルで洗練された英語' },
  { title: 'Better Call Saul', tmdbId: 60059, level: ['B2', 'C1'], services: ['Netflix'], genre: 'Legal', reason: '法律英語と巧みな会話術。ブレイキング・バッドのスピンオフ' },
  { title: 'Mad Men', tmdbId: 1104, level: ['C1'], services: ['Amazon Prime', 'Apple TV+'], genre: 'Drama', reason: '60年代の広告業界。ビジネスと洗練された大人の英語' },
  { title: 'The Big Bang Theory', tmdbId: 1418, level: ['B1', 'B2'], services: ['Netflix', 'U-NEXT'], genre: 'Comedy', reason: '科学用語とテンポの良い会話。1話20分で取り組みやすい' },
];

// ユーザーのレベルと契約サービスで絞り込み、最大6件返す。
export function getRecommendations(userLevel, userServices) {
  let list = RECOMMENDED
    .filter((d) => d.level.includes(userLevel))
    .filter((d) => d.services.some((s) => userServices.includes(s)));
  // 6件未満なら隣接レベルまで緩める
  if (list.length < 6) {
    const adjacent = { A2: ['B1'], B1: ['A2', 'B2'], B2: ['B1', 'C1'], C1: ['B2'] };
    const extra = RECOMMENDED
      .filter((d) => adjacent[userLevel]?.some((lv) => d.level.includes(lv)))
      .filter((d) => d.services.some((s) => userServices.includes(s)))
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
