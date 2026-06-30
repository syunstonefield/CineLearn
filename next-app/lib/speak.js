// 英単語・例文の読み上げ（Web Speech API）。単語帳・復習で共用。
export function speak(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  window.speechSynthesis.speak(u);
}
