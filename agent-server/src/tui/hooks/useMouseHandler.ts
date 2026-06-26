// input:  Ink stdin event emitter (raw input chunks)
// output: Unified mouse handler — wheel scroll, text selection, right-click
// pos:    Replaces useMouseScroll; handles all SGR mouse events for the M5 Ink TUI
//
// SGR mouse tracking is enabled in index.tsx (enterFullscreen writes `?1002h;?1006h`). With
// ?1002h (button-event tracking), the terminal sends motion events ONLY while a button is held
// (drag), plus press/release. This hook decodes all SGR events from Ink's internal emitter and
// dispatches to the appropriate callback: wheel scroll, selection (left-drag), or right-click.

import { useEffect, useRef, useState } from 'react';
import { useStdin } from 'ink';
import { parseAllMouseEvents } from '../logic.js';

export interface SelectionRange {
  startRow: number; startCol: number; // screen coordinates, 0-based
  endRow: number; endCol: number;
}

export interface UseMouseHandlerOpts {
  onScrollUp: () => void;
  onScrollDown: () => void;
  onSelectionComplete?: (range: SelectionRange) => void;
  onRightClick?: () => void;
}

export function useMouseHandler(opts: UseMouseHandlerOpts): { selection: SelectionRange | null } {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Selection state: active means a left-button drag is in progress
  const dragRef = useRef<{ active: boolean; startRow: number; startCol: number; endRow: number; endCol: number }>({
    active: false, startRow: 0, startCol: 0, endRow: 0, endCol: 0,
  });
  // React state for rendering (updated on drag/release to trigger re-render)
  const [selection, setSelection] = useState<SelectionRange | null>(null);

  const emitter = (useStdin() as unknown as { internal_eventEmitter?: NodeJS.EventEmitter }).internal_eventEmitter;

  useEffect(() => {
    if (!emitter) return;
    const onChunk = (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const evt of parseAllMouseEvents(s)) {
        if (evt.type === 'wheel') {
          if ((evt.button & 1) === 0) optsRef.current.onScrollUp();
          else optsRef.current.onScrollDown();
          continue;
        }
        if (evt.type === 'press' && evt.button === 0) {
          // Left press: start selection
          dragRef.current = { active: true, startRow: evt.row, startCol: evt.col, endRow: evt.row, endCol: evt.col };
          setSelection(null); // clear any previous selection highlight
          continue;
        }
        if (evt.type === 'drag' && evt.button === 0 && dragRef.current.active) {
          // Left drag: update end position
          dragRef.current.endRow = evt.row;
          dragRef.current.endCol = evt.col;
          setSelection({
            startRow: dragRef.current.startRow, startCol: dragRef.current.startCol,
            endRow: evt.row, endCol: evt.col,
          });
          continue;
        }
        if (evt.type === 'release' && evt.button === 0 && dragRef.current.active) {
          // Left release: finalize selection
          dragRef.current.active = false;
          const { startRow, startCol } = dragRef.current;
          const endRow = evt.row, endCol = evt.col;
          // Only emit if the selection spans more than a single click (drag distance > 0)
          if (startRow !== endRow || startCol !== endCol) {
            optsRef.current.onSelectionComplete?.({ startRow, startCol, endRow, endCol });
          }
          // Keep selection visible briefly (App clears it after the toast)
          setSelection({ startRow, startCol, endRow, endCol });
          continue;
        }
        if (evt.type === 'press' && evt.button === 2) {
          optsRef.current.onRightClick?.();
          continue;
        }
      }
    };
    emitter.on('input', onChunk);
    return () => { emitter.removeListener('input', onChunk); };
  }, [emitter]);

  return { selection };
}
