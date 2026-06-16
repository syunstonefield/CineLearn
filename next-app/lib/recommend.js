// ドラマ追加（AI推薦・タイトル検索）。js/app.js: getRecommendations / manualSearchDrama から移植。
import { callClaude } from './api';

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

// AIにおすすめを聞く（3作品）。onRetry(attempt, waitSec) は混雑リトライ用。
export async function recommendDramas({ userLevel, toeicScore, selectedGenres, selectedServices }, onRetry) {
  const prompt = `あなたは英語学習専門のアドバイザーです。
以下の条件で海外ドラマ・映画を3作品おすすめしてください。

ユーザーの英語レベル: ${userLevel}（TOEICスコア目安: ${toeicScore}点）
好きなジャンル: ${selectedGenres.join(', ')}
利用可能なサービス: ${selectedServices.join(', ')}

※必ず上記のサービスで視聴できる作品のみ選んでください。

以下のJSON形式のみで返答してください（説明文不要）:
[
  {
    "title": "作品名（英語）",
    "genre": "ジャンル",
    "level": "${userLevel}",
    "platform": "視聴できるサービス名",
    "seasons": シーズン数（数字のみ）,
    "reason": "このレベルの学習者におすすめの理由（日本語・1文）",
    "speech_feature": "英語の特徴（例：はっきりした発音、スラング多め）"
  }
]`;
  const text = await callClaude(prompt, 2000, onRetry);
  return JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
}

// タイトルで検索（単作品の情報を取得・見つからなければ []）
export async function searchDramaByTitle(title, { userLevel, selectedServices }) {
  const svcs = selectedServices.length ? selectedServices.join(', ') : 'Netflix, Amazon Prime';
  const prompt = `「${title}」について以下のJSON形式で返してください（見つからない場合は[]）。
[{"title":"${title}","genre":"ジャンル","level":"${userLevel}","platform":"視聴可能なサービス（${svcs}のいずれか）","seasons":1,"reason":"おすすめの理由（日本語・1文）","speech_feature":"英語の特徴"}]`;
  const text = await callClaude(prompt);
  return JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
}

// 曖昧・日本語・うろ覚え・タイポの検索語を、実在作品の「英語原題」候補(最大5件)に解釈する。
// Enter押下時のAI支援検索で使う（結果は各タイトルをTMDBで実在確認してから表示する）。
export async function aiResolveTitles(query, onRetry) {
  const prompt = `ユーザーが英語学習用に海外ドラマ・映画を探しています。
検索語: "${query}"

この検索語に該当しそうな「実在する作品の英語原題」を、関連度・人気順に最大5件挙げてください。
- 日本語入力・うろ覚え・スペルミス・あいまいな説明（例:「あの弁護士ドラマ」「医療系のやつ」）も解釈する
- 実在しない作品は含めない
- 余計な説明やコメントは不要。JSON配列のみで返答:

["English Title 1", "English Title 2"]`;
  const text = await callClaude(prompt, 500, onRetry);
  const arr = JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
  return Array.isArray(arr) ? arr.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5) : [];
}
