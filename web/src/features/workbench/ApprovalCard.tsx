import { useState } from 'react';
import type { ApprovalContent } from './chat-content';
import { useApprovals } from '@/features/approvals/ApprovalsProvider';

// Inline approval-required card — 1:1 from prototype.dc.html L247–276 (pending · unarmed default).
// The chat transcript body is still representative (no session-transcript scope — Stage 4), so this
// shows the representative APR-0007 content; but the card is now a live TRIGGER: clicking it (or its
// Approve/Deny) opens the approval center overlay, where the real approvals.list entries
// are approved/rejected via the real mutate ops. The card's own buttons stay non-mutating (the real
// decision surface is the overlay); a per-card inline mutate is deferred with the Stage-4 transcript.

const mono = "'IBM Plex Mono',monospace";

export function ApprovalCard({ approval }: { approval: ApprovalContent }): JSX.Element {
  const [approveHover, setApproveHover] = useState(false);
  const [denyHover, setDenyHover] = useState(false);
  const approvals = useApprovals();

  return (
    <div
      onClick={() => approvals.open()}
      style={{
        border: '1px solid #EFDDB0',
        background: '#FDF9F0',
        borderRadius: 10,
        padding: '13px 16px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            padding: '2.5px 9px',
            borderRadius: 999,
            background: '#F7ECCE',
            color: '#8A5B06',
          }}
        >
          {approval.tagText}
        </span>
        <span style={{ font: `400 10.5px ${mono}`, color: '#C0A96E' }}>{approval.id}</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#191C22', marginTop: 9 }}>{approval.title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#5B6472', marginTop: 3 }}>{approval.desc}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span
          onMouseEnter={() => setApproveHover(true)}
          onMouseLeave={() => setApproveHover(false)}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            background: approveHover ? '#32363E' : '#191C22',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 7,
            cursor: 'pointer',
          }}
        >
          Approve
        </span>
        <span
          onMouseEnter={() => setDenyHover(true)}
          onMouseLeave={() => setDenyHover(false)}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            border: '1px solid #D9DCE3',
            background: denyHover ? '#F7F8FA' : '#fff',
            color: '#191C22',
            padding: '5px 14px',
            borderRadius: 7,
            cursor: 'pointer',
          }}
        >
          Deny
        </span>
      </div>
    </div>
  );
}
