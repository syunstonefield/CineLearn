'use client';

import { AutoplaySettingRow } from './AutoplaySwitch';
import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { getToeicLevel, getVocabCount } from '@/lib/vocab';
import { getThemePref, setThemePref } from '@/lib/theme';
import { enablePushSubscription } from '@/lib/push';
import { NON_AFFILIATION } from '@/lib/legal';
import { loadHistory, loadSrs } from '@/lib/storage';
import { getActiveWords } from '@/lib/words';
import {
  collectExportRows,
  toCsv,
  toAnkiTsv,
  ankiRows,
  exportFileName,
  downloadText,
} from '@/lib/export';
import { usePlan, featureAccess } from '@/lib/plan';
import { REVIEW_COUNT_OPTIONS, reviewCountLabel, normalizeReviewCount, DAILY_REVIEW_CAP } from '@/lib/reviewCount';
import { NEW_WORDS_DAILY_FREE } from '@/lib/storage';
import PlusNote from './PlusNote';
import { IconWarning, IconCheck } from './icons/LineIcons';
import { getSession } from '@/lib/supabase';

// 予習カードで最初に見せる語数の選択肢（0＝全部）。
const PREP_CORE_OPTIONS = [15, 30, 0];
const prepCoreLabel = (v) => (v === 0 ? '全部' : `${v}語`);
import { usageOptedOut, setUsageOptOut } from '@/lib/usage';

// 設定（英語レベル / 利用サービス / テーマ / 単語階層 / 復習リマインダー）。
// 旧 SettingsModal をモーダル→screen='settings' のページに置き換え。
const LEVEL_LABELS = { A2: 'A2（初級）', B1: 'B1（中級）', B2: 'B2（中上級）', C1: 'C1（上級）' };

const TOEIC_ROWS = [
  { score: 300, range: '〜 400点', level: 'A2', name: 'A2 初級', desc: '基本的な表現は理解できる' },
  { score: 550, range: '400〜 600点', level: 'B1', name: 'B1 中級', desc: '日常会話は概ね理解できる' },
  { score: 750, range: '600〜 800点', level: 'B2', name: 'B2 中上級', desc: '複雑な内容も理解できる' },
  { score: 900, range: '800点〜', level: 'C1', name: 'C1 上級', desc: '幅広いトピックを理解できる' },
];

// 拡張の動作実態に合わせ Apple TV+/Hulu/U-NEXT は一旦UIから外す（2026-06-25・厳選）。
// 選択可能な対応サービス（YouTube は対応予定から外したためカードごと撤去・2026-09-12）。
const SERVICES = ['Netflix', 'Amazon Prime', 'Disney+'];

const TIERS = [
  { value: 'core', pill: 'tier-core', label: 'Core', name: '必須単語', desc: '目標レベルで頻出・必ず覚えるべき語' },
  { value: 'advanced', pill: 'tier-advanced', label: 'Advanced', name: '発展単語', desc: 'やや高度・専門的だが理解を深める語' },
  { value: 'context', pill: 'tier-context', label: 'Context', name: '文脈専門語', desc: 'ドラマ特有の専門語・低頻度語（除外推奨）' },
];

