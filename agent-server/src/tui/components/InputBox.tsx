// input:  ink-text-input UncontrolledTextInput
// output: Multi-line input with submit/cancel for M5 Ink client
// pos:    User text input component

import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { UncontrolledTextInput } from 'ink-text-input';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function InputBox({ onSubmit, onCancel, disabled }: InputBoxProps): React.JSX.Element {
  const handleSubmit = useCallback((text: string) => {
    if (text.trim().length > 0) {
      onSubmit(text);
    }
  }, [onSubmit]);

  return (
    <Box borderStyle="single" borderDimColor paddingX={1} marginTop={1}>
      {disabled ? (
        <Text dimColor>Waiting for response...</Text>
      ) : (
        <Box flexGrow={1}>
          <UncontrolledTextInput
            placeholder="Type a message..."
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  );
}
