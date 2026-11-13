// 線の絵の「文字列」版（紹介ページ app/(marketing)/page.js 用・2026-11-13）。
//   紹介ページは静的な HTML の文字列（dangerouslySetInnerHTML）で描くので、React の部品（LineIcons.js）をそのまま置けない。
//   流儀は LineIcons.js と同じ: 24×24・線 1.8・角は丸く・色は currentColor・aria-hidden。
//   LineIcons.js にある形は同じ線をそのまま写す（形を変える時は両方）。紹介ページだけの形（★印）はここにだけある。

const SHAPES = {
  // ── LineIcons.js と同じ形 ──
  openBook:
    '<path d="M12 6.5C10.2 5.2 7.6 4.6 4 4.8v13c3.6-.2 6.2.4 8 1.7 1.8-1.3 4.4-1.9 8-1.7v-13c-3.6-.2-6.2.4-8 1.7z"/><path d="M12 6.5v13"/>',
  target:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>',
  film:
    '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 3.5v17M16 3.5v17M8 12h8"/><path d="M4 7.5h4M4 12h4M4 16.5h4M16 7.5h4M16 12h4M16 16.5h4"/>',
  speaker:
    '<path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/><path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  pin: '<path d="M12 21s-6.2-5.4-6.2-10.6a6.2 6.2 0 0 1 12.4 0C18.2 15.6 12 21 12 21z"/><circle cx="12" cy="10.2" r="2.2"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  repeat:
    '<path d="M4.5 11V9.8A3.3 3.3 0 0 1 7.8 6.5h11"/><path d="M15.8 3.5l3 3-3 3"/><path d="M19.5 13v1.2a3.3 3.3 0 0 1-3.3 3.3h-11"/><path d="M8.2 20.5l-3-3 3-3"/>',
  clapper:
    '<path d="M4 10h16v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 10l-.5-2.7a1.4 1.4 0 0 1 1.1-1.6l12.6-2.3a1.4 1.4 0 0 1 1.6 1.1l.5 2.7z"/><path d="M8.3 5l1.9 3.6M13.3 4.1l1.9 3.6"/>',
  tv: '<rect x="3.5" y="6.5" width="17" height="12" rx="2"/><path d="M9 3.5l3 3 3-3"/><path d="M8.5 21h7"/>',
  warning:
    '<path d="M10.6 4.6a1.6 1.6 0 0 1 2.8 0l7.2 12.8a1.6 1.6 0 0 1-1.4 2.4H4.8a1.6 1.6 0 0 1-1.4-2.4z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="16.6" r="0.6" fill="currentColor"/>',

  // ── ★ 紹介ページだけの形（自作） ──
  // 一時停止（止めながら観る＝従来のやり方）
  pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
  // きらめき（AI が作る）
  sparkle:
    '<path d="M11 3.5c.7 3.8 2.5 5.6 6.3 6.3-3.8.7-5.6 2.5-6.3 6.3-.7-3.8-2.5-5.6-6.3-6.3 3.8-.7 5.6-2.5 6.3-6.3z"/><path d="M18 15.5v5M15.5 18h5"/>',
  // 太陽（朝の通知）
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7L18 18M6 18l1.3-1.3M16.7 7.3L18 6"/>',
  // 月（夕方の通知）
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  // 鍵（アドレス欄）
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  // かばん（仕事の英語）
  briefcase:
    '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5"/><path d="M3.5 12.5h17"/>',
  // ノートパソコン（IT の英語）
  laptop: '<rect x="5" y="5.5" width="14" height="10" rx="1.5"/><path d="M3 18.5h18"/>',
};

export function lineIcon(name, className = '') {
  const inner = SHAPES[name];
  if (!inner) return '';
  return `<svg class="li-ic${className ? ' ' + className : ''}" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}
