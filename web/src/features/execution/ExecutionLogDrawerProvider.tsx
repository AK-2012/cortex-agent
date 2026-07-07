import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ExecutionLogDrawer } from './ExecutionLogDrawer';

// Global mount + open/close controller for the execution log drawer (design 09-exec-logs). A single
// drawer instance lives here; any dispatch row (ThreadStepList, workbench RightThreadCard) opens it
// with an executionId via useExecutionLogDrawer(). Mirrors the global ⌘K command-palette mount.

interface ExecutionLogDrawerContextValue {
  open: (executionId: string) => void;
  close: () => void;
}

const ExecutionLogDrawerContext = createContext<ExecutionLogDrawerContextValue | null>(null);

export function ExecutionLogDrawerProvider({ children }: { children: ReactNode }) {
  const [executionId, setExecutionId] = useState<string | null>(null);

  const open = useCallback((id: string) => setExecutionId(id), []);
  const close = useCallback(() => setExecutionId(null), []);
  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ExecutionLogDrawerContext.Provider value={value}>
      {children}
      <ExecutionLogDrawer executionId={executionId} onClose={close} />
    </ExecutionLogDrawerContext.Provider>
  );
}

export function useExecutionLogDrawer(): ExecutionLogDrawerContextValue {
  const ctx = useContext(ExecutionLogDrawerContext);
  if (!ctx) {
    throw new Error('useExecutionLogDrawer must be used within an ExecutionLogDrawerProvider');
  }
  return ctx;
}
