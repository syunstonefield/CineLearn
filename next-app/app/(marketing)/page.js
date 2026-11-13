'use client';

import { useEffect, useRef } from 'react';
import { NON_AFFILIATION } from '@/lib/legal';
import { CURATION_ON } from '@/lib/curation';
import { noteFromParam } from '@/lib/usage';
import { lineIcon } from '@/components/icons/lineIconMarkup';

// landing.html を忠実に移植したマーケLP。
// 静的マークアップは dangerouslySetInnerHTML でそのまま描画し（SSR されるため SEO も維持）、
// スクロール出現アニメだけ React 側の useEffect で配線する。
// CTA リンクは外部URLではなく同一デプロイのアプリ（/app）へ向ける。
// 拡張機能は Chrome Web Store 公開済み（zip/デベロッパーモード手順は廃止）。
// ストアURLは ExtensionGuide.js と同じものを指す（変える時は両方）。
const STORE_URL = 'https://chromewebstore.google.com/detail/cinelearn/jdhgbdpaeoihopelnnganoojpnplkiie';

// 拡張の保存の言い方（旗 lib/curation.js で切り替え・拡張 v1.2.12 のふきだしと同じ）。旗 off の間は今の文言のまま。
const LP = CURATION_ON
  ? {
      featH3: 'ドラマを観ながら、字幕の単語をその場で保存',
      featP1: 'Chrome拡張機能を使えば、字幕に表示される単語をクリックして、その場で辞書を開けます。',
      featP: '辞書検索と意味の確認から保存まで、その場で済みます。保存した語はその話の単語リストに残り、「★ 覚えたい」を押した語は単語帳にも入ります。',
      popupBtns: '<button class="popup-save">✓ 保存</button><button class="popup-save popup-star">★ 覚えたい</button>',
      storeCaption: 'Netflix・Prime Video の字幕をクリックで保存。予習・復習は Web アプリで。',
      popupNote: '← 字幕の単語をクリック',
      step3P: '動画を再生し、字幕に表示される単語をクリック。辞書ポップアップの「✓ 保存」でその話の単語リストに残り、「★ 覚えたい」で単語帳にも入ります。',
      psBtns: '<button class="ps">✓ 保存</button><button class="ps ps-star">★ 覚えたい</button>',
    }
  : {
      featH3: 'ドラマ視聴中に単語を1クリック保存',
      featP1: 'Chrome拡張機能を使えば、字幕に表示される単語をクリックするだけで保存。',
      featP: '辞書検索・意味確認・単語帳への追加がワンアクションで完了します。',
      popupBtns: '<button class="popup-save">✓ 単語帳に保存</button>',
      storeCaption: 'Netflix・Prime Video の字幕をクリックで単語帳へ。予習・復習は Web アプリで。',
      popupNote: '← 字幕をクリックするだけ',
      step3P: '動画を再生し、字幕に表示される単語をクリックするだけ。辞書ポップアップが表示され、ワンクリックで単語帳に保存できます。',
      psBtns: '<button class="ps">✓ 単語帳に保存</button>',
    };

