// input:  GitHub push, task-op, thread-op, remote cmd, hook HTTP events
// output: startWebhookServer
// pos:    GitHub/task-op/thread-op/hook webhook HTTP entry point
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { createLogger } from '@core/log.js';
import * as http from 'http';
import * as crypto from 'crypto';
import { readFileSync } from 'fs';
import { taskMutator } from '@domain/tasks/mutator.js';
import { sendCommand, isDeviceOnline, getOnlineDevices } from '@domain/remote/client-manager.js';
import { registerAskQuestion, registerPlanApproval } from './hook-bridge.js';
import { getCurrentPlanFilePath } from '@domain/agents/index.js';
import { ctx as jobCtx } from '@domain/scheduling/job-registry.js';
import { createThread, cancelThread, readArtifact, listTemplates, listAgents } from '@domain/threads/index.js';
import { runThread } from '@domain/threads/runner.js';
import { threadStore } from '@store/thread-repo.js';
import { fireThreadCallback } from '../thread-callback.js';
import type { Destination } from '@platform/index.js';
import type { RunThreadOptions } from '@core/types/thread-types.js';

const log = createLogger('webhook');

const PORT = parseInt(process.env.WEBHOOK_PORT || '3001', 10);
// Read at call time, not import time — dotenv.config() in app.ts runs AFTER ESM imports
function getSecret() { return process.env.GITHUB_WEBHOOK_SECRET || ''; }

function verifySignature(body, signature) {
  const secret = getSecret();
  if (!secret) { log.warn('No GITHUB_WEBHOOK_SECRET configured — skipping signature verification'); return true; }
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
  } catch {
    return false;
  }
}

function hasValidSecret(secret, providedSecret) {
  const secretBuf = Buffer.from(secret || '');
  const providedBuf = Buffer.from(providedSecret || '');
  return !(
    secretBuf.length === 0
    || providedBuf.length !== secretBuf.length
    || !crypto.timingSafeEqual(providedBuf, secretBuf)
  );
}

function readJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      callback(null, body, JSON.parse(body));
    } catch (error) {
      callback(error);
    }
  });
}

// --- Task operation handler (routes remote task mutations through TaskStore) ---

const TASK_OP_HANDLERS = {
  complete: (data) => taskMutator.complete(data.task_id, data.note || ''),
  block: (data) => taskMutator.block(data.task_id, data.reason || 'blocked by remote agent'),
  unblock: (data) => taskMutator.unblock(data.task_id),
  add: (data) => taskMutator.add(data.project, data.text, data.why || '', data.done_when || '', data.priority, data.template, data.depends_on),
  claim: (data) => taskMutator.claim(data.task_id, data.agent || 'remote'),
  unclaim: (data) => taskMutator.unclaim(data.task_id),
  uncomplete: (data) => taskMutator.uncomplete(data.task_id),
  pause: (data) => taskMutator.pause(data.task_id),
  resume: (data) => taskMutator.resume(data.task_id),
};

