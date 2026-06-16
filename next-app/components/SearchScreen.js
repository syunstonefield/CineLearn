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
              <div className="search-results">
                {results.map((s) => (
                  <button key={s.tmdbId} type="button" className="search-suggest-item" onClick={() => pick(s)}>
                    {s.posterPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="search-suggest-thumb" src={s.posterPath} alt="" />
                    ) : (
                      <span className="search-suggest-thumb search-suggest-thumb-empty">🎬</span>
                    )}
                    <span className="search-suggest-text">
                      <span className="search-suggest-title">{s.englishTitle}</span>
                      {s.localizedTitle && s.localizedTitle !== s.englishTitle && (
                        <span className="search-suggest-sub">{s.localizedTitle}</span>
                      )}
                    </span>
                    <span className={'search-suggest-type ' + (s.mediaType === 'movie' ? 'is-movie' : 'is-tv')}>
                      {s.mediaType === 'movie' ? '映画' : 'ドラマ'}
                    </span>
                    {s.year && <span className="search-suggest-year">{s.year}</span>}
                  </button>
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
