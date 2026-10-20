// 手動追加（単語リストの「この話の単語を追加」）で例文が付かなかった時の案内文（2026-10-20 /decide E）。
//   追加直後のメッセージと、追加直後に出す1枚カードの両方がこれを使う（文言を1か所に）。
//
// 分類（docs/decision-manual-example-matching-2026-10-20.md E）:
//   never  … 今後も付かない（仕様で探さない語）
//   retry  … いまは用意できなかった。★手動追加の語は自動では取り直さない（lib/exampleBackfill.js の
//            needsExample が origin 'manual' を除外）ので、「あとで付く」とは書かず、本人ができる行動
//            （入れ直す）を書く。
//   login  … ログインすると付く
//   none   … 探したが、この回の字幕に無かった
// 文言の決まり（法務 R1/R2）: 当社が字幕ファイルを用意・保有・配布しているように読める表現
//   （「字幕が用意できると付きます」等）は使わない。OpenSubtitles の名前と取得枠の上限には触れない
//   （出所の表示は引用に付けるものだけ）。
const NOTES = {
  common_word: ['never', 'よく使う語なので例文は付けません'],
  multi_token: ['never', '例文は1語のときだけ探します'],
  too_short: ['never', '3文字以上の語だけ例文を探します'],
  too_long: ['never', '長すぎる語は例文を探しません'],
  tmdb_unresolved: ['never', '作品を特定できなかったため例文は付けられません'],
  missing_params: ['never', '作品の情報が足りないため例文は付けられません'],
  login_required: ['login', 'ログインすると例文が付きます'],
  no_match: ['none', 'この回では例文が見つかりませんでした'],
  no_subtitle_file: ['none', 'この回では例文が見つかりませんでした'],
};
const RETRY_TEXT = 'いまは例文を用意できませんでした。時間をおいて入れ直すと付くことがあります';

// reason（/api/example の応答）→ { kind, text }。未知の理由は retry 扱い（実際に入れ直せば再試行される）。
export function manualExampleNote(reason) {
  const hit = NOTES[reason];
  if (hit) return { kind: hit[0], text: hit[1] };
  return { kind: 'retry', text: RETRY_TEXT };
}
