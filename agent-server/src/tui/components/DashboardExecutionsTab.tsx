// input:  TabData for executions tab
// output: Executions list — status badge + type + machine + duration + cost
// pos:    Dashboard tab: read-only execution list with disabled mutation buttons

import React from 'react';
import { Box, Text } from 'ink';
import type { TabData } from '../hooks/useDashboardData.js';

interface DashboardExecutionsTabProps {
  data: TabData;
}

export function DashboardExecutionsTab({ data }: DashboardExecutionsTabProps): React.JSX.Element {
  if (data.loading && data.data.length === 0) {
    return <Text dimColor>Loading executions...</Text>;
  }
  if (data.error) {
    return <Text color="red">Error: {data.error}</Text>;
  }
  if (data.data.length === 0) {
    return <Text dimColor>No executions</Text>;
  }

  return (
    <Box flexDirection="column">
      {data.data.map((exec: any, i: number) => (
        <Box key={exec.id ?? i} flexDirection="column" marginBottom={1}>
          <Box>
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
          <Box marginLeft={2}>
            <Text dimColor>[cancel] Phase 3</Text>
          </Box>
        </Box>
      ))}
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
