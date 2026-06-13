'use client';

import { useState } from 'react';
import { useApp } from './AppProvider';
import { getToeicLevel, getVocabCount } from '@/lib/vocab';

// 既存 screen-onboarding（新規プロフィール初期設定）の再現。
// Step1: TOEICスコア（スキップ可）→ Step2: 利用サービス選択 → 完了でドラマ検索へ。
const LEVEL_LABELS = { A2: 'A2（初級）', B1: 'B1（中級）', B2: 'B2（中上級）', C1: 'C1（上級）' };

const TOEIC_ROWS = [
  { score: 300, range: '〜 400点', level: 'A2', name: 'A2 初級', desc: '基本的な表現は理解できる' },
  { score: 550, range: '400〜 600点', level: 'B1', name: 'B1 中級', desc: '日常会話は概ね理解できる' },
  { score: 750, range: '600〜 800点', level: 'B2', name: 'B2 中上級', desc: '複雑な内容も理解できる' },
  { score: 900, range: '800点〜', level: 'C1', name: 'C1 上級', desc: '幅広いトピックを理解できる' },
];

const SERVICES = ['Netflix', 'Amazon Prime', 'Disney+', 'Apple TV+', 'Hulu', 'U-NEXT', 'YouTube'];

export default function Onboarding() {
  const { finishOnboarding } = useApp();

  const [step, setStep] = useState(1);
  const [scoreText, setScoreText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [services, setServices] = useState([]);

  const score = parseInt(scoreText);
  const scoreValid = score >= 10 && score <= 990;
  const level = scoreValid ? getToeicLevel(score) : null;

  const toggleService = (name) => {
    setServices((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  };

  const done = () => {
    // スコア反映（finishOnboarding 相当）。スキップ時はスコアなし。
    const patch = { selectedServices: services };
    if (scoreValid) {
      patch.toeicScore = score;
      patch.userLevel = getToeicLevel(score);
      const target = parseInt(targetText);
      if (target >= score && target <= 990) {
        patch.targetToeicScore = target;
        patch.targetLevel = getToeicLevel(target);
        patch.vocabCount = getVocabCount(target);
      }
    }
    finishOnboarding(patch);
  };

  return (
    <div className="screen active" id="screen-onboarding">
      <div className="screen-inner" style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 80px' }}>
        {/* ステップインジケーター */}
        <div className="onboarding-steps">
          <div className={'onboarding-step' + (step === 1 ? ' active' : '')}></div>
          <div className={'onboarding-step' + (step === 2 ? ' active' : '')}></div>
        </div>

        {step === 1 ? (
          <div id="ob-step-1">
            <h2 className="onboarding-title">あなたの英語レベルを教えてください</h2>
            <p className="onboarding-desc">TOEICスコアを入力すると、あなたに最適な単語が選ばれます</p>
            <div className="toeic-wrap">
              <div className="toeic-input-row">
                <input
                  type="number"
                  className="toeic-input"
                  placeholder="例：650"
                  min="10"
                  max="990"
                  value={scoreText}
                  onChange={(e) => setScoreText(e.target.value)}
                />
                <span className="toeic-unit">点</span>
              </div>
              <div className="toeic-hint">TOEICを受けたことがない場合は目安で入力してください</div>
              <div className="toeic-levels">
                {TOEIC_ROWS.map((r) => (
                  <div key={r.score} className="toeic-level-row" onClick={() => setScoreText(String(r.score))}>
                    <div className="toeic-range">{r.range}</div>
                    <div className="toeic-level-info">
                      <span className={`level-pill level-${r.level}`}>{r.name}</span>
                      <span className="toeic-level-desc">{r.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
              {scoreValid && (
                <div className="level-result" style={{ display: 'flex' }}>
                  <span className="level-result-label">判定レベル：</span>
                  <span className="level-result-value">{LEVEL_LABELS[level]}</span>
                </div>
              )}
              {scoreValid && (
                <div style={{ marginTop: 16 }}>
                  <div className="target-label">
                    目標TOEICスコア <span className="target-optional">（任意）</span>
                  </div>
                  <div className="toeic-input-row">
                    <input
                      type="number"
                      className="toeic-input"
                      placeholder="例：730"
                      min="10"
                      max="990"
                      value={targetText}
                      onChange={(e) => setTargetText(e.target.value)}
                    />
                    <span className="toeic-unit">点（目標）</span>
                  </div>
                </div>
              )}
            </div>
            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: 28 }}
              disabled={!scoreValid}
              onClick={() => setStep(2)}
            >
              次へ →
            </button>
            <button
              className="btn-text-link"
              style={{ width: '100%', marginTop: 12, textAlign: 'center' }}
              onClick={() => setStep(2)}
            >
              スキップ
            </button>
          </div>
        ) : (
          <div id="ob-step-2">
            <h2 className="onboarding-title">利用している動画サービスを選んでください</h2>
            <p className="onboarding-desc">複数選択できます</p>
            <div className="service-grid" style={{ marginTop: 20 }}>
              {SERVICES.map((name) => (
                <div
                  key={name}
                  className={'service-card' + (services.includes(name) ? ' selected' : '')}
                  onClick={() => toggleService(name)}
                >
                  <div className="service-name">{name}</div>
                  <div className="service-check">✓</div>
                </div>
              ))}
            </div>
            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: 28 }}
              disabled={services.length === 0}
              onClick={done}
            >
              はじめる 🎬
            </button>
            <button
              className="btn-text-link"
              style={{ width: '100%', marginTop: 12, textAlign: 'center' }}
              onClick={() => setStep(1)}
            >
              ← 戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
