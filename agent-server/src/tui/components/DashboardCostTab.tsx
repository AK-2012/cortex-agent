// input:  TabData for cost tab
// output: Cost summary — total cost, cost by model, budget remaining
// pos:    Dashboard tab: read-only cost summary (no row navigation, no mutation buttons)

import React from 'react';
import { Box, Text } from 'ink';
import type { TabData } from '../hooks/useDashboardData.js';

interface DashboardCostTabProps {
  data: TabData;
}

export function DashboardCostTab({ data }: DashboardCostTabProps): React.JSX.Element {
  if (data.loading && data.data.length === 0) {
    return <Text dimColor>Loading cost summary...</Text>;
  }
  if (data.error) {
    return <Text color="red">Error: {data.error}</Text>;
  }
  if (!data.data || (Array.isArray(data.data) && data.data.length === 0)) {
    return <Text dimColor>No cost data</Text>;
  }

  // data.data might be a CostSummary object — handle both array and object
  const costData: any = Array.isArray(data.data) ? data.data[0] : data.data;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Cost Summary</Text>
      </Box>

      {costData?.totalCost != null ? (
        <Box>
          <Text>Total: </Text>
          <Text bold>${typeof costData.totalCost === 'number' ? costData.totalCost.toFixed(4) : costData.totalCost}</Text>
        </Box>
      ) : null}

      {costData?.monthlyCost != null ? (
        <Box>
          <Text>This month: </Text>
          <Text bold>${typeof costData.monthlyCost === 'number' ? costData.monthlyCost.toFixed(4) : costData.monthlyCost}</Text>
        </Box>
      ) : null}

      {costData?.dailyCost != null ? (
        <Box>
          <Text>Today: </Text>
          <Text bold>${typeof costData.dailyCost === 'number' ? costData.dailyCost.toFixed(4) : costData.dailyCost}</Text>
        </Box>
      ) : null}

      {/* Per-model breakdown */}
      {costData?.models && typeof costData.models === 'object' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>By model:</Text>
          {Object.entries(costData.models).map(([model, cost]: [string, any]) => (
            <Box key={model} marginLeft={1}>
              <Text dimColor>{model}: </Text>
              <Text>${typeof cost === 'number' ? cost.toFixed(4) : String(cost)}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {costData?.budgetRemaining != null ? (
        <Box marginTop={1}>
          <Text>Budget remaining: </Text>
          <Text color={costData.budgetRemaining < 1 ? 'red' : 'green'}>
            ${typeof costData.budgetRemaining === 'number' ? costData.budgetRemaining.toFixed(4) : costData.budgetRemaining}
          </Text>
        </Box>
      ) : null}

      {costData?.totalCost == null && costData?.monthlyCost == null && (!costData?.models || Object.keys(costData.models).length === 0) ? (
        <Text dimColor>No cost summary available</Text>
      ) : null}
    </Box>
  );
}
