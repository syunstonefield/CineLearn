// プライバシーポリシー（/privacy）。(marketing) ルートグループのレイアウト
// （<html lang="ja">＋landing.css）配下で表示される静的ページ。
// landing.css のクラスに依存しないよう、見た目はインラインスタイルで自己完結させる。
//
// §3 の第三者送信一覧は「コードの実態」から書く（2026-09-12 に全面改訂）。根拠となるルート:
//   /api/vocab-generate（字幕全文→Anthropic）・/api/claude（wordsense/sentence/recommend）・
//   /api/translate（Azure）・/api/example（OpenSubtitles）・/api/tmdb・/api/push-notify（web-push）・
//   lib/ratelimit（Upstash）・両 layout（Google Fonts・Vercel Analytics）・拡張 content.js（dictionaryapi）。
//   送信先や送る内容を変えたら、この一覧と docs/chrome-web-store-listing.md §6 を必ず同期する。

import { NON_AFFILIATION } from '@/lib/legal';

const CONTACT_EMAIL = 'cinelearn.202606@gmail.com';
const UPDATED = '2026年9月12日';

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
const subUl = { margin: '4px 0 2px', paddingLeft: 18 };
const note = { fontSize: 13, color: '#666', marginTop: 10 };
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
          ただしログインの有無にかかわらず、機能提供のため、クリックした単語・作品名・話数・再生位置・
          クリック時に表示されていた字幕の一文を、単語の英日翻訳・文脈訳・例文の補完のために当社サーバーへ
          一時的に送信します（字幕の一文は照合と訳の生成にのみ用い、当社サーバーは保存しません）。
          拡張機能は ◀▶（前後のセリフへ移動）操作のため、視聴中に表示された字幕の時刻表を
          端末内（拡張機能のストレージ）にのみ一時保持し、当社サーバーへは送信しません。
          ログイン中は、Web アプリのログインセッション（認証トークン）を拡張機能のストレージへ複製し、
          拡張機能から単語を同期する際にのみ使用します（当社ドメインのページからのみ取得し、ログアウトで削除されます）。
        </li>
        <li style={li}>
          <strong>作品リクエスト：</strong>対応リストに無い作品で「リクエスト」を押した場合、その作品の ID・作品名と、
          1端末1票の判定のためにブラウザ内で生成したランダムな端末識別子を当社サーバーに保存します
          （メールアドレス等の個人情報とは結び付けません）。
        </li>
        <li style={li}>
          <strong>共有キャッシュの投稿元情報：</strong>作品ごとの単語リストや訳は、利用者間で共有する
          キャッシュに保存して再利用します。このキャッシュへ単語リストを保存する際、投稿元の識別子
          （IP アドレスまたはログイン利用者の ID）の不可逆ハッシュ値を、内部の汚染対策のためにのみ
          保存します。ハッシュ値は公開せず、元の IP アドレス・ID に復元することはできません。
        </li>
        <li style={li}>
          <strong>通知情報：</strong>復習リマインダーを有効にした場合、プッシュ通知の購読情報。
        </li>
        <li style={li}>
          <strong>アクセス情報：</strong>ホスティング事業者が標準的なアクセスログ（IPアドレス等）を
          取得する場合があります。また API の過剰利用を防ぐため、IP アドレス（ログイン中は利用者 ID）
          単位の利用回数を短期間保存します（下記 Upstash）。
        </li>
      </ul>

      <h2 style={h2}>2. 利用目的</h2>
      <ul>
        <li style={li}>単語生成・単語帳・復習（SRS）などの学習機能の提供</li>
        <li style={li}>あなたに合わせた学習プランのご提案・パーソナライズ</li>
        <li style={li}>複数端末間でのクラウド同期</li>
        <li style={li}>復習リマインダーの配信</li>
        <li style={li}>API の過剰利用の防止、共有キャッシュの汚染対策</li>
        <li style={li}>本サービスの品質改善（ページビュー等の匿名の利用統計）</li>
      </ul>

      <h2 style={h2}>3. 第三者サービスへのデータ送信</h2>
      <p>本サービスは、機能提供に必要な範囲で以下の外部サービスを利用します。</p>
      <ul>
        <li style={li}>
          <strong>Supabase</strong>：認証（メールアドレス等）と、クラウド同期する学習データ・
          通知の購読情報の保存。
        </li>
        <li style={li}>
          <strong>TMDB（The Movie Database）</strong>：作品の検索・作品情報の取得。検索語・作品 ID は
          当社サーバー経由で送信します。ポスター画像はお使いのブラウザが image.tmdb.org から直接読み込みます。
        </li>
        <li style={li}>
          <strong>OpenSubtitles</strong>：学習用字幕の取得。当社サーバーから作品の識別情報
          （作品 ID・シーズン/話数）のみを送信し、利用者の情報は送信しません。
        </li>
        <li style={li}>
          <strong>Anthropic（Claude API）</strong>：当社サーバーから、以下の目的で以下の内容を送信します。
          <ul style={subUl}>
            <li>単語リストの生成：対象話の字幕テキスト全文と作品名・話数</li>
            <li>単語の文脈訳：クリックした単語と、その時に表示されていた字幕の一文（当社サーバーは保存しません）</li>
            <li>例文の和訳：例文1文</li>
            <li>作品のおすすめ・作品検索：英語レベル（TOEIC スコアの目安を含む）・好きなジャンル・利用している動画サービス・入力した検索語（作品名など）</li>
          </ul>
          Anthropic の商用利用規約（Commercial Terms of Service）に基づき、当社サーバーから API 経由で
          送信したデータは Anthropic のモデル学習には利用されません（当社は学習利用を許諾していません）。
          Anthropic 側で不正利用監視のため一定期間保持される場合があります。
        </li>
        <li style={li}>
          <strong>Microsoft（Azure AI Translator）</strong>：単語・短い語句の翻訳に Microsoft Azure AI
          Translator を利用することがあります（例文の和訳・文脈訳は Anthropic）。送信するのは
          翻訳対象の単語・語句のみです。
        </li>
        <li style={li}>
          <strong>Free Dictionary API（dictionaryapi.dev）</strong>：クリックした単語の英語定義・発音の取得。
          拡張機能がお使いのブラウザから直接、クリックした単語のみを送信します。
        </li>
        <li style={li}>
          <strong>Vercel</strong>：本サービスのホスティングと、Web Analytics によるページビュー等の
          匿名の利用統計の取得。
        </li>
        <li style={li}>
          <strong>Upstash</strong>：API の過剰利用防止（レート制限）。レート制限のため、IP アドレスまたは
          ログイン利用者の ID を含むカウンタを最長24時間保存します（内容データは送りません）。
          API 利用枠の統計も保存します。
        </li>
        <li style={li}>
          <strong>Google Fonts</strong>：表示用フォント。お使いのブラウザが Google のサーバーから直接読み込みます。
        </li>
        <li style={li}>
          <strong>プッシュ通知サービス（Google / Mozilla / Apple）</strong>：復習リマインダーの配信。
          購読先のプッシュ配信サービスへ、暗号化した通知データと購読エンドポイントを送信します
          （各社は通知の内容を読めません）。
        </li>
      </ul>
      <p style={note}>
        ※ ポスター画像（image.tmdb.org）・Free Dictionary API・Google Fonts は、お使いのブラウザから
        直接読み込むため、端末の IP アドレス等の接続情報が各社に送信されます。
      </p>

      <h2 style={h2}>4. データの販売・第三者提供</h2>
      <p>
        当社はユーザーの個人データを販売しません。また、法令に基づく場合等を除き、第三者に提供しません。
      </p>

      <h2 style={h2}>5. データの保存と削除</h2>
      <p>
        クラウドに保存されたデータは、アカウントの削除またはご依頼に応じて削除します。
        端末内データは、ブラウザまたは拡張機能の操作でいつでも削除できます。
        レート制限のカウンタは最長24時間で自動的に消去されます。
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
        {NON_AFFILIATION}
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </main>
  );
}
