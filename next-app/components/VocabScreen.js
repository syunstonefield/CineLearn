'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import VocabItem from './VocabItem';
import GenLoading from './GenLoading';
import {
  loadSrs,
  loadHistory,
  isDue,
  skipWord,
  unskipWord,
  episodeStats,
  saveHistoryEntry,
  updateHistoryWords,
  deleteHistoryEntry,
  todaySessionCount,
  todayStr,
} from '@/lib/storage';
import {
  fetchTitleCandidatesFromTMDb,
  resolveTitleCandidate,
  fetchSeasonInfoFromTMDb,
  fetchMovieInfoFromTMDb,
} from '@/lib/tmdb';
import { secToTimeLabel } from '@/lib/subtitles';
import { personalizeWords, fillMissingExampleJa } from '@/lib/vocab';
// ★2026-09-12: 字幕本文（生SRT/整形済み）はクライアントに置かない。生成は /api/vocab-generate に
//   1回投げて words だけを受け取り（generateEpisodeVocab）、字幕の有無は probeSubtitle で聞く。
import { generateEpisodeVocab, probeSubtitle, authHeaders } from '@/lib/api';
import {
  getMyWordsForEpisode,
  countUnassignedForDrama,
  fillExtWordJa,
  addManualWord,
  deleteMyWord,
} from '@/lib/words';
import { pushMyWord, ensureFreshSession } from '@/lib/supabase';
import { fetchJa } from '@/lib/jatranslate';
import { fetchCtxJa } from '@/lib/ctxtranslate';
import { getDeviceKey } from '@/lib/device';
import { selectQuizWords, buildQuizQuestions, prepIntegrity, orderWordsForPrep, getPrepped } from '@/lib/prep';
// 読み上げは lib/speak に一本化（独自コピーは cancel 直後 speak で無音になる既知バグ持ちだった）
import { speak } from '@/lib/speak';
import { backfillMissingExamples } from '@/lib/exampleBackfill';

