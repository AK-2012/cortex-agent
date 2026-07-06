import { useState } from 'react';
import { fmtClock, moneyLabel, MORNING, SLASH_COMMANDS } from './chat-content';

// Composer — 1:1 from prototype.dc.html L359–395: slash palette (default closed) · running/idle
// status line · input ("Message Cortex — type / for commands") · "/ commands" chip + hint · stop/send
// button. DATA GAP (composer send — Stage 4): no session-send mutate, so send/stop are INERT; the
// input + slash palette are local visual state only. Status-line metrics are the morning
// representative values (transcript Stage-4 gap).

const mono = "'IBM Plex Mono',monospace";

export function Composer({ running }: { running: boolean }): JSX.Element {
  const [composer, setComposer] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashHover, setSlashHover] = useState<number | null>(null);
  const [chipHover, setChipHover] = useState(false);
  const [btnHover, setBtnHover] = useState(false);

  const composerBorder = slashOpen ? '#4655D4' : '#D9DCE3';
  const composerHint = running ? 'running · esc to stop' : '⏎ send · ⇧⏎ newline';
  const sendBg = composer.trim() ? '#191C22' : '#D9DCE3';

  const q = composer.startsWith('/') ? composer.slice(1).toLowerCase() : '';
  const filtered = SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(q));
  const slashList = filtered.length ? filtered : SLASH_COMMANDS;

  return (
    <div style={{ flex: 'none' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 32px 18px', position: 'relative' }}>
        {slashOpen && (
          <div
            style={{
              position: 'absolute',
              left: 32,
              right: 32,
              bottom: '100%',
              marginBottom: -2,
              border: '1px solid #E7E9EE',
              borderRadius: 12,
              boxShadow: '0 6px 24px rgba(16,24,40,.08)',
              background: '#fff',
              overflow: 'hidden',
              zIndex: 10,
            }}
          >
            {slashList.map((c, i) => (
              <div
                key={c.cmd}
                onMouseEnter={() => setSlashHover(i)}
                onMouseLeave={() => setSlashHover((h) => (h === i ? null : h))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 14px',
                  background: slashHover === i || i === 0 ? '#EEF0FA' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <span style={{ font: `600 12px ${mono}`, color: i === 0 ? '#4655D4' : '#5B6472' }}>{c.cmd}</span>
                <span style={{ fontSize: 11.5, color: '#8A93A2', marginLeft: 12 }}>{c.desc}</span>
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '7px 14px',
                borderTop: '1px solid #F7F8FA',
                background: '#FBFBFC',
              }}
            >
              <span style={{ font: `400 10px ${mono}`, color: '#B6BDC9' }}>↑↓ navigate · ⏎ run · esc dismiss</span>
            </div>
          </div>
        )}
        {running ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              font: `500 11px ${mono}`,
              color: '#8A93A2',
              padding: '8px 2px 10px',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#4655D4',
                animation: 'cxpulse 1.6s ease-in-out infinite',
              }}
            />
            <span>
              running · {fmtClock(MORNING.runBaseSeconds)} · {MORNING.turns} turns · {moneyLabel(MORNING.sessionCost)}
            </span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              font: `500 11px ${mono}`,
              color: '#B6BDC9',
              padding: '8px 2px 10px',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D9DCE3' }} />
            <span>
              idle · {MORNING.turns} turns · {moneyLabel(MORNING.sessionCost)}
            </span>
          </div>
        )}
        <div
          style={{
            border: '1.5px solid ' + composerBorder,
            borderRadius: 12,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(16,24,40,.04)',
            padding: '10px 12px 10px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                value={composer}
                onChange={(e) => {
                  const v = e.target.value;
                  setComposer(v);
                  setSlashOpen(v.startsWith('/'));
                }}
                placeholder="Message Cortex — type / for commands"
                style={{ width: '100%', fontSize: 13.5, color: '#191C22', fontFamily: 'inherit', padding: '2px 0' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 13 }}>
                <span
                  onClick={() => {
                    setComposer('/');
                    setSlashOpen(true);
                  }}
                  onMouseEnter={() => setChipHover(true)}
                  onMouseLeave={() => setChipHover(false)}
                  style={{
                    font: `500 10.5px ${mono}`,
                    border: '1px solid ' + (chipHover ? '#C9CFF2' : '#E7E9EE'),
                    color: chipHover ? '#4655D4' : '#8A93A2',
                    padding: '2px 7px',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  / commands
                </span>
                <span style={{ marginLeft: 'auto', font: `400 10.5px ${mono}`, color: '#B6BDC9' }}>{composerHint}</span>
              </div>
            </div>
            {running ? (
              <div
                title="Stop · esc"
                onMouseEnter={() => setBtnHover(true)}
                onMouseLeave={() => setBtnHover(false)}
                style={{
                  flex: 'none',
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: btnHover ? '#32363E' : '#191C22',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 11, height: 11, background: '#fff', borderRadius: 2 }} />
              </div>
            ) : (
              <div
                style={{
                  flex: 'none',
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: sendBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.8">
                  <path d="M7 12V2M3 6l4-4 4 4" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
