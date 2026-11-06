'use strict';
// CineLearn - Service Worker (background.js)

const SUPABASE_URL      = 'https://mndyexwdevkpdssglwpl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZHlleHdkZXZrcGRzc2dsd3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTcyOTQsImV4cCI6MjA5NTk5MzI5NH0.P6GDNdWAGMPpjc1zltGS9LAFWej5M8knchqTIDDNrE4';
const SB_SESSION_KEY    = 'cl_sb_session';
// 共有キャッシュ＋例文補完 API（Next.js 版本番）。/api/example はここに置かれている。
const CINELEARN_NEXT_URL = 'https://cinelearn-next.vercel.app';

// ツールバーのアイコン → Webアプリを開く（旧・拡張内 index.html は2026-07-02退役。
// URL指定の tabs.create は "tabs" 権限不要）。
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${CINELEARN_NEXT_URL}/app` });
});

// 新規インストールの時だけアプリを開く（v1.2.11）。更新・Chrome 本体の更新では開かない。
//   ログインしないと単語がアプリに届かないため、最初に登録へ案内する（lib/extEntry.js が印を読む）。
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  chrome.tabs.create({ url: `${CINELEARN_NEXT_URL}/app?from=ext_install` });
});

// content.js からの単語保存メッセージを受け取って Supabase に同期
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SAVE_WORD_TO_CLOUD') {
    syncWordToSupabase(msg.word)
      .then((ok) => sendResponse({ ok, queued: !ok }))
      .catch(() => sendResponse({ ok: false }));
    return true; // 非同期レスポンスを使うため必須
  }
  // クリック保存の例文バックフィル（経路②→①畳み込み #3）。
  // 配信字幕は保存せず、OpenSubtitles 由来の1文を /api/example から取得して返す。
  // content.js から fetch すると別オリジンの CORS に阻まれるため background が代理する。
  if (msg.type === 'CL_FETCH_EXAMPLE') {
    fetch(`${CINELEARN_NEXT_URL}/api/example`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.payload || {}),
    })
      .then(r => {
        if (r.ok) return r.json();
        // 非2xxでも route.js が付けた reason（rate_limited/forbidden 等）を拡張のログへ透過する
        return r.json()
          .then(b => ({ found: false, reason: b?.reason || ('http_' + r.status) }))
          .catch(() => ({ found: false, reason: 'http_' + r.status }));
      })
      .then(data => sendResponse(data))
      .catch(() => sendResponse({ found: false, reason: 'network' }));
    return true; // 非同期レスポンス
  }
  // 他の作品で出会った語（v1.2.9・視聴中の再会）: ログイン済みならクラウドの
  //   ①単語帳（my_words・in_wordbook=true）②復習で「覚えた」以上（srs_data・repetitions>=2・skipped=false）
  //   を取り、content.js が字幕の中で印＋ホバー/ポップアップに出所を出す。語・意味・品詞・出所だけ
  //   （例文は取らない）。RLS で本人の行だけ。列が無いDB（in_wordbook/origin_* 未適用）は列を外して再試行。
  if (msg.type === 'CL_FETCH_KNOWN_WORDS') {
    (async () => {
      const session = await getFreshSession().catch(() => null);
      if (!session?.access_token || !session?.user?.id) return { found: false, reason: 'no_session' };
      const uid = session.user.id;
      const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` };
      const get = (path) => fetchAllRows(path, headers); // 1000 行で切れないよう最後まで読む（v1.2.12）
      // ① 単語帳
      let mw = await get(`my_words?user_id=eq.${uid}&in_wordbook=is.true&select=word,ja,pos,drama_title,season,episode`);
      if (!mw.ok && /in_wordbook/.test(mw.body)) {
        mw = await get(`my_words?user_id=eq.${uid}&select=word,ja,pos,drama_title,season,episode`);
      }
      // ② 覚えた以上（出所つき）
      let srs = await get(`srs_data?user_id=eq.${uid}&repetitions=gte.2&skipped=is.false&select=word,repetitions,interval,ease_factor,origin_title,origin_season,origin_episode`);
      if (!srs.ok && /origin_/.test(srs.body)) {
        srs = await get(`srs_data?user_id=eq.${uid}&repetitions=gte.2&skipped=is.false&select=word,repetitions,interval,ease_factor`);
      }
      if (!mw.ok && !srs.ok) return { found: false, reason: 'http_' + (mw.status || srs.status) };
      const words = [];
      for (const r of (mw.ok ? mw.rows : [])) {
        if (!r?.word) continue;
        words.push({ w: String(r.word).toLowerCase(), ja: r.ja || '', pos: r.pos || '', title: r.drama_title || '', season: r.season ?? null, episode: r.episode ?? null, kind: 'wordbook' });
      }
      for (const r of (srs.ok ? srs.rows : [])) {
        if (!r?.word) continue;
        const mastered = r.repetitions >= 3 && r.interval >= 21 && parseFloat(r.ease_factor) >= 2.0;
        words.push({ w: String(r.word).toLowerCase(), ja: '', pos: '', title: r.origin_title || '', season: r.origin_season ?? null, episode: r.origin_episode ?? null, kind: mastered ? 'mastered' : 'learned' });
      }
      return { found: true, uid, words };
    })()
      .then((data) => sendResponse(data))
      .catch(() => sendResponse({ found: false, reason: 'network' }));
    return true; // 非同期レスポンス
  }
  // 再会の記録（v1.2.9）: content.js が溜めた再会ログ（直近500件）を user_state 'cl_reunions' に丸ごと上書き。
  //   書き手は拡張だけ（アプリは読むだけ）＝last-write-wins でも壊れない。my_words には触れない。
  if (msg.type === 'CL_PUSH_REUNIONS') {
    (async () => {
      const session = await getFreshSession().catch(() => null);
      if (!session?.access_token || !session?.user?.id) return { ok: false, reason: 'no_session' };
      // 送るのは今の持ち主の台帳（v1.2.12）。content.js の一覧は5秒前の姿で、その間に切り替わると前の人の分になる。
      if (!(await ensureLedgerOwner(session.user.id))) return { ok: false, reason: 'ledger_switch_failed' };
      const { [REUNIONS_KEY]: list = [] } = await chrome.storage.local.get(REUNIONS_KEY);
      if (!list.length) return { ok: true, skipped: true }; // 空でクラウドの記録を潰さない
      const r = await fetch(`${SUPABASE_URL}/rest/v1/user_state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify([{ user_id: session.user.id, key: REUNIONS_KEY, value: list, updated_at: new Date().toISOString() }]),
      });
      return { ok: r.ok, status: r.status };
    })()
      .then((data) => sendResponse(data))
      .catch(() => sendResponse({ ok: false, reason: 'network' }));
    return true; // 非同期レスポンス
  }
  // 字幕マーカー用の語リスト（v1.2.9）: 作品名＋S/E → その話の自動生成リストの語（文字列だけ）。
  // 読み取り専用・未生成なら found:false（生成は起動しない＝視聴のたびの AI 費用を避ける）。
  // ログイン済みなら Bearer を添える（カタログ外の作品はログイン済みだけ配信＝/api/vocab-generate と同じ規則）。
  if (msg.type === 'CL_FETCH_VOCAB_MARKS') {
    getFreshSession()
      .catch(() => null)
      .then((session) => fetch(`${CINELEARN_NEXT_URL}/api/vocab-marks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(msg.payload || {}),
      }))
      .then(r => {
        if (r.ok) return r.json();
        return r.json()
          .then(b => ({ found: false, reason: b?.reason || ('http_' + r.status) }))
          .catch(() => ({ found: false, reason: 'http_' + r.status }));
      })
      .then(data => sendResponse(data))
      .catch(() => sendResponse({ found: false, reason: 'network' }));
    return true; // 非同期レスポンス
  }
  // 文脈つき語義（v1.2.2）: 字幕文＋語をサーバへ渡し「この場面では」の意味を得る。
  // サーバ側（/api/claude mode:'wordsense'）でプロンプト構築・Haiku・sense_hash共有キャッシュ。
  if (msg.type === 'CL_WORDSENSE') {
    fetch(`${CINELEARN_NEXT_URL}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'wordsense', word: msg.word, sentence: msg.sentence }),
    })
      // 非2xx（429=日次上限 / 403=Origin弾き / 5xx）を黙って {ja:null} に潰すと、画面には
      // 「訳・定義が見つかりませんでした」としか出ず原因が分からない（2026-08-06 の切り分けで
      // 実際に詰まった）。CL_FETCH_EXAMPLE と同じく reason を透過し content.js 側でログに出す。
      .then(r => (r.ok ? r.json() : { ja: null, reason: 'http_' + r.status }))
      .then(data => sendResponse(data))
      .catch(() => sendResponse({ ja: null, reason: 'network' }));
    return true; // 非同期レスポンス
  }
  // 単語クリック時の英日訳（公式翻訳APIの鍵をサーバー側に隠すため /api/translate を代理）。
  // content.js から外部翻訳APIを直接叩かず、鍵はサーバーに保管・結果はサーバーでキャッシュする。
  if (msg.type === 'CL_TRANSLATE_JA') {
    fetch(`${CINELEARN_NEXT_URL}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: msg.word }),
    })
      .then(r => (r.ok ? r.json() : { ja: null, reason: 'http_' + r.status }))
      .then(data => sendResponse(data))
      .catch(() => sendResponse({ ja: null, reason: 'network' }));
    return true; // 非同期レスポンス
  }
});

