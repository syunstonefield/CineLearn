// 正規アプリからの呼び出しだけを通す Origin ゲート（A7）。
//   claude / example / subtitles / translate / tmdb / push-subscribe / catalog-request の7ルートに
//   複製されていた allowedOrigin をこの1関数へ集約する（/api/vocab と /api/vocab-generate も同じ関数を使う）。
//   多層防御の一枚であり主防御ではない（Origin は詐称できる）。主防御は各ルートのレート制限・認証。
//
// 拡張（chrome-extension://<ID>）の扱い:
//   * 既定 ID の直書きは**しない**。許可 ID は env CL_EXTENSION_IDS（^[a-p]{32}$・カンマ区切り）で受ける。
//   * CL_EXTENSION_ID_ENFORCE が 'true' でない間（既定）は warn-only: スキーム一致で通し、未登録 ID を
//     console.warn('[CL:ORIGIN] unknown ext id', id) で計測する（ストア版と unpacked 開発版の ID を集めてから
//     ENFORCE に切り替える＝A30 のオーナー判断）。
//   * 'true' のときは登録 ID 完全一致のみ許可。
// seed（素の Node）からも import され得るため node:* と相対 import 以外は使わない。

const ALLOWED_HOSTS = ['cinelearn-next.vercel.app', 'cine-learn.vercel.app']; // 本番ホスト完全一致
const EXT_SCHEME = 'chrome-extension://';
const EXT_ID_RE = /^[a-p]{32}$/; // Chrome 拡張 ID は a〜p の32文字

// env から許可 ID の Set を作る（形式外の値は黙って捨てる＝誤設定で全拒否にならないように）。
export function extensionIdAllowlist(env = process.env) {
  return new Set(
    String(env.CL_EXTENSION_IDS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => EXT_ID_RE.test(s))
  );
}

// ID 完全一致を強制するか（既定 false＝warn-only）。
export function extensionIdEnforced(env = process.env) {
  return env.CL_EXTENSION_ID_ENFORCE === 'true';
}

// Origin（無ければ Referer）を見て許可するか。req は Web Request（headers.get）。
//   空は拒否: 正規経路（ブラウザ同一オリジン・拡張 SW・seed の CINELEARN_API_ORIGIN）は必ず付く。
//   ※ push-subscribe は従来「空 Origin 許可」だったが本関数で拒否に変わる（A7・回帰確認対象）。
export function allowedOrigin(req, env = process.env) {
  const s = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!s) return false;
  if (s.startsWith(EXT_SCHEME)) {
    const id = s.slice(EXT_SCHEME.length).split('/')[0].trim().toLowerCase();
    if (!EXT_ID_RE.test(id)) {
      // 正規の拡張 ID は必ず [a-p]{32}。形式外は ENFORCE の有無に関わらず拒否し、ログには定数だけ残す
      //（攻撃者制御の文字列でログを肥大させない・レビュー指摘）。
      console.warn('[CL:ORIGIN] malformed ext id');
      return false;
    }
    if (extensionIdAllowlist(env).has(id)) return true;
    if (extensionIdEnforced(env)) return false;
    console.warn('[CL:ORIGIN] unknown ext id', id); // warn-only 期間の計測（値は ID のみ・個人情報なし）
    return true;
  }
  try {
    const u = new URL(s);
    const selfHost = req.headers.get('host') || '';
    if (selfHost && u.host === selfHost) return true; // 同一オリジン（LAN IP実機/各デプロイURL）
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // 開発
    return ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false; // パース不能な Origin/Referer は拒否
  }
}
