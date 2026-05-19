// input:  fs, path, SERVER_ROOT, CONFIG_DIR
// output: generateMcpConfig — writes mcp-config.json to config dir
// pos:    Startup-time MCP config auto-generation (P4)

import { writeFileSync } from 'fs';
import * as path from 'path';
import { SERVER_ROOT, CONFIG_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';

const log = createLogger('config-generator');

const MCP_CONFIG_PATH = path.join(CONFIG_DIR, 'mcp-config.json');
const CORE_MCP_CONFIG_PATH = path.join(CONFIG_DIR, 'mcp-config-core.json');
const TUI_MCP_CONFIG_PATH = path.join(CONFIG_DIR, 'mcp-config-tui.json');

/**
 * Build a MCP server entry. Uses absolute path in args as a workaround for
 * Claude Code 2.1.123: the `cwd` field in MCP config is NOT inherited by the
 * spawned process, so relative paths silently fail ("status":"failed").
 */
function serverEntry(script: string, serverRoot: string) {
  return {
    command: 'node',
    args: [path.join(serverRoot, script)],
    cwd: serverRoot,
  };
}

/** Full MCP config with both servers — loaded by user-initiated (direct) sessions. */
export function buildFullConfig(serverRoot: string): object {
  return {
    mcpServers: {
      'cortex-core': serverEntry('dist/domain/mcp/core-server.js', serverRoot),
      'cortex-ext': serverEntry('dist/domain/mcp/server.js', serverRoot),
    },
  };
}

/** Core-only MCP config — loaded by thread sessions (only remote_* tools). */
export function buildCoreConfig(serverRoot: string): object {
  return {
    mcpServers: {
      'cortex-core': serverEntry('dist/domain/mcp/core-server.js', serverRoot),
    },
  };
}

/** TUI MCP config — loaded ONLY by Claude TUI-mode sessions (DR-0012). Isolated tool set:
 *  cortex_plan_enter / cortex_plan_exit / cortex_ask_user replace the native
 *  EnterPlanMode / ExitPlanMode / AskUserQuestion tools, which are excluded from --tools in TUI mode. */
export function buildTuiConfig(serverRoot: string): object {
  return {
    mcpServers: {
      'cortex-tui-bridge': serverEntry('dist/domain/mcp/tui-server.js', serverRoot),
    },
  };
}

export function generateMcpConfig(): void {
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(buildFullConfig(SERVER_ROOT), null, 2));
  log.info(`Generated full MCP config at ${MCP_CONFIG_PATH}`);

  writeFileSync(CORE_MCP_CONFIG_PATH, JSON.stringify(buildCoreConfig(SERVER_ROOT), null, 2));
  log.info(`Generated core MCP config at ${CORE_MCP_CONFIG_PATH}`);

  writeFileSync(TUI_MCP_CONFIG_PATH, JSON.stringify(buildTuiConfig(SERVER_ROOT), null, 2));
  log.info(`Generated TUI MCP config at ${TUI_MCP_CONFIG_PATH}`);
}
