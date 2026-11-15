'use client';

import { IconCheck } from './icons/LineIcons';
import { MASTERED_LABEL, MASTERED_MEANING } from '@/lib/learnedTerms';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchEpisodeSynopsis } from '@/lib/tmdb';
import { etaText, ETA_SHOW_AFTER_SEC } from '@/lib/genEta';

// 生成中のリッチローディング（案B・2026-11-15: 1ページに収める）。
// 上に作品とあらすじ、下に「字幕取得 → 単語分析 → 仕上げ」の進み具合＋学習Tips。
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

// 1ページに収める時の下限（これより低い窓＝横向きのスマホ・小さな PC の窓では、ふつうにページをスクロールさせる）
const FIT_MIN_PX = 420;

// ready=true でスピナーを完了表示に替え、線の場所に「リストを見る →」ボタンを出す（自動遷移しない）。
// あらすじ/Tipsを読み終わってから本人のタップで進む＝強制の待ちを増やさずロビー滞在を本人の選択にする。
// 案B（オーナー決定 2026-11-15）: 上に作品（写真・作品名・話数）とあらすじ、下に進み具合とヒント。
//   1ページに収める＝ページの高さを画面の高さに合わせ、ページは動かさない（html.cl-gen-lock）。
//   下の進み具合とヒントは画面の下に置いたまま動かない。あらすじが長い時はカードの中だけがスクロールする。
//   目安の文・経過の場所は最初から空けておく（出た時に何も押し下げない）。できたらボタンは線と同じ場所に出る。
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

  // 1ページに収める高さ（px）。null＝収めない（低い窓）
  const rootRef = useRef(null);
  const [fitH, setFitH] = useState(null);

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

  // 画面の高さに合わせる。ページの一番上から始め、ページ全体の高さ（scrollHeight）＝画面の高さになるよう
  // この画面の高さを決める（下のタブ・余白・ヘッダーの高さは端末ごとに違うので、実際の値で合わせる）。
  useLayoutEffect(() => {
    const root = document.documentElement;
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      root.classList.add('cl-gen-lock');
      window.scrollTo(0, 0);
      const top = el.getBoundingClientRect().top;
      const nav = document.querySelector('.bottom-nav');
      const navH = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
      let h = Math.floor(window.innerHeight - top - navH - 12);
      if (h < FIT_MIN_PX) {
        root.classList.remove('cl-gen-lock');
        el.style.height = '';
        setFitH(null);
        return;
      }
      el.style.height = `${h}px`;
      // 余白などでまだ画面より高い／低い分を、実際の高さで1回だけ直す
      const diff = root.scrollHeight - window.innerHeight;
      if (diff !== 0) {
        h -= diff;
        el.style.height = `${h}px`;
      }
      setFitH(h);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      root.classList.remove('cl-gen-lock');
    };
  }, []);

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
  const epLabel = isMovie ? '映画' : `シーズン${season} 第${episode}話`;
  const dotOn = tipIdx % LEARNING_TIPS.length;
  const showEta = !ready && elapsed >= ETA_SHOW_AFTER_SEC;
  // TMDB の画像・あらすじを出している時だけ TMDB の1行を出す（法務 2026-11-12）
  const usesTmdb = !!(synopsis || drama?.posterPath);

  return (
    <div className={'gen-loading gen-b' + (fitH ? ' gen-b-fit' : '')} ref={rootRef}>
      <div className="gen-b-top">
        {/* 作品のカード：写真＋作品名＋話数、その下にあらすじ。
            ・エピソードスチル／映画のバックドロップ（横長）は 16:9 の枠に（同じ比率＝切り抜きなし）。
            ・それが無くポスター（縦長）しか無い時は、縦の比率のまま小さく出す（16:9 に入れて上下を切らない・法務 2026-11-12）。
            ・どちらも無い時は文字だけ。画像に文字・印・ぼかしを重ねない。大きさは PC 200px／スマホ 110px が上限。
            ・あらすじは TMDB の文をそのまま出す（長い時はカードの中だけスクロール＝全文がそのまま読める）。 */}
        <div className="gen-b-work">
          <div className="gen-b-head">
            {synopsis?.still ? (
              <img className="gen-cover-thumb" src={synopsis.still} alt="" />
            ) : drama?.posterPath ? (
              <img className="gen-cover-poster" src={drama.posterPath} alt="" />
            ) : null}
            <div className="gen-b-headtext">
              <h2 className="gen-b-title">{drama?.title || ''}</h2>
              <div className="gen-b-ep">{epLabel}</div>
            </div>
          </div>
          {synopsis?.overview ? (
            <div className="gen-b-syn" tabIndex={0} aria-label="あらすじ">
              {synopsis.overview}
            </div>
          ) : !synopsis && drama?.tmdbId ? (
            <div className="gen-b-syn gen-skeleton" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
          ) : null}
        </div>

        {/* TMDB の表示（法務の条件 2026-11-12）。画面下の app-tmdb-footer は待ち画面の間は隠すので、ここに必ず出す */}
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
    </div>
  );
}
