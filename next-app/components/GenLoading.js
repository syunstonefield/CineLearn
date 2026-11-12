'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchEpisodeSynopsis } from '@/lib/tmdb';
import { etaText, ETA_SHOW_AFTER_SEC } from '@/lib/genEta';

// 生成中のリッチローディング（案C: ステップ表示つき）。
// 「字幕取得 → 単語分析 → 仕上げ」の工程表示＋ポスター＋あらすじ＋学習Tips。
// スタイルは next-app/app/style.css 末尾の「next-app 独自オーバーライド」ブロック。
const LEARNING_TIPS = [
  '観た翌日に復習すると忘れにくくなります',
  '「わからない」が続いても大丈夫。最適なタイミングで再出題されます',
  '単語の🔊をタップすると発音が聞けます',
  '3週間後も思い出せたら⭐マスターです',
  '連続学習でストリークを伸ばしましょう🔥',
  '📍タイムスタンプはその単語が登場する時間です',
];

const STEPS = ['字幕取得', '単語分析', '仕上げ'];

// 待ち時間の目安の文と秒数は lib/genEta.js（テストできるよう JSX の外に置く）。
export function elapsedLabel(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ステータス文言から進捗バーの下限%を決める（フェーズの目安。既存 genPhaseFloorOf）
function genPhaseFloorOf(status) {
  if (status.includes('仕上げ')) return 90;
  if (status.includes('分析') || status.includes('混雑')) return 30;
  if (status.includes('字幕')) return 8;
  return 5;
}

// ready=true でスピナーを完了表示に替え「リストを見る →」ボタンを出す（自動遷移しない）。
// あらすじ/Tipsを読み終わってから本人のタップで進む＝強制の待ちを増やさずロビー滞在を本人の選択にする。
export default function GenLoading({ status, drama, season, episode, ready = false, onReveal, revealLabel = 'リストを見る →' }) {
  // Tips：ランダム開始で4秒ごとにローテーション
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * LEARNING_TIPS.length));
  const [synopsis, setSynopsis] = useState(null);

  // 進捗バー：実際の進捗は取得できない（AIの1リクエスト待ち）ため、
  // 経過時間で95%まで漸近させる。フェーズ変化で下限を引き上げて段階感を出す。
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0); // 経過秒（目安の表示用）
  const floorRef = useRef(genPhaseFloorOf(status));
  const startedAtRef = useRef(Date.now());

  // あらすじカードが画面外（折り返しの下）にある場合だけ、そっと見える位置までスクロール。
  // block:'nearest' なので既に見えていれば何もしない（保険）。
  const cardRef = useRef(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    floorRef.current = Math.max(floorRef.current, genPhaseFloorOf(status));
  }, [status]);

  useEffect(() => {
    const timer = setInterval(() => {
      const t = (Date.now() - startedAtRef.current) / 1000;
      const floor = floorRef.current;
      setProgress(Math.min(95, floor + (95 - floor) * (1 - Math.exp(-t / 12))));
      setElapsed(t);
    }, 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTipIdx((i) => i + 1), 4000);
    return () => clearInterval(timer);
  }, []);

  // カードが出たら一度だけ、見えていなければ視界内へスクロール
  useEffect(() => {
    if (scrolledRef.current || !cardRef.current) return;
    scrolledRef.current = true;
    cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [synopsis]);

  // あらすじ＋エピソードスチルをAI生成と並行取得して即表示（取得失敗しても生成は止めない）
  useEffect(() => {
    let cancelled = false;
    fetchEpisodeSynopsis(drama, season, episode)
      .then((r) => {
        if (!cancelled && r) setSynopsis(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [drama, season, episode]);

  // 現在の工程を status 文言から判定（字幕→分析→仕上げ）
  const step = status.includes('字幕') ? 0 : status.includes('仕上げ') ? 2 : 1;

  const isMovie = drama?.type === 'movie';
  const heading = isMovie
    ? `${drama?.title || ''} のあらすじ`
    : `${drama?.title || ''} S${season}E${episode} のあらすじ`;
  const dotOn = tipIdx % LEARNING_TIPS.length;

  return (
    <div className="gen-loading">
      {/* ステータス帯：スピナー＋文言＋工程インジケーター */}
      <div className="gen-strip">
        <div className="gen-strip-status">
          {ready ? <span aria-hidden="true">✅</span> : <div className="spinner"></div>}
          <span>{ready ? '準備ができました' : status}</span>
        </div>
        <div className="gen-steps">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={
                'gen-step' + (ready || i < step ? ' gen-step-done' : i === step ? ' gen-step-active' : '')
              }
            >
              {ready || i < step ? '✓ ' : ''}
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* 待ち時間の目安と経過（キャッシュに当たらず長くかかっている時だけ） */}
      {!ready && elapsed >= ETA_SHOW_AFTER_SEC && (
        <div className="gen-eta" aria-live="polite">
          {etaText(isMovie, elapsed)}
          <span className="gen-eta-time">（経過 {elapsedLabel(elapsed)}）</span>
        </div>
      )}

      {/* 進捗バー（経過時間で95%まで漸近。ready で100%＝ボタン待ち） */}
      <div className="gen-progress">
        <div className="gen-progress-fill" style={{ width: ready ? '100%' : `${progress.toFixed(1)}%` }}></div>
      </div>

      {/* 完了 → 自動遷移せず本人のタップで開く（あらすじ/Tipsの読了は本人のペース） */}
      {ready && (
        <button className="gen-reveal-btn" onClick={onReveal}>
          {revealLabel}
        </button>
      )}

      {/* あらすじカード：画像＋本文の横並び。
          ・エピソードスチル／映画のバックドロップ（横長）は 16:9 の枠に（同じ比率＝切り抜きなし）。
          ・それが無くポスター（縦長）しか無い時は、縦の比率のまま小さく出す（16:9 に入れて上下を切らない・法務 2026-11-12）。
          ・画像に文字・印・ぼかしを重ねない。大きさは PC 200px／スマホ 110px が上限。あらすじは TMDB の文をそのまま出す。 */}
      {(synopsis || drama?.posterPath) && (
        <div className="gen-synopsis-card" ref={cardRef}>
          <div className="gen-synopsis-row">
            {synopsis?.still ? (
              <img className="gen-cover-thumb" src={synopsis.still} alt="" />
            ) : drama?.posterPath ? (
              <img className="gen-cover-poster" src={drama.posterPath} alt="" />
            ) : null}
            <div className="gen-synopsis-inner">
              <div className="gen-synopsis-heading">📖 {heading}</div>
              {synopsis?.overview ? (
                <div className="gen-synopsis-body">{synopsis.overview}</div>
              ) : (
                <div className="gen-skeleton">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TMDB の表示（法務の条件 2026-11-12）。画面下の app-tmdb-footer は、スマホでは下のタブバーに隠れて
          待ち画面ではスクロールしないと見えない（本番で確認）。TMDB の画像・あらすじを出している時は、カードの下にも1行出す。 */}
      {(synopsis || drama?.posterPath) && (
        <div className="gen-tmdb-note">
          This product uses the TMDB API but is not endorsed or certified by{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noopener">
            TMDB
          </a>
          .
        </div>
      )}

      {/* 学習Tips：ラベル＋帯＋ローテーションのドット表示。key 再マウントで tipFade を再トリガー */}
      <div className="gen-tipbar">
        <div className="gen-tipbar-main">
          <div className="gen-tipbar-label">💡 英語学習のヒント</div>
          <div key={tipIdx} className="gen-tipbar-text gen-tip-show">
            {LEARNING_TIPS[dotOn]}
          </div>
        </div>
        <div className="gen-tip-dots">
          {LEARNING_TIPS.map((_, i) => (
            <span key={i} className={i === dotOn ? 'on' : ''}></span>
          ))}
        </div>
      </div>
    </div>
  );
}
