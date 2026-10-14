# 決定: 例文和訳の共有キャッシュ配信は現状維持（2026-10-14・/decide 討論）

## 決めたこと
- **例文（字幕の1文）の日本語訳を共有キャッシュで全利用者に配る現状は、法的理由で変えない。**
- 検討されていた制限（本人のみ／1話10文／都度生成・非共有）は**いずれも採用しない**。本人のみ・都度生成は法的効果がゼロで、1話10文は英文例文を全件表示する確定方針の下では増分効果がほぼゼロ。
- 無料・有料の差を和訳の回数枠で付ける案も**不採用**（法的根拠がなく、UX を削るだけ）。
- 「タップして訳す」への画面変更も**不要**。

オーナー確認待ち。Claude は弁護士ではない。有料化（商用化）の前に弁護士へ単発確認する方針は従来どおり。

## 発端と、前提の訂正
別チャットの法務調査で「字幕の**全文**和訳を共有キャッシュから配っている部分が最もリスクが高い」とされた。これは外部調査（コード未読）の印象で、**事実と異なる**。

本番コードと本番 DB で確定した事実（2026-10-14 実測）:
| 項目 | 事実 |
|---|---|
| 共有される英文 | 単語1語につき字幕の1文（OpenSubtitles 由来）。`vocab_cache`（anon 読み取り可） |
| 1話あたりの文数 | 75〜88文・1文平均36〜56字（英語8〜10語）。1話の字幕は通常600〜900キュー＝**約1割**。全文ではない |
| 本番キャッシュ量 | 104話 |
| 共有される和訳 | 上の例文を Claude Haiku で訳したもの。`translation_ctx_cache`（word=`__sentence__`・英文ハッシュ鍵・訳≤200字）と `vocab_cache.example_ja` |
| 表示 | 英文は “ ” 囲い、直下に訳、同じブロック内に `📺作品SxE（字幕：OpenSubtitles）`（`next-app/components/VocabItem.js:121-140`） |
| 並び | 単語リスト順。台本順ではない |
| 配信画面の字幕行 | サーバーに蓄積しない（wordsense は sentence_sample=null）。全文 SRT は非配信（30条の4） |
| 和訳プロンプト | 「次の英語のセリフを自然な日本語に訳してください。訳文だけを出力し、説明・引用符・原文は付けない」（`next-app/app/api/claude/route.js:417,570`） |

## 法的評価（法務2系統＝最大限保守／悪魔の代弁者が独立調査→相互反論で一致）

### 条文（e-Gov 原文で確認）
- **47条の6第1項2号**: 「第三十二条」等の規定により利用できる場合、「当該規定の例により」**翻訳**して利用できる。
- よって**英文例文の引用（32条）が適法なら、その和訳を付けることも同じ条件で適法**。訳は英文と一緒に立ち、一緒に倒れる。訳に固有の新しい争点はほとんどない。
- 48条（出所明示）は訳にも及ぶ → 現行 UI は訳を出所行と同じブロックに置いており充足。
- 翻案化の懸念（意訳が「翻訳」でなく「翻案」になり2号の射程外になる）: 江差追分事件最判（平13.6.28）の翻案の定義＝「表現上の本質的な特徴を維持しつつ新たに創作的に表現」。8〜10語の1文を自然な日本語に置き換える行為に新たな創作が加わる余地はほぼなく、意訳も翻訳に含めるのが通説。保守側も R2 で「逐語訳に固定」案を撤回。

### 全体リスクと増分リスク
- **全体**: 英文例文の引用が立つかどうかに従属（＝2026-06 に確定済みの論点）。保守側「黄（緑寄り）」、攻め側「低」。
- **訳による増分**: 小〜低。唯一の実体は「カード上で台詞側（従）の視覚比重が増える」こと。ただし単語・意味・品詞・tier が主で、訳は “ ” の英文と出所の間に置かれた補助表示なので、主従逆転とは評価しにくい。

### 実事例・エンフォース実績（確認できたもの）
- **日本の摘発は「全容型」のみ**: 仙台地裁 2026-08-03（CODA 一次資料）＝映画のストーリー全容を文字起こしし画像と広告で収益化したサイト。経営者懲役2年執行猶予3年＋罰金100万円、法人罰金100万円。東京地裁 2026-04-16 も同種。CODA の位置づけは「適法な引用の範囲を超える」。1話の1割を単語リスト順に飛び飛びで示す CineLearn とは量も態様も異なる（観なくても内容が分かる状態にならない）。
- **字幕翻訳そのものの摘発**: 日本では 2016 年京都府警（映画「ポルターガイスト」の日本語字幕を作成し字幕 DB サイトへアップロード。翻訳権27条・送信可能化権23条）。**字幕ファイル丸ごと**の無許諾公開であり、1文引用とは別物。海外も同型（Undertexter.se 2013・ondertitels.nl・BREIN 対 SLOV 2017・豪ブロッキング 2018）＝措置対象はすべて**字幕ファイル配布サイト**。
- **学習ツール・対訳 DB への措置**: Language Reactor（Netflix 字幕の**全文**機械翻訳を Pro で提供）、Reverso Context（「movie subtitles」由来の対訳例文を公衆表示し有料プラン販売。ページ上に "Subtitles downloaded from www.opensubtitles.org" という字幕由来文が出ることを確認）、Migaku・Trancy・Fleex・Playphrase・YARN・AnkiWeb の字幕由来デッキ──いずれも**訴訟・テイクダウン・ストア削除の公表事例なし**。「無い」の証明ではないが、CineLearn より量が桁違いに多い先行者が長年無事という事実。
- 注意: LR は視聴中の画面に重ねる方式、CineLearn は視聴と切り離した DB から配る方式で、行為の形は違う。比較対象として近いのは Reverso（公開の対訳 DB）。

