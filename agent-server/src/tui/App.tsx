// input:  All components + hooks
// output: Top-level layout + global key handler for M5 Ink client
// pos:    Main App component wiring all pieces together

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Box } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { InputBox } from './components/InputBox.js';
import { StatusLine } from './components/StatusLine.js';
import { SidePanel } from './components/SidePanel.js';
import { NotificationsBadge, NotificationsModal } from './components/Notifications.js';
import { ProjectSwitcher } from './components/ProjectSwitcher.js';
import { useTranscript } from './hooks/useTranscript.js';
import { useKeybindings } from './hooks/useKeybindings.js';
import { useNotifications } from './hooks/useNotifications.js';
import { useDashboardData } from './hooks/useDashboardData.js';
import { SessionPicker } from './components/SessionPicker.js';
import type { ResumableSession } from './components/SessionPicker.js';
import { isNotification, isUiQueryResult, isUiEvent } from '../platform/tui/protocol.js';
import type { WsState } from './ws-client.js';
import type { TuiFrame, HandshakeAck } from '../platform/tui/protocol.js';
import type { ProjectEntry } from './components/ProjectSwitcher.js';

// ── Types ──

export interface AppProps {
  sendFrame: (frame: TuiFrame) => void;
  connectionState: WsState;
  ack: HandshakeAck | null;
  onReconnect: () => void;
  onDisconnect: () => void;
  onSendCancel: () => void;
  serverVersion: string | null;
  projectId: string | null;
  sessionName: string | null;
  /**
   * Called when this App component is ready to receive frames for dispatch.
   * The parent (index.tsx) calls this function for each WS frame.
   */
  onSetDispatch?: (dispatch: (frame: TuiFrame) => void) => void;

  // Resume mode — interactive session picker
  resumableSessions?: ResumableSession[] | null;
  resumePending?: boolean;
  onResumeSelect?: (sessionId: string, projectId: string) => void;
  onResumeCancel?: () => void;
}

