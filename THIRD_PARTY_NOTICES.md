# Third-Party Notices（第三者データの出典とライセンス）

CineLearn は、単語の難易度判定と基礎語の除外のために、以下の第三者データを利用しています。
アプリ内では、利用規約の「10. 第三者データ」（`/terms#third-party`）と support ページ（`/support`）からこの内容を案内しています。

- 最終確認日（出典ページの取得日）: 2026-10-30
- 取得の記録: 下記の「原文の写し」は、2026-10-30 に各出典ページから取得した文をそのまま写したものです。
- 文言の指定: 法務部（2026-10-30・語彙難易度表の同梱を「条件付きOK」とした条件1）

---

## 1. CEFR-J Wordlist Version 1.6

| 項目 | 内容 |
|---|---|
| 権利者 | 東京外国語大学 投野由紀夫研究室（Tono Laboratory at TUFS） |
| 版 | Version 1.6（2020.3.24 更新版） |
| 入手元 | https://www.cefr-j.org/download.html（zip: https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip） |
| 取得日 | 2026年10月30日 |
| ライセンス | 独自の利用条件（適切な引用を条件に、研究教育・商用とも無償） |
| 変更 | 本サービス向けに改変しています（形式の変換、表記と品詞名の正規化と明らかな誤記の修正、同じ語と品詞に複数の段階がある場合は易しい方への統合）。原本の内容そのものではありません。 |
| 本サービスでの用途 | A1〜B2 の語の難易度判定、単語リストの絞り込み、単語リストと単語帳での難易度の目安の表示 |

**変更の詳細**（`next-app/lib/data/cefrj-wordlist-1.6.json` の `_modified` の写し）

> JSON 化（見出し語→品詞ごとの CEFR 段階の対応を抽出・CoreInventory/notes などの列は削除）・見出し語の正規化（Unicode NFKC・前後空白の除去・連続空白の圧縮・小文字化）・品詞名の正規化（小文字化・明らかな誤記 vern→verb を修正・空欄は unknown）・同じ見出し語と品詞で複数段階がある場合は易しい方の段階を採用（原本 ALL_sep シート 7988 行 → 7035 見出し語）

**本サービスでの表示（法務指定）**

> 『CEFR-J Wordlist Version 1.6』東京外国語大学投野由紀夫研究室.（URL: https://www.cefr-j.org/download.html より 2026年10月30日ダウンロード）本サービスでは、上記の語彙表を Octanove と同様の方法で改変して利用しています（原本の内容そのものではありません）。

**利用条件の原文の写し**（出典: https://www.cefr-j.org/download.html ・2026-10-30 取得）

> なお、本語彙表の著作権は東京外国語大学投野研究室に帰属するが、適切な引用を行っていただければ研究教育および商用においても無償で利用できる。

> 『CEFR-J Wordlist Version 1.6』 東京外国語大学投野由紀夫研究室. （URL: XXX より◎年◎月ダウンロード）

免責事項（原文の写し）:

> 1) 本語彙表は無償で公開する物であり、本語彙表の使用により生じた一切の損害・不利益・批判などに対して、科研チームおよび投野研究室は一切の責任を負わない。
> 2) 商用利用に関しては、監修などを行う場合には別途相談の上、必要な経費を請求する。
> 3) 語彙表は不完全な部分があり、内容的に誤りがある可能性は否定できないので、随時改訂版を作成するものを利用されたい。
> 4) 本語彙表を改変して別の語彙表を作ることはかまわないが、必ず本語彙表を適切に引用しなければならない。

英語版（同ページ）:

> The copyright of this wordlist belongs to Tono Laboratory at TUFS, but the list can be used for both research and commercial purposes with a proper acknowledgement of the source.

---

## 2. Octanove Vocabulary Profile C1/C2 (ver 1.0)

| 項目 | 内容 |
|---|---|
| 権利者 | Octanove Labs（http://www.octanove.com/） |
| 版 | ver 1.0（`octanove-vocabulary-profile-c1c2-1.0.csv`） |
| 入手元 | https://github.com/openlanguageprofiles/olp-en-cefrj（master ブランチの `octanove-vocabulary-profile-c1c2-1.0.csv`） |
| 取得日 | 2026年10月30日 |
| ライセンス | Creative Commons Attribution-ShareAlike 4.0 International（CC BY-SA 4.0）<br>https://creativecommons.org/licenses/by-sa/4.0/ |
| 変更 | 本サービス向けに改変しています（形式の変換、表記と品詞名の正規化と明らかな誤記の修正、同じ語と品詞に複数の段階がある場合は易しい方への統合）。 |
| 本サービスでの用途 | C1/C2 の語の難易度判定、単語リストの絞り込み、単語リストと単語帳での難易度の目安の表示 |

