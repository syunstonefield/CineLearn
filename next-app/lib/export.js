// 単語・意味・SRS 履歴の書き出し（CSV / Anki）。無料・永久（docs/decision-pricing-2026-10-08.md の
// 「無料（永久・法的に必須）」＝ベータ規約の「失わない」の裏付け）。
// データは端末内だけから作る（予習履歴 cl_history・SRS cl_srs・マイ単語帳 cl_my_words_*）。API は呼ばない。
//
// 例文の扱い（法務・32条引用＋48条出所明示）:
//   ・例文を含めるかどうかで無料/有料の差は付けない（例文付き書き出しそのものを特典にしない）。
//   ・字幕由来の例文には出典（作品名 SxE・字幕：OpenSubtitles）を**例文と同じ欄**に入れる
//     （列を分けると表計算やAnkiで出典だけ落とされうる）。
//   ・1話あたりの例文数に上限 EXPORT_EXAMPLES_PER_EPISODE（1話一括は全文複製に近づく）。
//     上限を超えた語も単語・意味・SRS 履歴は書き出す（例文欄だけ空）。
//   ・plus 語（Claude の作例・字幕外）は引用ではないので上限に数えず、出典も付けない。
import { isLearned, isMastered, subtitleCredit, localDateStr } from './storage';
import { trimExampleToSentence } from './subtitles';

export const EXPORT_EXAMPLES_PER_EPISODE = 10;

const STATUS = { mastered: 'マスター', learned: '覚えた', learning: '学習中', new: '未学習', skipped: '除外' };

function statusOf(e) {
  if (!e) return STATUS.new;
  if (e.skipped) return STATUS.skipped;
  if (isMastered(e)) return STATUS.mastered;
  if (isLearned(e)) return STATUS.learned;
  return STATUS.learning;
}

// 書き出す行を集める。1語1行（小文字で重複排除）。
//   history  = loadHistory()
//   srs      = loadSrs()
//   myWords  = getActiveWords(profileId)
//   movieTitles = 映画の作品名 Set（履歴の drama は type を持たないため。偽の S1E1 を書かない）
// 語の「作品/話」と例文は同じ記録から取る（例文と出典の話数がずれないように）。
// 予習履歴は古い日付を優先（最初に出会った話）、無ければマイ単語帳、どちらにも無い SRS だけの語は
// e.origin を使う（作品を消しても復習記録は書き出す）。
export function collectExportRows({ history = [], srs = {}, myWords = [], movieTitles = new Set(), includeExamples = true } = {}) {
  const map = new Map();
  const put = (k, rec) => {
    if (k && !map.has(k)) map.set(k, rec);
  };

  [...history]
    .sort((a, b) => (String(a.date || '') < String(b.date || '') ? -1 : 1))
    .forEach((h) => {
      const title = h.drama?.title || '';
      (h.words || []).forEach((w) => {
        const k = String(w.word || '').toLowerCase().trim();
        put(k, {
          w,
          via: '予習',
          src: {
            title,
            season: h.season ?? null,
            episode: h.episode ?? null,
            type: h.drama?.type === 'movie' || movieTitles.has(title) || h.season == null ? 'movie' : 'tv',
          },
        });
      });
    });

  (myWords || []).forEach((w) => {
    const k = String(w?.word || '').toLowerCase().trim();
    const hasEp = w?.season != null && w?.episode != null;
    put(k, {
      w: { ...w, example: w.sentence || w.example || '', definition: w.ja || w.definition || '' },
      via: '単語帳',
      src: {
        title: w?.dramaTitle || '',
        season: w?.season ?? null,
        episode: w?.episode ?? null,
        type: !hasEp || movieTitles.has(w?.dramaTitle) ? 'movie' : 'tv',
      },
    });
  });

  Object.entries(srs || {}).forEach(([k, e]) => {
    const o = e?.origin || {};
    put(String(k).toLowerCase().trim(), {
      w: { word: k },
      via: '復習記録',
      src: {
        title: o.title || '',
        season: o.season ?? null,
        episode: o.episode ?? null,
        type: movieTitles.has(o.title) || o.season == null ? 'movie' : 'tv',
      },
    });
  });

  const rows = [...map.entries()].map(([k, { w, via, src }]) => {
    const e = srs?.[k];
    return {
      key: k,
      word: String(w.word || k).trim(),
      meaning: String(w.ja || w.definition || '').trim(),
      pos: String(w.pos || '').trim(),
      title: src.title,
      season: src.type === 'movie' ? null : src.season,
      episode: src.type === 'movie' ? null : src.episode,
      via,
      status: statusOf(e),
      easeFactor: typeof e?.easeFactor === 'number' ? Math.round(e.easeFactor * 100) / 100 : '',
      interval: e?.interval ?? '',
      repetitions: e?.repetitions ?? '',
      lastReview: e?.lastReview || '',
      dueDate: e?.dueDate || '',
      reviewCount: e?.reviewCount ?? '',
      // 例文は下で上限をかけてから入れる
      _example: String(w.example || '').trim(),
      _exampleJa: String(w.example_ja || '').trim(),
      _plus: w.source === 'plus',
      _src: src,
      example: '',
      exampleJa: '',
    };
  });

  if (includeExamples) applyExamples(rows);

  // 作品 → 季 → 話 → 単語 の順（同じ話の語がまとまる）
  rows.sort(
    (a, b) =>
      a.title.localeCompare(b.title, 'ja') ||
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? 0) - (b.episode ?? 0) ||
      a.word.localeCompare(b.word, 'en')
  );
  return rows;
}

