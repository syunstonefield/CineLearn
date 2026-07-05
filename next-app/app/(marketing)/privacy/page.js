// プライバシーポリシー（/privacy）。(marketing) ルートグループのレイアウト
// （<html lang="ja">＋landing.css）配下で表示される静的ページ。
// landing.css のクラスに依存しないよう、見た目はインラインスタイルで自己完結させる。

const CONTACT_EMAIL = 'cinelearn.202606@gmail.com';
const UPDATED = '2026年6月20日';

export const metadata = {
  title: 'プライバシーポリシー — CineLearn',
  description:
    'CineLearnのプライバシーポリシー。収集する情報、利用目的、第三者サービスへのデータ送信、データの削除依頼について。',
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
const meta = { fontSize: 13, color: '#888', marginBottom: 40 };
const h2 = { fontSize: 19, fontWeight: 600, margin: '38px 0 10px', color: '#1a1a1a' };
const li = { marginBottom: 6 };
const a = { color: '#c8a96e', textDecoration: 'underline' };

export default function PrivacyPage() {
  return (
    <main style={wrap}>
      <a href="/" style={{ ...a, fontSize: 13 }}>← トップへ戻る</a>
      <h1 style={h1}>プライバシーポリシー</h1>
      <p style={meta}>最終更新日：{UPDATED}</p>

      <p>
        CineLearn（以下「本サービス」）は、ユーザーのプライバシーを尊重し、収集する情報を必要最小限にとどめます。
        本ポリシーは、本サービスが取り扱う情報の種類・利用目的・第三者への送信について説明するものです。
      </p>

      <h2 style={h2}>1. 収集する情報</h2>
      <ul>
        <li style={li}>
          <strong>アカウント情報：</strong>クラウド同期をご利用の場合、認証のためメールアドレス等を
          取得します（認証基盤 Supabase 経由）。ログインせずに利用することもできます。
        </li>
        <li style={li}>
          <strong>学習データ：</strong>保存した単語、例文（字幕の一文）、作品名・シーズン/エピソード、
          英語レベル（TOEIC）設定、学習の進捗・復習スケジュール、予習・視聴の記録
          （予習を完了した作品・話数とその日時）、お気に入り作品、アプリの利用時間。
          ログイン中はこれらを複数端末間の同期のためクラウドに保存します。
        </li>
        <li style={li}>
          <strong>オンボーディング情報：</strong>初回のアンケートでご回答いただくプロフィール属性
          （英語学習の目的、好きなジャンル、学習スタイル、利用している動画サービス、最初に予習したい作品名など）。
          学習プランのご提案・パーソナライズおよびサービス改善のために利用します。
          性別・年代・健康状態などのセンシティブ情報は取得しません。
        </li>
        <li style={li}>
          <strong>端末内データ：</strong>ログインせずに利用する場合、学習データ（単語帳・進捗・
          復習スケジュール等）はお使いの端末（ブラウザの localStorage および拡張機能のストレージ）に
          のみ保存し、学習データそのものを当社サーバーに蓄積することはありません。
          ただしログインの有無にかかわらず、機能提供のため、クリックした単語・作品名・照合用の字幕行を、
          英語定義の取得・英日翻訳・例文の補完のために当社サーバーおよび下記の外部サービスへ
          一時的に送信します（これらは応答の生成にのみ用い、学習データとして蓄積しません）。
        </li>
        <li style={li}>
          <strong>通知情報：</strong>復習リマインダーを有効にした場合、プッシュ通知の購読情報。
        </li>
        <li style={li}>
          <strong>アクセス情報：</strong>ホスティング事業者が標準的なアクセスログ（IPアドレス等）を
          取得する場合があります。
        </li>
      </ul>

      <h2 style={h2}>2. 利用目的</h2>
      <ul>
        <li style={li}>単語生成・単語帳・復習（SRS）などの学習機能の提供</li>
        <li style={li}>あなたに合わせた学習プランのご提案・パーソナライズ</li>
        <li style={li}>複数端末間でのクラウド同期</li>
        <li style={li}>復習リマインダーの配信</li>
        <li style={li}>本サービスの品質改善</li>
      </ul>

      <h2 style={h2}>3. 第三者サービスへのデータ送信</h2>
      <p>本サービスは、機能提供に必要な範囲で以下の外部サービスを利用します。</p>
      <ul>
        <li style={li}><strong>Supabase</strong>：クラウド保存および認証</li>
        <li style={li}><strong>TMDB（The Movie Database）</strong>：作品情報・画像の取得</li>
        <li style={li}><strong>OpenSubtitles</strong>：学習用字幕・例文の取得</li>
        <li style={li}>
          <strong>Free Dictionary API（dictionaryapi.dev）</strong>：クリックした単語の
          英語定義・発音の取得。クリックした単語のみを送信します。
        </li>
        <li style={li}>
          <strong>Anthropic（Claude API）</strong>：単語リストの生成・AIによる文章処理。
          送信したテキストは Anthropic の方針により AI モデルの学習には利用されません。
        </li>
        <li style={li}>
          <strong>DeepL / Microsoft（Azure AI Translator）</strong>：単語・短い例文の英日翻訳。
          翻訳のためにクリックした単語または短い例文を送信します（設定に応じていずれかを利用します）。
        </li>
        <li style={li}><strong>Vercel</strong>：本サービスのホスティング</li>
        <li style={li}>
          <strong>Upstash</strong>：API の過剰利用防止（レート制限）。IPアドレス単位の
          利用回数を短期間保存します（内容データは送信しません）。
        </li>
      </ul>

      <h2 style={h2}>4. データの販売・第三者提供</h2>
      <p>
        当社はユーザーの個人データを販売しません。また、法令に基づく場合等を除き、第三者に提供しません。
      </p>

      <h2 style={h2}>5. データの保存と削除</h2>
      <p>
        クラウドに保存されたデータは、アカウントの削除またはご依頼に応じて削除します。
        端末内データは、ブラウザまたは拡張機能の操作でいつでも削除できます。
        削除のご依頼は下記の連絡先までお願いします。
      </p>

      <h2 style={h2}>6. お問い合わせ・削除依頼</h2>
      <p>
        本ポリシーに関するご質問、データの削除依頼、権利者からの削除要請（著作権等）は、
        以下までご連絡ください。
        <br />
        メール：<a href={`mailto:${CONTACT_EMAIL}`} style={a}>{CONTACT_EMAIL}</a>
      </p>

      <h2 style={h2}>7. 本ポリシーの変更</h2>
      <p>本ポリシーは必要に応じて改定します。重要な変更がある場合はこのページで告知します。</p>

      <h2 style={h2}>8. 免責・非提携</h2>
      <p>
        本サービスは、Netflix, Amazon, The Movie Database (TMDB), OpenSubtitles その他の動画配信・
        データ提供事業者と提携・公認関係にありません。各社の名称・商標は各権利者に帰属します。
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </main>
  );
}
