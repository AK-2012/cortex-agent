import * as RadixDialog from '@radix-ui/react-dialog';
import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { SETTINGS_NAV, sectionMeta, type SettingsSectionKey } from './settings-nav';
import {
  PlatformPanel,
  ProfilesPanel,
  MachinesPanel,
  TemplatesPanel,
  McpPanel,
  NotificationsPanel,
  HooksPanel,
  AdvancedPanel,
} from './SettingsPanels';
import { BudgetPanel } from './BudgetPanel';

// Settings modal (design 12a–g, prototype.dc.html L721–1088; proto-shot 14-settings.png). Rebuilt
// 1:1 on Radix Dialog (focus trap / Esc-close / focus-restore + backdrop scrim). Header + 210px left
// nav + #F7F8FA content area; 9 panels switch client-side. Real config.get data feeds every panel;
// the Budget panel drives a real config.set write. Raw inline styles/px/hex/font per §8.3.

const MONO = "'IBM Plex Mono',monospace";

const BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(25,28,34,.34)',
  zIndex: 60,
};

const MODAL_STYLE: CSSProperties = {
  position: 'fixed',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%,-50%)',
  width: 1080,
  maxWidth: '94vw',
  height: 680,
  maxHeight: '90vh',
  background: '#fff',
  borderRadius: 14,
  boxShadow: '0 24px 64px rgba(16,24,40,.3)',
  zIndex: 61,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay style={BACKDROP_STYLE} className="animate-cxfade motion-reduce:animate-none" />
        <RadixDialog.Content
          aria-describedby={undefined}
          style={MODAL_STYLE}
          className="animate-cxmodal focus:outline-none motion-reduce:animate-none"
        >
          <RadixDialog.Title style={SR_ONLY}>Settings</RadixDialog.Title>
          {open ? <SettingsBody onClose={onClose} /> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const [section, setSection] = useState<SettingsSectionKey>('platform');

  const configQuery = useQuery(trpc.config.get.queryOptions({}));
  const costQuery = useQuery(trpc.cost.summary.queryOptions({}));
  const snapshot = configQuery.data;
  const meta = sectionMeta(section);

  return (
    <>
      {/* header (prototype L724) */}
      <div
        style={{
          height: 48,
          flex: 'none',
          borderBottom: '1px solid #E7E9EE',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 18px',
          background: '#fff',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 650, color: '#191C22' }}>Settings</span>
        <span style={{ font: `400 10px ${MONO}`, color: '#98A1B0', marginLeft: 4 }}>~/.cortex/config/</span>
        <span
          onClick={onClose}
          role="button"
          style={{
            marginLeft: 'auto',
            font: `500 9.5px ${MONO}`,
            color: '#98A1B0',
            border: '1px solid #E7E9EE',
            borderRadius: 5,
            padding: '2px 6px',
            cursor: 'pointer',
          }}
        >
          esc
        </span>
      </div>
      {/* body: 210px nav + content (prototype L732) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div
          style={{
            width: 210,
            flex: 'none',
            borderRight: '1px solid #E7E9EE',
            background: '#FBFBFC',
            padding: '10px 8px',
            overflow: 'auto',
          }}
        >
          {SETTINGS_NAV.map((n) => {
            const active = n.key === section;
            return (
              <div
                key={n.key}
                onClick={() => setSection(n.key)}
                role="button"
                data-settings-nav={n.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  background: active ? '#EEF0FA' : 'transparent',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: active ? '#4655D4' : '#22262E',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {n.label}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    font: `400 9px ${MONO}`,
                    color: active ? '#4655D4' : '#B6BDC9',
                    flex: 'none',
                  }}
                >
                  {n.file}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            padding: '16px 22px',
            background: '#F7F8FA',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 650, color: '#191C22' }}>{meta.title}</div>
          <div style={{ fontSize: 11, color: '#8A93A2', marginTop: 2 }}>{meta.sub}</div>
          {configQuery.isLoading ? (
            <div style={{ marginTop: 16, fontSize: 12, color: '#98A1B0' }}>Loading config…</div>
          ) : configQuery.isError ? (
            <div style={{ marginTop: 16, fontSize: 12, color: '#C03D33' }}>
              Failed to load config: {configQuery.error.message}
            </div>
          ) : snapshot ? (
            <PanelBody section={section} snapshot={snapshot} cost={costQuery.data} />
          ) : null}
        </div>
      </div>
    </>
  );
}

function PanelBody({
  section,
  snapshot,
  cost,
}: {
  section: SettingsSectionKey;
  snapshot: import('@cortex-agent/ui-contract').ConfigSnapshot;
  cost: import('@cortex-agent/ui-contract').CostSummary | undefined;
}) {
  switch (section) {
    case 'platform':
      return <PlatformPanel snapshot={snapshot} />;
    case 'profiles':
      return <ProfilesPanel snapshot={snapshot} />;
    case 'budget':
      return <BudgetPanel snapshot={snapshot} cost={cost} />;
    case 'machines':
      return <MachinesPanel snapshot={snapshot} />;
    case 'templates':
      return <TemplatesPanel snapshot={snapshot} />;
    case 'mcp':
      return <McpPanel snapshot={snapshot} />;
    case 'notifications':
      return <NotificationsPanel snapshot={snapshot} />;
    case 'hooks':
      return <HooksPanel snapshot={snapshot} />;
    case 'advanced':
      return <AdvancedPanel snapshot={snapshot} />;
    default:
      return null;
  }
}
