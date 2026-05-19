// input:  !schedule text, PlatformAdapter, Scheduler, profile
// output: handleScheduleCommand dispatcher
// pos:    !schedule subcommand routing and profile pinning
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter } from '@platform/adapter.js';
import { formatDuration, formatTimeUntil, parseDuration } from './scheduler.js';
import type { Scheduler, ScheduleTask } from './scheduler.js';
import { listProfiles, resolveProfile, getDefaultProfileName } from '../agents/profile-manager.js';

function scheduleHelp(): string {
  const profileNames = listProfiles().map(p => `\`${p.name}\``).join(', ');
  return [
    '*Schedule commands:*',
    '`!schedule add interval <duration> [--profile <name>] <message>` — repeat every duration (e.g. `30m`, `2h`, `1d`)',
    '`!schedule add daily <HH:MM> [--profile <name>] <message>` — run every day at a fixed time (24-hour)',
    '`!schedule add weekly <day> <HH:MM> [--profile <name>] <message>` — run every week (day: mon,tue,wed,thu,fri,sat,sun)',
    '`!schedule add once <duration> [--profile <name>] <message>` — run once after a delay',
    '`!schedule list` — show all scheduled tasks',
    '`!schedule pause <id>` — pause a recurring task',
    '`!schedule resume <id>` — resume a paused recurring task',
    '`!schedule remove <id>` — remove a task by id',
    `Available profiles: ${profileNames}`,
  ].join('\n');
}

const DAY_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const FMT_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
const fmtTime = (ts: number): string => new Date(ts).toLocaleString('en-US', FMT_OPTS);

async function handleList(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const tasks = await scheduler.list();
  if (tasks.length === 0) {
    await adapter.postMessage(channel, { text: 'No scheduled tasks.' });
    return;
  }
  const now = Date.now();
  const lines = tasks.map((t) => formatTaskLine(t, now));
  await adapter.postMessage(channel, { text: `*Scheduled tasks (${tasks.length}):*\n${lines.join('\n')}` });
}

function formatTaskLine(t: ScheduleTask, now: number): string {
  const id = `\`${t.id}\``;
  const profile = ` | profile: *${t.profile || 'plan'}*`;
  const paused = t.isPaused ? ` | status: *paused*${t.pausedBy === 'rate-limit' ? ' (rate-limit)' : ''}` : '';
  if (t.type === 'interval') {
    const nextAt = t.nextRun ? ` (${fmtTime(t.nextRun)})` : '';
    const nextText = t.isPaused ? 'paused' : `${formatTimeUntil((t.nextRun || 0) - now)}${nextAt}`;
    return `• ${id} every *${formatDuration(t.intervalMs!)}*${profile}${paused} | next: ${nextText} | "${t.message}"`;
  }
  if (t.type === 'daily') {
    const nextAt = t.nextRun ? ` (${fmtTime(t.nextRun)})` : '';
    const nextText = t.isPaused ? 'paused' : `${formatTimeUntil((t.nextRun || 0) - now)}${nextAt}`;
    return `• ${id} daily *${t.time}*${profile}${paused} | next: ${nextText} | "${t.message}"`;
  }
  if (t.type === 'weekly') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const nextAt = t.nextRun ? ` (${fmtTime(t.nextRun)})` : '';
    const nextText = t.isPaused ? 'paused' : `${formatTimeUntil((t.nextRun || 0) - now)}${nextAt}`;
    return `• ${id} weekly *${dayNames[t.dayOfWeek!]} ${t.time}*${profile}${paused} | next: ${nextText} | "${t.message}"`;
  }
  if (t.type === 'once') {
    const nextAt = t.runAt ? ` (${fmtTime(t.runAt)})` : '';
    return `• ${id} once${profile} | runs: ${formatTimeUntil(t.runAt! - now)}${nextAt} | "${t.message}"`;
  }
  return `• ${id} ${t.type}${profile}${paused} | "${t.message}"`;
}

function normalizeTaskId(id: string | undefined): string | undefined {
  if (!id) return id;
  const trimmed = id.trim();
  const wrapped = trimmed.match(/^`([^`]+)`$/);
  return wrapped ? wrapped[1] : trimmed;
}

async function handleRemove(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const rawId = parts[2];
  const id = normalizeTaskId(rawId);
  if (!id) {
    await adapter.postMessage(channel, { text: 'Usage: `!schedule remove <id>`' });
    return;
  }
  const removed = await scheduler.remove(id);
  await adapter.postMessage(channel, {
    text: removed ? `:white_check_mark: Removed task \`${id}\`.` : `:x: Task not found: \`${id}\``,
  });
}

