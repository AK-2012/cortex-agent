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
import { SlashMenu } from './SlashMenu.js';
import { SLASH_COMMANDS, parseSlashInput, filterSlashCommands, findSlashCommand, type SlashCommand } from '../slash-commands.js';
import {
  historyPrev, historyNext, pushHistory, isMouseSequence,
  cursorToRowCol, moveCursorVertical, sanitizePastedText,
  type InputHistoryState,
} from '../logic.js';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  /** Run a slash command chosen from the palette. */
  onCommand?: (name: string, args: string) => void;
  /** Command registry shown in the palette. Defaults to the built-in set. */
  commands?: SlashCommand[];
  /** While true the user can still type, but Enter does not send (text preserved). */
  awaitingResponse?: boolean;
  /** Whether this input owns the keyboard (false when dashboard/modal has focus). */
  focus?: boolean;
  /** Whether the bottom shortcuts overlay is currently shown (any key dismisses it). */
  showShortcuts?: boolean;
  /** Toggle the shortcuts overlay (fired by '?' on an empty input). */
  onToggleShortcuts?: () => void;
  /** Dismiss the shortcuts overlay (fired by any key while it is shown). */
  onDismissShortcuts?: () => void;
  /** Optional turn-status line (state · time · turns · cost) rendered tight above the input. */
  statusLine?: string | null;
}

