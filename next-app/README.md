# CineLearn — Next.js 試作版

既存の静的アプリ（`../index.html` + `../js/app.js`）を Next.js（App Router・プレーンJS）で
1画面ずつ作り直す試作。**既存ファイルには一切手を入れない**。

## 起動

```bash
cd next-app
npm install
npm run dev   # → http://localhost:3000
```

## 方針

- `app/style.css` は `../css/style.css` のコピー（既存デザインをそのまま使う）
  - ⚠️ ただし末尾に「**next-app 独自オーバーライド**」ブロックあり（生成ローディング案C等）。
    元cssを再同期（cp）した場合は、このブロックをファイル末尾に貼り直すこと
- localStorage のキー・データ構造は既存と完全に同一（`cl_history`, `cl_srs`,
  `cl_profiles`, `cl_activity_dates`, `cl_my_words_<PROFILE_ID>` など）
- バックエンドは既存の Vercel Functions をそのまま使用。
  ローカル開発中は `next.config.mjs` の rewrites で `/api/*` を
  `https://cine-learn.vercel.app/api/*` にプロキシ
- ロジックは `js/app.js` から `lib/storage.js` へ移植（読み取り中心）

## 進捗

- [x] Step 1: ダッシュボード（学習ライブラリ）
  - ヘッダー / 今日パネル（ストリーク・今日の復習・週次進捗）/ 検索ツールバー / ドラマカード一覧
  - プロフィールは先頭を自動選択（プロフィール選択画面は未移植）
  - 未移植の遷移先はクリック時に「次のステップで移植予定」と表示
- [x] Step 2: サービス選択 → 単語リスト（screen-4）★完全移植
  - サービス選択（TMDb watch_providers で配信先を「確認済み/その他」に分類）
  - ドラマ/映画の選択UI（askMediaTypeChoice）・TMDbシーズン取得
  - 字幕パイプライン（OpenSubtitles検索→DL→SRTパース→品質選別→LRUキャッシュ）
  - Claude単語生成（CEFR帯・tier・除外語/バンド外フィルター）
  - 単語リスト描画（SRSバッジ・tier・📍タイムスタンプ・例文+和訳・進捗バー）
  - Skip/Resume・リスト削除・履歴保存・保存済み再表示・拡張機能単語セクション
  - クイズはバックグラウンド生成して履歴に保存（テスト画面は次ステップ）
  - 移植先: lib/api.js, lib/tmdb.js, lib/subtitles.js, lib/vocab.js, lib/words.js,
    lib/wordlist.js, lib/storage.js（追記）, components/{ServiceSelect,VocabScreen,VocabItem,AppProvider,Dashboard}.js
  - 検証済み: SUITS S1E1 で字幕取得→21語生成→Skip→保存済み再表示まで実機確認
- [x] Step 3: ドラマ追加（addDramaModal）★完全移植
  - AI推薦タブ（8ジャンルタグ・選択状態を selectedGenres に永続化・Claudeで3作品推薦）
  - タイトル検索タブ（Claudeで単作品検索）
  - メインツールバー検索（Enter/🔍 → 検索タブを開いてクエリ自動検索）
  - 結果カード（.drama-card: level-pill / platform / genre / speech_feature / reason）
  - カードクリック → モーダル閉 + myDramas追加 + サービス選択画面へ（selectDrama 相当・前回サービスをクリア）
  - 移植先: lib/recommend.js, components/AddDramaModal.js, Dashboard.js（配線）, AppProvider.js（openDramaにclearService追加）
  - 検証済み: AI推薦3件（Mindhunter等）→選択→service-select+ライブラリ追加、ツールバー"Friends"検索まで実機確認