function createWebhookHandler({
  secret = getSecret(),
}: {
  secret?: string;
} = {}) {
  return (req, res) => {
    // --- Device list query (from MCP sidecar) ---
    if (req.method === 'GET' && req.url === '/webhook/devices') {
      const devices = getOnlineDevices().map(d => d.device);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices }));
      return;
    }

    // --- Remote command proxy (from MCP sidecar → client-manager) ---
    if (req.method === 'POST' && req.url === '/webhook/remote-command') {
      readJsonBody(req, async (error, _body, data) => {
        if (error) {
          res.writeHead(400); res.end('Bad JSON'); return;
        }
        const { device, action, params, timeout } = data;
        if (!device || !action) {
          res.writeHead(400); res.end(JSON.stringify({ success: false, error: 'device and action required' }));
          return;
        }
        if (!isDeviceOnline(device)) {
          const online = getOnlineDevices().map(d => d.device);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Device "${device}" is not online`, onlineDevices: online }));
          return;
        }
        try {
          const result = await sendCommand(device, { action, params: params || {}, timeout });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: result }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: (e as Error).message }));
        }
      });
      return;
    }

    // --- Remote task operation (from MCP sidecar on branch bases) ---
    if (req.method === 'POST' && req.url === '/webhook/task-op') {
      readJsonBody(req, async (error, _body, data) => {
        if (error) {
          res.writeHead(400); res.end('Bad JSON'); return;
        }
        if (!hasValidSecret(secret, data.secret)) {
          res.writeHead(401); res.end('Unauthorized'); return;
        }

        const handler = TASK_OP_HANDLERS[data.op];
        if (!handler) {
          res.writeHead(400); res.end(JSON.stringify({ success: false, message: `Unknown op: ${data.op}` }));
          return;
        }

        try {
          const result = await handler(data);
          log.info(`task-op ${data.op} ${data.task_id || data.project}: ${result.message}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          log.error(`task-op error: ${e.message}`);
          res.writeHead(500); res.end(JSON.stringify({ success: false, message: e.message }));
        }
      });
      return;
    }

    // --- Thread operation (from MCP sidecar → thread system) ---
    // Local-only, no secret (same trust model as /webhook/remote-command). thread_start is
    // fire-and-forget: createThread + runThread().catch() without await, returning the threadId.
    if (req.method === 'POST' && req.url === '/webhook/thread-op') {
      readJsonBody(req, async (error, _body, data) => {
        if (error) { res.writeHead(400); res.end('Bad JSON'); return; }
        const reply = (obj: any) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        try {
          const action = data.action;
          if (action === 'start') {
            const { template, agent, message } = data;
            if ((template && agent) || (!template && !agent)) {
              return reply({ success: false, error: 'provide exactly one of template or agent' });
            }
            if (!message) return reply({ success: false, error: 'message required' });
            const maxDepth = parseInt(process.env.CORTEX_THREAD_MAX_DEPTH || '5', 10) || 5;
            const curDepth = Number(data.depth) || 0;
            if (curDepth >= maxDepth) {
              return reply({ success: false, error: `max thread depth (${maxDepth}) reached — cannot spawn nested thread at depth ${curDepth}` });
            }
            if (!jobCtx.adapter) {
              return reply({ success: false, error: 'no platform adapter available (daemon not fully initialized)' });
            }
            const projectId = data.projectId || 'general';
            const channel = data.channel || projectId;
            const thread = createThread(channel, {
              templateName: template || null,
              agentName: agent || null,
              userMessage: message,
              userMessageTs: `mcp_${Date.now()}`,
              projectId,
              metadata: {
                trigger: 'mcp-thread',
                depth: curDepth + 1,
                parentSessionId: data.parentSessionId || null,
                parentThreadId: data.parentThreadId || null,
                parentChannel: data.parentChannel || null,
                parentProfile: data.parentProfile || null,
              },
            });
            const dest: Destination = { type: 'project-report', projectId, trigger: 'mcp-thread', sessionId: '' };
            const runOpts: RunThreadOptions = {
              adapter: jobCtx.adapter,
              channel,
              destination: dest,
              threadAnchorId: null,
              statusMsg: null,
              startTime: Date.now(),
              onProgress: null,
              onToolUse: null,
            };
            runThread(thread.id, runOpts)
              .catch((e) => log.error(`mcp-thread ${thread.id} failed: ${(e as Error).message}`))
              .finally(() => { void fireThreadCallback(thread.id).catch((e) => log.error(`thread-callback ${thread.id}: ${(e as Error).message}`)); });
            log.info(`thread-op start ${thread.id} (${template || agent}, depth ${curDepth + 1})`);
            return reply({ success: true, data: { threadId: thread.id, status: 'running' } });
          }
          if (action === 'status') {
            const t = threadStore.get(data.threadId);
            if (!t) return reply({ success: false, error: 'thread not found' });
            return reply({ success: true, data: {
              threadId: t.id, status: t.status, activeAgent: t.activeAgent, stepCount: t.steps.length,
              totalCostUsd: t.totalCostUsd, abortReason: t.abortReason, artifactPath: t.artifactPath,
              createdAt: t.createdAt, updatedAt: t.updatedAt, endedAt: t.endedAt, error: t.error,
            } });
          }
          if (action === 'result') {
            const t = threadStore.get(data.threadId);
            if (!t) return reply({ success: false, error: 'thread not found' });
            const terminal = ['completed', 'failed', 'cancelled', 'aborted'].includes(t.status);
            const artifact = readArtifact(t.id);
            const finalOutput = t.steps.length ? t.steps[t.steps.length - 1].output : null;
            return reply({ success: true, data: {
              threadId: t.id, status: t.status, terminal,
              ...(terminal ? {} : { note: 'thread still running — result is partial' }),
              artifact, finalOutput,
            } });
          }
          if (action === 'list') {
            return reply({ success: true, data: {
              templates: listTemplates().map((t) => ({ name: t.name, description: t.description })),
              agents: listAgents().map((a) => ({ name: a.name, description: a.description })),
            } });
          }
          if (action === 'list-threads') {
            const scope = data.scope || 'mine';
            let threads = threadStore.getAll();
            if (scope === 'project') {
              const pid = data.projectId || 'general';
              threads = threads.filter((t) => t.projectId === pid);
            } else {
              // 'mine': threads spawned from the caller's session
              const sid = data.parentSessionId || null;
              threads = sid ? threads.filter((t) => t.metadata?.parentSessionId === sid) : [];
            }
            threads = threads.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            const limit = Number(data.limit) || 50;
            const out = threads.slice(0, limit).map((t) => ({
              threadId: t.id, status: t.status, templateName: t.templateName, activeAgent: t.activeAgent,
              stepCount: t.steps.length, totalCostUsd: t.totalCostUsd,
              createdAt: t.createdAt, updatedAt: t.updatedAt,
              trigger: t.metadata?.trigger ?? null, depth: t.metadata?.depth ?? null,
            }));
            return reply({ success: true, data: { scope, count: out.length, threads: out } });
          }
          if (action === 'cancel') {
            const cancelled = await cancelThread(data.threadId);
            return reply({ success: true, data: { cancelled } });
          }
          return reply({ success: false, error: `unknown action: ${action}` });
        } catch (e) {
          log.error(`thread-op error: ${(e as Error).message}`);
          reply({ success: false, error: (e as Error).message });
        }
      });
      return;
    }

    // --- PreToolUse hook: AskUserQuestion ---
    if (req.method === 'POST' && req.url === '/hook/ask-user-question') {
      readJsonBody(req, async (error, _body, data) => {
        if (error) { res.writeHead(400); res.end('Bad JSON'); return; }
        const { sessionId, channel, questions, dryRun, threadId } = data;
        if (!channel || !questions?.length) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'channel and questions required' }));
          return;
        }
        try {
          const requestId = crypto.randomUUID();
          const result = await registerAskQuestion(requestId, channel, sessionId, questions, dryRun === true, threadId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
      return;
    }

    // --- PreToolUse hook: ExitPlanMode ---
    if (req.method === 'POST' && req.url === '/hook/exit-plan-mode') {
      readJsonBody(req, async (error, _body, data) => {
        if (error) { res.writeHead(400); res.end('Bad JSON'); return; }
        const { sessionId, channel, planContent, toolInput, dryRun, threadId } = data;
        if (!channel) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'channel required' }));
          return;
        }
        try {
          let resolvedPlan = typeof planContent === 'string' ? planContent : '';
          if (!resolvedPlan && sessionId) {
            const planFilePath = getCurrentPlanFilePath(sessionId);
            if (planFilePath) {
              try { resolvedPlan = readFileSync(planFilePath, 'utf8'); }
              catch (readErr) { log.warn(`failed to read plan file ${planFilePath}: ${(readErr as Error).message}`); }
            }
          }
          const requestId = crypto.randomUUID();
          const result = await registerPlanApproval(requestId, channel, sessionId, resolvedPlan, toolInput || {}, dryRun === true, threadId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/webhook/github') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    readJsonBody(req, (error, body, event) => {
      const sig = req.headers['x-hub-signature-256'];
      if (!verifySignature(body, sig)) {
        log.warn('Invalid signature');
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
      if (error) {
        res.writeHead(400);
        res.end('Bad JSON');
        return;
      }

      const eventType = req.headers['x-github-event'];
      if (eventType !== 'push') {
        res.writeHead(200);
        res.end('Ignored');
        return;
      }

      res.writeHead(200);
      res.end('OK');
    });
  };
}

function startWebhookServer(options: {
  port?: number;
  host?: string;
  secret?: string;
} = {}) {
  const { port = PORT, host = '127.0.0.1' } = options;
  const server = http.createServer(createWebhookHandler(options));

  server.listen(port, host, () => {
    log.info(`Listening on ${host}:${port}/webhook/github`);
  });

  return server;
}

export { startWebhookServer, createWebhookHandler };
