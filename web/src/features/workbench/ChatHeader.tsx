import { useEffect, useState } from 'react';
import { DEFAULT_CHAT_PROFILE } from './chat-content';
import { buildProfileOptions } from './profile-menu';
import { ProfileMenu } from './ProfileMenu';

// Chat header — 1:1 from prototype.dc.html L107–130: session title · profile chip · running/idle
// status pill · ⌘K affordance. `title` is the REAL active session name (task aba0); `running` is
// derived from live `session.message` activity. Profile-chip dropdown (L109–121, task c3ce): GAP —
// no profiles tRPC scope → static verbatim option set; onPick updates the local chip label only.

const mono = "'IBM Plex Mono',monospace";

export function ChatHeader({
  title,
  running,
  onCmdK,
}: {
  title: string;
  running: boolean;
  onCmdK: () => void;
}): JSX.Element {
  const [chipHover, setChipHover] = useState(false);
  const [cmdkHover, setCmdkHover] = useState(false);
  const [profMenuOpen, setProfMenuOpen] = useState(false);
  const [chatProfile, setChatProfile] = useState(DEFAULT_CHAT_PROFILE);
  useEffect(() => {
    if (!profMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfMenuOpen(false);
    };
    const onClickAway = () => setProfMenuOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClickAway);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClickAway);
    };
  }, [profMenuOpen]);

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
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: '#191C22',
          maxWidth: 320,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
      <span style={{ position: 'relative' }}>
        <span
          data-chip="profile"
          onMouseEnter={() => setChipHover(true)}
          onMouseLeave={() => setChipHover(false)}
          onClick={(e) => {
            e.stopPropagation();
            setProfMenuOpen((o) => !o);
          }}
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
          profile · {chatProfile}
          <span style={{ fontSize: 8, color: '#B6BDC9' }}>▾</span>
        </span>
        {profMenuOpen && (
          <span onClick={(e) => e.stopPropagation()}>
            <ProfileMenu
              options={buildProfileOptions(chatProfile)}
              onPick={(name) => {
                setChatProfile(name);
                setProfMenuOpen(false);
              }}
            />
          </span>
        )}
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
