// input:  Resumable sessions list + selection callback
// output: Session picker for --resume mode — ↑/↓/Enter to select
// pos:    Pick a session to resume before the main App renders

import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ResumableSession {
  sessionId: string;
  name: string;
  projectId: string;
  label: string | null;
}

interface SessionPickerProps {
  sessions: ResumableSession[];
  onSelect: (sessionId: string, projectId: string) => void;
  onCancel: () => void;
}

export function SessionPicker({ sessions, onSelect, onCancel }: SessionPickerProps): React.JSX.Element {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIdx(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIdx(prev => Math.min(sessions.length - 1, prev + 1));
      return;
    }

    if (key.return) {
      const selected = sessions[selectedIdx];
      if (selected) {
        onSelect(selected.sessionId, selected.projectId);
      }
      return;
    }
  });

  if (sessions.length === 0) {
    return <Text dimColor>No resumable sessions</Text>;
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Select a session to resume:</Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((s, i) => (
          <Box key={s.sessionId} marginBottom={0}>
            <Text>{i === selectedIdx ? '▶' : ' '}</Text>
            <Text> </Text>
            <Text bold={i === selectedIdx}>{s.name}</Text>
            <Text dimColor> ({s.projectId})</Text>
            {s.label ? <Text dimColor> — {s.label}</Text> : null}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ navigate · Enter resume · Esc fresh session</Text>
      </Box>
    </Box>
  );
}
