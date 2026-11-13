// 線の絵（2026-11-12 オーナー決定＝絵文字を線の絵にそろえていく）。
//   流儀は下のタブ（components/BottomNav.js）と同じ: 24×24・線の太さ 1.8・角は丸く・色は currentColor（親の文字色）。
//   形は自作（外のアイコン集をそのまま写さない）。下のタブの絵（家・重ねた札・本・棒グラフ・半券）と見分けがつく形にする。
//   読み上げ: 絵はいつも aria-hidden。名前は押す所（button の aria-label・文字）に付ける。
//   使い方: <IconSpeaker />（既定 1em＝まわりの文字の大きさ）／<IconSpeaker size={20} />。

const LINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

//   filled: 付けた時（覚えたい★・例文の♡・お気に入り★）は塗る＝線と同じ色で中を埋める。
function Svg({ size = '1em', className = '', filled = false, children }) {
  return (
    <svg
      className={'li-ic' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...LINE}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// 開いた本（単語リスト）
export function IconOpenBook(p) {
  return (
    <Svg {...p}>
      <path d="M12 6.5C10.2 5.2 7.6 4.6 4 4.8v13c3.6-.2 6.2.4 8 1.7 1.8-1.3 4.4-1.9 8-1.7v-13c-3.6-.2-6.2.4-8 1.7z" />
      <path d="M12 6.5v13" />
    </Svg>
  );
}

// 的（クイズ）
export function IconTarget(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </Svg>
  );
}

// フィルム（ほかの話）
export function IconFilm(p) {
  return (
    <Svg {...p}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 3.5v17M16 3.5v17M8 12h8" />
      <path d="M4 7.5h4M4 12h4M4 16.5h4M16 7.5h4M16 12h4M16 16.5h4" />
    </Svg>
  );
}

// スピーカー（音・発音）
export function IconSpeaker(p) {
  return (
    <Svg {...p}>
      <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6" />
      <path d="M17.6 6.6a7.6 7.6 0 0 1 0 10.8" />
    </Svg>
  );
}

// スピーカー・音なし（音声の自動再生がオフ）
export function IconSpeakerOff(p) {
  return (
    <Svg {...p}>
      <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" />
      <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </Svg>
  );
}

// ピン（場面の時刻）
export function IconPin(p) {
  return (
    <Svg {...p}>
      <path d="M12 21s-6.2-5.4-6.2-10.6a6.2 6.2 0 0 1 12.4 0C18.2 15.6 12 21 12 21z" />
      <circle cx="12" cy="10.2" r="2.2" />
    </Svg>
  );
}

// チェック（覚えた・完了）
export function IconCheck(p) {
  return (
    <Svg {...p}>
      <path d="M5 12.6l4.4 4.4L19 7.4" />
    </Svg>
  );
}

// 芽（学習した日・累計・オーナー決定 2026-11-13）。地面の線から茎が1本、左右に葉が2枚（自作）。
//   ホームの今日の復習の札で使う（薄い緑・.hm-days-line）。単語リストの「未学習」とは別の意味＝そちらでは使わない。
export function IconSprout(p) {
  return (
    <Svg {...p}>
      <path d="M12 20.5v-8.5" />
      <path d="M12 13.5c0-3.6-2.4-6-6.5-6 0 3.6 2.4 6 6.5 6z" />
      <path d="M12 11.5c0-3.4 2.2-5.6 6-5.6 0 3.4-2.2 5.6-6 5.6z" />
      <path d="M7 20.5h10" />
    </Svg>
  );
}

// 星（マスター）
export function IconStar(p) {
  return (
    <Svg {...p}>
      <path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" />
    </Svg>
  );
}

// えんぴつ（自分で追加した）
export function IconPencil(p) {
  return (
    <Svg {...p}>
      <path d="M4.5 19.5l.9-4.1L15.6 5.2a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.6 18.6z" />
      <path d="M13.8 7l3.2 3.2" />
    </Svg>
  );
}

// くり返しの矢印（復習）
export function IconRepeat(p) {
  return (
    <Svg {...p}>
      <path d="M4.5 11V9.8A3.3 3.3 0 0 1 7.8 6.5h11" />
      <path d="M15.8 3.5l3 3-3 3" />
      <path d="M19.5 13v1.2a3.3 3.3 0 0 1-3.3 3.3h-11" />
      <path d="M8.2 20.5l-3-3 3-3" />
    </Svg>
  );
}

// カチンコ（映画）
export function IconClapper(p) {
  return (
    <Svg {...p}>
      <path d="M4 10h16v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M4 10l-.5-2.7a1.4 1.4 0 0 1 1.1-1.6l12.6-2.3a1.4 1.4 0 0 1 1.6 1.1l.5 2.7z" />
      <path d="M8.3 5l1.9 3.6M13.3 4.1l1.9 3.6" />
    </Svg>
  );
}

// テレビ（ドラマ）
export function IconTv(p) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="6.5" width="17" height="12" rx="2" />
      <path d="M9 3.5l3 3 3-3" />
      <path d="M8.5 21h7" />
    </Svg>
  );
}

