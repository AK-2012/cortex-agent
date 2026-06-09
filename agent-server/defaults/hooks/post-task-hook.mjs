#!/usr/bin/env node
// input:  stdin HookContext, argv [targetAgent]
// output: HookResult — compound + git commit prompt to targetAgent
// pos:    scheduler and *-review template onEnd compound/commit hook
// >>> If I am updated, be sure to update my header comment and the CORTEX.md in the same folder <<<

import { execSync } from 'child_process';

async function main() {
  // Read context from stdin
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const context = JSON.parse(input);
  const targetAgent = process.argv[2];

  if (!targetAgent) {
    console.error('[post-task-hook] Missing targetAgent argument (argv[2])');
    console.log(JSON.stringify({ insertAgent: false }));
    return;
  }

  // Check if compound is needed
  const lastStep = context.steps[context.steps.length - 1];
  const lastOutput = lastStep?.output || '';
  const needCompound = typeof lastOutput !== 'string' || !lastOutput.includes('/cortex-common:compound-simple');

  // Check git status for uncommitted changes
  let hasChanges = false;
  try {
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8', timeout: 10000 }).trim();
    hasChanges = gitStatus.length > 0;
  } catch {
    // git not available or error — skip git check
  }

  if (!needCompound && !hasChanges) {
    console.log(JSON.stringify({ insertAgent: false }));
    return;
  }

  // Compose prompt
  const parts = [];

  if (needCompound) {
    parts.push('/cortex-common:compound-simple Reflect on the task you just completed');
  }

  if (hasChanges) {
    parts.push('After completing the task, run `git status` to check for your uncommitted changes. If there are changes, commit them with an appropriate commit message. Do not commit changes that are not made by you.');
  }

  // Worktree integration reminder (concurrent-safe code isolation). Piggybacks on the
  // turn we are already injecting, so it costs no extra agent step. Self-gates: a no-op
  // for tasks that never created a worktree.
  const threadId = context.threadId || '$CORTEX_THREAD_ID';
  parts.push(`If you created a git worktree for this task (branch cortex/${threadId}), integrate it back now before finishing: pull the latest main branch, merge your branch into it, resolve conflicts, push, then \`git worktree remove\` and delete the branch. On remote machines run these commands via remote_bash on the device you worked on. If conflicts cannot be resolved automatically, stop and report it — never force-overwrite another thread's work. If you did NOT create a worktree, ignore this.`);

  console.log(JSON.stringify({
    insertAgent: false,
    targetAgent,
    prompt: parts.join('\n\n'),
  }));
}

main().catch((err) => {
  console.error(`[post-task-hook] Fatal: ${err.message}`);
  console.log(JSON.stringify({ insertAgent: false }));
});
