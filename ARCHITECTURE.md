# CineLearn アーキテクチャ地図（初心者向け）

> 困ったとき・どこを直せばいいか分からないとき、**最初にここを見る**ためのファイルです。
> 細かい関数の一覧は `TECHNICAL_SPEC.md` に、ここでは「**全体像**」と「**どこを触ればいいか**」だけ。

---

## 1. このアプリは何でできているか（3つの世界）

CineLearnは大きく **3つの世界** に分かれています。

```
┌────────────────────────────────────────────────────────────┐
│ 世界①：ブラウザのアプリ本体（あなたが普段見ている画面）        │
│   index.html  … 画面の骨組み（HTML）                         │
│   js/app.js   … 頭脳。ほぼ全部のロジックがここ（約4000行）     │
│   js/supabase.js … クラウド保存（端末間の同期）担当           │
│   js/wordlist.js … マイ単語帳の表示                          │
│   css/style.css  … 見た目                                   │
└────────────────────────────────────────────────────────────┘
        │  ↑ APIキー（パスワード）は画面側に置けないので…
        ▼
┌────────────────────────────────────────────────────────────┐
│ 世界②：サーバー（/api・Vercelが動かす小さなプログラム）         │
│   api/claude.js     … AI(Claude)に「単語を作って」と頼む       │
│   api/subtitles.js  … OpenSubtitlesから字幕を取ってくる        │
│   api/tmdb.js       … TMDbから作品情報（話数・映画判定）        │
│   api/push-*.js     … プッシュ通知                            │
│   ※ ここに API キーを隠している（重要：画面側には絶対置かない） │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 世界③：Chrome拡張（Netflix/アマプラ/YouTube で動く）           │
│   extension/content.js … 動画の字幕単語をクリックで単語帳へ    │
│   extension/bridge.js  … 拡張 ⇔ アプリ本体 のデータ橋渡し      │
│   extension/background.js … 拡張の裏方（Supabase同期など）     │
│   manifest.json … 拡張の設定（対応サイト・権限）              │
└────────────────────────────────────────────────────────────┘
```

**なぜサーバー（世界②）が要るのか？**
Claude・OpenSubtitles・TMDbを使うには「APIキー」というパスワードが必要です。これを画面側(js)に書くと**誰でも盗める**ので、サーバー側に隠して「画面 → 自分のサーバー → 外部サービス」と中継しています。

---

## 2. 一番大事な「処理の流れ」

これさえ覚えれば、今後の修正の8割は「流れのどこの話か」で場所が分かります。

```
①ドラマを選ぶ
      ↓   （js/app.js: loadDramaFromLibrary / selectViewingService）
②作品情報を取得（TV?映画? 何シーズン?）
      ↓   （api/tmdb.js 経由・fetchTitleInfoFromTMDb）
③字幕を取得
      ↓   （api/subtitles.js 経由・preloadSubtitle）
④AIが字幕から単語リストを作る
      ↓   （api/claude.js 経由・generateVocabFromEpisode）
⑤画面に単語リストを表示
      ↓   （renderVocab）
⑥テスト＆復習（SRS=間隔反復学習）
          （startReview / reviewWord）
```

**今までいじってきた所をこの流れに当てはめると：**
- 映画対応 → ②（TMDbでの判定）と③（字幕検索）
- 字幕の取り違え → ③（どの回の字幕を使うか）
- 単語のレベル精度 → ④（Claudeへの指示文）
- タイムスタンプ順ソート → ⑤（表示）

---

## 3. データはどこに保存されている？（超重要）

CineLearnは**3か所**にデータを持っています。ここが分かると「消えない」「同期されない」系のバグが理解できます。

| 保存先 | 何が入っている | 特徴 |
|---|---|---|
| **localStorage**（ブラウザ内） | 履歴・設定・字幕キャッシュ・マイ単語 | その端末・そのブラウザだけ。消すと消える |
| **Supabase**（クラウドDB） | 履歴・マイ単語・SRS・プロフィール | ログイン時に**端末間で同期**。本当の保存場所 |
| **chrome.storage**（拡張内） | 拡張が保存したマイ単語 | 拡張専用。bridge.js が localStorage に橋渡し |

