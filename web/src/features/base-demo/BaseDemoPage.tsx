// /base — prototype 1:1 base specimen (design §8.6 RA / task 6d21).
// Pure presentational surface that exercises the faithful base — the exact fonts
// (system sans for UI, IBM Plex Mono for data/IDs), the audited prototype palette,
// and the prototype animation set — so a rendered screenshot can be diffed against
// the prototype (design/ref/prototype.dc.html + proto-shots/00-workbench.png).
// Uses raw exact prototype hex/px in the specimens (per §8.3 the design values are
// authoritative); the point is to confirm the base renders identically.

interface Swatch {
  name: string;
  hex: string;
  dark?: boolean;
}

// The audited recurring prototype palette (mirrors tailwind `proto.*`).
const SWATCHES: Swatch[] = [
  { name: 'base', hex: '#E9E7E2' },
  { name: 'card', hex: '#FFFFFF' },
  { name: 'rail', hex: '#FBFBFC' },
  { name: 'alt', hex: '#F7F8FA' },
  { name: 'gray', hex: '#F1F2F5' },
  { name: 'ink', hex: '#191C22', dark: true },
  { name: 'ink-2', hex: '#22262E', dark: true },
  { name: 'ink-3', hex: '#383E48', dark: true },
  { name: 'muted', hex: '#5B6472', dark: true },
  { name: 'muted-2', hex: '#8A93A2', dark: true },
  { name: 'muted-3', hex: '#98A1B0', dark: true },
  { name: 'faint', hex: '#B6BDC9' },
  { name: 'line', hex: '#E7E9EE' },
  { name: 'line-2', hex: '#EFF1F5' },
  { name: 'line-3', hex: '#D9DCE3' },
  { name: 'line-4', hex: '#E3E6F0' },
  { name: 'accent', hex: '#4655D4', dark: true },
  { name: 'accent-bg', hex: '#EEF0FA' },
  { name: 'accent-border', hex: '#C9CFF2' },
  { name: 'accent-2', hex: '#9AA3E8', dark: true },
  { name: 'accent-strong', hex: '#3A48B8', dark: true },
  { name: 'amber', hex: '#C99A2E', dark: true },
  { name: 'amber-fg', hex: '#8A5B06', dark: true },
  { name: 'amber-bg', hex: '#FDF9F0' },
  { name: 'amber-border', hex: '#EFDDB0' },
  { name: 'amber-accent', hex: '#C0A96E', dark: true },
  { name: 'success', hex: '#23854F', dark: true },
  { name: 'success-bg', hex: '#E9F4EE' },
  { name: 'danger', hex: '#C03D33', dark: true },
  { name: 'danger-bg', hex: '#FBEDEB' },
];

// The 16 prototype keyframes, shown as live specimens.
const ANIMATIONS: string[] = [
  'cxblink',
  'cxpulse',
  'cxtoast',
  'cxfade',
  'cxmodal',
  'cxcmdk',
  'cxpop',
  'cxpopup',
  'cxpopover',
  'cxdrawer',
  'cxmodalout',
  'cxcmdkout',
  'cxdrawerout',
  'cxfadeout',
  'cxmsg',
  'cxrise',
];

const MONO_SIZES = ['9px', '10px', '10.5px', '11px', '12px', '15px'];

function SectionTitle({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.07em',
        color: '#B6BDC9',
        textTransform: 'uppercase',
        margin: '28px 0 12px',
      }}
    >
      {children}
    </div>
  );
}

export function BaseDemoPage() {
  return (
    <div style={{ padding: '24px 28px', background: '#fff', minHeight: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: '#191C22',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: "600 12px 'IBM Plex Mono',monospace",
          }}
        >
          cx
        </div>
        <div style={{ fontWeight: 650, fontSize: 14, color: '#191C22', letterSpacing: '-0.01em' }}>
          Cortex — base specimen
        </div>
      </div>

      {/* ── Typography ── */}
      <SectionTitle>Sans (UI)</SectionTitle>
      <div style={{ fontFamily: 'inherit', color: '#191C22' }}>
        <div style={{ fontSize: 14, fontWeight: 650, letterSpacing: '-0.01em' }}>
          Interface heading — 14px / 650
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Section label — 13px / 600</div>
        <div style={{ fontSize: 12.5, fontWeight: 400, color: '#5B6472', marginTop: 4 }}>
          Body copy — 12.5px / 400 · The quick brown fox jumps over the lazy dog. 中文界面文字样张。
        </div>
      </div>

      <SectionTitle>Mono (data / IDs) — IBM Plex Mono</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {MONO_SIZES.map((sz) => (
          <div
            key={sz}
            style={{ font: `500 ${sz} 'IBM Plex Mono',monospace`, color: '#191C22' }}
          >
            thr_502fb888 · 6d21 · $2.64 · 3m 27s — {sz}
          </div>
        ))}
      </div>

      {/* ── Palette ── */}
      <SectionTitle>Palette (audited prototype colors)</SectionTitle>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 8,
        }}
      >
        {SWATCHES.map((s) => (
          <div
            key={s.name}
            style={{
              border: '1px solid #E7E9EE',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: 40,
                background: s.hex,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
                padding: 5,
              }}
            >
              <span
                style={{
                  font: "500 8.5px 'IBM Plex Mono',monospace",
                  color: s.dark ? '#fff' : '#98A1B0',
                }}
              >
                {s.hex}
              </span>
            </div>
            <div
              style={{
                padding: '5px 7px',
                fontSize: 11,
                fontWeight: 600,
                color: '#22262E',
                background: '#fff',
              }}
            >
              {s.name}
            </div>
          </div>
        ))}
      </div>

      {/* ── Live animation specimens ── */}
      <SectionTitle>Animations — running dot · caret · enter set</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#4655D4',
              display: 'inline-block',
              animation: 'cxpulse 1.6s ease-in-out infinite',
            }}
          />
          <span style={{ fontSize: 12, color: '#4655D4', fontWeight: 600 }}>running (cxpulse)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#C99A2E',
              display: 'inline-block',
              animation: 'cxpulse 2s ease-in-out infinite',
            }}
          />
          <span style={{ fontSize: 12, color: '#8A5B06', fontWeight: 600 }}>approval (cxpulse 2s)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span style={{ font: "500 12px 'IBM Plex Mono',monospace", color: '#191C22' }}>cortex</span>
          <span
            style={{
              display: 'inline-block',
              width: 7,
              height: 14,
              background: '#191C22',
              animation: 'cxblink 1.1s steps(1) infinite',
            }}
          />
          <span style={{ fontSize: 12, color: '#98A1B0', marginLeft: 6 }}>caret (cxblink)</span>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 8,
        }}
      >
        {ANIMATIONS.map((a) => (
          <div
            key={a}
            style={{
              border: '1px solid #E7E9EE',
              borderRadius: 8,
              padding: '10px 8px',
              textAlign: 'center',
              background: '#FBFBFC',
              // Loop the enter/exit specimens so the reviewer can see each fire.
              animation: `${a} 1.6s ease-in-out infinite`,
            }}
          >
            <span style={{ font: "500 10px 'IBM Plex Mono',monospace", color: '#22262E' }}>{a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
