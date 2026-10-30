# 語ごとの固定難易度（頻度表／CEFR表）の導入検討 — 2026-10-29

部門②作品・予習。受付からの転送（オーナー 2026-10-29「回す」・**検討のみ、実装はオーナー判断後**）。

## 採否（2026-10-30）

オーナーは**選択肢1を採用**（CEFR-J 1.6＋Octanove C1/C2 を入れ、レベル判定①だけに使う。生成・帯フィルタ・キャッシュは触らない）。ただし §5 の法務確認 (1)〜(3) を先に回しており、**法務OKが出るまで実装には着手しない**（OK が出たら受付から条件つきで再連絡）。

## 実装（2026-10-30・法務「条件付きOK」・オーナー条件3-①）

- 表: `next-app/lib/data/cefrj-wordlist-1.6.json`（7,035 見出し語・A1 1,088／A2 1,272／B1 2,178／B2 2,497）と `next-app/lib/data/octanove-c1c2-1.0.json`（1,955 見出し語・C1 1,009／C2 946）。出典ごとに別ファイル、先頭に `_source`・`_license`・`_modified`・`_retrieved`（**取得日 2026-10-30**）。両方にある 163 語は易しい方（CEFR-J）を採る。
- 変換: `next-app/scripts/build-word-levels.py`（原本 xlsx/csv を渡して再生成。原本そのものは repo に置かない）。CEFR-J は ALL_sep シート。
- lookup: `next-app/lib/wordLevelLookup.js`（表を持たない純関数・記号つき見出し語→記号を落とした形→原形候補の順）、表の読み込みは `next-app/lib/server/wordLevel.js`（`server-only`＝クライアントから import するとビルドエラー・法務 条件4）。
- レベル判定: `next-app/lib/levelEstimate.js` の `firstQualityByLevel`（段階ごとに 知ってた/うろ覚え/知らなかった を数える）と `estimateBoundary`（知ってた率が 50% を切る最初の段階・段階あたり最低10語）。
- テスト: `next-app/scripts/wordLevel.test.mjs`（15件・表の形式、全見出し語がそのまま引けること、表を import するのはサーバ専用ファイルだけ、の見張りを含む）。
- 確認: 本番ビルドで一時ルートから読み込ませ、サーバで lookup が動き、クライアント向け JS に表が入らないことを確認（一時ルートは削除）。
- **未接続**: どの画面・API からもまだ使っていない（生成・vocab_cache・personalizeWords は触らない）。本番デプロイはレベル提案の出し方（UI か API）が決まって接続する時に行う。

## レベル提案の出し方（2026-10-30 オーナー判断＝保留）

データ（firstQuality・段階あたり10語）が溜まるまで画面・API には接続しない。**再開目安は2026年11月末**。まずオーナー本人のデータで境目が当たるかを確かめ、当たれば案1（設定画面に一言だけ出す）。a866fc2 はそのまま置いておく。

## 0. 結論（先に）

- **本命 = CEFR-J Wordlist 1.6（A1〜B2・7,801項目）＋ Octanove Vocabulary Profile C1/C2 1.0（2,136項目）**。合わせて約9,900項目で A1〜C2 が揃い、どちらも**商用無償**（CEFR-J は「適切な引用」、Octanove は CC BY-SA 4.0）。日本人学習者向けに作られた段階表なので、TOEIC↔CEFR の既存マップ（lib/vocab.js `toeicToCefr`）とそのまま噛み合う。
- **補助候補 = wordfreq（英語は OpenSubtitles 2018＋SUBTLEX＋Wikipedia 等の合成・Zipf 1〜8）**。表に無い語の「粗い難易度」を頻度から推定する用途。データは CC BY-SA 4.0・商用可。SUBTLEX-US を直接使う必要はない（ライセンス未明記で著者確認が要る）。
- **不採用**: EFLLex・KELLY（CC BY-NC-SA＝フェーズ2の収益化と抵触）、English Vocabulary Profile（非商用限定・商用は Cambridge と契約）、Oxford 3000/5000（OUP 著作物・再配布条件を確認できず）。
- **進め方の推奨**: まず **レベル判定（firstQuality×段階）だけ**に表を使う（生成・帯フィルタ・キャッシュは触らない＝影響ゼロ）。帯フィルタの置き換えは判定の分布を見てから第2段で。

## 1. 候補の比較

