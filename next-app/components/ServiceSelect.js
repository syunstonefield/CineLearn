'use client';

import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { ALL_SERVICES, fetchAvailableServices } from '@/lib/tmdb';

// 既存 screen-service-select の再現。
export default function ServiceSelect() {
  const { drama, settings, chooseService, setScreen, updateSettings } = useApp();
  const [available, setAvailable] = useState(null); // null=確認中, Set=確認済み

  useEffect(() => {
    if (!drama) return;
    let cancelled = false;
    setAvailable(null);
    (async () => {
      const names = await fetchAvailableServices(drama);
      if (cancelled) return;
      setAvailable(names);
      // tmdbId / posterPath が解決されたら myDramas に反映（saveSettings 相当）
      const md = (settings.myDramas || []).map((d) =>
        d.title === drama.title ? { ...d, tmdbId: drama.tmdbId, posterPath: drama.posterPath || d.posterPath } : d
      );
      updateSettings({ myDramas: md });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drama]);

  if (!drama) return null;

  const selectedServices = settings.selectedServices || [];
  const selectedViewing = settings.selectedViewingService;

  const card = (svc, highlight) => {
    const isRegistered = selectedServices.includes(svc.name);
    const isSelected = svc.name === selectedViewing;
    const style = {};
    if (isSelected) {
      style.borderColor = 'var(--accent)';
      style.background = 'rgba(193,127,59,0.07)';
    } else if (highlight) {
      style.borderColor = 'rgba(52,199,89,0.5)';
    }
    if (!isRegistered) style.opacity = '0.35';

    const sub = isSelected ? (
      <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 3 }}>前回使用</div>
    ) : highlight ? (
      <div style={{ fontSize: 10, color: '#2da87c', marginTop: 3 }}>✓ 配信中</div>
    ) : !isRegistered ? (
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>未登録</div>
    ) : null;

    return (
      <div
        key={svc.name}
        className="viewing-service-card"
        style={style}
        onClick={() => chooseService(svc.name)}
      >
        <div className="vs-icon">{svc.icon}</div>
        <div className="vs-name">{svc.name}</div>
        {sub}
      </div>
    );
  };

  const confirmed = available ? ALL_SERVICES.filter((s) => available.has(s.name)) : [];
  const others = available ? ALL_SERVICES.filter((s) => !available.has(s.name)) : [];

  const innerGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 };

  return (
    <div className="screen active" id="screen-service-select">
      <div className="screen-inner">
        <div className="screen-header">
          <button className="btn-back" onClick={() => setScreen('main')}>
            ← マイドラマ
          </button>
          <div>
            <div className="screen-title">視聴サービスを選択</div>
            <div className="screen-desc">「{drama.title}」をどのサービスで視聴しますか？</div>
          </div>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.7 }}>
          サービスによって配信しているシーズン・話数が異なります。
          <br />
          今回視聴するサービスを選んでください。
        </p>

        <div id="viewingServiceGrid" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {available === null ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 12 }}>
              視聴サービスを確認中...
            </div>
          ) : confirmed.length > 0 ? (
            <>
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>✓ 配信確認済み</div>
                <div style={innerGridStyle}>{confirmed.map((s) => card(s, true))}</div>
              </div>
              {others.length > 0 && (
                <>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, width: '100%' }} />
                  <div style={{ width: '100%' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>その他のサービス</div>
                    <div style={innerGridStyle}>{others.map((s) => card(s, false))}</div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={innerGridStyle}>{ALL_SERVICES.map((s) => card(s, false))}</div>
          )}
        </div>
      </div>
    </div>
  );
}
