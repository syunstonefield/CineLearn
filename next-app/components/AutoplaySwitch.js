'use client';

// カードの音声の自動再生のスイッチ（2026-11-13 オーナー決定・共通の部品）。
//   AutoplaySwitch    … カードの画面の隅に置く小さなボタン（スピーカーの線の絵・押すたびにオン／オフ）
//   AutoplaySettingRow … 設定の画面の行（ほかのオン／オフの設定と同じ形）
//   どちらも同じ1つの値（lib/cardAutoplay.js・settings.cardAutoplay）を読み書きする。初期はオフ。
import { useApp } from './AppProvider';
import { isCardAutoplayOn, cardAutoplayPatch } from '@/lib/cardAutoplay';
import { IconSpeaker, IconSpeakerOff } from './icons/LineIcons';

export function AutoplaySwitch({ className = '' }) {
  const { settings, updateSettings } = useApp();
  const on = isCardAutoplayOn(settings);
  return (
    <button
      type="button"
      className={'autoplay-switch' + (on ? ' is-on' : '') + (className ? ' ' + className : '')}
      aria-pressed={on}
      aria-label={on ? '音声の自動再生：オン（押すとオフ）' : '音声の自動再生：オフ（押すとオン）'}
      title={on ? '音声の自動再生：オン' : '音声の自動再生：オフ'}
      onClick={(e) => {
        e.stopPropagation();
        updateSettings(cardAutoplayPatch(!on));
      }}
    >
      {on ? <IconSpeaker /> : <IconSpeakerOff />}
      <span className="autoplay-switch-label">{on ? '自動' : 'オフ'}</span>
    </button>
  );
}

export function AutoplaySettingRow() {
  const { settings, updateSettings } = useApp();
  const on = isCardAutoplayOn(settings);
  return (
    <label className="tier-toggle-row">
      <div className="tier-toggle-left">
        <div>
          <div className="tier-toggle-name">カードの音声を自動で流す</div>
          <div className="tier-toggle-desc">
            カードが出た時に、その単語の発音を1回流します。カードの画面の右上のスピーカーからも切り替えられます。
          </div>
        </div>
      </div>
      <input
        type="checkbox"
        className="tier-checkbox"
        checked={on}
        onChange={() => updateSettings(cardAutoplayPatch(!on))}
      />
    </label>
  );
}
