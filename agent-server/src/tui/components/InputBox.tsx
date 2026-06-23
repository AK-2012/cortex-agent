// input:  ink useInput (custom controlled single-line input)
// output: Message input — always typeable; submission blocked while awaiting a response
// pos:    User text input component
//
// A minimal in-house input replaces ink-text-input here so that Ctrl/Meta combos
// (Ctrl+D dashboard, Ctrl+N notifications, Ctrl+P projects, Ctrl+L clear, Ctrl+C
// cancel) are ignored instead of leaking their letter into the message buffer.
// ink-text-input inserts the bare character for unhandled Ctrl combos, which left a
// stray 'd' in the box every time the dashboard was toggled.

import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  /** While true the user can still type, but Enter does not send (text preserved). */
  awaitingResponse?: boolean;
  /** Whether this input owns the keyboard (false when dashboard/modal has focus). */
  focus?: boolean;
}

export function InputBox({ onSubmit, awaitingResponse, focus = true }: InputBoxProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);

  const handleSubmit = useCallback((text: string) => {
    if (awaitingResponse) return; // block send, keep typed text
    if (text.trim().length === 0) return;
    onSubmit(text);
    setValue('');
    setCursor(0);
  }, [awaitingResponse, onSubmit]);

  useInput((input, key) => {
    // Ignore modifier combos so global hotkeys never leak their letter into the box.
    if (key.ctrl || key.meta) return;
    // Escape / Tab are owned by other zones; arrows up/down scroll the transcript.
    if (key.escape || key.tab || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return;

    if (key.return) {
      handleSubmit(value);
      return;
    }
    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(c => Math.min(value.length, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(v => v.slice(0, cursor - 1) + v.slice(cursor));
        setCursor(c => Math.max(0, c - 1));
      }
      return;
    }
    // Printable input (may be multiple characters on paste).
    if (input && input.length > 0) {
      setValue(v => v.slice(0, cursor) + input + v.slice(cursor));
      setCursor(c => c + input.length);
    }
  }, { isActive: focus });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="single" borderDimColor paddingX={1}>
        <Box flexGrow={1}>
          {value.length === 0 && !focus ? (
            <Text dimColor>Type a message...</Text>
          ) : value.length === 0 ? (
            <Text>
              <Text inverse> </Text>
              <Text dimColor>Type a message...</Text>
            </Text>
          ) : focus ? (
            <Text>
              {value.slice(0, cursor)}
              <Text inverse>{value.slice(cursor, cursor + 1) || ' '}</Text>
              {value.slice(cursor + 1)}
            </Text>
          ) : (
            <Text>{value}</Text>
          )}
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
