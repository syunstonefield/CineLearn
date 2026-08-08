// 半券の保持規律（純粋関数のみ・importなし）。
// tickets.js（発行時）と supabase.js（クラウドとのマージ時）の両方が同じ規律を適用する必要があり、
// 以前は上限とキーが両ファイルに別々にハードコードされていた（「lib/tickets.js と同値」コメント付き＝
// ドリフト待ちの状態）。片方だけ直すと直後のクラウド同期で元に戻るため、規律はここに集約する。
// ⚠ supabase.js は tickets.js から import されるため、ここは循環を避けて依存ゼロに保つこと。

// 出題語（words）を保持する枚数。半券1枚は語15前後×定義/例文/和訳を焼き込んでいて重い
// （≒3KB/枚）。user_state の1行に載せる以上、重い側だけは上限が要る。
export const MAX_FULL_TICKETS = 30;

// 記録として残す枚数。以前はこれが 30 で、31話目を観ると最初の半券が黙って消えていた
// （＝観た証が古い順に失われる）。軽い記録（≒0.2KB/枚）は残すので上限は暴走ガードの意味だけ。
export const MAX_TICKETS = 500;

// 同一作品・同一話を1枚に畳むキー。
// ★tmdbId を最優先★（英語原題「Suits」と邦題「SUITS/スーツ」で title が割れると同一話が
//   二重発行される。tmdbId は表記に依らず一意）。tmdbId が無い古いデータだけ title に落ちる。
export function ticketEpKey(t) {
  return `${t.tmdbId ?? t.title}|${t.season}|${t.episode}`;
}

// 保持規律を適用する（古い順に並べ、上限でFIFO、古い半券からは words を外す）。
// words を外した半券も「観た証」としては完全に残る（作品・話・席番号・日時）。
export function trimTickets(list) {
  const arr = (Array.isArray(list) ? list : [])
    .filter((t) => t && t.id)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  while (arr.length > MAX_TICKETS) arr.shift();

  // 新しい方から MAX_FULL_TICKETS 枚だけ出題語を持つ。
  const keepFrom = Math.max(0, arr.length - MAX_FULL_TICKETS);
  return arr.map((t, i) => {
    if (i >= keepFrom || !t.words?.length) return t;
    // words は落とすが、何語の話だったかは記録として残す。
    const { words, ...rest } = t;
    return { ...rest, wordCount: t.wordCount ?? words.length };
  });
}
