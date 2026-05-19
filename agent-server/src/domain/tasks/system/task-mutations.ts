import * as fs from 'node:fs';
import { type Task } from '@core/task-parser.js';
import { collectAllExistingHashes, generateHash } from './task-id-utils.js';
import { editTask, findTask, getTasksPath, readTasks, validateTemplateName, writeTasks } from './task-lifecycle-edit.js';

function addTask(
  project: string,
  text: string | null,
  why: string | null,
  doneWhen: string | null,
  priority: string = 'medium',
  template: string | null = null,
  dependsOn: string[] | null = null,
  plan: string | null = null,
) {
  if (!text || text === 'null') {
    return { success: false, message: '--text is required and must not be empty' };
  }
  if (!template) {
    return { success: false, message: '--template is required (use --help to list available templates)' };
  }

  const templateError = validateTemplateName(template);
  if (templateError) return { success: false, message: templateError };

  const tasksPath = getTasksPath(project);
  if (!fs.existsSync(tasksPath)) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }

  const tasks = readTasks(project);
  const existingHashes = collectAllExistingHashes();
  const taskHash = generateHash(existingHashes);

  const dependsOnList = dependsOn
    ? dependsOn.flatMap((d) => d.includes(',') ? d.split(',').map((s) => s.trim()).filter(Boolean) : [d])
    : [];

  const newTask: Task = {
    id: taskHash,
    text,
    why: why || '',
    done_when: doneWhen || '',
    priority: (['high', 'medium', 'low'].includes(priority) ? priority : 'medium') as Task['priority'],
    status: 'open',
    template,
    plan: plan?.trim() || '',
    project,
    depends_on: dependsOnList,
    gpu: null,
    gpu_count: 1,
    blocked_by: null,
    claimed_by: null,
    claimed_at: null,
    paused: false,
    approval_needed: false,
    approved_at: null,
    not_before: null,
    completed_at: null,
    completed_note: null,
    pending_at: null,
  };

  tasks.push(newTask);
  writeTasks(project, tasks);
  return { success: true, message: `Task added to ${project}`, task_id: taskHash };
}

function batchEdit(project: string, taskIds: string[], options: any = {}) {
  const results: { taskId: string; success: boolean; message: string }[] = [];
  for (const id of taskIds) {
    const result = editTask(project, { ...options, taskId: id });
    results.push({ taskId: id, success: result.success, message: result.message || '' });
  }
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);
  let message = `Batch edit: ${succeeded}/${taskIds.length} tasks updated`;
  if (failed.length > 0) {
    message += `\nFailed:\n${failed.map((r) => `  [${r.taskId}] ${r.message}`).join('\n')}`;
  }
  return { success: failed.length === 0, message, results };
}

function decomposeTask(
  project: string,
  originalText: string | null,
  subtasks: Array<{ text: string; template?: string; why?: string; done_when?: string; priority?: string; plan?: string; depends_on?: string[] }>,
  taskId: string | null = null,
) {
  const tasks = readTasks(project);
  if (tasks.length === 0 && !fs.existsSync(getTasksPath(project))) {
    return { success: false, message: `TASKS.yaml not found for project ${project}` };
  }

  const found = findTask(tasks, originalText, taskId);
  if ('error' in found) return { success: false, message: found.error };
  const parentIndex = found.index;
  const parentTask = found.task;

  const existingHashes = collectAllExistingHashes();
  const newTasks: Task[] = [];

  for (const sub of subtasks) {
    const hash = generateHash(existingHashes);
    existingHashes.add(hash);
    newTasks.push({
      id: hash,
      text: sub.text,
      why: sub.why || '',
      done_when: sub.done_when || '',
      priority: (sub.priority || 'medium') as Task['priority'],
      status: 'open',
      template: sub.template || parentTask.template,
      plan: (sub.plan?.trim()) || parentTask.plan,
      project,
      depends_on: sub.depends_on || [],
      gpu: null,
      gpu_count: 1,
      blocked_by: null,
      claimed_by: null,
      claimed_at: null,
      paused: false,
      approval_needed: false,
      approved_at: null,
      not_before: null,
      completed_at: null,
      completed_note: null,
      pending_at: null,
    });
  }

  tasks.splice(parentIndex, 1, ...newTasks);
  writeTasks(project, tasks);
  return { success: true, message: `Task decomposed into ${subtasks.length} subtasks` };
}

export { addTask, batchEdit, decomposeTask };