// ── 全件取得（v1.2.12）──
//   PostgREST は1回の応答を上限（既定 1000 行）で黙って打ち切る。limit を大きくしても切れる
//   （アプリの srs_data で端末間の復習がずれた事故 2026-11-07 と同じ型）。主キーの word 順に、返った行数ぶん
//   offset を進めて空のページまで読む＝サーバ側の上限がいくつでも取りこぼさない。
//   1ページでも失敗したら ok:false（呼び出し側は途中までの結果で判断しない）。
const PAGE_ROWS = 1000;
const PAGE_ROWS_MAX = 50000; // 暴走防止（1人の行数として十分大きい）
async function fetchAllRows(path, headers) {
  const rows = [];
  while (rows.length < PAGE_ROWS_MAX) {
    let r;
    try {
      r = await fetch(`${SUPABASE_URL}/rest/v1/${path}&order=word.asc&limit=${PAGE_ROWS}&offset=${rows.length}`, { headers });
    } catch {
      return { ok: false, status: 0, body: '' };
    }
    if (!r.ok) return { ok: false, status: r.status, body: await r.text().catch(() => '') };
    const page = await r.json().catch(() => null);
    if (!Array.isArray(page)) return { ok: false, status: r.status, body: '' };
    if (!page.length) return { ok: true, rows };
    rows.push(...page);
  }
  return { ok: false, status: 0, body: 'too_many_rows' };
}