const MARKUP = `
<!-- NAV -->
<nav>
  <div class="logo"><img class="logo-mark" src="/icon-192.png" alt="">Cine<span>Learn</span></div>
  <div class="nav-links">
    <a href="#how">仕組み</a>
    <a href="#features">できること</a>
    <a href="#setup">拡張機能</a>
    <a href="#faq">よくある質問</a>
  </div>
  <a href="/app" class="nav-btn">無料で始める</a>
</nav>

<!-- HERO（2026-11-13 見直し: 左に言葉・右にアプリの見本。見本は作った画面＝ポスターなし・「見本」と書く） -->
<section class="hero">
  <div class="hero-grid">
    <div class="hero-copy">
      <img class="hero-logo" src="/logo-hero.png" alt="CineLearn — 映画やドラマで英語をまなぶ">
      <div class="hero-eyebrow">海外ドラマで英語を続けたくて作った学習ツール</div>
      <h1>観たいドラマが、<br><em>英語の教材</em>になる</h1>
      <p class="hero-sub">
        観たい作品とエピソードを選ぶと、その話に出てくる単語のリストができます。
        観る前にカードで見ておいて、観たあとは復習へ。
        学ばなくても、観るのはいつでも自由です。
      </p>

      <!-- 副CTA（拡張）はPC幅ではストアへ、スマホ幅では拡張を入れられないので導入手順へ（CSS で出し分け） -->
      <div class="hero-btns">
        <a href="/app" class="btn-primary">無料で始める</a>
        <a href="${STORE_URL}" target="_blank" rel="noopener" class="btn-outline cta-ext-pc">Chrome に追加（無料）</a>
        <a href="#setup" class="btn-outline cta-ext-mobile">PC で拡張を入れる（手順）</a>
      </div>
      <div class="hero-points">
        <span>${lineIcon('check')} 登録なしで試せます</span>
        <span>${lineIcon('check')} スマホでも使えます</span>
        <span>${lineIcon('check')} ノルマも連続記録もありません</span>
      </div>

      <!-- STREAMING BADGES -->
      <div class="streaming-row">
        <span>対応サービス</span>
        <span class="s-badge">Netflix</span>
        <span class="s-badge">Amazon Prime</span>
        <span class="s-badge">Disney+</span>
      </div>

      <!-- ベータ表示（オーナー決定 2026-10-08）。「体験版」でなく「ベータ版」＝期限付き試用や近い課金を暗示しない語を選ぶ -->
      <div class="hero-beta">
        <span class="beta-pill">ベータ版</span>
        <span>いまは無料で公開中。正式版では一部機能が有料になる場合がありますが、保存した単語帳と学習記録はそのまま残ります。</span>
      </div>
    </div>

    <!-- アプリの見本（作った画面・ポスターなし） -->
    <div class="hero-shots" aria-label="アプリの画面の見本">
      <div class="shot shot-a">
        <div class="shot-cap">見本：作品の画面</div>
        <div class="shot-work">
          <div class="shot-poster">S</div>
          <div>
            <div class="shot-title">Suits</div>
            <div class="shot-ep">シーズン3 第4話・この話の語 12</div>
          </div>
        </div>
        <div class="shot-peek-t">次に出てくる単語</div>
        <div class="shot-peek" lang="en">litigation・leverage・subpoena <em>ほか</em></div>
        <div class="shot-btn">単語を学ぶ<small>12枚</small></div>
        <div class="shot-free">学ばなくても、いつでも観られます</div>
      </div>
      <div class="shot shot-b">
        <div class="shot-cap">見本：単語カード</div>
        <div class="shot-word" lang="en">leverage <span class="shot-sound">${lineIcon('speaker')}</span></div>
        <div class="shot-mean">（交渉での）強み・影響力</div>
        <div class="shot-ex" lang="en">“We don't have the leverage we need.”</div>
        <div class="shot-ja">必要なレバレッジが足りない。</div>
        <div class="shot-rate">
          <span>知らなかった</span><span>うろ覚え</span><span class="is-on">知ってた</span>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- SERVICES -->
<section class="section services" id="services">
  <div class="container">
    <div class="services-intro">
      <span class="section-tag">対応サービス</span>
      <h2>いま使っているサブスクが、<br>そのまま教材になる</h2>
      <p class="section-lead">
        新しい動画サービスを契約する必要はありません。
        動画は、いつもの配信サービスでそのまま観てください。CineLearn は、その話の単語を用意します。
      </p>
    </div>
    <div class="services-grid">
      <div class="service-card featured">
        <div class="service-icon">${lineIcon('tv')}</div>
        <div class="service-name">Netflix</div>
        <div class="service-note">字幕の単語をクリックで保存・例文・字幕の行送り（◀▶）</div>
      </div>
      <div class="service-card featured">
        <div class="service-icon">${lineIcon('tv')}</div>
        <div class="service-name">Amazon Prime</div>
        <div class="service-note">字幕の単語をクリックで保存・例文・字幕の行送り（◀▶）</div>
      </div>
      <div class="service-card">
        <div class="service-icon">${lineIcon('tv')}</div>
        <div class="service-name">Disney+</div>
        <div class="service-note">単語の保存・例文・セリフのコピー（字幕の行送りだけ非対応）</div>
      </div>
    </div>
    <p class="services-foot">上の3つは、PC の Chrome 拡張機能で字幕の単語を保存できるサービスです。単語リスト・カード・復習は、Web アプリで（スマホでも）使えます。</p>
  </div>
</section>

<!-- PROBLEM -->
<section class="section problem">
  <div class="container">
    <span class="section-tag">なぜ作ったか</span>
    <h2>語学学習か、エンタメか。<br>その二択を終わりにする。</h2>
    <p class="section-lead">観ている途中で何度も止めると、ドラマが楽しめなくなります。CineLearn は順番を変えました。単語は観る前と観たあとに。観ている間は、止めずに楽しむ。</p>
    <div class="problem-grid">
      <div class="problem-quote">
        知らない単語が出るたびに動画を一時停止し、手作業でリストに保存していく。
        <strong>これでは、ドラマに入り込めません。</strong>
        楽しさを取るか、学習を取るか。その二択になっていました。
      </div>
      <div class="vs-stack">
        <div class="vs-card bad">
          <div class="vs-icon">${lineIcon('pause')}</div>
          <div>
            <div class="vs-title">従来のアプローチ</div>
            <div class="vs-desc">単語が出るたびに停止 → 手で記録 → 話に入り込めない → 続かない</div>
          </div>
        </div>
        <div class="vs-card good">
          <div class="vs-icon">${lineIcon('target')}</div>
          <div>
            <div class="vs-title">CineLearnのアプローチ</div>
            <div class="vs-desc">観る前に単語を学ぶ → 止めずに観る → 次の日から復習</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="section how" id="how">
  <div class="container">
    <span class="section-tag">仕組み</span>
    <h2>選ぶ、学ぶ、観る。<br>あとは復習が並びます</h2>
    <div class="steps-row">
      <div class="step-card">
        <div class="step-num">1</div>
        <div class="step-icon">${lineIcon('sparkle')}</div>
        <h3>作品とエピソードを選ぶ</h3>
        <p>観たいドラマや映画を選ぶと、AI が字幕を読んで、あなたのレベルに合わせた単語リストを作ります。すでに用意のある作品は、すぐに表示されます。</p>
      </div>
      <div class="step-card">
        <div class="step-num">2</div>
        <div class="step-icon">${lineIcon('openBook')}</div>
        <h3>単語を学んでドラマへ</h3>
        <p>「単語を学ぶ」でカードに1枚ずつ答えたら、あとは再生ボタンを押してストーリーを楽しむだけ。答えた単語は、次の日からの復習に並びます。</p>
      </div>
      <div class="step-card">
        <div class="step-num">3</div>
        <div class="step-icon">${lineIcon('repeat')}</div>
        <h3>次の日から、復習に並ぶ</h3>
        <p>答えた結果から、次の復習日を決めます。観たドラマの単語が、その日の復習に並びます。開かない日があっても、責める表示はありません。</p>
      </div>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section class="section features" id="features">
  <div class="container">
    <span class="section-tag">できること</span>
    <h2>手間のかかる所は、<br>アプリが引き受けます</h2>
    <div class="feat-list">

      <div class="feat-row">
        <div>
          <span class="feat-tag">単語リスト</span>
          <h3>観る前に単語リストができるから、動画を止めない</h3>
          <p>
            これから観るエピソードの字幕を AI が読み、
            設定した英語のレベルに合わせて、知っていそうな単語を外し、その話で大事な単語だけを選びます。
            <strong style="color:var(--text)">観る前に単語を学んでおけば、再生中は止めずにドラマを楽しめます。予習しなくても、観るのはいつでも自由です。</strong>
          </p>
        </div>
        <div class="feat-visual">
          <div style="margin-bottom:18px">
            <div style="font-size:11px;color:var(--text-light);margin-bottom:12px;letter-spacing:1px;text-transform:uppercase">見本：Suits S3E4 — 抽出された重要単語</div>
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
          <span class="feat-tag">復習</span>
          <h3>答えた結果から、次の復習日が決まる</h3>
          <p>
            間隔反復（SM-2 をもとにした方式）で、前回の答えから次の復習日を決めて自動で出題します。
            各単語には復習回数・「知ってた／うろ覚え／知らなかった」の答えの記録も残り、
            <strong style="color:var(--text)">語ごとの復習の記録を見返せます。</strong>
          </p>
        </div>
        <div class="feat-visual">
          <div style="font-size:12px;color:var(--text-light);margin-bottom:14px">見本：今日の復習スケジュール</div>
          <div class="srs-item">
            <div>
              <div class="srs-word">litigation</div>
              <div class="srs-from">Suits S3E4 · 知らなかった · 2回復習済み</div>
            </div>
            <span class="pill gold">今日</span>
          </div>
          <div class="srs-item">
            <div>
              <div class="srs-word">leverage</div>
              <div class="srs-from">Silicon Valley S1E2 · 知ってた · 4回復習済み</div>
            </div>
            <span class="pill gold">明日</span>
          </div>
          <div class="srs-item">
            <div>
              <div class="srs-word">affidavit</div>
              <div class="srs-from">Suits S2E8 · 7回復習済み</div>
            </div>
            <span class="pill gold">マスター</span>
          </div>
        </div>
      </div>

      <div class="feat-row">
        <div>
          <span class="feat-tag">Chrome 拡張機能（PC）</span>
          <h3>${LP.featH3}</h3>
          <p>
            ${LP.featP1}
            ${LP.featP}
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
              ${LP.popupBtns}
            </div>
            <div style="text-align:center;font-size:12px;color:var(--text-light);margin-top:12px">${LP.popupNote}</div>
          </div>
        </div>
      </div>

      <!-- NEW: ドラマベースの単語カード -->
      <div class="feat-row flip">
        <div>
          <span class="feat-tag">単語カード</span>
          <h3>その話の例文がついた単語カード</h3>
          <p>
            単語カードには、その話の字幕から選んだ例文と、AI による日本語訳がつきます。
            音のボタン（${lineIcon('speaker')}）で発音を聞けて、場面の時刻（${lineIcon('pin')}）でどのあたりの場面かが分かります。
            <strong style="color:var(--text)">「あの場面で出てきた語だ」と、場面と結びつけて見返せます。</strong>
          </p>
        </div>
        <div class="feat-visual">
          <div style="font-size:11px;color:var(--text-light);margin-bottom:14px;letter-spacing:1px;text-transform:uppercase">見本：単語カード</div>
          <!-- word card mock -->
          <div style="background:#fff;border:1px solid #e8e4dc;border-radius:14px;padding:16px 18px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-size:16px;font-weight:700;color:#1a1a1a">litigation</span>
              <span style="background:#f5e9d0;color:#b8923a;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px">Core</span>
              <span style="background:rgba(193,127,59,0.1);color:#b8923a;font-size:10px;padding:2px 7px;border-radius:10px;display:inline-flex;align-items:center;gap:3px">${lineIcon('pin')} 12:34</span>
            </div>
            <div style="font-size:12px;color:#888;margin-bottom:2px">You want to avoid litigation at all costs.</div>
            <div style="font-size:11px;color:#aaa;">どんな手を使っても訴訟は避けたいはずだ。</div>
            <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 8px;font-size:13px;cursor:pointer;color:#888;display:inline-flex;align-items:center" aria-label="発音を再生">${lineIcon('speaker')}</button>
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 9px;font-size:11px;color:#999;cursor:pointer">Skip</button>
            </div>
          </div>
          <div style="background:#fff;border:1px solid #e8e4dc;border-radius:14px;padding:16px 18px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="background:#e8f7f1;color:#2da87c;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;display:inline-flex;align-items:center;gap:3px">${lineIcon('check')} 知ってた</span>
              <span style="font-size:15px;font-weight:700;color:#1a1a1a">leverage</span>
              <span style="background:#f5e9d0;color:#b8923a;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px">Core</span>
              <span style="font-size:10px;color:#999;background:#f4f2ee;padding:2px 7px;border-radius:10px">3回復習済み</span>
            </div>
            <div style="font-size:12px;color:#888;margin-bottom:2px">We don't have the leverage we need.</div>
            <div style="font-size:11px;color:#aaa;">必要なレバレッジが足りない。</div>
            <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 8px;font-size:13px;cursor:pointer;color:#888;display:inline-flex;align-items:center" aria-label="発音を再生">${lineIcon('speaker')}</button>
              <button style="background:none;border:1px solid #e8e4dc;border-radius:6px;padding:3px 9px;font-size:11px;color:#999;cursor:pointer">Skip</button>
            </div>
          </div>
        </div>
      </div>

      <!-- NEW: 通知 -->
      <div class="feat-row">
        <div>
          <span class="feat-tag">お知らせ（任意）</span>
          <h3>復習のある日を、通知でお知らせ</h3>
          <p>
            朝7時に「今日の復習の語数」、夕方17時半に「観る前の復習」の2つを、スマホや PC にお知らせします。
            通知は設定でオンにした人にだけ届き、いつでもオフにできます。
            <strong style="color:var(--text)">観る前に、その話の単語をまとめて見返せます。</strong>
          </p>
          <ul style="list-style:none;padding:0;margin-top:16px;display:flex;flex-direction:column;gap:8px">
            <li style="display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-muted)">
              <span style="font-size:18px;color:var(--gold);display:inline-flex">${lineIcon('sun')}</span> <strong style="color:var(--text)">朝7時</strong>　今日の復習の語数をお知らせ
            </li>
            <li style="display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-muted)">
              <span style="font-size:18px;color:var(--gold);display:inline-flex">${lineIcon('moon')}</span> <strong style="color:var(--text)">夕方17時半</strong>　観る前の復習のお知らせ
            </li>
          </ul>
        </div>
        <div class="feat-visual" style="display:flex;flex-direction:column;gap:12px;justify-content:center">
          <!-- notification mock -->
          <div style="background:#1c1c1e;border-radius:16px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
            <div style="width:36px;height:36px;background:#b8923a;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff">${lineIcon('repeat')}</div>
            <div>
              <div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:2px">今日の復習があります</div>
              <div style="color:#aaa;font-size:12px;line-height:1.5">8語が今日の復習に並んでいます</div>
              <div style="color:#666;font-size:11px;margin-top:4px">CineLearn · 朝7:00</div>
            </div>
          </div>
          <div style="background:#1c1c1e;border-radius:16px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
            <div style="width:36px;height:36px;background:#b8923a;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff">${lineIcon('tv')}</div>
            <div>
              <div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:2px">次のエピソードを見る前に</div>
              <div style="color:#aaa;font-size:12px;line-height:1.5">観る前に、その話の単語を見返せます</div>
              <div style="color:#666;font-size:11px;margin-top:4px">CineLearn · 17:30</div>
            </div>
          </div>
        </div>
      </div>

      <!-- コレクション（学習の記録・2026-11-12 半券の節を書き換え） -->
      <div class="feat-row flip">
        <div>
          <span class="feat-tag">コレクション</span>
          <h3>学習した作品が、記録として並ぶ</h3>
          <p>
            単語リストを作った作品は、コレクションに学習の記録として並びます。
            作品ごとに、単語リストを作った話・覚えた語・マスターした語を見返せて、そのまま続きの学習や話ごとの単語リストへ戻れます。
            <strong style="color:var(--text)">覚えた語の割合が上がると、記録の枠が変わります（一度届いた枠は戻りません）。ノルマも連続記録もありません。</strong>
          </p>
        </div>
        <div class="feat-visual" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
          <!-- collection record mock（作品名・ポスターは出さない） -->
          <div style="max-width:290px;width:100%;background:#fff;border:1px solid #e8e4dc;border-radius:12px;padding:16px 18px;box-shadow:0 10px 28px rgba(184,146,58,0.12)">
            <div style="font-size:10px;letter-spacing:2px;color:#b8923a;text-transform:uppercase;margin-bottom:8px">見本：学習の記録</div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#555;margin-bottom:10px">
              <span>単語リスト <b style="color:#1a1a1a">4</b>話</span>
              <span>覚えた <b style="color:#1a1a1a">38</b>語</span>
              <span>マスター <b style="color:#1a1a1a">20</b>語</span>
            </div>
            <div style="font-size:12px;color:#888;margin-bottom:6px">達成度 95%</div>
            <div style="height:6px;border-radius:99px;background:#f0eeea;overflow:hidden"><div style="width:95%;height:100%;background:#c17f3b"></div></div>
          </div>
          <div style="font-size:12px;color:var(--text-light)">覚えた語の割合で、記録の枠が変わります</div>
        </div>
      </div>

    </div>
  </div>
</section>

<!-- STORY -->
<section class="section story" id="story">
  <div class="container story-inner">
    <span class="section-tag">開発のきっかけ</span>
    <h2>自分がほしくて、作りました</h2>
    <div class="story-body">
      <p>
        毎朝30分、海外ドラマの視聴を日々のルーティンにしています。
        <strong>TOEIC900点の壁を越え、さらにその先にある「生きた英語」を身につけるためには</strong>、
        ネイティブのリアルな会話に触れ続けることが不可欠だからです。
      </p>
      <p>
        特に『Suits/スーツ』で飛び交う法務・交渉フレーズや、『シリコンバレー』のIT業界特有のスラングなど、
        教科書には載っていない表現を学ぶために、語学学習用の拡張機能をいくつか使っていました。
      </p>
      <p>
        しかし、そこに大きなストレスがありました。
        知らない単語が出るたびに字幕を追い、動画を一時停止しては手作業でリストに保存していく。
        <strong>これでは「純粋にドラマのストーリーを楽しむ没入感」が完全に失われてしまいます。</strong>
      </p>
      <div class="story-pull">
        学習を優先すると、ドラマの楽しさが減る。<br>
        楽しさを優先すると、単語はそのまま流れていく。<br><br>
        両方を取れる道具は、探しても見つかりませんでした。
      </div>
      <p>
        <strong>「それなら、自分で作るしかない。」</strong>
      </p>
      <p>
        そう考えて、自分の困りごとを解くために作ったのが CineLearn です。
        目指したのは、単語を拾って整理する手間を、アプリに任せること。
        観ている間は止めずに楽しめて、観た分だけ単語の記録が残っていく。そんな道具です。
      </p>
    </div>
  </div>
</section>

<!-- SETUP GUIDE -->
<section class="section setup" id="setup">
  <div class="container">
    <span class="section-tag">導入方法</span>
    <h2>拡張機能の入れ方（PC・3ステップ）</h2>
    <p class="section-lead" style="margin-bottom:36px">Webアプリはブラウザで開くだけ。Netflix / Prime Video の字幕から単語を集めるには、Chrome拡張機能（無料・PC専用）を追加し、アプリにログインしておきます。</p>

    <div class="setup-steps">

      <div class="install-step">
        <div>
          <span class="step-badge">STEP 1</span>
          <h3>Chrome Web Store で「Chrome に追加」</h3>
          <p>Chrome Web Store の CineLearn ページを開き、「Chrome に追加」を押すだけ。zip の解凍やデベロッパーモードの設定は不要です（Edge など他の Chromium 系ブラウザも同じ手順）。</p>
          <a href="${STORE_URL}" target="_blank" rel="noopener" class="btn-primary install-cta">Chrome Web Store で追加（無料）</a>
          <div class="note"><strong>PC の Chrome / Edge 専用。</strong>スマホは Web アプリで、単語を学ぶ・復習・クイズに対応しています。スマホの方は <a href="/app">/app で作品を選んで</a>始めてください。</div>
        </div>
        <div class="illus">
          <div class="illus-bar">
            <div class="illus-dot"></div><div class="illus-dot"></div><div class="illus-dot"></div>
            <div class="illus-url">${lineIcon('lock')} chromewebstore.google.com/detail/cinelearn/…</div>
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
            <div style="margin-top:12px;font-size:12px;color:#5f6368;line-height:1.7">${LP.storeCaption}</div>
          </div>
        </div>
      </div>

      <div class="install-step reverse">
        <div>
          <span class="step-badge">STEP 2</span>
          <h3>Web アプリにログインする</h3>
          <p>拡張機能で集めた単語をアプリに届けるには<strong>ログインが必須</strong>です（ローカルのみの利用は予習・復習向け）。ログインすると単語・履歴がスマホ・PC・拡張機能で同期されます。</p>
          <a href="/app" class="btn-outline install-cta">アプリを開いてログイン →</a>
          <div class="note"><strong>${lineIcon('warning')} STEP 3 の前に必ず一度ログイン。</strong>拡張機能がこの画面からログインを自動で引き継ぎます（拡張側での入力は不要です）。</div>
        </div>
        <div class="illus">
          <div class="illus-bar">
            <div class="illus-dot"></div><div class="illus-dot"></div><div class="illus-dot"></div>
            <div class="illus-url">${lineIcon('lock')} cinelearn-next.vercel.app/app</div>
          </div>
          <div class="illus-body" style="text-align:center;padding:24px 20px">
            <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;color:#1a1a1a;margin-bottom:4px">Cine<span style="color:#b8923a">Learn</span></div>
            <div style="font-size:12px;color:#999;margin-bottom:16px">ログインすると単語・履歴が同期されます</div>
            <div style="display:flex;flex-direction:column;gap:8px;max-width:220px;margin:0 auto">
              <div style="background:#fff;border-radius:10px;padding:9px 12px;font-size:12px;color:#999;border:1px solid #e8e4dc;text-align:left">メールアドレス</div>
              <div style="background:#fff;border-radius:10px;padding:9px 12px;font-size:12px;color:#999;border:1px solid #e8e4dc;text-align:left">パスワード</div>
              <div style="background:#b8923a;border-radius:10px;padding:10px;font-size:12px;color:#fff;font-weight:600">ログイン</div>
            </div>
            <div class="ext-card" style="max-width:260px;margin:16px auto 0;text-align:left">
              <div class="ext-logo">CL</div>
              <div class="ext-info">
                <div class="ext-name">CineLearn 拡張機能</div>
                <div class="ext-id" style="color:#2e7d32">${lineIcon('check')} ログインを引き継ぎました</div>
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
          <p>${LP.step3P}</p>
          <div class="note"><strong>自動同期：</strong>ログイン済みなら、保存した単語は Web アプリとスマホに自動で同期されます（未ログインでの保存は同期されません）。Disney+ は単語保存・例文・セリフコピー対応（◀▶ナビのみ非対応）。</div>
        </div>
        <div class="illus" style="overflow:hidden">
          <div class="illus-bar">
            <div class="illus-dot"></div><div class="illus-dot"></div><div class="illus-dot"></div>
            <div class="illus-url">${lineIcon('lock')} netflix.com/watch/...</div>
          </div>
          <div style="padding:0">
            <div class="netflix-mock">
              <div class="netflix-scene">${lineIcon('film')}</div>
              <div class="netflix-popup">
                <div class="pw">leverage</div>
                <div class="pm">/ˈliːvərɪdʒ/ · noun</div>
                <div class="pd">the power to influence a person or situation</div>
                ${LP.psBtns}
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
    <span class="section-tag">こんな方に</span>
    <h2>観たい作品がある人の、<br>英語学習ツール</h2>
    <p class="section-lead">ノルマも連続記録もありません。観たい作品があること。それがいちばんの条件です。</p>
    <div class="forwho-grid">
      <div class="forwho-card">
        <div class="forwho-icon">${lineIcon('briefcase')}</div>
        <h3>ビジネス英語を高めたい社会人</h3>
        <p>Suits や Succession で飛び交うビジネス・法務の言い回しを、観る前にまとめて見ておきたい方。</p>
      </div>
      <div class="forwho-card">
        <div class="forwho-icon">${lineIcon('laptop')}</div>
        <h3>IT・テック系の英語に触れたい方</h3>
        <p>シリコンバレーや Mr. Robot に出てくる、IT 業界のスラングや専門用語を知っておきたい方。</p>
      </div>
      <div class="forwho-card">
        <div class="forwho-icon">${lineIcon('target')}</div>
        <h3>自分のレベルに合う単語から始めたい方</h3>
        <p>英語のレベルは A2（初級）から C1（上級）まで選べます。選んだレベルに合わせて、単語リストの語が変わります。</p>
      </div>
    </div>
  </div>
</section>

<!-- FAQ（2026-11-13 追加。答えは、このページ・規約・フッターの表示と同じ中身だけ） -->
<section class="section faq" id="faq">
  <div class="container faq-inner">
    <span class="section-tag">よくある質問</span>
    <h2>始める前に、気になること</h2>
    <div class="faq-list">
      <details class="faq-item">
        <summary>料金はかかりますか？</summary>
        <p>いまはベータ版で、無料で使えます。正式版では一部機能が有料になる場合がありますが、保存した単語帳と学習記録はそのまま残ります。</p>
      </details>
      <details class="faq-item">
        <summary>スマホだけでも使えますか？</summary>
        <p>はい。Web アプリは、スマホのブラウザで作品を選んで、単語を学ぶ・復習・クイズができます。字幕の単語をクリックして保存する拡張機能は、PC の Chrome / Edge 専用です。</p>
      </details>
      <details class="faq-item">
        <summary>動画は CineLearn の中で観られますか？</summary>
        <p>いいえ。CineLearn は動画を配信しません。動画は、ご自身が契約している配信サービスで観てください。CineLearn は、Netflix・Amazon・Disney などの各社と提携・公認の関係にはありません。</p>
      </details>
      <details class="faq-item">
        <summary>ログインは必要ですか？</summary>
        <p>Web アプリは、ログインなしでも始められます（記録はその端末に残ります）。ログインすると、単語と学習記録がスマホ・PC・拡張機能で同期されます。拡張機能で保存した単語をアプリに届けるには、ログインが必要です。</p>
      </details>
      <details class="faq-item">
        <summary>英語が得意でなくても使えますか？</summary>
        <p>英語のレベルは、設定で A2（初級）から C1（上級）まで選べます。選んだレベルに合わせて、単語リストに入る語が変わります。</p>
      </details>
      <details class="faq-item">
        <summary>単語を学ばないと、観られませんか？</summary>
        <p>いいえ。学ばなくても、観るのはいつでも自由です。観たあとに単語リストを見るだけでも使えます。</p>
      </details>
    </div>
    <p class="faq-more">ほかの質問は <a href="/support">サポートのページ</a> へ。</p>
  </div>
</section>

<!-- CTA -->
<section class="cta">
  <div class="container">
    <span class="section-tag">はじめる</span>
    <h2>あなたの趣味の時間を、<br>そのまま学習ルーティンに</h2>
    <p class="section-lead">
      単語の用意は、アプリに任せてください。
      あなたは、観たい作品を選ぶだけです。
    </p>
    <div class="cta-btns">
      <a href="/app" class="btn-primary">無料で始める</a>
      <a href="${STORE_URL}" target="_blank" rel="noopener" class="btn-outline cta-ext-pc">Chrome に追加（無料）</a>
      <a href="#setup" class="btn-outline cta-ext-mobile">PC で拡張を入れる（手順）</a>
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
      <a href="/support">サポート</a>
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

  // 宣伝のリンク（?from=tiktok など）の印を端末に覚えて URL から消すだけ（紹介ページでは送らない・数えるのは /app に入った時）
  useEffect(() => {
    noteFromParam();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // ── スクロールで要素をふわっと出現させる ──
    const targets = Array.from(
      root.querySelectorAll(
        '.step-card, .feat-row, .service-card, .forwho-card, .story-pull, .vs-card, .install-step, .faq-item'
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