| # | 表 | 中身 | 語数 | 段階の粒度 | ライセンス | 商用 | 再配布（アプリ同梱） | 表示義務 | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **CEFR-J Wordlist 1.6**（東京外大 投野研） | 見出し語＋品詞＋CEFR | 7,801項目 / 見出し語6,868（A1 1,166・A2 1,411・B1 2,445・B2 2,779） | A1〜B2 の4段 | 独自（公式: 「適切な引用を行っていただければ研究教育および商用においても無償で利用できる」「改変して別の語彙表を作ることはかまわないが、必ず本語彙表を適切に引用」） | ◎ | 明記なし（改変可の条文で読めるが**法務確認**） | 引用（名称・URL・取得日） | **採用候補** |
| 2 | **Octanove Vocabulary Profile C1/C2 1.0**（Octanove Labs・CEFR-J 準拠） | 見出し語＋品詞＋CEFR | 2,136項目（C1 1,111・C2 1,025） | C1/C2 の2段 | CC BY-SA 4.0 | ◎ | ◎（表示＋同一ライセンス継承） | クレジット＋ライセンス表記 | **採用候補**（1の C1/C2 補完） |
| 3 | NGSL 1.2（＋NAWL／NGSL-Spoken） | 頻度順位 | 約2,800語 | 段階なし（順位のみ） | CC BY-SA 4.0 | ◎ | ◎ | クレジット | 既存の除外語3段の元。基礎語しか無く上位帯の判定に使えない→現状維持 |
| 4 | SUBTLEX-US（Brysbaert & New 2009） | 米映画字幕5,100万語の頻度・Zipf・CD | 74,286語 | 段階なし（Zipf 1〜7） | **非明記**（公式ページにライセンス記載なし。wordfreq 作者が Brysbaert からメールで「any purpose」許諾を得たと記載） | △（著者へ書面確認が要る） | △ | 著者クレジット＋「自由入手データ」明示 | 直接利用は保留。字幕由来でドラマとの相性は最良だが、5経由で同等の恩恵 |
| 5 | **wordfreq**（R. Speer） | 多ソース合成の Zipf 頻度（英語: OpenSubtitles 2018・SUBTLEX・Wikipedia・News・Books・Web・Twitter・Reddit） | 英語 数万語（Zipf≥3 で約3〜4万） | 段階なし（Zipf 1〜8・連続値） | コード Apache / データ CC BY-SA 4.0 | ◎ | ◎（ただし作者注: CSV 化だけは帰属が付かないので不可→帰属・ライセンスを同梱する形式で） | OpenSubtitles・Google Books Ngram・SUBTLEX のクレジット | **補助候補**。2021年で凍結（SUNSET）だが用途に支障なし |
| 6 | EFLLex（UCLouvain CEFRLex） | 教科書出現頻度の CEFR 分布 | 15,280 lemma | A1〜C1 | **CC BY-NC-SA 4.0** | ✕ | — | — | 不採用（非商用） |
| 7 | KELLY English | 頻度＋CEFR | 約9,000 | A1〜C2 | CC BY-NC-SA 2.0（UiO 記載） | ✕ | — | — | 不採用（非商用） |
| 8 | Oxford 3000/5000 | CEFR 付き核語彙 | 5,000 | A1〜C1 | OUP 著作物（公式ページは 403 で条件を読めず） | ✕寄り | ✕ | — | 不採用（権利強・再配布不可の見込み） |
| 9 | English Vocabulary Profile（Cambridge） | 語義単位の CEFR（最高品質） | 約15,000語義 | A1〜C2 | 非商用のみ無償・商用は Cambridge と契約 | ✕（契約すれば可） | ✕ | — | 不採用（受付の注意どおり） |
| 10 | Nation BNC/COCA 25k | word family の1,000語帯 | 25帯 | 1,000語刻み | 利用条件を確認できず（PDF の本文が読めない） | ? | ? | 引用 | 保留（使う必要がない） |

出典（主要）: CEFR-J 公式ダウンロード https://www.cefr-j.org/download.html ／ olp-en-cefrj（CEFR-J 1.5＋Octanove 同梱・利用条件記載）https://github.com/openlanguageprofiles/olp-en-cefrj ／ NGSL https://www.newgeneralservicelist.com/new-general-service-list ／ SUBTLEX-US https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus ／ wordfreq https://github.com/rspeer/wordfreq ／ EFLLex https://cental.uclouvain.be/cefrlex/efllex/download/ ／ KELLY https://hf.uio.no/iln/english/about/organization/text-laboratory/services/kelly.html ／ Nation https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-lists

注: olp-en-cefrj の同梱は CEFR-J **1.5**。公式 1.6（2020-03-24）は cefr-j.org から直接取得する。実測サイズ: CEFR-J 1.5 CSV 228KB・Octanove CSV 48KB。

## 2. 入れ方

