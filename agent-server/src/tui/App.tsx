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
import { useMutate } from './hooks/useMutate.js';
import type { MutateResult } from './hooks/useMutate.js';
import { useTranscript } from './hooks/useTranscript.js';
import { useKeybindings } from './hooks/useKeybindings.js';
import { useNotifications } from './hooks/useNotifications.js';
import type { NotificationEntry } from './hooks/useNotifications.js';
import { useDashboardData } from './hooks/useDashboardData.js';
import { SessionPicker } from './components/SessionPicker.js';
import { AskUserModal } from './components/AskUserModal.js';
import { PlanFeedbackModal } from './components/PlanFeedbackModal.js';
import type { ResumableSession } from './components/SessionPicker.js';
import { isNotification, isUiQueryResult, isUiEvent, isModalOpen, isModalAck, isErrorFrame } from '../platform/tui/protocol.js';
import { computeFocusZone, isAgentResponseFrame } from './logic.js';
import type { WsState } from './ws-client.js';
import type { TuiFrame, HandshakeAck, ModalOpen, ModalAck } from '../platform/tui/protocol.js';
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
  /** Fatal/connection error surfaced from the entry layer (e.g. backoff cap exceeded). */
  errorMessage?: string | null;
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
  errorMessage,
  onSetDispatch,
  resumableSessions,
  resumePending,
  onResumeSelect,
  onResumeCancel,
}: AppProps): React.JSX.Element {
  // ── Hooks ──
  const [activeModal, setActiveModal] = useState<ModalOpen | null>(null);
  const [modalAckErrors, setModalAckErrors] = useState<Record<string, string>>({});

  const transcript = useTranscript({
    onModalOpen: useCallback((frame: ModalOpen) => {
      setActiveModal(frame);
      setModalAckErrors({});
    }, []),
    onModalAck: useCallback((frame: ModalAck) => {
      if (frame.errors && Object.keys(frame.errors).length > 0) {
        setModalAckErrors(frame.errors);
      } else {
        setActiveModal(null);
        setModalAckErrors({});
      }
    }, []),
  });
  const notif = useNotifications();
  const dashboard = useDashboardData();

  const [queuedCount, setQueuedCount] = useState(0);
  // The user can always type; awaitingResponse only blocks *sending* until the
  // agent starts replying (no explicit turn-end frame exists in the protocol).
  const [awaitingResponse, setAwaitingResponse] = useState(false);

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

  // Route non-mutate frames to the appropriate handler
  const routeFrame = useCallback((frame: TuiFrame) => {
    // Any agent reply / stream frame means the turn is being answered — unblock
    // sending and clear the queued counter (there is no explicit turn-end frame).
    // An error frame also releases the lock so a failed turn never strands input.
    if (isAgentResponseFrame(frame) || isErrorFrame(frame)) {
      setAwaitingResponse(false);
      setQueuedCount(0);
    }
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
  }, [transcript.dispatch, dashboard.dispatch, notif.add]);

  // Mutate hook: sends ui.mutate frames, correlates results by id, 10s timeout
  const { mutate, handleFrame } = useMutate({ sendFrame, onFrame: routeFrame });

  // Combined dispatch: mutate intercepts mutateResult; rest routes normally
  useEffect(() => {
    onSetDispatch?.((frame: TuiFrame) => { handleFrame(frame); });
  }, [onSetDispatch, handleFrame]);

  // Send initial cost query for header summary
  useEffect(() => {
    sendFrame({ type: 'ui.query', id: 'dash-cost', scope: 'cost.summary', params: {} } as any);
  }, []);

  // Switching project/session (session.switched is handled in index.tsx and never
  // reaches routeFrame) must release any pending send-lock from the old session.
  useEffect(() => {
    setAwaitingResponse(false);
    setQueuedCount(0);
  }, [projectId, sessionName]);

  // Submit message
  const handleSubmit = useCallback((text: string) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sendFrame({
      type: 'msg.user',
      id,
      text,
    } as any);
    setQueuedCount(prev => prev + 1);
    setAwaitingResponse(true);
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

  // Notification select — switches to notification's project
  const handleNotificationSelect = useCallback((notif: NotificationEntry) => {
    sendFrame({
      type: 'session.switch',
      id: 'notif-switch',
      projectId: notif.projectId,
      sessionId: notif.sessionId ?? null,
    } as any);
    setNotificationsOpen(false);
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

  // Modals pre-empt input; an open dashboard takes keyboard focus from the input.
  const modalOpen = activeModal !== null || notificationsOpen || projectSwitcherOpen;
  const focusZone = computeFocusZone({ modalOpen, sidePanelVisible });

  // Keyboard bindings — toggles/cancel always active outside modals; scroll only
  // when the chat input owns focus; reconnect only when not connected.
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
    onReconnect,
  }, focusZone !== 'modal', {
    allowScroll: focusZone === 'input',
    allowReconnect: connectionState !== 'connected',
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
          active={focusZone === 'dashboard'}
          sendFrame={sendFrame}
          projectId={projectId}
          dashState={dashboard.state}
          onMarkPending={handleMarkPending}
          onRegisterSubscription={handleRegisterSubscription}
          onUnregisterSubscription={handleUnregisterSubscription}
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
          onMutate={mutate}
        />
      </Box>

      {/* Notifications badge in status area */}
      {!notificationsOpen && notif.unreadCount > 0 ? (
        <Box justifyContent="flex-end" marginRight={2}>
          <NotificationsBadge unreadCount={notif.unreadCount} />
        </Box>
      ) : null}

      {/* Input area */}
      {/* AskUserModal — pre-empts all other modals */}
      {activeModal ? (
        activeModal.modal.callbackId.startsWith('plan')
          ? <PlanFeedbackModal
              modal={activeModal.modal}
              triggerId={activeModal.triggerId}
              sendFrame={sendFrame}
              ackErrors={modalAckErrors}
              onClose={() => { setActiveModal(null); setModalAckErrors({}); }}
            />
          : <AskUserModal
              modal={activeModal.modal}
              triggerId={activeModal.triggerId}
              sendFrame={sendFrame}
              ackErrors={modalAckErrors}
              onClose={() => { setActiveModal(null); setModalAckErrors({}); }}
            />
      ) : modalOpen ? (
        <Box borderStyle="single" borderDimColor paddingX={1} marginTop={1}>
          {notificationsOpen ? (
            <NotificationsModal
              open={notificationsOpen}
              notifications={notif.notifications}
              ids={notif.ids}
              onMarkRead={notif.markRead}
              onClose={() => setNotificationsOpen(false)}
              onSelect={handleNotificationSelect}
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
          awaitingResponse={awaitingResponse}
          focus={focusZone === 'input'}
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