### 制限3案の法的効果
| 案 | 効果 | 理由 |
|---|---|---|
| 本人のみに出す | **ゼロ** | 求めに応じて誰にでも送る構造は自動公衆送信のまま（まねきTV最判 平23.1.18 の主体論）。変わるのは露出量だけ |
| 都度生成・非共有 | **ゼロ** | 内容・量・届く範囲が同じ。主体はサービスなので 30条（私的複製）も使えない（ロクラクII最判）。API 送信回数が利用者数倍に増えるだけ |
| 1話10文 | ほぼゼロ | 32条の「正当な範囲」と主従は**表示する英文の量**で決まる。英文が全件のまま訳だけ絞っても原作の利用量は不変 |

## 残すもの（制限ではなく保険・公開前チェックリストに追記）
1. **削除窓口の対象に訳を含める**（PP/ToS の文言確認）。
2. **vocab_cache の anon 直読み REVOKE**（セキュリティ監査 2026-10-13 Medium・「法務判断後」保留だったもの）: 公開 anon キーで REST 直読みすると 104 話分の例文＋訳＋tsSec を一括取得→時刻順に並べ直して対訳コーパス化できる。これは英文共有の時点から存在する穴で訳固有ではないが、「必要最小限・非集約」の立て付けを弱める唯一の構造的要素。**法務判断＝REVOKE を実施してよい（推奨）**。順序厳守: ①`lib/server/vocabCache.js` の読みを service へ→デプロイ ②REVOKE＋ポリシー削除。UX への影響なし。
3. （任意・費用ゼロ）和訳プロンプトに「原文の意味を足さず省かず」を加える。翻案化の攻め筋を予防。
4. （任意）訳の末尾に「訳（AI）」等の小さな表示。公式字幕との誤認防止・人格権論点（未確認）の予防。法的必須ではない。
5. 有料化の前に弁護士へ単発確認（従来方針）。

## 未確認（推測で埋めない）
- OpenSubtitles の現行 EULA/ToS 原文（403 で取得不可。過去確認＝商用不可・権利は付与しない、のみ）。
- まねきTV・ロクラクII・江差追分の判決原文は二次資料で確認。
- 非公開の警告書（C&D）の有無は確認不能。
- 誤訳と同一性保持権（50条）の関係は学説未確認。

## 出典
- 著作権法 e-Gov API: https://laws.e-gov.go.jp/api/2/law_data/345AC0000000048 （47条の6第1項2号・32条・48条）
- CODA 2026-08-03 仙台地裁: https://cms.coda-cj.jp/wp-content/uploads/2026/08/coda_newsrelease_20260803_2cjjp.pdf ／ https://internet.watch.impress.co.jp/docs/news/2102341.html （東京地裁 2026-04-16）
- 2016 京都府警 字幕作成逮捕: https://internet.watch.impress.co.jp/docs/news/1008885.html
- BREIN 対 SLOV 2017: https://torrentfreak.com/unauthorized-subtitles-for-movies-tv-shows-are-illegal-court-rules-170421/
- Language Reactor 機械翻訳 Pro/枠: https://forum.languagelearningwithnetflix.com/t/question-about-premium-feature-machine-translations/8606 ／ https://languagereactor.com/help/faq
- Reverso Context 字幕由来: https://en.wikipedia.org/wiki/Reverso_(language_tools) ／ https://context.reverso.net/translation/english-spanish/opensubtitles ／ https://apps.apple.com/us/app/-/id919979642
- OpenSubtitles コーパス（OPUS・Lison & Tiedemann 2016）: https://preview.aclanthology.org/menus/L16-1147/
- AnkiWeb 権利者通知制度: https://docs.ankiweb.net/faqs/a-deck-i-want-has-disappeared-from-ankiweb.md
- 江差追分事件: https://www.courts.go.jp/app/files/hanrei_jp/612/069612_hanrei.pdf
- 字幕配布サイトへの措置（豪・瑞）: https://www2.computerworld.com.au/article/print/651054/unauthorised-subtitle-services-blocked-court-grants-largest-anti-piracy-injunction/ ／ https://www.dww.com/articles/swedish-police-shut-down-fanmade-subtitle-site

## 討論の記録
- 参加: legal×2（最大限保守／悪魔の代弁者・独立インスタンス）、marketing（他社実務の事実調査）。R1 独立→R2 相互反論。
- R2 での更新: 保守側が「逐語訳固定」案を撤回し最終回答「変える必要なし」。攻め側が「訳を引用ブロック内へ」案を撤回（既に実装済みと判明）し最終回答「変える必要なし」。
- 司会の裏取り: 47条の6 条文（e-Gov 原文）、本番 DB の文数・字数（anon REST 実測）、VocabItem の表示構造、和訳プロンプト本文。
- 関連: docs/decision-pricing-2026-10-08.md（英文例文は無料・全件）、docs/security-audit-2026-10-13.md（vocab_cache anon 直読み）、docs/design-context-translation.md。
