// input:  codex JSON-RPC event method/params
// output: CODEX_LOG_MODE / shouldLogCodexEvent / formatCodexEvent
// pos:    Codex event log filtering and human-readable rendering
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

const RAW_CODEX_LOG_MODE = String(process.env.CODEX_LOG_MODE || 'summary').toLowerCase();
export const CODEX_LOG_MODE = new Set(['full', 'summary', 'off']).has(RAW_CODEX_LOG_MODE)
  ? RAW_CODEX_LOG_MODE
  : 'summary';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Codex JSON-RPC event params are deeply nested
export type CodexEventParams = any;

function isNoisyCodexLogEvent(method: string): boolean {
  const normalized = String(method || '');
  const lower = normalized.toLowerCase();
  if (normalized.startsWith('codex/event/')) return true;
  if (lower.includes('delta')) return true;
  if (normalized === 'thread/tokenUsage/updated') return true;
  if (normalized === 'account/rateLimits/updated') return true;
  return false;
}

export function shouldLogCodexEvent(method: string): boolean {
  if (CODEX_LOG_MODE === 'off') return false;
  if (CODEX_LOG_MODE === 'full') return true;
  return !isNoisyCodexLogEvent(method);
}

function formatExecCompleted(item: CodexEventParams): string {
  const cmd = (item?.command || '').replace(/\s+/g, ' ').trim();
  const out = (item?.aggregatedOutput || '').replace(/\s+/g, ' ').trim();
  const cmdPreview = cmd.length > 120 ? `${cmd.substring(0, 120)}...` : cmd;
  const outPreview = out ? (out.length > 180 ? `${out.substring(0, 180)}...` : out) : '';
  const meta = `exit=${item?.exitCode ?? 'n/a'}, durMs=${item?.durationMs ?? 'n/a'}`;
  return outPreview
    ? `[exec/completed] ${meta}, cmd=${cmdPreview}, out=${outPreview}`
    : `[exec/completed] ${meta}, cmd=${cmdPreview}`;
}

function formatItemCompleted(params: CodexEventParams): string {
  const item = params?.item;
  if (item?.type === 'agentMessage') {
    const text = (item?.text || '').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 240 ? `[agent/final] ${text.substring(0, 240)}...` : `[agent/final] ${text}`;
  }
  if (item?.type === 'commandExecution') return formatExecCompleted(item);
  return `[item/completed] type=${item?.type}, status=${item?.status}`;
}

const CODEX_EVENT_FORMATTERS: Record<string, (p: CodexEventParams) => string> = {
  'turn/started':        (p) => `[turn/started] id=${p?.turn?.id}`,
  'turn/completed':      (p) => { const s = p?.turn?.status; const e = p?.turn?.error?.message; return `[turn/completed] status=${s}${e ? ' error=' + e : ''}`; },
  'turn/plan/updated':   (p) => { const steps = (p?.plan || []).map((s: { status: string; step: string }) => `  ${s.status === 'completed' ? 'v' : s.status === 'inProgress' ? '>' : 'o'} ${s.step}`).join('\n'); return `[plan]\n${steps}`; },
  'item/started':        (p) => `[item/started] type=${p?.item?.type}, id=${p?.item?.id}`,
  'item/completed':      formatItemCompleted,
  'thread/tokenUsage/updated': (p) => { const u = p?.tokenUsage?.total; return `[tokens] input=${u?.inputTokens}, output=${u?.outputTokens}, total=${u?.totalTokens}`; },
  'thread/status/changed':     (p) => `[thread/status] ${p?.status?.type}`,
};

export function formatCodexEvent(method: string, params: CodexEventParams): string | null {
  if (!shouldLogCodexEvent(method)) return null;
  const formatter = CODEX_EVENT_FORMATTERS[method];
  if (formatter) return formatter(params);
  return `[${method}] ${JSON.stringify(params).substring(0, 150)}`;
}
