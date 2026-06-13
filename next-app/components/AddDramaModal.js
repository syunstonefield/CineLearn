'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { GENRES, recommendDramas, searchDramaByTitle } from '@/lib/recommend';

// 既存 addDramaModal（AI推薦 / タイトル検索）の再現。
// initialTab='recommend'|'search', initialQuery はツールバー検索から開いた時に使う。
export default function AddDramaModal({ initialTab = 'recommend', initialQuery = '', onClose }) {
  const { settings, openDrama, toggleGenre, openRecommend } = useApp();
  const [tab, setTab] = useState(initialTab);

  // AI推薦タブ（ジャンルは settings を単一の真実として参照）
  const genres = settings.selectedGenres || ['Crime Thriller'];
  const [recoState, setRecoState] = useState({ phase: 'idle', items: [], msg: '', retry: '' });

  // 検索タブ
  const [query, setQuery] = useState(initialQuery);
  const [searchState, setSearchState] = useState({ phase: 'idle', items: [], msg: '' });
  const searchedOnce = useRef(false);

  const userLevel = settings.userLevel || 'B1';
  const toeicScore = settings.toeicScore || 0;
  const selectedServices = settings.selectedServices || [];

  const runRecommend = async () => {
    if (genres.length === 0) {
      alert('ジャンルを選んでください');
      return;
    }
    setRecoState({ phase: 'loading', items: [], msg: '', retry: '' });
    try {
      const items = await recommendDramas(
        { userLevel, toeicScore, selectedGenres: genres, selectedServices },
        (attempt, waitSec) =>
          setRecoState((s) => ({ ...s, retry: `混雑中... ${waitSec}秒後に再試行 (${attempt}/3)` }))
      );
      setRecoState({ phase: 'done', items, msg: '', retry: '' });
    } catch (e) {
      setRecoState({ phase: 'error', items: [], msg: e.message, retry: '' });
    }
  };

  const runSearch = async (q) => {
    const title = (q ?? query).trim();
    if (!title) return;
    setSearchState({ phase: 'loading', items: [], msg: '' });
    try {
      const items = await searchDramaByTitle(title, { userLevel, selectedServices });
      setSearchState({ phase: 'done', items, msg: '' });
    } catch (e) {
      setSearchState({ phase: 'error', items: [], msg: e.message });
    }
  };

  // ツールバー検索から開いた場合は自動で検索を実行
  useEffect(() => {
    if (initialTab === 'search' && initialQuery && !searchedOnce.current) {
      searchedOnce.current = true;
      runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ドラマ選択（selectDrama 相当）→ サービス選択画面へ
  const pick = (d) => {
    onClose();
    openDrama(d, true); // 新規追加なので前回サービスをクリア
  };

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={overlayClick}>
      <div className="modal-panel">
        <div className="modal-header">
          <span className="modal-title">🎬 ドラマを探す</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {/* ＋追加導線：おすすめから探す（独立画面 screen-recommend へ） */}
          <button
            className="btn-recommend-entry"
            onClick={() => {
              onClose();
              openRecommend();
            }}
          >
            ✨ おすすめから探す
            <span className="btn-recommend-entry-sub">あなたのレベル・契約サービスに合う人気作品</span>
          </button>
          <div className="modal-tabs">
            <button
              className={'modal-tab' + (tab === 'recommend' ? ' active' : '')}
              onClick={() => setTab('recommend')}
            >
              AI推薦
            </button>
            <button
              className={'modal-tab' + (tab === 'search' ? ' active' : '')}
              onClick={() => setTab('search')}
            >
              タイトルで検索
            </button>
          </div>

          {/* AI推薦タブ */}
          <div className={'tab-pane' + (tab === 'recommend' ? ' active' : '')}>
            <div className="genre-tags">
              {GENRES.map((g) => (
                <span
                  key={g.genre}
                  className={'tag' + (genres.includes(g.genre) ? ' active' : '')}
                  onClick={() => toggleGenre(g.genre)}
                >
                  {g.label}
                </span>
              ))}
            </div>
            <button
              className="btn-primary"
              style={{ margin: '12px 0 8px' }}
              disabled={recoState.phase === 'loading'}
              onClick={runRecommend}
            >
              {recoState.phase === 'loading' ? '生成中...' : 'AIにおすすめを聞く'}
            </button>
            <div className="drama-list">
              <DramaResults state={recoState} emptyMsg="ジャンルを選んでおすすめを取得してください" onPick={pick} />
            </div>
          </div>

          {/* 検索タブ */}
          <div className={'tab-pane' + (tab === 'search' ? ' active' : '')}>
            <div className="search-row" style={{ marginTop: 12 }}>
              <input
                type="text"
                className="toeic-input"
                placeholder="例：SUITS、Breaking Bad"
                style={{ flex: 1, marginRight: 8 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
              <button
                className="btn-primary"
                disabled={searchState.phase === 'loading'}
                onClick={() => runSearch()}
              >
                検索
              </button>
            </div>
            <div className="drama-list" style={{ marginTop: 12 }}>
              <DramaResults state={searchState} emptyMsg="タイトルを入力して検索してください" onPick={pick} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 結果リスト（loading / error / empty / cards）
function DramaResults({ state, emptyMsg, onPick }) {
  if (state.phase === 'loading') {
    return (
      <div className="loading">
        <div className="spinner"></div>
        {state.retry || 'AIが考えています...'}
      </div>
    );
  }
  if (state.phase === 'error') {
    return <div className="empty-state" style={{ color: 'var(--red)' }}>{state.msg}</div>;
  }
  if (state.phase !== 'done') {
    return <div className="empty-state">{emptyMsg}</div>;
  }
  if (!state.items.length) {
    return <div className="empty-state">作品が見つかりませんでした</div>;
  }
  return state.items.map((d, i) => <DramaCard key={`${d.title}-${i}`} drama={d} onPick={onPick} />);
}

// 1作品カード（renderDramas の .drama-card 再現）
function DramaCard({ drama: d, onPick }) {
  const [selected, setSelected] = useState(false);
  return (
    <div
      className={'drama-card' + (selected ? ' selected' : '')}
      onClick={() => {
        setSelected(true);
        onPick(d);
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="drama-title">{d.title}</div>
        <span className={`level-pill level-${d.level}`}>{d.level}</span>
      </div>
      <div className="drama-meta">
        <span>{d.platform}</span>
        <span>{d.genre}</span>
        <span>{d.speech_feature}</span>
      </div>
      <div className="drama-reason">{d.reason}</div>
    </div>
  );
}
