// input:  PISpawnOptions (session/prompt/skill/extension paths)
// output: buildSpawnArgs(opts) → pi CLI argv string[]
// pos:    Pure function to construct pi CLI arguments
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export interface PISpawnOptions {
  sessionDir: string;
  /** Session UUID for --session flag.  PI scans --session-dir to find the matching file
   *  by filename or internal session id field — no need for the full file path. */
  sessionId?: string | null;
  /** @deprecated Full path to an existing PI session JSONL file.  Prefer sessionId
   *  which lets PI handle session lookup internally.  Kept for backward compat. */
  sessionPath?: string | null;
  /** Model identifier (e.g. "deepseek-v4-flash[1m]"); context-window suffix is stripped. */
  model?: string | null;
  systemPrompt?: string | null;
  /** Single string or multi-value array; pi args.js:49-51 accepts repeated --append-system-prompt flags. */
  appendSystemPrompt?: string | string[] | null;
  pluginDirs?: string[] | null;
  /** PI extension file paths; each emits a repeated --extension flag (pi args.js:95-98). */
  extensionPaths?: string[] | null;
  /** Extra CLI options from profile (e.g. {"--thinking": "xhigh"}). */
  extraOption?: Record<string, string> | null;
}

/** Strip context-window suffix like "[1m]" from model strings (e.g. "deepseek-v4-flash[1m]" → "deepseek-v4-flash"). */
function stripModelSuffix(model: string): string {
  return model.replace(/\[.*?\]$/, '');
}

export function buildSpawnArgs(opts: PISpawnOptions): string[] {
  const args: string[] = ['--mode', 'rpc', '--session-dir', opts.sessionDir];

  if (opts.model) {
    const cleaned = stripModelSuffix(opts.model);
    args.push('--model', cleaned);
    // PI reads provider config from models.json (written by syncPIModelsJson);
    // force --provider anthropic so the gateway baseUrl is used.
    args.push('--provider', 'anthropic');
  }

  // --session accepts both a UUID (scanned from --session-dir) and a full file path.
  // Prefer sessionId (UUID) — it's robust to PI's internal file naming which may
  // differ from the session UUID.
  if (opts.sessionId && opts.sessionId.length > 0) {
    args.push('--session', opts.sessionId);
  } else if (opts.sessionPath && opts.sessionPath.length > 0) {
    args.push('--session', opts.sessionPath);
  }

  if (opts.systemPrompt && opts.systemPrompt.length > 0) {
    args.push('--system-prompt', opts.systemPrompt);
  }

  if (opts.appendSystemPrompt) {
    const values = Array.isArray(opts.appendSystemPrompt)
      ? opts.appendSystemPrompt
      : [opts.appendSystemPrompt];
    for (const v of values) {
      if (v.length > 0) args.push('--append-system-prompt', v);
    }
  }

  if (opts.pluginDirs) {
    for (const dir of opts.pluginDirs) {
      args.push('--skill', dir);
    }
  }

  if (opts.extensionPaths) {
    for (const ext of opts.extensionPaths) {
      args.push('--extension', ext);
    }
  }

  if (opts.extraOption) {
    for (const [k, v] of Object.entries(opts.extraOption)) args.push(k, v);
  }

  return args;
}
