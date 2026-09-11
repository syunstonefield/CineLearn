// ドラマ追加（AI推薦・タイトル検索）。js/app.js: getRecommendations / manualSearchDrama から移植。
// 2026-09-12: プロンプトはサーバ（/api/claude の各 mode）が組み、結果は共有キャッシュに乗る。
//   旧実装はここでプロンプトを組んで既定モードへ投げていた＝ユーザーごと・操作ごとに課金され、
//   生成用のレート枠も消費していた。同じ条件（レベル×ジャンル×サービス／検索語）の2人目からは0円。
import { callClaudeMode } from './api';

// AI推薦タブで選べるジャンル（index.html の .genre-tags と同一）
export const GENRES = [
  { genre: 'Crime Thriller', label: 'クライム' },
  { genre: 'Comedy', label: 'コメディ' },
  { genre: 'Romance', label: 'ロマンス' },
  { genre: 'Sci-Fi', label: 'SF' },
  { genre: 'Horror', label: 'ホラー' },
  { genre: 'Historical Drama', label: '歴史劇' },
  { genre: 'Medical', label: '医療' },
  { genre: 'Legal', label: '法廷' },
];

// AIにおすすめを聞く（3作品）。onRetry は互換のため受けるが未使用（サーバ側キャッシュ命中が主経路）。
export async function recommendDramas({ userLevel, toeicScore, selectedGenres, selectedServices }) {
  const d = await callClaudeMode({
    mode: 'recommend',
    userLevel,
    toeicScore,
    genres: selectedGenres,
    services: selectedServices,
  });
  if (!Array.isArray(d?.items)) throw new Error('おすすめを取得できませんでした');
  return d.items;
}

// タイトルで検索（単作品の情報を取得・見つからなければ []）
export async function searchDramaByTitle(title, { userLevel, selectedServices }) {
  const d = await callClaudeMode({ mode: 'title_search', title, userLevel, services: selectedServices });
  if (!Array.isArray(d?.items)) throw new Error('作品情報を取得できませんでした');
  return d.items;
}

// 曖昧・日本語・うろ覚え・タイポの検索語を、実在作品の「英語原題」候補(最大5件)に解釈する。
// Enter押下時のAI支援検索で使う（結果は各タイトルをTMDBで実在確認してから表示する）。
export async function aiResolveTitles(query) {
  const d = await callClaudeMode({ mode: 'resolve_titles', query });
  const arr = Array.isArray(d?.items) ? d.items : [];
  return arr.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5);
}
