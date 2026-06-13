'use client';

import { useMemo } from 'react';
import { useApp } from './AppProvider';
import RecommendGrid from './RecommendGrid';
import { getRecommendations } from '@/lib/recommended';

// 履歴がある場合の「おすすめから探す」独立画面（screen-recommend）。
// 空ダッシュボードのインライン表示と同じ RecommendGrid を、専用画面として表示する。
export default function RecommendScreen() {
  const { settings, setScreen, startFromRecommend } = useApp();

  const items = useMemo(
    () => getRecommendations(settings.userLevel || 'B1', settings.selectedServices || []),
    [settings.userLevel, settings.selectedServices]
  );

  return (
    <div className="screen active" id="screen-recommend">
      <div className="screen-inner">
        <div className="screen-header">
          <button className="btn-back" onClick={() => setScreen('main')}>
            ← マイドラマ
          </button>
          <div>
            <div className="screen-title">おすすめから探す</div>
            <div className="screen-desc">あなたのレベルと契約サービスに合った人気作品です</div>
          </div>
        </div>

        <RecommendGrid items={items} onPick={startFromRecommend} userLevel={settings.userLevel || 'B1'} />
      </div>
    </div>
  );
}
