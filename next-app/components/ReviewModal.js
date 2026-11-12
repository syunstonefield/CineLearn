'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { aiExampleOf, isOtherSceneExample } from '@/lib/exampleBackfill';
import { useApp } from './AppProvider';
import { surfaceFormInExample } from '@/lib/subtitles';
import { speak } from '@/lib/speak';
import { chunkParts } from '@/lib/chunk';
import {
  loadSrs,
  isDue,
  isLearned,
  isMastered,
  reviewWord,
  restoreSrsEntry,
  subtitleCredit,
  loadHistory,
  activeWordKeys,
  getAgainWords,
} from '@/lib/storage';
import { AGAIN_BATCH } from '@/lib/againWords';
import { shouldShowBreak } from '@/lib/reviewBreak';
import { addExp, levelInfo, expForReviewSession } from '@/lib/exp';
import { awardReviewSession } from '@/lib/reviewAward';
import ExpBlock from './ExpBlock';
import ReviewCinemaCard, { CinemaProgress } from './ReviewCinemaCard';
import WordMarks from './WordMarks';
import { getActiveWords, starWord, unstarWord, likeWord, sameWorkTitle } from '@/lib/words';
import { entryFromCard, sceneOf } from '@/lib/wordMarks';
import { canLikeMore, LIKE_CAP_PER_EPISODE } from '@/lib/liked';
import { trackUsage } from '@/lib/usage';
import { exitEventName, toDecile, reviewTimeEvent } from '@/lib/usageEvents';

const KEYS_SEEN_KEY = 'cl_review_keys_seen';

// 操作ヘルプ（初回に一度だけ自動表示・以後は右上の「?」）。
// 使い方ガイド（WelcomeTutorial）と同じスライド型モーダルにする（オーナー要望 2026-09-29）。
// PC＝キーボード、スマホ＝タップ/スワイプを各スライドに併記。Enter/Space/→ で次へ・← で戻る・Esc で閉じる。
const KEY_ICON = {
  width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};
// 各スライドは「スマホ → PC」の順で並べる（オーナー要望 2026-09-29）。
//   row = { dev:'📱'|'💻', keys:[...]（PC）| gesture:'…'（スマホ）, label }
const KEYS_SLIDES = [
  {
    icon: (
      <svg {...KEY_ICON}>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <line x1="7" y1="14.5" x2="17" y2="14.5" />
        <circle cx="7" cy="10" r="0.6" fill="currentColor" /><circle cx="10.3" cy="10" r="0.6" fill="currentColor" />
        <circle cx="13.7" cy="10" r="0.6" fill="currentColor" /><circle cx="17" cy="10" r="0.6" fill="currentColor" />
      </svg>
    ),
    title: '意味を確認する',
    desc: '意味を開くまでは採点できません（見ずに答えないため）。PCは右手だけで Shift → 矢印 と回せます。',
    rows: [
      { dev: '📱', gesture: 'カードをタップ', label: '意味を確認' },
      { dev: '💻', keys: ['Shift', 'Space', 'Enter'], label: '意味を確認' },
    ],
  },
  {
    icon: (
      <svg {...KEY_ICON}>
        <line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /><polyline points="10 6 4 12 10 18" />
      </svg>
    ),
    title: '採点する',
    desc: '右＝知ってた、左＝知らなかった。スワイプも矢印キーも同じ向きです。',
    rows: [
      { dev: '📱', gesture: '右にスワイプ', label: '知ってた' },
      { dev: '📱', gesture: '左にスワイプ', label: '知らなかった' },
      { dev: '📱', gesture: 'ボタンをタップ', label: 'うろ覚え' },
      { dev: '💻', keys: ['→', '3'], label: '知ってた' },
      { dev: '💻', keys: ['↓', '2'], label: 'うろ覚え' },
      { dev: '💻', keys: ['←', '1'], label: '知らなかった' },
    ],
  },
  {
    icon: (
      <svg {...KEY_ICON}>
        <polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" />
      </svg>
    ),
    title: '押し間違えたら戻る',
    desc: '前のカードに戻って、採点を取り消してやり直せます。',
    rows: [
      { dev: '📱', gesture: '左上の「↩ 前のカードに戻る」', label: '1枚戻る' },
      { dev: '💻', keys: ['↑', 'Backspace'], label: '1枚戻る' },
    ],
  },
  {
    icon: (
      <svg {...KEY_ICON}>
        <circle cx="12" cy="12" r="9.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.5" /><circle cx="12" cy="17" r="0.7" fill="currentColor" />
      </svg>
    ),
    title: 'いつでも見返せます',
    desc: 'この操作ガイドは復習画面の右上「?」からいつでも開けます。',
  },
];

function Kbd({ k }) {
  return <kbd className="review-kbd">{k}</kbd>;
}

