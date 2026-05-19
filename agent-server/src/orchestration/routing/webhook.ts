// input:  GitHub push, task-op, remote cmd, hook HTTP events
// output: startWebhookServer
// pos:    GitHub/task-op/hook webhook HTTP entry point
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { createLogger } from '@core/log.js';
import * as http from 'http';
import * as crypto from 'crypto';
import { readFileSync } from 'fs';
import { taskMutator } from '@domain/tasks/mutator.js';
import { sendCommand, isDeviceOnline, getOnlineDevices } from '@domain/remote/client-manager.js';
import { registerAskQuestion, registerPlanApproval } from './hook-bridge.js';
import { getCurrentPlanFilePath } from '@domain/agents/index.js';

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
