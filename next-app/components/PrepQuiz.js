'use client';

import { useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { nextSeat } from '@/lib/prep';

// 予習エンジン「今夜のリハーサル」＝3問固定の recognition クイズ。
// 各問: 実セリフ（drama由来 example）の対象語を空欄にして提示し、
//       3択（正解語＋同リストの別2語）から選ぶクローズ方式。新出語でも文脈で解ける。
// セリフはテキストだけ（声/場面は出さない＝satiation回避・オープンループ保持）。
// AppProvider の open/close で重ねるモーダル。phase には触れない。
export default function PrepQuiz() {
  const { prepQuiz, closePrepQuiz, openPrepLaunch } = useApp();

  const questions = useMemo(() => prepQuiz?.questions || [], [prepQuiz]);
  const meta = prepQuiz?.meta || null;

  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null); // 選んだ語（回答済み判定も兼ねる）
  const [correctCount, setCorrectCount] = useState(0);

  if (!prepQuiz) return null;

  // 出題語が1問も組めなかった場合の保険（VocabScreen 側でも起動を抑止するが念のため）。
  if (!questions.length) {
    return (
      <div className="modal-overlay prep-overlay" style={{ display: 'flex' }} onClick={closePrepQuiz}>
        <div className="modal-panel prep-panel" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <span className="modal-title">🎧 今夜のリハーサル</span>
            <button className="modal-close" onClick={closePrepQuiz}>✕</button>
          </div>
          <div className="prep-content">
            <p className="prep-empty">このエピソードでは出題できるセリフが見つかりませんでした。</p>
            <button className="btn-primary" onClick={closePrepQuiz}>閉じる</button>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[idx];
  const answered = picked != null;
  const isCorrect = answered && picked.toLowerCase() === q.answer.toLowerCase();
  const last = idx >= questions.length - 1;

  const pick = (choice) => {
    if (answered) return;
    setPicked(choice);
    if (choice.toLowerCase() === q.answer.toLowerCase()) setCorrectCount((c) => c + 1);
  };

  const next = () => {
    if (last) {
      // クイズ完了 → quiz バリエの launch ramp へ。出題3語を渡す。
      closePrepQuiz();
      openPrepLaunch({
        variant: 'quiz',
        seat: nextSeat(), // 指定席を1ずつ採番（=観覧通し番号）。ここで一度だけ確定。
        quizWords: questions.map((x) => x.word),
        correct: correctCount, // 正誤は pick 時点で集計済み
        total: questions.length,
        drama: meta?.drama || null,
        title: meta?.title || '',
        season: meta?.season,
        episode: meta?.episode,
        isMovie: meta?.isMovie,
        service: meta?.service || '',
        integrity: meta?.integrity || null,
        freshCount: meta?.freshCount ?? null,
        credit: meta?.credit || '', // 出所明示をチケット裏（今夜聞く3行）へ引き継ぐ
      });
      return;
    }
    setIdx((i) => i + 1);
    setPicked(null);
  };

  // 前向きの一言（やさしく開示・誤答も厳しく罰しない）。
  const verdict = isCorrect
    ? '正解。今夜、これを聞きに行く。'
    : 'これが正解。今夜、耳が拾えたら勝ち。';

  return (
    <div className="modal-overlay prep-overlay" style={{ display: 'flex' }} onClick={closePrepQuiz}>
      <div className="modal-panel prep-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">🎧 今夜のリハーサル</span>
          <button className="modal-close" onClick={closePrepQuiz}>✕</button>
        </div>

        <div className="prep-progress" aria-hidden="true">
          <span
            className="prep-progress-fill"
            style={{ width: `${Math.round(((answered ? idx + 1 : idx) / questions.length) * 100)}%` }}
          />
        </div>

        <div className="prep-content">
          <div className="prep-counter">問 {idx + 1} / {questions.length}</div>
          <div className="prep-q-lead">セリフの空欄に入る単語は？</div>

          {/* クローズ表示：before + ____（回答後は実際の語）+ after */}
          <div className="prep-quote">
            “{q.cloze.blank ? (
              <>
                {q.cloze.before}
                <span className={'prep-blank' + (answered ? ' is-revealed' : '')}>
                  {answered ? q.cloze.blank : '_____'}
                </span>
                {q.cloze.after}
              </>
            ) : (
              // 万一クローズが作れなければ例文をそのまま見せて意味選択に寄せる
              q.example
            )}”
          </div>
          {/* 出所明示（著作権法48条）：出題文は字幕の逐語引用 */}
          {meta?.credit && <div className="prep-ex-src">{meta.credit}</div>}

          <div className="prep-choices">
            {q.choices.map((c) => {
              const correctChoice = c.toLowerCase() === q.answer.toLowerCase();
              const pickedThis = answered && c === picked;
              const cls =
                'prep-choice' +
                (answered && correctChoice ? ' is-correct' : '') +
                (pickedThis && !correctChoice ? ' is-wrong' : '');
              return (
                <button key={c} className={cls} disabled={answered} onClick={() => pick(c)}>
                  {c}
                </button>
              );
            })}
          </div>

          {answered && (
            <div className="prep-feedback">
              <div className={'prep-verdict' + (isCorrect ? ' is-correct' : '')}>{verdict}</div>
              {q.word.definition && <div className="prep-answer-def">{q.word.definition}</div>}
              {q.example_ja && <div className="prep-answer-ja">{q.example_ja}</div>}
              <button className="btn-primary prep-next" onClick={next}>
                {last ? '結果を見る →' : '次へ →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
