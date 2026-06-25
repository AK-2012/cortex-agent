// input:  conversation-history.json, sessionId, message events (user / assistant / tool)
// output: ConversationHistoryRepo — Cortex's own backend-independent conversation history
// pos:    Keyed by sessionId (persistent across reconnects, unlike the per-channel
//         conversation-ledger). Records the FULL conversation — user inputs, every
//         assistant message, and every tool call — as the canonical display source for
//         the TUI (and any future replay consumer). Backend-agnostic: fed from the
//         orchestration layer's unified callbacks, identical for Claude / Codex / PI.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import { JsonRepository } from '@core/json-repository.js';
import { STORE_DIR } from '@core/paths.js';

const HISTORY_FILE = path.join(STORE_DIR, 'conversation-history.json');

// --- Types ---

export type HistoryEventType = 'user' | 'assistant' | 'tool';

export interface HistoryEvent {
  type: HistoryEventType;
  /** user / assistant message text (omitted for tool events). */
  text?: string;
  /** tool name (tool events only). */
  toolName?: string;
  /** compact tool input summary (tool events only). */
  toolInput?: string;
  ts: string;
  /** Groups events under the user turn that triggered them. */
  turnIndex: number;
}

export interface SessionHistory {
  sessionId: string;
  sessionName: string | null;
  projectId: string | null;
  backend: string;
  events: HistoryEvent[];
  updatedAt: string;
}

export type HistoryData = Record<string, SessionHistory>;

interface AppendMeta {
  sessionName?: string | null;
  projectId?: string | null;
  backend?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensure(data: HistoryData, sessionId: string, meta: AppendMeta): SessionHistory {
  let h = data[sessionId];
  if (!h) {
    h = {
      sessionId,
      sessionName: meta.sessionName ?? null,
      projectId: meta.projectId ?? null,
      backend: meta.backend ?? 'unknown',
      events: [],
      updatedAt: nowIso(),
    };
    data[sessionId] = h;
  }
  // Late-arriving metadata fills in / refreshes.
  if (meta.sessionName) h.sessionName = meta.sessionName;
  if (meta.projectId) h.projectId = meta.projectId;
  if (meta.backend) h.backend = meta.backend;
  return h;
}

/** Current (most recent) turn index, or -1 when empty. */
function currentTurn(h: SessionHistory): number {
  return h.events.length === 0 ? -1 : h.events[h.events.length - 1].turnIndex;
}

function isPrefixRelated(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

// --- Repo ---

export class ConversationHistoryRepo {
  private repo = new JsonRepository<HistoryData>({
    filePath: HISTORY_FILE,
    defaultValue: () => ({}),
  });

  async getHistory(sessionId: string): Promise<SessionHistory | null> {
    const data = await this.repo.read();
    return data[sessionId] ?? null;
  }

  /** Append a user message — starts a new turn. */
  async appendUser(sessionId: string, opts: AppendMeta & { text: string }): Promise<void> {
    await this.repo.mutate(data => {
      const h = ensure(data, sessionId, opts);
      const turnIndex = currentTurn(h) + 1;
      h.events.push({ type: 'user', text: opts.text, ts: nowIso(), turnIndex });
      h.updatedAt = nowIso();
      return { next: data, result: undefined };
    });
  }

  /**
   * Append an assistant message under the current turn. Streaming backends may invoke
   * this repeatedly with a GROWING string for the same message — when the last event is
   * an assistant message in the same turn and one text is a prefix of the other, replace
   * it with the longer one instead of duplicating.
   */
  async appendAssistant(sessionId: string, opts: AppendMeta & { text: string }): Promise<void> {
    await this.repo.mutate(data => {
      const h = ensure(data, sessionId, opts);
      const turnIndex = Math.max(0, currentTurn(h));
      const last = h.events[h.events.length - 1];
      if (last && last.type === 'assistant' && last.turnIndex === turnIndex && typeof last.text === 'string' && isPrefixRelated(last.text, opts.text)) {
        last.text = opts.text.length >= last.text.length ? opts.text : last.text;
        last.ts = nowIso();
      } else {
        h.events.push({ type: 'assistant', text: opts.text, ts: nowIso(), turnIndex });
      }
      h.updatedAt = nowIso();
      return { next: data, result: undefined };
    });
  }

  /** Append a tool call under the current turn. */
  async appendTool(sessionId: string, opts: AppendMeta & { toolName: string; toolInput?: string }): Promise<void> {
    await this.repo.mutate(data => {
      const h = ensure(data, sessionId, opts);
      const turnIndex = Math.max(0, currentTurn(h));
      h.events.push({ type: 'tool', toolName: opts.toolName, toolInput: opts.toolInput ?? '', ts: nowIso(), turnIndex });
      h.updatedAt = nowIso();
      return { next: data, result: undefined };
    });
  }

  async clear(sessionId: string): Promise<void> {
    await this.repo.mutate(data => {
      delete data[sessionId];
      return { next: data, result: undefined };
    });
  }

  /** Drop the in-memory cache so the next read() fetches from disk. For testing. */
  invalidate(): void {
    this.repo.invalidate();
  }

  /** Wait for any in-flight mutate() to complete. For graceful SIGTERM drain. */
  flush(): Promise<void> {
    return this.repo.flush();
  }
}

export const conversationHistory = new ConversationHistoryRepo();