async function handlePause(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const rawId = parts[2];
  const id = normalizeTaskId(rawId);
  if (!id) {
    await adapter.postMessage(channel, { text: 'Usage: `!schedule pause <id>`' });
    return;
  }
  try {
    const task = await scheduler.pause(id);
    if (!task) {
      await adapter.postMessage(channel, { text: `:x: Task not found: \`${id}\`` });
      return;
    }
    await adapter.postMessage(channel, { text: `:double_vertical_bar: Paused task \`${id}\`.` });
  } catch (error) {
    await adapter.postMessage(channel, { text: `:x: ${(error as Error).message}` });
  }
}

async function handleResume(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const rawId = parts[2];
  const id = normalizeTaskId(rawId);
  if (!id) {
    await adapter.postMessage(channel, { text: 'Usage: `!schedule resume <id>`' });
    return;
  }
  try {
    const task = await scheduler.resume(id);
    if (!task) {
      await adapter.postMessage(channel, { text: `:x: Task not found: \`${id}\`` });
      return;
    }
    const nextAt = task.nextRun ? ` Next run: ${fmtTime(task.nextRun)}.` : '';
    await adapter.postMessage(channel, { text: `:arrow_forward: Resumed task \`${id}\`.${nextAt}` });
  } catch (error) {
    await adapter.postMessage(channel, { text: `:x: ${(error as Error).message}` });
  }
}

function parseProfileArgs(args: string[], usage: string): { profileName: string; rest: string[] } {
  if (args.length >= 1 && args[0] !== '--profile') {
    return { profileName: getDefaultProfileName(), rest: args };
  }
  if (args[0] !== '--profile') {
    return { profileName: getDefaultProfileName(), rest: args };
  }
  const profileName = args[1];
  if (!profileName) throw new Error(`Usage: ${usage}`);
  try {
    resolveProfile(profileName);
  } catch (error) {
    throw new Error((error as Error).message);
  }
  return { profileName, rest: args.slice(2) };
}

function buildScheduledConfirmation(prefix: string, task: ScheduleTask, timestampLabel: string): string {
  const profileText = task.profile ? `\nprofile: *${task.profile}*` : '';
  return `${prefix}\nid: \`${task.id}\`${profileText}${timestampLabel}`;
}

async function handleAddInterval(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const durationStr = parts[3];
  let parsed: { profileName: string; rest: string[] };
  try {
    parsed = parseProfileArgs(parts.slice(4), '`!schedule add interval <duration> [--profile <name>] <message>`');
  } catch (error) {
    await adapter.postMessage(channel, { text: `:x: ${(error as Error).message}` });
    return;
  }
  const msg = parsed.rest.join(' ');
  const ms = parseDuration(durationStr);
  if (!ms) {
    await adapter.postMessage(channel, { text: `Invalid duration: \`${durationStr}\`. Use e.g. \`30s\`, \`5m\`, \`2h\`, \`1d\`` });
    return;
  }
  if (!msg) {
    await adapter.postMessage(channel, { text: 'Usage: `!schedule add interval <duration> [--profile <name>] <message>`' });
    return;
  }
  const task = await scheduler.add('interval', { intervalMs: ms, message: msg, channel, profile: parsed.profileName });
  const nextAt = task.nextRun ? ` | first run: ${fmtTime(task.nextRun)}` : '';
  await adapter.postMessage(channel, { text: buildScheduledConfirmation(`:white_check_mark: Scheduled every *${formatDuration(ms)}*: "${msg}"`, task, nextAt) });
}

async function handleAddDaily(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const time = parts[3];
  let parsed: { profileName: string; rest: string[] };
  try {
    parsed = parseProfileArgs(parts.slice(4), '`!schedule add daily <HH:MM> [--profile <name>] <message>`');
  } catch (error) {
    await adapter.postMessage(channel, { text: `:x: ${(error as Error).message}` });
    return;
  }
  const msg = parsed.rest.join(' ');
  if (!/^\d{2}:\d{2}$/.test(time)) {
    await adapter.postMessage(channel, { text: `Invalid time: \`${time}\`. Use 24-hour HH:MM, e.g. \`09:00\`` });
    return;
  }
  if (!msg) {
    await adapter.postMessage(channel, { text: 'Usage: `!schedule add daily <HH:MM> [--profile <name>] <message>`' });
    return;
  }
  const task = await scheduler.add('daily', { time, message: msg, channel, profile: parsed.profileName });
  const nextAt = task.nextRun ? ` | first run: ${fmtTime(task.nextRun)}` : '';
  await adapter.postMessage(channel, { text: buildScheduledConfirmation(`:white_check_mark: Scheduled daily at *${time}*: "${msg}"`, task, nextAt) });
}

