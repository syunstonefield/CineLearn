'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchEpisodeSynopsis } from '@/lib/tmdb';

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

// ステータス文言から進捗バーの下限%を決める（フェーズの目安。既存 genPhaseFloorOf）
function genPhaseFloorOf(status) {
  if (status.includes('仕上げ')) return 90;
  if (status.includes('分析') || status.includes('混雑')) return 30;
  if (status.includes('字幕')) return 8;
  return 5;
}

export default function GenLoading({ status, drama, season, episode }) {
  // Tips：ランダム開始で4秒ごとにローテーション
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * LEARNING_TIPS.length));
  const [synopsis, setSynopsis] = useState(null);

  // 進捗バー：実際の進捗は取得できない（AIの1リクエスト待ち）ため、
  // 経過時間で95%まで漸近させる。フェーズ変化で下限を引き上げて段階感を出す。
  const [progress, setProgress] = useState(0);
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
          <div className="spinner"></div>
          <span>{status}</span>
        </div>
        <div className="gen-steps">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={'gen-step' + (i < step ? ' gen-step-done' : i === step ? ' gen-step-active' : '')}
            >
              {i < step ? '✓ ' : ''}
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* 進捗バー（経過時間で95%まで漸近。完了時は画面ごと単語リストに置き換わる） */}
      <div className="gen-progress">
        <div className="gen-progress-fill" style={{ width: `${progress.toFixed(1)}%` }}></div>
      </div>

      {/* あらすじカード：16:9サムネイル（エピソードスチル優先→作品画像）＋本文の横並び。
          画像は比率を保ったまま縮小表示（切り抜きなし）。無ければテキストのみ */}
      {(synopsis || drama?.posterPath) && (
        <div className="gen-synopsis-card" ref={cardRef}>
          <div className="gen-synopsis-row">
            {(synopsis?.still || drama?.posterPath) && (
              <img className="gen-cover-thumb" src={synopsis?.still || drama.posterPath} alt="" />
            )}
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
