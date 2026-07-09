// @ds-adherence-ignore -- mobile session header, 1:1 from scheme.dc.html L2937-2944 (raw px/hex/font
// by design, §8.3; mobile palette is not in the light `proto.*` token set).
import type { HeaderStatus } from './mobile-session-vm';

const mono = "'IBM Plex Mono',monospace";

export function MobileSessionHeader({
  initials,
  title,
  status,
  running,
}: {
  initials: string;
  title: string;
  status: HeaderStatus;
  running: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 14px 10px',
        borderBottom: '1px solid #E7E9EE',
        background: '#F2F2F7',
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: '#EEF0FA',
          color: '#4655D4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: `600 11px ${mono}`,
          flex: 'none',
        }}
      >
        {initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 650,
            color: '#191C22',
            letterSpacing: '-.01em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            font: `400 10px ${mono}`,
            color: '#8A93A2',
            marginTop: 1,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: running ? '#4655D4' : '#D9DCE3',
              animation: running ? 'cxpulse 1.6s ease-in-out infinite' : undefined,
            }}
          />
          {status.word} · {status.turnsLabel} · {status.cost}
        </div>
      </div>
      <div
        style={{
          marginLeft: 'auto',
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: '#fff',
          border: '1px solid #E7E9EE',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8A93A2',
          fontSize: 14,
          letterSpacing: 1,
          flex: 'none',
        }}
      >
        ⋯
      </div>
    </div>
  );
}
