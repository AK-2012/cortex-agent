#!/usr/bin/env node
// @cortex-hook-version 2026.6.22-2
// input:  stdin Claude Code PostToolUse event, node:fs
// output: Appends records to logs/session-activity/<session_id>.jsonl
// pos:    PostToolUse hook: track Read/Edit/Write/Skill for diff reconstruction

import { readFileSync, mkdirSync, appendFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const DATA_DIR = process.env.CORTEX_HOME
  ? resolve(process.env.CORTEX_HOME)
  : join(homedir(), '.cortex');

const MCP_REMOTE_EDIT_TOOL = 'mcp__cortex__remote_edit';
const MCP_REMOTE_WRITE_TOOL = 'mcp__cortex__remote_write';
const DIFF_MARKER_RE = /<!--cortex-diff-data\s*([\s\S]*?)\s*-->/;
const TOOL_USE_ID_RE = /^[A-Za-z0-9_-]+$/;

function diffMarkersDir() {
  return join(resolveDataDir(), 'tmp', 'diff-markers');
}

function resolveDataDir() {
  const override = process.env.CORTEX_HOME;
  return override ? resolve(override) : DATA_DIR;
}

function resolveSessionId(payload) {
  const envSession = process.env.CORTEX_SESSION_ID?.trim();
  if (envSession) return envSession;

  const directSession = typeof payload.session_id === 'string' ? payload.session_id.trim() : '';
  if (directSession) return directSession;

  const camelSession = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
  if (camelSession) return camelSession;

  return null;
}

function getLogPath(sessionId) {
  const logsDir = join(resolveDataDir(), 'logs', 'session-activity');
  mkdirSync(logsDir, { recursive: true });
  return join(logsDir, `${sessionId}.jsonl`);
}

function isSkillSuccess(payload) {
  if (payload.is_error === true) return false;

  const response = payload.tool_response;
  if (response && typeof response === 'object') {
    if (response.success === false) return false;
    if (response.is_error === true) return false;
    if (response.error) return false;
  }

  const output = payload.tool_output;
  if (output && typeof output === 'object') {
    if (output.is_error === true) return false;
    if (output.error) return false;
  }

  return true;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractLocalMutation(toolName, response) {
  if (!isPlainObject(response)) return {};
  const out = {};
  if ('originalFile' in response) {
    const v = response.originalFile;
    if (typeof v === 'string' || v === null) out.originalFile = v;
  }
  if (Array.isArray(response.structuredPatch)) {
    out.structuredPatch = response.structuredPatch;
  }
  if (toolName === 'Write' && typeof response.content === 'string') {
    out.writtenContent = response.content;
  }
  return out;
}

function payloadToMutation(data) {
  const out = {};
  if (data.degraded === true) out.diffDegraded = true;
  if (typeof data.originalFile === 'string' || data.originalFile === null) {
    out.originalFile = data.originalFile;
  }
  if (Array.isArray(data.structuredPatch)) {
    out.structuredPatch = data.structuredPatch;
  }
  if (typeof data.writtenContent === 'string') {
    out.writtenContent = data.writtenContent;
  }
  return out;
}

function readSidebandDiff(toolUseId) {
  if (!toolUseId || !TOOL_USE_ID_RE.test(toolUseId)) return {};
  const p = join(diffMarkersDir(), `${toolUseId}.json`);
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch {
    return {};
  }
  try { unlinkSync(p); } catch { /* ignore */ }
  try {
    const data = JSON.parse(raw);
    return payloadToMutation(data);
  } catch {
    return {};
  }
}

function extractRemoteMutation(response, toolUseId) {
  const side = readSidebandDiff(toolUseId);
  if (Object.keys(side).length > 0) return side;

  if (!Array.isArray(response)) return {};
  for (const block of response) {
    if (!isPlainObject(block) || block.type !== 'text' || typeof block.text !== 'string') continue;
    const m = block.text.match(DIFF_MARKER_RE);
    if (!m) continue;
    let data;
    try { data = JSON.parse(m[1]); } catch { return {}; }
    return payloadToMutation(data);
  }
  return {};
}

function toRecord(payload, sessionId) {
  const toolName = payload.tool_name;
  if (toolName === 'Read') {
    const filePath = payload.tool_input?.file_path;
    if (!filePath) return null;
    return {
      ts: new Date().toISOString(),
      session_id: sessionId,
      tool: 'Read',
      event: 'read_file',
      file_path: resolve(filePath),
    };
  }

  if (toolName === 'Edit') {
    const filePath = payload.tool_input?.file_path;
    if (!filePath) return null;
    return {
      ts: new Date().toISOString(),
      session_id: sessionId,
      tool: 'Edit',
      event: 'edit_file',
      file_path: resolve(filePath),
      ...extractLocalMutation('Edit', payload.tool_response),
    };
  }

  if (toolName === 'Write') {
    const filePath = payload.tool_input?.file_path;
    if (!filePath) return null;
    const mutation = extractLocalMutation('Write', payload.tool_response);
    if (mutation.writtenContent === undefined && typeof payload.tool_input?.content === 'string') {
      mutation.writtenContent = payload.tool_input.content;
    }
    return {
      ts: new Date().toISOString(),
      session_id: sessionId,
      tool: 'Write',
      event: 'write_file',
      file_path: resolve(filePath),
      ...mutation,
    };
  }

  if (toolName === MCP_REMOTE_EDIT_TOOL || toolName === MCP_REMOTE_WRITE_TOOL) {
    const filePath = payload.tool_input?.file_path;
    if (!filePath) return null;
    const isEdit = toolName === MCP_REMOTE_EDIT_TOOL;
    return {
      ts: new Date().toISOString(),
      session_id: sessionId,
      tool: isEdit ? 'Edit' : 'Write',
      event: isEdit ? 'edit_file' : 'write_file',
      file_path: filePath,
      device: payload.tool_input?.device,
      ...extractRemoteMutation(payload.tool_response, payload.tool_use_id),
    };
  }

  if (toolName === 'Skill') {
    const skill = payload.tool_input?.skill;
    if (!skill) return null;
    if (!isSkillSuccess(payload)) return null;
    return {
      ts: new Date().toISOString(),
      session_id: sessionId,
      tool: 'Skill',
      event: 'skill_use',
      skill: skill.toLowerCase(),
      success: true,
    };
  }

  return null;
}

function appendRecord(record) {
  const logPath = getLogPath(record.session_id);
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
}

export function processPayload(payload) {
  const sessionId = resolveSessionId(payload);
  if (!sessionId) return;

  const record = toRecord(payload, sessionId);
  if (!record) return;

  appendRecord(record);
}

function main() {
  let input = '';

  try {
    input = readFileSync(0, 'utf8');
  } catch {
    return;
  }

  if (!input.trim()) return;

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }

  processPayload(payload);
}

// Run directly when invoked as a hook script
const isMain = process.argv[1] && (
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
);
if (isMain) {
  main();
}
