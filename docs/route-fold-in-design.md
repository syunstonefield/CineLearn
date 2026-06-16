# 経路②→①畳み込み 設計書（単語のみ保存＋例文はOpenSubtitlesから補完）

フェーズ0 関門 **#3**。拡張のクリック保存を「Netflix/Amazon の画面字幕行を保存」から
「**単語のみ保存＋例文は OpenSubtitles から補完**」へ変える。目的は保存データから
Netflix/Amazon 軸（prong-B＝配信字幕のサーバー保存）を消し、保存物を全部
OpenSubtitles／引用（著作権法32条）の世界に収束させること。

関連: `release-roadmap` #3 / `public-launch-legal-posture`（2026-06-14 採用決定）/
`shared-cache-design`（#2 キャッシュ。本機能の前提）。

---

## 1. 現状（prong-B の実体）

`extension/content.js` のクリック保存フロー:

1. 単語クリック → `showWordPopup(word, sentence, rect)`。
   `sentence = wordEl.dataset.sentence` ＝ **その時画面に出ている Netflix/Amazon の字幕行**（DOM）。
2. 「✓ 保存」→ `entry = { word, sentence:<配信字幕行>, phonetic, pos, definition, savedAt, source, dramaTitle, season, episode }`
3. `saveWord(entry)` → `chrome.storage.local`
4. `SAVE_WORD_TO_CLOUD` → `background.js:syncWordToSupabase` → Supabase **`my_words`**（`sentence`列＝配信字幕行）

→ **配信字幕の生テキストがローカルとクラウド両方に永続化されている**＝これが prong-B。

利用可能な手掛かり: `getEpisodeContext()` は `{ dramaTitle, season, episode }` を返す。
**TMDB ID は持っていない**（タイトル文字列のみ）。#2 キャッシュは TMDB ID キーなので解決が要る。

---

## 2. 設計判断: サーバー側ルックアップ方式（採用）

例文（OS の1文）を「どこでマッチさせるか」が中心論点。

| | 案A: サーバー側ルックアップ（採用） | 案B: 拡張側マッチ |
|---|---|---|
| マッチ処理 | 新エンドポイント `/api/example` が TMDB解決→キャッシュ/OS→1文特定 | 拡張が生SRTを取得し content.js 内で再実装 |
| 生SRTの所在 | **サーバー側のみ**（クライアントへは特定した1文だけ返す） | **クライアントが生SRT全文を保持**（字幕DB化に近い＝立て付け最悪） |
| ロジック再利用 | next-app/lib の `getWordVariants`/`exampleContainsWord`/`parseCues` をそのまま使える | content script（バニラJS・非バンドル）へ ~200行 移植＝ドリフト |
| OSクォータ管理 | サーバーで集中制御＋キャッシュ | 分散・制御困難 |
| 法的整合 | 生SRT=30条の4（内部・非配信）/ 表示1文=32条引用 の二層使い分けに合致 | 生SRTをクライアント配信＝「再配布可能な字幕ミラー」ガードレール違反 |

**案A採用**。`public-launch-legal-posture` のガードレール「生SRTをユーザー配信しない・
内部の解析入力に留める」と、「キャッシュ全文=30条の4／表示の1文=32条」の二層使い分けに
そのまま乗る。案Bは生SRTをクライアントに置く＝最も避けたい形。

エンドポイントの置き場所 = **next-app のルート**（`next-app/app/api/example/route.js`）。
`shared-cache-design` の「Next.js のみ変更」方針・`/api/vocab` が next-app にある事と整合。

---

## 3. データフロー（クリックは即・例文は非同期バックフィル）

保存クリックの体感を落とさないため、**即 bare 保存 → 非同期で例文を埋める**。

```
[単語クリック]
  popup に Netflix字幕行を「文脈プレビュー」として一瞬表示（= transient DOM読み。保存しない）
        │
[✓ 保存]
  ① 即時: saveWord({ word, sentence:'', ...ctx })           ← 配信字幕行は入れない
     SAVE_WORD_TO_CLOUD（sentence 空）                        ← 即クラウド同期
     トースト「保存しました ✓」                                 ← 体感は今と同じ
        │ （fire-and-forget）
  ② 非同期: background 経由で POST /api/example
        { title, season, episode, word, currentTimeSec }
        ├─ found:true → saveWord で同単語を patch（sentence=OSの1文）＋ 再 SAVE_WORD_TO_CLOUD
        └─ found:false → 何もしない（bare のまま＝「字幕なし／不一致＝例文なしで単語だけ保存」）
```

ポイント:
- **Netflix/Amazon の字幕行はポップアップの文脈プレビュー表示にのみ使い、サーバーにもDBにも送らない**。
  残るのは「どの単語をクリックしたか」の transient DOM読みだけ（＝最も防御しやすい行為）。
- サーバーへ送るのは `word`（著作物でない）＋ `title/season/episode`（メタ）＋
  `currentTimeSec`（ユーザー自身の再生位置）。**配信字幕テキストは一切送らない**。
