// input:  all tui/ modules
// output: barrel — TuiGatewayAdapter + TuiConnection + helpers
// pos:    TUI adapter public API
// >>> If I am updated, update the folder's CORTEX.md <<<

export { TuiGatewayAdapter } from './tui-gateway.js';
export type { TuiAdapterControls } from './tui-gateway.js';
export { TuiConnection } from './tui-connection.js';
export { TuiOutputStream } from './tui-output-stream.js';
export {
  tuiConduitStates,
  getConduitState,
  setConduitState,
  deleteConduitState,
  hasConduitState,
} from './tui-conduit-state.js';
export type { TuiConduitState } from './tui-conduit-state.js';
export { sendProjectReport, sendSystemNotice } from './tui-notifications.js';
export { buildTranscriptReplay } from './tui-transcript.js';
export type { TranscriptMessage, TranscriptData } from './ports.js';
