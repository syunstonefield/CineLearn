// 復習カード・予習カードから ★／♡ を付ける時の、my_words へ入れる記録の形（2026-11-07）。
//   単語リストの ★（VocabScreen handleStar）と同じ列を写す。場面座標は復習カードの _src（履歴の集約メタ）か
//   保存語自身の dramaTitle/season/episode から。映画は S/E を null に。
import { todayStr } from './storage';

export function entryFromCard(w, scene = {}) {
  const src = w?._src || {};
  const isMovie = scene.isMovie ?? src.type === 'movie';
  const title = scene.title || src.title || w?.dramaTitle || '';
  const season = isMovie ? null : scene.season ?? src.season ?? w?.season ?? null;
  const episode = isMovie ? null : scene.episode ?? src.episode ?? w?.episode ?? null;
  return {
    word: w.word,
    sentence: w.example || w.sentence || '',
    phonetic: w.phonetic || '',
    pos: w.pos || '',
    definition: w.ja || w.definition || '',
    ja: w.ja || w.definition || null,
    example_ja: w.example_ja || '',
    tsSec: w.tsSec ?? null,
    savedAt: todayStr(),
    source: 'star',
    dramaTitle: title,
    season,
    episode,
    level: w.level || null,
    levelShown: w.levelShown || null,
  };
}

// ♡ の上限判定に使う「その話」の座標（entryFromCard と同じ規則）
export function sceneOf(w, scene = {}) {
  const e = entryFromCard(w, scene);
  return { dramaTitle: e.dramaTitle, season: e.season, episode: e.episode };
}
