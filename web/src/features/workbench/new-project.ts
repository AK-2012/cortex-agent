// input:  a project-name string being typed into the New-project modal, and caught mutation errors
// output: pure helpers for the modal — creatability gate, the prototype's Create-button color, and
//         the honest backend error message to surface
// pos:    New-project modal (prototype.dc.html L1407-1429, task c551). Copy constants are verbatim
//         from the prototype script (npTitle/npHint/npCreateLabel + L.cancel); the input placeholder
//         uses a neutral example project name.

/** Verbatim EN copy from the prototype (ZH toggle is Stage 8). */
export const NP_TITLE = 'New project';
export const NP_BREADCRUMB = 'context/projects/';
export const NP_LABEL = 'PROJECT NAME';
export const NP_PLACEHOLDER = 'nimbus';
export const NP_HINT = 'Becomes context/projects/<name>/ — the agent handles everything else';
export const NP_CREATE_LABEL = 'Create →';
export const NP_CANCEL = 'Cancel';

/** The trimmed name must be non-empty to create (prototype npCreate no-ops on empty). */
export function canCreate(name: string): boolean {
  return name.trim().length > 0;
}

/** Prototype `npCreateBg`: accent when creatable, muted otherwise. */
export function createBg(name: string): '#4655D4' | '#C9CFF2' {
  return canCreate(name) ? '#4655D4' : '#C9CFF2';
}

/**
 * Surface the real backend error verbatim (ProjectStore → tRPC TRPCError message:
 * "Project already exists: X" / "Invalid project name: …"). No fabricated copy — falls back to a
 * neutral message only when the error carries none.
 */
export function createErrorMessage(err: unknown): string {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? (err as { message?: unknown }).message
      : undefined;
  if (typeof message === 'string' && message.trim().length > 0) return message;
  return 'Could not create project.';
}
