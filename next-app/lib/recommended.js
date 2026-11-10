// CineLearn が選んだ作品（検索画面「英語学習に向いている作品」・ホームのおすすめ列）。
// ・ja は TMDB の日本語の作品名（検索の照合と一覧の補足に使う・2026-11-10 に TMDB で確認）。
// ・services は「代表的な配信先」の手書きの静的データ。★画面に「配信」として出さない（法務 2026-11-10）。
//   内部の絞り込み（ホームのおすすめ列を契約サービスで絞る getRecommendations）にだけ使う。
//   実際の配信先は TMDB の /watch/providers（lib/tmdb.js: fetchAvailableServices）で見る。
// ・reason は「なぜ学習に向くか」の1行。自作の文で、効果の言い切りや根拠のない最上級を書かず、作品の事実だけ
//   （TMDB のあらすじや配信サービスの紹介文は写さない・俳優名は出さない・「1話約○分」は TMDB の値が変わったら直す）。
//   2026-11-10 法務確認済みの短い版（オーナー選択）。
export const RECOMMENDED = [
  { title: 'Friends', tmdbId: 1668, ja: 'フレンズ', level: ['A2', 'B1'], services: ['Netflix', 'U-NEXT'], genre: 'Comedy', reason: 'ニューヨークの友人6人の日常。アメリカ英語の日常会話が中心' },
  { title: 'Modern Family', tmdbId: 1421, ja: 'モダン･ファミリー', level: ['A2', 'B1'], services: ['Netflix', 'Disney+', 'Hulu'], genre: 'Comedy', reason: '3つの家族の日常を描くコメディ。家族の会話が多い' },
  { title: 'Emily in Paris', tmdbId: 82596, ja: 'エミリー、パリへ行く', level: ['A2', 'B1'], services: ['Netflix'], genre: 'Romance', reason: 'パリで働くアメリカ人が主人公。仕事と恋愛の会話が中心' },
  { title: 'The Good Place', tmdbId: 66573, ja: 'グッド・プレイス', level: ['B1'], services: ['Netflix'], genre: 'Comedy', reason: '死後の世界が舞台。哲学や倫理の話題も。1話約22分' },
  { title: 'Brooklyn Nine-Nine', tmdbId: 48891, ja: 'ブルックリン・ナイン-ナイン', level: ['B1'], services: ['Netflix', 'Amazon Prime'], genre: 'Comedy', reason: '警察署が舞台の職場コメディ。同僚どうしのくだけた会話' },
  { title: 'Never Have I Ever', tmdbId: 100883, ja: '私の"初めて"日記', level: ['A2', 'B1'], services: ['Netflix'], genre: 'Comedy', reason: '高校生が主人公。学校と家庭の会話、若者の言い方が多い' },
  { title: 'Suits', tmdbId: 37680, ja: 'SUITS/スーツ', level: ['B2', 'C1'], services: ['Netflix', 'Amazon Prime'], genre: 'Legal', reason: '法律事務所が舞台。ビジネスの会話と法律の用語が多い' },
  { title: 'Stranger Things', tmdbId: 66732, ja: 'ストレンジャー・シングス 未知の世界', level: ['B1', 'B2'], services: ['Netflix'], genre: 'Sci-Fi', reason: '1980年代のアメリカの町が舞台。子どもたちの会話と当時の言い回し' },
  { title: 'The Crown', tmdbId: 65494, ja: 'ザ・クラウン', level: ['B2', 'C1'], services: ['Netflix'], genre: 'Historical Drama', reason: 'エリザベス2世の時代の歴史ドラマ。改まったイギリス英語' },
  { title: 'Sex Education', tmdbId: 81356, ja: 'セックス・エデュケーション', level: ['B1', 'B2'], services: ['Netflix'], genre: 'Comedy', reason: 'イギリスの高校が舞台。生徒どうしの会話が中心' },
  { title: 'The Office', tmdbId: 2316, ja: 'ジ・オフィス', level: ['B1', 'B2'], services: ['Netflix', 'Amazon Prime'], genre: 'Comedy', reason: '会社の支店が舞台の職場コメディ。皮肉や冗談の多い会話' },
  { title: 'Ted Lasso', tmdbId: 97546, ja: 'テッド・ラッソ：破天荒コーチがゆく', level: ['B2'], services: ['Apple TV+'], genre: 'Comedy', reason: 'イギリスのサッカーチームが舞台。米英両方の英語が出てくる' },
  { title: 'Gossip Girl', tmdbId: 1395, ja: 'ゴシップガール', level: ['B1', 'B2'], services: ['Netflix', 'U-NEXT'], genre: 'Romance', reason: 'ニューヨークの高校生が主人公。若者の会話と改まった場面の会話' },
  { title: "Grey's Anatomy", tmdbId: 1416, ja: 'グレイズ・アナトミー', level: ['B2', 'C1'], services: ['Netflix', 'Disney+', 'Hulu'], genre: 'Medical', reason: 'シアトルの病院が舞台。医療の用語と医師どうしの会話' },
  { title: 'Breaking Bad', tmdbId: 1396, ja: 'ブレイキング・バッド', level: ['B2', 'C1'], services: ['Netflix'], genre: 'Crime Thriller', reason: '化学の教師が主人公の犯罪ドラマ。家庭から緊迫した場面まで' },
  { title: 'Sherlock', tmdbId: 19885, ja: 'SHERLOCK／シャーロック', level: ['C1'], services: ['Netflix', 'U-NEXT'], genre: 'Crime Thriller', reason: '現代のロンドンが舞台の推理ドラマ。推理の場面は早口。1話約90分' },
  { title: 'House of Cards', tmdbId: 1425, ja: 'ハウス・オブ・カード 野望の階段', level: ['C1'], services: ['Netflix'], genre: 'Political Drama', reason: 'ワシントンの政界が舞台。政治の用語と改まった言い方' },
  { title: 'Better Call Saul', tmdbId: 60059, ja: 'ベター・コール・ソウル', level: ['B2', 'C1'], services: ['Netflix'], genre: 'Legal', reason: '弁護士が主人公の犯罪ドラマ。法律の用語と交渉の場面' },
  { title: 'Mad Men', tmdbId: 1104, ja: 'マッドメン', level: ['C1'], services: ['Amazon Prime', 'Apple TV+'], genre: 'Drama', reason: '1960年代の広告会社が舞台。仕事の会話と大人の改まった言い方' },
  { title: 'The Big Bang Theory', tmdbId: 1418, ja: 'ビッグバン★セオリー ギークなボクらの恋愛法則', level: ['B1', 'B2'], services: ['Netflix', 'U-NEXT'], genre: 'Comedy', reason: '科学者の友人たちのコメディ。科学の用語も。1話約22分' },
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

// ── 検索画面（components/SearchScreen.js）で使う ──

// ジャンルの札。作品が0件の札は出さない（visibleChips）。
export const SEARCH_CHIPS = [
  { key: 'all', label: 'すべて', genres: null },
  { key: 'comedy', label: 'コメディ', genres: ['Comedy'] },
  { key: 'romance', label: '恋愛', genres: ['Romance'] },
  { key: 'work', label: '仕事・法廷', genres: ['Legal', 'Drama', 'Political Drama'] },
  { key: 'crime', label: 'ミステリー・犯罪', genres: ['Crime Thriller'] },
  { key: 'other', label: 'SF・歴史・医療', genres: ['Sci-Fi', 'Historical Drama', 'Medical'] },
];

// 一覧の行に出すジャンルの名前。
export const GENRE_LABELS = {
  Comedy: 'コメディ',
  Romance: '恋愛',
  Legal: '法廷',
  Drama: '仕事',
  'Political Drama': '政治',
  'Crime Thriller': 'ミステリー・犯罪',
  'Sci-Fi': 'SF',
  'Historical Drama': '歴史',
  Medical: '医療',
};

export function chipFilter(key, items = RECOMMENDED) {
  const chip = SEARCH_CHIPS.find((c) => c.key === key);
  if (!chip || !chip.genres) return items;
  return items.filter((d) => chip.genres.includes(d.genre));
}

export function visibleChips(items = RECOMMENDED) {
  return SEARCH_CHIPS.filter((c) => !c.genres || chipFilter(c.key, items).length > 0);
}

// レベルの並べ方。
//   'fit'＝利用者のレベルを含む／'stretch'＝含まず、一つ上のレベルを含む／'other'＝それ以外。
//   三段にするか二段（合う／それ以外）にするかはオーナー確認中（LEVEL_GROUPS_THREE）。
export const LEVEL_ORDER = ['A2', 'B1', 'B2', 'C1'];
export const LEVEL_GROUPS_THREE = true;
export function levelGroups(items, userLevel, three = LEVEL_GROUPS_THREE) {
  const lv = LEVEL_ORDER.includes(userLevel) ? userLevel : 'B1';
  const up = LEVEL_ORDER[LEVEL_ORDER.indexOf(lv) + 1];
  const fit = [];
  const stretch = [];
  const other = [];
  for (const d of items || []) {
    const levels = d.level || [];
    if (levels.includes(lv)) fit.push(d);
    else if (three && up && levels.includes(up)) stretch.push(d);
    else other.push(d);
  }
  return three
    ? [
        { key: 'fit', items: fit },
        { key: 'stretch', items: stretch },
        { key: 'other', items: other },
      ].filter((g) => g.items.length)
    : [
        { key: 'fit', items: fit },
        { key: 'stretch', items: other },
      ].filter((g) => g.items.length);
}

// 行に出すレベルの印（利用者のレベルを含めばそれ、無ければ一番低いレベル）。
export function levelMark(item, userLevel) {
  const levels = item?.level || [];
  return levels.includes(userLevel) ? userLevel : levels[0] || '';
}

// 照合用に作品名を寄せる（大文字小文字・空白・記号・ひらがな/カタカナ・全角英数を同じに）。
export function normForMatch(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･\-‐ー–—:：/／★☆'’"“”.,、。!！?？&＆]+/g, '');
}

// 打っている途中の候補（厳選の作品から・端末の中だけで照合）。2文字から。
//   英語名・日本語名のどちらかに含まれれば候補。前方一致を先に並べる。
export function matchRecommended(query, items = RECOMMENDED, limit = 5) {
  const q = normForMatch(query);
  if (q.length < 2) return [];
  const hits = [];
  for (const d of items) {
    const en = normForMatch(d.title);
    const ja = normForMatch(d.ja);
    const theEn = en.replace(/^the/, '');
    let rank = -1;
    if (en.startsWith(q) || theEn.startsWith(q) || ja.startsWith(q)) rank = 0;
    else if (en.includes(q) || ja.includes(q)) rank = 1;
    if (rank >= 0) hits.push({ d, rank });
  }
  return hits
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((h) => h.d);
}

export function findRecommendedById(tmdbId, items = RECOMMENDED) {
  return items.find((d) => d.tmdbId === tmdbId) || null;
}
