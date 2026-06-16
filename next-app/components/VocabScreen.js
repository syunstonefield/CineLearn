'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import VocabItem from './VocabItem';
import GenLoading from './GenLoading';
import {
  loadSrs,
  loadHistory,
  skipWord,
  unskipWord,
  episodeStats,
  saveHistoryEntry,
  updateHistoryWords,
  deleteHistoryEntry,
  todaySessionCount,
} from '@/lib/storage';
import {
  fetchTitleCandidatesFromTMDb,
  resolveTitleCandidate,
  fetchSeasonInfoFromTMDb,
  fetchMovieInfoFromTMDb,
} from '@/lib/tmdb';
import {
  fetchEpisodeSubtitle,
  getCachedRawSrt,
  subtitleCacheKey,
  computeTimestamps,
  attachBaseTimestamps,
} from '@/lib/subtitles';
import { generateSuperset, personalizeWords, fillMissingExampleJa } from '@/lib/vocab';
import { fetchSharedVocab, contributeVocab } from '@/lib/api';
import { getMyWordsForEpisode, resolveUnassignedWords, translateExtWordDefinitions } from '@/lib/words';

function speak(word) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  }
}

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
    setScreen,
    setQuizData,
    setCurrentHistoryId,
    goToQuiz,
    openReview,
    reviewVersion,
  } = app;
  const pid = app.profile?.id;

  const [seasons, setSeasons] = useState([]); // dramaSeasonInfo
  const [isMovie, setIsMovie] = useState(false);
  const [statusText, setStatusText] = useState('シーズン情報を取得中...');
  const [phase, setPhase] = useState('loading'); // loading|empty|ready|generating|vocab|saved|nosub|error|choice
  const [message, setMessage] = useState(''); // empty-state / error text
  const [retryMsg, setRetryMsg] = useState('');
  const [genStatus, setGenStatus] = useState('単語を分析中...'); // 生成ローディングの状態文言
  const [genBtn, setGenBtn] = useState({ text: '単語を生成', disabled: true, hidden: false });
  const [vocab, setVocab] = useState([]);
  const [source, setSource] = useState('');
  const [extWords, setExtWords] = useState([]);
  const [srs, setSrs] = useState({});
  const [mediaChoice, setMediaChoice] = useState(null); // {tv, movie}
  // タイプ（ドラマ/映画）確定・シーズン構築が済むまでエピソード選択枠を隠す
  const [selectorReady, setSelectorReady] = useState(false);
  const [historyId, setHistoryId] = useState(null);

  // メモリ上の字幕（app.js の cachedSubtitleText/Key 相当）
  const subMem = useRef({ key: '', text: '', raw: '' });
  // 生SRT（タイムスタンプ用）。memory 優先→localStorage
  const [subRaw, setSubRaw] = useState('');
  const reqId = useRef(0); // 競合する非同期処理を無効化するための世代カウンタ

  // ─ タイムスタンプ（vocab + subRaw から一括計算）─
  const timestamps = useMemo(() => {
    if (!vocab.length) return new Map();
    if (subRaw) {
      // 生SRTあり（生成パス）: VOD補正つきで計算
      return computeTimestamps(vocab, {
        title: drama?.englishTitle || drama?.title,
        season,
        episode,
        rawSrt: subRaw,
      });
    }
    // 生SRTなし（キャッシュヒット等）: 保存済みのベース時刻を使う
    const m = new Map();
    vocab.forEach((w) => m.set(w.word, { sec: w.tsSec ?? Infinity, label: w.tsLabel ?? null }));
    return m;
  }, [vocab, subRaw, drama, season, episode]);

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

  const reloadSrs = useCallbackSafe(() => setSrs(loadSrs()), []);

  // SRS はマウント時に必ずロードする（クラウドから pull 済みの
  // 「覚えた/マスター」を保存済みリストの初回表示から反映させる）。
  // 復習モーダルが閉じたときも読み直してバッジ・進捗を更新。
  useEffect(() => {
    setSrs(loadSrs());
  }, [reviewVersion]);

  // ── example_ja のバックグラウンド補完（二重実行ガードつき）──
  const fillJaRunning = useRef(false);
  const runFillExampleJa = useCallbackSafe(
    (words, hid) => {
      if (fillJaRunning.current) return;
      if (!words.some((w) => w.example && !w.example_ja_ok)) return;
      fillJaRunning.current = true;
      fillMissingExampleJa(words)
        .then((changed) => {
          if (changed) {
            updateHistoryWords(hid, words);
            setVocab([...words]); // 翻訳結果を再描画
          }
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
        (h) => h.drama.title === drama.title && h.season === se && h.episode === ep
      );
      if (entry?.words?.length) {
        setVocab(entry.words);
        setHistoryId(entry.id);
        // テスト画面用：保存済みクイズと履歴IDを共有
        setCurrentHistoryId(entry.id);
        setQuizData(entry.quiz || []);
        setSource('');
        setPhase('saved');
        setGenBtn((b) => ({ ...b, hidden: true }));
        setStatusText(
          drama.type === 'movie'
            ? '✓ 保存済み'
            : `Season ${se} Episode ${ep} ✓ 保存済み`
        );
        // 📍タイムスタンプはキャッシュ済み生SRTから即時表示。
        // 未キャッシュの場合の取得は loadEpisode 側の preloadSilent が
        // 1回だけ静かに行う（ここで二重ダウンロードしない＝クォータ節約）。
        setSubRaw(getCachedRawSrt(drama, se, ep));
        // example_ja が無い単語をバックグラウンドで翻訳補完（既存 fillMissingExampleJa）
        runFillExampleJa(entry.words, entry.id);
        loadExtWords(se, ep, entry.words);
        return true;
      }
      // 履歴なし → 拡張機能単語のみチェック
      const ext = await getMyWordsForEpisode(drama, se, ep, pid, subMem.current.text);
      if (ext.length) {
        setStatusText(drama.type === 'movie' ? '🎬 映画' : `Season ${se} Episode ${ep}`);
        setVocab([]);
        setPhase('empty');
        setMessage('「単語を生成」でAIの単語リストを追加できます');
        setGenBtn({ text: '単語を生成', disabled: false, hidden: false });
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
      const ext = await getMyWordsForEpisode(drama, se, ep, pid, subMem.current.text);
      const existingSet = new Set((existing || []).map((w) => w.word.toLowerCase()));
      const newExt = ext
        .filter((w) => !existingSet.has(w.word.toLowerCase()))
        .map((w) => ({
          word: w.word,
          pos: w.pos || '',
          definition: w.definition || '',
          example: w.sentence || '',
          example_ja: w.example_ja || '',
          tier: w.tier || 'core',
          source: 'ext',
        }));
      setExtWords(newExt);
      // 英語定義をバックグラウンドで日本語に翻訳（既存 translateExtWordDefinitions）
      if (newExt.length) {
        translateExtWordDefinitions(newExt, pid)
          .then((changed) => {
            if (changed) setExtWords([...newExt]);
          })
          .catch(() => {});
      }
    },
    [drama, pid]
  );

  // ── 字幕プリロード（preloadSubtitle のデータ部分）──
  const preload = useCallbackSafe(
    async (se, ep, myReq) => {
      if (!drama) return;
      try {
        const result = await fetchEpisodeSubtitle(drama, se, ep);
        if (myReq !== reqId.current) return;
        if (result) {
          const key = subtitleCacheKey(drama.englishTitle || drama.title, se, ep);
          subMem.current = { key, text: result.parsed, raw: result.raw };
          setSubRaw(result.raw);
          setSource(result.source);
          setStatusText(
            drama.type === 'movie' ? '✓ 字幕取得済み' : `Season ${se} Episode ${ep} ✓ 字幕取得済み`
          );
          setPhase('ready');
          setMessage('「単語を生成」を押してください');
          setGenBtn({ text: '単語を生成', disabled: false, hidden: false });
          resolveUnassignedWords(pid, result.parsed, drama.englishTitle || drama.title, se, ep)
            .then(() => loadExtWords(se, ep, vocab))
            .catch(() => {});
        } else {
          setStatusText(
            drama.type === 'movie' ? '⚠ 字幕なし' : `Season ${se} Episode ${ep} ⚠ 字幕なし`
          );
          setPhase('nosub');
          setMessage(
            drama.type === 'movie'
              ? 'この映画の字幕が見つかりませんでした。別の作品を選択してください。'
              : 'このエピソードの字幕が見つかりませんでした。別のエピソードを選択してください。'
          );
          setGenBtn((b) => ({ ...b, hidden: true }));
        }
      } catch {
        if (myReq !== reqId.current) return;
        setStatusText(
          drama.type === 'movie' ? '⚠ 字幕エラー' : `Season ${se} Episode ${ep} ⚠ 字幕エラー`
        );
        setPhase('error');
        setMessage('字幕の取得に失敗しました。別のエピソードを選択してください。');
        setGenBtn((b) => ({ ...b, hidden: true }));
      }
    },
    [drama, pid, vocab]
  );

  // ── 字幕の無音プリロード（preloadSubtitleSilent 相当）──
  // 保存済み単語リストの表示中に裏で字幕をキャッシュする用途。
  // ★重要★ phase / message / genBtn / statusText を一切触らない。
  // 失敗（ダウンロード上限など）しても保存済みリストの表示を壊さない。
  // 生SRT（📍タイムスタンプ）とパース済み（拡張機能単語の照合）の両方を1回で賄う。
  const preloadSilent = useCallbackSafe(
    async (se, ep, myReq) => {
      if (!drama) return;
      try {
        const result = await fetchEpisodeSubtitle(drama, se, ep);
        if (!result || myReq !== reqId.current) return;
        const key = subtitleCacheKey(drama.englishTitle || drama.title, se, ep);
        subMem.current = { key, text: result.parsed, raw: result.raw };
        setSubRaw(result.raw); // 📍タイムスタンプ補完（成功時のみ）
        resolveUnassignedWords(pid, result.parsed, drama.englishTitle || drama.title, se, ep)
          .then(() => loadExtWords(se, ep, vocab))
          .catch(() => {});
      } catch {
        /* 失敗しても保存済みリストの表示は維持（UIを一切触らない）*/
      }
    },
    [drama, pid, vocab]
  );

  // ── エピソード読み込み（triggerEpisodeLoad 相当）──
  const loadEpisode = useCallbackSafe(
    async (se, ep) => {
      const myReq = ++reqId.current;
      setVocab([]);
      setExtWords([]);
      setHistoryId(null);
      setGenBtn({ text: '単語を生成', disabled: true, hidden: false });
      if (await checkSaved(se, ep)) {
        // 保存済みでも字幕キャッシュが無ければ「無音版」で静かに取得
        // （タイムスタンプ＋拡張単語照合用。失敗してもリスト表示を壊さない）
        const key = subtitleCacheKey(drama.englishTitle || drama.title, se, ep);
        if (!localStorage.getItem(key)) preloadSilent(se, ep, myReq);
        return;
      }
      if (myReq !== reqId.current) return;
      setStatusText(`Season ${se} Episode ${ep} を選択中`);
      setPhase('loading');
      setMessage('');
      setGenBtn({ text: '読み込み中...', disabled: true, hidden: false });
      await preload(se, ep, myReq);
    },
    [drama, checkSaved, preload]
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
        setIsMovie(false);
        drama.type = 'tv';
        setSeasons([{ season: 1, episodes: 10 }, { season: 2, episodes: 10 }, { season: 3, episodes: 10 }]);
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
      setSeason(1);
      setEpisode(1);
      await loadEpisode(1, 1);
    },
    [resolvePicked, applyTitleInfo, loadEpisode]
  );

  // ── 画面マウント：タイトル情報取得 → シーズン構築 → 初回ロード ──
  useEffect(() => {
    if (!drama) return;
    let cancelled = false;
    const myReq = ++reqId.current;
    (async () => {
      setPhase('loading');
      setStatusText('シーズン情報を取得中...');
      setGenBtn({ text: '単語を生成', disabled: true, hidden: false });
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
      setSeason(1);
      setEpisode(1);
      await loadEpisode(1, 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drama?.title]);

  // ── 単語生成（generateVocabFromEpisode 相当）──
  // まず共有キャッシュ（/api/vocab）を参照し、ヒットすれば生成せず personalizeWords で表示する。
  // カタログ外（ゲート有効時）は「近日対応」。ミス/失敗は従来フロー（字幕取得→generateVocab）へフォールバック。
  const onGenerate = useCallbackSafe(async () => {
    if (!drama) return;
    const myReq = reqId.current;
    setGenBtn({ text: '生成中...', disabled: true, hidden: false });
    setPhase('generating');
    setGenStatus('単語を分析中...');
    setRetryMsg('');

    const personalizeOpts = {
      toeicScore: settings.toeicScore || 0,
      targetToeicScore: settings.targetToeicScore || 0,
      vocabCount: settings.vocabCount || 30,
    };

    try {
      let words;
      let srcLabel;

      // 1) 共有キャッシュ参照（読み取り専用・失敗は miss 扱い）
      const cached = await fetchSharedVocab({
        tmdbId: drama.tmdbId,
        season,
        episode,
        type: drama.type,
      });

      if (cached?.blocked) {
        // カタログ外 → 近日対応（生成しない）
        setSubRaw('');
        setVocab([]);
        setSource('');
        setMessage('🚧 この作品は近日対応予定です（カタログを順次拡大中）');
        setPhase('soon');
        setGenBtn({ text: '単語を生成', disabled: true, hidden: true });
        return;
      }

      if (Array.isArray(cached?.words) && cached.words.length) {
        // キャッシュヒット：生成せず学習者レベルで絞るだけ（字幕取得・Claude 不要）。
        // タイムスタンプ📍は各語の保存済みベース時刻(tsSec/tsLabel)を使う。
        setSubRaw('');
        words = personalizeWords(cached.words, personalizeOpts);
        srcLabel = '共有キャッシュ（生成済み）';
      } else {
        // 2) ミス → 字幕取得 → スーパーセット生成（全レベル分）→ レベル絞りで表示
        const key = subtitleCacheKey(drama.englishTitle || drama.title, season, episode);
        let subText = subMem.current.key === key ? subMem.current.text : localStorage.getItem(key) || '';
        if (!subText) {
          setGenBtn({ text: '字幕を読み込み中...', disabled: true, hidden: false });
          setGenStatus('字幕を読み込み中...');
          await preload(season, episode, myReq);
          subText = subMem.current.key === key ? subMem.current.text : '';
          if (!subText) {
            setGenBtn({ text: '単語を生成', disabled: false, hidden: false });
            return;
          }
          // preload が phase を書き換えるためローディングを再表示（既存と同じ）
          setPhase('generating');
          setGenStatus('単語を分析中...');
        }

        const superset = await generateSuperset(
          { drama, season, episode, subtitleText: subText, vocabCount: settings.vocabCount || 30 },
          (attempt, waitSec) => setRetryMsg(`混雑中... ${waitSec}秒後に再試行 (${attempt}/3)`)
        );
        words = personalizeWords(superset, personalizeOpts);
        srcLabel = source || '実際の字幕データから';

        // フェーズ1: スーパーセットを共有キャッシュへ寄与（fire-and-forget・サーバー側で品質ゲート）
        try {
          attachBaseTimestamps(superset, {
            title: drama.englishTitle || drama.title,
            season,
            episode,
            rawSrt: subMem.current.raw || '',
          });
          contributeVocab({
            tmdbId: drama.tmdbId,
            season,
            episode,
            type: drama.type,
            displayTitle: drama.englishTitle || drama.title,
            words: superset.map(({ example_ja_ok, ...w }) => w),
          });
        } catch {
          /* 寄与失敗は無視（表示に影響しない） */
        }
      }

      // 3) 共通：仕上げ・表示・保存
      setGenStatus('仕上げ中...');
      setRetryMsg('');

      setVocab(words);
      setSource(srcLabel);
      setPhase('vocab');
      setGenBtn({ text: '単語を再生成', disabled: false, hidden: true });

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
      // example_ja が欠けた単語をバックグラウンドで翻訳補完
      runFillExampleJa(words, id);
      // クイズはここでは生成しない。ユーザーがテストを開いた時に QuizScreen 側で生成する。
    } catch (e) {
      setPhase('error');
      setMessage(e.message || '生成に失敗しました');
      setGenBtn({ text: '単語を再生成', disabled: false, hidden: false });
    }
  }, [drama, season, episode, settings, source, preload, reloadSrs, loadExtWords]);

  // ── ハンドラ ──
  const handleSkip = (word, isSkip) => {
    isSkip ? unskipWord(word) : skipWord(word);
    reloadSrs();
  };
  const handleCopyTime = (time) => {
    navigator.clipboard?.writeText(time).catch(() => {});
  };
  const onSeasonChange = (e) => {
    const se = parseInt(e.target.value);
    setSeason(se);
    setEpisode(1);
    loadEpisode(se, 1);
  };
  const onEpisodeChange = (e) => {
    const ep = parseInt(e.target.value);
    setEpisode(ep);
    loadEpisode(season, ep);
  };
  const onDelete = () => {
    if (!confirm('この単語リストを削除しますか？')) return;
    deleteHistoryEntry(historyId, drama, season, episode);
    setHistoryId(null);
    setVocab([]);
    setExtWords([]);
    setPhase('empty');
    setMessage('エピソードを選んでください');
    setStatusText('');
    setGenBtn({ text: '単語を生成', disabled: false, hidden: false });
  };

  if (!drama) return null;

  const currentSeasonInfo = seasons.find((s) => s.season === season);
  const epCount = currentSeasonInfo?.episodes || 10;

  const dramaWords = sortedVocab.filter((w) => w.source !== 'plus');
  const plusWords = sortedVocab.filter((w) => w.source === 'plus');
  const stats = episodeStats(sortedVocab, srs);
  // 今日の復習セッション数（srs/reviewVersion 変化で再レンダーされるため毎回読み直す）
  const doneToday = historyId ? todaySessionCount(historyId) : 0;
  const testTiers = settings.testTiers || ['core', 'advanced'];
  const showVocab = phase === 'vocab' || phase === 'saved';

  // 出所明示（著作権法48条）：このリストの例文＝字幕の逐語引用の出典。
  // drama語/ext語（字幕由来）に付け、plus語（Claude作例・字幕外）には付けない。
  const exampleCredit = isMovie
    ? `📺 ${drama.title}（字幕：OpenSubtitles）`
    : `📺 ${drama.title} S${season}E${episode}（字幕：OpenSubtitles）`;

  // 進捗バー（buildProgressHTML 準拠）
  const pct = stats.total === 0 ? 0 : Math.round((stats.learned / stats.total) * 100);
  const barColor =
    pct === 100 ? '#f5c518' : pct > 60 ? '#4fc3f7' : pct > 30 ? 'var(--accent)' : 'var(--text-muted)';
  const completeMsg =
    stats.total > 0 && stats.learned === stats.total
      ? stats.mastered === stats.total
        ? '🌟 全単語マスター達成！'
        : '✨ 全単語「覚えた」達成！'
      : '';

  return (
    <div className="screen active" id="screen-4">
      <div className="screen-inner">
        <div className="screen-header">
          <button className="btn-back" onClick={() => setScreen('service-select')}>
            ← サービス選択
          </button>
          <div>
            <div className="screen-title">視聴前の準備</div>
            <div className="screen-desc">
              「{drama.title}」（{settings.selectedViewingService}）のエピソードを選んで単語を予習する
            </div>
          </div>
        </div>

        {/* タイプ確定・シーズン構築まで選択枠ごと非表示（操作の競合を防止・546da24準拠） */}
        {selectorReady && (
        <div className="episode-selector">
          <div className="episode-label">
            {isMovie ? '🎬 映画（字幕から単語を予習）' : '視聴するエピソードを選択'}
          </div>
          <div className="episode-row">
            {!isMovie && (
              <div style={{ display: 'contents' }}>
                <div className="episode-field">
                  <label className="episode-field-label">シーズン</label>
                  <select className="episode-select" value={season} onChange={onSeasonChange}>
                    {seasons.map((s) => (
                      <option key={s.season} value={s.season}>
                        Season {s.season}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="episode-field">
                  <label className="episode-field-label">エピソード</label>
                  <select className="episode-select" value={episode} onChange={onEpisodeChange}>
                    {Array.from({ length: epCount }, (_, i) => i + 1).map((i) => (
                      <option key={i} value={i}>
                        Episode {i}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {!genBtn.hidden && (
              <button className="btn-episode" disabled={genBtn.disabled} onClick={onGenerate}>
                {genBtn.text}
              </button>
            )}
            {(phase === 'vocab' || phase === 'saved') && (
              <button className="btn-episode" onClick={onDelete}>
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
            />
          ) : showVocab && sortedVocab.length ? (
            <>
              {/* 進捗バー */}
              <div className="srs-progress-wrap">
                <div className="srs-progress-header">
                  <span className="srs-ep-label">
                    {drama.title}
                    {isMovie ? '' : ` S${season}E${episode}`} の単語リスト
                  </span>
                  <span className="srs-pct" style={{ color: barColor }}>
                    {pct}% 覚えた
                  </span>
                </div>
                <div className="srs-bar">
                  <div className="srs-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
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

              {source && phase === 'vocab' && (
                <div className="source-label" style={{ marginBottom: 8 }}>
                  📝 {source}から生成
                </div>
              )}

              <div className="vocab-list">
                {dramaWords.map((w) => (
                  <VocabItem
                    key={w.word}
                    word={w}
                    srs={srs}
                    testTiers={testTiers}
                    ts={timestamps.get(w.word)}
                    exampleSource={exampleCredit}
                    onSpeak={speak}
                    onSkip={handleSkip}
                    onCopyTime={handleCopyTime}
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
                        ts={timestamps.get(w.word)}
                        onSpeak={speak}
                        onSkip={handleSkip}
                        onCopyTime={handleCopyTime}
                      />
                    ))}
                  </div>
                </div>
              )}

              {stats.due > 0 ? (
                <button
                  className="btn-review-start"
                  onClick={() =>
                    // 復習カードの出所明示用に、各語へ作品/話メタ（_src）を付帯（Dashboard経路と同形）
                    openReview(
                      sortedVocab.map((w) => ({
                        ...w,
                        _src: { title: drama.title, season, episode, type: drama.type },
                      }))
                    )
                  }
                >
                  🔴 今日の復習 {stats.due}単語を始める
                  {doneToday > 0 && <span className="review-done-count">（今日{doneToday}回済み）</span>}
                </button>
              ) : (
                doneToday > 0 && (
                  <div className="review-completed-today">✅ 今日の復習完了（{doneToday}回）</div>
                )
              )}

              {/* 拡張機能で追加した単語 */}
              {extWords.length > 0 && (
                <div id="ext-words-section">
                  <div className="source-label" style={{ marginTop: 14 }}>
                    ✏️ 追加した単語
                  </div>
                  <div className="vocab-list">
                    {extWords.map((w) => (
                      <VocabItem
                        key={w.word}
                        word={w}
                        srs={srs}
                        testTiers={testTiers}
                        ts={timestamps.get(w.word)}
                        exampleSource={exampleCredit}
                        onSpeak={speak}
                        onSkip={handleSkip}
                        onCopyTime={handleCopyTime}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div
              className="empty-state"
              style={phase === 'error' ? { color: 'var(--red)' } : phase === 'nosub' ? { color: 'var(--text-muted)' } : undefined}
            >
              {message || 'エピソードを選んでください'}
            </div>
          )}
        </div>

        {showVocab && sortedVocab.length > 0 && (
          <button className="btn-primary" onClick={() => goToQuiz()}>
            テストを受ける →
          </button>
        )}
      </div>
    </div>
  );
}

// useCallback の安全ラッパ（依存配列を明示）
function useCallbackSafe(fn, deps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(fn, deps);
}