- `my_words` は `PRIMARY KEY (user_id, word)`＋`Prefer: resolution=merge-duplicates`
  なので、②の再 POST は同じ行を upsert（＝patch）する。ローカルも `saveWord` が
  既存単語を index 一致で上書きするので patch 成立。**スキーマ変更不要**。

---

## 4. 2つのキャッシュ層（#2 への依存＝クリック毎の再DL防止）

`/api/example` が1文を返すまでに、安い順に2層をたどる。

### 層1: `vocab_cache` の語一致（**無料・新規インフラ不要・#2 にそのまま乗る**）
- `cache_key = v{n}:tmdb{id}:s{S}e{E}` で `vocab_cache` を引く（`/api/vocab` と同じ）。
- クリック語が**生成済みスーパーセット（~80語）のいずれかに活用形一致**したら、
  その語の `example`（OS由来・生成時に文脈確定済み）をそのまま返す。
  - OSダウンロード **ゼロ**、追加インフラ **ゼロ**。学習者がクリックしやすい
    「学習価値の高い語」はここで大半カバーされる。これが #2 を活かす本命パス。
  - `tsSec`/`tsLabel`（ベース時刻）も既に保存済みなら同梱できる。

### 層2: `subtitle_raw_cache`（**新設**・非vocab語のフォールバック）
- 層1ミス（クリック語がスーパーセット外）の時だけ。
- 生SRTをサーバー側で取得し `subtitle_raw_cache`(TMDB+S+E キー, **TTL必須, anon不可, 30条の4**)に保存。
  2回目以降の同話クリックは再DLしない＝OSダウンロードは「エピソード比例」に留まる。
- `parseCues(raw)` で `{sec,text}` 列にし、`getWordVariants`/`exampleContainsWord` で
  クリック語を含むキューを特定 → その1文を返す（出所 S×E ＋ base時刻つき）。
- これは `shared-cache-design` のリーン構成（A）が「経路②/フェーズ2で後付け」と
  明示的に先送りしたテーブル。**#3 を完全形にする＝この `subtitle_raw_cache` を入れる契機**。

> OSクォータ: 層1ヒット=0消費。層2=新規エピソードにつき1回（VIP 1000/日で無料規模は十分）。

---

## 5. 新規エンドポイント `/api/example` 仕様

```
POST /api/example            （Origin ゲート: cinelearn / cine-learn / localhost / 拡張）
req:  { title, season|null, episode|null, word, currentTimeSec? }
res:  { found:true,  sentence, source:'opensubtitles', tmdbId, season, episode,
        tsSec?, tsLabel? }
   |  { found:false }        // TMDB未解決 / 字幕なし / 一致なし
```

サーバー処理:
1. **TMDB解決**: `season==null`→`search_movie`、else `search`（tv）でタイトル→`tmdbId`/`type`。
   失敗 → `{found:false}`。（warm インスタンスでタイトル→ID をメモ化。）
2. **層1**: `vocab_cache` 参照 → 語一致あれば `example` を返す。
3. **層2**: `subtitle_raw_cache` ヒット→使用 / ミス→OS search+download→保存(TTL)。
   `parseCues`→クリック語を含むキューを特定（複数一致は §7 の規則で1つに）。
   一致あり→その1文。無し→`{found:false}`。
4. 生SRTは**返さない**。返すのは特定した**1文のみ**（32条）。

実装メモ:
- 再利用: `next-app/lib/subtitles.js` の `getWordVariants` / `exampleContainsWord` /
  `parseCues`（**現在 export されていないので export 追加**）/ `selectSubtitleCandidates`。
- OS取得: `api/subtitles.js` の search/download ロジック。next-app ルートから
  ①同ロジックを移植（OS env を cinelearn-next にも設定）か ②既存 `/api/subtitles`
  を server-to-server で叩く（Origin 許可調整）。**要判断**（env重複 vs 結合）。

---

## 6. 拡張側の変更（content.js / background.js / manifest）

- **content.js `showWordPopup` の保存ハンドラ**（現 540 付近）:
  - `entry.sentence` に配信字幕行を入れるのをやめ `''` にする。
  - 即 `saveWord` ＋ `SAVE_WORD_TO_CLOUD`（現状どおり）。
  - 続けて `requestExampleBackfill(entry)` を fire-and-forget で呼ぶ。
- **新関数 `requestExampleBackfill`**: `chrome.runtime.sendMessage({type:'CL_FETCH_EXAMPLE', ...})`
  → 結果 `found:true` なら `entry.sentence=result.sentence` で `saveWord`（patch）＋
  `SAVE_WORD_TO_CLOUD` 再送。`currentTimeSec` は `getActiveVideo().currentTime` から。
- **background.js**: `CL_FETCH_EXAMPLE` ハンドラ追加 → `POST {API}/api/example`。
  CORS回避のため background が代理（既存 `CL_FETCH_VTT` と同型）。
