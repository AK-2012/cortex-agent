// input:  Ink stdin event emitter (raw input chunks)
// output: invokes onUp/onDown for mouse-wheel SGR events
// pos:    Mouse-wheel scrolling for the M5 Ink client transcript
//
// SGR mouse tracking is enabled in index.tsx (enterFullscreen writes `?1000h;?1006h`). Ink's
// App reads stdin and re-emits each raw chunk on an internal emitter (the same feed useInput
// consumes). We subscribe to that feed and decode wheel events (button 64=up, 65=down) without
// disturbing Ink. The escape residue Ink forwards to useInput as text is dropped by the input
// box via logic.isMouseSequence.

import { useEffect } from 'react';
import { useStdin } from 'ink';
import { parseWheelEvents } from '../logic.js';

export function useMouseScroll(onUp: () => void, onDown: () => void): void {
  // `internal_eventEmitter` is how Ink fans out raw stdin chunks (see ink/use-input.js).
  const emitter = (useStdin() as unknown as { internal_eventEmitter?: NodeJS.EventEmitter }).internal_eventEmitter;

  useEffect(() => {
    if (!emitter) return;
    const onChunk = (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const dir of parseWheelEvents(s)) {
        if (dir === 'up') onUp();
        else onDown();
      }
    };
    emitter.on('input', onChunk);
    return () => { emitter.removeListener('input', onChunk); };
  }, [emitter, onUp, onDown]);
}
