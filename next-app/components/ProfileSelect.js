'use client';

import { useState } from 'react';
import { useApp } from './AppProvider';
import { loadProfiles } from '@/lib/storage';

// 既存 screen-0（だれが観ますか）の再現。
export default function ProfileSelect() {
  const { mounted, selectProfile, addProfile, deleteProfile } = useApp();
  const [tick, setTick] = useState(0); // 削除後の再描画トリガ

  const profiles = mounted ? loadProfiles() : [];

  const onDelete = (p) => {
    if (!confirm(`「${p.name}」を削除しますか？`)) return;
    deleteProfile(p.id);
    setTick((t) => t + 1);
  };

  const onAdd = () => {
    const name = prompt('プロフィール名を入力してください（例：しゅん、パパ）');
    if (name?.trim()) addProfile(name);
  };

  return (
    <div className="screen active" id="screen-0">
      <div className="screen-inner center">
        <h1 className="welcome-title">だれが観ますか？</h1>
        <div className="profile-grid" id="profileGrid">
          {profiles.map((p) => (
            <div key={p.id} className="profile-card" onClick={() => selectProfile(p.id)}>
              <div className="profile-avatar" style={{ background: p.color }}>
                {p.name.charAt(0)}
              </div>
              <div className="profile-name">{p.name}</div>
              <button
                className="profile-delete-btn"
                title="削除"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p);
                }}
              >
                ✕
              </button>
            </div>
          ))}

          <div className="profile-card profile-add-card" onClick={onAdd}>
            <div className="profile-avatar profile-avatar-add">+</div>
            <div className="profile-name">追加</div>
          </div>
        </div>
      </div>
    </div>
  );
}