function KeysHelp({ onClose }) {
  const [step, setStep] = useState(0);
  const isFirst = step === 0;
  const isLast = step === KEYS_SLIDES.length - 1;
  const slide = KEYS_SLIDES[step];
  const next = () => (isLast ? onClose() : setStep((s) => s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  // ガイド表示中はこちらがキーを受ける（ReviewModal 側は showKeys 中は何もしない）。
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (k === 'Enter' || k === ' ' || k === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (k === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const renderKeys = (ks) =>
    ks.map((k, i) => (
      <span key={k}>
        {i > 0 && <span className="review-kbd-or">/</span>}
        <Kbd k={k} />
      </span>
    ));

  return (
    <div className="modal-overlay tutorial-overlay">
      <div className="modal-panel tutorial-panel" role="dialog" aria-modal="true" aria-label="復習の操作ガイド">
        <button className="modal-close tutorial-skip-x" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
        <div className="tutorial-body">
          <div className="onboarding-steps">
            {KEYS_SLIDES.map((_, i) => (
              <div key={i} className={'onboarding-step' + (i === step ? ' active' : '')} />
            ))}
          </div>
          <div className="tutorial-slide" key={step}>
            <div className="tutorial-badge">{slide.icon}</div>
            <h2 className="onboarding-title">{slide.title}</h2>
            <p className="tutorial-desc">{slide.desc}</p>
            {slide.rows && (
              <table className="review-keys-table">
                <tbody>
                  {slide.rows.map((r, i) => (
                    <tr key={i} className={r.dev === '💻' ? 'is-pc' : 'is-mobile'}>
                      <td className="review-keys-dev" aria-label={r.dev === '💻' ? 'PC' : 'スマホ'}>{r.dev}</td>
                      <td>{r.keys ? renderKeys(r.keys) : <span className="review-keys-gesture">{r.gesture}</span>}</td>
                      <td>{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="tutorial-footer">
          <button className="btn-primary" style={{ width: '100%' }} onClick={next}>
            {isLast ? '閉じる' : '次へ →'}
          </button>
          <div className="tutorial-subnav">
            {!isFirst && (
              <button className="btn-text-link" onClick={prev}>
                ← 戻る
              </button>
            )}
            {!isLast && (
              <button className="btn-text-link" onClick={onClose}>
                スキップ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 既存 startReview / renderReviewCard（SRSフラッシュカード）の再現。
export default function ReviewModal({ asPage = false }) {
  const { reviewWords, reviewAll, reviewAgain, closeReview, currentHistoryId, profile, openWordbook, openReview, settings, updateSettings } = useApp();
  // 10枚でひと区切り（オーナー決定 2026-11-12・案5）: 採点した枚数が 10・20…になった所で区切りの画面を出す（最後の1枚の後は出さず完了へ）。
  //   設定（プロフィールの settings.reviewBreak・既定は入＝1回の復習の語数と同じく同期する）で切れる。区切りの画面の「今後は表示しない」でも切れる。
  const breakOn = settings?.reviewBreak !== false;
  // 「知らなかった／うろ覚えの語をもう一度」（2026-11-12）: 'unknown'｜'shaky'｜null。成功は練習・今日 N回目に数えない・EXP は見直しと同じ。
  const again = reviewAgain || null;
  // ★ 覚えたい／♡ お気に入りの例文（2026-11-07 オーナー決定）: カードの裏に出す。my_words の行を語ごとに持ち、
  // 付けた回数を数えて完了画面から単語帳へ案内する（付けた時だけ・押しつけない）。
  const [marks, setMarks] = useState(() => new Map());
  const [markedWords, setMarkedWords] = useState(() => new Set()); // この回に★/♡を付けた語（外したら抜く）
  const markedRun = markedWords.size;
  const markWord = (word, on) =>
    setMarkedWords((s) => {
      const n = new Set(s);
      if (on) n.add(word);
      else n.delete(word);
      return n;
    });
  useEffect(() => {
    let alive = true;
    getActiveWords(profile?.id)
      .then((list) => {
        if (!alive) return;
        setMarks(new Map((list || []).map((w) => [String(w.word).toLowerCase(), w])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [profile?.id, reviewWords]);
  const marksFor = (w) => {
    if (!w) return null;
    const row = marks.get(String(w.word).toLowerCase());
    const canLike = !!w.example && !!subtitleCredit(w) && w.source !== 'plus';
    return {
      starred: !!row && row.inWordbook !== false,
      liked: !!row?.liked,
      canLike,
      onStar: async (starred) => {
        const lower = String(w.word).toLowerCase();
        if (starred) {
          const r = await unstarWord(profile?.id, w.word);
          setMarks((m) => {
            const n = new Map(m);
            if (r === 'deleted') n.delete(lower);
            else if (n.has(lower)) n.set(lower, { ...n.get(lower), inWordbook: false });
            return n;
          });
          if (!marks.get(lower)?.liked) markWord(lower, false); // ♡も無ければ「付けた語」から抜く
          return;
        }
        const entry = entryFromCard(w);
        const merged = await starWord(profile?.id, entry);
        setMarks((m) => new Map(m).set(lower, merged || entry));
        markWord(lower, true);
      },
      onLike: async (liked) => {
        const lower = String(w.word).toLowerCase();
        if (!liked && !canLikeMore([...marks.values()], sceneOf(w))) {
          alert(`この話の例文の ♡ は ${LIKE_CAP_PER_EPISODE} 件までです`);
          return;
        }
        const r = await likeWord(profile?.id, entryFromCard(w), !liked);
        setMarks((m) => {
          const n = new Map(m);
          if (r) n.set(lower, r);
          else n.delete(lower);
          return n;
        });
        if (!liked) markWord(lower, true);
        else if (!(r && r.inWordbook !== false)) markWord(lower, false); // ★も無ければ抜く
      },
    };
  };
  // 夕焼けシネマの見た目と復習の利用データは、復習タブのページ表示だけ（2026-11-07 オーナー決定）。
  // 予習の「じっくり覚える」（重ね表示・asPage=false）は従来の見た目のまま・予習の利用データにも数えない。
  const cinema = asPage;

  // ページ表示（スマホの復習タブ）の間はページ全体のスクロールを止める（CSS: html.cl-review-lock）。
  // 下の TMDB 表記の分だけページが画面からはみ出し、上下に触るとカードがずれていた（オーナー報告 2026-10-20）。
  // 長いカードは .review-content の中だけでスクロールする。
  //   ★外すのは useLayoutEffect の後始末で＝復習を閉じた同じ描画の中で、下のタブバーが差し込まれる前に外す
  //   （useEffect だと「止めたままのページにタブバーを差し込み→あとで止めを外す」順になり、iPhone の WebKit で
  //    固定のタブバーがページと一緒にスクロールして途中に浮いた・オーナー実機 2026-11-09）。
  useLayoutEffect(() => {
    if (!asPage) return;
    const root = document.documentElement;
    window.scrollTo(0, 0);
    root.classList.add('cl-review-lock');
    return () => root.classList.remove('cl-review-lock');
  }, [asPage]);

  // 初期キュー：未学習 or 期日到来のみ・シャッフル（reviewWords が変わるたびに作り直す）
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [ratings, setRatings] = useState({}); // word -> quality
  const [promo, setPromo] = useState({ learned: [], mastered: [] });
  const [sessionInfo, setSessionInfo] = useState(null); // 完了時に記録
  // 再挑戦パス（😰知らなかったをもう一度）：採点しない＝「次へ」だけ（2026-09-21 オーナー提案）。
  //   同日2回目の成功は reviewWord が練習扱いにするので日程には元々効かなかったが、
  //   lastQuality/reviewCount の上書きと昇格ボーナスEXPの二重計上が残っていた。採点自体をやめて根絶。
  const [retryMode, setRetryMode] = useState(false);
  // 採点の取り消し用スナップショット（押し間違い救済）。1枚採点するごとに積む。
  const [undoStack, setUndoStack] = useState([]);
  // 途中でやめた時の成果画面（オーナー要望 2026-10-30「途中で辞めた時にも成果と EXP を表示したい」）。
  // ✕／オーバーレイで抜ける時、採点済みの語があれば閉じずに「ここまでで N語」の画面を出す。
  // 採点した語は reviewWord で SRS に入っているので、記録と EXP だけが抜けていた。
  const [partial, setPartial] = useState(false);
  // 記録＋EXP は1セッション1回（完了画面 or 途中の成果画面 or 画面を離れた時のアンマウント）。
  const awardedRef = useRef(false);
  // ボトムナビ等でこの画面ごと離れた時（成果画面を出せない経路）は、採点した分だけ黙って記録する。
  const latestRef = useRef(null);
  // 操作ヘルプ（キー／スワイプ）。初めて復習を開いた時に一度だけ自動表示し、以後は右上の「?」から
  // （オーナー要望 2026-09-29）。既読は端末ローカル（cl_review_keys_seen）。
  const [showKeys, setShowKeys] = useState(false);
  useEffect(() => {
    if (!reviewWords) return;
    try {
      if (localStorage.getItem(KEYS_SEEN_KEY) === '1') return;
      localStorage.setItem(KEYS_SEEN_KEY, '1');
    } catch {
      return;
    }
    setShowKeys(true);
  }, [reviewWords]);
  const initKey = useMemo(() => (reviewWords ? reviewWords.map((w) => w.word).join('|') : ''), [reviewWords]);
  // もう一度の「続きの N語」: 今回の続きで既に出した語（小文字）。復習タブから新しく始めた時だけ空にする。
  const againSeenRef = useRef(new Set());
  const againContRef = useRef(false);
  // 区切り: 出している所（採点した枚数）と、この回で出し終えた所（戻るで取り消して答え直した時に二度出さない）
  const [breakAt, setBreakAt] = useState(null);
  const breaksShownRef = useRef(new Set());
  const [builtKey, setBuiltKey] = useState(null);

  // reviewWords がセットされたらキューを構築（レンダー中の同期初期化）
  if (reviewWords && builtKey !== initKey) {
    const srs = loadSrs();
    const q = reviewWords
      .filter((w) => {
        // reviewAll（半券のシーン記憶カード）は期日に関係なく全語を出す＝場面を必ず振り返れる。
        if (reviewAll) return true;
        const e = srs[w.word.toLowerCase()];
        return !e || isDue(e);
      })
      // もう一度は「答えた日が新しい順」のまま（lib/againWords.js）。それ以外は混ぜる
      .sort(again ? () => 0 : () => Math.random() - 0.5);
    if (again) {
      if (!againContRef.current) againSeenRef.current = new Set();
      againContRef.current = false;
      q.forEach((w) => againSeenRef.current.add(String(w.word || '').toLowerCase()));
    }
    setQueue(q);
    setIdx(0);
    setFlipped(false);
    setBreakAt(null);
    breaksShownRef.current = new Set();
    setRatings({});
    setPromo({ learned: [], mastered: [] });
    setSessionInfo(null);
    setRetryMode(false);
    setUndoStack([]);
    setPartial(false);
    awardedRef.current = false;
    setBuiltKey(initKey);
  }

  latestRef.current = { queue, idx, ratings, promo, retryMode, again, currentHistoryId };

  // 利用データ（復習の流れ・lib/usage.js・法務 2026-11-07）: 始めた／終えた／何割で・どう抜けたか／答えの内訳／
  //   1枚の時間の幅。固定の名前と回数だけ（語・作品・カード番号は送らない）。知らなかった語のもう一度は数えない。
  const usageRef = useRef({ key: null, ended: true, shownAt: 0 });
  const recordReviewExit = (how) => {
    const u = usageRef.current;
    if (!cinema || u.ended || u.again) return;
    u.ended = true;
    const st = latestRef.current;
    trackUsage(exitEventName('review', toDecile(st.idx, st.queue.length), how));
  };
  const exitRef = useRef(recordReviewExit);
  exitRef.current = recordReviewExit;
  useEffect(() => {
    if (!cinema || !builtKey || retryMode || !queue.length) return;
    if (usageRef.current.key === builtKey) return; // 開発時の二重実行でも1回
    usageRef.current = { key: builtKey, ended: false, shownAt: Date.now(), again: !!again };
    // もう一度は今日の復習の流れ（review_*）と混ぜない＝別の名前で始めた回数だけ
    trackUsage(again ? (again === 'unknown' ? 'again_unknown_start' : 'again_shaky_start') : 'review_start');
  }, [cinema, builtKey, retryMode, queue.length, again]);
  useEffect(() => {
    usageRef.current.shownAt = Date.now(); // 1枚の時間＝カードが出てから答えるまで
  }, [idx, builtKey]);
  useEffect(() => {
    const u = usageRef.current;
    if (!cinema || retryMode || u.ended || !queue.length || idx < queue.length) return;
    u.ended = true;
    trackUsage(u.again ? 'again_done' : 'review_done');
  }, [cinema, retryMode, idx, queue.length]);
  const aliveRef = useRef(false);
  useEffect(() => {
    if (!cinema) return undefined;
    aliveRef.current = true;
    const onHide = () => exitRef.current('close');
    window.addEventListener('pagehide', onHide);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('pagehide', onHide);
      // ボトムナビ等で画面ごと離れた。開発時の二重実行（外して→付け直す）では数えない（予習カードと同じ作法）
      setTimeout(() => !aliveRef.current && exitRef.current('nav'), 0);
    };
  }, [cinema]);

  useEffect(
    () => () => {
      const st = latestRef.current;
      if (!st || awardedRef.current || st.retryMode || st.again) return; // もう一度は今日 N回目に数えない
      const rated = st.queue.slice(0, st.idx).filter((w) => st.ratings[w.word] != null);
      if (!rated.length) return;
      awardedRef.current = true;
      awardReviewSession({ queue: rated, ratings: st.ratings, promo: st.promo, historyId: st.currentHistoryId });
    },
    []
  );

  if (!reviewWords) return null;

  const done = idx >= queue.length;
  const ratedCount = retryMode ? 0 : Object.keys(ratings).length;
  // ✕／オーバーレイ：途中で採点済みの語があれば成果画面へ。0語・完了後・再挑戦パスはそのまま閉じる。
  const requestClose = () => {
    if (!done) recordReviewExit('x');
    if (!done && !partial && ratedCount > 0) setPartial(true);
    else closeReview();
  };
  const overlayClick = (e) => {
    if (e.target === e.currentTarget) requestClose();
  };

  const rate = (q) => {
    const w = queue[idx];
    // 再挑戦パスは見直すだけ＝SRS・採点・昇格に触れず次のカードへ
    if (retryMode) {
      setUndoStack((st) => [...st, { word: w.word }]);
      setFlipped(false);
      setIdx((i) => i + 1);
      return;
    }
    const srs = loadSrs();
    const before = srs[w.word.toLowerCase()];
    const wasLearned = isLearned(before);
    const wasMastered = isMastered(before);
    // 取り消し用に採点前の状態を保存（SRSエントリは複製・新規語は undefined のまま）
    setUndoStack((st) => [...st, { word: w.word, before: before ? { ...before } : undefined, promo, ratings }]);
    reviewWord(w.word, q, w._src, { practice: !!again }); // 出所（最初に出会った作品/話）を SRS に固定（拡張の再会表示用）。もう一度の成功は練習
    if (cinema && !again) {
      trackUsage(q === 0 ? 'review_ans_fail' : q === 3 ? 'review_ans_hard' : 'review_ans_easy');
      const t = reviewTimeEvent((Date.now() - usageRef.current.shownAt) / 1000);
      if (t) trackUsage(t);
    }
    const after = loadSrs()[w.word.toLowerCase()];
    const newPromo = { learned: [...promo.learned], mastered: [...promo.mastered] };
    if (!wasLearned && isLearned(after)) newPromo.learned.push(w.word);
    if (!wasMastered && isMastered(after)) newPromo.mastered.push(w.word);
    setPromo(newPromo);
    setRatings((r) => ({ ...r, [w.word]: q }));
    setFlipped(false);
    setIdx((i) => i + 1);
    // 10枚でひと区切り（復習タブのページ表示・採点する回だけ＝今日の復習・作品の復習・もう一度。見直しは採点しないので出さない）
    const answered = idx + 1;
    if (cinema && shouldShowBreak(answered, queue.length, breakOn, breaksShownRef.current)) {
      breaksShownRef.current.add(answered);
      setBreakAt(answered);
    }
  };

  // 直前の採点を取り消して1枚戻る（意味を開いた状態で戻す＝すぐ採点し直せる）。
  const undo = () => {
    const snap = undoStack[undoStack.length - 1];
    if (!snap || idx === 0) return;
    if (!retryMode) {
      restoreSrsEntry(snap.word, snap.before);
      setPromo(snap.promo);
      setRatings(snap.ratings);
    }
    setUndoStack((st) => st.slice(0, -1));
    setIdx((i) => i - 1);
    setFlipped(true);
  };

  const showDone = done || partial;
  const showBreak = breakAt != null && !showDone;
  // 区切りの画面: 続ける／ここまでにする（✕ と同じ＝答えた分は記録して「ここまで復習しました」）／今後は表示しない（設定を切って続ける）
  const continueAfterBreak = () => setBreakAt(null);
  const stopAtBreak = () => {
    recordReviewExit('x');
    setBreakAt(null);
    setPartial(true);
  };
  const hideBreaks = () => {
    updateSettings({ reviewBreak: false });
    setBreakAt(null);
  };

  // PCのキーボード操作（オーナー要望 2026-09-29・割り当てはスワイプの左右と一致させる）。
  //   Space/Enter/Shift＝意味を確認。開いた後: →知ってた ←知らなかった ↓うろ覚え ↑/Backspace 前に戻る。
  //   1/2/3 も同じ（Anki 経験者向け）。開く前の矢印は無効（見ずに採点させない＝スワイプと同じ）。
  //   再挑戦パス（採点なし）は Space/Enter/→ のどれでも次へ。入力欄にフォーカス中は無効。
  useEffect(() => {
    if (!reviewWords) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      if (showKeys) return; // ガイド表示中は KeysHelp 側が受ける
      if (showDone) return;
      if (showBreak) {
        // 区切りの画面では Enter／Space で「続ける」だけ（矢印で採点が飛ばないように）
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          continueAfterBreak();
        }
        return;
      }
      if (e.repeat) return; // 押しっぱなしで複数枚進まない（特に Shift／矢印）
      const k = e.key;
      // Shift 単押しも「意味を確認」にする＝右手だけで Shift→矢印 と回せる（オーナー要望 2026-10-01）
      const isOpen = k === ' ' || k === 'Enter' || k === 'Shift';
      if (!flipped) {
        if (isOpen) {
          e.preventDefault();
          setFlipped(true);
        } else if (k === 'ArrowUp' || k === 'Backspace') {
          if (idx > 0) {
            e.preventDefault();
            undo();
          }
        }
        return;
      }
      if (retryMode) {
        if (isOpen || k === 'ArrowRight') {
          e.preventDefault();
          rate(null);
        } else if (k === 'ArrowUp' || k === 'Backspace') {
          if (idx > 0) {
            e.preventDefault();
            undo();
          }
        }
        return;
      }
      const map = { ArrowRight: 5, 3: 5, ArrowLeft: 0, 1: 0, ArrowDown: 3, 2: 3 };
      if (k in map) {
        e.preventDefault();
        rate(map[k]);
      } else if (k === 'ArrowUp' || k === 'Backspace') {
        if (idx > 0) {
          e.preventDefault();
          undo();
        }
      } else if (isOpen) {
        e.preventDefault(); // 開いた後の Space/Enter は何もしない（連打で採点が飛ぶ事故を防ぐ）
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewWords, showKeys, showDone, showBreak, flipped, retryMode, idx, queue, promo, ratings, undoStack]);
  // 進捗バー：消化済み（idx）/ 全体。完了画面では満タン表示。
  const pct = queue.length ? Math.round(((done ? queue.length : idx) / queue.length) * 100) : 0;

  return (
    <div
      className={asPage ? 'screen active review-screen review-cinema' : 'modal-overlay review-overlay'}
      id={asPage ? 'screen-review' : undefined}
      style={asPage ? undefined : { display: 'flex' }}
      onClick={asPage ? undefined : overlayClick}
    >
      <div className={asPage ? 'review-panel' : 'modal-panel review-modal-panel'}>
        <div className="modal-header">
          <span className="modal-title">🃏 復習</span>
          <span className="review-head-btns">
            <button
              type="button"
              className="modal-close review-keys-btn"
              onClick={() => setShowKeys((v) => !v)}
              aria-label="操作方法"
              title="操作方法（キーボード／スワイプ）"
            >
              ?
            </button>
            <button className="modal-close" onClick={requestClose}>
            ✕
          </button>
          </span>
        </div>
        {showKeys && <KeysHelp onClose={() => setShowKeys(false)} />}
        {!showDone && !showBreak && cinema && (
          <CinemaProgress
            idx={idx}
            total={queue.length}
            label={again === 'unknown' ? '知らなかった語' : again === 'shaky' ? 'うろ覚えの語' : undefined}
          />
        )}
        {!showDone && !cinema && (
          <div className="review-progress" aria-hidden="true">
            <span className="review-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className={'review-content' + (showDone || showBreak ? ' is-done' : '')}>
          {showBreak ? (
            <ReviewBreak count={breakAt} onContinue={continueAfterBreak} onStop={stopAtBreak} onHide={hideBreaks} />
          ) : showDone ? (
            <ReviewDone
              queue={partial ? queue.slice(0, idx) : queue}
              partial={partial}
              awardedRef={awardedRef}
              ratings={ratings}
              promo={promo}
              currentHistoryId={currentHistoryId}
              sessionInfo={sessionInfo}
              setSessionInfo={setSessionInfo}
              retryMode={retryMode}
              onRetryFailed={(failed) => {
                setQueue(failed);
                setIdx(0);
                setFlipped(false);
                setRatings({});
                setPromo({ learned: [], mastered: [] }); // 1周目の昇格を完了画面で再表示・再加算しない
                setUndoStack([]);
                setPartial(false);
                awardedRef.current = false; // 再挑戦パスは別の1回（カード×2だけ・昇格ボーナス無し）
                setRetryMode(true);
              }}
              onDone={closeReview}
              again={again}
              nextAgain={
                again
                  ? () => {
                      const hist = loadHistory();
                      const mw = [...marks.values()];
                      const keys = activeWordKeys(hist, mw, sameWorkTitle);
                      return getAgainWords(again, hist, loadSrs(), mw, keys, againSeenRef.current).slice(0, AGAIN_BATCH);
                    }
                  : null
              }
              onNextAgain={(words) => {
                trackUsage('again_next');
                againContRef.current = true;
                openReview(words, { again });
              }}
              markedRun={markedRun}
              onOpenWordbook={openWordbook}
            />
          ) : cinema ? (
            <ReviewCinemaCard
              word={queue[idx]}
              marks={marksFor(queue[idx])}
              flipped={flipped}
              retryMode={retryMode}
              onFlip={() => setFlipped(true)}
              onRate={rate}
              onUndo={idx > 0 ? undo : null}
            />
          ) : (
            <ReviewCard
              word={queue[idx]}
              marks={marksFor(queue[idx])}
              idx={idx}
              total={queue.length}
              flipped={flipped}
              retryMode={retryMode}
              onFlip={() => setFlipped(true)}
              onRate={rate}
              onUndo={idx > 0 ? undo : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ word: w, marks, idx, total, flipped, retryMode, onFlip, onRate, onUndo }) {
  // スワイプ採点：右=知ってた(5) / 左=知らなかった(0)。
  // うろ覚え(3)は3択ボタンで常時選べる（中間はSM-2の肝なのでジェスチャーに潰さない）。
  // 判定は意味を表示（flipped）してから有効。
  const touch = useRef({ x: 0, y: 0 });
  const onTouchStart = (e) => {
    const t = e.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!flipped) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy)) onRate(retryMode ? null : dx > 0 ? 5 : 0);
  };

  return (
    <div className="review-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="review-card-head">
        {/* 押し間違い救済：直前の採点を取り消して戻る（1枚目には無い）。 */}
        {onUndo ? (
          <button type="button" className="review-undo" onClick={onUndo}>
            ↩ 前のカードに戻る
          </button>
        ) : (
          <span />
        )}
        <div className="review-counter">
          {idx + 1} / {total}
        </div>
      </div>
      {/* 本文（単語＋意味＋例文）＝画面中央に配置。採点/確認ボタンは下端(review-card-actions)。
          カード本文のタップでも意味を表示できる（片手操作・2026-07-03 実使用フィードバック#1。
          🔊等のボタンは除外。スワイプは移動量で click が抑止されるため干渉しない）。 */}
      <div
        className="review-card-body"
        onClick={(e) => {
          if (flipped || e.target.closest('button')) return;
          onFlip();
        }}
      >
        {/* #19: チャンクがあれば「look forward to」のような連語で表示（対象語を強調）。
            単語単体より実際の使われ方の塊で覚える方が応用が効く。無い語は従来どおり単語のみ。 */}
        {(() => {
          const cp = chunkParts(w.chunk, w.word, w.pos);
          const label = cp ? w.chunk : w.word;
          return (
            // チャンク表示: 対象語はフルサイズ・accent のまま、周辺語だけ小さく淡く
            // （カード全体を縮めると単語が小さく感じる・実機フィードバック 2026-07-16）
            <div className="review-word-big" style={cp ? { lineHeight: 1.25 } : undefined}>
              {cp && cp.hit ? (
                <>
                  <span style={{ fontSize: '0.5em', color: 'var(--text-muted)', fontWeight: 600 }}>{cp.before}</span>
                  {cp.hit}
                  <span style={{ fontSize: '0.5em', color: 'var(--text-muted)', fontWeight: 600 }}>{cp.after}</span>
                </>
              ) : (
                w.word
              )}
              <button
                type="button"
                className="review-speak"
                aria-label="発音を聞く"
                onClick={(ev) => {
                  ev.stopPropagation();
                  speak(label);
                }}
              >
                🔊
              </button>
            </div>
          );
        })()}
        {w.pos && (
          <div className="review-pos-tag">
            {w.pos}
            {(() => {
              const sf = surfaceFormInExample(w.example, w.word);
              return sf ? <span className="pos-surface">例文では {sf}</span> : null;
            })()}
          </div>
        )}
        {flipped && (
          <div className="review-answer" style={{ display: 'block' }}>
            <div className="review-def-text">{w.definition || ''}</div>
            {w.example && (
              <div className="review-example-text">
                <div>
                  &quot;{w.example}&quot;
                  <button
                    type="button"
                    className="review-speak review-speak-sm"
                    aria-label="例文を聞く"
                    onClick={() => speak(w.example)}
                  >
                    🔊
                  </button>
                </div>
                {w.example_ja && <div className="review-example-ja">{w.example_ja}</div>}
                {/* 出所明示（著作権法48条）：例文を引いた作品・話・字幕元 */}
                {subtitleCredit(w) && <div className="review-example-source">{subtitleCredit(w)}</div>}
                {isOtherSceneExample(w) && <div className="review-example-source">この回の別の場面のセリフです</div>}
              </div>
            )}
            {/* AI 作例（2026-10-31）: 字幕から例文が取れなかった語。字幕の引用ではないので “…” と出所を付けず明示する */}
            {!w.example && aiExampleOf(w) && (
              <div className="review-example-text">
                <div>
                  {aiExampleOf(w).en}
                  <button
                    type="button"
                    className="review-speak review-speak-sm"
                    aria-label="例文を聞く"
                    onClick={() => speak(aiExampleOf(w).en)}
                  >
                    🔊
                  </button>
                </div>
                {aiExampleOf(w).ja && <div className="review-example-ja">{aiExampleOf(w).ja}</div>}
                <div className="review-example-source">AI 作例（ドラマのセリフではありません）</div>
              </div>
            )}
            {/* ★ 覚えたい／♡ お気に入りの例文（2026-11-07）＝意味を見た後に。見た目の確認は復習・クイズ部門 */}
            {marks && <WordMarks {...marks} compact />}
          </div>
        )}
      </div>
      <div className="review-card-actions">
        {!flipped ? (
          <>
            <button className="review-flip" onClick={onFlip}>
              タップして意味を確認 →
            </button>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>Shift</kbd> / <kbd>Space</kbd> で意味を確認
            </div>
          </>
        ) : retryMode ? (
          // 再挑戦パス：採点ボタンを出さず「次へ」だけ
          <>
            <button className="review-flip review-next" onClick={() => onRate(null)}>
              次へ →
            </button>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>Shift</kbd> / <kbd>Space</kbd> / <kbd>→</kbd> 次へ　<kbd>↑</kbd> 戻る
            </div>
          </>
        ) : (
          <>
            <div className="review-rate-btns">
              <button className="btn-rate btn-rate-fail" onClick={() => onRate(0)}>
                <span className="btn-rate-emoji">😟</span>
                <span className="btn-rate-label">知らなかった</span>
                <span className="btn-rate-sub">覚え直す</span>
              </button>
              <button className="btn-rate btn-rate-hard" onClick={() => onRate(3)}>
                <span className="btn-rate-emoji">🙂</span>
                <span className="btn-rate-label">うろ覚え</span>
                <span className="btn-rate-sub">あとで復習</span>
              </button>
              <button className="btn-rate btn-rate-easy" onClick={() => onRate(5)}>
                <span className="btn-rate-emoji">🔥</span>
                <span className="btn-rate-label">知ってた！</span>
                <span className="btn-rate-sub">次へ進む</span>
              </button>
            </div>
            <div className="review-swipe-hint" aria-hidden="true">
              ← 知らなかった　｜　知ってた →
            </div>
            <div className="review-key-hint" aria-hidden="true">
              <kbd>←</kbd> 知らなかった　<kbd>↓</kbd> うろ覚え　<kbd>→</kbd> 知ってた　<kbd>↑</kbd> 戻る
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 10枚でひと区切りの画面（オーナー決定 2026-11-12・見本 reports/review-card-ui-2026-11-12/mock.html）。
//   残りの数・「あと○語」は出さない（罪悪感UI禁止）。答えた分は reviewWord で記録済み＝「記録されています」は事実。
function ReviewBreak({ count, onContinue, onStop, onHide }) {
  return (
    <div className="rd rd-break">
      <div className="rd-body">
        <DoneHero title={`${count}語 復習しました`} sub="ひと区切りです。ここまでの分は記録されています。" />
        <button type="button" className="rd-break-hide" onClick={onHide}>
          今後は表示しない
        </button>
      </div>
      <div className="rd-actions">
        <button type="button" className="rd-btn1" onClick={onContinue}>
          続ける
        </button>
        <button type="button" className="rd-btn2" onClick={onStop}>
          ここまでにする
        </button>
      </div>
    </div>
  );
}

// partial＝途中でやめた時の成果画面（queue は採点済みの語だけ）。文言はやった分だけを肯定的に
// （「未完了」「あと○語」は出さない＝罪悪感UI禁止）。awardedRef＝親と共有する「記録済み」旗。
// 完了画面（2026-11-09 オーナー OK のモックどおり＝reports/review-complete-redesign-2026-11-09/）:
//   主役は「復習完了！」・一般的なカチンコの線画・EXP とレベルを白いカード1枚に・結果は同じ形のタイル3枚（淡い色のまま）・
//   単語一覧と今日の記録は折りたたみ（最初は閉じる）・ボタンは画面の下に固定。途中でやめた時・見直し完了も同じ形。
//   罪悪感UI禁止: 「知らなかった」を赤や怖がる顔で強調しない（くすんだ淡い色・顔の絵文字なし）。
function DoneClapper() {
  // 一般的なカチンコの線画（実在のロゴ・配色に寄せない）
  return (
    <svg className="rd-clap" width="54" height="49" viewBox="0 0 64 58" aria-hidden="true">
      <g transform="rotate(-12 10 22)">
        <rect x="6" y="12" width="50" height="11" rx="2.5" className="rd-clap-body" />
        <path d="M13 12l-5 11M24 12l-5 11M35 12l-5 11M46 12l-5 11M57 12l-5 11" className="rd-clap-stripe" strokeWidth="4.2" />
      </g>
      <rect x="6" y="24" width="52" height="30" rx="4" className="rd-clap-body" />
      <path d="M6 31h52" className="rd-clap-stripe" strokeWidth="2" opacity=".85" />
      <path d="M28 37.5v10l8.5-5z" className="rd-clap-play" />
      <circle cx="9.5" cy="24" r="2.6" className="rd-clap-pin" />
    </svg>
  );
}

const Sparkle = ({ className, size }) => (
  <svg className={'rd-spark ' + className} width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 0l1.6 5.4L14 7l-5.4 1.6L7 14l-1.6-5.4L0 7l5.4-1.6z" fill="currentColor" />
  </svg>
);

function DoneHero({ title, sub }) {
  return (
    <section className="rd-hero">
      <DoneClapper />
      <Sparkle className="s1" size={14} />
      <Sparkle className="s2" size={10} />
      <Sparkle className="s3" size={7} />
      <h2 className="rd-title">{title}</h2>
      {sub && <p className="rd-sub">{sub}</p>}
    </section>
  );
}

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".18" />
    <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const StarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor" />
  </svg>
);

// partial＝途中でやめた時の成果画面（queue は採点済みの語だけ）。文言はやった分だけを肯定的に
// （「未完了」「あと○語」は出さない＝罪悪感UI禁止）。awardedRef＝親と共有する「記録済み」旗。
function ReviewDone({ queue, partial = false, awardedRef, ratings, promo, currentHistoryId, sessionInfo, setSessionInfo, retryMode, onRetryFailed, onDone, again = null, nextAgain = null, onNextAgain, markedRun = 0, onOpenWordbook }) {
  // もう一度の続き（答えた日が新しい順の次の最大 20語・今回出した語は除く）。採点は reviewWord で保存済み＝開いた時点で数える
  const [nextWords] = useState(() => (again && nextAgain ? nextAgain() : []));
  const failed = queue.filter((w) => ratings[w.word] === 0);
  const hard = queue.filter((w) => ratings[w.word] === 3);
  const easy = queue.filter((w) => (ratings[w.word] ?? 5) === 5);

  // EXP: カード数×2＋昇格ボーナス。加算後の総EXPからレベルを出す（表示専用の状態）。
  const [expGain, setExpGain] = useState(null); // { earned, level } 記録後にセット

  // セッションを1回だけ記録（副作用なので effect 内で・StrictMode 二重実行と、途中の成果画面→✕→
  // アンマウント時の再加算は親の awardedRef で防ぐ）
  useEffect(() => {
    if (awardedRef.current) return;
    awardedRef.current = true;
    // 再挑戦パスは採点していないので復習セッション（今日N回目・内訳）には数えない。
    // EXPはカード×2だけ付ける（見直しの手間への報酬・昇格ボーナスは1周目で付与済み）。
    // 「知らなかった／うろ覚えの語をもう一度」も同じ（今日 N回目に数えない・EXP は見直しと同じ・2026-11-12）。
    if (retryMode || again) {
      const earned = expForReviewSession({ cards: queue.length });
      setExpGain({ earned, level: levelInfo(addExp(earned)) });
      return;
    }
    const r = awardReviewSession({ queue, ratings, promo, historyId: currentHistoryId });
    setSessionInfo({ num: r.num, sessions: r.sessions });
    setExpGain({ earned: r.earned, level: r.level });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionNum = sessionInfo?.num ?? 1;
  const sessions = sessionInfo?.sessions ?? [];

  const allPerfect = failed.length === 0 && hard.length === 0;
  const gotMaster = promo.mastered.length > 0;
  const gotLearned = promo.learned.length > 0;

  // ボタン＝画面の下に固定（スクロールしなくても押せる）
  const actions = (withRetry) => (
    <div className="rd-actions">
      {withRetry && failed.length > 0 && (
        <button type="button" className="rd-btn2" onClick={() => onRetryFailed(failed)}>
          知らなかった {failed.length}単語をもう一度
        </button>
      )}
      <button type="button" className="rd-btn1" onClick={onDone}>
        {/* 戻り先は入口によって変わる（単語リスト/ホーム/復習ハブ）ので行き先を名指ししない */}
        復習を終える
      </button>
    </div>
  );

  if (again) {
    const label = again === 'unknown' ? '知らなかった' : 'うろ覚え';
    return (
      <div className="rd">
        <div className="rd-body">
          <DoneHero title="見直し完了！" sub={`「${label}」だった ${queue.length}単語をもう一度確認しました`} />
          {expGain && <ExpBlock earned={expGain.earned} lv={expGain.level} />}
          <p className="rd-note">知ってた・うろ覚えと答えた語は、次の復習日はそのままです</p>
        </div>
        <div className="rd-actions">
          {nextWords.length > 0 && (
            <button type="button" className="rd-btn2" onClick={() => onNextAgain(nextWords)}>
              続きの {nextWords.length}語
            </button>
          )}
          <button type="button" className="rd-btn1" onClick={onDone}>
            復習を終える
          </button>
        </div>
      </div>
    );
  }

  if (retryMode) {
    return (
      <div className="rd">
        <div className="rd-body">
          <DoneHero title="見直し完了！" sub={`知らなかった ${queue.length}単語をもう一度確認しました`} />
          {expGain && <ExpBlock earned={expGain.earned} lv={expGain.level} />}
          <p className="rd-note">次の復習日は変わりません（明日また出ます）</p>
        </div>
        {actions(false)}
      </div>
    );
  }

  const group = (words, dot, label) =>
    words.length > 0 && (
      <details className="rd-group">
        <summary>
          <i className={'rd-dot ' + dot} aria-hidden="true" />
          {label}
          <span className="rd-cnt">{words.length}</span>
          <span className="rd-chev" aria-hidden="true">›</span>
        </summary>
        <div className="rd-words">
          {words.map((w) => (
            <div className="rd-w" key={w.word}>
              <b>{w.word}</b>
              <span>{w.definition || ''}</span>
            </div>
          ))}
        </div>
      </details>
    );

  const log =
    sessions.length > 1 ? (
      <details className="rd-group">
        <summary>
          <i className="rd-dot d-log" aria-hidden="true" />
          今日の復習の記録
          <span className="rd-cnt">{sessions.length}回</span>
          <span className="rd-chev" aria-hidden="true">›</span>
        </summary>
        <div className="rd-log">
          <span />
          <span>知らなかった</span>
          <span>うろ覚え</span>
          <span>知ってた</span>
          {sessions.map((s) => (
            <Fragment key={s.sessionNum}>
              <b>{s.sessionNum}回目</b>
              <span>{s.fail}</span>
              <span>{s.hard}</span>
              <span>{s.easy}</span>
            </Fragment>
          ))}
        </div>
      </details>
    ) : null;

  const listRows = allPerfect ? [log] : [group(failed, 'd-fail', '知らなかった語'), group(hard, 'd-hard', 'うろ覚えの語'), group(easy, 'd-easy', '知ってた語'), log];
  const hasList = listRows.some(Boolean);

  return (
    <div className="rd">
      <div className="rd-body">
        {partial ? (
          <DoneHero title="ここまで復習しました" sub={`今日 ${sessionNum}回目 ・ ${queue.length}単語を復習しました`} />
        ) : (
          <DoneHero title="復習完了！" sub={`今日 ${sessionNum}回目 ・ ${queue.length}単語を復習しました`} />
        )}
        {expGain && <ExpBlock earned={expGain.earned} lv={expGain.level} />}
        {gotLearned && (
          <div className="rd-promo">
            <CheckIcon />
            {promo.learned.length}単語が「覚えた」に昇格！
          </div>
        )}
        {gotMaster && (
          <div className="rd-promo is-master">
            <StarIcon />
            {promo.mastered.length}単語がマスターに到達！
          </div>
        )}
        {/* 並びはカードの3択と同じ（左から 知らなかった・うろ覚え・知ってた・2026-11-12 オーナー指摘） */}
        <section className="rd-tiles" aria-label="今回の答え">
          <div className="rd-tile t-fail">
            <b>{failed.length}</b>
            <span>知らなかった</span>
          </div>
          <div className="rd-tile t-hard">
            <b>{hard.length}</b>
            <span>うろ覚え</span>
          </div>
          <div className="rd-tile t-easy">
            <b>{easy.length}</b>
            <span>知ってた</span>
          </div>
        </section>
        {allPerfect && <div className="rd-perfect">全問正解！すばらしい</div>}
        {hasList && <section className="rd-list">{listRows.map((el, i) => (el ? <Fragment key={i}>{el}</Fragment> : null))}</section>}
        {/* ★／♡ を付けた時だけ、単語帳への案内を一行（押しつけない・2026-11-07） */}
        {markedRun > 0 && (
          <button
            type="button"
            className="rd-link"
            onClick={() => {
              onDone();
              onOpenWordbook?.();
            }}
          >
            ★／♡ を付けた {markedRun} 語を単語帳で見る →
          </button>
        )}
        {partial && <p className="rd-note">残りの単語は、また復習に出てきます</p>}
      </div>
      {actions(true)}
    </div>
  );
}
