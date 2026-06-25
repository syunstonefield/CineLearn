'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { searchTitlesTMDB, aiSearchTitles, candidateToDrama } from '@/lib/titleSearch';
import { GENRES, recommendDramas } from '@/lib/recommend';
import { RECOMMENDED, recommendedToDrama } from '@/lib/recommended';
import { tmdb } from '@/lib/api';

// 全画面「ドラマを探す」（案②）。検索バー常設＋最近の検索＋ジャンル＋AIおすすめ＋人気の作品。
// ・検索＝TMDB即時（「AIで探す」で日本語/うろ覚えを救済）
// ・ジャンル＝厳選プールを即フィルタ（架空カウントは出さない＝正直）
// ・AIおすすめ＝Claude推薦（レベル・好みから。視聴履歴は使わない＝検知不可なので正直に）
// ・人気の作品＝実在の厳選プール（RECOMMENDED）

const RECENT_KEY = 'cl_recent_searches';
function loadRecent() {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function pushRecent(q) {
  const t = (q || '').trim();
  if (!t) return loadRecent();
  let arr = loadRecent().filter((x) => x.toLowerCase() !== t.toLowerCase());
  arr.unshift(t);
  arr = arr.slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
  return arr;
}
function clearRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}

// ジャンルのアイコン（GENRES の genre キーに対応）。
const GENRE_ICONS = {
  'Crime Thriller': '🔍',
  Comedy: '😂',
  Romance: '❤️',
  'Sci-Fi': '🚀',
  Horror: '👻',
  'Historical Drama': '🏛️',
  Medical: '🩺',
  Legal: '⚖️',
};

