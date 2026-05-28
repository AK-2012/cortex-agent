// input:  TabData for executions tab + optional mutate for cancel
// output: Executions list — status badge + type + machine + duration + cost + cancel via [c]
// pos:    Dashboard tab: execution list with per-row cancel mutation

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ConfirmModal } from './ConfirmModal.js';
import type { TabData } from '../hooks/useDashboardData.js';
import type { MutateResult, MutateError } from '../hooks/useMutate.js';

interface DashboardExecutionsTabProps {
  data: TabData;
  mutate?: (op: string, args: Record<string, unknown>) => Promise<MutateResult>;
}

export function DashboardExecutionsTab({ data, mutate }: DashboardExecutionsTabProps): React.JSX.Element {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [notFoundMsg, setNotFoundMsg] = useState<{ index: number; message: string } | null>(null);
  const notFoundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup not-found timer on unmount
  useEffect(() => {
    return () => {
      if (notFoundTimerRef.current) clearTimeout(notFoundTimerRef.current);
    };
  }, []);

  // Capture focusedIndex at confirm trigger (stable across async mutate)
  const confirmIndexRef = useRef(0);

  useInput((input, key) => {
    if (showConfirm) return;

    if (key.upArrow) {
      setFocusedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFocusedIndex(i => Math.min(data.data.length - 1, i + 1));
    } else if (input === 'c') {
      confirmIndexRef.current = focusedIndex;
      setShowConfirm(true);
    }
  });

  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    if (!mutate) return;

    const exec = data.data[confirmIndexRef.current] as any;
    if (!exec?.id) return;

    const result = await mutate('executions.cancel', { executionId: exec.id });
    if (!result.ok) {
      const err = result as MutateError;
      if (err.error.code === 'not-found') {
        setNotFoundMsg({ index: confirmIndexRef.current, message: 'not found' });
        if (notFoundTimerRef.current) clearTimeout(notFoundTimerRef.current);
        notFoundTimerRef.current = setTimeout(() => setNotFoundMsg(null), 5000);
      }
    }
    // ok: subscribe will refresh data — no explicit action needed
  }, [mutate, data.data]);

  const handleCancel = useCallback(() => {
    setShowConfirm(false);
  }, []);

  if (data.loading && data.data.length === 0) {
    return <Text dimColor>Loading executions...</Text>;
  }
  if (data.error) {
    return <Text color="red">Error: {data.error}</Text>;
  }
  if (data.data.length === 0) {
    return <Text dimColor>No executions</Text>;
  }

  // Clamp focused index to valid range
  const safeFocused = Math.min(focusedIndex, data.data.length - 1);

  const focusedExec = showConfirm ? (data.data[confirmIndexRef.current] as any) : null;

  // Build ConfirmModal body from focused execution fields
  let confirmBody = '';
  if (focusedExec) {
    const parts: string[] = [focusedExec.type ?? 'local'];
    if (focusedExec.machine) parts.push(`@${focusedExec.machine}`);
    if (focusedExec.durationMs != null) parts.push(`${(focusedExec.durationMs / 1000).toFixed(1)}s`);
    if (focusedExec.cost != null) {
      parts.push(`$${typeof focusedExec.cost === 'number' ? focusedExec.cost.toFixed(4) : focusedExec.cost}`);
    }
    confirmBody = parts.join(' | ');
  }

  return (
    <Box flexDirection="column">
      {data.data.map((exec: any, i: number) => (
        <Box key={exec.id ?? i} flexDirection="column" marginBottom={1}>
          <Box>
            <Text>{i === safeFocused ? '>' : ' '}</Text>
            <Text> </Text>
            <ExecStatusIcon status={exec.status} />
            <Text> </Text>
            <Text bold>{exec.type ?? 'local'}</Text>
            {exec.machine ? <Text dimColor> @{exec.machine}</Text> : null}
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>
              {exec.durationMs ? `${(exec.durationMs / 1000).toFixed(1)}s` : ''}
              {exec.cost != null ? ` | $${typeof exec.cost === 'number' ? exec.cost.toFixed(4) : exec.cost}` : ''}
              {exec.finishedAt ? ` | ${new Date(exec.finishedAt).toLocaleString()}` : ''}
            </Text>
          </Box>
          {notFoundMsg?.index === i ? (
            <Box marginLeft={2}>
              <Text color="red">{notFoundMsg.message}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
      {showConfirm && focusedExec ? (
        <ConfirmModal
          title="Cancel execution?"
          body={confirmBody}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      ) : null}
    </Box>
  );
}

function ExecStatusIcon({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'running': return <Text color="green">▶</Text>;
    case 'completed': return <Text color="blue">✓</Text>;
    case 'failed': return <Text color="red">✗</Text>;
    case 'cancelled': return <Text dimColor>⊘</Text>;
    case 'stale': return <Text color="yellow">◷</Text>;
    default: return <Text dimColor>?</Text>;
  }
}
