import { useState } from 'react';
import { MORNING } from './chat-content';

// Chat header — 1:1 from prototype.dc.html L107–130: session title · profile chip · running/idle
// status pill · ⌘K affordance. Title/profile/running are the morning-session representative values
// (transcript Stage-4 gap — no session-detail scope). Profile menu closed by default (L111).

const mono = "'IBM Plex Mono',monospace";

export function ChatHeader({ running, onCmdK }: { running: boolean; onCmdK: () => void }): JSX.Element {
  const [chipHover, setChipHover] = useState(false);
  const [cmdkHover, setCmdkHover] = useState(false);

  return (
    <div
      style={{
        height: 50,
        flex: 'none',
        borderBottom: '1px solid #E7E9EE',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 20px',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#191C22' }}>{MORNING.title}</div>
      <span style={{ position: 'relative' }}>
        <span
          onMouseEnter={() => setChipHover(true)}
          onMouseLeave={() => setChipHover(false)}
          style={{
            font: `500 10.5px ${mono}`,
            border: '1px solid ' + (chipHover ? '#C9CFF2' : '#E7E9EE'),
            color: chipHover ? '#4655D4' : '#5B6472',
            padding: '2px 7px',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          profile · {MORNING.profile}
          <span style={{ fontSize: 8, color: '#B6BDC9' }}>▾</span>
        </span>
      </span>
      {running ? (
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
            background: '#EEF0FA',
            color: '#4655D4',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#4655D4',
              marginRight: 4,
              animation: 'cxpulse 1.6s ease-in-out infinite',
            }}
          />
          running
        </span>
      ) : (
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
            background: '#F1F2F5',
            color: '#8A93A2',
          }}
        >
          idle
        </span>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, color: '#8A93A2' }}>
        <span
          onClick={onCmdK}
          onMouseEnter={() => setCmdkHover(true)}
          onMouseLeave={() => setCmdkHover(false)}
          style={{ font: `500 11px ${mono}`, cursor: 'pointer', color: cmdkHover ? '#191C22' : undefined }}
        >
          ⌘K
        </span>
      </div>
    </div>
  );
}
