// input:  ../adapter.js, ../types.js, ../output-stream.js, ./tui/index.js
// output: CompositeAdapter + FanOutOutputStream + extractTuiAdapter
// pos:    Composite adapter — wraps primary + TUI gateway behind one PlatformAdapter v2 surface
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter } from '../adapter.js';
import type {
  MessageRef,
  MessageContent,
  MessageContext,
  MessageEditContext,
  ActionContext,
  ModalSubmitContext,
  ModalDefinition,
  PlatformCapabilities,
  PlatformFileRef,
  DownloadedFile,
  Destination,
  PostMessageOpts,
  FileUploadOpts,
  ActionElement,
  RichBlock,
} from '../types.js';
import type { OutputStream, MutableRegion, OpenOutputStreamOpts } from '../output-stream.js';
import { TuiGatewayAdapter } from './tui/index.js';

// ── Capability merging ────────────────────────────────────────────

/**
 * Merge two PlatformCapabilities:
 * - threads / messageEdit / fileUpload / reactions: union
 * - modals / richFormatting: intersection
 * - maxMessageLength / maxThreadDepth: min
 */
function mergeCapabilities(a: PlatformCapabilities, b: PlatformCapabilities): PlatformCapabilities {
  return {
    threads: a.threads || b.threads,
    messageEdit: a.messageEdit || b.messageEdit,
    fileUpload: a.fileUpload || b.fileUpload,
    modals: a.modals && b.modals,
    richFormatting: a.richFormatting && b.richFormatting,
    reactions: a.reactions || b.reactions,
    maxMessageLength: Math.min(a.maxMessageLength, b.maxMessageLength),
    maxThreadDepth: Math.min(a.maxThreadDepth, b.maxThreadDepth),
  };
}

// ── FanOutOutputStream ────────────────────────────────────────────

/**
 * OutputStream that broadcasts all operations to an array of sub-streams.
 * Used by CompositeAdapter for project-report destinations.
 */
export class FanOutOutputStream implements OutputStream {
  private _subs: OutputStream[];

  constructor(subs: OutputStream[]) {
    this._subs = subs;
  }

  emitText(text: string): void {
    for (const sub of this._subs) sub.emitText(text);
  }

  openMutable(text: string): MutableRegion {
    const regions = this._subs.map(sub => sub.openMutable(text));
    return {
      update: (t: string) => {
        for (const r of regions) r.update(t);
      },
    };
  }

  async postInteractive(text: string, opts?: { richBlocks?: RichBlock[]; actions?: ActionElement[] }): Promise<MessageRef | null> {
    let first: MessageRef | null = null;
    for (const sub of this._subs) {
      const ref = await sub.postInteractive(text, opts);
      if (ref && !first) first = ref;
    }
    return first;
  }

  async flush(): Promise<void> {
    await Promise.all(this._subs.map(s => s.flush()));
  }

  getRefs(): MessageRef[] {
    return this._subs.flatMap(s => s.getRefs());
  }

  getParentRef(): MessageRef | null {
    return this._subs.length > 0 ? this._subs[0].getParentRef() : null;
  }
}

// ── No-op output stream ───────────────────────────────────────────

function noopOutputStream(): OutputStream {
  return {
    emitText: () => {},
    openMutable: () => ({ update: () => {} }),
    postInteractive: async () => null,
    flush: async () => {},
    getRefs: () => [],
    getParentRef: () => null,
  };
}

// ── CompositeAdapter ──────────────────────────────────────────────

export class CompositeAdapter implements PlatformAdapter {
  readonly name = 'composite';
  readonly capabilities: PlatformCapabilities;

  private _primary: PlatformAdapter;
  private _gateway: TuiGatewayAdapter;

