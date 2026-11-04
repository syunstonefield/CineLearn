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
import { FRAME_TIERS } from '@/lib/ticketFrame';
import {
  TRIAL_LEVELS,
  TRIAL_MORE_TITLES,
  TRIAL_STAGES,
  buildTrialSession,
  filterEnabled,
  orderTrialTitles,
  posterUrl,
  trialDrama,
} from '@/lib/trial';

// 初回体験（登録前に試す流れ・docs/design-first-run-trial-2026-11-05.md）。
//   ようこそ → レベル → チュートリアルの案内 → 作品 → 5語 → 予習5枚 → クイズ3問 → 完了（登録／あとで）→ 次の一歩。
//   画面に出す呼び名は「チュートリアル」に統一（オーナー決定 2026-11-05）。作品から先は各画面に「ステップ○/4」と一行の説明を出す。
//   内容の少ない画面（trial-fill）は画面の縦の中央に置く。作品と5語は長いので上から並べる。
//   案内の「3〜5分」はオーナーの実測で確定（ゆっくり通して5分未満・2026-11-05）。語数や画面を変えたら測り直す。
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
const DONE_NOTE_NO_POSTER = '作品の権利者・配信サービスとは提携していません。'; // ポスターを出さない文字リンクの2作
// 完了画面のコレクションの説明（法務確定 2026-11-05）。枠の見本は無地のカードだけ＝ポスターを見本に使わない・枠を付けない。
const COLLECTION_NOTE = '単語リストを開くと、コレクションに学習記録が追加されます。学習が進むと、記録の枠が豪華になります。';
const FRAME_NOTE = '覚えた語の割合で変わります。';

// 体験の語は VocabItem を読み取り専用で使う（SRS を渡さない＝未学習のまま・★と削除は渡さないので出ない）。
const NO_SRS = {};
const TEST_TIERS = ['core', 'advanced', 'context'];