// セッションを有効な状態に保つ（js/supabase.js の ensureFreshSession と同等）。
// アクセストークンは約1時間で失効するため、期限が近ければ refresh_token で
// 自動更新して chrome.storage に書き戻す。これが無いと失効後の単語保存が
// 黙ってクラウド同期されなくなる（単語帳には残るが他端末に届かない）。
const EXT_REFRESH_AHEAD_SEC = 15 * 60;
let _refreshPromise = null; // 並行リフレッシュ防止（refresh_token は使い捨てのため）

async function getFreshSession() {
  const result  = await chrome.storage.local.get([SB_SESSION_KEY]);
  const session = result[SB_SESSION_KEY];
  if (!session?.access_token) return null;

  const now = Date.now() / 1000;
  // アプリ（期限の10分前に更新）より先に更新し、bridge.js でアプリへ戻す＝同じ refresh_token を両方が使って
  //   後の側が already used で拒否される取り合いを起こさない（v1.2.12・裏側と合わせた 15 分）。
  if (session.expires_at && session.expires_at - now > EXT_REFRESH_AHEAD_SEC) return session; // まだ新鮮
  if (!session.refresh_token) return null;

  if (!_refreshPromise) {
    _refreshPromise = (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        const d = await res.json();
        // 更新の間にセッションが変わっていたら（アプリから新しいものが届いた・別の人に切り替わった・ログアウトした）、
        //   古いセッションの結果で上書きも削除もしない（v1.2.12）。呼び出し側は次の契機でやり直す。
        const { [SB_SESSION_KEY]: now } = await chrome.storage.local.get([SB_SESSION_KEY]);
        if (now?.refresh_token !== session.refresh_token) return null;
        if (!d?.access_token) {
          // refresh_token が無効（400/401）＝再ログインが必要。失効セッションを破棄して
          // 使い捨て refresh_token の無駄撃ちを止める（bridge.js が Webアプリから再取得する）。
          // ネットワーク一過性エラー（下の catch）ではセッションを温存する。
          if (res.status === 400 || res.status === 401) {
            await chrome.storage.local.remove(SB_SESSION_KEY);
          }
          return null;
        }
        if (!d.expires_at) d.expires_at = Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
        if (!d.user) d.user = session.user; // 応答に user が無い場合は引き継ぐ
        // ここで書いた新しいセッションは bridge.js がアプリへ戻す（refresh_token は使い捨てなので、戻さないと
        //   アプリ側の更新が already used で失敗し、アプリのログインが切れていた・v1.2.12）。
        await chrome.storage.local.set({ [SB_SESSION_KEY]: d });
        return d;
      } catch {
        return null;
      } finally {
        _refreshPromise = null;
      }
    })();
  }
  return _refreshPromise;
}