- [x] Step 4: 視聴後テスト（screen-5）＋復習モーダル（SRSフラッシュカード）★完全移植
  - テスト：4択穴埋め・正誤ハイライト・解説・進捗・スコア（履歴へ保存）・もう一度/マイドラマへ
  - 復習：カードめくり→3段階評価（😰🤔✅）→SM-2更新→完了画面（昇格演出・知らなかった/うろ覚え/完璧グループ・今日の履歴・もう一度）
  - クイズは単語生成時にバックグラウンド生成→Provider共有・履歴保存。保存済みエピソードは entry.quiz を再利用
  - 復習はダッシュボード「今日の復習」と単語リスト「今日の復習N単語」の両方から起動（横断復習は historyId=null）
  - 復習完了で reviewVersion を bump → ダッシュボード集計・単語リストSRSバッジを自動更新
  - 移植先: components/{QuizScreen,ReviewModal}.js, AppProvider.js（quizData/currentHistoryId/reviewWords/reviewVersion共有）, lib/storage.js（reviewWord/recordReviewSession/updateHistoryScore等）
  - 検証済み: SUITS S1E1でテスト5問→40%保存、復習20単語→セッション1件記録（StrictMode二重記録なし）→ダッシュボード20→7単語に自動更新
- [x] Step 5: 設定モーダル（英語レベル/利用サービス/単語階層/復習リマインダー）★完全移植
  - TOEICスコア→レベル判定・目標スコア→生成単語数、サービス選択、tierトグル、通知許可
  - components/SettingsModal.js（ヘッダー⚙️から開く・AppProviderのsettingsOpenで管理）
- [x] Step 6: プロフィール選択（screen-0「だれが観ますか？」）★完全移植
  - 起動時にプロフィール選択画面から開始（自動選択を廃止）。カード選択→メイン、削除、＋追加（新規は設定モーダルへ）
  - ヘッダーのプロフィールチップ→選択画面に戻る。未設定プロフィールは選択時に設定モーダルが開く（オンボーディング代替）
  - components/ProfileSelect.js, AppProvider.js（selectProfile/addProfile/deleteProfile/switchProfile）
- [x] Step 7: マイ単語帳（wordbookModal）★完全移植
  - 保存単語の一覧（単語/発音/例文/作品・話数・保存日/品詞/定義）・件数・1件削除・すべて削除・空状態
  - components/WordbookModal.js, lib/words.js（deleteMyWord/clearAllWords追加）, AppProvider（wordbookOpen/wordbookVersion）
  - 削除でヘッダーの件数バッジも自動更新（wordbookVersion）

- [x] Step 8: Supabase読み取り専用連携（lib/supabase.js, components/AuthModal.js）
  - ログイン/新規登録・オートログイン（refresh_token）・pullFromCloud（クラウド→localStorage取込のみ・書き込みなし）
- [x] Step 9: 残ギャップの移植（元アプリとの突き合わせで検出）
  - オンボーディング画面（screen-onboarding）：新規プロフィール→TOEIC→サービス選択→ドラマ検索タブへ（components/Onboarding.js）
  - 起動時認証フロー：未ログインならAuthModal表示（スキップ可）＋10分ごとのセッション自動更新
  - fetchRawSrtIfMissing：保存済みリストの📍タイムスタンプを生SRT取得で補完
  - fillMissingExampleJa：example_ja欠落単語をバックグラウンドでClaude翻訳→履歴更新→再描画
  - translateExtWordDefinitions：拡張機能単語の英語定義を日本語化してストア保存
  - 復習ボタンの「（今日N回済み）」/「✅ 今日の復習完了（N回）」ラベル
  - ※学習履歴モーダル（historyModal）は元アプリでも呼び出し元が無い死にコードのため移植対象外

- [x] Step 10: 元アプリ追従＋学習履歴引き継ぎ修正
  - style.css 再同期（.media-type-* → ドラマ/映画選択UIにスタイル適用、.gen-* 追加）
  - 単語生成ローディングに「あらすじ＋学習Tips」（components/GenLoading.js・action: episode_overview）
  - SRSをマウント時にロード（クラウドpull済みの覚えた/マスターが保存済みリストの初回表示から反映）
  - Dashboard：pull完了（cloudVersion）で統計再集計、ポスターはoverride方式でカードヘッダー画像が消えない
  - 注: 単語ごとの「N回復習済み」とストリークはクラウド非同期（srs_dataにreview_count列が無い）。本番アプリと同じ仕様

## 🎉 全画面の移植完了（プロフィール選択/オンボーディング/ダッシュボード/サービス選択/単語リスト/テスト/復習/ドラマ追加/設定/単語帳/ログイン）
