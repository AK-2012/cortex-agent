// input:  MCP SDK, remote-ops + time + thread control + task-monitor tool modules
// output: MCP stdio service, exposing remote_* tools, current_time, thread control tools, task_* tools
// pos:    Core MCP server — thread agents load only this one (no Slack/cost/schedule tools).
//         Delegation is via the task system (cortex-task CLI); thread control tools (abort/split/wait)
//         let an agent steer its own thread; task_* tools monitor tasks. The agent-facing thread
//         spawn/monitor tools (thread_start + status/result/list/list_templates/cancel) were removed.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTaskOpsTools } from './tools/task-ops.js';
import { registerTimeTools } from './tools/time.js';
import { registerThreadTools } from './tools/thread-ops.js';
import { registerTaskMonitorTools } from './tools/task-monitor.js';
import { registerManagerQaTools } from './tools/manager-qa.js';
import { isMainModule } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { CORTEX_VERSION } from '@core/version.js';

const log = createLogger('mcp-core');

// --- McpServer + tool registration ---

const server = new McpServer({ name: 'cortex-core', version: CORTEX_VERSION });

registerTaskOpsTools(server);
registerTimeTools(server);
registerThreadTools(server);
registerTaskMonitorTools(server);
registerManagerQaTools(server);

// --- Exported tool name list (for verification) ---

export const TOOL_NAMES: readonly string[] = [
  'remote_bash',
  'remote_read',
  'remote_write',
  'remote_edit',
  'remote_glob',
  'remote_grep',
  'current_time',
  // DR-0015 control plane: an agent signals its own thread (abort / split / wait).
  'thread_abort',
  'thread_split',
  'thread_wait',
  // Task monitoring (delegation itself is via the cortex-task CLI).
  'task_status',
  'task_result',
  'task_list',
  // DR-0016 up-ask channel: a subtask asks its manager (or a human) a clarifying question.
  'ask_manager',
  'answer_subtask',
];

// --- Start (called by barrel when run as standalone) ---

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule(import.meta.url)) {
  startServer().catch((e) => {
    log.error(e);
    process.exit(1);
  });
}
