// 利用規約（/terms）。(marketing) ルートグループのレイアウト
// （<html lang="ja">＋landing.css）配下で表示される静的ページ。
// landing.css のクラスに依存しないよう、見た目はインラインスタイルで自己完結させる。
// ※ これは弁護士レビュー前のドラフト（善意の表明＋ユーザー側クレームの盾）。
//   プラットフォーム規約・著作権の構造的論点は本規約では解決しない別軸。

const CONTACT_EMAIL = 'cinelearn.202606@gmail.com';
const UPDATED = '2026年6月18日';

export const metadata = {
  title: '利用規約 — CineLearn',
  description:
    'CineLearnの利用規約。サービスの位置づけ、禁止事項、免責・無保証、責任の制限、準拠法について。',
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

export default function TermsPage() {
  return (
    <main style={wrap}>
      <a href="/" style={{ ...a, fontSize: 13 }}>← トップへ戻る</a>
      <h1 style={h1}>利用規約</h1>
      <p style={meta}>最終更新日：{UPDATED}</p>

      <p>
        本利用規約（以下「本規約」）は、CineLearn（以下「本サービス」）の利用条件を定めるものです。
        本サービスを利用された時点で、ユーザーは本規約に同意したものとみなします。
      </p>

      <h2 style={h2}>1. 本サービスの位置づけ</h2>
      <p>
        本サービスは、ユーザーが自ら正規に契約・視聴している動画作品の字幕を題材に、
        英単語の学習（単語生成・単語帳・復習）を支援する<strong>学習補助ツール</strong>です。
        本サービス自体は、映像・字幕等のコンテンツを配信・提供・販売するものではありません。
      </p>

      <h2 style={h2}>2. 利用条件</h2>
      <ul>
        <li style={li}>
          ユーザーは、動画配信サービス（Netflix、Prime Video 等）を<strong>自身の正規アカウントで適法に</strong>
          利用していることを前提とします。本サービスは視聴契約を代替・提供しません。
        </li>
        <li style={li}>
          クラウド同期を利用する場合のアカウント・データの取り扱いは、
          <a href="/privacy" style={a}>プライバシーポリシー</a>に従います。
        </li>
        <li style={li}>
          未成年者は、保護者の同意を得たうえでご利用ください。
        </li>
      </ul>

      <h2 style={h2}>3. 禁止事項</h2>
      <p>本サービスの利用にあたり、以下の行為を禁止します。</p>
      <ul>
        <li style={li}>
          著作権保護技術（DRM）の回避、コンテンツのダウンロード・録画・複製・再配布に本サービスを用いること。
        </li>
        <li style={li}>
          ユーザーが視聴している動画配信サービスその他の第三者サービスの利用規約に違反する目的で用いること。
        </li>
        <li style={li}>
          本サービスまたは関連サービスへの不正アクセス、過度な自動アクセス、
          法令で認められる範囲を超えるリバースエンジニアリング。
        </li>
        <li style={li}>本サービスの本来の目的（個人の語学学習）を超える無断の商用利用。</li>
        <li style={li}>法令または公序良俗に反する利用。</li>
      </ul>

      <h2 style={h2}>4. 知的財産</h2>
      <p>
        本サービスのソフトウェア・デザイン等の知的財産権は、運営者または正当な権利者に帰属します。
        作品名・字幕・画像等のコンテンツに関する権利は、各権利者に帰属します。
        本サービスは、字幕の一文を出所明示のうえ学習目的で引用する場合を除き、コンテンツの権利を取得・主張しません。
      </p>

      <h2 style={h2}>5. 免責・無保証</h2>
      <p>
        本サービスは「現状有姿（as-is）」で提供されます。運営者は、本サービスの正確性・完全性・有用性・
        特定目的への適合性・継続的な提供について、明示・黙示を問わずいかなる保証も行いません。
        本サービスは外部サービス（動画配信サービスの画面構造、字幕・翻訳・AI等の提供事業者）に依存しており、
        これらの仕様変更等により機能が予告なく動作しなくなる場合があります。
      </p>

      <h2 style={h2}>6. 責任の制限</h2>
      <p>
        法令で認められる最大限の範囲において、運営者は、本サービスの利用または利用不能から生じた
        いかなる損害（直接・間接・特別・結果的損害を含む）についても責任を負いません。
        ユーザーは、自己の責任において、適用される法令および第三者サービスの規約を遵守して本サービスを利用するものとします。
      </p>

      <h2 style={h2}>7. サービスの変更・中断・終了</h2>
      <p>
        運営者は、ユーザーへの事前通知なく、本サービスの内容を変更し、または提供を中断・終了することができます。
        これによりユーザーに生じた損害について、運営者は責任を負いません。
      </p>

      <h2 style={h2}>8. 非提携</h2>
      <p>
        本サービスは、Netflix, Amazon, The Movie Database (TMDB), OpenSubtitles, Microsoft その他の動画配信・
        データ提供事業者と提携・公認関係にありません。各社の名称・商標は各権利者に帰属します。
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>

      <h2 style={h2}>9. 準拠法・管轄</h2>
      <p>
        本規約は日本法に準拠して解釈されます。本サービスに関して紛争が生じた場合は、
        運営者の所在地を管轄する裁判所を専属的合意管轄裁判所とします。
      </p>

      <h2 style={h2}>10. 本規約の変更</h2>
      <p>本規約は必要に応じて改定します。重要な変更がある場合はこのページで告知します。</p>

      <h2 style={h2}>11. お問い合わせ</h2>
      <p>
        本規約に関するご質問、権利者からの削除要請（著作権等）は、以下までご連絡ください。
        <br />
        メール：<a href={`mailto:${CONTACT_EMAIL}`} style={a}>{CONTACT_EMAIL}</a>
      </p>
    </main>
  );
}
