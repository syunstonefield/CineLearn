'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { updateHistoryScore, loadHistory, loadSrs } from '@/lib/storage';
import { buildLocalQuiz } from '@/lib/prep';

// 既存 screen-5（renderQuiz / answer / renderScore）の再現。
export default function QuizScreen() {
  const { quizData, setQuizData, quizReturn, currentHistoryId, setScreen, goHome } = useApp();
  // 戻り先は入口によって変わる（単語リスト経由＝'vocab' / 復習ハブ経由＝'review-hub'）。
  const backToHub = quizReturn === 'review-hub';
  const onBack = () => setScreen(backToHub ? 'review-hub' : 'vocab');
  const backLabel = backToHub ? '← 復習に戻る' : '← 単語リストに戻る';

  const [currentQ, setCurrentQ] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState(null); // 選んだ選択肢（回答済み判定も兼ねる）
  const [finished, setFinished] = useState(false);
  const [savedPct, setSavedPct] = useState(null);
  const [failed, setFailed] = useState(false);
  const genIdRef = useRef(null); // 二重生成ガード（生成済み/生成中の historyId）

  // テストを開いた時にクイズをローカルで組む（AI生成はしない・2026-08-07）。
  //   材料（語・実セリフ例文・品詞・レベル）は履歴の words に全部あるので、
  //   穴埋め＋4択はその場で作れる＝APIコスト¥0・待ち時間ゼロ・毎回違う出題。
  //   出題語の優先順（苦手>期日到来>新出）とダミーの選び方は lib/prep.js を参照。
  useEffect(() => {
    if (quizData.length > 0) return;
    if (!currentHistoryId) return;
    if (genIdRef.current === currentHistoryId) return; // この履歴は作問試行済み
    genIdRef.current = currentHistoryId;
    setFailed(false);

    const entry = loadHistory().find((h) => h.id === currentHistoryId);
    const words = entry?.words || [];
    const qd = buildLocalQuiz(words, loadSrs(), { count: 5, choiceCount: 4 });
    if (qd.length) setQuizData(qd);
    else setFailed(true); // 実セリフ例文つきの未習得語が1つも無い＝作問できない
  }, [quizData.length, currentHistoryId, setQuizData]);

  // 全問終了時にスコアを履歴へ保存（1回だけ）
  useEffect(() => {
    if (finished && savedPct === null && quizData.length > 0) {
      const pct = Math.round((score / quizData.length) * 100);
      setSavedPct(pct);
      updateHistoryScore(currentHistoryId, pct);
    }
  }, [finished, savedPct, score, quizData.length, currentHistoryId]);

  const restart = () => {
    setCurrentQ(0);
    setScore(0);
    setPicked(null);
    setFinished(false);
    setSavedPct(null);
  };

  // ── 準備中 / 失敗 ──
  if (quizData.length === 0) {
    return (
      <div className="screen active" id="screen-5">
        <div className="screen-inner">
          <QuizHeader onBack={onBack} label={backLabel} />
          <div id="quizSection">
            {failed ? (
              // 作問には「実セリフ例文つきの未習得語」が要る。全語マスター済み or
              // 例文が付いていない古いリストだと1問も作れない（AI不使用のため生成失敗は起きない）。
              <div className="empty-state">
                出題できる単語がありません。
                <br />
                このエピソードの単語はすべて習得済みか、例文が付いていません。
                <br />
                <br />
                {backToHub ? '復習' : '単語リスト'}に戻って別のエピソードを選んでください。
              </div>
            ) : (
              <div className="loading">
                <div className="spinner"></div>クイズを準備中...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── スコア表示 ──
  if (finished) {
    const pct = savedPct ?? Math.round((score / quizData.length) * 100);
    const comment =
      pct >= 80
        ? '素晴らしい！視聴準備完了です。ドラマを楽しんでください。'
        : pct >= 60
        ? 'よくできました。視聴しながら復習しましょう。'
        : '単語をもう一度確認してから視聴しましょう。';
    return (
      <div className="screen active" id="screen-5">
        <div className="screen-inner">
          <QuizHeader onBack={onBack} label={backLabel} />
          <div id="quizSection">
            <div className="quiz-card">
              <div className="score-display">
                <span className="score-num">{pct}%</span>
                <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8 }}>
                  {score} / {quizData.length} 正解
                </div>
                <div className="score-comment">{comment}</div>
              </div>
              <button className="btn-primary" style={{ marginTop: 20 }} onClick={restart}>
                もう一度挑戦する
              </button>
              <button className="btn-secondary" style={{ marginTop: 8 }} onClick={goHome}>
                ← マイドラマへ
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 出題 ──
  const q = quizData[currentQ];
  const answered = picked !== null;
  const onAnswer = (choice) => {
    if (answered) return;
    setPicked(choice);
    if (choice === q.answer) setScore((s) => s + 1);
  };
  const onNext = () => {
    setPicked(null);
    if (currentQ + 1 >= quizData.length) setFinished(true);
    else setCurrentQ((i) => i + 1);
  };

  // 穴埋め（____あり）と意味当て（「word」の意味は？）の2形式が混在する。
  // 後者に空欄を描くと文が壊れるので、____ を含むときだけ blank を挿す。
  const parts = q.question.split('____');
  const isCloze = parts.length > 1;

  return (
    <div className="screen active" id="screen-5">
      <div className="screen-inner">
        <QuizHeader onBack={onBack} label={backLabel} />
        <div id="quizSection">
          <div className="quiz-card">
            <div className="quiz-q">
              {isCloze ? (
                <>
                  {parts[0]}
                  <span className="quiz-blank">____</span>
                  {parts.slice(1).join('____')}
                </>
              ) : (
                q.question
              )}
            </div>
            <div className="quiz-choices">
              {q.choices.map((c, i) => {
                let cls = 'choice-btn';
                if (answered) {
                  if (c === q.answer) cls += ' correct';
                  else if (c === picked) cls += ' wrong';
                }
                return (
                  <button key={`${c}-${i}`} className={cls} disabled={answered} onClick={() => onAnswer(c)}>
                    {c}
                  </button>
                );
              })}
            </div>
            <div className="quiz-nav">
              <span className="quiz-progress">
                {currentQ + 1} / {quizData.length}
              </span>
              {answered && (
                <button className="btn-next" onClick={onNext}>
                  {currentQ + 1 >= quizData.length ? '結果を見る →' : '次の問題 →'}
                </button>
              )}
            </div>
            {answered && (
              <div className="explanation-box" style={{ display: 'block', whiteSpace: 'pre-line' }}>
                {q.explanation}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizHeader({ onBack, label }) {
  return (
    <div className="screen-header">
      <button className="btn-back" onClick={onBack}>
        {label || '← 単語リストに戻る'}
      </button>
      <div>
        <div className="screen-title">視聴後クイズ</div>
        <div className="screen-desc">理解度と語彙を確認するクイズ</div>
      </div>
    </div>
  );
}
