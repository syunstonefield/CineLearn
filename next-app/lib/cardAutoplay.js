// カードの音声の自動再生（2026-11-13 オーナー決定・「単語を学ぶ」と復習のカードで共用）。
//   値: プロフィールの設定 settings.cardAutoplay（true＝オン）。初期はオフ。
//   保存はほかの設定（カードの枚数・復習のひと区切り）と同じ＝プロフィールの設定に入り、ログイン中はクラウドへ同期する。
//   読み書きはこのファイルの関数だけを使う（カードの隅のスイッチと設定の画面のスイッチは同じ1つの値）。
//   依存なし（node のテストから読む）。読み上げ（speak）は呼ぶ側の useCardAutoplay（lib/useCardAutoplay.js）。

// 設定の項目名（cl_profiles の settings の中のキー）
export const CARD_AUTOPLAY_SETTING = 'cardAutoplay';

// 今の値（設定が無い・古い端末＝オフ）
export function isCardAutoplayOn(settings) {
  return !!settings && settings[CARD_AUTOPLAY_SETTING] === true;
}

// updateSettings に渡す差分（例: updateSettings(cardAutoplayPatch(true))）
export function cardAutoplayPatch(on) {
  return { [CARD_AUTOPLAY_SETTING]: !!on };
}

// 自動で読み上げる時の「同じカードか」の印。同じカードのまま（めくった・答え合わせ・設定を開いた）では鳴らし直さない。
export function cardAutoplayKey(index, word) {
  return `${index}:${String(word || '').toLowerCase()}`;
}
