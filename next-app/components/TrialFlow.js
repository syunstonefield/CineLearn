'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import TrialAuthLinks from './TrialAuthLinks';
import VocabItem from './VocabItem';
import CefrNote from './CefrNote';
import { generateEpisodeVocab } from '@/lib/api';
import { personalizeWords } from '@/lib/personalize';
import { saveHistoryEntry } from '@/lib/storage';
import { watchSearchUrl } from '@/lib/prep';
import { speak } from '@/lib/speak';
import { secToTimeLabel } from '@/lib/subtitles';
import { cefrHintOf } from '@/lib/cefrHint';
import { trackUsage } from '@/lib/usage';
import { isMobileDevice } from '@/lib/device';
import { isExtInstallEntry } from '@/lib/extEntry';
import { markTrialLater } from '@/lib/trialState';
import {
  TRIAL_LEVELS,
  TRIAL_MORE_TITLES,
  buildTrialSession,
  filterEnabled,
  orderTrialTitles,
  posterUrl,
  trialDrama,
} from '@/lib/trial';

// 初回体験（登録前に試す流れ・docs/design-first-run-trial-2026-11-05.md）。
//   レベル → 作品 → 5語 → 予習5枚 → クイズ3問 → 完了（登録／あとで）→ 次の一歩。
//   VocabScreen を通さない＝サービス選択・TMDB の検索し直し・ロビーの待ち・★・手入力が最初から無い。
//   予習とクイズは既存の PrepWalkthrough / PrepQuiz を meta.trial で使う（SRS・予習済み・EXP を書かない）。
//   途中で閉じたら5語の画面に戻る。途中でやめる人はホームへ（再訪時の続きは第一版では作らない）。
//
// ⚠ 法務の条件（回答1・2）:
//   - ポスターは w342・幅は画面の40%以下/PC 160px まで・2:3 のまま切らない・上に文字を重ねない・作品を選ぶボタン自体にする。
//   - 作品選択の画面に「Netflix」「独占」「オリジナル」「公式」「配信中」「いま話題」を書かない。ロゴを出さない。
//   - 文言「獲得」「もらえる」「限定」「コンプリート」は使わない。
//   - 例文は字幕の語のみ・1語1文。単語リスト・カード・クイズの3か所に出典（meta.credit）を出す。
//   - 計測は固定の名前と回数だけ（作品・レベルの値を入れない）。
const PICK_NOTE = '作品はご自身が契約する配信サービスでご覧ください。本サービスは作品の権利者・配信サービスと提携していません。';
const DONE_NOTE = 'ポスター画像は作品を見分けるための表示です（画像：TMDB）。作品の権利者・配信サービスとは提携していません。';

// 体験の語は VocabItem を読み取り専用で使う（SRS を渡さない＝未学習のまま・★と削除は渡さないので出ない）。
const NO_SRS = {};
const TEST_TIERS = ['core', 'advanced', 'context'];

