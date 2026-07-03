'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { updateHistoryScore, updateHistoryQuizData, loadHistory } from '@/lib/storage';
import { generateQuiz } from '@/lib/vocab';

// 既存 screen-5（renderQuiz / answer / renderScore）の再現。
export default function QuizScreen() {
  const { quizData, setQuizData, currentHistoryId, drama, season, episode, settings, setScreen, goHome } = useApp();

  const [currentQ, setCurrentQ] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState(null); // 選んだ選択肢（回答済み判定も兼ねる）
  const [finished, setFinished] = useState(false);
  const [savedPct, setSavedPct] = useState(null);
  const [failed, setFailed] = useState(false);
  const genIdRef = useRef(null); // 二重生成ガード（生成済み/生成中の historyId）

  // テストを開いた時にクイズを遅延生成する（事前生成はしない）。
  // 既に quizData がある（保存済み or 生成済み）場合は何もしない。
  useEffect(() => {
    if (quizData.length > 0) return;
    if (!currentHistoryId) return;
    if (genIdRef.current === currentHistoryId) return; // この履歴は生成試行済み
    genIdRef.current = currentHistoryId;
    setFailed(false);

    const entry = loadHistory().find((h) => h.id === currentHistoryId);
    const words = entry?.words || [];
    if (!words.length) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    generateQuiz(drama, words, season, episode, settings.testTiers || ['core', 'advanced']).then(
      ({ quizData: qd, rawQuiz }) => {
        if (cancelled) return;
        if (rawQuiz.length) {
          updateHistoryQuizData(currentHistoryId, rawQuiz);
          setQuizData(qd);
        } else {
          setFailed(true);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [quizData.length, currentHistoryId, drama, season, episode, settings, setQuizData]);

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
          <QuizHeader onBack={() => setScreen('vocab')} />
          <div id="quizSection">
            {failed ? (
              <div className="empty-state" style={{ color: 'var(--red)' }}>
                クイズの生成に失敗しました。単語リストに戻って再試行してください。
              </div>
            ) : (
              <div className="loading">
                <div className="spinner"></div>クイズを生成中...
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
          <QuizHeader onBack={() => setScreen('vocab')} />
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

  const parts = q.question.split('____');

  return (
    <div className="screen active" id="screen-5">
      <div className="screen-inner">
        <QuizHeader onBack={() => setScreen('vocab')} />
        <div id="quizSection">
          <div className="quiz-card">
            <div className="quiz-q">
              {parts[0]}
              <span className="quiz-blank">____</span>
              {parts.slice(1).join('____')}
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
              <div className="explanation-box" style={{ display: 'block' }}>
                {q.explanation}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizHeader({ onBack }) {
  return (
    <div className="screen-header">
      <button className="btn-back" onClick={onBack}>
        ← 単語リストに戻る
      </button>
      <div>
        <div className="screen-title">視聴後クイズ</div>
        <div className="screen-desc">理解度と語彙を確認するクイズ</div>
      </div>
    </div>
  );
}