// 1話あたり EXPORT_EXAMPLES_PER_EPISODE 文まで。学習が進んでいる語（復習した語）から優先して例文を付ける
// ＝自分が覚えた場面が残る。並びは決定的（毎回同じ語に例文が付く）。
function applyExamples(rows) {
  const byEp = new Map();
  rows.forEach((r) => {
    if (!r._example) return;
    if (r._plus) {
      r.example = r._example; // 作例（字幕外）は引用ではない＝上限・出典なし
      r.exampleJa = r._exampleJa;
      return;
    }
    if (!r._src.title) return; // 出所の分からない字幕は出典を書けない＝書き出さない（48条）
    const ep = `${r._src.title}|${r.season ?? ''}|${r.episode ?? ''}`;
    if (!byEp.has(ep)) byEp.set(ep, []);
    byEp.get(ep).push(r);
  });
  const RANK = { [STATUS.mastered]: 0, [STATUS.learned]: 1, [STATUS.learning]: 2, [STATUS.new]: 3, [STATUS.skipped]: 4 };
  const rank = (r) => RANK[r.status] ?? 3;
  byEp.forEach((list) => {
    list
      .sort((a, b) => rank(a) - rank(b) || a.word.localeCompare(b.word, 'en'))
      .slice(0, EXPORT_EXAMPLES_PER_EPISODE)
      .forEach((r) => {
        const credit = subtitleCredit({ _src: r._src }).replace(/^📺\s*/, '');
        r.example = `${trimExampleToSentence(r._example, r.word)} — 出典: ${credit}`;
        r.exampleJa = r._exampleJa;
      });
  });
}

function epLabel(r) {
  if (!r.title) return '';
  if (r.season == null || r.episode == null) return r.title;
  return `${r.title} S${r.season}E${r.episode}`;
}

const COLUMNS = [
  ['単語', (r) => r.word],
  ['意味', (r) => r.meaning],
  ['品詞', (r) => r.pos],
  ['作品', (r) => r.title],
  ['シーズン', (r) => r.season ?? ''],
  ['話', (r) => r.episode ?? ''],
  ['入手元', (r) => r.via],
  ['状態', (r) => r.status],
  ['easeFactor', (r) => r.easeFactor],
  ['interval(日)', (r) => r.interval],
  ['repetitions', (r) => r.repetitions],
  ['lastReview', (r) => r.lastReview],
  ['dueDate', (r) => r.dueDate],
  ['復習回数', (r) => r.reviewCount],
  ['例文（出典つき）', (r) => r.example],
  ['例文の訳', (r) => r.exampleJa],
];

// RFC 4180。Excel で文字化けしないよう UTF-8 BOM・改行は CRLF。
// 先頭が = + - @ のセルは数式として実行されうる（CSV インジェクション）ので ' を前置。
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  const lines = [COLUMNS.map(([h]) => csvCell(h)).join(',')];
  rows.forEach((r) => lines.push(COLUMNS.map(([, f]) => csvCell(f(r))).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
// TSV の1欄＝タブと改行を含めない
const tsvCell = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
// Anki のタグは空白区切り＝作品名の空白は _ に
const tag = (s) => String(s || '').trim().replace(/\s+/g, '_');

// Anki 用に載せる行＝意味のある語だけ。意味が空の語（復習の記録だけ残り元の単語リストが無い語など）は
// 裏面が空のカードになるので外す（CSV には全部残す＝「失わない」約束は CSV で守る・オーナー 2026-10-08）。
export function ankiRows(rows) {
  return (rows || []).filter((r) => String(r.meaning || '').trim());
}

// Anki の「ファイルから読み込む」用テキスト（Anki 2.1.54+ のファイルヘッダ）。
// 列: 1=表（単語）2=裏（意味・品詞・例文＋出典・訳）3=タグ 4以降=SRS 履歴（「基本」ノートでは
// 取り込まれず無視される＝必要なら自分のノートタイプの欄に割り当てられる）。
// Anki はテキスト取り込みで復習予定を引き継げないため、SRS 履歴は列として残すだけ。
// BOM は付けない（先頭の #separator ヘッダの認識を妨げないため・Anki は UTF-8 前提）。
export function toAnkiTsv(rows) {
  const head = [
    '#separator:tab',
    '#html:true',
    '#tags column:3',
    '#columns:表\t裏\tタグ\t作品と話\t状態\teaseFactor\tinterval\trepetitions\tlastReview\tdueDate',
  ];
  const body = ankiRows(rows).map((r) => {
    const back = [
      r.meaning && escHtml(r.meaning),
      r.pos && `<small>${escHtml(r.pos)}</small>`,
      r.example && `<i>${escHtml(r.example)}</i>`,
      r.exampleJa && escHtml(r.exampleJa),
    ]
      .filter(Boolean)
      .join('<br>');
    const tags = ['CineLearn', r.title && `CineLearn::${tag(epLabel(r))}`, `CineLearn::${r.status}`].filter(Boolean).join(' ');
    return [
      escHtml(r.word),
      back,
      tags,
      epLabel(r),
      r.status,
      r.easeFactor,
      r.interval,
      r.repetitions,
      r.lastReview,
      r.dueDate,
    ]
      .map(tsvCell)
      .join('\t');
  });
  return head.join('\n') + '\n' + body.join('\n') + '\n';
}

export function exportFileName(ext) {
  return `cinelearn-words-${localDateStr()}.${ext}`;
}

// ブラウザでファイルとして保存させる（端末内で完結・送信なし）
export function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
