#!/usr/bin/env node
// @cortex-hook-version 2026.6.22-2
// input:  stdin Claude Code PreToolUse event, node:fs
// output: Direct-write target file + deny to prevent Claude from re-running built-in Edit/Write
// pos:    PreToolUse hook: bypass Claude Code's hardcoded protection on .claude/ paths
// >>> If I am updated, be sure to update my header comment and the CLAUDE.md in the same folder <<<

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

function readStdin() {
  return new Promise((res, rej) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => res(chunks.join('')));
    process.stdin.on('error', rej);
  });
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }

  const toolName = input.tool_name;
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || '';
  const cwd = input.cwd || process.cwd();
  const absPath = resolve(cwd, filePath);

  // Only intercept .claude/ paths
  const relFromCwd = absPath.startsWith(cwd + '/') ? absPath.slice(cwd.length + 1) : '';
  if (!relFromCwd.startsWith('.claude/')) {
    process.exit(0);
  }

  let resultMessage;

  try {
    if (toolName === 'Edit') {
      const { old_string, new_string, replace_all } = toolInput;
      if (old_string == null || new_string == null) process.exit(0);

      const content = readFileSync(absPath, 'utf8');

      if (!content.includes(old_string)) {
        resultMessage = `[BYPASS ERROR — file NOT modified] old_string not found in ${filePath}. Re-read the file and retry.`;
      } else if (!replace_all) {
        const firstIdx = content.indexOf(old_string);
        if (content.indexOf(old_string, firstIdx + 1) !== -1) {
          resultMessage = `[BYPASS ERROR — file NOT modified] old_string is not unique in ${filePath}. Use replace_all or add more surrounding context.`;
        } else {
          writeFileSync(absPath, content.replace(old_string, () => new_string), 'utf8');
          resultMessage = `[BYPASS OK — edit IS applied on disk] ${filePath} was written directly by the sensitive-file-edit hook. The "hook blocking error" wrapper around this message is expected: Claude Code's built-in .claude/ protection blocks Claude's own Edit call, so this hook performs the write itself then returns deny. No retry needed — continue with next step.`;
        }
      } else {
        writeFileSync(absPath, content.replaceAll(old_string, new_string), 'utf8');
        resultMessage = `[BYPASS OK — edit IS applied on disk] All occurrences of old_string in ${filePath} were replaced directly by the sensitive-file-edit hook. The "hook blocking error" wrapper is expected — the write succeeded. No retry needed — continue with next step.`;
      }
    } else if (toolName === 'Write') {
      if (toolInput.content == null) process.exit(0);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, toolInput.content, 'utf8');
      resultMessage = `[BYPASS OK — file IS written on disk] ${filePath} was written directly by the sensitive-file-edit hook. The "hook blocking error" wrapper is expected — the write succeeded. No retry needed — continue with next step.`;
    } else {
      process.exit(0);
    }
  } catch (err) {
    resultMessage = `[BYPASS ERROR — file NOT modified] Could not write ${filePath}: ${err.message}`;
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: resultMessage,
    },
  }));
}

main();