⚠️ **ハマりどころ**：localStorageだけ消してもリロードすると**Supabaseから復活**します（実際にハマった）。「本当に消す」にはSupabase側も消す必要があります。

**キーの例**（localStorageの中身。F12→Applicationで見られる）：
```
cl_history          履歴
cl_settings         設定
cl_srs              復習データ
cl_my_words         マイ単語帳
cl_sub_suits_s1e8   Suits S1E8の字幕（パース済み）
cl_sub_raw_suits_s1e8  同・生SRT（タイムスタンプ付き）
cl_title_alias      日本語→英語タイトル対応表
```

---

## 4. 「○○を直したい」→ どこを見る？ 早見表

| やりたいこと | 見るファイル / 関数 |
|---|---|
| 画面の見た目・文言 | `index.html`, `css/style.css` |
| 単語の選ばれ方・レベル | `js/app.js` → `generateVocabFromEpisode`（Claudeへの指示文） |
| 字幕の取得・選択 | `js/app.js` → `preloadSubtitle` / `searchSubtitles`、`api/subtitles.js` |
| 映画 / ドラマの判定 | `js/app.js` → `fetchTitleInfoFromTMDb`、`api/tmdb.js` |
| タイムスタンプ・並び順 | `js/app.js` → `getSubtitleCues` / `findWordCueSec` / `renderVocab` |
| 復習・テストのロジック | `js/app.js` → `reviewWord` / `startReview` / `generateQuiz` |
| 履歴の保存・削除 | `js/app.js` → `saveToHistory` / `deleteHistoryItem`、`js/supabase.js` |
| クラウド同期 | `js/supabase.js`（`cloudSync` / `pullFromCloud`） |
| 拡張機能（動画上の単語クリック） | `extension/content.js` |
| 対応サイトの追加 | `manifest.json` + `extension/content.js`（セレクタ追加） |
| AIモデルの変更 | `api/claude.js`（`model:` の行） |

---

## 5. 外部サービス（依存しているもの）

| サービス | 役割 | 使う場所 |
|---|---|---|
| **Anthropic Claude** | 字幕から単語抽出・クイズ生成 | `api/claude.js`（モデル: Haiku 4.5） |
| **OpenSubtitles** | 英語字幕の検索・ダウンロード | `api/subtitles.js` |
| **TMDb** | 作品情報・話数・映画/TV判定・配信先 | `api/tmdb.js` |
| **Supabase** | ユーザー認証・クラウド保存 | `js/supabase.js` |
| **Free Dictionary API** | 拡張での単語の意味表示 | `extension/content.js` |
| **Vercel** | アプリとAPIのホスティング・デプロイ | `vercel --prod` |

---

## 6. デプロイ（公開）の仕組み

```
ローカルでファイル編集
      ↓
vercel --prod          ← これで本番(cine-learn.vercel.app)に反映
      ↓
git commit / git push  ← これは「記録・バックアップ」（GitHubへ）
```

⚠️ **重要**：`vercel --prod`（公開）と `git push`（記録）は**別物**。
- サイトを更新したい → `vercel --prod`
- コードを記録/バックアップしたい → `git commit` + `git push`
- 拡張機能の更新 → ファイル変更後、`chrome://extensions` で🔄再読み込み（Vercelは関係なし）

---

## 7. ざっくり用語

- **SRS（間隔反復）**：忘れる前に復習する間隔をだんだん延ばす学習法。`reviewWord`が日数を計算。
- **CEFR**：英語レベルの世界標準（A1〜C2）。単語の難易度指定に使用。
- **tier（core/advanced/context）**：単語の重要度区分。
- **生SRT / パース済み字幕**：生SRT＝時刻付きの元データ、パース済み＝セリフだけ抜いたもの。
- **名寄せ**：「オフキャンパス」＝「Off Campus」のように別表記を同一視すること。

---

## まずはここから（おすすめの読み方）

1. このファイル（全体像）をざっと頭に入れる
2. F12 → Application → Local Storage で `cl_` で始まるキーを眺める（データの実物を見る）
3. 気になる機能があったら **4章の早見表**で該当関数を探し、その関数だけ読む
4. 分からなければ「この関数は何してる？」とAIに聞く

> 全部を一度に理解しようとしないこと。**「流れ（2章）」と「どこを見るか（4章）」**だけで、日々の修正は回せます。
