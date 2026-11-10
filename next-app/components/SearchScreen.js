'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { searchTitlesTMDB, aiSearchTitles, candidateToDrama } from '@/lib/titleSearch';
import {
  RECOMMENDED,
  GENRE_LABELS,
  chipFilter,
  visibleChips,
  levelGroups,
  levelMark,
  matchRecommended,
  findRecommendedById,
  recommendedToDrama,
} from '@/lib/recommended';
import { tmdb } from '@/lib/api';
import { trackUsage } from '@/lib/usage';

// 全画面「作品を探す」（2026-11-10 作り替え・reports/search-redesign-2026-11-10/）。
// ・検索：打っている途中から候補（厳選は端末の中で即時・TMDB は 0.3 秒待って1回）。Enter で結果の一覧
//   （候補が手薄なら AI の言い換え検索に自動で切り替え＝今までどおり）。見つからない時だけ「AI に探してもらう」を大きく。
// ・英語学習に向いている作品：CineLearn が選んだ作品（lib/recommended.js）を、細い札で絞り、レベルに合う順に並べる。
// ・見た目は単語リストとそろえる（白い札・細い枠・作品名は茶色・理由の文は --text-soft）。
// 法務（2026-11-10）：レベルは「CineLearn が付けた目安」と一覧の上に1回（CEFR の語・TOEIC の点数は出さない）／
//   一覧の下に非提携の1文／ポスターは行の横の小さな札（印や文を重ねない）／recommended.js の services は出さない。
// 利用統計：固定の名前と回数だけ（検索語・作品名は入れない）。

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

const SUGGEST_DELAY_MS = 300; // TMDB への問い合わせは打ち終わって 0.3 秒後に1回
const SUGGEST_MAX = 5;
const suggestCache = new Map(); // 検索語 → TMDB の候補（この画面を開いている間の使い回し）
const posterCache = new Map(); // tmdbId → ポスターの URL（'' は無し）

const GROUP_LABEL = {
  fit: (lv) => `あなたのレベル（${lv}）に合う`,
  stretch: () => '少し背伸びしたい時に',
  other: () => 'ほかの作品',
};

