'use client';

import { useEffect, useRef } from 'react';
import { NON_AFFILIATION } from '@/lib/legal';

// landing.html を忠実に移植したマーケLP。
// 静的マークアップは dangerouslySetInnerHTML でそのまま描画し（SSR されるため SEO も維持）、
// スクロール出現アニメだけ React 側の useEffect で配線する。
// CTA リンクは外部URLではなく同一デプロイのアプリ（/app）へ向ける。
// 拡張機能は Chrome Web Store 公開済み（zip/デベロッパーモード手順は廃止）。
// ストアURLは ExtensionGuide.js と同じものを指す（変える時は両方）。
const STORE_URL = 'https://chromewebstore.google.com/detail/cinelearn/jdhgbdpaeoihopelnnganoojpnplkiie';

const MARKUP = `
<!-- NAV -->
<nav>
  <div class="logo"><img class="logo-mark" src="/icon-192.png" alt="">Cine<span>Learn</span></div>
  <a href="/app" class="nav-btn">今すぐ始める →</a>
</nav>

<!-- HERO -->
<section class="hero">
  <img class="hero-logo" src="/logo-hero.png" alt="CineLearn — 映画やドラマで英語をまなぶ">
  <div class="hero-eyebrow">⭐ TOEIC 900点の壁を越えるために生まれた</div>
  <h1>ドラマを観るだけで<br><em>生きた英語</em>が身につく</h1>
  <p class="hero-sub">
    AIと間隔反復が、あなたのエンタメ時間をそのまま英語学習ルーティンに。
    「勉強だから続かない」を「観たいから続く」に変えて、
    教科書には載っていない生きた語彙を積み上げます。
  </p>

  <!-- STREAMING BADGES -->
  <div class="streaming-row">
    <span>対応サービス</span>
    <span class="s-badge">🔴 Netflix</span>
    <span class="s-badge">📦 Amazon Prime</span>
    <span class="s-badge">🏰 Disney+</span>
  </div>

  <!-- 副CTA（拡張）はPC幅ではストアへ、スマホ幅では拡張を入れられないので導入手順へ（CSS で出し分け） -->
  <div class="hero-btns">
    <a href="/app" class="btn-primary">🎬 無料で始める</a>
    <a href="${STORE_URL}" target="_blank" rel="noopener" class="btn-outline cta-ext-pc">🧩 Chrome に追加（無料）</a>
    <a href="#setup" class="btn-outline cta-ext-mobile">💻 PC で拡張を入れる（手順）</a>
    <a href="#how" class="btn-outline">仕組みを見る</a>
  </div>

  <!-- MOCKUP -->
  <div class="hero-visual">
    <div class="mock-bar">
      <div class="mock-dot"></div><div class="mock-dot"></div><div class="mock-dot"></div>
      <div class="mock-url">Suits S3E4 — 今週の予習単語</div>
    </div>
    <div class="mock-body">
      <div class="mock-label">AIが抽出した重要単語</div>
      <div class="word-chips">
        <span class="chip on">litigation</span>
        <span class="chip on">affidavit</span>
        <span class="chip off">the</span>
        <span class="chip on">leverage</span>
        <span class="chip off">was</span>
        <span class="chip on">deposition</span>
        <span class="chip on">subpoena</span>
        <span class="chip off">and</span>
        <span class="chip on">injunction</span>
        <span class="chip on">counsel</span>
      </div>
      <div class="mock-bar2"><div class="mock-fill"></div></div>
      <div class="mock-note">基礎単語 1,847語を自動スキップ → 重要語 12語に絞り込み</div>
    </div>
  </div>
</section>

<!-- SERVICES -->
<section class="section services" id="services">
  <div class="container">
    <div class="services-intro">
      <span class="section-tag">対応サービス</span>
      <h2>あなたが今使っている<br>サブスクがそのまま教材になる</h2>
      <p class="section-lead">
        新しいサービスを契約する必要はありません。すでに持っているNetflixやAmazon Primeが、
        そのまま英語学習の教材に変わります。
      </p>
    </div>
    <div class="services-grid">
      <div class="service-card featured">
        <div class="service-icon">🔴</div>
        <div class="service-name">Netflix</div>
        <div class="service-note">字幕クリック保存・例文・◀▶対応</div>
      </div>
      <div class="service-card featured">
        <div class="service-icon">📦</div>
        <div class="service-name">Amazon Prime</div>
        <div class="service-note">字幕クリック保存・例文・◀▶対応</div>
      </div>
      <div class="service-card">
        <div class="service-icon">🏰</div>
        <div class="service-name">Disney+</div>
        <div class="service-note">単語保存・例文・セリフコピー対応（◀▶ナビのみ非対応）</div>
      </div>
    </div>
  </div>
</section>

<!-- PROBLEM -->
<section class="section problem">
  <div class="container">
    <span class="section-tag">The Problem</span>
    <h2>語学学習か、エンタメか。<br>その二択を終わりにする。</h2>
    <p class="section-lead">既存のツールは、視聴体験を犠牲にして学習効率を上げようとする。CineLearnはその発想を逆転させました。</p>
    <div class="problem-grid">
      <div class="problem-quote">
        知らない単語が出るたびに動画を一時停止し、手作業でリストに保存していく。
        <strong>「純粋にドラマを楽しむ没入感」が完全に失われてしまう。</strong>
        このジレンマを解決するツールは、世界中を探しても見つかりませんでした。
      </div>
      <div class="vs-stack">
        <div class="vs-card bad">
          <div class="vs-icon">😤</div>
          <div>
            <div class="vs-title">従来のアプローチ</div>
            <div class="vs-desc">単語が出るたびに停止 → 手動で記録 → 没入感ゼロ → 継続できない</div>
          </div>
        </div>
        <div class="vs-card good">
          <div class="vs-icon">🎯</div>
          <div>
            <div class="vs-title">CineLearnのアプローチ</div>
            <div class="vs-desc">視聴前に単語を予習 → ドラマに完全没入 → 間隔反復で定着</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="section how" id="how">
  <div class="container">
    <span class="section-tag">How It Works</span>
    <h2>3ステップで始まる、<br>新しい学習サイクル</h2>
    <div class="steps-row">
      <div class="step-card">
        <div class="step-num">1</div>
        <div class="step-icon">🤖</div>
        <h3>AIが単語を自動生成</h3>
        <p>観たいドラマとエピソードを選ぶだけ。AIと字幕APIが字幕を解析し、あなたのレベルに合わせた未知単語リストを自動で作成。人気作品はキャッシュ済みで、待ち時間ほぼゼロで表示されます。</p>
      </div>
      <div class="step-card">
        <div class="step-num">2</div>
        <div class="step-icon">📖</div>
        <h3>予習してドラマに没入</h3>
        <p>「予習をはじめる」でカードを1枚ずつめくったら、あとは再生ボタンを押してストーリーに熱中するだけ。観終わった夜には"半券"が残ります。</p>
      </div>
      <div class="step-card">
        <div class="step-num">3</div>
        <div class="step-icon">📈</div>
        <h3>最適タイミングで復習</h3>
        <p>SM-2アルゴリズムが「忘れかけたタイミング」を算出。観たドラマの単語の復習が、ちょうどいい日に自動で並びます。</p>
      </div>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section class="section features" id="features">
  <div class="container">
    <span class="section-tag">Features</span>
    <h2>テクノロジーで<br>煩わしさをゼロにする</h2>
    <div class="feat-list">

      <div class="feat-row">
        <div>
          <span class="feat-tag">AI × 字幕API</span>
          <h3>視聴前の自動単語抽出で、動画を止めない</h3>
          <p>
            AIと字幕APIを組み合わせ「次に見るエピソード」の字幕データを裏側で解析。
            ユーザーのTOEICレベルに合わせて既知単語を自動除外し、未知の重要単語だけを抽出します。
            <strong style="color:var(--text)">あらかじめ予習しておくことで、再生後はドラマに没入するだけ。</strong>
          </p>
        </div>
        <div class="feat-visual">
          <div style="margin-bottom:18px">
            <div style="font-size:11px;color:var(--text-light);margin-bottom:12px;letter-spacing:1px;text-transform:uppercase">Suits S3E4 — 抽出された重要単語</div>
            <div class="word-chips">
              <span class="chip on">litigation</span>
              <span class="chip on">affidavit</span>
              <span class="chip on">deposition</span>
              <span class="chip off">the</span>
              <span class="chip on">injunction</span>
              <span class="chip off">and</span>
              <span class="chip on">subpoena</span>
              <span class="chip on">leverage</span>
            </div>
          </div>
          <div class="mock-bar2"><div class="mock-fill"></div></div>
          <div style="font-size:12px;color:var(--gold);margin-top:8px">1,847語を除外 → 重要単語 12語に絞り込み</div>
        </div>
      </div>

      <div class="feat-row flip">
        <div>
          <span class="feat-tag">Spaced Repetition</span>
          <h3>忘れる前に、ちょうどいいタイミングで復習</h3>
          <p>
            科学的に実証されている「間隔反復法（SM-2アルゴリズム）」をシステムに組み込み。
            過去の記憶状態から「いつ復習すれば最も定着するか」を算出し、最適なタイミングで自動出題します。
            各単語には復習回数・「知ってた／うろ覚え／知らなかった」の評価履歴も記録され、
            <strong style="color:var(--text)">自分の定着度が一目でわかります。</strong>
          </p>
        </div>
        <div class="feat-visual">
          <div style="font-size:12px;color:var(--text-light);margin-bottom:14px">今日の復習スケジュール</div>
          <div class="srs-item">
            <div>
              <div class="srs-word">litigation</div>
              <div class="srs-from">Suits S3E4 · <span style="color:#d94f4f">😰 知らなかった</span> · 2回復習済み</div>
            </div>
            <span class="pill red">🔴 今日</span>
          </div>
          <div class="srs-item">
            <div>
              <div class="srs-word">leverage</div>
              <div class="srs-from">Silicon Valley S1E2 · <span style="color:#2da87c">✅ 知ってた</span> · 4回復習済み</div>
            </div>
            <span class="pill gold">📅 明日</span>
          </div>
          <div class="srs-item">
            <div>
              <div class="srs-word">affidavit</div>
              <div class="srs-from">Suits S2E8 · 7回復習済み</div>
            </div>
            <span class="pill green">⭐ 習得済み</span>
          </div>
        </div>
      </div>

      <div class="feat-row">
        <div>
          <span class="feat-tag">Chrome Extension</span>
          <h3>ドラマ視聴中に単語を1クリック保存</h3>
          <p>
            Chrome拡張機能を使えば、字幕に表示される単語をクリックするだけで保存。
            辞書検索・意味確認・単語帳への追加がワンアクションで完了します。
            <strong style="color:var(--text)">ログインしておけば、保存した単語はクラウド同期されてスマホでも確認できます。</strong>
          </p>
        </div>
        <div class="feat-visual popup-wrap">
          <div>
            <div class="popup-mock">
              <div class="popup-head">
                <div class="popup-word">leverage</div>
                <div class="popup-phon">/ˈliːvərɪdʒ/ · noun</div>
              </div>
              <div class="popup-def">the power to influence a person or situation to achieve a particular outcome</div>
              <button class="popup-save">✓ 単語帳に保存</button>
            </div>
            <div style="text-align:center;font-size:12px;color:var(--text-light);margin-top:12px">← 字幕をクリックするだけ</div>
          </div>
        </div>
      </div>

      <!-- NEW: ドラマベースの単語カード -->
      <div class="feat-row flip">
        <div>
          <span class="feat-tag">Drama-Based Vocabulary</span>
          <h3>字幕と連動した、情報豊かな単語カード</h3>
          <p>
            単語カードにはドラマの字幕から自動抽出した例文と、AIによる自然な日本語訳を表示。
            さらに🔊ボタンで発音を即再生、📍でドラマ内の登場シーン（タイムスタンプ）を確認できます。
            <strong style="color:var(--text)">「この単語、あのシーンで出てきた」という文脈ごと記憶に残ります。</strong>
          </p>
        </div>
        <div class="feat-visual">
          <div style="font-size:11px;color:var(--text-light);margin-bottom:14px;letter-spacing:1px;text-transform:uppercase">単語カード</div>
          <!-- word card mock -->
          <div style="background:#fff;border:1px solid #e8e4dc;border-radius:14px;padding:16px 18px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-size:16px;font-weight:700;color:#1a1a1a">litigation</span>
              <span style="background:#f5e9d0;color:#b8923a;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px">Core</span>
              <span style="background:rgba(193,127,59,0.1);color:#b8923a;font-size:10px;padding:2px 7px;border-radius:10px">📍 12:34</span>
            </div>
            <div style="font-size:12px;color:#888;margin-bottom:2px">You want to avoid litigation at all costs.</div>
            <div style="font-size:11px;color:#aaa;">どんな手を使っても訴訟は避けたいはずだ。</div>
            <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 8px;font-size:13px;cursor:pointer">🔊</button>
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 9px;font-size:11px;color:#999;cursor:pointer">Skip</button>
            </div>
          </div>
          <div style="background:#fff;border:1px solid #e8e4dc;border-radius:14px;padding:16px 18px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="background:#e8f7f1;color:#2da87c;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px">✅ 知ってた</span>
              <span style="font-size:15px;font-weight:700;color:#1a1a1a">leverage</span>
              <span style="background:#f5e9d0;color:#b8923a;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px">Core</span>
              <span style="font-size:10px;color:#999;background:#f4f2ee;padding:2px 7px;border-radius:10px">3回復習済み</span>
            </div>
            <div style="font-size:12px;color:#888;margin-bottom:2px">We don't have the leverage we need.</div>
            <div style="font-size:11px;color:#aaa;">必要なレバレッジが足りない。</div>
            <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 8px;font-size:13px;cursor:pointer">🔊</button>
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 9px;font-size:11px;color:#999;cursor:pointer">Skip</button>
            </div>
          </div>
        </div>
      </div>

      <!-- NEW: 通知 -->
      <div class="feat-row">
        <div>
          <span class="feat-tag">Smart Notifications</span>
          <h3>復習タイミングをプッシュ通知でお知らせ</h3>
          <p>
            朝7時に「今日の復習単語数」、夜21時に「次のエピソードを見る前に復習しよう」という
            2種類のリマインダーをスマホ・PCへ自動送信。
            <strong style="color:var(--text)">視聴と学習をセットにする習慣が、自然と身につきます。</strong>
          </p>
          <ul style="list-style:none;padding:0;margin-top:16px;display:flex;flex-direction:column;gap:8px">
            <li style="display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-muted)">
              <span style="font-size:18px">🌅</span> <strong style="color:var(--text)">朝7時</strong>　今日の復習 N単語をお知らせ
            </li>
            <li style="display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-muted)">
              <span style="font-size:18px">🌙</span> <strong style="color:var(--text)">夜21時</strong>　視聴前の復習リマインダー
            </li>
          </ul>
        </div>
        <div class="feat-visual" style="display:flex;flex-direction:column;gap:12px;justify-content:center">
          <!-- notification mock -->
          <div style="background:#1c1c1e;border-radius:16px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
            <div style="width:36px;height:36px;background:#b8923a;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px">📚</div>
            <div>
              <div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:2px">今日の復習があります</div>
              <div style="color:#aaa;font-size:12px;line-height:1.5">8単語の復習日です！忘れないうちにサクッと復習しよう 💪</div>
              <div style="color:#666;font-size:11px;margin-top:4px">CineLearn · 朝7:00</div>
            </div>
          </div>
          <div style="background:#1c1c1e;border-radius:16px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
            <div style="width:36px;height:36px;background:#b8923a;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px">🎬</div>
            <div>
              <div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:2px">次のエピソードを見る前に</div>
              <div style="color:#aaa;font-size:12px;line-height:1.5">観る前の3分復習。今夜のセリフが、聞き取れる 📖✨</div>
              <div style="color:#666;font-size:11px;margin-top:4px">CineLearn · 夜21:00</div>
            </div>
          </div>
        </div>
      </div>

      <!-- NEW: 半券コレクション -->
      <div class="feat-row flip">
        <div>
          <span class="feat-tag">Ticket Stub Collection</span>
          <h3>観るたびに、"半券"がたまる</h3>
          <p>
            予習を終えてドラマを観ると、その夜の半券が発行されます。
            たまった半券はコレクションでいつでも見返せて、そのままその回の復習の入口に。
            <strong style="color:var(--text)">ノルマも連続記録もありません。観た夜だけに残る、小さな記念品です。</strong>
          </p>
        </div>
        <div class="feat-visual" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
          <!-- ticket stub mock -->
          <div style="max-width:290px;width:100%;background:linear-gradient(135deg,#fffdf8,#f7ecd6);border:1px solid #e8d5b0;border-radius:14px;overflow:hidden;box-shadow:0 10px 28px rgba(184,146,58,0.2)">
            <div style="padding:16px 18px 12px">
              <div style="font-size:10px;letter-spacing:2px;color:#b8923a;text-transform:uppercase;margin-bottom:6px">🎟 Cinelearn Ticket</div>
              <div style="font-size:17px;font-weight:700;color:#1a1a1a">Suits</div>
              <div style="font-size:12px;color:#888">S3E4</div>
            </div>
            <div style="border-top:2px dashed #e8d5b0;display:flex;align-items:center;justify-content:space-between;padding:10px 18px;background:rgba(255,255,255,0.65)">
              <span style="font-size:11px;color:#999">予習 12語 → 視聴</span>
              <span style="font-size:12px;font-weight:600;color:#2da87c">✓ 観た証</span>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-light)">予習を終えて観た夜に、1枚だけ発行</div>
        </div>
      </div>

    </div>
  </div>
</section>

<!-- STORY -->
<section class="section story" id="story">
  <div class="container story-inner">
    <span class="section-tag">Development Story</span>
    <h2>なぜこのプロダクトを作ったのか</h2>
    <div class="story-body">
      <p>
        毎朝30分、海外ドラマの視聴を日々のルーティンにしています。
        <strong>TOEIC900点の壁を越え、さらにその先にある「生きた英語」を身につけるためには</strong>、
        ネイティブのリアルな会話に触れ続けることが不可欠だからです。
      </p>
      <p>
        特に『Suits/スーツ』で飛び交う法務・交渉フレーズや、『シリコンバレー』のIT業界特有のスラングなど、
        教科書には載っていない実践的な表現を学ぶために、既存の語学学習用拡張機能（Language Reactorなど）を利用していました。
      </p>
      <p>
        しかし、そこに大きなストレスがありました。
        知らない単語が出るたびに字幕を追い、動画を一時停止しては手作業でリストに保存していく。
        <strong>これでは「純粋にドラマのストーリーを楽しむ没入感」が完全に失われてしまいます。</strong>
      </p>
      <div class="story-pull">
        「学習効率」を優先すればエンタメとしての楽しさが奪われ、<br>
        「楽しさ」を優先すれば単語は記憶に定着しない。<br><br>
        このジレンマを解決するツールは、世界中を探しても見つかりませんでした。
      </div>
      <p>
        <strong>「それなら、自分で作るしかない。」</strong>
      </p>
      <p>
        そう考え、情報工学の知見をフル活用して自らの課題を解決するために開発したのがこのプロダクトです。
        目指したのは、学習における無駄な作業をテクノロジーで完全に自動化すること。
        没入感を一切損なわず、それでいて自然と語彙が積み上がっていく体験を実現することでした。
      </p>
    </div>
  </div>
</section>

<!-- SETUP GUIDE -->
<section class="section setup" id="setup">
  <div class="container">
    <span class="section-tag">導入方法</span>
    <h2>3ステップで今すぐ使い始める</h2>
    <p class="section-lead" style="margin-bottom:36px">Webアプリはブラウザで開くだけ。Netflix / Prime Video の字幕から単語を集めるには、Chrome拡張機能（無料・PC専用）を追加し、アプリにログインしておきます。</p>

    <div class="setup-steps">

      <div class="install-step">
        <div>
          <span class="step-badge">STEP 1</span>
          <h3>Chrome Web Store で「Chrome に追加」</h3>
          <p>Chrome Web Store の CineLearn ページを開き、「Chrome に追加」を押すだけ。zip の解凍やデベロッパーモードの設定は不要です（Edge など他の Chromium 系ブラウザも同じ手順）。</p>
          <a href="${STORE_URL}" target="_blank" rel="noopener" class="btn-primary install-cta">🧩 Chrome Web Store で追加（無料）</a>
          <div class="note"><strong>💻 PC の Chrome / Edge 専用。</strong>スマホは Web アプリで予習・復習・テストに対応しています。スマホの方は <a href="/app">/app で予習から</a>始めてください。</div>
        </div>
        <div class="illus">
          <div class="illus-bar">
            <div class="illus-dot"></div><div class="illus-dot"></div><div class="illus-dot"></div>
            <div class="illus-url">🔒 chromewebstore.google.com/detail/cinelearn/…</div>
          </div>
          <div class="illus-body">
            <div class="ext-card" style="margin-top:0">
              <div class="ext-logo">CL</div>
              <div class="ext-info">
                <div class="ext-name">CineLearn</div>
                <div class="ext-id">ドラマ字幕から単語を保存 · 無料</div>
              </div>
              <div class="store-add-btn">Chrome に追加</div>
            </div>
            <div style="margin-top:12px;font-size:12px;color:#5f6368;line-height:1.7">Netflix・Prime Video の字幕をクリックで単語帳へ。予習・復習は Web アプリで。</div>
          </div>
        </div>
      </div>

      <div class="install-step reverse">
        <div>
          <span class="step-badge">STEP 2</span>
          <h3>Web アプリにログインする</h3>
          <p>拡張機能で集めた単語をアプリに届けるには<strong>ログインが必須</strong>です（ローカルのみの利用は予習・復習向け）。ログインすると単語・履歴がスマホ・PC・拡張機能で同期されます。</p>
          <a href="/app" class="btn-outline install-cta">アプリを開いてログイン →</a>
          <div class="note"><strong>⚠️ STEP 3 の前に必ず一度ログイン。</strong>拡張機能がこの画面からログインを自動で引き継ぎます（拡張側での入力は不要です）。</div>
        </div>
        <div class="illus">
          <div class="illus-bar">
            <div class="illus-dot"></div><div class="illus-dot"></div><div class="illus-dot"></div>
            <div class="illus-url">🔒 cinelearn-next.vercel.app/app</div>
          </div>
          <div class="illus-body" style="text-align:center;padding:24px 20px">
            <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;color:#1a1a1a;margin-bottom:4px">Cine<span style="color:#b8923a">Learn</span></div>
            <div style="font-size:12px;color:#999;margin-bottom:16px">ログインすると単語・履歴が同期されます</div>
            <div style="display:flex;flex-direction:column;gap:8px;max-width:220px;margin:0 auto">
              <div style="background:#fff;border-radius:10px;padding:9px 12px;font-size:12px;color:#999;border:1px solid #e8e4dc;text-align:left">📧 メールアドレス</div>
              <div style="background:#fff;border-radius:10px;padding:9px 12px;font-size:12px;color:#999;border:1px solid #e8e4dc;text-align:left">🔒 パスワード</div>
              <div style="background:#b8923a;border-radius:10px;padding:10px;font-size:12px;color:#fff;font-weight:600">ログイン</div>
            </div>
            <div class="ext-card" style="max-width:260px;margin:16px auto 0;text-align:left">
              <div class="ext-logo">CL</div>
              <div class="ext-info">
                <div class="ext-name">CineLearn 拡張機能</div>
                <div class="ext-id" style="color:#2e7d32">✓ ログインを引き継ぎました</div>
              </div>
              <div class="ext-on"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="install-step">
        <div>
          <span class="step-badge">STEP 3</span>
          <h3>Netflix / Prime Video で再生して字幕の単語をクリック</h3>
          <p>動画を再生し、字幕に表示される単語をクリックするだけ。辞書ポップアップが表示され、ワンクリックで単語帳に保存できます。</p>
          <div class="note"><strong>🔄 自動同期：</strong>ログイン済みなら、保存した単語は Web アプリとスマホに自動で同期されます（未ログインでの保存は同期されません）。Disney+ は単語保存・例文・セリフコピー対応（◀▶ナビのみ非対応）。</div>
        </div>
        <div class="illus" style="overflow:hidden">
          <div class="illus-bar">
            <div class="illus-dot"></div><div class="illus-dot"></div><div class="illus-dot"></div>
            <div class="illus-url">🔒 netflix.com/watch/...</div>
          </div>
          <div style="padding:0">
            <div class="netflix-mock">
              <div class="netflix-scene">🎬</div>
              <div class="netflix-popup">
                <div class="pw">leverage</div>
                <div class="pm">/ˈliːvərɪdʒ/ · noun</div>
                <div class="pd">the power to influence a person or situation</div>
                <button class="ps">✓ 単語帳に保存</button>
              </div>
              <div class="netflix-sub">
                You don't have enough <span class="cl-word">leverage</span> to win this case.
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</section>

<!-- FOR WHO -->
<section class="section forwho">
  <div class="container">
    <span class="section-tag">For Who</span>
    <h2>あなたのための<br>英語学習ツール</h2>
    <p class="section-lead">初心者向けの強制的なゲーム要素は持っていません。明確な目標を持ち、本気でレベルアップを目指す人のために設計されています。</p>
    <div class="forwho-grid">
      <div class="forwho-card">
        <div class="forwho-icon">🏢</div>
        <h3>ビジネス英語を高めたい社会人</h3>
        <p>SuitsやSuccessionで飛び交うビジネス・法務フレーズを、ドラマを観ながら自然に習得したい方。</p>
      </div>
      <div class="forwho-card">
        <div class="forwho-icon">💻</div>
        <h3>IT・テック系の英語に触れたい方</h3>
        <p>シリコンバレーやMr. Robotで登場するIT業界特有のスラングや専門用語を身につけたい方。</p>
      </div>
      <div class="forwho-card">
        <div class="forwho-icon">📊</div>
        <h3>TOEIC 800〜900点台を目指す方</h3>
        <p>基礎は固まった。あとは「生きた英語」への圧倒的な露出量が必要だと感じている中上級者。</p>
      </div>
    </div>
  </div>
</section>

<!-- CTA -->
<section class="cta">
  <div class="container">
    <span class="section-tag">Get Started</span>
    <h2>あなたの趣味の時間を、<br>そのまま学習ルーティンに</h2>
    <p class="section-lead">
      学習の準備はすべてシステムに任せてください。
      あなたはただ、お気に入りのドラマを楽しむだけです。
    </p>
    <div class="cta-btns">
      <a href="/app" class="btn-primary">🎬 無料で始める</a>
      <a href="${STORE_URL}" target="_blank" rel="noopener" class="btn-outline cta-ext-pc">🧩 Chrome に追加（無料）</a>
      <a href="#setup" class="btn-outline cta-ext-mobile">💻 PC で拡張を入れる（手順）</a>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <div class="logo">Cine<span>Learn</span></div>
  <small>© 2026 CineLearn. 観たいドラマが、教材になる。</small>
  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
    <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end">
      <a href="/app">アプリを開く →</a>
      <a href="/terms">利用規約</a>
      <a href="/privacy">プライバシーポリシー</a>
      <a href="mailto:cinelearn.202606@gmail.com">お問い合わせ</a>
    </div>
    <small style="color:#444;font-size:11px;max-width:420px;text-align:right;line-height:1.6">
      ${NON_AFFILIATION}
      This product uses the TMDB API but is not endorsed or certified by <a href="https://www.themoviedb.org" target="_blank" rel="noopener" style="color:#888">TMDB</a>.
    </small>
  </div>
</footer>
`;

export default function LandingPage() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // ── スクロールで要素をふわっと出現させる ──
    const targets = Array.from(
      root.querySelectorAll(
        '.step-card, .feat-row, .service-card, .forwho-card, .story-pull, .vs-card, .install-step'
      )
    );
    targets.forEach((el) => el.classList.add('reveal'));
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 }
    );
    targets.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
    };
  }, []);

  return <div ref={rootRef} dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
