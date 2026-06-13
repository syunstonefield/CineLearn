'use client';

import { useState } from 'react';
import { useApp } from './AppProvider';
import { getToeicLevel, getVocabCount } from '@/lib/vocab';

// 既存 settingsModal の再現（英語レベル / 利用サービス / 単語階層 / 復習リマインダー）。
const LEVEL_LABELS = { A2: 'A2（初級）', B1: 'B1（中級）', B2: 'B2（中上級）', C1: 'C1（上級）' };

const TOEIC_ROWS = [
  { score: 300, range: '〜 400点', level: 'A2', name: 'A2 初級', desc: '基本的な表現は理解できる' },
  { score: 550, range: '400〜 600点', level: 'B1', name: 'B1 中級', desc: '日常会話は概ね理解できる' },
  { score: 750, range: '600〜 800点', level: 'B2', name: 'B2 中上級', desc: '複雑な内容も理解できる' },
  { score: 900, range: '800点〜', level: 'C1', name: 'C1 上級', desc: '幅広いトピックを理解できる' },
];

const SERVICES = ['Netflix', 'Amazon Prime', 'Disney+', 'Apple TV+', 'Hulu', 'U-NEXT', 'YouTube'];

const TIERS = [
  { value: 'core', pill: 'tier-core', label: 'Core', name: '必須単語', desc: '目標レベルで頻出・必ず覚えるべき語' },
  { value: 'advanced', pill: 'tier-advanced', label: 'Advanced', name: '発展単語', desc: 'やや高度・専門的だが理解を深める語' },
  { value: 'context', pill: 'tier-context', label: 'Context', name: '文脈専門語', desc: 'ドラマ特有の専門語・低頻度語（除外推奨）' },
];

export default function SettingsModal({ onClose }) {
  const { settings, updateSettings } = useApp();

  const toeicScore = settings.toeicScore || 0;
  const targetScore = settings.targetToeicScore || 0;
  const userLevel = settings.userLevel || 'B1';
  const targetLevel = settings.targetLevel || 'B1';
  const vocabCount = settings.vocabCount || 30;
  const services = settings.selectedServices || [];
  const tiers = settings.testTiers || ['core', 'advanced'];

  const [notifyMsg, setNotifyMsg] = useState('');
  const [notifyBtn, setNotifyBtn] = useState(null); // null=通常, それ以外はラベル上書き
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
    onClose();
  };

  // 復習リマインダー：ブラウザの通知許可をリクエスト（プッシュ購読は
  // Service Worker + ログインが必要なため、試作では許可取得＋案内のみ）
  const enableNotify = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifyMsg('このブラウザは通知非対応です');
      return;
    }
    setNotifyBtn('設定中...');
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setNotifyBtn('✅ 通知は有効です');
        setNotifyMsg('毎朝8時に復習日をお知らせします 🎬（リマインダー配信は本番アプリで有効）');
      } else {
        setNotifyBtn(null);
        setNotifyMsg('ブラウザの設定から通知を許可してください');
      }
    } catch {
      setNotifyBtn(null);
      setNotifyMsg('通知の設定に失敗しました');
    }
  };

  const overlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const showLevel = toeicScore >= 10;

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={overlayClick}>
      <div className="modal-panel modal-panel-wide">
        <div className="modal-header">
          <span className="modal-title">⚙️ 設定</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
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
              復習日になったら毎朝8時に通知が届きます。
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
            設定を保存して始める
          </button>
        </div>
      </div>
    </div>
  );
}