export default function TrialFlow() {
  const { settings, updateSettings, trialSource, finishTrial, markFirstRunDone, openAuth, loggedIn, openGuide, openPrepWalk, openPrepQuiz } = useApp();
  const [step, setStep] = useState('welcome');
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
    setStep('intro');
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
        stage: TRIAL_STAGES[3],
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
        stage: TRIAL_STAGES[2],
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

  if (step === 'welcome') {
    return (
      <div className="trial-flow trial-center trial-fill">
        <img className="trial-logo" src="/icon-192.png" alt="" />
        <h1 className="trial-h">CineLearn へようこそ</h1>
        <p className="trial-sub">観たいドラマや映画の字幕から、英単語を学べるアプリです。観る前に予習して、観たあとに復習できます。</p>
        {loggedIn && <p className="trial-sub">登録は済んでいます。このまま進めてください。</p>}
        <button
          type="button"
          className="btn-primary trial-cta"
          onClick={() => {
            trackUsage('trial_welcome');
            setStep('level');
          }}
        >
          はじめる
        </button>
        <TrialAuthLinks />
      </div>
    );
  }

  if (step === 'level') {
    return (
      <div className="trial-flow trial-fill">
        <button type="button" className="trial-back" onClick={() => setStep('welcome')}>
          ← 戻る
        </button>
        <h1 className="trial-h">あなたについて教えてください</h1>
        <p className="trial-lead">いまの英語レベルは？</p>
        <p className="trial-sub">レベルに合わせて、出す単語を変えます。点数は TOEIC の目安で、受けたことがなくても近いものを選べば大丈夫です。あとから変えられます。</p>
        <div className="trial-levels">
          {TRIAL_LEVELS.map((lv) => (
            <button key={lv.score} type="button" className="trial-level" onClick={() => chooseLevel(lv)}>
              <span className="trial-level-name">{lv.label}</span>
              <span className="trial-level-range">{lv.range}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step === 'intro') {
    return (
      <div className="trial-flow trial-fill">
        <button type="button" className="trial-back" onClick={() => setStep('level')}>
          ← 戻る
        </button>
        <h1 className="trial-h">
          ここからは<span className="trial-nowrap">チュートリアルに進みます</span>
        </h1>
        <p className="trial-sub">実際の作品の単語で、CineLearn の使い方を試します。</p>
        <ol className="trial-stages">
          {TRIAL_STAGES.map((s) => (
            <li key={s.label} className="trial-stage">
              <span className="trial-stage-label">{s.label}</span>
              <span className="trial-stage-summary">{s.summary}</span>
            </li>
          ))}
        </ol>
        <ul className="trial-facts">
          <li>3〜5分ほどで終わります</li>
          <li>動画は再生されません</li>
          {!loggedIn && <li>登録するかは最後に選べます</li>}
        </ul>
        <button
          type="button"
          className="btn-primary trial-cta"
          onClick={() => {
            trackUsage('trial_intro');
            setStep('pick');
          }}
        >
          チュートリアルをはじめる
        </button>
        <button type="button" className="trial-text-link trial-quit" onClick={finishTrial}>
          チュートリアルをやめてホームへ
        </button>
      </div>
    );
  }

  if (step === 'pick') {
    return (
      <div className="trial-flow">
        <button type="button" className="trial-back" onClick={() => setStep('intro')} disabled={!!loadingId}>
          ← 戻る
        </button>
        <div className="trial-step">{TRIAL_STAGES[0].title}</div>
        <h1 className="trial-h">迷ったらこの4作から</h1>
        <p className="trial-sub">{TRIAL_STAGES[0].why}</p>
        {/* 法務の推奨: ポスターを押す前に見える位置（説明の直後） */}
        <p className="trial-note">{PICK_NOTE}</p>
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
        <button type="button" className="trial-text-link trial-quit" onClick={finishTrial} disabled={!!loadingId}>
          チュートリアルをやめてホームへ
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
        <div className="trial-step">{TRIAL_STAGES[1].title}</div>
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
        <p className="trial-sub">{TRIAL_STAGES[1].why}</p>
        {session.words.some((w) => cefrHintOf(w)) && <CefrNote />}
        <div className="vocab-list">
          {session.words.map((w, i) => (
            <VocabItem
              key={w.word}
              word={w}
              defaultExpanded={i === 0} // スマホは最初の1語だけ開いて始める（オーナー決定）
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
        {/* 本番の単語リストの下部バーと同じ作り（オーナー指摘）。下までスクロールしなくても押せる。✕と復習・クイズ・カードは出さない */}
        <div className="vocab-action-bar trial-bar">
          {walkDone ? (
            <button type="button" className="vab-btn is-primary" onClick={() => startQuiz()}>
              <span className="vab-main">クイズ3問へ →</span>
            </button>
          ) : (
            <button type="button" className="vab-btn is-primary" onClick={startWalk}>
              <span className="vab-main">予習をはじめる（5枚）</span>
            </button>
          )}
        </div>
        <button type="button" className="trial-text-link trial-quit" onClick={finishTrial}>
          チュートリアルをやめてホームへ
        </button>
      </div>
    );
  }

  if (step === 'done') {
    const service = title.watchService;
    const canSignup = !loggedIn && trialSource !== 'extension';
    return (
      <div className="trial-flow trial-center trial-fill">
        <div className="trial-step">チュートリアルはここまでです</div>
        {posterUrl(title) && (
          <div className="trial-done-poster">
            <img src={posterUrl(title)} alt="" />
          </div>
        )}
        <h1 className="trial-h">「{title.title}」の学習記録をコレクションに追加しました</h1>
        <p className="trial-note">{posterUrl(title) ? DONE_NOTE : DONE_NOTE_NO_POSTER}</p>
        <p className="trial-sub">{COLLECTION_NOTE}</p>
        <div className="trial-frames">
          {FRAME_TIERS.slice(1).map((t) => (
            <div key={t.key} className="trial-frame">
              <div className={'tcp-item frame-' + t.key}>
                <span className="tcp-frame">
                  <span className="tcp-mat">
                    <span className="trial-frame-blank" />
                  </span>
                </span>
              </div>
              <span className="trial-frame-label">
                {t.label} {t.min}%
              </span>
            </div>
          ))}
        </div>
        <p className="trial-note">{FRAME_NOTE}</p>
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
      <div className="trial-flow trial-center trial-fill">
        <h1 className="trial-h">次は、<span className="trial-nowrap">観ながら単語を集めましょう</span></h1>
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
    <div className="trial-flow trial-center trial-fill">
      <h1 className="trial-h">次は、<span className="trial-nowrap">観ながら単語を集めましょう</span></h1>
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
