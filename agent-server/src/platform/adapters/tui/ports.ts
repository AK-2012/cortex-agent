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