// カレンダー（次の復習の日・対応予定）
export function IconCalendar(p) {
  return (
    <Svg {...p}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Svg>
  );
}

// ごみ箱（削除）
export function IconTrash(p) {
  return (
    <Svg {...p}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.9 11.6a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4L17.5 7" />
      <path d="M10.3 11v5.5M13.7 11v5.5" />
    </Svg>
  );
}

// 注意（取り消せない操作の前）
export function IconWarning(p) {
  return (
    <Svg {...p}>
      <path d="M10.6 4.6a1.6 1.6 0 0 1 2.8 0l7.2 12.8a1.6 1.6 0 0 1-1.4 2.4H4.8a1.6 1.6 0 0 1-1.4-2.4z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="16.6" r="0.6" fill="currentColor" />
    </Svg>
  );
}

// 閉じる（各画面の右上の ✕・押す所の大きさはボタンの側で保つ）
export function IconClose(p) {
  return (
    <Svg {...p}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

// ハート（語に付いた例文の保存・付けた時は塗り）
export function IconHeart(p) {
  return (
    <Svg {...p}>
      <path d="M12 20s-7.5-4.6-7.5-10.1C4.5 7.1 6.6 5 9.1 5c1.3 0 2.3.6 2.9 1.5.6-.9 1.6-1.5 2.9-1.5 2.5 0 4.6 2.1 4.6 4.9C19.5 15.4 12 20 12 20z" />
    </Svg>
  );
}

// きらめき（終わりの画面・あゆみの今日の札の飾り）
export function IconSparkle(p) {
  return (
    <Svg {...p}>
      <path d="M12 3.5c.6 4.3 2.4 6.6 7 8.5-4.6 1.9-6.4 4.2-7 8.5-.6-4.3-2.4-6.6-7-8.5 4.6-1.9 6.4-4.2 7-8.5z" />
    </Svg>
  );
}


// ── 第2便（#p5・2026-11-14）: 画面に残っていた絵文字の置き換え用（自作・24×24・線 1.8）──
// 半券（観たあとに・コレクションの半券）
export function IconTicket(p) {
  return (
    <Svg {...p}>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z" />
      <path d="M14.5 6.5v2M14.5 11v2M14.5 15.5v2" />
    </Svg>
  );
}
// パズルの1片（拡張機能）
export function IconPuzzle(p) {
  return (
    <Svg {...p}>
      <path d="M5 8.5h3.2a2 2 0 1 1 3.6 0H15v3.3a2 2 0 1 1 0 3.6V19H5z" />
    </Svg>
  );
}
// ヘッドホン（リハーサル＝聞く練習）
export function IconHeadphones(p) {
  return (
    <Svg {...p}>
      <path d="M4.5 15v-2.5a7.5 7.5 0 0 1 15 0V15" />
      <rect x="4" y="14" width="4" height="6" rx="1.5" />
      <rect x="16" y="14" width="4" height="6" rx="1.5" />
    </Svg>
  );
}
// しおり（保存した語）
export function IconBookmark(p) {
  return (
    <Svg {...p}>
      <path d="M7 4h10v16l-5-3.6L7 20z" />
    </Svg>
  );
}
// 額の絵（ポスター）
export function IconImage(p) {
  return (
    <Svg {...p}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M5 17l4.5-4 3 2.5L16 12l3.5 3.5" />
    </Svg>
  );
}
// 歯車（設定）
export function IconGear(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6" />
    </Svg>
  );
}
// 飛行機（旅行）
export function IconPlane(p) {
  return (
    <Svg {...p}>
      <path d="M3.5 13.5l7-1.5 5-6.5a1.6 1.6 0 0 1 2.4 2.1L13.5 13l1 7-2 .5-2.5-6-5 1z" />
    </Svg>
  );
}
// かばん（仕事）
export function IconBriefcase(p) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" />
    </Svg>
  );
}
// スマホ（使い方の表）
export function IconPhone(p) {
  return (
    <Svg {...p}>
      <rect x="7" y="3.5" width="10" height="17" rx="2" />
      <path d="M11 17.6h2" />
    </Svg>
  );
}
// ノートPC（使い方の表・PC 専用の案内）
export function IconLaptop(p) {
  return (
    <Svg {...p}>
      <rect x="5" y="5.5" width="14" height="10" rx="1.5" />
      <path d="M3 18.5h18" />
    </Svg>
  );
}
// 丸に「？」「波」「✓」（採点の3つ・顔の絵は使わない・形で見分ける）
export function IconCircleQuestion(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6" />
      <circle cx="12" cy="16.9" r="0.6" fill="currentColor" />
    </Svg>
  );
}
export function IconCircleWave(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M7.5 12.4c1.1-1.3 2.2-1.3 3 0s1.9 1.3 3 0 2.2-1.3 3 0" />
    </Svg>
  );
}
export function IconCircleCheck(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 12.3l2.7 2.7 5-5.2" />
    </Svg>
  );
}

