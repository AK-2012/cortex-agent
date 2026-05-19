import { taskStore, TaskRepo } from '@store/task-repo.js';
import {
  approveTask as lifecycleApproveTask,
  blockTask as lifecycleBlockTask,
  claimTask as lifecycleClaimTask,
  clearApprovalTask as lifecycleClearApprovalTask,
  pauseTask as lifecyclePauseTask,
  requestApprovalTask as lifecycleRequestApprovalTask,
  resumeTask as lifecycleResumeTask,
  unblockTask as lifecycleUnblockTask,
  unclaimTask as lifecycleUnclaimTask,
} from './system/task-state.js';
import {
  completeTask as lifecycleCompleteTask,
  uncompleteTask as lifecycleUncompleteTask,
} from './system/task-completion.js';
import {
  addTask as lifecycleAddTask,
  batchEdit as lifecycleBatchEdit,
  decomposeTask as lifecycleDecomposeTask,
} from './system/task-mutations.js';
import { editTask as lifecycleEditTask } from './system/task-lifecycle-edit.js';
import { assertLockHeld, getOwnerIdentity } from './system/task-lock.js';

export class TaskMutator {
  constructor(private store: TaskRepo = taskStore) {}

  async claim(taskId: string, agent: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleClaimTask(task.text, task.project, agent, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: claim ${taskId} by ${agent}`); }
      return result;
    });
  }

  async unclaim(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleUnclaimTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: unclaim ${taskId}`); }
      return result;
    });
  }

  async complete(taskId: string, note?: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleCompleteTask(task.text, task.project, note || '', taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: complete ${taskId}`); }
      return result;
    });
  }

  async uncomplete(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleUncompleteTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: uncomplete ${taskId}`); }
      return result;
    });
  }

  async block(taskId: string, reason: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleBlockTask(task.text, task.project, reason, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: block ${taskId}`); }
      return result;
    });
  }

  async unblock(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleUnblockTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: unblock ${taskId}`); }
      return result;
    });
  }

  async pause(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecyclePauseTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: pause ${taskId}`); }
      return result;
    });
  }

  async resume(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleResumeTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: resume ${taskId}`); }
      return result;
    });
  }

  async requestApproval(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleRequestApprovalTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: requestApproval ${taskId}`); }
      return result;
    });
  }

  async approve(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleApproveTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: approve ${taskId}`); }
      return result;
    });
  }

  async clearApproval(taskId: string): Promise<any> {
    return this.store.runExclusive(() => {
      const task = this.store.getById(taskId);
      if (!task) return { success: false, message: `Task not found: ${taskId}` };
      const result = lifecycleClearApprovalTask(task.text, task.project, taskId);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: clearApproval ${taskId}`); }
      return result;
    });
  }

  async batchEdit(project: string, taskIds: string[], options: any): Promise<any> {
    return this.store.runExclusive(() => {
      const lockError = assertLockHeld(project, getOwnerIdentity());
      if (lockError) return { success: false, message: lockError };
      const result = lifecycleBatchEdit(project, taskIds, options);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: batch-edit ${taskIds.length} tasks in ${project}`); }
      return result;
    });
  }

  async add(project: string, text: string, why: string, doneWhen: string, priority?: string, template?: string, dependsOn?: string[]): Promise<any> {
    return this.store.runExclusive(() => {
      const lockError = assertLockHeld(project, getOwnerIdentity());
      if (lockError) return { success: false, message: lockError };
      const result = lifecycleAddTask(project, text, why, doneWhen, priority || 'medium', template || null, dependsOn || null);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: add task to ${project}`); }
      return result;
    });
  }

  async edit(project: string, options: any): Promise<any> {
    return this.store.runExclusive(() => {
      const lockError = assertLockHeld(project, getOwnerIdentity());
      if (lockError) return { success: false, message: lockError };
      const result = lifecycleEditTask(project, options);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: edit task in ${project}`); }
      return result;
    });
  }

  async decompose(project: string, taskText: string, subtasks: any[], taskId?: string): Promise<any> {
    return this.store.runExclusive(() => {
      const lockError = assertLockHeld(project, getOwnerIdentity());
      if (lockError) return { success: false, message: lockError };
      const result = lifecycleDecomposeTask(project, taskText, subtasks, taskId || null);
      if (result.success) { this.store.refresh(); this.store.commitAndPush(`task-store: decompose task in ${project}`); }
      return result;
    });
  }
}

export const taskMutator = new TaskMutator();
