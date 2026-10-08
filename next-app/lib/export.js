// 単語・意味・SRS 履歴の書き出し（CSV / Anki）。無料・永久（docs/decision-pricing-2026-10-08.md の
// 「無料（永久・法的に必須）」＝ベータ規約の「失わない」の裏付け）。
// データは端末内だけから作る（予習履歴 cl_history・SRS cl_srs・マイ単語帳 cl_my_words_*）。API は呼ばない。
//
// 例文は書き出さない（オーナー決定 2026-10-08）:
//   ・字幕の例文は著作物の一部＝アプリ内では引用（32条）＋出所明示（48条）として見せるが、ファイルとして外へは出さない
//     （1話あたりの上限・出典の付け方・OpenSubtitles の再配布・有料化後の扱いの悩みが全部なくなる）。
//   ・無料／有料で同じ条件（例文付き書き出しを特典にしない）。例文はアプリの中で無料のまま見られる。
//   ・代わりに「出会った場面: 作品 SxE」（事実）を書く。映画は話数を書かない。
import { isLearned, isMastered, isMovieWork, movieWorkSet, localDateStr } from './storage';

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
// 映画の判定は storage.js の isMovieWork（作品一覧・名寄せ・記録の type）に揃える＝偽の S1E1 を書かない。
// 予習履歴は古い日付を優先（最初に出会った話）、無ければマイ単語帳、どちらにも無い SRS だけの語は
// e.origin を使う（作品を消しても復習記録は書き出す）。
export function collectExportRows({ history = [], srs = {}, myWords = [], movies = movieWorkSet() } = {}) {
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
            type: isMovieWork(title, h.drama?.type, movies) || h.season == null ? 'movie' : 'tv',
          },
        });
      });
    });

  (myWords || []).forEach((w) => {
    const k = String(w?.word || '').toLowerCase().trim();
    const hasEp = w?.season != null && w?.episode != null;
    put(k, {
      w: { ...w, definition: w.ja || w.definition || '' },
      via: '単語帳',
      src: {
        title: w?.dramaTitle || '',
        season: w?.season ?? null,
        episode: w?.episode ?? null,
        type: !hasEp || isMovieWork(w?.dramaTitle, null, movies) ? 'movie' : 'tv',
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
        type: isMovieWork(o.title, null, movies) || o.season == null ? 'movie' : 'tv',
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
    };
  });

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
// 列: 1=表（単語）2=裏（意味・品詞・出会った場面）3=タグ 4以降=SRS 履歴（「基本」ノートでは
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
      r.title && `<small>出会った場面: ${escHtml(epLabel(r))}</small>`,
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
