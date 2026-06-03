// input:  ink-text-input TextInput (controlled)
// output: Message input — always typeable; submission blocked while awaiting a response
// pos:    User text input component

import React, { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  /** While true the user can still type, but Enter does not send (text preserved). */
  awaitingResponse?: boolean;
  /** Whether this input owns the keyboard (false when dashboard/modal has focus). */
  focus?: boolean;
}

export function InputBox({ onSubmit, awaitingResponse, focus = true }: InputBoxProps): React.JSX.Element {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback((text: string) => {
    if (awaitingResponse) return; // block send, keep typed text
    if (text.trim().length === 0) return;
    onSubmit(text);
    setValue('');
  }, [awaitingResponse, onSubmit]);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="single" borderDimColor paddingX={1}>
        <Box flexGrow={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            focus={focus}
            placeholder="Type a message..."
          />
        </Box>
      </Box>
      {awaitingResponse ? (
        <Text dimColor>Waiting for response — Enter is disabled until the agent replies (Ctrl+C to cancel)</Text>
      ) : !focus ? (
        <Text dimColor>Press Ctrl+D to return to the input</Text>
      ) : null}
    </Box>
  );
}
