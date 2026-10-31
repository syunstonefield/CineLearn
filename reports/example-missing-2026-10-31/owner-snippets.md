# 例文が付かなかった語の実データ収集（2026-10-31・Chrome拡張部門）

3か所で実行し、出力（表）をそのまま受付へ貼ってください。秘密鍵・トークンは出力に含めない作りです。

## ① 学習アプリのコンソール（cinelearn-next.vercel.app をログイン状態で開く → F12 → Console）

クラウド my_words の Suits の行（新しい順・最大80件）。sentence は有無と先頭20字だけ。

```js
(async () => {
  const s = JSON.parse(localStorage.getItem('cl_sb_session') || 'null');
  if (!s?.access_token) return console.log('未ログイン');
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';
  const u = 'https://mndyexwdevkpdssglwpl.supabase.co/rest/v1/my_words?user_id=eq.' + s.user.id
    + '&drama_title=ilike.*suits*&order=saved_at.desc&limit=80&select=*';
  const r = await fetch(u, { headers: { apikey: ANON, Authorization: 'Bearer ' + s.access_token } });
  const rows = await r.json();
  console.table(rows.map(w => ({
    word: w.word, 例文: w.sentence ? '有:' + w.sentence.slice(0, 20) : '無',
    drama: w.drama_title, S: w.season, E: w.episode, ts: w.ts_sec, source: w.source,
    saved_at: w.saved_at, created: (w.created_at || '').slice(0, 19), updated: (w.updated_at || '').slice(0, 19),
    ja: w.ja ? '有' : '無', example_ja: w.example_ja ? '有' : '無', wordbook: w.in_wordbook,
  })));
  console.log('件数', rows.length, '例文無し', rows.filter(w => !w.sentence).length);
})();
```

同じコンソールで、端末側（アプリが pull した後のローカル）の失敗理由:

```js
Object.keys(localStorage).filter(k => k.startsWith('cl_my_words')).forEach(k => {
  const ws = JSON.parse(localStorage.getItem(k) || '[]').filter(w => /suits/i.test(w.dramaTitle || ''));
  console.log(k); console.table(ws.map(w => ({ word: w.word, 例文: w.sentence ? '有' : '無', fail: w.exampleFail || '', failAt: w.exampleFailAt || '', ts: w.tsSec, savedAt: w.savedAt, origin: w.origin || w.source })));
});
```

## ② 拡張のサービスワーカーのコンソール（chrome://extensions → CineLearn → 「Service Worker」のリンク）

拡張側の台帳・未送信キュー・セッション期限。

```js
chrome.storage.local.get(null, all => {
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('cl_my_words') && Array.isArray(v)) {
      const ws = v.filter(w => /suits/i.test(w.dramaTitle || '') || (w.savedAt || '') >= '2026-10-31');
      console.log(k, v.length + '語');
      console.table(ws.map(w => ({ word: w.word, 例文: w.sentence ? '有:' + w.sentence.slice(0, 20) : '無', drama: w.dramaTitle, S: w.season, E: w.episode, ts: w.tsSec, savedAt: w.savedAt, source: w.source })));
    }
  }
  const q = all.cl_sync_pending || [];
  console.log('未送信キュー', q.length, q.map(w => w.word + (w.sentence ? '(例文有)' : '(無)')).join(', '));
  const s = all.cl_sb_session;
  console.log('セッション', s ? ('有・期限 ' + new Date((s.expires_at || 0) * 1000).toLocaleString() + '・refresh_token ' + (s.refresh_token ? '有' : '無')) : '無');
  console.log('recover済み', all.cl_sync_recover_v1 ? new Date(all.cl_sync_recover_v1).toLocaleString() : '未');
});
```

## ③ Netflix のタブのコンソール（そのタブをまだ閉じていなければ）

F12 → Console → 右上のレベルで「Verbose（詳細）」をオン → フィルタ欄に `[CL:SE]` と入力。
`backfill <語> S1E1 ✓ via:…` か `✗ reason:…` の行が、語ごとの「どこで落ちたか」の決定的な記録です。出た行を全部コピーしてください。
タブを閉じていれば ③ は不要です（次に同じ症状が出た時にすぐ見てください）。
