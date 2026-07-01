// 半券コレクションの「お気に入り」（作品タイトル単位・プロフィール別）。
// 2026-07-02 から user_state 経由でクラウド同期（マージは union）。

import { queueStatePush } from './supabase';

export function favoritesKey(profileId) {
  return profileId ? `cl_fav_dramas_${profileId}` : 'cl_fav_dramas';
}

export function loadFavorites(profileId) {
  try {
    const a = JSON.parse(localStorage.getItem(favoritesKey(profileId)) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export function isFavorite(profileId, title) {
  return loadFavorites(profileId).includes(title);
}

// お気に入りをトグルして新しい配列を返す。
export function toggleFavorite(profileId, title) {
  const a = loadFavorites(profileId);
  const i = a.indexOf(title);
  if (i >= 0) a.splice(i, 1);
  else a.push(title);
  try {
    localStorage.setItem(favoritesKey(profileId), JSON.stringify(a));
    queueStatePush(favoritesKey(profileId), 1000); // 連打はトロットルで畳む
  } catch {
    /* ignore */
  }
  return a;
}
