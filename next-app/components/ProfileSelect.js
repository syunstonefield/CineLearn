'use client';

import { useState } from 'react';
import { useApp } from './AppProvider';
import { loadProfiles } from '@/lib/storage';

// 既存 screen-0（だれが観ますか）の再現。
// 追加/削除は prompt()/confirm() だとモバイルで動かない（抑止される）ため、
// アプリ内モーダルに置き換える。クラウド復元はログイン導線を明示する。
export default function ProfileSelect() {
  const { mounted, selectProfile, addProfile, deleteProfile, openAuth, loggedIn } = useApp();
  const [tick, setTick] = useState(0); // 削除後の再描画トリガ
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [delTarget, setDelTarget] = useState(null);

  const profiles = mounted ? loadProfiles() : [];

  const submitAdd = () => {
    const n = name.trim();
    if (!n) return;
    setAddOpen(false);
    setName('');
    addProfile(n);
  };

  const confirmDelete = () => {
    if (!delTarget) return;
    deleteProfile(delTarget.id);
    setDelTarget(null);
    setTick((t) => t + 1);
  };

  return (
    <div className="screen active" id="screen-0">
      <div className="screen-inner center">
        <h1 className="welcome-title">だれが観ますか？</h1>
        <p className="welcome-sub">プロフィールを選んで学習を始めましょう。家族や用途ごとに分けられます。</p>
        <div className="profile-grid" id="profileGrid">
          {profiles.map((p) => (
            <div key={p.id} className="profile-card-wrap">
              {/* タップ対象はネイティブ button にする（iOS は div の click を取りこぼすことがある） */}
              <button type="button" className="profile-card" onClick={() => selectProfile(p.id)}>
                <span className="profile-avatar" style={{ background: p.color }}>
                  {p.name.charAt(0)}
                </span>
                <span className="profile-name">{p.name}</span>
              </button>
              <button
                type="button"
                className="profile-delete-btn"
                title="削除"
                onClick={(e) => {
                  e.stopPropagation();
                  setDelTarget(p);
                }}
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            className="profile-card profile-add-card"
            onClick={() => {
              setName('');
              setAddOpen(true);
            }}
          >
            <span className="profile-avatar profile-avatar-add">+</span>
            <span className="profile-name">追加</span>
          </button>
        </div>

        {/* 別端末からのクラウド復元（非ブロッキング・自動モーダルは廃止） */}
        {!loggedIn && (
          <button className="profile-login-link" onClick={openAuth}>
            別の端末で使っていた方 → ログインしてクラウドから復元
          </button>
        )}
      </div>

      {/* プロフィール追加（prompt の置き換え） */}
      {addOpen && (
        <div
          className="modal-overlay"
          style={{ display: 'flex' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
        >
          <div className="modal-panel" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <span className="modal-title">プロフィールを追加</span>
              <button className="modal-close" onClick={() => setAddOpen(false)}>
                ✕
              </button>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                className="auth-input"
                autoFocus
                placeholder="名前（例：しゅん、パパ）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
              />
              <button className="btn-primary" disabled={!name.trim()} onClick={submitAdd}>
                作成して始める
              </button>
            </div>
          </div>
        </div>
      )}

      {/* プロフィール削除（confirm の置き換え） */}
      {delTarget && (
        <div
          className="modal-overlay"
          style={{ display: 'flex' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDelTarget(null);
          }}
        >
          <div className="modal-panel" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <span className="modal-title">プロフィールを削除</span>
              <button className="modal-close" onClick={() => setDelTarget(null)}>
                ✕
              </button>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
                「{delTarget.name}」を削除しますか？
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-secondary" onClick={() => setDelTarget(null)}>
                  キャンセル
                </button>
                <button className="btn-primary" style={{ background: 'var(--red)' }} onClick={confirmDelete}>
                  削除する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