export default function VocabScreen() {
  const app = useApp();
  const {
    drama,
    setDrama,
    settings,
    updateSettings,
    season,
    setSeason,
    episode,
    setEpisode,
    rememberEpisode,
    setScreen,
    vocabReturn,
    setQuizData,
    setCurrentHistoryId,
    goToQuiz,
    openReview,
    openPrepReview,
    openPrepQuiz,
    openPrepLaunch,
    openPrepWalk,
    reviewVersion,
    openAuth,
    loggedIn,
  } = app;
  const pid = app.profile?.id;

  // 単語リストへ来たら常に一番上から表示（コレクション等のスクロール位置を引き継がない）。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const [seasons, setSeasons] = useState([]); // dramaSeasonInfo
  const [isMovie, setIsMovie] = useState(false);
  const [statusText, setStatusText] = useState('シーズン情報を取得中...');
  const [phase, setPhase] = useState('loading'); // loading|empty|ready|generating|vocab|saved|nosub|error|soon
  const [message, setMessage] = useState(''); // empty-state / error text
  // カタログ外（phase==='soon'）の作品リクエスト状態（docs/design-curated-catalog.md §3）。
  // votes:null は票数取得不可（degrade）＝票数なしでリクエスト導線だけ出す。
  const [catReq, setCatReq] = useState({ votes: null, planned: false, requested: false, sending: false });
  const [retryMsg, setRetryMsg] = useState('');
  const [genStatus, setGenStatus] = useState('単語を分析中...'); // 生成ローディングの状態文言
  // 準備完了→「リストを見る」待ち（自動遷移しないロビー・2026-08-02）
  const [revealReady, setRevealReady] = useState(false);
  const [genBtn, setGenBtn] = useState({ text: '予習をはじめる →', disabled: true, hidden: false });
  const [vocab, setVocab] = useState([]);
  const [source, setSource] = useState('');
  const [extWords, setExtWords] = useState([]);
  // #20 手動追加（スマホ等・拡張なしでこの話に単語を足す）
  const [addWordText, setAddWordText] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState('');
  const [srs, setSrs] = useState({});
  const [mediaChoice, setMediaChoice] = useState(null); // {tv, movie}
  // タイプ（ドラマ/映画）確定・シーズン構築が済むまでエピソード選択枠を隠す
  const [selectorReady, setSelectorReady] = useState(false);
  // エピソード選択の折りたたみ（既定は畳む＝選択後すぐ単語へ。「変更」で展開）
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyId, setHistoryId] = useState(null);
  // 予習エンジン：下部3択ゾーンの表示フラグ。新規生成(onGenerate)成功時だけ true。
  // saved 再表示・error・soon・generating では出さない（finish line でなく launch ramp）。
  const [prepFresh, setPrepFresh] = useState(false);
  const [prepModes, setPrepModes] = useState(false); // 「次に進む」でモード選択ページへ
  // 生成直後は単語リストを経由せず予習ウォークスルーへ直行する（ユーザー要望）。
  // onGenerate 成功でこの一回限りフラグを立て、新出語が揃った瞬間に effect が開く。
  const [justGenerated, setJustGenerated] = useState(false);

  // 生成結果の付帯情報（2026-09-12）:
  //   genNote  … error 相の補助導線。{ login:true } で「ログインする」ボタン（生成枠の 429・A12(3)）
  //   notShared… 生成はできたが品質/coverage ゲートを通らず共有キャッシュに書かれなかった（A12(5)）
  const [genNote, setGenNote] = useState(null);
  // 匿名の生成枠 429 で「ログインする」を出した後にログインが完了したら、導線と文言を畳む
  //（出しっぱなしだと次に押すべき「単語を再生成」が埋もれる・レビュー指摘）。
  useEffect(() => {
    if (loggedIn && genNote?.login) {
      setGenNote(null);
      setMessage('ログインしました。「単語を再生成」で続けられます');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);
  const [notShared, setNotShared] = useState(false);
  // この作品の「話数を特定できなかった語」の件数（TV のみ・A22(b)）
  const [unassignedCount, setUnassignedCount] = useState(0);
  const reqId = useRef(0); // 競合する非同期処理を無効化するための世代カウンタ
  // 進行中の生成（fetch＋busy ポーリング）の中断ハンドル。unmount・話の切替で abort する。
  const genAbort = useRef(null);

  // ─ タイムスタンプ（各語の保存済みベース時刻 tsSec から）─
  //   生SRTはクライアントに存在しない（2026-09-12）。生成・共有キャッシュどちらの経路でもサーバが
  //   tsSec を焼いて返すので、表示はそれを使う。ラベルは保存済み tsLabel ではなく tsSec から都度
  //   整形する（旧フォーマットで保存された "67:30" 等を表示時に H:MM:SS へ正す）。
  const timestamps = useMemo(() => {
    const m = new Map();
    vocab.forEach((w) =>
      m.set(w.word, {
        sec: Number.isFinite(w.tsSec) ? w.tsSec : Infinity,
        label: Number.isFinite(w.tsSec) ? secToTimeLabel(w.tsSec) : null,
      })
    );
    return m;
  }, [vocab]);

  // 📍時刻：生成vocabは timestamps マップ、追加した単語(拡張保存)は保存済み tsSec から作る。
  const tsFor = (w) => {
    // plus 語（字幕外のAI作例）に📍は付けない。既存の共有キャッシュには分割生成の不整合で
    // 時刻が焼き付いた plus 語が居るため、表示側でも落とす（保存済みデータの救済）。
    if (w.source === 'plus') return null;
    return timestamps.get(w.word) || (w.tsSec != null ? { sec: w.tsSec, label: secToTimeLabel(w.tsSec) } : null);
  };

  // 重複除去＋タイムスタンプ順ソート（renderVocab 準拠）
  const sortedVocab = useMemo(() => {
    const seen = new Set();
    const uniq = vocab.filter((w) => {
      const k = w.word.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return [...uniq].sort(
      (a, b) => (timestamps.get(a.word)?.sec ?? Infinity) - (timestamps.get(b.word)?.sec ?? Infinity)
    );
  }, [vocab, timestamps]);

  // このドラマで学習済みのエピソード（シーズン→Set(episode)）。チップの状態表示に使う。
  const studiedByEp = useMemo(() => {
    const m = {};
    if (!drama) return m;
    loadHistory().forEach((h) => {
      if (h.drama?.title === drama.title && h.words?.length) {
        (m[h.season] = m[h.season] || new Set()).add(h.episode);
      }
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drama, historyId, reviewVersion]);

  const reloadSrs = useCallbackSafe(() => setSrs(loadSrs()), []);

  // SRS はマウント時に必ずロードする（クラウドから pull 済みの
  // 「覚えた/マスター」を保存済みリストの初回表示から反映させる）。
  // 復習モーダルが閉じたときも読み直してバッジ・進捗を更新。
  useEffect(() => {
    setSrs(loadSrs());
  }, [reviewVersion]);

  // 単語帳側で語が増減したら（拡張の保存・単語帳での削除・クラウド取り込み）この話の
  // 「追加した単語」も引き直す。上部の「覚えた/マスター n/総数」は追加語込みで数えているので、
  // これが無いと画面を開き直すまで件数が古いままになる（2026-08-07 オーナー要望）。
  useEffect(() => {
    if (!drama || !app.wordbookVersion) return;
    loadExtWords(season, episode, vocab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.wordbookVersion]);

  // 📍時刻を持たない「追加した単語」の後埋めは lib/exampleBackfill.js に統合した（2026-09-12・A13）。
  //   生SRTが端末に無いので、例文をアンカー（lineText）としてサーバの同じ照合器に時刻を聞く。
  //   loadExtWords → backfillMissingExamples が「例文なし」「例文あり・tsSec なし」の両方を扱う。

  // ── 話数を特定できなかった語の件数（A22(b)）──
  // 拡張が S/E を検出できずに保存した語は、この話のリストには出さず単語帳に残す（縮退）。
  // 所在が分かるよう作品ページ下部に件数と単語帳への導線を出す。型が確定してから数える
  // （selectorReady 前は drama.type が未確定＝映画を TV 扱いで数えてしまう）。
  useEffect(() => {
    if (!drama || !selectorReady) {
      setUnassignedCount(0);
      return;
    }
    let cancelled = false;
    countUnassignedForDrama(drama, pid)
      .then((n) => {
        if (!cancelled) setUnassignedCount(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drama?.title, isMovie, selectorReady, app.wordbookVersion, pid]);

  // 画面を離れたら進行中の生成（fetch・busy ポーリング）を打ち切る（A12(2)）。
  useEffect(() => () => genAbort.current?.abort(), []);

  // ── 生成直後＝予習ウォークスルーへ直行（justGenerated の一回限りトリガ）──
  // 新出語（sortedVocab）が揃い phase==='vocab' になった瞬間に1回だけ開く。
  // 閉じてもフラグは倒れているので再オープンしない（戻り先は従来のスクロール一覧のまま）。
  useEffect(() => {
    if (!justGenerated) return;
    if (!drama || phase !== 'vocab' || !sortedVocab.length) return;
    openPrepWalk(
      buildWalkPayload({ sortedVocab, timestamps, srs, drama, season, episode, isMovie, service: settings.selectedViewingService || '' })
    );
    setJustGenerated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justGenerated, phase, sortedVocab]);

  // ── example_ja のバックグラウンド補完（二重実行ガードつき）──
  const fillJaRunning = useRef(false);
  // ctx = { tmdbId, season, episode, type, rowWords? }（2026-09-11）。tmdbId があるとサーバが
  // 共有キャッシュ行の空欄も埋める。rowWords（行の全語）を渡すと最初の1人で行が完成する。
  const runFillExampleJa = useCallbackSafe(
    (words, hid, ctx = {}) => {
      if (fillJaRunning.current) return;
      const needDisplay = words.some((w) => w.example && !w.example_ja_ok);
      const needRow = (ctx.rowWords || []).some((w) => w && w.example && !w.example_ja);
      if (!needDisplay && !needRow) return; // 行まで埋まっていれば AI 呼び出しゼロ
      // 翻訳完了が遅れ、別エピソードへ切り替えた後に解決しても表示を上書きしないよう
      // 開始時点の世代を捕捉する（reqId は loadEpisode 等で進む）。
      const myReq = reqId.current;
      fillJaRunning.current = true;
      fillMissingExampleJa(words, ctx)
        .then((changed) => {
          if (!changed) return;
          updateHistoryWords(hid, words); // 履歴は hid 基準なので現在の表示に関係なく更新してよい
          if (myReq === reqId.current) setVocab([...words]); // 表示更新は同一エピソードの時だけ
        })
        .catch(() => {})
        .finally(() => {
          fillJaRunning.current = false;
        });
    },
    []
  );

  // ── 保存済み単語のチェック（checkAndShowSavedVocab のデータ部分）──
  const checkSaved = useCallbackSafe(
    async (se, ep) => {
      if (!drama) return false;
      const history = loadHistory();
      const entry = history.find(
        (h) => h.drama?.title === drama.title && h.season === se && h.episode === ep
      );
      if (entry?.words?.length) {
        setVocab(entry.words);
        setHistoryId(entry.id);
        // テスト画面用に履歴IDを共有。クイズは QuizScreen がローカルで毎回組み直すので
        // 保存済み（旧AI生成）の entry.quiz は読まない＝受けるたびに違う出題になる。
        setCurrentHistoryId(entry.id);
        setQuizData([]);
        setSource('');
        setPhase('saved');
        // 生成後に予習せず離れても再入場できるように（2026-08-05 オーナー要望）:
        // 予習未完了（ウォークスルー半券なし かつ クイズ未受験）の保存リストは
        // 「予習する →」バーを新規生成時と同様に出す（完了済みは従来どおり「クイズで腕試し」）。
        const prepDone =
          getPrepped(episodeId(drama, se, ep, drama.type === 'movie')) || !!entry.quizDate;
        setPrepFresh(!prepDone);
        setPrepModes(false);
        setGenBtn((b) => ({ ...b, hidden: true }));
        setStatusText(
          drama.type === 'movie'
            ? '✓ 保存済み'
            : `Season ${se} Episode ${ep} ✓ 保存済み`
        );
        // 📍タイムスタンプは各語の保存済み tsSec から表示する（timestamps useMemo）。
        // example_ja が無い単語をバックグラウンドで翻訳補完（共有キャッシュ経由・行の空欄も埋める）
        runFillExampleJa(entry.words, entry.id, {
          tmdbId: drama.tmdbId,
          season: se,
          episode: ep,
          type: drama.type,
        });
        loadExtWords(se, ep, entry.words);
        return true;
      }
      // 履歴なし → 拡張機能単語のみチェック
      // getMyWordsForEpisode はタイトル名寄せで TMDB を待つことがある。await 中に別
      // エピソードへ移った場合は何もしない（true=処理済み扱いで stale 側の後続も止める。
      // 放置すると古い世代の setPhase/setVocab が新しい画面を上書きする）。
      const myReq = reqId.current;
      const ext = await getMyWordsForEpisode(drama, se, ep, pid);
      if (myReq !== reqId.current) return true;
      if (ext.length) {
        setStatusText(drama.type === 'movie' ? '🎬 映画' : `Season ${se} Episode ${ep}`);
        setVocab([]);
        setPhase('empty');
        setMessage('「予習をはじめる」でAIが単語リストをつくります');
        setGenBtn({ text: '予習をはじめる →', disabled: false, hidden: false });
        loadExtWords(se, ep, []);
        return true;
      }
      return false;
    },
    [drama, pid]
  );

  // ── 拡張機能単語セクション（renderExtWordsSection のデータ部分）──
  const loadExtWords = useCallbackSafe(
    async (se, ep, existing) => {
      if (!drama) return;
      // 取得（ネットワーク）が遅れて別エピソードへ切り替えた後に解決しても、
      // 現在表示中の話に別話の拡張単語を出さないよう世代を捕捉する。
      const myReq = reqId.current;
      const ext = await getMyWordsForEpisode(drama, se, ep, pid);
      if (myReq !== reqId.current) return; // 別エピソードへ移っていたら破棄
      const existingSet = new Set((existing || []).map((w) => w.word.toLowerCase()));
      const newExt = ext
        .filter((w) => !existingSet.has(w.word.toLowerCase()))
        .map((w) => ({
          word: w.word,
          pos: w.pos || '',
          // 意味は「保存時の文脈訳(ja)」を最優先（拡張v1.2.2〜／多義語をその場面の意味に解決済み）。
          // 旧実装は ja をマッピングから落としていたため、単語リストで和訳が出ていなかった
          // （単語帳は ja を見るので出る＝2026-08-06 オーナー報告の直接原因）。
          ja: w.ja || '',
          definition: w.ja || w.definition || '',
          example: w.sentence || '',
          example_ja: w.example_ja || '',
          tsSec: w.tsSec ?? null, // 📍時刻（手動追加#20はローカルに保持・tsFor のフォールバックで表示）
          tier: w.tier || 'core',
          exampleFail: w.exampleFail || '', // 例文が取れなかった理由（③・カードに出す）
          source: 'ext',
          // 保存時の S/E を必ず写す。落とすと exampleBackfill が TV の語を映画(s0e0)として /api/example に送り、
          // 層1ミス→OS の movie 検索→nosub が my_words に永続化される（レビュー指摘）。
          season: w.season ?? null,
          episode: w.episode ?? null,
          origin: w.source || '', // 'manual'（アプリの手動追加）は backfill の対象外にする
        }));
      setExtWords(newExt);
      // 例文が付かなかった語をアプリ側から取り直す（②）。確定 tmdbId を渡すので、拡張が
      // 邦題を送って別作品に解決されていた事故（2026-08-08）を構造的に回避できる。
      // 失敗した語には理由が残り（③）、同じ失敗を毎回叩き直さない。
      if (newExt.length) {
        backfillMissingExamples(newExt, {
          drama,
          season: se,
          episode: ep,
          isMovie: drama?.type === 'movie' || drama?.mediaType === 'movie',
          profileId: pid,
        })
          .then((changed) => {
            if (changed && myReq === reqId.current) setExtWords([...newExt]);
          })
          .catch(() => {});
      }
      // 未取得の和訳（単語の意味・例文）をバックグラウンドで後埋めし、my_words へ永続化する。
      // 共有キャッシュ経路のみを使うので2人目以降は0円・同じ端末では2回目からネットワーク無し。
      if (newExt.length) {
        fillExtWordJa(newExt, pid)
          .then((changed) => {
            if (changed && myReq === reqId.current) setExtWords([...newExt]);
          })
          .catch(() => {});
      }
    },
    [drama, pid]
  );

  // ── 字幕の有無の確認（旧 preload / preloadSilent の置換・2026-09-12）──
  // 字幕本文は端末に取らない。`/api/subtitles action:'probe'` に {found,count} だけを聞いて
  // ready（生成ボタン活性）／nosub／error の相を決める。旧 preload が併せて行っていた
  // 「整形字幕で S/E 無し語をこの話へ自動割当（resolveUnassignedWords）」は縮退（A22）。
  // ★どの分岐でも「追加した単語」は読み込む（A12(1)）＝字幕が無い作品でも保存語の受け皿は出す。
  const probe = useCallbackSafe(
    async (se, ep, myReq) => {
      if (!drama) return;
      const movie = drama.type === 'movie';
      const label = (s) => (movie ? s : `Season ${se} Episode ${ep} ${s}`);
      if (!drama.tmdbId) {
        // 作品を特定できない（TMDB 未解決）。サーバは tmdbId 必須なので送らず、選び直しを案内する（A12(4)）。
        if (myReq !== reqId.current) return;
        setStatusText(label('⚠ 作品を特定できません'));
        setPhase('error');
        setMessage('作品を特定できないため単語リストを作れません（作品を選び直してください）');
        setGenBtn((b) => ({ ...b, hidden: true }));
        loadExtWords(se, ep, []);
        return;
      }
      try {
        const r = await probeSubtitle({
          tmdbId: drama.tmdbId,
          type: movie ? 'movie' : 'tv',
          season: movie ? 0 : se, // 映画は s0e0（サーバの cache_key と同じ規則・A15）
          episode: movie ? 0 : ep,
        });
        if (myReq !== reqId.current) return;
        if (r.found) {
          setStatusText(label('✓ 字幕あり'));
          setPhase('ready');
          setMessage('「予習をはじめる」を押してください');
          setGenBtn({ text: '予習をはじめる →', disabled: false, hidden: false });
        } else {
          setStatusText(label('⚠ 字幕なし'));
          setPhase('nosub');
          setMessage(
            movie
              ? 'この映画の字幕が見つかりませんでした。別の作品を選択してください。'
              : 'このエピソードの字幕が見つかりませんでした。別のエピソードを選択してください。'
          );
          setGenBtn((b) => ({ ...b, hidden: true }));
        }
      } catch (e) {
        if (myReq !== reqId.current) return;
        setStatusText(label('⚠ 字幕エラー'));
        setPhase('error');
        setMessage(
          e?.message && e.message !== '字幕の確認に失敗しました'
            ? `字幕の確認に失敗しました（${e.message}）`
            : '字幕の確認に失敗しました。時間をおいてもう一度お試しください。'
        );
        // 確認に失敗しただけなので生成は試せる（サーバ側で改めて字幕を探す）
        setGenBtn({ text: '予習をはじめる →', disabled: false, hidden: false });
      }
      if (myReq === reqId.current) loadExtWords(se, ep, []);
    },
    [drama, loadExtWords]
  );

  // ── エピソード読み込み（triggerEpisodeLoad 相当）──
  const loadEpisode = useCallbackSafe(
    async (se, ep) => {
      const myReq = ++reqId.current;
      genAbort.current?.abort(); // 前の話の生成待ち（busy ポーリング等）が残っていれば打ち切る
      rememberEpisode(drama?.title, se, ep); // #18: 最後に開いた S/E を作品ごとに記憶
      setVocab([]);
      setExtWords([]);
      setHistoryId(null);
      setPrepFresh(false); // 別エピソードへ移ったら下部3択は隠す（新規生成成功で再点灯）
      setNotShared(false);
      setGenNote(null);
      setGenBtn({ text: '予習をはじめる →', disabled: true, hidden: false });
      // 保存済みリストがあればそれを表示して終わり（📍は保存済み tsSec・字幕の取得は要らない）。
      if (await checkSaved(se, ep)) return;
      if (myReq !== reqId.current) return;
      setStatusText(`Season ${se} Episode ${ep} を選択中`);
      setPhase('loading');
      setMessage('');
      setGenBtn({ text: '読み込み中...', disabled: true, hidden: false });
      await probe(se, ep, myReq);
    },
    [drama, checkSaved, probe, rememberEpisode]
  );

  // 解決済みタイトル情報（type/seasons 等）を state・drama・myDramas に反映する
  const applyTitleInfo = useCallbackSafe(
    (info) => {
      if (info?.type === 'movie') {
        setIsMovie(true);
        setSeasons([]);
        drama.type = 'movie';
        drama.mediaType = 'movie';
        if (info.englishTitle) drama.englishTitle = info.englishTitle;
        if (info.tmdbId) drama.tmdbId = info.tmdbId;
        if (info.posterPath) drama.posterPath = info.posterPath;
      } else if (info) {
        setIsMovie(false);
        drama.type = 'tv';
        drama.mediaType = 'tv';
        if (info.englishTitle) drama.englishTitle = info.englishTitle;
        if (info.tmdbId) drama.tmdbId = info.tmdbId;
        if (info.posterPath) drama.posterPath = info.posterPath;
        setSeasons(info.seasons || [{ season: 1, episodes: 10 }]);
      } else {
        // 解決できなかった（TMDB不達・候補ゼロ）。★既に映画と分かっている作品を TV へ降格させない
        //   （降格すると S/E 前提の画面・出所表示になり、S/E を持たない映画の保存語が
        //     「S1E1」と誤表示される。2026-08-08 に実際に踏んだ）。既知の型は維持する。
        const knownMovie = drama.type === 'movie' || drama.mediaType === 'movie';
        setIsMovie(knownMovie);
        if (knownMovie) {
          setSeasons([]);
        } else {
          drama.type = 'tv';
          setSeasons([{ season: 1, episodes: 10 }, { season: 2, episodes: 10 }, { season: 3, episodes: 10 }]);
        }
      }
      const md = (settings.myDramas || []).map((d) =>
        d.title === drama.title
          ? { ...d, type: drama.type, mediaType: drama.mediaType, tmdbId: drama.tmdbId, englishTitle: drama.englishTitle, posterPath: drama.posterPath || d.posterPath }
          : d
      );
      updateSettings({ myDramas: md });
      setDrama({ ...drama });
    },
    [drama, settings, updateSettings]
  );

  // 候補をメタ情報に解決する（fetchTitleInfoFromTMDb の末尾フォールバック相当）
  const resolvePicked = useCallbackSafe(
    async (cand) => {
      const resolved = await resolveTitleCandidate(cand, drama.title);
      if (resolved) return resolved;
      const tvFb = await fetchSeasonInfoFromTMDb(drama.title);
      if (tvFb) return { type: 'tv', ...tvFb };
      const mvFb = await fetchMovieInfoFromTMDb(drama.title);
      if (mvFb) return { type: 'movie', ...mvFb };
      return null;
    },
    [drama]
  );

  // マウント/タイプ確定時に開く S/E（#18）。ハードコード S1E1 ではなく、遷移元が設定した
  // コンテキスト値（openDrama の「最後に開いた S/E」復元・半券のエピソード指定）を尊重し、
  // 解決済みシーズン構成の範囲内に丸める（構成変更・別作品の残骸で範囲外なら S1E1 へ）。
  // シーズン一覧は applyTitleInfo と同じ規則で info から直接導出する（setSeasons は非同期のため）。
  const clampInitialSE = (info) => {
    if (info?.type === 'movie') return { se: 1, ep: 1 };
    const list = info
      ? info.seasons || [{ season: 1, episodes: 10 }]
      : [{ season: 1, episodes: 10 }, { season: 2, episodes: 10 }, { season: 3, episodes: 10 }];
    const row = list.find((s) => s.season === season);
    if (!row) return { se: 1, ep: 1 };
    return { se: season, ep: episode >= 1 && episode <= (row.episodes || 1) ? episode : 1 };
  };

  // ドラマ/映画の選択ボタンのクリック（通常のイベントハンドラ。
  // 以前の Promise+resolve 方式は StrictMode の二重実行でキャンセル済み実行に
  // resolve が束縛され「押しても無反応」になることがあったため廃止）。
  const pickMedia = useCallbackSafe(
    async (cand) => {
      const myReq = ++reqId.current;
      setMediaChoice(null);
      setPhase('loading');
      setStatusText('シーズン情報を取得中...');
      let info = null;
      try {
        info = await resolvePicked(cand);
      } catch {
        info = null;
      }
      if (myReq !== reqId.current) return;
      applyTitleInfo(info);
      setSelectorReady(true); // タイプ確定・シーズン構築済み → 選択枠を表示
      const { se, ep } = clampInitialSE(info);
      setSeason(se);
      setEpisode(ep);
      await loadEpisode(se, ep);
    },
    [resolvePicked, applyTitleInfo, loadEpisode, clampInitialSE]
  );

  // ── 画面マウント：タイトル情報取得 → シーズン構築 → 初回ロード ──
  useEffect(() => {
    if (!drama) return;
    let cancelled = false;
    const myReq = ++reqId.current;
    (async () => {
      setPhase('loading');
      setStatusText('シーズン情報を取得中...');
      setGenBtn({ text: '予習をはじめる →', disabled: true, hidden: false });
      // ドラマ/映画の判定・シーズン構築が終わるまでエピソード選択枠ごと隠す。
      // 確定前に操作されると未確定のドラマ状態（englishTitle/type未設定）で
      // 字幕取得が走って壊れるため（既存 546da24 と同じ対策）。
      setSelectorReady(false);

      let candidates = { tv: null, movie: null };
      try {
        candidates = await fetchTitleCandidatesFromTMDb(drama.title);
      } catch {
        candidates = { tv: null, movie: null };
      }
      if (cancelled || myReq !== reqId.current) return;

      const { tv, movie } = candidates;
      const hint = drama.mediaType;
      let pick = null;
      if (hint === 'tv') pick = tv || movie;
      else if (hint === 'movie') pick = movie || tv;
      else if (tv && movie) {
        // ドラマ版・映画版の両方あり → ユーザーに選ばせて中断（pickMedia が続行）
        setMediaChoice({ tv, mv: movie });
        setStatusText('どちらの作品か選んでください');
        return;
      } else {
        pick = tv || movie;
      }

      let info = null;
      try {
        info = await resolvePicked(pick);
      } catch {
        info = null;
      }
      if (cancelled || myReq !== reqId.current) return;
      applyTitleInfo(info);
      setSelectorReady(true); // タイプ確定・シーズン構築済み → 選択枠を表示
      const { se, ep } = clampInitialSE(info);
      setSeason(se);
      setEpisode(ep);
      await loadEpisode(se, ep);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drama?.title]);

  // ── 単語生成（generateVocabFromEpisode 相当・2026-09-12 サーバ完結版）──
  // `POST /api/vocab-generate` 1回で「共有キャッシュ参照 →（ミス時）字幕取得 → 生成 → tsSec 付与 →
  // 品質/coverage ゲート → 共有キャッシュ書込」がサーバ内で完結し、words（語＋例文1文＋tsSec）だけが
  // 返る。クライアントは応答 words に example_ja_ok を付けて personalizeWords で学習者レベルに絞るだけ
  // （旧: 生SRT を端末に取り、プロンプトを組んで /api/claude へ送り、寄与ルートへ投稿していた）。
  // 応答の分岐（lib/api.js generateEpisodeVocab の kind）:
  //   hit / generated → 表示・履歴保存（generated で meta.contributed===false なら「共有されません」）
  //   blocked         → カタログ外＝「近日対応」（リクエスト受付・cl_catalog_admin の端末バイパスは廃止）
  //   busy(409)       → 他の人が同じ話を生成中。retryAfterSec 間隔で同じ呼び出しを繰り返す（最長 300s）
  //   nosub           → phase nosub（枠は消費済み）
  //   nogen / rate_limited / unavailable / upstream / error → phase error ＋「単語を再生成」
  const onGenerate = useCallbackSafe(async () => {
    if (!drama) return;
    const myReq = reqId.current;
    const movie = drama.type === 'movie';
    const epLabel = (s) => (movie ? s : `Season ${season} Episode ${episode} ${s}`);
    // error 相への共通遷移（再生成ボタンを残す）
    const fail = (msg, note = null) => {
      setPhase('error');
      setPrepFresh(false); // error では下部3択を出さない
      setMessage(msg);
      setGenNote(note);
      setGenBtn({ text: '単語を再生成', disabled: false, hidden: false });
    };
    // 作品を特定できない（tmdbId 無し）作品は送らない（A12(4)）。サーバは tmdbId 必須。
    if (!drama.tmdbId) {
      fail('作品を特定できないため単語リストを作れません（作品を選び直してください）');
      setGenBtn({ text: '予習をはじめる →', disabled: true, hidden: true });
      return;
    }
    const lobbyT0 = Date.now(); // ロビー最低滞在の起点（キャッシュ命中の即抜け防止）
    setRevealReady(false);
    setGenBtn({ text: '生成中...', disabled: true, hidden: false });
    setPhase('generating');
    setGenStatus('字幕を確認中...');
    setRetryMsg('');
    setGenNote(null);
    setNotShared(false);

    const personalizeOpts = {
      toeicScore: settings.toeicScore || 0,
      targetToeicScore: settings.targetToeicScore || 0,
      vocabCount: settings.vocabCount || 30,
    };

    // 中断制御（A12(2)）: 画面離脱（unmount）・話の切替（loadEpisode）で fetch と busy 待ちを abort する。
    genAbort.current?.abort();
    const ac = new AbortController();
    genAbort.current = ac;
    const stale = () => myReq !== reqId.current || ac.signal.aborted;
    // busy 待ち: 1秒刻みで残り秒数を更新しながら待つ（abort で即抜け）
    const waitBusy = (waitSec, remainSec) =>
      new Promise((resolve) => {
        let left = waitSec;
        const tick = () => {
          if (ac.signal.aborted || left <= 0) return resolve();
          setGenStatus(`他の方が同じ話を生成中です（残り約${Math.max(1, Math.round(remainSec - (waitSec - left)))}秒）`);
          left -= 1;
          setTimeout(tick, 1000);
        };
        tick();
      });
    // 429 の resetAtUtc（ISO）を JST の時刻文字列へ（不正・欠落は空）
    const jst = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return '';
      try {
        return d.toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Tokyo' });
      } catch {
        return '';
      }
    };

    try {
      // 生成前にセッションを更新（期限切れ JWT を送ると匿名扱い＝1日の枠が小さい・A12(3)）。
      await ensureFreshSession();
      if (stale()) return;

      const body = {
        tmdbId: drama.tmdbId,
        type: movie ? 'movie' : 'tv',
        season: movie ? 0 : season, // 映画は s0e0（サーバ側でも正規化・A15）
        episode: movie ? 0 : episode,
        // title 系は任意（≤120字・ログ用途のみ。作品名の正は TMDB 解決値・A6）
        title: String(drama.title || '').slice(0, 120),
        englishTitle: String(drama.englishTitle || '').slice(0, 120),
        displayTitle: String(drama.englishTitle || drama.title || '').slice(0, 120),
        vocabCount: Math.min(60, Math.max(20, Number(settings.vocabCount) || 40)),
      };
      setGenStatus('単語を分析中...');
      let r = await generateEpisodeVocab(body, { signal: ac.signal });

      // 409 busy: 同じ話を他の人が生成中。cache-first なので終われば hit で返る。上限 300s。
      const BUSY_MAX_MS = 300_000;
      const busyT0 = Date.now();
      while (r.kind === 'busy' && !stale()) {
        const elapsedMs = Date.now() - busyT0;
        if (elapsedMs >= BUSY_MAX_MS) {
          r = { kind: 'nogen', reason: 'busy_timeout' };
          break;
        }
        const budgetSec = Math.ceil((BUSY_MAX_MS - elapsedMs) / 1000);
        const remainSec = Math.max(1, Math.min(r.ttlSec ?? budgetSec, budgetSec));
        const waitSec = Math.max(1, Math.min(r.retryAfterSec, remainSec));
        await waitBusy(waitSec, remainSec);
        if (stale()) return;
        r = await generateEpisodeVocab(body, { signal: ac.signal });
      }
      if (stale()) return; // 取得中にエピソードが切り替わった／画面を離れたら破棄（別話の上書き防止）

      if (r.kind === 'aborted') return;

      if (r.kind === 'blocked') {
        // カタログ外 → リクエスト受付（生成しない）。ゲートはサーバ側で判定する（管理者は CL_ADMIN_USER_IDS）。
        // 言葉の掟: 「非対応」と言わない・リクエストで巻き込む（user-voice討論）。
        setVocab([]);
        setSource('');
        setPrepFresh(false); // soon では下部3択を出さない
        setMessage('');
        setPhase('soon');
        setGenBtn({ text: '予習をはじめる →', disabled: true, hidden: true });
        // リクエスト状態（票数・対応予定・この端末の投票済み）を非同期で取得
        setCatReq({ votes: null, planned: false, requested: false, sending: false });
        try {
          const res = await fetch('/api/catalog-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'status', tmdbId: drama.tmdbId, userKey: getDeviceKey() }),
          });
          const st = await res.json();
          if (myReq === reqId.current && st && !st.error) {
            setCatReq({ votes: st.votes ?? null, planned: !!st.planned, requested: !!st.requested, sending: false });
          }
        } catch {
          /* 状態取得失敗はボタンだけ表示 */
        }
        return;
      }

      if (r.kind === 'nosub') {
        setStatusText(epLabel('⚠ 字幕なし'));
        setPhase('nosub');
        setPrepFresh(false);
        setMessage(
          movie
            ? 'この映画の字幕が見つかりませんでした。別の作品を選択してください。'
            : 'このエピソードの字幕が見つかりませんでした。別のエピソードを選択してください。'
        );
        setGenBtn((b) => ({ ...b, hidden: true }));
        return;
      }

      if (r.kind === 'nogen') {
        // 否定キャッシュ（直近の失敗を最長1時間覚えている）。理由ごとに次の一手を書く。
        // キーはサーバが否定キャッシュに書く reason の実値（vocab-generate/route.js PUBLIC_REASONS）に合わせる。
        const UPSTREAM_NOGEN = '生成サービスが混み合っています。しばらくしてから「単語を再生成」をお試しください';
        const NOGEN_MSG = {
          nosub: '字幕が見つからなかったため単語リストを作れませんでした。しばらくしてから「単語を再生成」をお試しください',
          gate: '生成した単語リストが品質基準に達しませんでした。しばらくしてから「単語を再生成」をお試しください',
          coverage: '生成した単語リストが作品の一部に偏っていました。しばらくしてから「単語を再生成」をお試しください',
          // 字幕サービスの共有枠が尽きた（A5）。作品側の問題ではない＝nosub と分ける
          os_quota: '字幕サービスの本日の取得枠が上限です。生成済みの作品はそのまま使えます',
          os_search: UPSTREAM_NOGEN,
          os_download: UPSTREAM_NOGEN,
          llm: UPSTREAM_NOGEN,
          generation: UPSTREAM_NOGEN,
          internal: UPSTREAM_NOGEN,
          tmdb: '作品情報の取得に失敗しました。しばらくしてからお試しください',
          timeout: '生成に時間がかかりすぎました。しばらくしてから「単語を再生成」をお試しください',
          repeated_failure: 'この話の生成が続けて失敗したため、本日は再生成を止めています。明日以降にお試しください',
          busy_timeout: '他の方の生成が終わりませんでした。しばらくしてから「単語を再生成」をお試しください',
        };
        fail(
          NOGEN_MSG[r.reason] ||
            '直近の生成が失敗したため、しばらく（最長1時間）は再生成できません。時間をおいてお試しください'
        );
        return;
      }

      if (r.kind === 'rate_limited') {
        // 生成枠（A12(3)・A28）。scope/window/resetAtUtc から文言を組み、匿名/日にはログイン導線を付ける。
        const reset = jst(r.resetAtUtc);
        const resetNote = reset ? `${reset}（JST）にリセットされます。` : '';
        if (r.scope === 'unavailable') {
          fail('混雑しています。数分後にお試しください');
        } else if (loggedIn && r.scope === 'anon' && !r.loginHint) {
          // 認証サーバー不達で匿名扱いになった（A28）: 再ログインではなく再試行を促す
          fail('認証サーバーに接続できませんでした。しばらくしてからもう一度お試しください');
        } else if (loggedIn && r.scope === 'anon') {
          fail('ログインの有効期限が切れました。再ログインしてください', { login: true });
          openAuth();
        } else if (r.window === 'hour') {
          fail(`1時間の生成枠に達しました。${resetNote}`);
        } else if (r.window === 'min') {
          fail('短時間に生成が集中しています。1分ほど待ってからお試しください');
        } else if (r.scope === 'ip') {
          fail(`このネットワークからの本日の生成枠に達しました。${resetNote}`);
        } else if (r.scope === 'user') {
          fail(`本日の生成枠（${r.limit ?? r.userDayLimit ?? 30}話）に達しました。${resetNote}`);
        } else {
          // 上限値はサーバ応答（env で上書き可）を使い、無ければ既定の 8/30（文言と実態のズレを防ぐ）
          fail(
            `本日の生成枠（${r.limit ?? r.anonDayLimit ?? 8}話）に達しました。${resetNote}ログインすると1日${r.userDayLimit ?? 30}話に増えます`,
            { login: true }
          );
        }
        return;
      }

      if (r.kind === 'unavailable') {
        fail('混雑しています。数分後にお試しください');
        return;
      }

      if (r.kind === 'upstream') {
        const UPSTREAM_MSG = {
          // 字幕サービスの共有枠が尽きた（A5）。nosub とは分ける＝作品側の問題ではない。
          os_quota: '字幕サービスの本日の取得枠が上限です。生成済みの作品はそのまま使えます',
          timeout: '生成に時間がかかりすぎました。しばらくしてから「単語を再生成」をお試しください',
          tmdb: '作品情報の取得に失敗しました。しばらくしてからお試しください',
        };
        fail(UPSTREAM_MSG[r.reason] || '生成サービスに接続できませんでした。しばらくしてから「単語を再生成」をお試しください');
        return;
      }

      if (r.kind !== 'hit' && r.kind !== 'generated') {
        fail(r.message || '生成に失敗しました');
        return;
      }

      // ── hit / generated: 学習者レベルで絞って表示 ──
      // シード済み／生成直後の行は example_ja が入っていることがある。キャッシュ保存時に transient フラグ
      // example_ja_ok を落としているため、そのままだと fillMissingExampleJa が全語を「未訳」とみなして
      // 訳し直す（本番実測: Suits S1E1 は 86/87 語が既訳）。訳があるものは既訳として扱う。
      const rowWords = r.words.map((w) => ({ ...w, example_ja_ok: !!w.example_ja }));
      const words = personalizeWords(rowWords, personalizeOpts);
      // 0語は成功扱いにしない（空リスト＋ボタン消滅で沈黙する既知の穴・2026-08-02）。
      if (!words.length) {
        fail('単語リストを作れませんでした。時間をおいて「単語を再生成」をお試しください');
        return;
      }
      const srcLabel = r.kind === 'hit' ? '共有キャッシュ（生成済み）' : '実際の字幕データから';
      // 品質/coverage ゲートを通らなかった生成は共有キャッシュに書かれない（表示はする・A12(5)）
      setNotShared(r.kind === 'generated' && r.meta?.contributed === false);

      // 3) 仕上げ・表示・保存
      setGenStatus('仕上げ中...');
      setRetryMsg('');

      // ロビー最低滞在（2026-08-02 オーナー決定）: キャッシュ命中だと一瞬で終わり、
      // 個人化（既知語除外・レベル帯選定）の実感もあらすじ/Tipsを読む間も無いため、
      // 実処理に対応した段階ステータスで最低 MIN_LOBBY_MS は留める。生成が遅かった時は追加で待たせない。
      const MIN_LOBBY_MS = 4500;
      const lobbySleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
      if (Date.now() - lobbyT0 < MIN_LOBBY_MS) {
        setGenStatus('あなたのレベルに合わせて選定中...');
        await lobbySleep(Math.max(0, Math.min(1800, lobbyT0 + MIN_LOBBY_MS - 1500 - Date.now())));
        if (stale()) return;
        setGenStatus('リストを仕上げ中...');
        await lobbySleep(Math.max(0, lobbyT0 + MIN_LOBBY_MS - Date.now()));
        if (stale()) return;
      }

      setVocab(words);
      setSource(srcLabel);
      setPrepFresh(true); // 新規生成成功 → 下部「予習する」（再入場用）を残す
      setPrepModes(false);
      setGenBtn({ text: '単語を再生成', disabled: false, hidden: true });
      // 自動でリストへ遷移しない: 「準備ができました — リストを見る →」を出して本人のタップで開く
      // （phase は 'generating' のまま・GenLoading が ready 表示に切り替わる）。
      setRevealReady(true);

      // 履歴に保存
      const id = saveHistoryEntry({
        drama,
        season,
        episode,
        userLevel: settings.userLevel,
        targetLevel: settings.targetToeicScore > 0 ? settings.targetLevel : null,
        words,
      });
      setHistoryId(id);
      setCurrentHistoryId(id);
      setQuizData([]); // 前回のクイズをクリア（テストを開いた時に QuizScreen で遅延生成）
      reloadSrs();
      loadExtWords(season, episode, words);
      // example_ja が欠けた単語をバックグラウンドで翻訳補完。共有キャッシュ行は応答前にサーバが
      // 書き終えている（§2 手順8）ので、寄与の着地を待つ必要は無い。表示はブロックしない。
      runFillExampleJa(words, id, { tmdbId: drama.tmdbId, season, episode, type: drama.type, rowWords });
      // クイズはここでは生成しない。ユーザーがテストを開いた時に QuizScreen 側で生成する。
    } catch (e) {
      if (stale()) return;
      fail(e?.message || '生成に失敗しました');
    }
  }, [drama, season, episode, settings, loggedIn, openAuth, reloadSrs, loadExtWords]);

  // ── ハンドラ ──
  // ロビーの「リストを見る →」: ここで初めてリスト表示＋予習ウォークスルー直行が発火する
  const revealList = () => {
    setRevealReady(false);
    setPhase('vocab');
    setJustGenerated(true); // 生成直後は予習ウォークスルーへ直行（effect が新出語の揃った瞬間に開く）
  };
  const handleSkip = (word, isSkip) => {
    isSkip ? unskipWord(word) : skipWord(word);
    reloadSrs();
  };
  // カタログ外作品のリクエスト送信（1端末1票・重複はサーバ側 upsert で吸収）
  const sendCatalogRequest = async () => {
    if (!drama?.tmdbId || catReq.sending || catReq.requested) return;
    setCatReq((c) => ({ ...c, sending: true }));
    try {
      const res = await fetch('/api/catalog-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request',
          tmdbId: drama.tmdbId,
          title: drama.englishTitle || drama.title,
          type: drama.type === 'movie' ? 'movie' : 'tv',
          userKey: getDeviceKey(),
        }),
      });
      const d = await res.json();
      if (d?.ok) {
        setCatReq((c) => ({ ...c, requested: true, votes: d.votes ?? c.votes, sending: false }));
      } else {
        setCatReq((c) => ({ ...c, sending: false }));
      }
    } catch {
      setCatReq((c) => ({ ...c, sending: false }));
    }
  };
  const handleCopyTime = (time) => {
    navigator.clipboard?.writeText(time).catch(() => {});
  };

  // ── #20 単語の手動追加（スマホ等・拡張なしでこの話に語を足す）──
  //   例文: /api/example mode:'manual' に1回だけ問い合わせ（層1: 共有キャッシュの語一致 →
  //         層2: サーバの raw キャッシュ命中時のみ字幕1文・ログイン必須）。無ければ例文なし。
  //   訳: 例文があれば文脈つき語義（「この場面では」fetchCtxJa）→ 無ければ1語訳（fetchJa）。
  //   保存: ローカル（addManualWord）＋ログイン時はクラウド（pushMyWord）。
  //   表示は既存の「✏️ 追加した単語」セクション（loadExtWords 再読込）に合流する。
  const handleAddWord = async () => {
    if (addBusy) return;
    const w = addWordText.trim().replace(/\s+/g, ' ');
    if (!w) {
      setAddMsg('追加したい英単語を入力してください'); // 空タップを黙殺しない（無反応に見せない）
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z' -]{0,39}$/.test(w)) {
      setAddMsg('英単語（またはフレーズ）を入力してください');
      return;
    }
    const lower = w.toLowerCase();
    if (
      sortedVocab.some((x) => x.word.toLowerCase() === lower) ||
      extWords.some((x) => x.word.toLowerCase() === lower)
    ) {
      setAddMsg('すでにこの話のリストにあります');
      return;
    }
    setAddBusy(true);
    setAddMsg('');
    try {
      // 例文は /api/example に `mode:'manual'` で1回だけ聞く（2026-09-12・A4）:
      //   層1: 共有キャッシュ（vocab_cache）の語一致は誰でも可
      //   層2: サーバの subtitle_raw_cache に raw があるときだけ字幕1文（OS DL は誘発しない・ログイン必須）
      // 端末の生SRTでの照合（旧①）は、生SRTを端末に置かなくなったので消えた。無ければ例文なしで保存。
      let hit = null;
      let reason = '';
      try {
        const res = await fetch('/api/example', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            mode: 'manual',
            word: w,
            tmdbId: drama.tmdbId ?? undefined,
            title: drama.englishTitle || drama.title,
            season: isMovie ? null : season,
            episode: isMovie ? null : episode,
          }),
        });
        const d = await res.json().catch(() => null);
        if (d?.found && d.sentence) hit = { sentence: d.sentence, sec: Number.isFinite(d.tsSec) ? d.tsSec : null };
        else reason = d?.reason || (res.ok ? '' : 'network');
      } catch {
        reason = 'network';
      }
      const ja = (hit?.sentence ? await fetchCtxJa(w, hit.sentence) : null) ?? (await fetchJa(w)) ?? '';
      const exampleJa = hit?.sentence ? (await fetchJa(hit.sentence)) || '' : '';
      const entry = {
        word: w,
        sentence: hit?.sentence || '',
        phonetic: '',
        pos: '',
        definition: ja, // 単語リストの意味欄（VocabItem は definition を表示する）
        ja: ja || null, // 単語帳の文脈訳と同じ欄（WordbookScreen が優先表示）
        example_ja: exampleJa,
        tsSec: hit?.sec ?? null,
        savedAt: todayStr(),
        source: 'manual',
        dramaTitle: drama.title,
        season: isMovie ? null : season,
        episode: isMovie ? null : episode,
      };
      const merged = await addManualWord(pid, entry);
      pushMyWord(merged || entry); // マージ後の姿をクラウドへ（遭遇ログ・既存値保護をローカルと一致させる）
      setAddWordText('');
      // 例文が付かなかった理由を正直に添える（A4）。「見つかりませんでした」は探して無かった時だけ。
      const NOTE = {
        no_raw: '（この話の字幕データが未取得のため例文なしで保存しました）',
        login_required: '（ログインすると例文が付きます）',
        common_word: '（よく使う語のため例文は付けません）',
        multi_token: '（例文が付くのは1語のみです。フレーズは例文なしで保存しました）',
        too_short: '（3文字以上の語にのみ例文を探します）',
        rate_limited: '（混み合っているため例文なしで保存しました）',
        unavailable: '（混み合っているため例文なしで保存しました）',
        tmdb_unresolved: '（作品を特定できず例文なしで保存しました）',
        missing_params: '（作品情報が足りず例文なしで保存しました）',
        network: '（通信に失敗したため例文なしで保存しました）',
        no_match: '（この話の字幕に見つからず例文なし）', // 探して無かった時だけ「見つからず」
      };
      setAddMsg(
        hit
          ? `「${w}」を追加しました ✓`
          : `「${w}」を追加しました${NOTE[reason] || '（例文なしで保存しました）'}`
      );
      loadExtWords(season, episode, vocab); // ✏️セクションへ即反映
    } finally {
      setAddBusy(false);
    }
  };

  // 追加した単語の削除（タイポ救済）。ローカル両キー＋ログイン時はクラウドの行も消す
  // （deleteMyWord 内で伝搬）。表示は即時に間引く。
  const handleDeleteExtWord = async (word) => {
    if (!confirm(`「${word}」を単語帳から削除しますか？`)) return;
    await deleteMyWord(pid, word);
    setExtWords((list) => list.filter((w) => w.word.toLowerCase() !== word.toLowerCase()));
  };
  const pickSeason = (se) => {
    if (se === season) return;
    setSeason(se);
    setEpisode(1);
    loadEpisode(se, 1);
  };
  const pickEpisode = (ep) => {
    setEpisode(ep);
    loadEpisode(season, ep);
    setPickerOpen(false); // 選択したら畳んで単語リストへ（スマホで長いグリッドを越えてスクロールしない）
  };
  const onDelete = () => {
    if (!confirm('この単語リストを削除しますか？')) return;
    deleteHistoryEntry(historyId);
    setHistoryId(null);
    setVocab([]);
    setExtWords([]);
    setPrepFresh(false);
    setPhase('empty');
    setMessage('エピソードを選んでください');
    setStatusText('');
    setGenBtn({ text: '予習をはじめる →', disabled: false, hidden: false });
  };

  if (!drama) return null;

  const currentSeasonInfo = seasons.find((s) => s.season === season);
  const epCount = currentSeasonInfo?.episodes || 10;

  const dramaWords = sortedVocab.filter((w) => w.source !== 'plus');
  const plusWords = sortedVocab.filter((w) => w.source === 'plus');
  // 今日の復習・対象集計はエピソードの単語＋「追加した単語」(拡張保存)を統合（重複は語で排除）。
  const seenForReview = new Set(sortedVocab.map((w) => w.word.toLowerCase()));
  const reviewWords = [
    ...sortedVocab,
    ...extWords.filter((w) => w.word && !seenForReview.has(w.word.toLowerCase())),
  ];
  const stats = episodeStats(reviewWords, srs);
  // 追加した単語の並べ方（設定・既定=混ぜる／2026-08-07 オーナー要望）。
  //   混ぜる  : 本編の語と一本のリストにして📍時刻順（時刻なしは末尾）。どれが追加語かは
  //             行の「追加」チップで分かるので、セクションで隔てる必要はない。
  //   混ぜない: 従来どおり「✏️ 追加した単語」として末尾にまとめる。
  const mergeAdded = settings.mergeAddedWords !== false;
  const extOnly = extWords.filter((w) => w.word && !seenForReview.has(w.word.toLowerCase()));
  const mainWords = mergeAdded
    ? [...dramaWords, ...extOnly].sort(
        (a, b) => (tsFor(a)?.sec ?? Infinity) - (tsFor(b)?.sec ?? Infinity)
      )
    : dramaWords;

  // 「追加した単語」セクション。AI単語リストの有無に関係なく描けるよう関数に切り出す。
  //   ★2026-08-08: このセクションは従来 `showVocab && sortedVocab.length` の中だけにあり、
  //     **単語リストを生成していない作品では1件も描画されなかった**（Disney+ の映画を観ながら
  //     クリック保存 → アプリで開いても「予習をはじめる」の空画面、が実際の症状）。
  //     保存した語の受け皿は生成の有無と独立であるべきなので、空/字幕なしの画面にも出す。
  const renderAddedWords = (label) => {
    if (!extWords.length) return null;
    return (
      <div id="ext-words-section">
        <div className="source-label" style={{ marginTop: 14 }}>
          {label}
        </div>
        <div className="vocab-list">
          {extWords.map((w) => (
            <VocabItem
              key={w.word}
              word={w}
              srs={srs}
              testTiers={testTiers}
              ts={tsFor(w)}
              exampleSource={exampleCredit}
              onSpeak={speak}
              onSkip={handleSkip}
              onCopyTime={handleCopyTime}
              onDelete={handleDeleteExtWord}
            />
          ))}
        </div>
      </div>
    );
  };
  // 今日の復習セッション数（srs/reviewVersion 変化で再レンダーされるため毎回読み直す）
  const doneToday = historyId ? todaySessionCount(historyId) : 0;
  const testTiers = settings.testTiers || ['core', 'advanced'];
  const showVocab = phase === 'vocab' || phase === 'saved';
  // この話を予習済みか（完了で永続化・「✓予習済み」表示用）。tickets 変化で再評価される。
  const prepped = getPrepped(episodeId(drama, season, episode, isMovie));

  // 出所明示（著作権法48条）：このリストの例文＝字幕の逐語引用の出典。
  // drama語/ext語（字幕由来）に付け、plus語（Claude作例・字幕外）には付けない。
  const exampleCredit = isMovie
    ? `📺 ${drama.title}（字幕：OpenSubtitles）`
    : `📺 ${drama.title} S${season}E${episode}（字幕：OpenSubtitles）`;

  // ── 予習エンジン（下部3択ゾーン）─────────────────────────
  // このエピソードの新出語（SRS にエントリ無し＝今夜が初対面）。「じっくり覚える」first-pass の対象。
  const episodeNewWords = sortedVocab.filter((w) => !srs[w.word.toLowerCase()]);
  // 誠実指標（予習時点で真な数だけ・「覚えた」は使わない）。
  const integrity = prepIntegrity(sortedVocab);
  // launch ramp / クイズの共通メタ。
  const prepMeta = {
    drama,
    title: drama.title,
    season,
    episode,
    isMovie,
    service: settings.selectedViewingService || '',
    integrity,
    freshCount: integrity.fresh,
    credit: exampleCredit, // 出所明示（48条）：クイズ/チケット裏の実セリフ表示にも付ける
  };

  // 主：「今夜のリハーサル」＝クイズ3問を起動（出題語を自動選定→3問を組む）。
  const startPrepQuiz = () => {
    const quizWords = selectQuizWords(sortedVocab, 3, srs); // マスター済みは出題しない(#7b)
    if (!quizWords.length) {
      // 出題できる実セリフ例文が無ければクイズは諦め、最小の watch ramp へ逃がす。
      openPrepLaunch({ variant: 'watch', ...prepMeta });
      return;
    }
    const questions = buildQuizQuestions(quizWords, sortedVocab);
    openPrepQuiz({ questions, meta: prepMeta });
  };

  // 副：「じっくり覚える」＝このエピソードの新出語で ReviewModal を first-pass 起動。
  // 閉じたら cards の launch ramp が出る（openPrepReview が予約）。
  const startPrepCards = () => {
    const words = (episodeNewWords.length ? episodeNewWords : sortedVocab).map((w) => ({
      ...w,
      _src: { title: drama.title, season, episode, type: drama.type },
    }));
    openPrepReview(words, { ...prepMeta, cardCount: words.length });
  };

  // 逃げ：「今夜は観るだけ」＝最小 launch ramp（無摩擦・観るは常に一級）。
  const startPrepWatch = () => openPrepLaunch({ variant: 'watch', ...prepMeta });

  // 主動線：予習ウォークスルー＝全語を1枚ずつ通し見（生成直後だけ）。
  //   ★単語リスト（スクロール一覧）は変えない。これは“予習”専用の表示で、見終えたら一覧へ戻る。
  //   📍時刻ラベルは timestamps から各語へ焼いて渡す（ウォークスルー側で再計算しない）。
  const openWalkthrough = () => {
    openPrepWalk(
      buildWalkPayload({ sortedVocab, timestamps, srs, drama, season, episode, isMovie, service: settings.selectedViewingService || '' })
    );
  };

  // 進捗バー（buildProgressHTML 準拠）
  const pct = stats.total === 0 ? 0 : Math.round((stats.learned / stats.total) * 100);
  // テンションの上がるゲージ：グレーは使わない。低〜中=鮮やかなエメラルド、達成=ゴールドで祝福。
  const pctColor = pct === 100 ? '#d99a00' : pct >= 60 ? '#13967f' : '#16a06a';
  const barFill =
    pct === 100
      ? 'linear-gradient(90deg, #19a06a, #f5c518)'
      : 'linear-gradient(90deg, #16a06a, #3ccb8d)';
  const completeMsg =
    stats.total > 0 && stats.learned === stats.total
      ? stats.mastered === stats.total
        ? '🌟 全単語マスター達成！'
        : '✨ 全単語「覚えた」達成！'
      : '';

  // ── 予習エンジン：モード選択ページ（「次に進む」で遷移）──────────────
  //   3つは同じ大きさ・色で誘導（リハーサル=アクセント/じっくり=accent2/観るだけ=中立）。
  if (showVocab && sortedVocab.length > 0 && prepFresh && prepModes) {
    return (
      <div className="screen active" id="screen-4">
        <div className="screen-inner">
          <div className="screen-header">
            <button className="btn-back" onClick={() => setPrepModes(false)}>
              ← 単語リスト
            </button>
            <div>
              <div className="screen-title">仕込み方を選ぶ</div>
              <div className="screen-desc">
                「{drama.title}」{isMovie ? '' : ` S${season}E${episode}`} ・ {integrity.prepared}語を準備
              </div>
            </div>
          </div>
          <div className="prep-modes-list">
            <button className="prep-mode prep-mode-quiz" onClick={startPrepQuiz}>
              <span className="prep-mode-name">今夜のリハーサル</span>
              <span className="prep-mode-desc">クイズ3問 ・ 〜90秒で耳を慣らす</span>
            </button>
            <button className="prep-mode prep-mode-cards" onClick={startPrepCards}>
              <span className="prep-mode-name">じっくり覚える</span>
              <span className="prep-mode-desc">
                フラッシュカードで新出{integrity.fresh}語を一周
              </span>
            </button>
            <button className="prep-mode prep-mode-watch" onClick={startPrepWatch}>
              <span className="prep-mode-name">今夜は観るだけ</span>
              <span className="prep-mode-desc">クイズとカードは後でも受けられます</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen active" id="screen-4">
      <div className="screen-inner">
        <div className="screen-header">
          <button className="btn-back" onClick={() => setScreen(vocabReturn)}>
            {vocabReturn === 'search' ? '← 検索結果' : '← マイドラマ'}
          </button>
          <div>
            <div className="screen-title">視聴前の準備</div>
            <div className="screen-desc">
              「{drama.title}」のエピソードを選んで単語を予習する ・ サービス：
              <button
                type="button"
                className="svc-change-btn"
                onClick={() => setScreen('service-select')}
                title="視聴サービスを変更"
              >
                {settings.selectedViewingService || '未選択'}（変更）
              </button>
            </div>
          </div>
        </div>

        {/* タイプ確定・シーズン構築まで選択枠ごと非表示（操作の競合を防止・546da24準拠）。
            生成中は選択UIを畳んで縦スペースを空け、ローディングのあらすじを画面内に収める。 */}
        {selectorReady && phase !== 'generating' && (
        <div className="episode-selector">
          {isMovie ? (
            <div className="episode-label">🎬 映画（字幕から単語を予習）</div>
          ) : (
            <button
              type="button"
              className="ep-collapse-head"
              onClick={() => setPickerOpen((o) => !o)}
              aria-expanded={pickerOpen}
            >
              <span className="ep-collapse-current">
                <span className="ep-collapse-badge">
                  S{season}E{episode}
                </span>
                <span className="ep-collapse-title">エピソードを選ぶ</span>
              </span>
              <span className="ep-collapse-chev">{pickerOpen ? '閉じる ▲' : '変更 ▾'}</span>
            </button>
          )}
          {!isMovie && pickerOpen && (
            <div className="ep-picker">
              {seasons.length > 1 && (
                <div className="ep-seasons" role="tablist" aria-label="シーズン">
                  {seasons.map((s) => (
                    <button
                      key={s.season}
                      type="button"
                      className={'ep-season-chip' + (s.season === season ? ' is-active' : '')}
                      onClick={() => pickSeason(s.season)}
                      aria-pressed={s.season === season}
                    >
                      S{s.season}
                    </button>
                  ))}
                </div>
              )}
              <div className="ep-grid">
                {Array.from({ length: epCount }, (_, i) => i + 1).map((ep) => {
                  const done = (studiedByEp[season] || new Set()).has(ep);
                  const active = ep === episode;
                  return (
                    <button
                      key={ep}
                      type="button"
                      className={'ep-card' + (active ? ' is-active' : '') + (done ? ' is-done' : '')}
                      onClick={() => pickEpisode(ep)}
                      aria-pressed={active}
                    >
                      <span className="ep-card-num">{ep}</span>
                      <span className="ep-card-body">
                        <span className="ep-card-title">Episode {ep}</span>
                        <span className="ep-card-state">
                          {done ? '✓ 学習済み' : active ? 'NEXT' : '未学習'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="episode-row">
            {!genBtn.hidden && (
              <button className="btn-episode" disabled={genBtn.disabled} onClick={onGenerate}>
                {genBtn.text}
              </button>
            )}
            {(phase === 'vocab' || phase === 'saved') && (
              <button className="btn-episode btn-episode-danger" onClick={onDelete}>
                リストを削除
              </button>
            )}
          </div>
          <div className="episode-selected">{statusText}</div>
        </div>
        )}

        <div id="vocabSection">
          {mediaChoice ? (
            <div className="media-type-choice">
              <div className="media-type-title">
                この作品にはドラマ版と映画版があります。どちらを学習しますか？
              </div>
              <div className="media-type-options">
                <button className="media-type-btn" onClick={() => pickMedia(mediaChoice.tv)}>
                  <span className="media-type-icon">📺</span>
                  <span className="media-type-label">ドラマ</span>
                  <span className="media-type-name">
                    {mediaChoice.tv.englishTitle}
                    {mediaChoice.tv.year ? `（${mediaChoice.tv.year}）` : ''}
                  </span>
                </button>
                <button className="media-type-btn" onClick={() => pickMedia(mediaChoice.mv)}>
                  <span className="media-type-icon">🎬</span>
                  <span className="media-type-label">映画</span>
                  <span className="media-type-name">
                    {mediaChoice.mv.englishTitle}
                    {mediaChoice.mv.year ? `（${mediaChoice.mv.year}）` : ''}
                  </span>
                </button>
              </div>
            </div>
          ) : phase === 'loading' ? (
            <div className="loading">
              <div className="spinner"></div>
              {statusText.includes('字幕') ? '字幕を読み込み中...' : 'シーズン情報を取得中...'}
            </div>
          ) : phase === 'generating' ? (
            // あらすじ＋学習Tips つきリッチローディング（既存 showGenerationLoading）
            <GenLoading
              status={retryMsg || genStatus}
              drama={drama}
              season={season}
              episode={episode}
              ready={revealReady}
              onReveal={revealList}
            />
          ) : showVocab && sortedVocab.length ? (
            <>
              {/* 進捗バー */}
              <div className="srs-progress-wrap">
                <div className="srs-progress-header">
                  <span className="srs-ep-label">
                    {drama.title}
                    {isMovie ? '' : ` S${season}E${episode}`} の単語リスト
                    {prepped && <span className="prepped-chip">✓ 予習済み</span>}
                  </span>
                  <span className="srs-pct" style={{ color: pctColor }}>
                    {pct}% 覚えた
                  </span>
                </div>
                <div className="srs-bar">
                  <div className="srs-bar-fill" style={{ width: `${pct}%`, background: barFill }} />
                </div>
                <div className="srs-counts">
                  <span className="srs-count-learned">
                    ✅ 覚えた: <b>{stats.learned}</b>/{stats.total}
                  </span>
                  <span className="srs-count-mastered">
                    ⭐ マスター: <b>{stats.mastered}</b>/{stats.total}
                  </span>
                </div>
                <div className="srs-stats">
                  復習対象：{stats.due}単語 / スキップ：{stats.skipped}単語
                  {stats.reviewedToday > 0 ? ` / 今日復習済み：${stats.reviewedToday}単語` : ''}
                </div>
                {completeMsg && <div className="srs-complete">{completeMsg}</div>}
              </div>

              {/* #20 手動追加。リストの一番上に置く（2026-08-05 オーナー要望: 追加しやすく）。
                  追加した単語の表示自体は下の「✏️ 追加した単語」セクションのまま。 */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                <input
                  // type="email"+lang="en" は「英語(ASCII)キーボードを既定表示」のための実務トリック。
                  // キーボード言語の完全な強制は Web 仕様上不可能で、email 型が iOS/Android とも
                  // 最も確実にラテン配列を出す（副作用: @ キーが見える・メール autofill 候補は
                  // autoComplete="off" で抑制。中間スペースは維持されるためフレーズ入力も可）。
                  type="email"
                  lang="en"
                  autoComplete="off"
                  value={addWordText}
                  onChange={(e) => {
                    setAddWordText(e.target.value);
                    if (addMsg) setAddMsg('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddWord();
                  }}
                  placeholder="この話の単語を追加（例: retainer）"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={addBusy}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '9px 12px',
                    border: '1px solid var(--border, #ddd)',
                    borderRadius: 10,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    background: 'var(--card-bg, #fff)',
                    color: 'inherit',
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleAddWord}
                  disabled={addBusy}
                  style={{
                    // .btn-secondary の width:100% を打ち消す（フル幅化すると flex 行の
                    // 入力欄が数pxに圧殺され、スマホで「入力できない→空で押して無反応」になる）
                    width: 'auto',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    padding: '9px 14px',
                    borderRadius: 10,
                  }}
                >
                  {addBusy ? '追加中…' : '＋ 追加'}
                </button>
              </div>
              {addMsg && <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>{addMsg}</div>}

              {source && phase === 'vocab' && (
                <div className="source-label" style={{ marginBottom: 8 }}>
                  📝 {source}から生成
                </div>
              )}
              {/* 品質/coverage ゲートを通らず共有キャッシュに書かれなかったリスト（A12(5)）。
                  表示はするが次回また生成枠を使うことを小さく伝える。 */}
              {notShared && phase === 'vocab' && (
                <div className="source-label" style={{ marginBottom: 8, fontSize: 11, opacity: 0.8 }}>
                  ※ このリストは共有されません（再生成は枠を消費します）
                </div>
              )}

              <div className="vocab-list">
                {mainWords.map((w) => (
                  <VocabItem
                    key={w.word}
                    word={w}
                    srs={srs}
                    testTiers={testTiers}
                    ts={tsFor(w)}
                    exampleSource={exampleCredit}
                    added={w.source === 'ext'}
                    onSpeak={speak}
                    onSkip={handleSkip}
                    onCopyTime={handleCopyTime}
                    onDelete={w.source === 'ext' ? handleDeleteExtWord : undefined}
                  />
                ))}
              </div>

              {plusWords.length > 0 && (
                <div className="plus-words-section">
                  <div className="source-label" style={{ marginTop: 16, marginBottom: 6 }}>
                    📌 関連おすすめ単語（字幕外）
                  </div>
                  <div className="vocab-list">
                    {plusWords.map((w) => (
                      <VocabItem
                        key={w.word}
                        word={w}
                        srs={srs}
                        testTiers={testTiers}
                        ts={tsFor(w)}
                        onSpeak={speak}
                        onSkip={handleSkip}
                        onCopyTime={handleCopyTime}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 追加した単語（拡張クリック保存＋手動追加・今日の復習・テストボタンの上に配置）。
                  設定で「時刻順にまぜる」がオンの時は上のリストに統合済みなのでここは出さない。 */}
              {!mergeAdded && renderAddedWords('✏️ 追加した単語')}

              {stats.due > 0 ? (
                <button
                  className="btn-review-start"
                  onClick={() =>
                    // 復習カードの出所明示用に、各語へ作品/話メタ（_src）を付帯（Dashboard経路と同形）。
                    // sortedVocab＋追加した単語(reviewWords)を渡す＝追加語も今日の復習に含める。
                    // isDue で絞る＝「{stats.due}単語」表示と中身を一致させ、マスター済み
                    // （他作品で習得済み含む）や今日復習済みを出さない（#7b）。
                    openReview(
                      reviewWords
                        .filter((w) => {
                          const e = srs[w.word.toLowerCase()];
                          return !e || isDue(e);
                        })
                        .map((w) => ({
                          ...w,
                          _src: { title: drama.title, season, episode, type: drama.type },
                        }))
                    )
                  }
                >
                  今日の復習 {stats.due}単語を始める
                  {doneToday > 0 && <span className="review-done-count">（今日{doneToday}回済み）</span>}
                </button>
              ) : (
                doneToday > 0 && (
                  <div className="review-completed-today">✅ 今日の復習完了（{doneToday}回）</div>
                )
              )}
            </>
          ) : phase === 'soon' ? (
            /* カタログ外＝リクエスト受付。突き放さず巻き込む（design-curated-catalog §2-3）。
               クリック保存は全作品で使えることを必ず添える（D0救済・改善4）。 */
            <div className="soon-panel">
              <div className="soon-emoji" aria-hidden="true">🎬</div>
              <div className="soon-title">この作品は順次対応予定です</div>
              <div className="soon-sub">リクエストの多い作品から、毎週カタログに追加しています</div>
              {catReq.planned && <div className="soon-planned">📅 この作品は対応予定に入っています</div>}
              <button
                className="soon-request-btn"
                disabled={catReq.requested || catReq.sending}
                onClick={sendCatalogRequest}
              >
                {catReq.requested
                  ? '✓ リクエストを受け付けました'
                  : catReq.sending
                    ? '送信中...'
                    : '🙋 この作品をリクエストする'}
              </button>
              {catReq.votes != null && catReq.votes > 0 && (
                <div className="soon-votes">現在 {catReq.votes} 票のリクエスト</div>
              )}
              <div className="soon-note">
                🧩 字幕の単語クリック保存・意味表示は、この作品でも今すぐ使えます
              </div>
              <button type="button" className="soon-browse-link" onClick={() => setScreen('recommend')}>
                対応作品から予習をはじめる →
              </button>
            </div>
          ) : (
            <>
              <div
                className="empty-state"
                style={phase === 'error' ? { color: 'var(--red)' } : phase === 'nosub' ? { color: 'var(--text-muted)' } : undefined}
              >
                {message || 'エピソードを選んでください'}
              </div>
              {/* 生成枠（匿名/日）に達した時の補助導線: ログインすると枠が増える（A12(3)）。
                  AuthModal を直接開く。 */}
              {phase === 'error' && genNote?.login && (
                <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={openAuth}>
                  ログインする
                </button>
              )}
              {/* AI単語リストがまだ無い（未生成・字幕なし・エラー）作品でも、視聴中に保存した語は
                  ここに出す。映画で字幕が見つからない作品では、これが唯一の受け皿になる。 */}
              {renderAddedWords('✏️ この作品で保存した単語')}
            </>
          )}
        </div>

        {/* 話数を特定できなかった語（拡張が S/E を検出できずに保存した語）は各話のリストに出ない。
            所在を示し、単語帳へ誘導する（A22(b)）。映画は S/E を持たないので出さない。 */}
        {!isMovie && unassignedCount > 0 && phase !== 'generating' && (
          <div className="source-label" style={{ marginTop: 12, textAlign: 'center' }}>
            話数を特定できなかった語 {unassignedCount} 件 →{' '}
            <button
              type="button"
              onClick={() => setScreen('wordbook')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--accent)',
                font: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              単語帳
            </button>
          </div>
        )}

        {/* 予習エンジン：新規生成成功時だけ「次に進む」→ モード選択ページへ。
            saved 再表示・error・soon・generating では従来の「テストを受ける」を出す。 */}
        {showVocab && sortedVocab.length > 0 && prepFresh ? (
          <>
            {/* 主動線：全語を1枚ずつめくって“一通り見る”ウォークスルー（見終えたら半券＝特典）。 */}
            <button className="btn-primary vocab-cta-sticky" onClick={openWalkthrough}>
              予習する →
            </button>
            {/* 副動線：クイズ／じっくり等の予習エンジン（控えめに温存）。 */}
            <button type="button" className="vocab-cta-alt" onClick={() => setPrepModes(true)}>
              クイズ・カードで予習する
            </button>
          </>
        ) : (
          showVocab && sortedVocab.length > 0 && (
            // 「テスト」の語感は避ける（視聴前のテスト予告は偶発学習を阻害しがち＝Montero Perez 2022系・docs/research-2026-07参照）
            <button className="btn-primary vocab-cta-sticky" onClick={() => goToQuiz()}>
              クイズで腕試し →
            </button>
          )
        )}
      </div>
    </div>
  );
}

// エピソードの安定ID（予習位置・予習済み記録のキー。tmdbId優先・無ければタイトル）。
function episodeId(drama, season, episode, isMovie) {
  const base = drama?.tmdbId || drama?.title || 'x';
  return isMovie ? `${base}|movie|movie` : `${base}|${season}|${episode}`;
}

// 時間カバレッジ検査（coverageOk）は lib/coverage.js へ移設し、サーバの生成経路（vocabGen）が
// 共有キャッシュへ書く前に判定する（2026-09-12）。クライアントは meta.contributed で結果だけ知る。

// 予習ウォークスルーの payload を組む（auto-open effect と「予習する →」ボタンで共用）。
//   - 重要語（新出・高レベル）優先に並び替え（orderWordsForPrep）
//   - 各語に📍時刻ラベルを焼く／出所明示（48条）の credit／エピソードID を載せる
function buildWalkPayload({ sortedVocab, timestamps, srs, drama, season, episode, isMovie, service }) {
  const ordered = orderWordsForPrep(sortedVocab, srs);
  const wordsForWalk = ordered.map((w) => ({
    ...w,
    _tsLabel: timestamps.get(w.word)?.label || null,
  }));
  const credit = isMovie
    ? `📺 ${drama.title}（字幕：OpenSubtitles）`
    : `📺 ${drama.title} S${season}E${episode}（字幕：OpenSubtitles）`;
  const integrity = prepIntegrity(ordered);
  return {
    words: wordsForWalk,
    meta: {
      drama,
      title: drama.title,
      season,
      episode,
      isMovie,
      service,
      integrity,
      freshCount: integrity.fresh,
      credit,
      epId: episodeId(drama, season, episode, isMovie),
    },
  };
}

// useCallback の安全ラッパ（依存配列を明示）
function useCallbackSafe(fn, deps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(fn, deps);
}
