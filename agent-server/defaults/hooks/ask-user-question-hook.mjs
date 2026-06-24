#!/usr/bin/env node
// @cortex-hook-version 2026.6.22-2
// input:  stdin Claude Code PreToolUse event, node:http
// output: stdout updatedInput containing user answers received from Slack
// pos:    PreToolUse hook: intercept AskUserQuestion and forward to Slack to collect answers
// >>> If I am updated, be sure to update my header comment and the CLAUDE.md in the same folder <<<

import http from 'node:http';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const hookInput = JSON.parse(input);
  const channel = process.env.SLACK_CHANNEL;
  const port = parseInt(process.env.WEBHOOK_PORT || '3001', 10);
  const sessionId = hookInput.session_id;
  const questions = hookInput.tool_input?.questions;

  if (!channel || !questions?.length) {
    // No channel or no questions — let Claude handle natively
    process.exit(1);
  }

  const threadId = process.env.CORTEX_THREAD_ID || null;
  const body = JSON.stringify({ sessionId, channel, threadId, questions });

  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/hook/ask-user-question',
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
    // Server reported an error (e.g. timeout) — fallback
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: {
        ...hookInput.tool_input,
        answers: response.answers || {},
      },
    },
  }));
}

main().catch(() => process.exit(1));
