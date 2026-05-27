// input:  visible flag + Dashboard component
// output: Right-side panel — Ctrl+D toggle host for dashboard
// pos:    Side panel container, does NOT block input focus when shown

import React from 'react';
import { Box } from 'ink';
import { Dashboard } from './Dashboard.js';
import type { DashState } from '../hooks/useDashboardData.js';

interface SidePanelProps {
  visible: boolean;
  sendFrame: (frame: any) => void;
  projectId: string | null;
  dashState: DashState;
  onMarkPending: (tab: string) => void;
  onRegisterSubscription: (queryId: string, tab: string) => void;
  onUnregisterSubscription: (queryId: string) => void;
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
}

export function SidePanel({
  visible,
  sendFrame,
  projectId,
  dashState,
  onMarkPending,
  onRegisterSubscription,
  onUnregisterSubscription,
  activeTab,
  onSetActiveTab,
}: SidePanelProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <Box width={40} borderStyle="single" borderDimColor marginLeft={1} flexShrink={0}>
      <Dashboard
        sendFrame={sendFrame}
        projectId={projectId}
        dashState={dashState}
        onMarkPending={onMarkPending}
        onRegisterSubscription={onRegisterSubscription}
        onUnregisterSubscription={onUnregisterSubscription}
        activeTab={activeTab}
        onSetActiveTab={onSetActiveTab}
      />
    </Box>
  );
}