  constructor(primary: PlatformAdapter, gateway: TuiGatewayAdapter) {
    this._primary = primary;
    this._gateway = gateway;
    this.capabilities = mergeCapabilities(primary.capabilities, gateway.capabilities);
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async start(): Promise<void> {
    // gateway.start() handles EADDRINUSE internally (sets _noopOutbound = true).
    // primary failure should bubble.
    await Promise.all([this._primary.start(), this._gateway.start()]);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([this._primary.stop(), this._gateway.stop()]);
  }

  // ── Event registration ──────────────────────────────────────────

  onMessage(handler: (ctx: MessageContext) => Promise<void>): void {
    this._primary.onMessage(handler);
    this._gateway.onMessage(handler);
  }

  onMessageEdit(handler: (ctx: MessageEditContext) => Promise<void>): void {
    this._primary.onMessageEdit(handler);
    this._gateway.onMessageEdit(handler);
  }

  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void {
    this._primary.onAction(actionId, handler);
    this._gateway.onAction(actionId, handler);
  }

  onModalSubmit(callbackId: string, handler: (ctx: ModalSubmitContext) => Promise<void>): void {
    this._primary.onModalSubmit(callbackId, handler);
    this._gateway.onModalSubmit(callbackId, handler);
  }

  // ── Outbound routing helpers ────────────────────────────────────

  /** Route a MessageRef to the correct sub-adapter by conduit prefix. */
  private _adapterForRef(ref: MessageRef): PlatformAdapter {
    return ref.conduit.startsWith('tui') ? this._gateway : this._primary;
  }

  /** Return sub-adapter(s) for a destination (single-target types only). */
  private _adaptersForDest(dest: Destination): PlatformAdapter[] {
    switch (dest.type) {
      case 'interactive-reply':
        return [dest.conduit.startsWith('tui') ? this._gateway : this._primary];
      case 'system-notice':
        return [this._primary];
      default:
        return [this._primary];
    }
  }

  /** Resolve which sub-adapters have a conduit for the given project. */
  private async _getTargetAdaptersForProjectReport(projectId: string): Promise<PlatformAdapter[]> {
    const result: PlatformAdapter[] = [];
    const [primaryConduits, gatewayConduits] = await Promise.all([
      this._primary.getProjectConduits(),
      this._gateway.getProjectConduits(),
    ]);
    if (primaryConduits[projectId]) result.push(this._primary);
    if (gatewayConduits[projectId]) {
      result.push(this._gateway);
    } else if (Object.keys(gatewayConduits).length > 0) {
      // Include gateway for cross-project notification fan-out even when
      // no TUI conduit matches the target projectId
      result.push(this._gateway);
    }
    return result;
  }

  // ── Outbound messaging ──────────────────────────────────────────

  async postMessage(destination: Destination, content: MessageContent, opts?: PostMessageOpts): Promise<MessageRef> {
    if (destination.type === 'project-report') {
      const adapters = await this._getTargetAdaptersForProjectReport(destination.projectId);
      if (adapters.length === 0) return { conduit: '', messageId: '' };
      let first: MessageRef | null = null;
      for (const adapter of adapters) {
        const ref = await adapter.postMessage(destination, content, opts);
        if (!first) first = ref;
      }
      return first!;
    }
    const adapters = this._adaptersForDest(destination);
    if (adapters.length === 0) return { conduit: '', messageId: '' };
    return adapters[0].postMessage(destination, content, opts);
  }

  async updateMessage(ref: MessageRef, content: MessageContent): Promise<void> {
    await this._adapterForRef(ref).updateMessage(ref, content);
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    await this._adapterForRef(ref).deleteMessage(ref);
  }

  async postInteractive(destination: Destination, content: MessageContent & { actions: ActionElement[] }, opts?: PostMessageOpts): Promise<MessageRef> {
    if (destination.type === 'project-report') {
      const adapters = await this._getTargetAdaptersForProjectReport(destination.projectId);
      if (adapters.length === 0) return { conduit: '', messageId: '' };
      let first: MessageRef | null = null;
      for (const adapter of adapters) {
        const ref = await adapter.postInteractive(destination, content, opts);
        if (!first) first = ref;
      }
      return first!;
    }
    const adapters = this._adaptersForDest(destination);
    if (adapters.length === 0) return { conduit: '', messageId: '' };
    return adapters[0].postInteractive(destination, content, opts);
  }

  async openModal(triggerId: string, modal: ModalDefinition): Promise<void> {
    if (triggerId.startsWith('tui:')) {
      await this._gateway.openModal(triggerId, modal);
    } else {
      await this._primary.openModal(triggerId, modal);
    }
  }

  async markQueued(ref: MessageRef): Promise<void> {
    await this._adapterForRef(ref).markQueued(ref);
  }

  async uploadFile(destination: Destination, filePath: string, opts?: FileUploadOpts): Promise<void> {
    if (destination.type === 'project-report') {
      const adapters = await this._getTargetAdaptersForProjectReport(destination.projectId);
      for (const adapter of adapters) {
        await adapter.uploadFile(destination, filePath, opts);
      }
      return;
    }
    const adapters = this._adaptersForDest(destination);
    if (adapters.length === 0) return;
    await adapters[0].uploadFile(destination, filePath, opts);
  }

  async downloadFile(fileRef: PlatformFileRef, destDir: string): Promise<DownloadedFile> {
    // TUI files are already local (returned as-is); primary handles downloads for Slack/Feishu.
    // Route to primary since PlatformFileRef has no conduit field for routing.
    return this._primary.downloadFile(fileRef, destDir);
  }

  async getPermalink(ref: MessageRef): Promise<string | null> {
    return this._adapterForRef(ref).getPermalink(ref);
  }

  // ── Output streams ──────────────────────────────────────────────

  openOutputStream(destination: Destination, opts?: OpenOutputStreamOpts): OutputStream {
    if (destination.type === 'project-report') {
      // Open a sub-stream per sub-adapter; each sub-adapter's internal
      // destination resolution will handle conduit lookups.
      const primarySub = this._primary.openOutputStream(destination, opts);
      const gatewaySub = this._gateway.openOutputStream(destination, opts);
      return new FanOutOutputStream([primarySub, gatewaySub]);
    }
    const adapters = this._adaptersForDest(destination);
    if (adapters.length === 0) return noopOutputStream();
    return adapters[0].openOutputStream(destination, opts);
  }

  // ── Project conduit mapping ─────────────────────────────────────

  async bindProjectConduit(projectId: string, conduitHint: string): Promise<void> {
    if (conduitHint.startsWith('tui')) {
      await this._gateway.bindProjectConduit(projectId, conduitHint);
    } else {
      await this._primary.bindProjectConduit(projectId, conduitHint);
    }
  }

  async unbindProjectConduit(projectId: string): Promise<void> {
    await this._primary.unbindProjectConduit(projectId);
    await this._gateway.unbindProjectConduit(projectId);
  }

  async getProjectConduits(): Promise<Record<string, string>> {
    const [primary, gateway] = await Promise.all([
      this._primary.getProjectConduits(),
      this._gateway.getProjectConduits(),
    ]);
    // Primary wins on collision for legacy compat
    return { ...gateway, ...primary };
  }

  async resolveInboundProject(conduit: string): Promise<string | null> {
    // Try gateway first (newer/dynamic, in-memory), then primary (durable/file-backed)
    const fromGateway = await this._gateway.resolveInboundProject(conduit);
    if (fromGateway) return fromGateway;
    return this._primary.resolveInboundProject(conduit);
  }
}

// ── extractTuiAdapter ─────────────────────────────────────────────

/**
 * Extract the TuiGatewayAdapter from an adapter.
 * - CompositeAdapter: return the inner gateway
 * - TuiGatewayAdapter: return itself
 * - otherwise: return null
 */
export function extractTuiAdapter(adapter: PlatformAdapter): TuiGatewayAdapter | null {
  if (adapter instanceof CompositeAdapter) {
    return (adapter as any)._gateway as TuiGatewayAdapter;
  }
  if (adapter instanceof TuiGatewayAdapter) {
    return adapter;
  }
  return null;
}