async function handleAddWeekly(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const dayStr = (parts[3] || '').toLowerCase();
  const time = parts[4];
  let parsed: { profileName: string; rest: string[] };
  try {
    parsed = parseProfileArgs(parts.slice(5), '`!schedule add weekly <day> <HH:MM> [--profile <name>] <message>`');
  } catch (error) {
    await adapter.postMessage(channel, { text: `:x: ${(error as Error).message}` });
    return;
  }
  const msg = parsed.rest.join(' ');
  const dayOfWeek = DAY_MAP[dayStr];
  if (dayOfWeek == null) {
    await adapter.postMessage(channel, { text: `Invalid day: \`${parts[3]}\`. Use: mon, tue, wed, thu, fri, sat, sun` });
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    await adapter.postMessage(channel, { text: `Invalid time: \`${time}\`. Use 24-hour HH:MM, e.g. \`21:00\`` });
    return;
  }
  if (!msg) {
    await adapter.postMessage(channel, { text: 'Usage: `!schedule add weekly <day> <HH:MM> [--profile <name>] <message>`' });
    return;
  }
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const task = await scheduler.add('weekly', { dayOfWeek, time, message: msg, channel, profile: parsed.profileName });
  const nextAt = task.nextRun ? ` | first run: ${fmtTime(task.nextRun)}` : '';
  await adapter.postMessage(channel, { text: buildScheduledConfirmation(`:white_check_mark: Scheduled weekly *${dayNames[dayOfWeek]} ${time}*: "${msg}"`, task, nextAt) });
}

async function handleAddOnce(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const durationStr = parts[3];
  let parsed: { profileName: string; rest: string[] };
  try {
    parsed = parseProfileArgs(parts.slice(4), '`!schedule add once <duration> [--profile <name>] <message>`');
  } catch (error) {
    await adapter.postMessage(channel, { text: `:x: ${(error as Error).message}` });
    return;
  }
  const msg = parsed.rest.join(' ');
  const ms = parseDuration(durationStr);
  if (!ms) {
    await adapter.postMessage(channel, { text: `Invalid duration: \`${durationStr}\`. Use e.g. \`30s\`, \`5m\`, \`2h\`, \`1d\`` });
    return;
  }
  if (!msg) {
    await adapter.postMessage(channel, { text: 'Usage: `!schedule add once <duration> [--profile <name>] <message>`' });
    return;
  }
  const task = await scheduler.add('once', { delay: ms, message: msg, channel, profile: parsed.profileName });
  const runAt = task.runAt ? ` | runs at: ${fmtTime(task.runAt)}` : '';
  await adapter.postMessage(channel, { text: buildScheduledConfirmation(`:white_check_mark: Scheduled once in *${formatDuration(ms)}*: "${msg}"`, task, runAt) });
}

type SubHandler = (parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler) => Promise<void>;

const ADD_TYPE_HANDLERS: Record<string, SubHandler> = {
  interval: handleAddInterval,
  daily: handleAddDaily,
  weekly: handleAddWeekly,
  once: handleAddOnce,
};

async function handleAdd(parts: string[], channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const type = parts[2];
  const handler = ADD_TYPE_HANDLERS[type];
  if (handler) return handler(parts, channel, adapter, scheduler);
  if (type) {
    await adapter.postMessage(channel, { text: `Unknown type: \`${type}\`. Use \`interval\`, \`daily\`, \`weekly\`, or \`once\`` });
    return;
  }
  await adapter.postMessage(channel, { text: scheduleHelp() });
}

const SUB_HANDLERS: Record<string, SubHandler> = {
  list: handleList,
  pause: handlePause,
  resume: handleResume,
  remove: handleRemove,
  add: handleAdd,
};

async function handleScheduleCommand(text: string, channel: string, adapter: PlatformAdapter, scheduler: Scheduler): Promise<void> {
  const parts = text.split(/\s+/);
  const sub = parts[1];
  const handler = SUB_HANDLERS[sub];
  if (handler) return handler(parts, channel, adapter, scheduler);
  await adapter.postMessage(channel, { text: scheduleHelp() });
}

export { handleScheduleCommand };