- **manifest.json**: `host_permissions` に **`https://cinelearn-next.vercel.app/*`** を追加
  （現状 `cine-learn.vercel.app` のみ＝新エンドポイントに届かない）。API ベースURLを
  cinelearn-next に向ける。
- ポップアップの文脈プレビュー（`"${sentence}"` のイタリック表示）は**残す**
  （画面に既にある字幕の一時表示＝純UI、保存しないので可）。

---

## 7. エッジケース・品質

1. **TMDB未解決/誤解決**: タイトル文字列がブレる/別作品にマッチ → `{found:false}`＝bare。
   タイトル→ID をサーバーでメモ化。将来、誤りはユーザー訂正UIで補正可。
2. **一致なし**（OS文字起こしが配信字幕と違う/固有名詞）→ bare。仕様どおり許容。
3. **複数キュー一致**（よくある語）→ `currentTimeSec` 最近傍のキューを選ぶ（オフセット≈0仮定の
   ベストエフォート。例文はシークより許容度が高い）。層1ヒット語は生成時に確定済みなので非該当。
   将来精度を上げるなら拡張の `cl_vodsync_*` アンカーを渡して VOD↔OS フィット（`fitVodSync`）。
4. **レイテンシ/UX**: §3 の非同期バックフィルで保存クリックは即時。
5. **`sentence` 意味変更**: 下流表示（WordbookModal/復習/クイズ）は `sentence` を
   `"..."`＋📺SxE で出す既存挙動のまま動く。出所に「OpenSubtitles」表記を足すのは **#4** で。
6. **Origin/権限**: 新エンドポイントは Origin ゲート。manifest に cinelearn-next を追加。
7. **プライバシー**: 保存毎に word＋作品メタ＋再生位置をサーバー送信（配信字幕は送らない）。
   **#5 PP** に記載。
8. **OSクォータ**: 層1=0、層2=エピソード比例。VIP 1000/日で無料規模は余裕。

---

## 8. 法的整合（要点）

- **保存データ**: word（著作物でない）＋ OS由来の**1文**（32条引用・出所 S×E＋provider）。
  配信字幕行は**保存しない**＝prong-B が保存物から消滅。Netflix画面に残るのは
  transient DOM読み（クリック語の一瞬の読取）のみ＝最も防御しやすい行為。
- **生SRT**: サーバー側 `subtitle_raw_cache` のみ（30条の4・内部解析入力・**非配信**・TTL）。
  クライアントへは特定1文だけ返す（32条）。`public-launch-legal-posture` の
  「内部=OK／生SRTをユーザー配信=NG」「全文=30条の4／1文=32条」にそのまま整合。
- **層2（原セリフ著作権）は不変**: 同じセリフ。出所明示・最小・非集約は引き続き必要（#4）。
- 私は弁護士ではない＝最終確認は専門家（完成画面の単発レビュー）。

---

## 9. 段階導入（推奨）

法的ゴール（prong-B 除去）は**増分1だけで達成**できる。増分2は例文カバレッジの上積み。

- **増分1（3a / 最小・新テーブル無し）**: `/api/example` は**層1（vocab_cache 語一致）のみ**。
  ヒット→OSの1文 / ミス→`{found:false}`＝bare。拡張は配信字幕行の保存を停止し
  非同期バックフィルを実装。**新インフラ0・追加OSダウンロード0・#2 に丸乗り**で、
  「配信字幕を一切保存しない」立て付けが即完成。カバレッジ=スーパーセット語のみ。
- **増分2（3b / 完全）**: `subtitle_raw_cache` ＋ OS download ＋ キュー一致を追加。
  非vocab語にも引用1文が付く。OSクォータ露出（エピソード比例）と TTL 管理が増える。

> 増分1で「保存物から Netflix/Amazon 軸を消す」という #3 の核は満たせる。
> 増分2は「クリックした任意の語に必ず例文を付ける」体験の質。リスクと工数で分離できる。

---

## 10. 残課題・要判断

- [ ] **OS取得の実装形**（§5）: next-app ルートに OS env を持たせ移植 / 既存 `/api/subtitles`
      を server-to-server で叩く（Origin調整）。— **要判断**
- [ ] `subtitle_raw_cache` の DDL（TTL/eviction 方式、anon GRANT 無し、service_role 書込）。
- [ ] `parseCues` 等の export 追加（lib の純粋関数化／Node からも使える形）。
- [ ] manifest host_permissions に cinelearn-next 追加 → 拡張の再読込/再パッケージ。
- [ ] 複数一致の時刻ベース選別をどこまでやるか（v1=最近傍ベストエフォート / 将来=VODフィット）。
- [ ] バックフィル成功時の UI（トーストで「例文を追加 ✓」を出すか、無音で patch か）。
- [ ] #4（出所明示）と連動: 例文表示面に「OpenSubtitles」provider 表記を足す。
- [ ] **増分1で出すか、増分2まで含めて出すか**の意思決定。
