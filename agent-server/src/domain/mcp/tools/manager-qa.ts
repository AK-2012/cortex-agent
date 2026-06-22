// input:  McpServer, webhook proxy (/webhook/manager-qa), CORTEX_THREAD_ID env
// output: ask_manager / answer_subtask registrations (DR-0016 up-ask channel)
// pos:    A subtask asks its manager (or, at the top of the tree, a human) a clarifying question and
//         BLOCKS synchronously — ask_manager registers the question, then polls until answered and
//         returns the answer as the tool result. The manager answers with answer_subtask. Managers
//         nest: a manager that is itself unsure can ask_manager upward. Proxied through the daemon
//         webhook (separate process; no shared memory with the thread store / runner).
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const WEBHOOK_BASE = `http://127.0.0.1:${process.env.WEBHOOK_PORT || '3001'}`;
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = parseInt(process.env.CORTEX_ASK_MANAGER_TIMEOUT_MS || '1800000', 10) || 1800000; // 30 min

async function proxyQa(action: string, payload: Record<string, any>): Promise<any> {
  const res = await fetch(`${WEBHOOK_BASE}/webhook/manager-qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cortex-token': process.env.CORTEX_WEBHOOK_TOKEN || '' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error(data.error || 'manager-qa failed');
  return data.data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerManagerQaTools(server: McpServer): void {
  const selfThreadId = (): string => {
    const id = process.env.CORTEX_THREAD_ID;
    if (!id) throw new Error('not running inside a thread (CORTEX_THREAD_ID unset) — ask_manager only works from within a dispatched task/thread');
    return id;
  };

  // --- ask_manager ---

  server.tool(
    'ask_manager',
    'Ask the manager who planned your task a clarifying question when you hit confusion, a contradiction, or an ambiguous/under-specified intent — instead of guessing or aborting. This is LIGHTER than thread_abort: it does not give up the task; it resolves the uncertainty and lets you continue. The call BLOCKS until the manager replies, then returns their answer. Managers nest: if your manager is itself unsure it may ask its own manager upward; at the top of the tree the question goes to a human. Use for genuine planning/intent questions (e.g. "did you mean approach A or B?", "two done_when conditions conflict — which wins?"), not for things you can settle by reading the deliverable, code, or task spec yourself.',
    {
      question: z.string().min(1).describe('A specific, self-contained question about the planning intent. Include the conflict/ambiguity and the options you see so the manager can answer crisply.'),
    },
    async ({ question }: { question: string }) => {
      try {
        const threadId = selfThreadId();
        const reg = await proxyQa('ask', { threadId, question });
        const questionId: string = reg.questionId;
        const target: string = reg.target;
        const deadline = Date.now() + TIMEOUT_MS;
        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS);
          const poll = await proxyQa('poll', { questionId });
          if (poll.answered) {
            const who = target === 'human' ? 'human' : 'manager';
            return { content: [{ type: 'text', text: `Answer from your ${who}:\n\n${poll.answer}` }] };
          }
        }
        return {
          content: [{ type: 'text', text: `ask_manager timed out after ${Math.round(TIMEOUT_MS / 60000)} min with no reply (${target}). Proceed with your best judgment and record the assumption explicitly, or call thread_abort with a diagnosis if you cannot.` }],
          isError: true,
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `ask_manager error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- answer_subtask ---

  server.tool(
    'answer_subtask',
    'Answer a question a subtask asked you via ask_manager (the question, with its question_id, arrives in your context while you are waiting on your children). Give a concrete, actionable answer about your planning intent. After you answer, your thread automatically returns to waiting for your children — end your step. If the question is really about a HIGHER-level intent you are unsure of, call ask_manager to ask your own manager first, then answer the subtask with what you learn.',
    {
      question_id: z.string().min(1).describe('The question_id from the subtask question notice.'),
      answer: z.string().min(1).describe('Your answer / clarification for the subtask.'),
    },
    async ({ question_id, answer }: { question_id: string; answer: string }) => {
      try {
        const result = await proxyQa('answer', { question_id, answer });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `answer_subtask error: ${(e as Error).message}` }], isError: true };
      }
    },
  );
}