// 文の中の記号（★ ♡ ♥ 📺）を、文の高さに合わせた線の絵に置き換えて出す（2026-11-13 受付経由・外の AI の指摘「文字の★が浮く」）。
//   色は文と同じ（currentColor）。読み上げは絵ごとに名前を付ける（「星 覚えたい」のように文が通る）。
//   Chrome 拡張のボタン名を説明する文（拡張の画面は本当に文字の★）には使わない。
const MARKS = {
  '★': { label: '星', el: () => <IconStar filled /> },
  '♡': { label: 'ハート', el: () => <IconHeart /> },
  '♥': { label: 'ハート', el: () => <IconHeart filled /> },
  '📺': { label: '作品', el: () => <IconFilm /> },
  // 第2便（#p5・2026-11-14）: 文の中に残っていた絵文字も同じ仕組みで線の絵に
  '📍': { label: '時刻', el: () => <IconPin /> },
  '⚠': { label: '注意', el: () => <IconWarning /> },
  '🔊': { label: '音', el: () => <IconSpeaker /> },
  '🎬': { label: '映画', el: () => <IconClapper /> },
  '✅': { label: '済み', el: () => <IconCheck /> },
  '⭐': { label: '星', el: () => <IconStar /> },
  '🔁': { label: '復習', el: () => <IconRepeat /> },
  '🔄': { label: 'くり返し', el: () => <IconRepeat /> },
  '📖': { label: '本', el: () => <IconOpenBook /> },
  '🗑': { label: '削除', el: () => <IconTrash /> },
  '📱': { label: 'スマホ', el: () => <IconPhone /> },
  '💻': { label: 'PC', el: () => <IconLaptop /> },
  '✏': { label: '追加', el: () => <IconPencil /> },
  '📝': { label: 'メモ', el: () => <IconPencil /> },
  '🎟': { label: '半券', el: () => <IconTicket /> },
  '🧩': { label: '拡張機能', el: () => <IconPuzzle /> },
  '🎧': { label: '聞く', el: () => <IconHeadphones /> },
  '🔖': { label: '保存', el: () => <IconBookmark /> },
  '🖼': { label: 'ポスター', el: () => <IconImage /> },
  '⚙': { label: '設定', el: () => <IconGear /> },
  '✈': { label: '旅行', el: () => <IconPlane /> },
  '💼': { label: '仕事', el: () => <IconBriefcase /> },
  '🎉': { label: '楽しく', el: () => <IconSparkle /> },
};
const MARK_RE = new RegExp('(' + Object.keys(MARKS).join('|') + ')', 'u');
// 絵文字の見た目の指定（U+FE0F・U+FE0E）は落としてから分ける
export function MarkText({ text }) {
  const parts = String(text ?? '').replace(/[\uFE0E\uFE0F]/g, '').split(MARK_RE);
  return parts.map((p, i) =>
    MARKS[p] ? (
      <span key={i} className="li-mark" role="img" aria-label={MARKS[p].label}>
        {MARKS[p].el()}
      </span>
    ) : (
      p
    ),
  );
}
