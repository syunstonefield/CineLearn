// サポート / ヘルプ（/support）。(marketing) ルートグループのレイアウト
// （<html lang="ja">＋landing.css）配下で表示される静的ページ。
// 見た目は landing.css に依存せずインラインスタイルで自己完結（privacy/terms と同じ作法）。

const CONTACT_EMAIL = 'cinelearn.202606@gmail.com';

export const metadata = {
  title: 'サポート・使い方 — CineLearn',
  description:
    'CineLearnの使い方・対応サービス・よくある質問・お問い合わせ先。拡張機能の導入からログイン、単語の保存・復習までを案内します。',
  robots: { index: false, follow: false },
};

const wrap = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '64px 20px 96px',
  color: '#2b2b2b',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  lineHeight: 1.85,
  fontSize: 15,
};
const h1 = { fontSize: 30, fontWeight: 700, marginBottom: 6, color: '#1a1a1a' };
const lead = { fontSize: 14, color: '#666', marginBottom: 40 };
const h2 = { fontSize: 19, fontWeight: 600, margin: '38px 0 10px', color: '#1a1a1a' };
const li = { marginBottom: 8 };
const a = { color: '#c8a96e', textDecoration: 'underline' };
const qa = { margin: '18px 0' };
const q = { fontWeight: 600, color: '#1a1a1a', marginBottom: 4 };

export default function SupportPage() {
  return (
    <main style={wrap}>
      <a href="/" style={{ ...a, fontSize: 13 }}>← トップへ戻る</a>
      <h1 style={h1}>サポート・使い方</h1>
      <p style={lead}>
        CineLearn は、Netflix・Amazon Prime Video・Disney+ の字幕からクリックした単語を保存し、
        間隔反復で復習できる学習支援ツールです。困ったときはこのページをご覧ください。
      </p>

      <h2 style={h2}>はじめかた</h2>
      <ol>
        <li style={li}>
          Chrome ウェブストアから <strong>拡張機能「CineLearn」</strong> を追加します。
        </li>
        <li style={li}>
          学習アプリ（
          <a href="https://cinelearn-next.vercel.app/app" style={a}>cinelearn-next.vercel.app</a>
          ）を開き、ログイン（またはこのデバイスのみで利用）します。
          <br />
          ※ クラウド同期を使う場合は、ログインした状態でこのページを一度開くと拡張機能にログインが引き継がれます。
        </li>
        <li style={li}>
          Netflix などで動画を再生し、字幕の知らない単語を<strong>クリック</strong>すると単語帳に保存されます。
        </li>
        <li style={li}>
          学習アプリの「単語帳」「復習」で、保存した単語を間隔反復で復習できます。
        </li>
      </ol>

      <h2 style={h2}>対応サービス</h2>
      <ul>
        <li style={li}><strong>Netflix</strong>：単語保存・例文・字幕ナビ（◀▶）に対応</li>
        <li style={li}><strong>Amazon Prime Video</strong>：単語保存・例文・字幕ナビ（◀▶）に対応</li>
        <li style={li}><strong>Disney+</strong>：単語保存・例文・セリフのコピーに対応（◀▶ は非対応）</li>
      </ul>
      <p style={{ fontSize: 13, color: '#888' }}>
        ※ YouTube は近日対応予定です。
      </p>

      <h2 style={h2}>よくある質問</h2>

      <div style={qa}>
        <div style={q}>Q. 単語をクリックしても保存されません。</div>
        <div>
          拡張機能が ON になっているか（画面の「CineLearn」バッジ）をご確認ください。
          クラウド同期がうまくいかない場合は、学習アプリにログインした状態でページを開き直すと
          拡張機能にログインが引き継がれます。それでも直らない場合は
          <code>chrome://extensions</code> で拡張機能を再読み込みしてお試しください。
        </div>
      </div>

      <div style={qa}>
        <div style={q}>Q. 一部の作品で例文が付きません。</div>
        <div>
          例文は字幕データベース（OpenSubtitles）に登録のある映画・ドラマから引用しています。
          該当作品・話数のデータが無い場合は例文が付かないことがあります（単語の保存・意味の表示は可能です）。
        </div>
      </div>

      <div style={qa}>
        <div style={q}>Q. 前後のセリフへ移動する ◀▶ が出ません。</div>
        <div>
          ◀▶（字幕ナビ）は Netflix・Amazon Prime Video のみ対応です。Disney+ では
          単語保存・例文・セリフのコピーがご利用いただけます。
        </div>
      </div>

      <div style={qa}>
        <div style={q}>Q. 保存した単語を消したい／端末を変えたい。</div>
        <div>
          学習アプリの「単語帳」から個別・一括で削除できます。ログインしていれば、
          別の端末でも同じアカウントでログインすると単語帳が復元されます。
        </div>
      </div>

      <div style={qa}>
        <div style={q}>Q. 料金はかかりますか？</div>
        <div>無料でご利用いただけます。</div>
      </div>

      <h2 style={h2}>お問い合わせ・削除依頼</h2>
      <p>
        ご質問・不具合の報告・データ削除のご依頼は、下記までお願いします。
        <br />
        <a href={`mailto:${CONTACT_EMAIL}`} style={a}>{CONTACT_EMAIL}</a>
      </p>
      <p style={{ fontSize: 13, color: '#888', marginTop: 24 }}>
        <a href="/privacy" style={a}>プライバシーポリシー</a>
        {' ・ '}
        <a href="/terms" style={a}>利用規約</a>
      </p>

      <h2 style={h2}>免責・非提携</h2>
      <p style={{ fontSize: 13, color: '#666' }}>
        CineLearn は Netflix・Amazon・Disney・TMDB・OpenSubtitles と提携・公認関係にありません。
        各社の名称・商標は各権利者に帰属します。
      </p>
    </main>
  );
}
