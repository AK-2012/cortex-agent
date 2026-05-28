// input:  TabData for threads tab
// output: Threads list — status icon + template name + step progress
// pos:    Dashboard tab: read-only thread list
//         [c] key opens ConfirmModal → threads.cancel mutate via mutate prop

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TabData } from '../hooks/useDashboardData.js';
import type { MutateResult } from '../hooks/useMutate.js';
import { ConfirmModal } from './ConfirmModal.js';

interface ThreadRow {
  id: string;
  templateName?: string;
  status: string;
  currentStep?: { name?: string; index: number; totalSteps: number } | null;
  totalSteps?: number;
}

interface DashboardThreadsTabProps {
  data: TabData;
  mutate?: (op: string, args: Record<string, unknown>) => Promise<MutateResult>;
}

export function DashboardThreadsTab({ data, mutate }: DashboardThreadsTabProps): React.JSX.Element {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null);
  const [alreadyTerminalRows, setAlreadyTerminalRows] = useState<Set<number>>(new Set());
  const feedbackTimeoutRef = useRef<(() => void) | null>(null);

  // Cleanup feedback timeout on unmount
  useEffect(() => {
    return () => {
      feedbackTimeoutRef.current?.();
    };
  }, []);

  // Clamp focused index when data shrinks
  useEffect(() => {
    if (data.data.length > 0 && focusedIndex >= data.data.length) {
      setFocusedIndex(data.data.length - 1);
    }
  }, [data.data.length, focusedIndex]);

  useInput((input, key) => {
    if (confirmingIndex !== null) return;
    if (data.data.length === 0) return;

    if (key.upArrow) {
      setFocusedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setFocusedIndex(prev => Math.min(data.data.length - 1, prev + 1));
    } else if (input === 'c' && !key.ctrl) {
      setConfirmingIndex(focusedIndex);
    }
  });

  if (data.loading && data.data.length === 0) {
    return <Text dimColor>Loading threads...</Text>;
  }
  if (data.error) {
    return <Text color="red">Error: {data.error}</Text>;
  }
  if (data.data.length === 0) {
    return <Text dimColor>No threads</Text>;
  }

  const thread: ThreadRow | null = confirmingIndex !== null ? (data.data[confirmingIndex] as ThreadRow) : null;

  return (
    <Box flexDirection="column">
      {confirmingIndex !== null && thread ? (
        <ConfirmModal
          title="Cancel thread?"
          body={`${thread.templateName ?? 'unnamed'} — ${thread.currentStep?.name ?? ''} (${thread.status})`}
          onConfirm={async () => {
            if (!mutate) return;
            const result = await mutate('threads.cancel', { threadId: thread.id });
            if (result.ok === false && result.error.code === 'already-terminal') {
              const idx = confirmingIndex;
              setAlreadyTerminalRows(prev => new Set([...prev, idx]));
              const timer = setTimeout(() => {
                setAlreadyTerminalRows(prev => {
                  const next = new Set(prev);
                  next.delete(idx);
                  return next;
                });
              }, 5000);
              feedbackTimeoutRef.current?.();
              feedbackTimeoutRef.current = () => clearTimeout(timer);
            }
            setConfirmingIndex(null);
          }}
          onCancel={() => setConfirmingIndex(null)}
        />
      ) : (
        data.data.map((t: any, i: number) => (
          <Box key={t.id ?? i} flexDirection="column" marginBottom={1}>
            <Box>
              {i === focusedIndex ? <Text color="cyan">▸ </Text> : <Text>  </Text>}
              <StatusIcon status={t.status} />
              <Text> </Text>
              <Text bold={i === focusedIndex}>{t.templateName ?? 'unnamed'}</Text>
            </Box>
            <Box marginLeft={2}>
              <Text dimColor>
                {t.status}
                {t.currentStep ? ` — step ${t.currentStep.index + 1}/${t.totalSteps}` : ''}
              </Text>
            </Box>
            {alreadyTerminalRows.has(i) ? (
              <Box marginLeft={2}>
                <Text dimColor>(already finished)</Text>
              </Box>
            ) : null}
          </Box>
        ))
      )}
    </Box>
  );
}

function StatusIcon({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'running': return <Text color="green">▶</Text>;
    case 'waiting': return <Text color="yellow">⏳</Text>;
    case 'completed': return <Text color="blue">✓</Text>;
    case 'failed': return <Text color="red">✗</Text>;
    case 'cancelled': return <Text dimColor>⊘</Text>;
    case 'aborted': return <Text color="red">⛔</Text>;
    default: return <Text dimColor>?</Text>;
  }
}