// my_words.ts_sec（📍場面時刻）が実DBにまだ無い時に true。列が無いまま送ると行ごと弾かれるため、
// 一度弾かれたらこのサービスワーカーが生きている間は送らない（下の再送を参照）。
let tsSecUnsupported = false;

// ── 未送信キュー（2026-10-02 ワンダヴィジョン S1E4 で実害）─────────────────────────
//   旧実装はセッションが無い（未ログイン・refresh 失効）と黙って return し、通信失敗も握り潰していた。
//   拡張のローカル台帳には残るがクラウドに届かず、アプリ（my_words が唯一の橋）からは「保存されていない」
//   ように見えた。送れなかった語は「マージ後の姿」を語単位で保持し、セッションが来た時／ワーカー起動時／
//   次の送信成功時にまとめて再送する。同じ語は最新の姿で置き換える（古い姿で新しい値を潰さない）。
const SYNC_PENDING_KEY = 'cl_sync_pending';
const SYNC_PENDING_MAX = 2000;

// ── 持ち主（1台の Chrome を複数アカウントで共有する場合の取り違え防止・2026-10-04）──
//   キューの語には「誰の語か」(_clOwner=user_id) を付ける。ログイン中に送れなかった語はその人、
//   未ログインで保存した語は「この Chrome で直前にログインしていた人」(cl_last_user_id) の語とみなす。
//   再送は今のログインと持ち主が一致する語だけ＝Aさんの未送信語がBさんの単語帳へ流れない
//   （一致しない語はキューに保留し、Aさんが再ログインした時に送る）。
//   持ち主不明（この Chrome で一度もログインしていない）の語は、最初にログインした人の語として送る。
const LAST_USER_KEY = 'cl_last_user_id';
const pendingKeyOf = (w) => `${w._clOwner || ''}|${String(w.word).toLowerCase()}`;

async function getLastUserId() {
  const { [LAST_USER_KEY]: id = null } = await chrome.storage.local.get(LAST_USER_KEY);
  return id;
}
async function rememberUser(uid) {
  if (uid && uid !== (await getLastUserId())) await chrome.storage.local.set({ [LAST_USER_KEY]: uid });
}

// ── 端末の台帳の持ち主（同じ Chrome で別アカウントに切り替えた時の混入防止・v1.2.12）──
//   cl_my_words*（保存語）と cl_reunions（再会の記録）はキーにアカウントを含まない。持ち主が変わったら
//   前の人の分を持ち主別の控えへ移し、新しい人の控えを戻す。content.js は今のキーのまま読み書きできる。
//   ・同じ人の入り直し＝持ち主が同じなので何もしない
//   ・持ち主なし（一度もログインしていない端末）＝最初にログインした人がそのまま引き継ぐ（ゲストの語）
//   ・既存の利用者の更新＝cl_last_user_id を今の持ち主とみなすので、印を付けるだけで台帳は動かさない
//   移動は1回の set でまとめて書く＝失敗しても元のまま（語は消えない）。次の契機でやり直す。
//   ★残る制限（オーナー決定 2026-11-05 で第2段階は作らない）: ログアウトしただけでは入れ替えない。次のログインまで
//     前の人の語が画面に出るし、未ログインで保存した語は直前の人の語として扱う（上の「持ち主」のとおり）。
const LEDGER_OWNER_KEY = 'cl_ledger_owner';
const LEDGER_ARCHIVE_PREFIX = 'cl_ledger_archive_'; // cl_my_words で始めない（recoverUnsyncedOnce の走査に入れない）
const REUNIONS_KEY = 'cl_reunions';
const KNOWN_WORDS_KEY = 'cl_known_words';
const isLedgerKey = (k) => k.startsWith('cl_my_words') || k === REUNIONS_KEY;
const emptyKnownWords = (uid) => ({ at: 0, uid: uid || null, words: [] });