1. **置き場所 = サーバ側 lib に同梱（DB 表は不要）**。約9,900行の `{word: {level, pos}}` JSON で約150KB・gzip 50KB 程度。更新頻度ゼロなので DB に持つ理由がない。クライアントへは今まで通り語ごとの `level` 値だけが届く（既存フィールド・互換性問題なし）。wordfreq を足す場合も英語 Zipf≥3 で 300〜500KB、サーバ同梱のみ（クライアントに配らない）。
2. **lemma（原形）のひも付け**: CEFR-J／Octanove は見出し語＝原形＋品詞。語リストの `word` は原形が大半だが活用形も混ざるので、生成パイプライン（`/api/vocab-generate`）に軽量 lemmatizer を1段挟む（規則ベース -s/-es/-ies/-ed/-ing/-er/-est ＋ 不規則表、または npm の小さな lemmatizer）。品詞で段階が違う語（run 動詞 A1／名詞 B1 等）は**易しい方**を採る（学習者に厳しくしない方向）。本格的な lemma 基盤（growth-features-strategy の本命3機能の1つ）とは別に、ここでは lookup 用の最小実装で足りる。
3. **表に無い語**: 句動詞・イディオム・固有表現・ドラマ口語（gonna, buddy, freak out…）は CEFR-J にほぼ無い。→ **現状どおり AI の level をフォールバック**。wordfreq を入れる場合は Zipf→CEFR の粗い換算（例: ≥5.0→A2以下・4.0〜5.0→B1・3.5〜4.0→B2・3.0〜3.5→C1・<3.0→C2。要校正）を「AI 判定より低優先の参考値」として持つ。
4. **保存**: `vocab_cache` の `level` を表由来で上書き（新規生成分）。出所を区別する列 `level_src`（'table' | 'ai' | 'freq'）を足すと後で検証・巻き戻しができる。既存キャッシュは**一括埋め戻しスクリプト**（語→表 lookup のみ・AI 不要・無償）。

## 3. 使い道

### ① レベル判定（firstQuality × 段階）
- SRS エントリは `level` を持たない（lib/storage.js `reviewWord` 実測）。今は語の段階を知るには作品ごとの語リストを引くしかなく、同じ語が作品で B2/C1 とぶれる＝境目が霞む。**固定表なら語→段階が一意**になり、段階ごとの「知ってた率」が安定する。
- 集計: `firstLearnStats` を段階別に拡張（recorded/known を A1〜C2 で分ける）。「知ってた率が50%を切る最初の段階」＝境目 → 設定画面の**レベル提案**（点数は見せない・罪悪感 UI 禁止の憲法どおり）。
- firstQuality は 2026-10-29 以降の新規語にしか付かないので、提案を出すには最低語数のしきい値（例: 段階あたり10語以上）が必要。データが溜まるまで数週間。

### ② personalizeWords の帯フィルタの置き換え
- 今: `w.level`（AI 判定）で帯の内外を判定。複数語・context tier は免除。
- 案: `level_src==='table'` の語は表の段階、無い語は AI 判定（現状）。免除ロジックは維持。
- **既存キャッシュへの影響**: 埋め戻しで level が変わる語が出る → ユーザーに見える語リストの中身（出る／出ない）が変わる。特に B2↔C1 の境目の語。埋め戻し前後の件数差を数作品で実測してから本番反映。CEFR-J は教育語彙寄りで「ドラマ語」を低く見積もる懸念は無い（無い語は AI に戻るだけ）。

## 4. 工数（ざっくり）

| 作業 | 目安 |
|---|---|
| 表の取り込み・JSON 化・lookup・最小 lemmatizer | 0.5日 |
| 生成パイプラインで level 付与＋`level_src` 列 | 0.5日 |
| 既存 vocab_cache の埋め戻しスクリプト＋差分実測 | 0.5日 |
| レベル判定の段階別集計＋設定画面の提案表示 | 1日 |
| 検証（本番の語リスト数作品・提案の見え方） | 0.5日 |
| **合計** | **2.5〜3日**（①だけ先行なら 1.5日） |

## 5. 法務部に確認が要る点

1. **CEFR-J 1.6**: 「適切な引用」の表示場所（アプリ内クレジット／規約ページで足りるか）と、表を**アプリ（サーバ）に同梱する＝再配布**に当たるか。公式条文は「改変して別の語彙表を作ることはかまわない（引用必須）」で、再配布そのものは明記なし。
2. **Octanove（CC BY-SA 4.0）**: ShareAlike の及ぶ範囲。表データを別ファイルで同梱し、そのファイルにだけ同一ライセンス表記を付ける切り分けで足りるか（アプリ本体のコードには及ばない読みが通例だが確認）。
3. **wordfreq（CC BY-SA 4.0）**を入れる場合: 作者注記「CSV 化は帰属が伴わないので不可」への対応＝JSON に license/attribution フィールドを同梱し、OpenSubtitles・Google Books Ngram・SUBTLEX のクレジットをアプリ内に出す形で問題ないか。
4. **SUBTLEX-US を直接使う場合のみ**: 公式に利用条件が無いので著者（Brysbaert）へ書面確認。本命案では不要。
5. Nation BNC/COCA は使わない前提なら確認不要。

## 6. 選択肢（オーナー判断用）

1. **CEFR-J 1.6＋Octanove C1/C2 を入れ、まずレベル判定①だけに使う**（推奨・生成とキャッシュは触らない・1.5日）
2. 1 に加えて帯フィルタ②も表優先に置き換える（埋め戻し＋差分実測込みで 2.5〜3日）
3. 2 に wordfreq Zipf を足し、表に無い語の粗推定まで持つ（＋0.5日・法務確認が1件増える）
4. 現状維持（AI の level のみ）。レベル判定は作品ごとの level を使ってぶれを許容する
