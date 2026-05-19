// input:  Codex rate limit events, raw JSONL log files
// output: summarizeRateLimits + parseRateLimitsFromRawLog
// pos:    Rate limit data parsing and aggregation
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { readFileSync, existsSync } from 'fs';

function normalizePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function normalizeRateLimitScope(scope) {
  const usedPercent = normalizePercent(scope?.usedPercent);
  if (usedPercent == null) return null;
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowDurationMins: Number.isFinite(Number(scope?.windowDurationMins)) ? Number(scope.windowDurationMins) : null,
    resetsAt: Number.isFinite(Number(scope?.resetsAt)) ? Number(scope.resetsAt) : null,
  };
}

function normalizeRateLimitEntry(rateLimits) {
  const limitId = rateLimits?.limitId;
  if (!limitId) return null;
  return {
    limitId: String(limitId),
    limitName: rateLimits?.limitName || null,
    primary: normalizeRateLimitScope(rateLimits?.primary),
    secondary: normalizeRateLimitScope(rateLimits?.secondary),
  };
}

function summarizeRateLimits(rateLimitsList, source = 'event') {
  const limits = [];
  let lowestRemaining = null;

  for (const raw of rateLimitsList || []) {
    const entry = normalizeRateLimitEntry(raw);
    if (!entry) continue;
    limits.push(entry);

    for (const scopeName of ['primary', 'secondary']) {
      const scope = entry[scopeName];
      if (!scope) continue;
      if (!lowestRemaining || scope.remainingPercent < lowestRemaining.remainingPercent) {
        lowestRemaining = {
          limitId: entry.limitId, limitName: entry.limitName, scope: scopeName,
          usedPercent: scope.usedPercent, remainingPercent: scope.remainingPercent,
          windowDurationMins: scope.windowDurationMins, resetsAt: scope.resetsAt,
        };
      }
    }
  }

  return { source, limits, lowestRemaining };
}

function parseRateLimitsFromRawLog(rawLogPath) {
  if (!rawLogPath || !existsSync(rawLogPath)) {
    return summarizeRateLimits([], 'log');
  }

  const byId = new Map();
  let raw = '';
  try { raw = readFileSync(rawLogPath, 'utf8'); } catch { return summarizeRateLimits([], 'log'); }

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.method !== 'account/rateLimits/updated') continue;
    const rateLimits = entry?.params?.rateLimits;
    if (rateLimits?.limitId) byId.set(rateLimits.limitId, rateLimits);
  }

  return summarizeRateLimits(Array.from(byId.values()), 'log');
}

export { summarizeRateLimits, parseRateLimitsFromRawLog };
