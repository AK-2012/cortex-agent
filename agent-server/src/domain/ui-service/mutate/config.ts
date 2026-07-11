// input:  UiServiceDeps + ConfigSetArgs (section + value)
// output: config.set handler → Ok<ConfigSetReturn> | Err. Pure `writeBudget` (dir arg, atomic)
//         + pure `writeDefaultProfile` (dir arg, atomic; existence-checked) + thin `handleConfigSet`
//         (section switch over CONFIG_DIR).
// pos:    mutate handler for 'config.set' (Stage 7 + task b983). Two whitelisted sections are
//         writable — `budget` (daily/monthly) and `profiles` (re-point defaultProfile to an
//         EXISTING profile). Each validates + atomic-writes; illegal values / unknown profiles
//         are rejected.

import path from 'node:path';
import fs from 'node:fs/promises';
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
  if (parsed.section !== 'budget') throw new Error('unreachable: budget branch');
  const body = JSON.stringify(parsed.value, null, 2) + '\n';
  await atomicWrite(path.join(configDir, 'budget.json'), body);
}

/**
 * Re-point profiles.json `defaultProfile`, PRESERVING every other field. Pure over its dir
 * argument. The target MUST already exist in the file's `profiles` map — the write can only SELECT
 * an existing profile, never invent one (a non-existent default would break agent startup). A
 * missing / malformed profiles.json or an unknown profile throws with `code: 'invalid-args'` so the
 * handler maps it to BAD_REQUEST rather than an internal error.
 */
export async function writeDefaultProfile(configDir: string, defaultProfile: string): Promise<void> {
  const file = path.join(configDir, 'profiles.json');
  let raw: any;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw Object.assign(new Error('profiles.json is missing or unreadable'), { code: 'invalid-args' });
  }
  if (!raw || typeof raw !== 'object' || !raw.profiles || typeof raw.profiles !== 'object') {
    throw Object.assign(new Error('profiles.json has no profiles map'), { code: 'invalid-args' });
  }
  if (!Object.prototype.hasOwnProperty.call(raw.profiles, defaultProfile)) {
    throw Object.assign(new Error(`profile "${defaultProfile}" not found in profiles.json`), {
      code: 'invalid-args',
    });
  }
  const next = { ...raw, defaultProfile };
  await atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
}

export async function handleConfigSet(
  _deps: UiServiceDeps,
  args: ConfigSetArgs,
): Promise<Result<ConfigSetReturn>> {
  // Validate first (invalid-args → BAD_REQUEST), so a genuine write/IO failure below is not
  // misreported as bad input. Covers the section guard and each section's constraints in one pass.
  const parsed = configSetInput.safeParse(args);
  if (!parsed.success) {
    return { ok: false, code: 'invalid-args', message: parsed.error.message };
  }
  try {
    if (parsed.data.section === 'budget') {
      await writeBudget(CONFIG_DIR, parsed.data.value);
      return { ok: true, data: { written: true, section: 'budget' } };
    }
    await writeDefaultProfile(CONFIG_DIR, parsed.data.value.defaultProfile);
    return { ok: true, data: { written: true, section: 'profiles' } };
  } catch (err: any) {
    const code = err?.code === 'invalid-args' ? 'invalid-args' : 'internal';
    return { ok: false, code, message: err?.message || String(err) };
  }
}
