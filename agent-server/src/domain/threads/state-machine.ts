// Thread lifecycle state machine.
// input:  thread-store, template-loader, prompt-builder, utils, artifact-io
// output: createThread / createAutoThreadRecord / createDefaultThread / addAgentToThread /
//         resolveNextStep / evaluateTransitions / recordStepResult / completeThread /
//         failThread / cancelThread / abortThread / detectAbortMarker

import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import * as path from 'path';
import { WORKSPACE_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { threadStore } from '@store/thread-repo.js';

const log = createLogger('state-machine');
import { getTemplate, getAgent } from './template-loader.js';
import { resolveAgentSlotConfigByName, resolveTemplateAgents, resolveActiveAgentName } from './prompt-builder.js';
import { resolveStageName, parseTarget } from './utils.js';
import { readArtifact } from './artifact-io.js';
import type {
  ThreadRecord, ThreadTemplate, AgentDefinition,
  AgentSlotConfig, AgentSlotId, AgentSlot, AgentStep,
  StepResult, TransitionResult, TransitionRule,
} from '@core/types/thread-types.js';

// --- Agent slot helpers ---

function newAgentSlot(config: AgentSlotConfig): AgentSlot {
  return {
    slotId: config.slotId,
    profile: config.profile,
    sessionId: null,
    sessionName: null,
    status: 'idle',
    lastOutput: null,
    persistSession: config.persistSession,
  };
}

function buildTemplateSlots(templateName: string): { agentSlots: Record<AgentSlotId, AgentSlot>; entryAgent: AgentSlotId; entryStage: string | null } {
  const template = getTemplate(templateName);
  if (!template) throw new Error(`Unknown thread template: ${templateName}`);
  const entryAgent = resolveActiveAgentName(template.entryAgent);
  const agentSlots: Record<AgentSlotId, AgentSlot> = {};
  let entryConfig: AgentSlotConfig | null = null;
  for (const config of resolveTemplateAgents(template)) {
    agentSlots[config.slotId] = newAgentSlot(config);
    if (config.slotId === entryAgent) entryConfig = config;
  }
  const entryStage = resolveStageName(entryConfig, template.entryStage || null);
  return { agentSlots, entryAgent, entryStage };
}

function buildAdHocSlots(agentName: string): { agentSlots: Record<AgentSlotId, AgentSlot>; entryAgent: AgentSlotId; entryStage: string | null } {
  const agentConfig = resolveAgentSlotConfigByName(agentName);
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);
  return {
    agentSlots: { [agentConfig.slotId]: newAgentSlot(agentConfig) },
    entryAgent: agentConfig.slotId,
    entryStage: resolveStageName(agentConfig, null),
  };
}

function createWorkspace(threadId: string): { workspacePath: string; artifactPath: string } {
  const workspacePath = path.join(WORKSPACE_DIR, 'threads', threadId);
  const artifactPath = path.join(workspacePath, 'artifact.md');
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(artifactPath, '');
  return { workspacePath, artifactPath };
}

interface ThreadRecordInit {
  id: string;
  channel: string;
  templateName: string | null;
  platformThreadId: string | null;
  userMessage: string;
  userMessageTs: string;
  workspacePath: string;
  artifactPath: string;
  agents: Record<AgentSlotId, AgentSlot>;
  activeAgent: AgentSlotId;
  activeStage: string | null;
  metadata: import('@core/types/thread-types.js').ThreadMetadata | null;
}

function makeThreadRecord(init: ThreadRecordInit): ThreadRecord {
  const now = new Date().toISOString();
  return {
    ...init,
    status: 'running',
    currentStepIndex: 0,
    steps: [],
    iterationCounts: {},
    totalCostUsd: 0,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    error: null,
    abortReason: null,
  };
}

// --- Thread creation ---