export default function SearchScreen() {
  const { searchQuery, setSearchQuery, setScreen, openDrama, settings } = useApp();
  const userLevel = settings.userLevel || 'B1';

  const [query, setQuery] = useState(searchQuery || '');
  const [showResults, setShowResults] = useState(false); // 結果の一覧を出しているか（false＝一覧 or 候補）
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [chip, setChip] = useState('all');
  const [recent, setRecent] = useState([]);
  const [tmdbSuggest, setTmdbSuggest] = useState({ q: '', items: [] });
  const seq = useRef(0);
  const suggestSeq = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const q = query.trim();
  const typing = q.length > 0 && !showResults;

  // 打っている途中の候補（TMDB）。厳選からの候補は下の useMemo で即時。
  useEffect(() => {
    if (!typing || q.length < 2) return undefined;
    if (suggestCache.has(q)) {
      setTmdbSuggest({ q, items: suggestCache.get(q) });
      return undefined;
    }
    const my = ++suggestSeq.current;
    const t = setTimeout(async () => {
      try {
        const items = (await searchTitlesTMDB(q)).slice(0, SUGGEST_MAX);
        suggestCache.set(q, items);
        if (my === suggestSeq.current) setTmdbSuggest({ q, items });
      } catch {
        /* 候補が出ないだけ（Enter の検索は別に動く） */
      }
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(t);
  }, [typing, q]);

  const suggestions = useMemo(() => {
    if (!typing) return [];
    const local = matchRecommended(q).map((d) => ({ kind: 'pool', key: `p${d.tmdbId}`, item: d }));
    const seen = new Set(local.map((x) => x.item.tmdbId));
    const remote = (tmdbSuggest.q === q ? tmdbSuggest.items : [])
      .filter((s) => !seen.has(s.tmdbId))
      .map((s) => ({ kind: 'tmdb', key: `t${s.tmdbId}`, item: s }));
    return [...local, ...remote].slice(0, SUGGEST_MAX);
  }, [typing, q, tmdbSuggest]);

  const runSearch = async (raw, { count = true } = {}) => {
    const t = (raw ?? query).trim();
    if (t.length < 2) return;
    if (count) trackUsage('search_run');
    setQuery(t);
    setRecent(pushRecent(t));
    setShowResults(true);
    inputRef.current?.blur();
    const my = ++seq.current;
    setAiMode(false);
    setLoading(true);
    try {
      let items = await searchTitlesTMDB(t);
      if (my !== seq.current) return;
      // 直検索が手薄（候補<3）＝表記ゆれ等でTMDBが本家を返せていない（例「スターウォーズ」=中黒なし）。
      // 自動でAI解釈検索にフォールバック（"Star Wars"に正規化→本家サーガが出る）。
      if (items.length < 3) {
        const ai = await aiSearchTitles(t);
        if (my !== seq.current) return;
        if (ai.length) {
          const s = new Set(ai.map((x) => x.tmdbId));
          items = [...ai, ...items.filter((x) => !s.has(x.tmdbId))];
          setAiMode(true);
        }
      }
      setResults(items);
      if (count && items.length === 0) trackUsage('search_none');
    } catch {
      if (my === seq.current) setResults([]);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  const runAiSearch = async () => {
    const t = query.trim();
    if (t.length < 2) return;
    trackUsage('search_ai');
    const my = ++seq.current;
    setAiMode(true);
    setLoading(true);
    try {
      const items = await aiSearchTitles(t);
      if (my !== seq.current) return;
      setResults(items);
    } catch {
      if (my === seq.current) setResults([]);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  const clearQuery = () => {
    ++seq.current;
    setQuery('');
    setResults([]);
    setShowResults(false);
    setLoading(false);
    setAiMode(false);
    inputRef.current?.focus();
  };

  // ホームの外から検索語が渡されていれば（単語リストから「← 作品を探す」で戻った時など）結果を出し直す。数えない。
  useEffect(() => {
    if ((searchQuery || '').trim().length >= 2) runSearch(searchQuery, { count: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 開いた作品から「戻る」で帰れるよう、検索語を常駐の state へ書き戻してから開く。
  const pickWith = (d, keepQuery) => {
    setSearchQuery(keepQuery ? query : '');
    openDrama(d, true, { returnTo: 'search' });
  };
  // 厳選に入っている作品は、検索から選んでもレベルなどの情報つきで開く。
  const pickCandidate = (s, keepQuery) => {
    const pool = findRecommendedById(s.tmdbId);
    pickWith(pool && s.mediaType !== 'movie' ? recommendedToDrama(pool, userLevel) : candidateToDrama(s, userLevel), keepQuery);
  };

  const onSuggest = (sg) => {
    trackUsage('search_suggest_pick');
    if (sg.kind === 'pool') pickWith(recommendedToDrama(sg.item, userLevel), true);
    else pickCandidate(sg.item, true);
  };

  const chips = useMemo(() => visibleChips(RECOMMENDED), []);
  const groups = useMemo(() => levelGroups(chipFilter(chip), userLevel), [chip, userLevel]);

  return (
    <div className="screen active" id="screen-search">
      <div className="screen-inner srch">
        <div className="srch-head">
          <button type="button" className="btn-back" onClick={() => setScreen('main')}>
            ← ホーム
          </button>
          <h1 className="screen-title">作品を探す</h1>
        </div>

        <div>
          <label className="srch-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              className="srch-input"
              placeholder="作品名で探す（日本語でも OK）"
              aria-label="作品名で探す"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  runSearch();
                }
              }}
            />
            {query && (
              <button type="button" className="srch-clear" onClick={clearQuery} aria-label="検索語を消す">
                ✕
              </button>
            )}
          </label>

          {!q && recent.length > 0 && (
            <div className="srch-recent">
              <small>最近</small>
              {recent.slice(0, 4).map((r) => (
                <button
                  key={r}
                  type="button"
                  className="srch-recent-chip"
                  onClick={() => {
                    trackUsage('search_recent');
                    runSearch(r, { count: false });
                  }}
                >
                  {r}
                </button>
              ))}
              <button
                type="button"
                className="srch-recent-clear"
                onClick={() => {
                  clearRecent();
                  setRecent([]);
                }}
              >
                消す
              </button>
            </div>
          )}
        </div>

        {/* ── 打っている途中の候補 ── */}
        {typing && (
          <div className="srch-suggest" role="listbox" aria-label="候補">
            {suggestions.map((sg) => {
              const it = sg.item;
              const main = sg.kind === 'pool' ? it.title : it.localizedTitle || it.englishTitle;
              const sub =
                sg.kind === 'pool'
                  ? it.ja
                  : [it.localizedTitle && it.localizedTitle !== it.englishTitle ? it.englishTitle : '', it.year].filter(Boolean).join('　');
              return (
                <button key={sg.key} type="button" role="option" aria-selected="false" onClick={() => onSuggest(sg)}>
                  <span className="srch-suggest-main">{main}</span>
                  {sub && <small>{sub}</small>}
                </button>
              );
            })}
            {q.length >= 2 && (
              <button type="button" className="srch-suggest-go" onClick={() => runSearch()}>
                「{q}」で検索
              </button>
            )}
          </div>
        )}

        {/* ── 検索の結果 ── */}
        {showResults && (
          <div className="srch-results">
            {loading ? (
              <div className="loading">
                <div className="spinner" />
                {aiMode ? 'AI が候補を考えています…' : '検索中…'}
              </div>
            ) : results.length === 0 ? (
              <div className="srch-empty">
                「{q}」に合う作品が見つかりませんでした。
                <br />
                うろ覚えの名前や、内容の説明でも探せます。
                {!aiMode && (
                  <div>
                    <button type="button" className="btn-secondary srch-ai-btn" onClick={runAiSearch}>
                      AI に探してもらう
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <p className="srch-res-head">
                  {aiMode ? 'AI が解釈した候補' : `「${q}」の検索結果`}　{results.length}件
                </p>
                {results.map((s, i) => (
                  <ResultRow
                    key={s.tmdbId}
                    item={s}
                    n={i}
                    onPick={() => {
                      trackUsage('search_result_pick');
                      pickCandidate(s, true);
                    }}
                  />
                ))}
                {!aiMode && (
                  <p className="srch-ai-link">
                    思った作品が出ない時は
                    <button type="button" onClick={runAiSearch}>
                      AI に探してもらう
                    </button>
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 英語学習に向いている作品（CineLearn が選んだ作品）── */}
        {!q && !showResults && (
          <section className="srch-sec">
            <h2 className="srch-sec-title">英語学習に向いている作品</h2>
            <p className="srch-sec-sub">CineLearn が選んだ {RECOMMENDED.length} 作品です。レベルは CineLearn が作品に付けた目安です。</p>
            <div className="srch-chips" role="group" aria-label="ジャンルで絞る">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={'srch-chip' + (chip === c.key ? ' is-on' : '')}
                  aria-pressed={chip === c.key}
                  onClick={() => {
                    if (c.key !== chip) trackUsage('search_chip');
                    setChip(c.key);
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="srch-grp">{GROUP_LABEL[g.key](userLevel)}</div>
                {g.items.map((d, i) => (
                  <PoolRow
                    key={d.tmdbId}
                    item={d}
                    n={i}
                    userLevel={userLevel}
                    onPick={() => {
                      trackUsage('search_list_pick');
                      pickWith(recommendedToDrama(d, userLevel), false);
                    }}
                  />
                ))}
              </div>
            ))}
            <p className="srch-foot">
              ここにない作品も、上の検索から探せます（映画も OK）。
              <br />
              作品の権利者・配信サービスとは提携していません。
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

// 行の左の小さなポスター（TMDB）。src: null＝取得中（灰色の札）／''＝無し（頭文字の札）。
function RowPoster({ src, title }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (src === null) {
    return (
      <span className="srch-ps" aria-hidden="true">
        <span className="img-skeleton" />
      </span>
    );
  }
  if (!src || failed) {
    return (
      <span className="srch-ps srch-ps-letter" aria-hidden="true">
        {(title || '?').replace(/^The /, '').charAt(0)}
      </span>
    );
  }
  return (
    <span className="srch-ps" aria-hidden="true">
      {!loaded && <span className="img-skeleton" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </span>
  );
}

// 厳選の作品のポスターを TMDB から（作品 ID で引く・この画面の間は使い回す）。
function usePoolPoster(item) {
  const [src, setSrc] = useState(() => posterCache.get(item.tmdbId) ?? item.posterPath ?? null);
  useEffect(() => {
    if (src !== null || posterCache.has(item.tmdbId)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const d = await tmdb({ action: 'seasons', tvId: item.tmdbId });
        const url = d?.poster_path ? `https://image.tmdb.org/t/p/w185${d.poster_path}` : '';
        posterCache.set(item.tmdbId, url);
        if (!cancelled) setSrc(url);
      } catch {
        if (!cancelled) setSrc('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.tmdbId, src]);
  return src;
}

function PoolRow({ item, n, userLevel, onPick }) {
  const src = usePoolPoster(item);
  return (
    <button type="button" className="srch-row" style={{ animationDelay: `${Math.min(n, 8) * 35}ms` }} onClick={onPick}>
      <RowPoster src={src} title={item.title} />
      <span className="srch-row-tx">
        <span className="srch-row-t">
          {item.title}
          <em className="srch-lv">{levelMark(item, userLevel)}</em>
        </span>
        <span className="srch-row-m">
          {GENRE_LABELS[item.genre] || ''}　{item.ja}
        </span>
        <span className="srch-row-r">{item.reason}</span>
      </span>
      <span className="srch-row-ch" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function ResultRow({ item, n, onPick }) {
  const main = item.localizedTitle || item.englishTitle;
  const en = item.localizedTitle && item.localizedTitle !== item.englishTitle ? item.englishTitle : '';
  return (
    <button type="button" className="srch-row" style={{ animationDelay: `${Math.min(n, 8) * 35}ms` }} onClick={onPick} title={item.englishTitle}>
      <RowPoster src={item.posterPath || ''} title={item.englishTitle} />
      <span className="srch-row-tx">
        <span className="srch-row-t">
          {main}
          <span className={'srch-type' + (item.mediaType === 'movie' ? ' is-movie' : '')}>{item.mediaType === 'movie' ? '映画' : 'ドラマ'}</span>
        </span>
        <span className="srch-row-m">{[en, item.year].filter(Boolean).join('　')}</span>
      </span>
      <span className="srch-row-ch" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
