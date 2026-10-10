// sitemap.xml（Next.js metadata file convention）。検索に出すのは公開ページだけ（/app は除外）。
const BASE = 'https://cinelearn-next.vercel.app';
const UPDATED = new Date('2026-10-11');

export default function sitemap() {
  return [
    { url: `${BASE}/`, lastModified: UPDATED, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/support`, lastModified: UPDATED, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/terms`, lastModified: UPDATED, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: UPDATED, changeFrequency: 'monthly', priority: 0.3 },
  ];
}