export function createThread(channel: string, options: {
  templateName?: string | null;
  agentName?: string | null;
  userMessage: string;
  userMessageTs: string;
  platformThreadId?: string | null;
  metadata?: import('@core/types/thread-types.js').ThreadMetadata | null;
}): ThreadRecord {
  const isTemplate = !!options.templateName;
  if (!isTemplate && !options.agentName) {
    throw new Error('createThread requires either templateName or agentName');
  }
  const { agentSlots, entryAgent, entryStage } = isTemplate
    ? buildTemplateSlots(options.templateName!)
    : buildAdHocSlots(options.agentName!);
  const id = threadStore.generateId();
  const { workspacePath, artifactPath } = createWorkspace(id);

  const thread = makeThreadRecord({
    id, channel,
    templateName: options.templateName || null,
    platformThreadId: options.platformThreadId || null,
    userMessage: options.userMessage,
    userMessageTs: options.userMessageTs,
    workspacePath, artifactPath,
    agents: agentSlots, activeAgent: entryAgent, activeStage: entryStage,
    metadata: options.metadata || null,
  });
  threadStore.set(thread);
  const mode = isTemplate ? `template=${options.templateName}` : `agent=${options.agentName}`;
  log.info(`Created thread ${id} (${mode}, workspace=${workspacePath})`);
  return thread;
}

/** Create a lightweight completed thread record (no filesystem workspace).
 *  Used to track single-agent path executions so !thread add can chain off them. */
export function createAutoThreadRecord(channel: string, options: {
  agentName: string;
  userMessage: string;
  userMessageTs: string;
  platformThreadId?: string | null;
}): ThreadRecord {
  const agentConfig = resolveAgentSlotConfigByName(options.agentName);
  if (!agentConfig) throw new Error(`Unknown agent: ${options.agentName}`);
  const id = threadStore.generateId();

  const thread = makeThreadRecord({
    id, channel,
    templateName: null,
    platformThreadId: options.platformThreadId || null,
    userMessage: options.userMessage,
    userMessageTs: options.userMessageTs,
    workspacePath: '', artifactPath: '',
    agents: { [agentConfig.slotId]: newAgentSlot(agentConfig) },
    activeAgent: agentConfig.slotId,
    activeStage: resolveStageName(agentConfig, null),
    metadata: null,
  });
  threadStore.set(thread);
  log.info(`Created auto thread record ${id} (agent=${options.agentName})`);
  return thread;
}

/** Create a thread record that uses the 'default' template (single-step, single-agent with workspace).
 *  Used by the agent-runner wrapper to create a thread BEFORE execution, so that isDefaultThread()
 *  returns true and the thread runner uses default-path semantics.
 *  Unlike createAutoThreadRecord (post-hoc, templateName=null, no workspace), this sets
 *  templateName='default' and creates a workspace so it is detected as a default thread. */
export function createDefaultThread(channel: string, options: {
  agentName: string;
  userMessage: string;
  userMessageTs: string;
  platformThreadId?: string | null;
}): ThreadRecord {
  const agentConfig = resolveAgentSlotConfigByName(options.agentName);
  if (!agentConfig) throw new Error(`Unknown agent: ${options.agentName}`);
  const id = threadStore.generateId();
  const { workspacePath, artifactPath } = createWorkspace(id);

  const thread = makeThreadRecord({
    id, channel,
    templateName: 'default',
    platformThreadId: options.platformThreadId || null,
    userMessage: options.userMessage,
    userMessageTs: options.userMessageTs,
    workspacePath, artifactPath,
    agents: { [agentConfig.slotId]: newAgentSlot(agentConfig) },
    activeAgent: agentConfig.slotId,
    activeStage: resolveStageName(agentConfig, null),
    metadata: null,
  });
  threadStore.set(thread);
  log.info(`Created default thread ${id} (agent=${options.agentName})`);
  return thread;
}

// --- Add agent to existing thread ---

/** Lazy workspace creation for auto-records that started without a filesystem workspace. */
function ensureThreadWorkspace(thread: ThreadRecord): void {
  if (thread.workspacePath) return;
  thread.workspacePath = path.join(WORKSPACE_DIR, 'threads', thread.id);
  thread.artifactPath = path.join(thread.workspacePath, 'artifact.md');
  mkdirSync(thread.workspacePath, { recursive: true });
  writeFileSync(thread.artifactPath, '');
}

