import { todayISO } from '@core/utils.js';
import { findTask, getTasksPath, readTasks, writeTasks } from './task-lifecycle-edit.js';
import * as fs from 'node:fs';

function claimTask(taskText: string | null, project: string, agentId: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.claimed_by) return { success: false, message: 'Task already claimed (409 conflict)' };
  if (task.status === 'done') return { success: false, message: 'Task already completed' };
  if (task.blocked_by) return { success: false, message: 'Task is blocked' };

  const today = todayISO();
  task.claimed_by = agentId;
  task.claimed_at = today;
  writeTasks(project, tasks);
  return { success: true, message: `Task claimed by ${agentId} on ${today}`, task_id: task.id, agent: agentId, claimed_at: today };
}

function unclaimTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (!task.claimed_by) return { success: false, message: 'Task is not in-progress' };

  task.claimed_by = null;
  task.claimed_at = null;
  writeTasks(project, tasks);
  return { success: true, message: 'Task unclaimed', task_id: task.id };
}

function pauseTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.paused) return { success: false, message: 'Task is already paused' };

  task.claimed_by = null;
  task.claimed_at = null;
  task.paused = true;
  writeTasks(project, tasks);
  return { success: true, message: 'Task paused' };
}

function resumeTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (!task.paused) return { success: false, message: 'Task is not paused' };

  task.paused = false;
  writeTasks(project, tasks);
  return { success: true, message: 'Task resumed' };
}

function requestApprovalTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.approval_needed) return { success: false, message: 'Task already requires approval' };

  task.approved_at = null;
  task.approval_needed = true;
  writeTasks(project, tasks);
  return { success: true, message: 'Task marked as approval-needed' };
}

function approveTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.status === 'done') return { success: false, message: 'Cannot approve a completed task' };
  if (task.blocked_by) return { success: false, message: 'Cannot approve a blocked task — unblock it first' };

  const today = todayISO();
  task.approval_needed = false;
  task.approved_at = today;
  writeTasks(project, tasks);
  return { success: true, message: `Task approved on ${today}` };
}

function clearApprovalTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (!task.approval_needed && !task.approved_at) {
    return { success: false, message: 'Task has no approval tags' };
  }

  task.approval_needed = false;
  task.approved_at = null;
  writeTasks(project, tasks);
  return { success: true, message: 'Approval tags cleared' };
}

function blockTask(taskText: string | null, project: string, reason: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  task.claimed_by = null;
  task.claimed_at = null;
  task.pending_at = null;
  task.blocked_by = reason;
  // Normalize a 'pending' (mid cortex-run) task back to 'open'. `status === 'pending'`
  // is an independent dispatch-exclusion gate (task-parser isActionable), so leaving it
  // here would make the task invisible to the dispatcher even after it is unblocked.
  // blocked_by still gates dispatch, so this is safe. Never resurrect a done task.
  if (task.status !== 'done') task.status = 'open';
  writeTasks(project, tasks);
  return { success: true, message: `Task blocked: ${reason}`, task_id: task.id };
}

function pendingTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.status === 'pending') return { success: true, message: 'Task is already pending (idempotent)', task_id: task.id };
  if (task.status === 'done') return { success: false, message: 'Cannot mark a completed task as pending' };

  const today = todayISO();
  task.status = 'pending';
  task.claimed_by = null;
  task.claimed_at = null;
  task.blocked_by = null;
  task.pending_at = today;
  writeTasks(project, tasks);
  return { success: true, message: `Task marked pending on ${today}`, task_id: task.id };
}

function unblockTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  task.blocked_by = null;
  // Defensively restore legacy stuck tasks (status=pending + blocked_by, produced before
  // blockTask normalized status) so they become dispatchable again on unblock.
  if (task.status === 'pending') {
    task.status = 'open';
    task.pending_at = null;
  }
  writeTasks(project, tasks);
  return { success: true, message: 'Task unblocked', task_id: task.id };
}

function reopenTask(taskText: string | null, project: string, taskId: string | null = null) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }
  const found = findTask(tasks, taskText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const task = found.task;

  if (task.status === 'done') return { success: false, message: 'Cannot reopen a completed task — use uncomplete' };
  if (task.status !== 'pending') return { success: true, message: 'Task is already open (idempotent)', task_id: task.id };

  task.status = 'open';
  task.pending_at = null;
  writeTasks(project, tasks);
  return { success: true, message: 'Task reopened', task_id: task.id };
}

export {
  approveTask,
  blockTask,
  claimTask,
  clearApprovalTask,
  pauseTask,
  pendingTask,
  reopenTask,
  requestApprovalTask,
  resumeTask,
  unblockTask,
  unclaimTask,
};