export default function SearchScreen() {
  const { searchQuery, setScreen, openDrama, settings } = useApp();
  const userLevel = settings.userLevel || 'B1';

  const [query, setQuery] = useState(searchQuery || '');
  const [results, setResults] = useState([]); // TMDB検索結果
  const [phase, setPhase] = useState('idle'); // idle | loading | done
  const [aiMode, setAiMode] = useState(false);
  const [activeGenre, setActiveGenre] = useState(null); // 人気の作品の絞り込み
  const [recent, setRecent] = useState([]);
  const [aiReco, setAiReco] = useState({ phase: 'idle', items: [] }); // AIおすすめ結果
  const seq = useRef(0);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const runSearch = async (q) => {
    const t = (q ?? query).trim();
    if (t.length < 2) return;
    setQuery(t);
    setRecent(pushRecent(t));
    setAiReco({ phase: 'idle', items: [] });
    const my = ++seq.current;
    setAiMode(false);
    setPhase('loading');
    try {
      const items = await searchTitlesTMDB(t);
      if (my !== seq.current) return;
      setResults(items);
    } catch {
      if (my === seq.current) setResults([]);
    } finally {
      if (my === seq.current) setPhase('done');
    }
  };

  const runAiSearch = async () => {
    const t = query.trim();
    if (t.length < 2) return;
    const my = ++seq.current;
    setAiMode(true);
    setPhase('loading');
    try {
      const items = await aiSearchTitles(t);
      if (my !== seq.current) return;
      setResults(items);
    } catch {
      if (my === seq.current) setResults([]);
    } finally {
      if (my === seq.current) setPhase('done');
    }
  };

  const runAiReco = async () => {
    const genres = settings.selectedGenres?.length ? settings.selectedGenres : ['Crime Thriller'];
    setResults([]);
    setPhase('idle');
    setAiReco({ phase: 'loading', items: [] });
    try {
      const items = await recommendDramas({
        userLevel,
        toeicScore: settings.toeicScore || 0,
        selectedGenres: genres,
        selectedServices: settings.selectedServices || [],
      });
      setAiReco({ phase: 'done', items });
    } catch {
      setAiReco({ phase: 'error', items: [] });
    }
  };

  const clearAll = () => {
    setQuery('');
    setResults([]);
    setPhase('idle');
    setAiMode(false);
    setAiReco({ phase: 'idle', items: [] });
  };

  // 初回：ホーム外から検索語が渡されていれば即検索（後方互換）。
  useEffect(() => {
    if ((searchQuery || '').trim().length >= 2) runSearch(searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pool = useMemo(
    () => (activeGenre ? RECOMMENDED.filter((d) => d.genre === activeGenre) : RECOMMENDED).slice(0, 12),
    [activeGenre]
  );

  const pickSearch = (s) => openDrama(candidateToDrama(s, userLevel), true);
  const pickPool = (item) => openDrama(recommendedToDrama(item, userLevel), true);
  const pickAi = (d) => openDrama(d, true);

  // 検索結果 or AIおすすめを表示中か（どちらでもなければブラウズ）。
  const showingSearch = phase !== 'idle' || results.length > 0;
  const showingAi = aiReco.phase !== 'idle';
  const browsing = !showingSearch && !showingAi;

  return (
    <div className="screen active" id="screen-search">
      <div className="screen-inner discover">
        <div className="discover-head">
          <button className="discover-back" onClick={() => setScreen('main')} aria-label="戻る">
            ←
          </button>
          <div className="discover-title">ドラマを探す</div>
          <span className="discover-head-spacer" aria-hidden="true" />
        </div>

        <div className="discover-search">
          <span className="discover-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="text"
            className="discover-search-input"
            placeholder="例：SUITS、フレンズ、医療ドラマ…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
          />
          {(query || !browsing) && (
            <button className="discover-search-clear" onClick={clearAll} aria-label="クリア">
              ✕
            </button>
          )}
        </div>

        {/* ── 検索結果（TMDB / AIタイトル検索）── */}
        {showingSearch && (
          <div className="discover-results">
            {phase === 'loading' ? (
              <div className="loading">
                <div className="spinner" />
                {aiMode ? '🤖 AIが候補を考えています…' : '検索中…'}
              </div>
            ) : results.length === 0 && phase === 'done' ? (
              <div className="empty-state">
                該当する作品が見つかりませんでした。
                <br />
                日本語名・うろ覚えのときは「🤖 AIで探す」を試してください。
              </div>
            ) : (
              <>
                {aiMode && <div className="search-suggest-aihint">🤖 AIが解釈した候補</div>}
                <div className="select-grid">
                  {results.map((s) => (
                    <SelectCard key={s.tmdbId} item={s} onPick={pickSearch} />
                  ))}
                </div>
              </>
            )}
            {phase === 'done' && query.trim().length >= 2 && !aiMode && (
              <button type="button" className="btn-secondary search-ai-btn" onClick={runAiSearch}>
                🤖 思った作品が出ない？ AIで探す
              </button>
            )}
          </div>
        )}

        {/* ── AIおすすめ結果 ── */}
        {showingAi && (
          <div className="discover-results">
            <div className="discover-sec-head">
              <h2 className="discover-sec-title">✨ あなたへのおすすめ</h2>
              <button className="discover-clear-link" onClick={clearAll}>
                閉じる
              </button>
            </div>
            {aiReco.phase === 'loading' ? (
              <div className="loading">
                <div className="spinner" />
                🤖 AIがあなたに合う作品を選んでいます…
              </div>
            ) : aiReco.phase === 'error' ? (
              <div className="empty-state" style={{ color: 'var(--red)' }}>
                取得に失敗しました。少し時間をおいて再試行してください。
              </div>
            ) : (
              <div className="discover-pop-grid">
                {aiReco.items.map((d, i) => (
                  <PosterCard key={`${d.title}-${i}`} item={d} onPick={() => pickAi(d)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ブラウズ（最近の検索 / ジャンル / AIおすすめ / 人気の作品）── */}
        {browsing && (
          <>
            {recent.length > 0 && (
              <section className="discover-sec">
                <div className="discover-sec-head">
                  <h2 className="discover-sec-title">最近の検索</h2>
                  <button
                    className="discover-clear-link"
                    onClick={() => {
                      clearRecent();
                      setRecent([]);
                    }}
                  >
                    すべてクリア
                  </button>
                </div>
                <div className="discover-chips">
                  {recent.map((r) => (
                    <button key={r} className="discover-chip" onClick={() => runSearch(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="discover-sec">
              <h2 className="discover-sec-title">ジャンルから探す</h2>
              <div className="discover-genre-grid">
                {GENRES.map((g) => (
                  <button
                    key={g.genre}
                    className={'discover-genre' + (activeGenre === g.genre ? ' is-active' : '')}
                    onClick={() => setActiveGenre(activeGenre === g.genre ? null : g.genre)}
                  >
                    <span className="discover-genre-icon" aria-hidden="true">
                      {GENRE_ICONS[g.genre] || '🎬'}
                    </span>
                    <span className="discover-genre-label">{g.label}</span>
                    <span className="discover-genre-chev" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="discover-sec">
              <button className="discover-ai-banner" onClick={runAiReco}>
                <span className="discover-ai-icon" aria-hidden="true">
                  ✨
                </span>
                <span className="discover-ai-body">
                  <span className="discover-ai-title">あなたへのおすすめ</span>
                  <span className="discover-ai-sub">レベル・好みからAIが作品を選びます</span>
                </span>
                <span className="discover-ai-chev" aria-hidden="true">
                  ›
                </span>
              </button>
            </section>

            <section className="discover-sec">
              <h2 className="discover-sec-title">
                人気の作品
                {activeGenre ? ` ・ ${GENRES.find((g) => g.genre === activeGenre)?.label}` : ''}
              </h2>
              <div className="discover-pop-grid">
                {pool.map((item) => (
                  <PosterCard key={item.tmdbId} item={item} onPick={() => pickPool(item)} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// TMDB検索結果1件（posterPath を持つ）。
function SelectCard({ item, onPick }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const showPoster = item.posterPath && !failed;
  return (
    <button type="button" className="select-card" onClick={() => onPick(item)} title={item.englishTitle}>
      <div className="select-poster">
        {showPoster ? (
          <>
            {!loaded && <span className="img-skeleton" aria-hidden="true" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.posterPath}
              alt=""
              loading="lazy"
              style={{ opacity: loaded ? 1 : 0 }}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        ) : (
          <span className="select-poster-fallback">🎬</span>
        )}
        <span className={'select-type-badge ' + (item.mediaType === 'movie' ? 'is-movie' : 'is-tv')}>
          {item.mediaType === 'movie' ? '映画' : 'ドラマ'}
        </span>
      </div>
      <div className="select-caption">
        <span className="select-title">{item.englishTitle}</span>
        {item.year && <span className="select-year">{item.year}</span>}
      </div>
    </button>
  );
}

// 人気の作品 / AIおすすめ用カード（posterPath が無ければ TMDB で解決）。
function PosterCard({ item, onPick }) {
  const [poster, setPoster] = useState(item.posterPath || null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (poster) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await tmdb({ action: 'search', query: item.englishTitle || item.title });
        const hit = s.results?.[0];
        if (cancelled) return;
        if (hit?.poster_path) setPoster(`https://image.tmdb.org/t/p/w342${hit.poster_path}`);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = poster && !failed;
  const genreLabel = GENRES.find((g) => g.genre === item.genre)?.label || '';

  return (
    <button type="button" className="disc-card" onClick={onPick} title={item.title}>
      <div className="disc-card-poster">
        {show ? (
          <>
            {!loaded && <span className="img-skeleton" aria-hidden="true" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={poster}
              alt=""
              loading="lazy"
              style={{ opacity: loaded ? 1 : 0 }}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        ) : failed ? (
          <span className="disc-card-letter">{(item.title || '?').charAt(0)}</span>
        ) : (
          <span className="img-skeleton" aria-hidden="true" />
        )}
      </div>
      <div className="disc-card-title">{item.title}</div>
      {genreLabel && <div className="disc-card-genre">{genreLabel}</div>}
    </button>
  );
}
