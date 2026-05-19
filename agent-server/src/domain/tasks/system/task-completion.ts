import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { DATA_DIR, todayISO } from '@core/utils.js';
import { clearDependsOnAll, findTask, getTasksPath, readTasks, writeTasks } from './task-lifecycle-edit.js';

function verifyCompletionEvidence(
  taskId: string | null,
  doneWhen: string | null,
): { hasEvidence: boolean; gitFound: boolean; grepFound: boolean } {
  let gitFound = false;
  let grepFound = false;

  if (taskId) {
    try {
      const out = execSync(
        `git -C ${JSON.stringify(DATA_DIR)} log --oneline --grep=${JSON.stringify(taskId)}`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      );
      const logLines = out.trim().split('\n').filter(Boolean);
      gitFound = logLines.some((l) => !/task-store:\s+(claim|unclaim)/i.test(l));
    } catch {}
  }

  if (!gitFound && doneWhen) {
    const tokens = doneWhen.match(/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_/.-]+/g) ?? [];
    for (const token of tokens) {
      if (fs.existsSync(path.join(DATA_DIR, token))) {
        grepFound = true;
        break;
      }
    }
  }

  return { hasEvidence: gitFound || grepFound, gitFound, grepFound };
}

function completeTask(
  taskText: string | null, project: string,
  completionNote: string = '', taskId: string | null = null,
  skipVerify: boolean = false, skipVerifyReason: string | null = null,
) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.status === 'done') return { success: false, message: 'Task is already completed' };
  if (task.paused) return { success: false, message: 'Cannot complete a paused task — resume it first' };
  if (task.blocked_by) return { success: false, message: 'Cannot complete a blocked task — unblock it first' };

  let verifyWarning: string | null = null;
  if (skipVerify) {
    verifyWarning = `verify skipped: ${skipVerifyReason ?? 'no reason given'}`;
  } else {
    const { hasEvidence } = verifyCompletionEvidence(task.id, task.done_when);
    if (!hasEvidence) {
      verifyWarning = 'no evidence of work: no matching git commit and no Done-when artifact found in repo. Re-run with --skip-verify to bypass.';
    }
  }

  const today = todayISO();
  task.status = 'done';
  task.claimed_by = null;
  task.claimed_at = null;
  task.blocked_by = null;
  task.approval_needed = false;
  task.paused = false;
  task.pending_at = null;
  task.completed_at = today;
  task.completed_note = completionNote || null;
  writeTasks(project, tasks);

  const unblockResult = task.id ? clearDependsOnAll(task.id) : { count: 0, tasks: [] };
  let message = `Task completed on ${today}`;
  if (unblockResult.count > 0) {
    const details = unblockResult.tasks.map((t) => `  ${t.taskId ? `[${t.taskId}]` : '(?)'} ${t.project}: ${t.preview}`).join('\n');
    message += ` (unblocked ${unblockResult.count} dependent task(s)):\n${details}`;
  }
  return { success: true, message, task_id: task.id, unblocked: unblockResult.tasks, verify_warning: verifyWarning };
}

function uncompleteTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.status !== 'done') return { success: false, message: 'Task is not completed' };

  task.status = 'open';
  task.completed_at = null;
  task.completed_note = null;
  writeTasks(project, tasks);
  return { success: true, message: 'Task marked as incomplete' };
}

export { completeTask, uncompleteTask };