/** Add or reset an agent slot, preserving any existing persistent session. */
function upsertAgentSlot(thread: ThreadRecord, config: AgentSlotConfig): void {
  const existing = thread.agents[config.slotId];
  thread.agents[config.slotId] = {
    slotId: config.slotId,
    profile: config.profile,
    sessionId: existing?.sessionId || null,
    sessionName: existing?.sessionName || null,
    status: 'idle',
    lastOutput: null,
    persistSession: config.persistSession,
  };
}

export async function addAgentToThread(threadId: string, agentName: string, userMessage?: string | null): Promise<ThreadRecord> {
  const thread = threadStore.get(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  const agentConfig = resolveAgentSlotConfigByName(agentName);
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  ensureThreadWorkspace(thread);

  await threadStore.mutate(threadId, (t) => {
    upsertAgentSlot(t, agentConfig);
    t.activeAgent = agentName;
    t.activeStage = resolveStageName(agentConfig, null);
    t.status = 'running';
    if (userMessage) t.userMessage = userMessage;
    t.endedAt = null;
    t.error = null;
  });
  log.info(`Added agent ${agentName} to thread ${threadId}`);
  return thread;
}

// --- Step resolution ---

interface NextStepInfo {
  agentSlotId: AgentSlotId;
  agentConfig: AgentSlotConfig;
  isFirstStep: boolean;
  stage: string | null;
}

function resolveAdHocNextStep(thread: ThreadRecord): NextStepInfo | null {
  const agentConfig = resolveAgentSlotConfigByName(thread.activeAgent);
  if (!agentConfig) return null;
  const stage = resolveStageName(agentConfig, thread.activeStage);
  return { agentSlotId: thread.activeAgent, agentConfig, isFirstStep: thread.steps.length === 0, stage };
}

function resolveTemplateNextStep(thread: ThreadRecord): NextStepInfo | null {
  const template = getTemplate(thread.templateName!);
  if (!template) return null;
  const resolvedAgents = resolveTemplateAgents(template);
  const isFirstStep = thread.steps.length === 0;
  const target = isFirstStep ? resolveActiveAgentName(template.entryAgent) : thread.activeAgent;
  const agentConfig = resolvedAgents.find(a => a.slotId === target);
  if (!agentConfig) return null;
  const explicit = isFirstStep ? (template.entryStage || null) : thread.activeStage;
  const stage = resolveStageName(agentConfig, explicit);
  return { agentSlotId: target, agentConfig, isFirstStep, stage };
}

export function resolveNextStep(threadId: string): NextStepInfo | null {
  const thread = threadStore.get(threadId);
  if (!thread || thread.status !== 'running') return null;
  return thread.templateName ? resolveTemplateNextStep(thread) : resolveAdHocNextStep(thread);
}

// --- Step result recording ---

interface StepResultInput {
  sessionId?: string | null;
  sessionName?: string | null;
  executionId?: string | null;
  input?: string | null;
  startedAt?: string | null;
  output: string | null;
  costUsd: number | null;
  numTurns: number | null;
  durationS: number | null;
  stage?: string | null;
}

function makeAgentStep(stepIndex: number, agentSlotId: AgentSlotId, result: StepResultInput): AgentStep {
  return {
    stepIndex, agentSlotId,
    stage: result.stage ?? null,
    executionId: result.executionId || null,
    sessionId: result.sessionId || null,
    sessionName: result.sessionName || null,
    input: result.input || '',
    output: result.output,
    costUsd: result.costUsd,
    numTurns: result.numTurns,
    durationS: result.durationS,
    startedAt: result.startedAt || null,
    endedAt: new Date().toISOString(),
  };
}

function updateSlotAfterStep(slot: AgentSlot, result: StepResultInput): void {
  slot.status = 'completed';
  slot.lastOutput = result.output;
  if (result.sessionId && slot.persistSession) slot.sessionId = result.sessionId;
  if (result.sessionName) slot.sessionName = result.sessionName;
}

export async function recordStepResult(threadId: string, agentSlotId: AgentSlotId, result: StepResultInput): Promise<AgentStep> {
  const thread = threadStore.get(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  const step = makeAgentStep(thread.currentStepIndex, agentSlotId, result);

  await threadStore.mutate(threadId, (t) => {
    t.steps.push(step);
    t.currentStepIndex++;
    if (result.costUsd != null) t.totalCostUsd += result.costUsd;
    const slot = t.agents[agentSlotId];
    if (slot) updateSlotAfterStep(slot, result);
  });
  return step;
}

// --- Transition evaluation ---

function checkTemplateLimits(thread: ThreadRecord, template: ThreadTemplate): TransitionResult | null {
  if (thread.currentStepIndex >= template.maxTotalSteps) {
    return { shouldTransition: false, reason: 'max_iterations' };
  }
  if (template.maxTotalCostUsd != null && thread.totalCostUsd >= template.maxTotalCostUsd) {
    return { shouldTransition: false, reason: 'cost_limit' };
  }
  return null;
}

function applyTransition(thread: ThreadRecord, rule: TransitionRule, result: TransitionResult): TransitionResult {
  if (rule.condition.type === 'convergence') {
    const edgeKey = `${rule.from}→${rule.to}`;
    thread.iterationCounts[edgeKey] = (thread.iterationCounts[edgeKey] || 0) + 1;
  }
  thread.activeAgent = result.nextAgent!;
  thread.activeStage = result.nextStage ?? null;
  threadStore.set(thread);
  return result;
}

/** Does `rule.from` match the last step? Matches on `(agent, stage)`: a bare `agent` endpoint
 *  matches any stage of that agent; an `agent:stage` endpoint matches only that specific stage. */
function ruleFromMatches(rule: TransitionRule, lastStep: AgentStep): boolean {
  const parsed = parseTarget(rule.from);
  if (parsed.agent !== lastStep.agentSlotId) return false;
  if (parsed.stage === null) return true;
  // Rule explicitly pins a stage — only match if last step ran that stage.
  const lastStage = lastStep.stage ?? resolveStageName(getAgent(lastStep.agentSlotId), null);
  return parsed.stage === lastStage;
}

function readArtifactOutput(thread: ThreadRecord, step: AgentStep): string {
  try {
    return readFileSync(thread.artifactPath, 'utf8');
  } catch {
    return step.output || '';
  }
}

/** Resolve rule.to into the concrete (agent, stage) that should execute next. */
function resolveTransitionTo(rule: TransitionRule): { nextAgent: string; nextStage: string | null } {
  const { agent, stage } = parseTarget(rule.to);
  const agentDef = getAgent(agent);
  return { nextAgent: agent, nextStage: resolveStageName(agentDef, stage) };
}

function evaluateConvergence(thread: ThreadRecord, rule: TransitionRule, output: string): TransitionResult {
  const marker = rule.condition.marker || '';
  const maxIter = rule.condition.maxIterations || 3;
  const count = thread.iterationCounts[`${rule.from}→${rule.to}`] || 0;
  if (marker && output.includes(marker)) return { shouldTransition: false, reason: 'converged' };
  if (count >= maxIter) return { shouldTransition: false, reason: 'max_iterations' };
  const { nextAgent, nextStage } = resolveTransitionTo(rule);
  return { shouldTransition: true, nextAgent, nextStage, reason: 'transition' };
}

function evaluatePatternMatch(rule: TransitionRule, output: string, expectMatch: boolean): TransitionResult {
  const pattern = rule.condition.pattern || '';
  try {
    const matches = new RegExp(pattern).test(output);
    if (matches === expectMatch) {
      const { nextAgent, nextStage } = resolveTransitionTo(rule);
      return { shouldTransition: true, nextAgent, nextStage, reason: 'transition' };
    }
  } catch {
    log.error(`Invalid regex pattern in ${rule.condition.type}: ${pattern}`);
  }
  return { shouldTransition: false, reason: 'no_matching_transition' };
}

function evaluateCondition(thread: ThreadRecord, step: AgentStep, rule: TransitionRule): TransitionResult {
  switch (rule.condition.type) {
    case 'always': {
      const { nextAgent, nextStage } = resolveTransitionTo(rule);
      return { shouldTransition: true, nextAgent, nextStage, reason: 'transition' };
    }
    case 'convergence':
      return evaluateConvergence(thread, rule, readArtifactOutput(thread, step));
    case 'output_contains':
      return evaluatePatternMatch(rule, readArtifactOutput(thread, step), true);
    case 'output_not_contains':
      return evaluatePatternMatch(rule, readArtifactOutput(thread, step), false);
    default:
      return { shouldTransition: false, reason: 'no_matching_transition' };
  }
}

export function evaluateTransitions(threadId: string): TransitionResult {
  const fallback: TransitionResult = { shouldTransition: false, reason: 'no_matching_transition' };
  const thread = threadStore.get(threadId);
  if (!thread || !thread.templateName) return fallback;

  const template = getTemplate(thread.templateName);
  if (!template) return fallback;

  const limit = checkTemplateLimits(thread, template);
  if (limit) return limit;

  const lastStep = thread.steps[thread.steps.length - 1];
  if (!lastStep) return fallback;

  const applicableRules = template.transitions.filter(r => ruleFromMatches(r, lastStep));
  for (const rule of applicableRules) {
    const result = evaluateCondition(thread, lastStep, rule);
    if (result.shouldTransition) return applyTransition(thread, rule, result);
    if (result.reason === 'converged' || result.reason === 'max_iterations') return result;
  }
  return fallback;
}

// --- Thread lifecycle ---

export async function cancelThread(threadId: string): Promise<boolean> {
  const thread = threadStore.get(threadId);
  if (!thread) return false;
  if (thread.status === 'completed' || thread.status === 'failed'
      || thread.status === 'cancelled' || thread.status === 'aborted') return false;

  await threadStore.mutate(threadId, (t) => {
    t.status = 'cancelled';
    t.endedAt = new Date().toISOString();
  });
  log.info(`Cancelled thread ${threadId}`);
  return true;
}

const ABORT_MARKER_RE = /\[ABORT(?::\s*([^\]\n]*))?\]/;

/** Detect `[ABORT]` or `[ABORT: <reason>]` marker in the thread's current artifact. */
export function detectAbortMarker(threadId: string): { aborted: boolean; reason: string | null } {
  const content = readArtifact(threadId);
  if (!content) return { aborted: false, reason: null };
  const m = ABORT_MARKER_RE.exec(content);
  if (!m) return { aborted: false, reason: null };
  const raw = m[1] != null ? m[1].trim() : '';
  return { aborted: true, reason: raw.length > 0 ? raw : null };
}

/** Terminate the thread with status='aborted'. Idempotent — returns false if thread is already terminal. */
export async function abortThread(threadId: string, reason: string | null): Promise<boolean> {
  const thread = threadStore.get(threadId);
  if (!thread) return false;
  if (thread.status === 'completed' || thread.status === 'failed'
      || thread.status === 'cancelled' || thread.status === 'aborted') return false;

  await threadStore.mutate(threadId, (t) => {
    t.status = 'aborted';
    t.abortReason = reason;
    t.endedAt = new Date().toISOString();
  });
  const reasonTag = reason ? ` (${reason})` : '';
  log.info(`Aborted thread ${threadId}${reasonTag}`);
  return true;
}

export async function completeThread(threadId: string): Promise<boolean> {
  const thread = threadStore.get(threadId);
  if (!thread) return false;

  await threadStore.mutate(threadId, (t) => {
    t.status = 'completed';
    t.endedAt = new Date().toISOString();
  });
  log.info(`Completed thread ${threadId}`);
  return true;
}

export async function failThread(threadId: string, error: string): Promise<boolean> {
  const thread = threadStore.get(threadId);
  if (!thread) return false;

  await threadStore.mutate(threadId, (t) => {
    t.status = 'failed';
    t.error = error;
    t.endedAt = new Date().toISOString();
  });
  log.info(`Failed thread ${threadId}: ${error}`);
  return true;
}
