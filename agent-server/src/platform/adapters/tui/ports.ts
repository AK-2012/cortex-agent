// input:  nothing (pure structural types)
// output: Port interfaces for TUI adapter layer boundaries
// pos:    Pure types — zero imports from other layers (@store/@domain/@orch)

export interface TranscriptTurn {
  userMessageTs: string;
  userMessageText: string;
  responseMessageTimestamps: string[];
  status: 'processing' | 'completed' | 'superseded';
}

export interface TranscriptData {
  sessionId: string;
  channel: string;
  turns: TranscriptTurn[];
}

/**
 * Per-conduit serial work queue port. The concrete impl (app.ts) wraps the shared
 * @orch/conduit-queue singletons so TUI message work serializes with the rest of
 * the pipeline on the same conduit key.
 */
export interface ConduitQueuePort {
  enqueue(conduitId: string, fn: () => Promise<void>): boolean;
  remove(conduitId: string): void;
}