async function switchLedgerTo(uid) {
  const got = await chrome.storage.local.get([LEDGER_OWNER_KEY, LAST_USER_KEY]);
  const owner = got[LEDGER_OWNER_KEY] || got[LAST_USER_KEY] || null;
  if (owner === uid || !owner) {
    if (got[LEDGER_OWNER_KEY] !== uid) await chrome.storage.local.set({ [LEDGER_OWNER_KEY]: uid });
    return;
  }
  const all = await chrome.storage.local.get(null);
  const leaving = {};
  const next = {};
  for (const [k, v] of Object.entries(all)) {
    if (!isLedgerKey(k)) continue;
    leaving[k] = v;
    next[k] = []; // 空で上書きする（remove と分けると途中で失敗した時に混ざったまま残る）
  }
  const incomingKey = LEDGER_ARCHIVE_PREFIX + uid;
  const incoming = all[incomingKey];
  if (incoming && typeof incoming === 'object') {
    for (const [k, v] of Object.entries(incoming)) if (isLedgerKey(k)) next[k] = v;
  }
  await chrome.storage.local.set({
    ...next,
    [LEDGER_ARCHIVE_PREFIX + owner]: leaving,
    [KNOWN_WORDS_KEY]: emptyKnownWords(uid),
    [LEDGER_OWNER_KEY]: uid,
  });
  // 戻した控えの片付け。失敗しても、この人が次に抜ける時に上書きされるので害はない。
  if (incoming) await chrome.storage.local.remove(incomingKey).catch(() => {});
}

// 台帳を uid のものにする。戻り値 false＝入れ替えに失敗（台帳は元のまま。送信を控えて次の契機に回す）。
//   同期処理・単語の送信・再会の送信が同時に呼ぶので、1本ずつ順に流す。
let _ledgerChain = Promise.resolve();
function ensureLedgerOwner(uid) {
  const run = _ledgerChain.then(() => switchLedgerTo(uid)).then(() => true, () => false);
  _ledgerChain = run;
  return run;
}

async function queuePendingSync(word, owner) {
  if (!word?.word) return;
  const rec = { ...word, _clOwner: word._clOwner || owner || null };
  const { [SYNC_PENDING_KEY]: cur = [] } = await chrome.storage.local.get(SYNC_PENDING_KEY);
  const key = pendingKeyOf(rec);
  const next = cur.filter((w) => pendingKeyOf(w) !== key);
  next.push(rec);
  await chrome.storage.local.set({ [SYNC_PENDING_KEY]: next.slice(-SYNC_PENDING_MAX) });
}

// 送れた語をキューから外す。持ち主不明で積まれていた同じ語も、送った人の語になったので一緒に外す。
async function dropPendingSync(wordText, owner) {
  const { [SYNC_PENDING_KEY]: cur = [] } = await chrome.storage.local.get(SYNC_PENDING_KEY);
  if (!cur.length) return;
  const lower = String(wordText).toLowerCase();
  const next = cur.filter(
    (w) => !(String(w.word).toLowerCase() === lower && (!w._clOwner || w._clOwner === owner))
  );
  if (next.length !== cur.length) await chrome.storage.local.set({ [SYNC_PENDING_KEY]: next });
}

