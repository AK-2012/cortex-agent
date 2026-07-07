// input:  process.env (CORTEX_DESKTOP_SERVER_URL, CORTEX_DESKTOP_TOKEN)
// output: ConfigStore interface + env-based accessor
// pos:    Config abstraction for the loopback proxy. The env-based implementation is
//         used for dev/testing; the connect sub-task replaces it with safeStorage
//         persistence. All proxy code depends on the interface, never on env directly.

/** Configuration the loopback proxy needs to reach the upstream Cortex server. */
export interface ConfigStore {
  /** Base URL of the remote agent-server (e.g. https://cortex.example.com or http://127.0.0.1:3004). */
  serverUrl: string;
  /** x-cortex-token value injected into every /trpc request forwarded to serverUrl. */
  token: string;
}

/**
 * Returns config from environment variables. Used as the default in dev and testing.
 * Set CORTEX_DESKTOP_SERVER_URL and CORTEX_DESKTOP_TOKEN in the shell before `pnpm dev`.
 */
export function getConfig(): ConfigStore {
  return {
    serverUrl: (process.env['CORTEX_DESKTOP_SERVER_URL'] ?? 'http://127.0.0.1:3004').replace(
      /\/$/,
      '',
    ),
    token: process.env['CORTEX_DESKTOP_TOKEN'] ?? '',
  };
}