export default function TrialFlow() {
  const { settings, updateSettings, trialSource, finishTrial, markFirstRunDone, openAuth, loggedIn, openGuide, openPrepWalk, openPrepQuiz } = useApp();
  const [step, setStep] = useState('level');
  const [score, setScore] = useState(0);
  const [title, setTitle] = useState(null);
  const [session, setSession] = useState(null);
  const [walkDone, setWalkDone] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    trackUsage('trial_start');
    setIsMobile(isMobileDevice());
    // 権利者の要請で外した作品を隠す（法務 F）。取得できなければ全部出す（vocab-generate 側でも止まる）。
    fetch('/api/trial-catalog')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.ok && setEnabled(d.enabled))
      .catch(() => {});
  }, []);

  // 完了画面で新規登録したら次の一歩へ。完了画面に着いた時点で登録済みの人（最初の画面で登録した人・拡張から来た人）は
  //   ここで飛ばさない＝完了画面を見せる。既存アカウントへのログインは起動の処理が画面を切り替える（ここでは何もしない）。
  const loggedInOnDone = useRef(false);
  const prevStep = useRef(step);
  useEffect(() => {
    if (step === 'done' && prevStep.current !== 'done') loggedInOnDone.current = loggedIn;
    prevStep.current = step;
    if (step === 'done' && loggedIn && !loggedInOnDone.current) setStep('next');
  }, [loggedIn, step]);

  useEffect(() => {
    if (step === 'list') trackUsage('trial_list');
    if (step === 'next') trackUsage('trial_next');
    window.scrollTo?.(0, 0);
  }, [step]);

  // 完了画面が出た時点で端末に保存する（登録はこのあと。SRS と予習済みは書かない）。
  const saved = useRef(false);
  useEffect(() => {
    if (step !== 'done' || saved.current || !session) return;
    saved.current = true;
    trackUsage('trial_done');
    const d = trialDrama(title);
    saveHistoryEntry({ drama: d, season: 1, episode: 1, userLevel: settings.userLevel, targetLevel: null, words: session.list });
    markFirstRunDone({ myDramas: [...(settings.myDramas || []).filter((x) => x.title !== d.title), d] });
  }, [step, session, title, settings, markFirstRunDone]);

  const chooseLevel = (lv) => {
    trackUsage('trial_level');
    setScore(lv.score);
    updateSettings({ toeicScore: lv.score, userLevel: lv.level });
    setStep('pick');
  };

  const chooseTitle = async (t) => {
    if (loadingId) return;
    trackUsage('trial_pick');
    setLoadingId(t.id);
    setError('');
    const vocabCount = Math.min(60, Math.max(20, Number(settings.vocabCount) || 30));
    const personalize = { toeicScore: score, targetToeicScore: 0, vocabCount };
    const r = await generateEpisodeVocab({
      tmdbId: t.tmdbId,
      type: t.type,
      season: t.season,
      episode: t.episode,
      title: t.title,
      englishTitle: t.title,
      displayTitle: t.title,
      vocabCount,
      personalize,
      cacheOnly: true, // 体験から新規生成を走らせない（修正 F）
    });
    setLoadingId(null);
    const s =
      r.kind === 'hit'
        ? buildTrialSession(
            t,
            (r.selected ? r.selected.map((i) => r.words[i]).filter(Boolean) : personalizeWords(r.words, personalize)).map((w) => ({
              ...w,
              example_ja_ok: !!w.example_ja,
            })),
            score
          )
        : null;
    if (!s) {
      setError(`「${t.label}」はいま開けません。ほかの作品を選んでください。`);
      return;
    }
    setTitle(t);
    setSession(s);
    setWalkDone(false);
    setStep('list');
  };

  const startQuiz = (s = session) => {
    openPrepQuiz({
      questions: s.questions,
      meta: {
        ...s.meta,
        onTrialDone: () => {
          trackUsage('trial_quiz_done');
          setStep('done');
        },
      },
    });
  };
  const startWalk = () => {
    const s = session;
    openPrepWalk({
      words: s.words.map((w) => ({ ...w, _tsLabel: w.tsLabel || null })),
      meta: {
        ...s.meta,
        onTrialDone: () => {
          trackUsage('trial_walk_done');
          setWalkDone(true);
          startQuiz(s);
        },
      },
    });
  };

  const later = () => {
    trackUsage('trial_later');
    markTrialLater();
    setStep('next');
  };
  const signup = () => {
    trackUsage('trial_signup_click');
    openAuth({ mode: 'signup', source: 'trial_end' });
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const titles = useMemo(() => filterEnabled(orderTrialTitles(score), enabled), [score, enabled]);
  const moreTitles = useMemo(() => filterEnabled(TRIAL_MORE_TITLES, enabled), [enabled]);

  if (step === 'level') {
    return (
      <div className="trial-flow">
        <h1 className="trial-h">いまの英語レベルは？</h1>
        <p className="trial-sub">TOEIC の目安です。あとから変えられます。</p>
        <div className="trial-levels">
          {TRIAL_LEVELS.map((lv) => (
            <button key={lv.score} type="button" className="trial-level" onClick={() => chooseLevel(lv)}>
              <span className="trial-level-name">{lv.label}</span>
              <span className="trial-level-range">{lv.range}</span>
            </button>
          ))}
        </div>
        <TrialAuthLinks />
      </div>
    );
  }

  if (step === 'pick') {
    return (
      <div className="trial-flow">
        <button type="button" className="trial-back" onClick={() => setStep('level')} disabled={!!loadingId}>
          ← 戻る
        </button>
        <h1 className="trial-h">迷ったらこの4作から</h1>
        {error && <p className="trial-error">{error}</p>}
        <div className="trial-grid">
          {titles.map((t) => (
            <div key={t.id} className="trial-card">
              <button
                type="button"
                className="trial-poster"
                onClick={() => chooseTitle(t)}
                disabled={!!loadingId}
                aria-label={`${t.label} を選ぶ`}
              >
                <img src={posterUrl(t)} alt="" loading="lazy" />
              </button>
              <div className="trial-card-name">{loadingId === t.id ? '読み込み中…' : t.label}</div>
              <div className="trial-card-reason">{t.reason}</div>
            </div>
          ))}
        </div>
        {moreTitles.length > 0 && (
          <p className="trial-more">
            ほかの作品：
            {moreTitles.map((t, i) => (
              <span key={t.id}>
                {i > 0 && '／'}
                <button type="button" className="trial-text-link" onClick={() => chooseTitle(t)} disabled={!!loadingId}>
                  {loadingId === t.id ? '読み込み中…' : t.label}
                </button>
              </span>
            ))}
          </p>
        )}
        <p className="trial-note">{PICK_NOTE}</p>
        <button type="button" className="trial-text-link trial-quit" onClick={finishTrial} disabled={!!loadingId}>
          体験をやめてホームへ
        </button>
      </div>
    );
  }

  if (step === 'list') {
    return (
      <div className="trial-flow">
        <button type="button" className="trial-back" onClick={() => setStep('pick')}>
          ← 作品を選び直す
        </button>
        {/* 登録後の本番の単語リストと同じ見出しと語のカード（オーナー指摘）。進捗バーと下部のバーは体験では出さない */}
        <div className="srs-progress-wrap">
          <div className="srs-progress-header">
            <div className="srs-heading">
              <div className="srs-work-title">
                <span className="work-title-text">{title.title}</span>
              </div>
              <div className="srs-heading-sub">
                {session.meta.isMovie ? (
                  <span className="srs-media-chip">🎬 映画</span>
                ) : (
                  <span className="ep-inline-badge">
                    S{title.season}E{title.episode}
                  </span>
                )}
                <span className="srs-ep-title">単語リスト</span>
              </div>
            </div>
          </div>
        </div>
        <p className="trial-sub">字幕から5語を選びました。</p>
        {session.words.some((w) => cefrHintOf(w)) && <CefrNote />}
        <div className="vocab-list">
          {session.words.map((w) => (
            <VocabItem
              key={w.word}
              word={w}
              srs={NO_SRS}
              testTiers={TEST_TIERS}
              showCefr
              readOnly
              ts={w.tsLabel ? { label: w.tsLabel } : Number.isFinite(w.tsSec) ? { label: secToTimeLabel(w.tsSec) } : null}
              exampleSource={session.meta.credit}
              onSpeak={speak}
              onCopyTime={(t) => navigator.clipboard?.writeText(t).catch(() => {})}
            />
          ))}
        </div>
        <p className="trial-count">全部で{session.list.length}語あります</p>
        {walkDone ? (
          <button type="button" className="btn-primary trial-cta" onClick={() => startQuiz()}>
            クイズ3問へ →
          </button>
        ) : (
          <button type="button" className="btn-primary trial-cta" onClick={startWalk}>
            予習をはじめる（5枚）
          </button>
        )}
        <button type="button" className="trial-text-link trial-quit" onClick={finishTrial}>
          体験をやめてホームへ
        </button>
      </div>
    );
  }

  if (step === 'done') {
    const service = title.watchService;
    const canSignup = !loggedIn && trialSource !== 'extension';
    return (
      <div className="trial-flow trial-center">
        {posterUrl(title) && (
          <div className="trial-done-poster">
            <img src={posterUrl(title)} alt="" />
          </div>
        )}
        <h1 className="trial-h">「{title.label}」の学習記録をコレクションに追加しました</h1>
        <p className="trial-note">{DONE_NOTE}</p>
        {canSignup ? (
          <>
            <button type="button" className="btn-primary trial-cta" onClick={signup}>
              登録して学習記録を残す
            </button>
            <button type="button" className="trial-text-link trial-quit" onClick={later}>
              あとで
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary trial-cta" onClick={() => setStep('next')}>
            次へ
          </button>
        )}
        <a className="trial-watch" href={watchSearchUrl(title.title, service)} target="_blank" rel="noopener noreferrer">
          {service} で探す
        </a>
        <p className="trial-note">配信状況は変わることがあります。本サービスは {service} と提携していません。</p>
      </div>
    );
  }

  // 拡張を入れた直後のタブ＝導入の案内は出さず、次にすることだけ伝える（ホームの帯と同じ文言・Dashboard）。
  if (isExtInstallEntry()) {
    return (
      <div className="trial-flow trial-center">
        <h1 className="trial-h">次は、観ながら単語を集めましょう</h1>
        <p className="trial-sub">
          {loggedIn
            ? '動画の字幕の単語をクリックして「✓ 保存」を押すと、単語帳に入ります。'
            : '保存した単語をアプリに届けるにはログインが必要です。'}
        </p>
        {!loggedIn && (
          <button type="button" className="btn-primary trial-cta" onClick={signup}>
            登録して学習記録を残す
          </button>
        )}
        <button type="button" className={loggedIn ? 'btn-primary trial-cta' : 'trial-text-link trial-quit'} onClick={finishTrial}>
          ホームへ
        </button>
      </div>
    );
  }

  // 次の一歩（PC=拡張の案内、スマホ=PC で続ける）
  return (
    <div className="trial-flow trial-center">
      <h1 className="trial-h">次は、観ながら単語を集めましょう</h1>
      {isMobile ? (
        <>
          <p className="trial-sub">字幕の単語をクリックして保存するのは、PC の Chrome 拡張機能で行います。スマホでは予習と復習ができます。</p>
          <button type="button" className="btn-primary trial-cta" onClick={copyLink}>
            {copied ? 'リンクをコピーしました' : 'PC で開くリンクをコピー'}
          </button>
          <button type="button" className="trial-text-link trial-quit" onClick={openGuide}>
            PC での入れ方を見る
          </button>
        </>
      ) : (
        <>
          <p className="trial-sub">動画の字幕の単語をクリックして保存するには、無料の Chrome 拡張機能を使います。</p>
          <button type="button" className="btn-primary trial-cta" onClick={openGuide}>
            拡張機能の入れ方を見る
          </button>
        </>
      )}
      <button type="button" className="trial-text-link trial-quit" onClick={finishTrial}>
        ホームへ
      </button>
    </div>
  );
}
