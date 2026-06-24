'use client';

// 半券（観た証）カード。ホームの TodayPanel 直下に最新1枚だけ出す（混雑回避）。
// タップで「あの場面を思い出す」＝そのエピソードの出題語をシーン記憶カードとして開く。
// 「未視聴チケットの催促」ではなく「観た後に戻る入口」（push→pull・2026-06-25 部署討論の反転案）。
export default function HomeStubCard({ ticket, extraCount = 0, onOpen }) {
  if (!ticket) return null;
  const hasSE = !ticket.isMovie && ticket.season != null && ticket.episode != null;
  const seLabel = hasSE ? ` S${ticket.season}E${ticket.episode}` : '';
  const n = (ticket.words || []).length;

  const open = () => onOpen && onOpen(ticket);

  return (
    <button
      type="button"
      className="stub-card"
      onClick={open}
      aria-label={`${ticket.title}${seLabel} のあの場面を思い出す`}
    >
      {/* 左の半券ミシン目（破った半券の質感） */}
      <span className="stub-card-stub" aria-hidden="true">
        🎟
      </span>
      <span className="stub-card-body">
        <span className="stub-card-eyebrow">半券 ・ 観たあとに</span>
        <span className="stub-card-title">
          {ticket.title || 'この作品'}
          {seLabel} を観た？
        </span>
        <span className="stub-card-sub">
          あの場面のセリフ、{n}語を思い出そう
          {extraCount > 0 ? ` ・ 他${extraCount}枚` : ''}
        </span>
      </span>
      <span className="stub-card-cta" aria-hidden="true">
        🃏 思い出す →
      </span>
    </button>
  );
}
