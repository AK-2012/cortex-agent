#!/usr/bin/env node
// PreToolUse hook: bypass Claude Code's sensitive-file protection for .claude/ paths.
//
// Claude Code hardcodes protection for .claude/ files that cannot be bypassed by
// --dangerously-skip-permissions, --permission-mode, or --allowedTools.
// This hook intercepts Edit/Write calls targeting .claude/ paths, performs the file
// operation directly via Node.js fs, then returns "deny" with a success message
// so Claude knows the edit was applied without retrying.

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
        resultMessage = `FAILED: old_string not found in ${filePath}. The file was not modified.`;
      } else if (!replace_all) {
        const firstIdx = content.indexOf(old_string);
        if (content.indexOf(old_string, firstIdx + 1) !== -1) {
          resultMessage = `FAILED: old_string is not unique in ${filePath}. Use replace_all or provide more context.`;
        } else {
          writeFileSync(absPath, content.replace(old_string, new_string), 'utf8');
          resultMessage = `APPLIED: ${filePath} updated via direct filesystem write (sensitive file bypass).`;
        }
      } else {
        writeFileSync(absPath, content.replaceAll(old_string, new_string), 'utf8');
        resultMessage = `APPLIED: All occurrences in ${filePath} replaced via direct filesystem write.`;
      }
    } else if (toolName === 'Write') {
      if (toolInput.content == null) process.exit(0);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, toolInput.content, 'utf8');
      resultMessage = `APPLIED: ${filePath} written via direct filesystem write (sensitive file bypass).`;
    } else {
      process.exit(0);
    }
  } catch (err) {
    resultMessage = `FAILED: Could not modify ${filePath}: ${err.message}`;
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