export function InputBox({ onSubmit, onCommand, commands = SLASH_COMMANDS, awaitingResponse, focus = true, showShortcuts = false, onToggleShortcuts, onDismissShortcuts, statusLine }: InputBoxProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Input history (shell-style ↑/↓ recall of submitted messages).
  const [history, setHistory] = useState<string[]>([]);
  const [histState, setHistState] = useState<InputHistoryState>({ index: null, draft: '' });

  // The `/` palette is open while the input starts with '/' and owns the keyboard.
  const parsed = parseSlashInput(value);
  const menuOpen = focus && parsed.isSlash && parsed.args.length === 0;
  const matches = menuOpen ? filterSlashCommands(parsed.query, commands) : [];
  const safeSelected = matches.length > 0 ? Math.min(selectedIndex, matches.length - 1) : 0;

  const clear = useCallback(() => {
    setValue('');
    setCursor(0);
    setSelectedIndex(0);
    setHistState({ index: null, draft: '' });
  }, []);

  // Insert literal text at the cursor (used by typing, paste, and newline insertion).
  const insertText = useCallback((text: string) => {
    if (!text) return;
    setValue(v => v.slice(0, cursor) + text + v.slice(cursor));
    setCursor(c => c + text.length);
    setSelectedIndex(0);
    setHistState({ index: null, draft: '' }); // editing detaches history navigation
  }, [cursor]);

  const handleSubmit = useCallback((text: string) => {
    if (awaitingResponse) return; // block send, keep typed text
    if (text.trim().length === 0) return;
    onSubmit(text);
    setHistory(h => pushHistory(h, text));
    clear();
  }, [awaitingResponse, onSubmit, clear]);

  // Apply a history-navigation result to the input buffer.
  const applyHistory = useCallback((next: { value: string; state: InputHistoryState }) => {
    setValue(next.value);
    setCursor(next.value.length);
    setHistState(next.state);
    setSelectedIndex(0);
  }, []);

  // Run a slash command id, or fall back to sending the raw text as a message.
  const runSlash = useCallback(() => {
    const exact = findSlashCommand(parsed.query, commands);
    const chosen = exact ?? matches[safeSelected] ?? null;
    if (chosen && onCommand) {
      onCommand(chosen.name, parsed.args);
      clear();
      return;
    }
    // No matching command — send the typed text through as a normal message so the
    // server's own command dispatch (or a plain message) still gets a chance.
    handleSubmit(value);
  }, [parsed.query, parsed.args, matches, safeSelected, onCommand, commands, handleSubmit, value, clear]);

  const isMultiline = value.includes('\n');
  // Cursor position as (row, col) for the multi-line render below.
  const { row: cursorRow, col: cursorCol } = cursorToRowCol(value, cursor);

  useInput((input, key) => {
    // While the shortcuts overlay is shown, ANY key just dismisses it (no other action).
    if (showShortcuts) { onDismissShortcuts?.(); return; }

    // ── Newline insertion (multi-line input) ──
    // Alt/Option+Enter inserts a literal newline (terminal-dependent). The terminal-agnostic
    // fallback is a trailing backslash + Enter (handled in the Enter branch below).
    if (key.return && key.meta) { insertText('\n'); return; }

    // ── Bracketed paste (unambiguous: wrapped in ESC[200~ … ESC[201~) ──
    // Strip the markers + escape residue and insert literally (newlines included) so a
    // multi-line paste never submits per embedded Enter. Handled before the modifier guard
    // (a paste carries no ctrl/meta) but before navigation it cannot be mistaken for a key.
    if (input.includes('\x1b[200~') || input.includes('\x1b[201~')) {
      insertText(sanitizePastedText(input));
      return;
    }

    // Ignore modifier combos so global hotkeys never leak their letter into the box.
    if (key.ctrl || key.meta) return;

    // ── Palette navigation (only while the menu owns the input) ──
    if (menuOpen) {
      if (key.upArrow) { setSelectedIndex(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSelectedIndex(i => Math.min(Math.max(0, matches.length - 1), i + 1)); return; }
      if (key.escape) { clear(); return; }
      if (key.tab) {
        // Complete the highlighted command into the buffer (ready for args).
        const chosen = matches[safeSelected];
        if (chosen) {
          const next = `/${chosen.name} `;
          setValue(next);
          setCursor(next.length);
          setSelectedIndex(0);
        }
        return;
      }
      if (key.return) { runSlash(); return; }
      // fall through to normal editing (typing filters the menu)
    } else {
      // Escape / Tab are owned by other zones; PgUp/PgDn scroll the transcript.
      if (key.escape || key.tab || key.pageUp || key.pageDown) return;
      // ↑/↓: in multi-line input they move the cursor between lines; otherwise they cycle the
      // shell-style input history.
      if (key.upArrow) {
        if (isMultiline) { setCursor(c => moveCursorVertical(value, c, -1)); return; }
        applyHistory(historyPrev(history, histState, value)); return;
      }
      if (key.downArrow) {
        if (isMultiline) { setCursor(c => moveCursorVertical(value, c, 1)); return; }
        applyHistory(historyNext(history, histState, value)); return;
      }
      if (key.return) {
        // Trailing backslash + Enter → newline (terminal-agnostic multi-line entry).
        if (cursor > 0 && value[cursor - 1] === '\\') {
          setValue(v => v.slice(0, cursor - 1) + '\n' + v.slice(cursor));
          setHistState({ index: null, draft: '' });
          return; // cursor index is unchanged: it now sits just after the inserted newline
        }
        // A slash invocation with args (menu closed) still runs the command, forwarding args.
        if (parsed.isSlash) { runSlash(); return; }
        handleSubmit(value);
        return;
      }
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
        setSelectedIndex(0);
        setHistState({ index: null, draft: '' }); // editing detaches history navigation
      }
      return;
    }
    // Drop mouse-tracking escape residue (e.g. "[<64;30;10M") that Ink forwards as text when
    // SGR mouse mode is on — it must never land in the message buffer.
    if (isMouseSequence(input)) return;
    // A multi-character chunk (terminal without bracketed paste, or a fast paste) is text — insert
    // it literally so multi-line pastes keep their newlines instead of triggering a submit.
    if (input.length > 1) { insertText(sanitizePastedText(input)); return; }
    // '?' on an empty input toggles the shortcuts overlay instead of typing a literal '?'.
    if (input === '?' && value.length === 0 && !menuOpen) {
      onToggleShortcuts?.();
      return;
    }
    // Single printable character.
    if (input && input.length > 0) {
      insertText(input);
    }
  }, { isActive: focus });

  return (
    <Box flexDirection="column" marginTop={1}>
      {menuOpen ? <SlashMenu commands={matches} selectedIndex={safeSelected} /> : null}
      {/* Turn-status line sits directly on top of the input border (no gap). */}
      {statusLine ? <Text dimColor>{statusLine}</Text> : null}
      <Box borderStyle="single" borderDimColor paddingX={1}>
        <Box flexDirection="column" flexGrow={1}>
          {value.length === 0 && !focus ? (
            <Text dimColor>Type a message...</Text>
          ) : value.length === 0 ? (
            <Text>
              <Text inverse> </Text>
              <Text dimColor>Type a message...</Text>
            </Text>
          ) : (
            // Multi-line aware: render each logical line; on the cursor's row draw the inverse
            // cursor block. A single-line value collapses to one row (identical to the old look).
            value.split('\n').map((line, r) => {
              if (focus && r === cursorRow) {
                return (
                  <Text key={r}>
                    {line.slice(0, cursorCol)}
                    <Text inverse>{line.slice(cursorCol, cursorCol + 1) || ' '}</Text>
                    {line.slice(cursorCol + 1)}
                  </Text>
                );
              }
              return <Text key={r}>{line.length > 0 ? line : ' '}</Text>;
            })
          )}
        </Box>
      </Box>
      {awaitingResponse ? (
        <Text dimColor>Waiting for response — Enter is disabled until the agent replies (Ctrl+C to cancel)</Text>
      ) : null}
    </Box>
  );
}
