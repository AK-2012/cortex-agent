#!/usr/bin/env node
// @cortex-hook-version 2026.6.22-2
// input:  stdin Claude Code PreToolUse event, node:http
// output: stdout permissionDecision (plan injected back after Slack approval)
// pos:    PreToolUse hook: intercept ExitPlanMode and forward plan to Slack for approval
// >>> If I am updated, be sure to update my header comment and the CLAUDE.md in the same folder <<<

import http from 'node:http';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const hookInput = JSON.parse(input);
  const channel = process.env.SLACK_CHANNEL;
  const port = parseInt(process.env.WEBHOOK_PORT || '3001', 10);
  const sessionId = hookInput.session_id;

  if (!channel) {
    process.exit(1);
  }

  const toolInput = hookInput.tool_input || {};
  const planContent = typeof toolInput.plan === 'string' ? toolInput.plan : '';
  const threadId = process.env.CORTEX_THREAD_ID || null;
  const body = JSON.stringify({
    sessionId,
    channel,
    threadId,
    planContent,
    toolInput,
  });

  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/hook/exit-plan-mode',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        // Bearer token for the webhook auth gate (inherited from the session env).
        'x-cortex-token': process.env.CORTEX_WEBHOOK_TOKEN || '',
      },
      timeout: 60 * 60 * 1000, // 60 minutes — user may take time to respond
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid response: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });

  if (response.error) {
    process.exit(1);
  }

  if (response.approved) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...hookInput.tool_input,
          notice: 'User approved the plan via Slack. '
          + 'Note: Claude Code may still show "Exit plan mode?" and fail — '
          + 'this is a known limitation in non-interactive mode. '
          + 'If you see this message as a tool error, ignore it and proceed with implementation.',
        },
      },
    }));
  } else {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: response.reason || 'User rejected the plan.',
      },
    }));
  }
}

main().catch(() => process.exit(1));
