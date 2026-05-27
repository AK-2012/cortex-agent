// input:  Tab definitions + sendFrame + dashState
// output: Tab-cycled dashboard panel — Tab key cycles, ↑/↓ navigates rows
// pos:    Dashboard tab container for M5 side panel

import React, { useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { TAB_SCOPES } from '../hooks/useDashboardData.js';
import type { TabName, DashState } from '../hooks/useDashboardData.js';
import { DashboardThreadsTab } from './DashboardThreadsTab.js';
import { DashboardTasksTab } from './DashboardTasksTab.js';
import { DashboardSchedulesTab } from './DashboardSchedulesTab.js';
import { DashboardExecutionsTab } from './DashboardExecutionsTab.js';
import { DashboardCostTab } from './DashboardCostTab.js';

// ── Types ──

export interface DashboardTabInfo {
  key: TabName;
  label: string;
}

export const DASHBOARD_TABS: DashboardTabInfo[] = [
  { key: 'threads', label: 'Threads' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'schedules', label: 'Schedules' },
  { key: 'executions', label: 'Executions' },
  { key: 'cost', label: 'Cost' },
];

interface DashboardProps {
  sendFrame: (frame: any) => void;
  projectId: string | null;
  dashState: DashState;
  onMarkPending: (tab: string) => void;
  onRegisterSubscription: (queryId: string, tab: string) => void;
  onUnregisterSubscription: (queryId: string) => void;
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
}

// ── Tab content renderer ──

function TabContent({
  tab,
  sendFrame,
  projectId,
  dashState,
  onMarkPending,
  onRegisterSubscription,
  onUnregisterSubscription,
}: {
  tab: TabName;
  sendFrame: (frame: any) => void;
  projectId: string | null;
  dashState: DashState;
  onMarkPending: (tab: string) => void;
  onRegisterSubscription: (queryId: string, tab: string) => void;
  onUnregisterSubscription: (queryId: string) => void;
}): React.JSX.Element {
  const initialQuerySent = useRef(false);

  // Initial query + subscribe (runs once per tab mount)
  React.useEffect(() => {
    const scope = TAB_SCOPES[tab];
    if (!scope) return;

    const queryId = scope.queryId;

    if (!initialQuerySent.current) {
      initialQuerySent.current = true;

      // Send query for initial data
      sendFrame({ type: 'ui.query', id: queryId, scope: `${tab}.list`, params: projectId ? { projectId } : {} });
      onMarkPending(tab);

      // Subscribe to events
      sendFrame({ type: 'ui.subscribe', id: queryId, filter: { events: scope.events, projectId } });
      onRegisterSubscription(queryId, tab);
    }

    // Cleanup on unmount
    return () => {
      sendFrame({ type: 'ui.unsubscribe', id: queryId });
      onUnregisterSubscription(queryId);
      initialQuerySent.current = false;
    };
  }, [tab, projectId, sendFrame, onMarkPending, onRegisterSubscription, onUnregisterSubscription]);

  // Re-fetch when loading is triggered by a subscription event
  React.useEffect(() => {
    const scope = TAB_SCOPES[tab];
    if (!scope || !initialQuerySent.current) return;

    if (dashState.tabs[tab].loading) {
      sendFrame({ type: 'ui.query', id: scope.queryId, scope: `${tab}.list`, params: projectId ? { projectId } : {} });
      onMarkPending(tab);
    }
  }, [dashState.tabs[tab].loading, tab, projectId, sendFrame, onMarkPending]);

  switch (tab) {
    case 'threads':
      return <DashboardThreadsTab data={dashState.tabs.threads} />;
    case 'tasks':
      return <DashboardTasksTab data={dashState.tabs.tasks} />;
    case 'schedules':
      return <DashboardSchedulesTab data={dashState.tabs.schedules} />;
    case 'executions':
      return <DashboardExecutionsTab data={dashState.tabs.executions} />;
    case 'cost':
      return <DashboardCostTab data={dashState.tabs.cost} />;
    default:
      return <Text dimColor>Unknown tab</Text>;
  }
}

// ── Component ──

export function Dashboard({
  sendFrame,
  projectId,
  dashState,
  onMarkPending,
  onRegisterSubscription,
  onUnregisterSubscription,
  activeTab,
  onSetActiveTab,
}: DashboardProps): React.JSX.Element {
  useInput((_input, key) => {
    if (key.tab) {
      const currentIdx = DASHBOARD_TABS.findIndex(t => t.key === activeTab);
      const nextIdx = (currentIdx + 1) % DASHBOARD_TABS.length;
      onSetActiveTab(DASHBOARD_TABS[nextIdx].key);
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      {/* Tab bar */}
      <Box>
        {DASHBOARD_TABS.map(t => (
          <Box key={t.key} paddingX={1} borderStyle={t.key === activeTab ? 'bold' : 'single'} borderDimColor={t.key !== activeTab}>
            <Text bold={t.key === activeTab}>{t.label}</Text>
          </Box>
        ))}
      </Box>

      {/* Tab content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <TabContent
          tab={activeTab as TabName}
          sendFrame={sendFrame}
          projectId={projectId}
          dashState={dashState}
          onMarkPending={onMarkPending}
          onRegisterSubscription={onRegisterSubscription}
          onUnregisterSubscription={onUnregisterSubscription}
        />
      </Box>
    </Box>
  );
}