let _flushing = false;
let _flushAgain = false; // 実行中に来た要求（例: 実行中に別アカウントでログイン）を捨てずに、終わってからもう一周
async function flushPendingSync() {
  if (_flushing) {
    _flushAgain = true;
    return;
  }
  _flushing = true;
  _flushAgain = false;
  try {
    const session = await getFreshSession();
    if (!session?.access_token || !session?.user?.id) return;
    const uid = session.user.id;
    if (!(await ensureLedgerOwner(uid))) return; // 台帳が前の人のままなので送らない（次の契機でやり直す）
    // 救済は「直前の持ち主＝今のログイン」の時だけ（別の人のローカル語を今の人へ送らない）。
    const last = await getLastUserId();
    if (!last || last === uid) await recoverUnsyncedOnce(session);
    const { [SYNC_PENDING_KEY]: cur = [] } = await chrome.storage.local.get(SYNC_PENDING_KEY);
    for (const w of cur) {
      if (w._clOwner && w._clOwner !== uid) continue; // 別の人の語は保留（その人の再ログインで送る）
      // 失敗した語は syncWordToSupabase 内でキューに残る（次の契機で再送）。1語の失敗で他を止めない。
      await syncWordToSupabase(w, { fromFlush: true });
    }
    await rememberUser(uid);
  } catch {
    /* 次の契機で再試行 */
  } finally {
    _flushing = false;
    if (_flushAgain) flushPendingSync();
  }
}

// 一回きりの救済: キュー導入前（〜v1.2.9）に未ログインで保存され、クラウドに無い語を拾い直す。
//   対象は 2026-10-03 以降の保存分だけ＝それより前のローカル語には「アプリで削除済み」の語が
//   混ざり得る（ローカル台帳は削除を知らない）ので、全量を押し戻して復活させる事故を避ける。
const RECOVER_FLAG_KEY = 'cl_sync_recover_v1';
const RECOVER_SINCE = '2026-10-03';
async function recoverUnsyncedOnce(session) {
  const all = await chrome.storage.local.get(null);
  if (all[RECOVER_FLAG_KEY]) return;
  const local = new Map();
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('cl_my_words') || !Array.isArray(v)) continue;
    for (const w of v) {
      if (!w?.word || String(w.savedAt || '') < RECOVER_SINCE) continue;
      const lower = String(w.word).toLowerCase();
      if (!local.has(lower)) local.set(lower, w);
    }
  }
  if (local.size) {
    // クラウドの語を最後まで読む（1回の取得は 1000 行で切れ、切れた先の語を「無い」と誤認して
    //   端末の古い記録で上書きしていた・v1.2.12）。全ページ取れた時だけ照合する。
    const res = await fetchAllRows(`my_words?user_id=eq.${session.user.id}&select=word`, {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    });
    if (!res.ok) return; // 照合できない時は何も送らず旗も立てない（次の契機でやり直す）
    const cloud = new Set(res.rows.map((r) => String(r.word).toLowerCase()));
    for (const [lower, w] of local) if (!cloud.has(lower)) await queuePendingSync(w, session.user.id);
  }
  await chrome.storage.local.set({ [RECOVER_FLAG_KEY]: Date.now() });
}

// 契機: Webアプリでログイン（bridge.js がセッションを置く）／ブラウザ起動／ワーカーの起床。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SB_SESSION_KEY]) return;
  if (changes[SB_SESSION_KEY].newValue) flushPendingSync();
  else chrome.storage.local.set({ [KNOWN_WORDS_KEY]: emptyKnownWords() }); // ログアウト後のゲストに前の人の語を出さない
});
chrome.runtime.onStartup.addListener(() => flushPendingSync());
flushPendingSync();