export default function SettingsScreen() {
  const { settings, updateSettings, closeSettings, profile, loggedIn, signOut, openAuth } = useApp();
  // ログイン中のメールアドレス（この端末のセッションから・表示だけ）
  const [accountEmail, setAccountEmail] = useState('');
  useEffect(() => {
    setAccountEmail(loggedIn ? getSession()?.user?.email || '' : '');
  }, [loggedIn]);
  const plan = usePlan(loggedIn);
  // 利用統計を送るか（端末の localStorage・描画後に読む＝SSR と食い違わない）
  const [usageOn, setUsageOn] = useState(true);
  useEffect(() => setUsageOn(!usageOptedOut()), []);

  const toeicScore = settings.toeicScore || 0;
  const targetScore = settings.targetToeicScore || 0;
  const userLevel = settings.userLevel || 'B1';
  const targetLevel = settings.targetLevel || 'B1';
  const vocabCount = settings.vocabCount || 30;
  const services = settings.selectedServices || [];
  const tiers = settings.testTiers || ['core', 'advanced'];
  // 単語リストで「追加した単語」を本編の語と混ぜて📍時刻順に並べるか（既定=混ぜる）。
  // オフなら従来どおり「✏️ 追加した単語」セクションとして末尾にまとめる。
  const mergeAdded = settings.mergeAddedWords !== false;
  // 予習カードで最初に見せる語数（15/30/全部=0）。未設定は15。残りは「残りも見る」で任意。
  const prepCore = PREP_CORE_OPTIONS.includes(settings.prepCoreCount) ? settings.prepCoreCount : 15;
  // 毎日の復習の語数（今日の復習にだけ効く・正式版ではプラス）。未設定は20。
  const reviewCount = normalizeReviewCount(settings.dailyReviewCount);
  const reviewCountAccess = featureAccess('reviewCount', plan);

  const [notifyMsg, setNotifyMsg] = useState('');
  const [notifyBtn, setNotifyBtn] = useState(null); // null=通常, それ以外はラベル上書き
  // テーマ（ライト/ダーク/システム）。SSR一致のため初期は 'system'、マウント後に実値へ。
  const [theme, setTheme] = useState('system');
  useEffect(() => setTheme(getThemePref()), []);
  const pickTheme = (t) => {
    setTheme(t);
    setThemePref(t);
  };
  // 入力中の文字列はローカルで保持（settings に直接バインドすると "6" のような
  // 途中の無効値で 0 にリセットされ、複数桁が打てなくなるため）。
  const [toeicText, setToeicText] = useState(toeicScore ? String(toeicScore) : '');
  const [targetText, setTargetText] = useState(targetScore ? String(targetScore) : '');

  const onToeicInput = (val) => {
    setToeicText(val);
    const n = parseInt(val);
    if (!n || n < 10 || n > 990) {
      // 入力途中・無効値：settings にはまだ反映しない（テキストは保持）。
      // 2026-11-13 保存ボタン廃止に合わせ、消しても 0 に戻さない＝直前の点のまま（離れたら欄も戻す・onToeicBlur）。
      return;
    }
    updateSettings({ toeicScore: n, userLevel: getToeicLevel(n) });
  };
  // 欄から離れた時、無効な文字（空・範囲外）なら保存済みの点に戻す（未入力のまま戻る＝0 の人はそのまま空）
  const onToeicBlur = () => {
    const n = parseInt(toeicText);
    if (!n || n < 10 || n > 990) setToeicText(toeicScore ? String(toeicScore) : '');
  };

  const setToeic = (score) => {
    setToeicText(String(score));
    updateSettings({ toeicScore: score, userLevel: getToeicLevel(score) });
  };

  const onTargetInput = (val) => {
    setTargetText(val);
    const n = parseInt(val);
    if (!n || n < 10 || n > 990) {
      if (targetScore) updateSettings({ targetToeicScore: 0, targetLevel: userLevel, vocabCount: 30 });
      return;
    }
    updateSettings({ targetToeicScore: n, targetLevel: getToeicLevel(n), vocabCount: getVocabCount(n) });
  };

  const toggleService = (name) => {
    const next = services.includes(name) ? services.filter((s) => s !== name) : [...services, name];
    updateSettings({ selectedServices: next });
  };

  const toggleTier = (value) => {
    let next = tiers.includes(value) ? tiers.filter((t) => t !== value) : [...tiers, value];
    if (next.length === 0) next = [value]; // 最低1つ必須
    updateSettings({ testTiers: next });
  };


  // 復習リマインダー：通知許可 → SW購読 → サーバー保存（lib/push.js）。
  const enableNotify = async () => {
    setNotifyBtn('設定中...');
    const r = await enablePushSubscription();
    if (r.ok) {
      setNotifyBtn('通知は有効です');
      setNotifyMsg('朝7時（復習する語がある日）と夕方17:30にお知らせします');
      return;
    }
    setNotifyBtn(null);
    if (r.reason === 'unsupported') setNotifyMsg('このブラウザは通知非対応です');
    else if (r.reason === 'not_logged_in') setNotifyMsg('通知を使うにはログインしてください');
    else if (r.reason === 'denied') setNotifyMsg('ブラウザの設定から通知を許可してください');
    else setNotifyMsg('通知の設定に失敗しました');
  };

  // 単語の書き出し（無料・端末内のデータだけで作る＝送信なし）。lib/export.js
  const [exportMsg, setExportMsg] = useState('');
  const runExport = async (kind) => {
    try {
      const myWords = await getActiveWords(profile?.id).catch(() => []);
      const rows = collectExportRows({
        history: loadHistory(),
        srs: loadSrs(),
        myWords: myWords || [],
      });
      if (!rows.length) {
        setExportMsg('書き出せる単語がまだありません');
        return;
      }
      if (kind === 'anki') {
        const n = ankiRows(rows).length;
        if (!n) {
          setExportMsg('意味のある単語がまだありません（CSV では書き出せます）');
          return;
        }
        downloadText(toAnkiTsv(rows), exportFileName('txt'), 'text/plain');
        const skipped = rows.length - n;
        setExportMsg(skipped ? `${n}語を書き出しました（意味が未取得の${skipped}語は Anki 用から外しました・CSV には含まれます）` : `${n}語を書き出しました`);
      } else {
        downloadText(toCsv(rows), exportFileName('csv'), 'text/csv');
        setExportMsg(`${rows.length}語を書き出しました`);
      }
    } catch {
      setExportMsg('書き出しに失敗しました');
    }
  };

  const showLevel = toeicScore >= 10;

  return (
    <div className="screen active" id="screen-settings">
      <div className="settings-screen">
        <div className="settings-head">
          <button type="button" className="btn-back" onClick={closeSettings}>
            ← 戻る
          </button>
          <h1 className="settings-h1">設定</h1>
        </div>
        <div className="settings-body">
          <section className="settings-group">
            <h2 className="settings-group-title">学習のレベル</h2>
            {/* 英語レベル */}
            <div className="settings-section">
              <div className="settings-section-title">英語レベル</div>
              <div className="toeic-wrap">
                <div className="toeic-input-row">
                  <input
                    type="number"
                    className="toeic-input"
                    placeholder="例：650"
                    min="10"
                    max="990"
                    value={toeicText}
                    onChange={(e) => onToeicInput(e.target.value)}
                  onBlur={onToeicBlur}
                  />
                  <span className="toeic-unit">点</span>
                </div>
                <div className="toeic-hint">TOEICを受けたことがない場合は目安で入力してください</div>
                <div className="toeic-levels">
                  {TOEIC_ROWS.map((r) => (
                    <div key={r.score} className="toeic-level-row" onClick={() => setToeic(r.score)}>
                      <div className="toeic-range">{r.range}</div>
                      <div className="toeic-level-info">
                        <span className={`level-pill level-${r.level}`}>{r.name}</span>
                        <span className="toeic-level-desc">{r.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {showLevel && (
                  <div className="level-result" style={{ display: 'flex' }}>
                    <span className="level-result-label">判定レベル：</span>
                    <span className={`level-result-value level-pill level-${userLevel}`}>
                      {LEVEL_LABELS[userLevel]}
                    </span>
                  </div>
                )}
                {showLevel && (
                  <div className="target-wrap" style={{ display: 'block' }}>
                    <div className="target-label">
                      目標TOEICスコア <span className="target-optional">（任意）</span>
                    </div>
                    <div className="toeic-input-row">
                      <input
                        type="number"
                        className="toeic-input"
                        placeholder="例：730"
                        min="10"
                        max="990"
                        value={targetText}
                        onChange={(e) => onTargetInput(e.target.value)}
                      />
                      <span className="toeic-unit">点（目標）</span>
                    </div>
                    <div className="vocab-count-hint">
                      {targetScore > 0
                        ? `目標 ${LEVEL_LABELS[targetLevel]}（${targetScore}点）→ 単語${vocabCount}個を生成します`
                        : '未入力の場合：単語30個を生成します'}
                    </div>
                  </div>
                )}
              </div>
            </div>

          </section>
          <section className="settings-group">
            <h2 className="settings-group-title">単語を学ぶ・復習</h2>
            {/* 音声の自動再生（オン／オフ・初期はオフ・2026-11-13 オーナー決定）。カードの画面の隅のスイッチと同じ1つの値（lib/cardAutoplay.js）。プロフィールの設定＝同期する */}
            <div className="settings-section">
              <div className="settings-section-title">音声の自動再生</div>
              <div className="tier-toggle-list">
                <AutoplaySettingRow />
              </div>
            </div>
            {/* 「単語を学ぶ」のカードの枚数（無料・端末設定・lib/cardDeck.js）。その端末で初めては5枚・2回目からこの枚数（2026-11-12 言葉を「単語を学ぶ」にそろえた）。 */}
            <div className="settings-section">
              <div className="settings-section-title">「単語を学ぶ」のカードの枚数</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.7 }}>
                「単語を学ぶ」で1回に答えるカードの枚数です。重要な語から並びます。その端末で初めての時は5枚から始まり、2回目からこの枚数になります。残りは、終わりの画面の「残りの単語も見る」から続けられます。
              </div>
              <div className="rc-options" role="radiogroup" aria-label="「単語を学ぶ」のカードの枚数">
                {PREP_CORE_OPTIONS.map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={prepCore === v}
                    className={'rc-option' + (prepCore === v ? ' is-on' : '')}
                    onClick={() => updateSettings({ prepCoreCount: v })}
                  >
                    {prepCoreLabel(v)}
                  </button>
                ))}
              </div>
            </div>

            {/* 1回の復習の語数（lib/reviewCount.js・2026-10-08 無料に。1日の上限ではなく1回の量＝何回でも続けられる）。正式版の無料の人には選択肢の代わりに説明文（ぼかし禁止） */}
            <div className="settings-section">
              <div className="settings-section-title">1回の復習の語数</div>
              {reviewCountAccess.locked ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  今日の復習は1回{DAILY_REVIEW_CAP}語です。語数の変更（10／20／30／50／全部）はプラスの機能です。
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.7 }}>
                    「今日の復習」を1回はじめたときに出す語数です。終わったあとも、続けて次の回をはじめられます。出せる語が少ないときは、その数だけ出します。
                  </div>
                  <div className="rc-options" role="radiogroup" aria-label="1回の復習の語数">
                    {REVIEW_COUNT_OPTIONS.map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        role="radio"
                        aria-checked={reviewCount === v}
                        className={'rc-option' + (reviewCount === v ? ' is-on' : '')}
                        onClick={() => updateSettings({ dailyReviewCount: v })}
                      >
                        {reviewCountLabel(v)}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.7 }}>
                    まだ一度も復習していない語を、1日に何語でも復習に回せます（無料は1日{NEW_WORDS_DAILY_FREE}語まで。期日の来た語はいつでも復習できます）。{' '}
                    <PlusNote feature="newWordsDaily" plan={plan} short />
                  </div>
                  {reviewCountAccess.betaNote && (
                    <div style={{ marginTop: 8 }}>
                      <PlusNote feature="reviewCount" plan={plan} />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 10語ごとのひと区切り（復習・クイズ部門・オーナー決定 2026-11-12）。プロフィールの設定＝1回の復習の語数と同じく同期する。既定は入 */}
            <div className="settings-section">
              <div className="settings-section-title">復習のひと区切り</div>
              <div className="tier-toggle-list">
                <label className="tier-toggle-row">
                  <div className="tier-toggle-left">
                    <div>
                      <div className="tier-toggle-name">10語ごとにひと区切りを出す</div>
                      <div className="tier-toggle-desc">
                        復習の途中、10語答えるごとに「続ける」か「ここまでにする」かを選べる画面を出します。答えた分はいつでも記録されています。
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="tier-checkbox"
                    checked={settings.reviewBreak !== false}
                    onChange={() => updateSettings({ reviewBreak: settings.reviewBreak === false })}
                  />
                </label>
              </div>
            </div>

            {/* 単語階層 */}
            <div className="settings-section">
              <div className="settings-section-title">クイズに出す語</div>
              <div className="tier-toggle-list">
                {TIERS.map((t) => (
                  <label key={t.value} className="tier-toggle-row">
                    <div className="tier-toggle-left">
                      <span className={`tier-pill ${t.pill}`}>{t.label}</span>
                      <div>
                        <div className="tier-toggle-name">{t.name}</div>
                        <div className="tier-toggle-desc">{t.desc}</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      className="tier-checkbox"
                      checked={tiers.includes(t.value)}
                      onChange={() => toggleTier(t.value)}
                    />
                  </label>
                ))}
              </div>
            </div>

          </section>
          <section className="settings-group">
            <h2 className="settings-group-title">単語リスト・作品</h2>
            {/* 単語リストの並び（追加した語の扱い）*/}
            <div className="settings-section">
              <div className="settings-section-title">単語リストの並び</div>
              <div className="tier-toggle-list">
                <label className="tier-toggle-row">
                  <div className="tier-toggle-left">
                    <div>
                      <div className="tier-toggle-name">追加した単語も時刻順にまぜる</div>
                      <div className="tier-toggle-desc">
                        オフにすると、追加した単語はリストの最後にまとめて表示されます
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="tier-checkbox"
                    checked={mergeAdded}
                    onChange={() => updateSettings({ mergeAddedWords: !mergeAdded })}
                  />
                </label>
              </div>
            </div>

            {/* 利用サービス */}
            <div className="settings-section">
              <div className="settings-section-title">
                契約しているサービス <span className="target-optional">（任意）</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.7 }}>
                作品を観に行くときのサービスの一覧で、選んだサービスを上のほうに並べます。選ばなくても、すべてのサービスから選べます。
              </div>
              <div className="service-grid">
                {SERVICES.map((name) => (
                  <div
                    key={name}
                    className={'service-card' + (services.includes(name) ? ' selected' : '')}
                    onClick={() => toggleService(name)}
                  >
                    <div className="service-name">{name}</div>
                    <div className="service-check">
                      <IconCheck />
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </section>
          <section className="settings-group">
            <h2 className="settings-group-title">通知と表示</h2>
            {/* 復習リマインダー */}
            <div className="settings-section">
              <div className="settings-section-title">復習の通知</div>
              <div className="push-notify-desc" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
                朝7時（復習する語がある日）と夕方17:30に、この端末へ通知が届きます。
              </div>
              <div
                style={{
                  fontSize: 12,
                  background: 'rgba(255,149,0,0.1)',
                  color: 'var(--accent)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 10,
                  lineHeight: 1.6,
                }}
              >
                <IconWarning /> スマホとPCで<strong>それぞれ個別に</strong>設定が必要です。
                <br />
                iPhoneの場合はホーム画面に追加してから設定してください。
              </div>
              <button
                className="btn-secondary"
                style={{ width: '100%' }}
                disabled={notifyBtn === '設定中...' || notifyBtn === '通知は有効です'}
                onClick={enableNotify}
              >
                {notifyBtn || 'この端末で通知を受け取る'}
              </button>
              {notifyMsg && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
                  {notifyMsg}
                </div>
              )}
            </div>

            {/* 外観（テーマ） */}
            <div className="settings-section">
              <div className="settings-section-title">外観</div>
              <div className="theme-seg">
                {[
                  { v: 'light', label: 'ライト' },
                  { v: 'dark', label: 'ダーク' },
                  { v: 'system', label: '自動' },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={'theme-seg-btn' + (theme === o.v ? ' active' : '')}
                    onClick={() => pickTheme(o.v)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

          </section>
          <section className="settings-group">
            <h2 className="settings-group-title">データとアカウント</h2>
            {/* 単語の書き出し（無料・永久＝docs/decision-pricing-2026-10-08.md）。例文は含めない（オーナー決定 2026-10-08・無料/有料とも同じ）。 */}
            <div className="settings-section">
              <div className="settings-section-title">単語の書き出し</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
                単語・意味・品詞・出会った場面（作品と話）・復習の記録を、表計算（CSV）や Anki に取り込める形で保存します。
                この端末にあるデータから作ります。例文（字幕のセリフ）は含めません。例文はアプリの中でいつでも見られます。
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => runExport('csv')}>
                  CSV で保存
                </button>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => runExport('anki')}>
                  Anki 用で保存
                </button>
              </div>
              {exportMsg && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
                  {exportMsg}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
                Anki 用は「ファイル → 読み込む」で取り込めます（表＝単語・裏＝意味と出会った場面）。
                書き出したファイルはご自身の学習用です。ほかの人への配布はしないでください。
              </div>
            </div>

            {/* 利用統計（lib/usage.js・2026-10-09）。この端末だけの設定。オフの間はためるのも送るのも止める */}
            <div className="settings-section">
              <div className="settings-section-title">利用統計</div>
              <div className="tier-toggle-list">
                <label className="tier-toggle-row">
                  <div className="tier-toggle-left">
                    <div>
                      <div className="tier-toggle-name">利用統計を送る</div>
                      <div className="tier-toggle-desc">
                        機能の使われ方・どこから開いたか・登録やログインの状況・初回の体験・アンケートと予習・復習の進み方・復習した語数と答えの内訳・1枚あたりの時間の目安を、アカウントを元に戻せない番号に変えて集計し、機能と料金の検討に使います（作品名・単語は送りません。
                        <a href="/privacy" target="_blank" rel="noopener noreferrer">
                          プライバシーポリシー
                        </a>
                        ）。この端末だけの設定です。
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="tier-checkbox"
                    checked={usageOn}
                    onChange={() => {
                      setUsageOptOut(usageOn);
                      setUsageOn(!usageOn);
                    }}
                  />
                </label>
              </div>
            </div>

            {/* プラン（isPro の土台・lib/plan.js）。ベータ中は全員使える＋プラスの印の意味だけ伝える */}
            <div className="settings-section">
              <div className="settings-section-title">プラン</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                {plan.beta ? (
                  <>
                    ベータ版のあいだは、すべての機能をどなたでもお使いいただけます。
                    <br />
                    正式版でプラスになる機能には <PlusNote feature="workReview" plan={plan} /> の印が付きます。
                  </>
                ) : plan.isPro ? (
                  'プラスをご利用中です。'
                ) : (
                  '無料プランをご利用中です。'
                )}
              </div>
            </div>

            {/* あゆみのうちプラスの部品（3重の円・段階・推移）。正式版の無料の人に、何がプラスかだけ伝える（ぼかし・急かしなし）。学習した日は無料（2026-11-12） */}
            {featureAccess('ring', plan).locked && (
              <div className="settings-section">
                <div className="settings-section-title">あゆみ</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  あゆみのうち、3重の円・段階ごとの覚えた語・週ごとの推移はプラスの機能です。学習した日は、どなたでもホームとあゆみで見られます。覚えた語・マスターの数は、ホームでいつでも見られます。
                </div>
              </div>
            )}

            {/* アカウント（2026-11-13 設定の作り替えで足した。ログアウトは上の帯のアイコンと同じ signOut＝確認つき） */}
            <div className="settings-section">
              <div className="settings-section-title">アカウント</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.7 }}>
                {loggedIn
                  ? `ログイン中です${accountEmail ? `（${accountEmail}）` : ''}。単語と学習の記録は、スマホ・PC・拡張機能で同期されます。`
                  : 'ログインしていません。ログインすると、単語と学習の記録がスマホ・PC・拡張機能で同期されます。'}
              </div>
              {loggedIn ? (
                <button className="btn-secondary" style={{ width: '100%' }} onClick={signOut}>
                  ログアウト
                </button>
              ) : (
                <button className="btn-secondary" style={{ width: '100%' }} onClick={() => openAuth()}>
                  ログイン・新規登録
                </button>
              )}
            </div>
          </section>
          <section className="settings-group">
            <h2 className="settings-group-title">このアプリについて</h2>
            {/* クレジット / Credits（TMDB の帰属表示は API 規約上の必須要件） */}
              <div className="settings-section">
              <div className="settings-section-title">クレジット</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <a
                  href="https://www.themoviedb.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ flexShrink: 0 }}
                >
                  <img src="/tmdb-logo.svg" alt="TMDB" width={72} style={{ display: 'block' }} />
                </a>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                  This product uses the TMDB API but is not endorsed or certified by TMDB.
                </p>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
                作品情報・画像は{' '}
                <a
                  href="https://www.themoviedb.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  TMDB
                </a>{' '}
                、字幕データは{' '}
                <a
                  href="https://www.opensubtitles.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  OpenSubtitles
                </a>{' '}
                を利用しています。視聴サービスの配信状況は{' '}
                <a
                  href="https://www.justwatch.com/jp"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  JustWatch
                </a>{' '}
                のデータ（TMDB 経由）です。
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, margin: '8px 0 0' }}>
                CineLearn は現在ベータ版として無料で提供しています。正式版では一部機能が有料になる場合がありますが、
                保存した単語帳と学習記録はそのまま残ります。
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, margin: '8px 0 0' }}>
                {/* 非提携文は lib/legal.js の単一ソース（PP・Terms・LP と同文） */}
                {NON_AFFILIATION}
                <br />
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  利用規約
                </a>
                {' ・ '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  プライバシーポリシー
                </a>
                {' ・ '}
                <a href="mailto:cinelearn.202606@gmail.com" style={{ color: 'var(--accent)' }}>
                  お問い合わせ・削除依頼
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