export function App({
  sendFrame,
  connectionState,
  ack,
  onReconnect,
  onDisconnect,
  onSendCancel,
  serverVersion,
  projectId,
  sessionName,
  onSetDispatch,
  resumableSessions,
  resumePending,
  onResumeSelect,
  onResumeCancel,
}: AppProps): React.JSX.Element {
  // ── Hooks ──
  const transcript = useTranscript();
  const notif = useNotifications();
  const dashboard = useDashboardData();

  const [queuedCount, setQueuedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputDisabled, setInputDisabled] = useState(false);

  // Phase 2 state
  const [sidePanelVisible, setSidePanelVisible] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);

  // Project switcher state
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const transcriptRef = useRef<{ scrollUp: (page?: boolean) => void; scrollDown: (page?: boolean) => void; scrollToEnd: () => void } | null>(null);

  // Cost summary from dashboard state (computed)
  const costData = dashboard.state.tabs.cost.data.length > 0 ? dashboard.state.tabs.cost.data : [];
  const costSummary = costData.length > 0 && typeof (costData[0] as any)?.totalCost === 'number'
    ? `$${(costData[0] as any).totalCost.toFixed(2)}`
    : null;

  // Active tab for dashboard
  const [activeTab, setActiveTab] = useState('threads');

  // Combined dispatch: routes frames to transcript, dashboard, or notifications
  useEffect(() => {
    onSetDispatch?.((frame: TuiFrame) => {
      if (isNotification(frame)) {
        notif.add(frame);
        return;
      }
      if (isUiQueryResult(frame) || isUiEvent(frame)) {
        // Handle project switcher responses
        if (isUiQueryResult(frame) && frame.id === 'proj-switcher-list') {
          if (frame.ok) {
            setProjects(Array.isArray(frame.data) ? frame.data as ProjectEntry[] : []);
            setProjectsLoading(false);
            setProjectsError(null);
          } else {
            setProjects([]);
            setProjectsLoading(false);
            setProjectsError((frame as any).error?.message ?? 'Failed to load projects');
          }
          return;
        }
        dashboard.dispatch(frame);
        return;
      }
      transcript.dispatch(frame);
    });
  }, [transcript.dispatch, dashboard.dispatch, notif.add, onSetDispatch]);

  // Send initial cost query for header summary
  useEffect(() => {
    sendFrame({ type: 'ui.query', id: 'dash-cost', scope: 'cost.summary', params: {} } as any);
  }, []);

  // Submit message
  const handleSubmit = useCallback((text: string) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sendFrame({
      type: 'msg.user',
      id,
      text,
    } as any);
    setQueuedCount(prev => prev + 1);
    setInputDisabled(true);
  }, [sendFrame]);

  // Cancel (sends !cancel)
  const handleCancel = useCallback(() => {
    onSendCancel();
  }, [onSendCancel]);

  // Clear view
  const handleClearView = useCallback(() => {
    transcript.clear();
  }, [transcript]);

  // Scroll
  const handleScrollUp = useCallback((page?: boolean) => {
    transcriptRef.current?.scrollUp(page);
  }, []);

  const handleScrollDown = useCallback((page?: boolean) => {
    transcriptRef.current?.scrollDown(page);
  }, []);

  // Side panel toggle
  const handleToggleSidePanel = useCallback(() => {
    setSidePanelVisible(prev => !prev);
  }, []);

  // Notifications toggle
  const handleToggleNotifications = useCallback(() => {
    setNotificationsOpen(prev => !prev);
  }, []);

  // Project switcher toggle
  const handleToggleProjectSwitcher = useCallback(() => {
    setProjectSwitcherOpen(prev => !prev);
  }, []);

  // Project switcher select
  const handleProjectSelect = useCallback((selectedProjectId: string) => {
    sendFrame({
      type: 'session.switch',
      id: 'proj-switch',
      projectId: selectedProjectId,
      sessionId: null,
    } as any);
  }, [sendFrame]);

  // Project switcher refresh
  const handleProjectsRefresh = useCallback(() => {
    setProjectsLoading(true);
    setProjectsError(null);
    sendFrame({
      type: 'ui.query',
      id: 'proj-switcher-list',
      scope: 'projects.list',
      params: {},
    } as any);
  }, [sendFrame]);

  // Modals pre-empt input
  const modalOpen = notificationsOpen || projectSwitcherOpen;

  // Keyboard bindings
  useKeybindings({
    onSubmit: handleSubmit,
    onCancel: handleCancel,
    onScrollUp: handleScrollUp,
    onScrollDown: handleScrollDown,
    onClearView: handleClearView,
    onExit: onDisconnect,
    onToggleSidePanel: handleToggleSidePanel,
    onToggleNotifications: handleToggleNotifications,
    onToggleProjectSwitcher: handleToggleProjectSwitcher,
  });

  // Dashboard subscription management callbacks
  const handleMarkPending = useCallback((tab: string) => {
    dashboard.markPending(tab as any);
  }, [dashboard]);

  const handleRegisterSubscription = useCallback((queryId: string, tab: string) => {
    dashboard.registerSubscription(queryId, tab as any);
  }, [dashboard]);

  const handleUnregisterSubscription = useCallback((queryId: string) => {
    dashboard.unregisterSubscription(queryId);
  }, [dashboard]);

  // If resume mode with sessions to pick, show picker instead of main layout
  if (resumableSessions && resumableSessions.length > 0 && onResumeSelect && onResumeCancel) {
    return (
      <Box flexDirection="column" height="100%" justifyContent="center" alignItems="center">
        <SessionPicker
          sessions={resumableSessions}
          onSelect={onResumeSelect}
          onCancel={onResumeCancel}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Header
        projectId={projectId}
        sessionName={sessionName}
        queuedCount={queuedCount}
        connected={connectionState === 'connected'}
        notificationCount={notif.unreadCount}
        costSummary={costSummary}
      />

      <Box flexDirection="row" flexGrow={1}>
        {/* Transcript area */}
        <Box flexDirection="column" flexGrow={1}>
          <Transcript
            ref={transcriptRef}
            messages={transcript.messages}
            ids={transcript.ids}
          />
        </Box>

        {/* Dashboard side panel */}
        <SidePanel
          visible={sidePanelVisible}
          sendFrame={sendFrame}
          projectId={projectId}
          dashState={dashboard.state}
          onMarkPending={handleMarkPending}
          onRegisterSubscription={handleRegisterSubscription}
          onUnregisterSubscription={handleUnregisterSubscription}
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
        />
      </Box>

      {/* Notifications badge in status area */}
      {!notificationsOpen && notif.unreadCount > 0 ? (
        <Box justifyContent="flex-end" marginRight={2}>
          <NotificationsBadge unreadCount={notif.unreadCount} />
        </Box>
      ) : null}

      {/* Input area */}
      {modalOpen ? (
        <Box borderStyle="single" borderDimColor paddingX={1} marginTop={1}>
          {notificationsOpen ? (
            <NotificationsModal
              open={notificationsOpen}
              notifications={notif.notifications}
              ids={notif.ids}
              onMarkRead={notif.markRead}
              onClose={() => setNotificationsOpen(false)}
            />
          ) : null}
          {projectSwitcherOpen ? (
            <ProjectSwitcher
              open={projectSwitcherOpen}
              projects={projects}
              loading={projectsLoading}
              error={projectsError}
              onSelect={handleProjectSelect}
              onClose={() => setProjectSwitcherOpen(false)}
              onRequestRefresh={handleProjectsRefresh}
            />
          ) : null}
        </Box>
      ) : (
        <InputBox
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          disabled={inputDisabled}
        />
      )}

      <StatusLine
        connectionState={connectionState}
        queuedCount={queuedCount}
        notificationCount={notif.unreadCount}
        errorMessage={errorMessage}
      />
    </Box>
  );
}