// 戻り値: クラウドに届いたら true。届かなかった語は未送信キューに残す（false）。
async function syncWordToSupabase(word, { fromFlush = false } = {}) {
  const session = await getFreshSession();
  if (!session?.access_token || !session?.user?.id) {
    await queuePendingSync(word, await getLastUserId()); // 未ログイン＝直前にログインしていた人の語
    return false;
  }
  const uid = session.user.id;
  if (word._clOwner && word._clOwner !== uid) {
    await queuePendingSync(word); // 別の人の未送信語は今のアカウントへ送らない
    return false;
  }
  if (!(await ensureLedgerOwner(uid))) {
    await queuePendingSync(word, uid); // 入れ替えに失敗した間は送らない（次の契機で再送）
    return false;
  }

  // my_words の一意キーは (user_id, word) で merge-duplicates は「送った列だけ」更新する。
  // 値が取れなかった列（S/E検出失敗の season/episode・未取得の ja/encounters・空の drama_title）
  // はキーごと省き、クラウド側に残っている正しい値を null/'' で潰さない
  // （Disney+でS/E検出が失敗した再保存が、確定済みの season/episode を消していた）。
  // 「取れなかった値は列ごと省く」＝上のコメントが宣言している規則を、実際に全列へ適用する。
  // ★sentence を無条件に送っていたため（空でも送る）、**アプリが後から入れた例文をクラウドで
  //   '' に塗り潰していた**（merge-duplicates は送った列を必ず更新する）。拡張のローカル台帳には
  //   アプリの後埋め結果が戻らないので、同じ語を再クリック・S/E自己修復・429リトライするたびに
  //   確実に破壊され、次の pull で端末からも例文が消えていた（2026-08-08 追跡で確定）。
  const row = {
    user_id:  session.user.id,
    word:     word.word,
    saved_at: word.savedAt || '',
  };
  if (word.sentence)   row.sentence   = word.sentence;
  if (word.phonetic)   row.phonetic   = word.phonetic;
  if (word.pos)        row.pos        = word.pos;
  if (word.definition) row.definition = word.definition;
  if (word.source)     row.source     = word.source;
  if (word.ja) row.ja = word.ja; // v1.2.2: ポップアップで見せた文脈訳を固定保存
  // 例文が差し替わった保存では、アプリが付けた例文和訳を明示的に消す（訳と例文のペアを保つ）。
  // 拡張は example_ja を作らないため、送らない＝据え置きだと古い訳が新しい例文に残ってしまう。
  if (word._clearExampleJa) row.example_ja = null;
  if (Array.isArray(word.encounters) && word.encounters.length) row.encounters = word.encounters; // v1.2.2: 遭遇ログ
  // 場面座標（作品タイトル・S/E）は一組で送る。saveWord がマージ後の姿を渡してくるため、
  // タイトル付きで S/E が null なのは「作品が変わった等で場面座標が本当に無い」＝クラウドも
  // クリアするのが正（旧作品の S/E が新タイトルに残る虚偽レコードを防ぐ）。
  if (word.dramaTitle) {
    row.drama_title = word.dramaTitle;
    row.season      = word.season  ?? null;
    row.episode     = word.episode ?? null;
    // 📍場面時刻も場面座標の一組として送る（アプリはこれを単語リストの並びと📍表示に使う）。
    // 送っていなかったため、クリック保存した語はアプリ側で必ず時刻なし＝末尾に落ちていた。
    if (!tsSecUnsupported) row.ts_sec = word.tsSec ?? null;
  }

  const post = () =>
    fetch(`${SUPABASE_URL}/rest/v1/my_words`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify([row]),
    });

  let res;
  try {
    res = await post();
  } catch {
    await queuePendingSync(word, uid); // 通信断
    return false;
  }
  // ts_sec 列がまだ無いDB（supabase_my_words_tssec.sql 未実行）では PostgREST が 400 を返し、
  // 行ごと保存されない。列を外して1回だけ再送し、以後このワーカーでは送らない
  // （＝SQL 実行前に拡張を更新しても、単語の同期そのものは壊れない）。
  if (!res.ok && 'ts_sec' in row) {
    let missing = false;
    try {
      const body = await res.clone().json();
      missing = /PGRST204/.test(body?.code || '') || /ts_sec/.test(body?.message || '');
    } catch {
      /* 本文が読めない時は列不足と決めつけない */
    }
    if (missing) {
      tsSecUnsupported = true;
      delete row.ts_sec;
      try {
        res = await post();
      } catch {
        res = null;
      }
    }
  }
  if (!res?.ok) {
    await queuePendingSync(word, uid);
    return false;
  }
  await dropPendingSync(word.word, uid);
  await rememberUser(uid);
  if (!fromFlush) flushPendingSync(); // 送れた＝今は繋がっている。溜まっていた分も流す
  return true;
}
