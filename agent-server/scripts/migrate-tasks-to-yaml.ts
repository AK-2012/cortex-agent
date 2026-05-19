#!/usr/bin/env -S npx tsx
/**
 * One-time migration: TASKS.md → TASKS.yaml
 * Run from agent-server: npx tsx scripts/migrate-tasks-to-yaml.ts
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as yamlStringify } from 'yaml';

const PROJECTS_DIR = path.join(process.env.CORTEX_HOME || path.join(os.homedir(), '.cortex'), 'context', 'projects');

interface RawTask {
  id: string;
  text: string;
  why: string;
  'done-when': string;
  priority: string;
  status: string;
  template: string;
  plan: string;
  [key: string]: any;
}

function extractTag(line: string, tagName: string): string | null {
  const match = line.match(new RegExp(`\\[${tagName}:\\s*([^\\]]+)\\]`, 'i'));
  return match ? match[1].trim() : null;
}

function hasTag(line: string, tagName: string): boolean {
  return new RegExp(`\\[${tagName}\\]`, 'i').test(line);
}

function extractField(lines: string[], fieldName: string): string {
  const prefix = `${fieldName.toLowerCase()}:`;
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.toLowerCase().startsWith(prefix)) {
      return stripped.slice(prefix.length).trim();
    }
  }
  return '';
}

function parseGpu(value: string | null): { gpu: string; 'gpu-count': number } | null {
  if (!value) return null;
  const match = value.match(/^(\S+?)(?:\s+x(\d+))?$/i);
  if (!match) return null;
  return { gpu: match[1], 'gpu-count': match[2] ? parseInt(match[2], 10) : 1 };
}

function parseMdTasks(content: string): RawTask[] {
  const tasks: RawTask[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const match = lines[i].match(/^-\s+\[([ x])\]\s+(.+)/);
    if (!match) { i++; continue; }

    const completed = match[1] === 'x';
    const taskLine = match[2];
    const continuationLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j] && /^(  |\t)/.test(lines[j])) {
      continuationLines.push(lines[j]);
      j++;
    }

    const cleanText = taskLine.replace(/\s*\[[^\]]+\]/g, '').trim();
    const id = extractTag(taskLine, 'id') || '';
    const template = extractTag(taskLine, 'template') || '';
    const plan = extractTag(taskLine, 'plan') || '';
    const gpu = parseGpu(extractTag(taskLine, 'gpu'));
    const blockedBy = extractTag(taskLine, 'blocked-by') || extractField(continuationLines, 'Blocked-by');
    const dependsOn = [...taskLine.matchAll(/\[depends-on:\s*([^\]]+)\]/gi)].map(m => m[1].trim());
    const inProgress = extractTag(taskLine, 'in-progress');
    const approved = extractTag(taskLine, 'approved');
    const paused = hasTag(taskLine, 'paused');
    const approvalNeeded = hasTag(taskLine, 'approval-needed');
    const notBefore = extractTag(taskLine, 'not-before');

    const why = extractField(continuationLines, 'Why');
    const doneWhen = extractField(continuationLines, 'Done when');
    const priority = (extractField(continuationLines, 'Priority') || 'medium').toLowerCase().trim();
    const completedDate = extractField(continuationLines, 'Completed');
    const completedMatch = completedDate.match(/^(\d{4}-\d{2}-\d{2})/);

    const task: any = {
      id,
      text: cleanText,
      why,
      'done-when': doneWhen,
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      status: completed ? 'done' : 'open',
      template,
      plan,
    };

    if (dependsOn.length > 0) task['depends-on'] = dependsOn;
    if (gpu) {
      task.gpu = gpu.gpu;
      if (gpu['gpu-count'] > 1) task['gpu-count'] = gpu['gpu-count'];
    }
    if (blockedBy) task['blocked-by'] = blockedBy;
    if (inProgress) {
      task['claimed-by'] = 'migrated';
      task['claimed-at'] = inProgress;
    }
    if (paused) task.paused = true;
    if (approvalNeeded) task['approval-needed'] = true;
    if (approved) task['approved-at'] = approved;
    if (notBefore) task['not-before'] = notBefore;
    if (completed && completedMatch) {
      task['completed-at'] = completedMatch[1];
      const note = completedDate.replace(completedMatch[0], '').replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
      if (note) task['completed-note'] = note;
    }

    tasks.push(task);
    i = j;
  }
  return tasks;
}

function migrate() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error(`Projects dir not found: ${PROJECTS_DIR}`);
    process.exit(1);
  }

  let totalMigrated = 0;
  for (const projectName of fs.readdirSync(PROJECTS_DIR)) {
    const mdPath = path.join(PROJECTS_DIR, projectName, 'TASKS.md');
    const yamlPath = path.join(PROJECTS_DIR, projectName, 'TASKS.yaml');

    if (!fs.existsSync(mdPath)) continue;

    const content = fs.readFileSync(mdPath, 'utf8');
    if (!content.trim()) {
      fs.writeFileSync(yamlPath, 'tasks: []\n');
      fs.unlinkSync(mdPath);
      console.log(`${projectName}: empty → created empty TASKS.yaml, deleted TASKS.md`);
      totalMigrated++;
      continue;
    }

    const tasks = parseMdTasks(content);
    if (tasks.length === 0) {
      fs.writeFileSync(yamlPath, 'tasks: []\n');
      fs.unlinkSync(mdPath);
      console.log(`${projectName}: no tasks parsed → created empty TASKS.yaml, deleted TASKS.md`);
      totalMigrated++;
      continue;
    }

    const yaml = yamlStringify({ tasks }, { lineWidth: 0 });
    fs.writeFileSync(yamlPath, yaml);
    fs.unlinkSync(mdPath);
    console.log(`${projectName}: migrated ${tasks.length} tasks → TASKS.yaml`);
    totalMigrated++;
  }

  console.log(`\nDone. Migrated ${totalMigrated} project(s).`);
}

migrate();
