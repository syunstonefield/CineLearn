'use client';

import { IconCheck } from './icons/LineIcons';
import { MASTERED_LABEL, MASTERED_MEANING } from '@/lib/learnedTerms';
import { useEffect, useRef, useState } from 'react';
import { useScreenFit } from '@/lib/screenFit';
import { etaText, ETA_SHOW_AFTER_SEC } from '@/lib/genEta';

// 生成中のリッチローディング（案B・2026-11-15: 1ページに収める）。
// 「字幕取得 → 単語分析 → 仕上げ」の進み具合＋作品の小さなカード＋学習Tips。
// スタイルは next-app/app/style.css 末尾の「next-app 独自オーバーライド」ブロック。
// 豆知識（2026-11-13 オーナー決定）: 効果の言い切りはしない（事実だけ・紹介ページの法務の線と同じ）／
//   ボタンの言葉は今の画面どおり（知らなかった）／文の中に絵文字を入れない。マスターの意味は lib/learnedTerms.js の文。
const LEARNING_TIPS = [
  '答えた単語は、次の日から復習のカードに出てきます',
  '「知らなかった」と答えた単語は、次の日の復習にまた出てきます',
  '単語の横の音のボタンを押すと、発音が聞けます',
  `${MASTERED_LABEL}は、${MASTERED_MEANING}です`,
  '学習した日と覚えた単語は、あゆみで見返せます',
  '単語の横の時刻は、その単語が出てくる場面の時間です',
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

// ready=true でスピナーを完了表示に替え、線の場所に「リストを見る →」ボタンを出す（自動遷移しない）。
// あらすじ/Tipsを読み終わってから本人のタップで進む＝強制の待ちを増やさずロビー滞在を本人の選択にする。
// 案B（オーナー決定 2026-11-15）。並びは上から 進み具合 → 作品（ポスター・作品名・話数の小さなカード）→ ヒント → TMDB の1行。
//   あらすじは出さない（2026-11-15 オーナー決定・観る前のネタバレを避ける）＝TMDB へあらすじを聞きに行かない。
//   1ページに収める＝ヘッダーと下のタブのあいだに固定（lib/screenFit.js・html.cl-screen-fit）。低い窓（420px 未満）では中だけスクロールし、TMDB の1行は下に貼りつく。
//   中身の高さは最初から決まっている＝何も動かない。上から詰めて並べ、進み具合とヒントを主役にする。
//   目安の文・経過の場所は最初から空けておく（出た時に何も押し下げない）。できたらボタンは線と同じ場所に出る。
export default function GenLoading({ status, drama, season, episode, ready = false, onReveal, revealLabel = 'リストを見る →' }) {
  // Tips：ランダム開始で4秒ごとにローテーション
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * LEARNING_TIPS.length));

  // 進捗バー：実際の進捗は取得できない（AIの1リクエスト待ち）ため、
  // 経過時間で95%まで漸近させる。フェーズ変化で下限を引き上げて段階感を出す。
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0); // 経過秒（目安の表示用）
  const floorRef = useRef(genPhaseFloorOf(status));
  const startedAtRef = useRef(Date.now());


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

  // 1ページに収める（ヘッダーと下のタブのあいだに固定・中身が収まる時は動かない・入り切らない時は中だけスクロール）
  useScreenFit();

  // 現在の工程を status 文言から判定（字幕→分析→仕上げ）
  const step = status.includes('字幕') ? 0 : status.includes('仕上げ') ? 2 : 1;

  const isMovie = drama?.type === 'movie';
  const epLabel = isMovie ? '映画' : `シーズン${season} 第${episode}話`;
  const dotOn = tipIdx % LEARNING_TIPS.length;
  const showEta = !ready && elapsed >= ETA_SHOW_AFTER_SEC;
  // TMDB の画像・あらすじを出している時だけ TMDB の1行を出す（法務 2026-11-12）
  // TMDB の画像（ポスター）を出している時だけ TMDB の1行を出す（法務 2026-11-12）。ポスターの有無は最初から分かる＝途中で出たり消えたりしない
  const usesTmdb = !!drama?.posterPath;

  return (
    <div className="gen-loading gen-b gen-b-fit">
      {/* 進み具合：3つの段（点と線）・今の文と経過・線（できたらボタン）・目安の文。高さは決まっていて、文が出ても動かない */}
      <div className="gen-b-prog">
        <ol className="gen-b-steps" aria-label="進み具合">
          {STEPS.map((s, i) => {
            const done = ready || i < step;
            const on = !ready && i === step;
            return (
              <li
                key={s}
                className={'gen-b-step' + (done ? ' is-done' : on ? ' is-on' : '')}
                aria-current={on ? 'step' : undefined}
              >
                {i > 0 && <span className={'gen-b-line' + (done || on ? ' is-done' : '')} aria-hidden="true" />}
                <span className="gen-b-dot" aria-hidden="true" />
                {s}
              </li>
            );
          })}
        </ol>
        <div className="gen-b-slot">
          {ready ? (
            <button className="gen-reveal-btn" onClick={onReveal}>
              {revealLabel}
            </button>
          ) : (
            <>
              <div className="gen-b-status">
                <div className="spinner"></div>
                <span className="gen-b-status-text">{status}</span>
                {showEta && <span className="gen-eta-time">経過 {elapsedLabel(elapsed)}</span>}
              </div>
              <div className="gen-progress">
                <div className="gen-progress-fill" style={{ width: `${progress.toFixed(1)}%` }}></div>
              </div>
            </>
          )}
        </div>
        <div className="gen-eta" aria-live="polite">
          {ready ? (
            <span className="gen-b-ready">
              <IconCheck /> 準備ができました
            </span>
          ) : showEta ? (
            etaText(isMovie, elapsed)
          ) : null}
        </div>
      </div>

      {/* 作品の小さなカード：ポスター＋作品名＋話数（2026-11-15 オーナー決定: あらすじは出さない＝観る前のネタバレを避ける）。
          画像は作品のポスターだけ（その話の場面の写真もネタバレになり得るので使わない）。縦のまま・切り抜かない・何も重ねない・
          スマホ56px／PC72px（上限 110／200 より小さく）。ポスターが無い作品は文字だけ。 */}
      <div className="gen-b-work">
        <div className="gen-b-head">
          {drama?.posterPath ? <img className="gen-cover-poster" src={drama.posterPath} alt="" /> : null}
          <div className="gen-b-headtext">
            <h2 className="gen-b-title">{drama?.title || ''}</h2>
            <div className="gen-b-ep">{epLabel}</div>
          </div>
        </div>
      </div>

      {/* 学習Tips：ラベル＋帯＋ローテーションのドット表示。key 再マウントで tipFade を再トリガー。高さは2行分で決まっている */}
      <div className="gen-tipbar">
        <div className="gen-tipbar-main">
          <div className="gen-tipbar-label">英語学習のヒント</div>
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
      {/* TMDB の表示（法務の条件 2026-11-12）。画面下の app-tmdb-footer は待ち画面の間は隠すので、ここに必ず出す。
          いちばん下（ヒントの下）でも、1ページに収めているので必ず画面の中に見える（2026-11-15 並びの変更） */}
      {usesTmdb && (
        <div className="gen-tmdb-note">
          This product uses the TMDB API but is not endorsed or certified by{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noopener">
            TMDB
          </a>
          .
        </div>
      )}
    </div>
  );
}
