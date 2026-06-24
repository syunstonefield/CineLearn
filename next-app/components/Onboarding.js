'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { getToeicLevel, getVocabCount } from '@/lib/vocab';
import { GENRES } from '@/lib/recommend';

// 初回ログイン時の6問オンボーディング（→「作成中」演出→プラン提示→予習へ）。
// Duolingo参照：上部に戻る＋進捗バー、画面高さ固定（内容スクロール）、下部固定の「次へ」。
// 完了で全回答を settings に保存し onboarded:true を立てる（AppProvider.finishOnboarding）。
const LEVEL_LABELS = { A2: 'A2（初級）', B1: 'B1（中級）', B2: 'B2（中上級）', C1: 'C1（上級）' };
const TOEIC_ROWS = [
  { score: 300, range: '〜 400点', level: 'A2', name: 'A2 初級' },
  { score: 550, range: '400〜 600点', level: 'B1', name: 'B1 中級' },
  { score: 750, range: '600〜 800点', level: 'B2', name: 'B2 中上級' },
  { score: 900, range: '800点〜', level: 'C1', name: 'C1 上級' },
];
const SERVICES = ['Netflix', 'Amazon Prime', 'Disney+', 'Apple TV+', 'Hulu', 'U-NEXT', 'YouTube'];
const PURPOSES = [
  { v: 'subtitles', icon: '🎬', label: '字幕なしで観られるようになりたい' },
  { v: 'travel', icon: '✈️', label: '旅行・日常会話で使いたい' },
  { v: 'work', icon: '💼', label: '仕事で使いたい' },
  { v: 'exam', icon: '📝', label: '試験（TOEIC等）の対策' },
  { v: 'hobby', icon: '🎉', label: '趣味として楽しく続けたい' },
];
const STYLES = [
  { v: 'fun', icon: '🎬', label: '楽しく学ぶ', desc: 'ドラマの世界に浸りながら' },
  { v: 'efficient', icon: '⚡', label: '効率的に学ぶ', desc: 'サクサク最短で予習' },
];
// 流入元（どこでCineLearnを知ったか）＝マーケ参考。単一選択。
const REFERRALS = [
  { v: 'sns', label: 'X（Twitter）・Instagram などSNS' },
  { v: 'youtube', label: 'YouTube' },
  { v: 'search', label: 'Google などの検索' },
  { v: 'friend', label: '友人・知人のすすめ' },
  { v: 'news', label: 'ニュース・ブログ・記事' },
  { v: 'appstore', label: 'アプリストア' },
  { v: 'tv', label: 'テレビ' },
  { v: 'other', label: 'その他' },
];
const TOTAL = 6;

