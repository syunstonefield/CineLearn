'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { searchTitlesTMDB, aiSearchTitles, candidateToDrama } from '@/lib/titleSearch';

// タイトル検索の結果画面（おすすめと同じく独立画面）。
// ダッシュボードの検索ボックスから遷移し、入力タイトルの候補を一覧表示する。
// 既定はTMDB即時検索（速い）。「AIで探す」で曖昧・日本語・うろ覚え入力を救う。
export default function SearchScreen() {
  const { searchQuery, setScreen, openDrama, settings } = useApp();
  const userLevel = settings.userLevel || 'B1';

  const [query, setQuery] = useState(searchQuery || '');
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | loading | done
  const [aiMode, setAiMode] = useState(false);
  const seq = useRef(0);

  const runSearch = async (q) => {
    const t = (q ?? query).trim();
    if (t.length < 2) return;
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

  // 初回：ダッシュボードから渡された検索語で即検索
  useEffect(() => {
    if ((searchQuery || '').trim().length >= 2) runSearch(searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (s) => openDrama(candidateToDrama(s, userLevel), true);

  return (
    <div className="screen active" id="screen-search">
      <div className="screen-inner">
        <div className="screen-header">
          <button className="btn-back" onClick={() => setScreen('main')}>
            ← マイドラマ
          </button>
          <div>
            <div className="screen-title">作品を検索</div>
            <div className="screen-desc">観たいドラマ・映画のタイトルを検索して追加します</div>
          </div>
        </div>

        <div className="search-page-box">
          <input
            type="text"
            className="search-page-input"
            placeholder="ドラマ・映画のタイトル..."
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
          <button type="button" className="btn-primary search-page-btn" onClick={() => runSearch()}>
            検索
          </button>
        </div>

        {phase === 'loading' ? (
          <div className="loading">
            <div className="spinner"></div>
            {aiMode ? '🤖 AIが候補を考えています…' : '検索中…'}
          </div>
        ) : phase === 'done' && results.length === 0 ? (
          <div className="empty-state">
            該当する作品が見つかりませんでした。
            <br />
            日本語名・うろ覚えのときは「🤖 AIで探す」を試してください。
          </div>
        ) : (
          results.length > 0 && (
            <>
              {aiMode && <div className="search-suggest-aihint">🤖 AIが解釈した候補</div>}
              {/* ダッシュボードと揃えたポスターグリッドで「本棚から選ぶ」見せ方に */}
              <div className="select-grid">
                {results.map((s) => (
                  <SelectCard key={s.tmdbId} item={s} onPick={pick} />
                ))}
              </div>
            </>
          )
        )}

        {/* 思った作品が出ないとき用のAI検索（曖昧・日本語・うろ覚えを救う） */}
        {phase === 'done' && query.trim().length >= 2 && !aiMode && (
          <button type="button" className="btn-secondary search-ai-btn" onClick={runAiSearch}>
            🤖 思った作品が出ない？ AIで探す
          </button>
        )}
      </div>
    </div>
  );
}

// 検索結果1件＝ポスターカード。読み込み中はシマー、失敗/無しは🎬フォールバック。
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
