'use client';

import { IconClose } from './icons/LineIcons';
import { useEffect } from 'react';
import { serviceLabel } from '@/lib/serviceEntry';

// 観るサービスを選ぶ下からのシート（2026-11-10・ServiceSelect 画面の代わり）。
//   「入場する ▶」で開く先が決まらない時と、単語リスト画面の「観る：○○（変更）」から開く。
//   ロゴ・ブランドの色は使わない（文字だけ・法務 2026-11-10）。選んだサービスは作品ごとに覚える（chooseService）。
//   ★入場から開いた時は、ボタンを押したその場で window.open する（ポップアップとして止められないよう、押した操作の中で開く）。
export default function ServiceSheet({ open, names, current, onPick, onClose, title, note }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="svc-sheet-shade" onClick={onClose}>
      <div className="svc-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="svc-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="svc-sheet-x" onClick={onClose} aria-label="閉じる">
            <IconClose />
          </button>
        </div>
        {note && <p className="svc-sheet-note">{note}</p>}
        <div className="svc-sheet-list">
          {names.map((n) => (
            <button
              key={n}
              type="button"
              className={'svc-sheet-item' + (n === current ? ' is-current' : '')}
              onClick={() => onPick(n)}
            >
              <span>{serviceLabel(n)}</span>
              {n === current && <small>いま選んでいるサービス</small>}
            </button>
          ))}
        </div>
        <p className="svc-sheet-foot">各サービスの検索ページを開きます。提携ではありません。</p>
      </div>
    </div>
  );
}