export default function Onboarding() {
  const { finishOnboarding } = useApp();

  const [step, setStep] = useState(1);
  const [phase, setPhase] = useState('survey'); // survey | building | plan
  const [scoreText, setScoreText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [services, setServices] = useState([]);
  const [genres, setGenres] = useState([]);
  const [goals, setGoals] = useState([]);
  const [style, setStyle] = useState(null);
  const [referral, setReferral] = useState(null); // どこで知ったか（単一選択）

  const score = parseInt(scoreText);
  const scoreValid = score >= 10 && score <= 990;
  const userLevel = scoreValid ? getToeicLevel(score) : 'B1';

  const toggle = (setter) => (name) =>
    setter((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  const toggleService = toggle(setServices);
  const toggleGenre = toggle(setGenres);
  const toggleGoal = toggle(setGoals);

  useEffect(() => {
    if (phase !== 'building') return;
    const t = setTimeout(() => setPhase('plan'), 2300);
    return () => clearTimeout(t);
  }, [phase]);

  const canNext =
    step === 2 ? services.length > 0 : step === 4 ? goals.length > 0 : step === 5 ? !!style : step === 6 ? !!referral : true;
  const back = () => step > 1 && setStep(step - 1);
  const next = () => (step < TOTAL ? setStep(step + 1) : setPhase('building'));

  const done = () => {
    const patch = {
      selectedServices: services,
      selectedGenres: genres.length ? genres : ['Crime Thriller'],
      learningGoal: goals,
      learnStyle: style,
      referralSource: referral,
    };
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

  // ── 「作成中」演出（Duolingoの「コースの準備中…」風） ──
  if (phase === 'building') {
    return (
      <div className="screen active ob-screen" id="screen-onboarding">
        <div className="ob-building">
          <div className="spinner" />
          <div className="ob-building-title">あなた専用の予習プランを作成中…</div>
          <div className="ob-building-line">回答をもとに最適化しています</div>
          <div className="ob-building-line">{LEVEL_LABELS[userLevel]}向けの重要単語を準備中</div>
        </div>
      </div>
    );
  }

  // ── プラン提示（プロフィール要約→ホームのおすすめへ） ──
  if (phase === 'plan') {
    const goalLabel =
      goals.length > 0
        ? `${PURPOSES.find((p) => p.v === goals[0])?.label || ''}${goals.length > 1 ? ` 他${goals.length - 1}件` : ''}`
        : '—';
    return (
      <div className="screen active ob-screen" id="screen-onboarding">
        <div className="ob-content">
          <div className="ob-plan">
            <div className="ob-plan-badge">🎬 あなたの予習プラン</div>
            <h2 className="ob-plan-title">準備ができました</h2>
            <div className="ob-plan-rows">
              <div className="ob-plan-row">
                <span className="ob-plan-k">レベル</span>
                <span className="ob-plan-v">{LEVEL_LABELS[userLevel]}</span>
              </div>
              <div className="ob-plan-row">
                <span className="ob-plan-k">学習スタイル</span>
                <span className="ob-plan-v">{STYLES.find((s) => s.v === style)?.label || '—'}</span>
              </div>
              <div className="ob-plan-row">
                <span className="ob-plan-k">目的</span>
                <span className="ob-plan-v">{goalLabel}</span>
              </div>
            </div>
            <p className="ob-plan-lead">
              あなたのレベル・好みに合わせたおすすめ作品を用意しました。ホームから1本選んで、観る前に重要単語を予習しましょう。
            </p>
          </div>
        </div>
        <div className="ob-footer">
          <button className="btn-primary" style={{ width: '100%' }} onClick={done}>
            おすすめから始める →
          </button>
        </div>
      </div>
    );
  }

  // ── アンケート本体（高さ固定：上バー / 中スクロール / 下固定ボタン） ──
  return (
    <div className="screen active ob-screen" id="screen-onboarding">
      {/* 上部：戻る＋進捗バー */}
      <div className="ob-bar">
        <button className="ob-back" onClick={back} disabled={step === 1} aria-label="前へ戻る">
          ←
        </button>
        <div className="ob-progress">
          <span className="ob-progress-fill" style={{ width: `${(step / TOTAL) * 100}%` }} />
        </div>
      </div>

      {/* 中央：スクロール領域 */}
      <div className="ob-content">
        {step === 1 && (
          <div>
            <h2 className="onboarding-title">いまの英語レベルは？</h2>
            <p className="onboarding-desc">TOEICの目安を入れると、あなたに最適な単語が選ばれます（スキップ可）</p>
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
              <div className="toeic-levels">
                {TOEIC_ROWS.map((r) => (
                  <div key={r.score} className="toeic-level-row" onClick={() => setScoreText(String(r.score))}>
                    <div className="toeic-range">{r.range}</div>
                    <div className="toeic-level-info">
                      <span className={`level-pill level-${r.level}`}>{r.name}</span>
                    </div>
                  </div>
                ))}
              </div>
              {scoreValid && (
                <div style={{ marginTop: 14 }}>
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
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="onboarding-title">使っている動画サービスは？</h2>
            <p className="onboarding-desc">複数選べます</p>
            <div className="service-grid" style={{ marginTop: 18 }}>
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
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="onboarding-title">好きなジャンルは？</h2>
            <p className="onboarding-desc">おすすめ作品の精度が上がります（複数可・スキップ可）</p>
            <div className="ob-rows">
              {GENRES.map((g) => (
                <button
                  key={g.genre}
                  type="button"
                  className={'ob-row' + (genres.includes(g.genre) ? ' selected' : '')}
                  onClick={() => toggleGenre(g.genre)}
                >
                  <span className="ob-row-label">{g.label}</span>
                  <span className="ob-row-check" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="onboarding-title">英語を学ぶ目的は？</h2>
            <p className="onboarding-desc">近いものを選んでください（複数可）</p>
            <div className="ob-rows">
              {PURPOSES.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  className={'ob-row' + (goals.includes(p.v) ? ' selected' : '')}
                  onClick={() => toggleGoal(p.v)}
                >
                  <span className="ob-row-icon" aria-hidden="true">{p.icon}</span>
                  <span className="ob-row-label">{p.label}</span>
                  <span className="ob-row-check" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="onboarding-title">どんなふうに学びたい？</h2>
            <p className="onboarding-desc">あとから設定で変えられます</p>
            <div className="ob-style-grid">
              {STYLES.map((s) => (
                <button
                  key={s.v}
                  type="button"
                  className={'ob-style-card' + (style === s.v ? ' selected' : '')}
                  onClick={() => setStyle(s.v)}
                >
                  <span className="ob-style-icon" aria-hidden="true">{s.icon}</span>
                  <span className="ob-style-label">{s.label}</span>
                  <span className="ob-style-desc">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 6 && (
          <div>
            <h2 className="onboarding-title">CineLearnをどこで知りましたか？</h2>
            <p className="onboarding-desc">今後の参考にさせてください</p>
            <div className="ob-rows">
              {REFERRALS.map((r) => (
                <button
                  key={r.v}
                  type="button"
                  className={'ob-row' + (referral === r.v ? ' selected' : '')}
                  onClick={() => setReferral(referral === r.v ? null : r.v)}
                >
                  <span className="ob-row-label">{r.label}</span>
                  <span className="ob-row-check" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 利用目的の注記（個人情報の通知） */}
        <p className="ob-note">
          回答は学習プランの作成とサービス改善に利用します。
          <a href="/privacy" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>
        </p>
      </div>

      {/* 下部固定：次へ（戻るは上部バー、スキップは任意ステップのみ） */}
      <div className="ob-footer">
        <button className="btn-primary" style={{ width: '100%' }} disabled={!canNext} onClick={next}>
          {step === TOTAL ? 'プランを作成 →' : '次へ →'}
        </button>
        {(step === 1 || step === 3 || step === 6) && (
          <button className="ob-skip" onClick={next}>スキップ</button>
        )}
      </div>
    </div>
  );
}