**変更の詳細**（`next-app/lib/data/octanove-c1c2-1.0.json` の `_modified` の写し）

> JSON 化（見出し語→品詞ごとの CEFR 段階の対応を抽出・CoreInventory/notes などの列は削除）・見出し語の正規化（Unicode NFKC・前後空白の除去・連続空白の圧縮・小文字化）・品詞名の正規化（小文字化・明らかな誤記 vern→verb を修正・空欄は unknown）・同じ見出し語と品詞で複数段階がある場合は易しい方の段階を採用（原本 2136 行 → 1955 見出し語）

**本サービスでの表示（法務指定）**

> Octanove Vocabulary Profile C1/C2 (ver 1.0), created by Octanove Labs (http://www.octanove.com/), licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Source: https://github.com/openlanguageprofiles/olp-en-cefrj. 本サービス向けに改変しています（形式の変換、表記と品詞名の正規化と明らかな誤記の修正、同じ語と品詞に複数の段階がある場合は易しい方への統合）。変更の詳細は THIRD_PARTY_NOTICES.md をご覧ください。

**ライセンスの根拠の写し**

入手元リポジトリに LICENSE ファイルはありません（2026-10-30 時点のルートのファイルは README.md と CSV 3件のみ）。
ライセンスの根拠は README の次の文です（出典: https://github.com/openlanguageprofiles/olp-en-cefrj の README.md「Terms of use」・2026-10-30 取得）。

> The Octanove Vocabulary Profile for C1/C2 levels can be used under a [Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).

> [Octanove Vocabulary Profile C1/C2 (ver 1.0)](https://github.com/openlanguageprofiles/olp-en-cefrj/blob/master/octanove-vocabulary-profile-c1c2-1.0.csv) — vocabulary list annotated with CEFR-J levels (for C1/C2 levels), created by [Octanove Labs](http://www.octanove.com/)

免責事項（README の原文の写し・2026-10-30 取得）:

> Neither CEFR-J nor Open Language Profiles is responsible or liable for any inaccuracies in the dataset or any damage resulting from using the dataset.

ShareAlike について: 本サービスが同梱する変換後の表データ（Octanove 由来部分）は、元データと同じ CC BY-SA 4.0 の下で提供します。単語リストと単語帳に表示する段階のうち Octanove 由来のもの（利用者の学習履歴に保存されたものを含む）も、CC BY-SA 4.0 の下にあります。

---

## 3. New General Service List (NGSL)

| 項目 | 内容 |
|---|---|
| 権利者 | Charles Browne, Brent Culligan, Joseph Phillips |
| 入手元 | https://www.newgeneralservicelist.com/ |
| 取得日 | 2026-06（`next-app/lib/wordlist.js` の初回コミット 2026-06-13） |
| ライセンス | Creative Commons Attribution-ShareAlike 4.0 International（CC BY-SA 4.0）<br>https://creativecommons.org/licenses/by-sa/4.0/ |
| 変更 | 頻度データを TOEIC スコア帯の3段（tier0 / tier400 / tier600）に対応させた抜粋に再構成しています。 |
| 本サービスでの用途 | 単語生成時の基礎語の除外（`next-app/lib/wordlist.js`） |

**本サービスでの表示（法務指定）**

> New General Service List (NGSL) by Browne, Culligan & Phillips, CC BY-SA 4.0, https://www.newgeneralservicelist.com/

**ライセンス表記の原文の写し**（出典: https://www.newgeneralservicelist.com/new-general-service-list 「CREATIVE COMMONS LICENSE」・2026-10-30 取得）

> New General Service List by Browne, C., Culligan, B., and Phillips, J. is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License.

ShareAlike について: `next-app/lib/wordlist.js` の語リスト部分（NGSL 由来）は、元データと同じ CC BY-SA 4.0 の下で提供します。

---

## CC BY-SA 4.0 の全文

Creative Commons Attribution-ShareAlike 4.0 International Public License の全文は次の URL にあります。

- https://creativecommons.org/licenses/by-sa/4.0/legalcode
