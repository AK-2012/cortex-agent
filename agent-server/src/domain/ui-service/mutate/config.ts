// input:  UiServiceDeps + ConfigSetArgs (section + value)
// output: config.set handler → Ok<ConfigSetReturn> | Err. Pure `writeBudget` (dir arg, atomic)
//         + thin `handleConfigSet` (section guard → writeBudget over CONFIG_DIR).
// pos:    mutate handler for 'config.set' (Stage 7). Only the whitelisted `budget` section is
//         writable; validates + atomic-writes, rejects illegal values.

import path from 'node:path';
import { CONFIG_DIR } from '@core/paths.js';
import { atomicWrite } from '@core/atomic-write.js';
import { configSetInput } from '../input-schemas.js';
import type { UiServiceDeps, Result, ConfigSetArgs, ConfigSetReturn, BudgetValue } from '../types.js';

/**
 * Validate and atomically write budget.json into `configDir`. Pure over its dir argument
 * (hermetically testable against a temp dir). Re-validates through the same zod schema the router
 * uses, so a direct call (bypassing the router) cannot persist an illegal budget — it throws.
 */
export async function writeBudget(configDir: string, value: BudgetValue): Promise<void> {
  const parsed = configSetInput.parse({ section: 'budget', value });
  const body = JSON.stringify(parsed.value, null, 2) + '\n';
  await atomicWrite(path.join(configDir, 'budget.json'), body);
}

export async function handleConfigSet(
  _deps: UiServiceDeps,
  args: ConfigSetArgs,
): Promise<Result<ConfigSetReturn>> {
  // Validate first (invalid-args → BAD_REQUEST), so a genuine write/IO failure below is not
  // misreported as bad input. Covers the section guard and the numeric constraints in one pass.
  const parsed = configSetInput.safeParse(args);
  if (!parsed.success) {
    return { ok: false, code: 'invalid-args', message: parsed.error.message };
  }
  try {
    await writeBudget(CONFIG_DIR, parsed.data.value);
  } catch (err: any) {
    return { ok: false, code: 'internal', message: err?.message || String(err) };
  }
  return { ok: true, data: { written: true, section: 'budget' } };
}
