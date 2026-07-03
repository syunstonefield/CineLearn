'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { getToeicLevel, getVocabCount } from '@/lib/vocab';
import { getThemePref, setThemePref } from '@/lib/theme';
import { enablePushSubscription } from '@/lib/push';

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
// 選択可能な対応サービス（YouTube は例文が付かず未対応→「近日対応予定」で別枠表示・選べない）。
const SERVICES = ['Netflix', 'Amazon Prime', 'Disney+'];

const TIERS = [
  { value: 'core', pill: 'tier-core', label: 'Core', name: '必須単語', desc: '目標レベルで頻出・必ず覚えるべき語' },
  { value: 'advanced', pill: 'tier-advanced', label: 'Advanced', name: '発展単語', desc: 'やや高度・専門的だが理解を深める語' },
  { value: 'context', pill: 'tier-context', label: 'Context', name: '文脈専門語', desc: 'ドラマ特有の専門語・低頻度語（除外推奨）' },
];

export default function SettingsScreen() {
  const { settings, updateSettings, closeSettings } = useApp();

  const toeicScore = settings.toeicScore || 0;
  const targetScore = settings.targetToeicScore || 0;
  const userLevel = settings.userLevel || 'B1';
  const targetLevel = settings.targetLevel || 'B1';
  const vocabCount = settings.vocabCount || 30;
  const services = settings.selectedServices || [];
  const tiers = settings.testTiers || ['core', 'advanced'];

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
      // 入力途中・無効値：settings にはまだ反映しない（テキストは保持）
      if (toeicScore) updateSettings({ toeicScore: 0, userLevel: 'B1' });
      return;
    }
    updateSettings({ toeicScore: n, userLevel: getToeicLevel(n) });
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

  const save = () => {
    if (!toeicScore) {
      alert('TOEICスコアを入力してください（目安でOKです）');
      return;
    }
    if (!services.length) {
      alert('利用サービスを1つ以上選択してください');
      return;
    }
    closeSettings();
  };

  // 復習リマインダー：通知許可 → SW購読 → サーバー保存（lib/push.js）。
  const enableNotify = async () => {
    setNotifyBtn('設定中...');
    const r = await enablePushSubscription();
    if (r.ok) {
      setNotifyBtn('✅ 通知は有効です');
      setNotifyMsg('復習日の朝7時にお知らせします 🎬');
      return;
    }
    setNotifyBtn(null);
    if (r.reason === 'unsupported') setNotifyMsg('このブラウザは通知非対応です');
    else if (r.reason === 'not_logged_in') setNotifyMsg('通知を使うにはログインしてください');
    else if (r.reason === 'denied') setNotifyMsg('ブラウザの設定から通知を許可してください');
    else setNotifyMsg('通知の設定に失敗しました');
  };

  const showLevel = toeicScore >= 10;

  return (
    <div className="screen active" id="screen-settings">
      <div className="settings-screen">
        <div className="settings-head">
          <h1 className="settings-h1">⚙️ 設定</h1>
        </div>
        <div className="settings-body">
          {/* 英語レベル */}
          <div className="settings-section">
            <div className="settings-section-title">📊 英語レベル</div>
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

          {/* 利用サービス */}
          <div className="settings-section">
            <div className="settings-section-title">
              📺 利用サービス <span className="settings-required">（必須）</span>
            </div>
            <div className="service-grid">
              {SERVICES.map((name) => (
                <div
                  key={name}
                  className={'service-card' + (services.includes(name) ? ' selected' : '')}
                  onClick={() => toggleService(name)}
                >
                  <div className="service-name">{name}</div>
                  <div className="service-check">✓</div>
                </div>
              ))}
              {/* YouTube は近日対応予定（例文が付かないため今は未対応・選択不可） */}
              <div className="service-card" style={{ opacity: 0.5, cursor: 'default' }}>
                <div className="service-name">YouTube</div>
                <div className="service-check" style={{ fontSize: 11 }}>近日対応予定</div>
              </div>
            </div>
          </div>

          {/* 外観（テーマ） */}
          <div className="settings-section">
            <div className="settings-section-title">🎨 外観（テーマ）</div>
            <div className="theme-seg">
              {[
                { v: 'light', label: '☀️ ライト' },
                { v: 'dark', label: '🌙 ダーク' },
                { v: 'system', label: '🖥 自動' },
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

          {/* 単語階層 */}
          <div className="settings-section">
            <div className="settings-section-title">📚 テストに含める単語階層</div>
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

          {/* 復習リマインダー */}
          <div className="settings-section">
            <div className="settings-section-title">🔔 復習リマインダー</div>
            <div className="push-notify-desc" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
              復習日になったら朝7時に通知が届きます。
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
              ⚠️ スマホとPCで<strong>それぞれ個別に</strong>設定が必要です。
              <br />
              iPhoneの場合はホーム画面に追加してから設定してください。
            </div>
            <button
              className="btn-secondary"
              style={{ width: '100%' }}
              disabled={notifyBtn === '設定中...' || notifyBtn === '✅ 通知は有効です'}
              onClick={enableNotify}
            >
              {notifyBtn || '🔔 このデバイスで通知を有効にする'}
            </button>
            {notifyMsg && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
                {notifyMsg}
              </div>
            )}
          </div>

          <button className="btn-primary" style={{ marginTop: 8, width: '100%' }} onClick={save}>
            設定を保存して戻る
          </button>

          {/* クレジット / Credits（TMDB の帰属表示は API 規約上の必須要件） */}
          <div
            className="settings-section"
            style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}
          >
            <div className="settings-section-title">ℹ️ クレジット</div>
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
              を利用しています。
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, margin: '8px 0 0' }}>
              CineLearn は Netflix・Amazon と提携・公認関係にありません。
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
        </div>
      </div>
    </div>
  );
}
