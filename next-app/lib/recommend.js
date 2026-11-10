// ジャンルの一覧（初回アンケート）と、検索で見つからない時の AI の言い換え（aiResolveTitles）。
// AI推薦（mode:'recommend'）とタイトル検索（mode:'title_search'）は、作品追加モーダルと一緒に 2026-11-10 に削除。
// 2026-09-12: プロンプトはサーバ（/api/claude の各 mode）が組み、結果は共有キャッシュに乗る。
//   旧実装はここでプロンプトを組んで既定モードへ投げていた＝ユーザーごと・操作ごとに課金され、
//   生成用のレート枠も消費していた。同じ条件（レベル×ジャンル×サービス／検索語）の2人目からは0円。
import { callClaudeMode } from './api';

// 初回アンケートで選べるジャンル
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

// 曖昧・日本語・うろ覚え・タイポの検索語を、実在作品の「英語原題」候補(最大5件)に解釈する。
// Enter押下時のAI支援検索で使う（結果は各タイトルをTMDBで実在確認してから表示する）。
export async function aiResolveTitles(query) {
  const d = await callClaudeMode({ mode: 'resolve_titles', query });
  const arr = Array.isArray(d?.items) ? d.items : [];
  return arr.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5);
}
