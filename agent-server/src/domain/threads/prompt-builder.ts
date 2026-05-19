// Prompt assembly and agent slot config resolution.
// input:  template-loader, artifact-io, thread-store, thread-types
// output: buildStepPrompt / resolveSystemVars / resolveAgentSlotConfig / resolveTemplateAgents / formatEndpoint / pickStepTemplate

import { threadStore } from '@store/thread-repo.js';
import { getAgent, resolveFileRef } from './template-loader.js';
import { getModifiedFilesFromSession, getSessionFileChanges, renderModifiedFilesWithDiff } from './artifact-io.js';
import { getDefaultAgent } from '../agents/index.js';
import { loadUserContext } from '../memory/user-context.js';
import type {
  AgentDefinition, AgentSlotConfig, AgentSlotId, AgentStep, TemplateAgentRef, ThreadTemplate,
} from '@core/types/thread-types.js';

/** Resolve the `__active__` agent ref placeholder to the currently active default agent
 *  (set by `!agent`). Falls back to `'main'` when no default is configured. Other names
 *  pass through unchanged. */
export function resolveActiveAgentName(name: string): string {
  return name === '__active__' ? (getDefaultAgent() || 'main') : name;
}

// --- System variable resolution ---
// System variables are resolved at step execution time (not config load time).

function getSystemVars(): Record<string, string> {
  const now = new Date();
  return {
    currentDateTime: now.toLocaleString('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }),
  };
}

/** Replace {{systemVar}} placeholders with system variable values. Unknown vars are left as-is. */
export function resolveSystemVars(text: string): string {
  const vars = getSystemVars();
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => key in vars ? vars[key] : match);
}

// --- Agent slot config resolution ---

type AgentOverrides = Partial<Pick<AgentSlotConfig,
  'promptTemplate' | 'directive' | 'systemPrompt' | 'persistSession' |
  'claudeAgent' | 'outputStyle' | 'tools' | 'pluginDirs'>>;

function collectRefOverrides(ref: TemplateAgentRef): AgentOverrides {
  if (typeof ref === 'string') return {};
  const o: AgentOverrides = {};
  if (ref.promptTemplate != null) o.promptTemplate = resolveFileRef('promptTemplate', ref.promptTemplate) ?? ref.promptTemplate;
  if (ref.directive != null) o.directive = resolveFileRef('directive', ref.directive) ?? ref.directive;
  if (ref.systemPrompt != null) o.systemPrompt = resolveFileRef('systemPrompt', ref.systemPrompt) ?? ref.systemPrompt;
  if (ref.persistSession != null) o.persistSession = ref.persistSession;
  if (ref.claudeAgent != null) o.claudeAgent = ref.claudeAgent;
  if (ref.outputStyle != null) o.outputStyle = ref.outputStyle;
  if (ref.tools != null) o.tools = ref.tools;
  if (ref.pluginDirs != null) o.pluginDirs = ref.pluginDirs;
  return o;
}

/** Resolve a TemplateAgentRef to a full AgentSlotConfig by merging agent definition with optional overrides. */
export function resolveAgentSlotConfig(ref: TemplateAgentRef): AgentSlotConfig | null {
  const rawName = typeof ref === 'string' ? ref : ref.ref;
  const agentName = resolveActiveAgentName(rawName);
  const agentDef = getAgent(agentName);
  if (!agentDef) return null;
  const overrides = collectRefOverrides(ref);
  return {
    slotId: agentName,
    profile: agentDef.profile,
    persistSession: overrides.persistSession ?? agentDef.persistSession,
    directive: overrides.directive ?? agentDef.directive,
    systemPrompt: overrides.systemPrompt ?? agentDef.systemPrompt,
    promptTemplate: overrides.promptTemplate ?? agentDef.promptTemplate,
    claudeAgent: overrides.claudeAgent ?? agentDef.claudeAgent,
    outputStyle: overrides.outputStyle ?? agentDef.outputStyle,
    tools: overrides.tools ?? agentDef.tools,
    pluginDirs: overrides.pluginDirs ?? agentDef.pluginDirs,
    stages: agentDef.stages,
    entryStage: agentDef.entryStage,
  };
}

/** Resolve a single agent name to AgentSlotConfig (for ad-hoc threads) */
export function resolveAgentSlotConfigByName(agentName: string): AgentSlotConfig | null {
  return resolveAgentSlotConfig(agentName);
}

/** Resolve all agent refs in a template to AgentSlotConfigs */
export function resolveTemplateAgents(template: ThreadTemplate): AgentSlotConfig[] {
  const configs: AgentSlotConfig[] = [];
  for (const ref of template.agents) {
    const config = resolveAgentSlotConfig(ref);
    if (config) configs.push(config);
  }
  return configs;
}

/** Render an `(agent, stage)` pair as the canonical endpoint string used for iterationCounts keys
 *  and transition-rule matching. Stages that are null render as bare agent names. */
export function formatEndpoint(agent: string, stage: string | null): string {
  return stage ? `${agent}:${stage}` : agent;
}

/** Pick the prompt template for this step. For stage-aware agents, use `stages[stage]`;
 *  otherwise fall back to the agent-level `promptTemplate` (single-stage legacy path). */
export function pickStepTemplate(agentConfig: AgentSlotConfig, stage: string | null): { template: string; continuesSession: boolean } {
  if (stage && agentConfig.stages && agentConfig.stages[stage]) {
    const s = agentConfig.stages[stage];
    return { template: s.promptTemplate, continuesSession: s.continuesSession === true };
  }
  return { template: agentConfig.promptTemplate || '{{input}}', continuesSession: false };
}

/** System-level protocol preamble injected into every step prompt of threads that own a workspace artifact. */
export const THREAD_PROTOCOL_PREAMBLE = [
  '[Cortex Thread Protocol]',
  'You are executing inside a Cortex thread. If the task cannot be completed (missing dependencies,',
  'contradictory requirements, or repeated unrecoverable failures), append `[ABORT: <reason>]` to the',
  'artifact to terminate the thread — terminal state `aborted`, distinct from `failed`. Use this only',
  'when truly blocked: normal retries, minor issues, or disagreements with the plan are not abort cases.',
].join('\n');

// --- Prompt assembly ---

function buildPromptVars(thread: import('@core/types/thread-types.js').ThreadRecord, lastStep: AgentStep | undefined): Record<string, string> {
  const prevModifiedFiles = getModifiedFilesFromSession(lastStep?.sessionId);
  const prevFileChanges = getSessionFileChanges(lastStep?.sessionId);
  return {
    input: thread.userMessage,
    artifactPath: thread.artifactPath,
    previousOutput: lastStep?.output || '',
    modifiedFiles: prevModifiedFiles.length > 0 ? prevModifiedFiles.map(f => `- ${f}`).join('\n') : '',
    modifiedFilesWithDiff: renderModifiedFilesWithDiff(prevFileChanges),
    ...getSystemVars(),
  };
}

function applyPromptTemplate(templateStr: string, vars: Record<string, string>): string {
  const withBlocks = templateStr.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, varName, content) => vars[varName] ? content : '',
  );
  return withBlocks.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

export function buildStepPrompt(threadId: string, agentConfig: AgentSlotConfig, stage: string | null = null, isUserInitiated?: boolean): string {
  const thread = threadStore.get(threadId);
  if (!thread) return '';
  const { template: templateStr, continuesSession } = pickStepTemplate(agentConfig, stage);
  const lastStep = [...thread.steps].reverse().find(s => s.output != null);
  const vars = buildPromptVars(thread, lastStep);

  let prompt = applyPromptTemplate(templateStr, vars);

  const slot = thread.agents[agentConfig.slotId];
  const resumingPersistentSession = agentConfig.persistSession && !!slot?.sessionId;
  const incremental = continuesSession && resumingPersistentSession;

  if (!incremental && !thread.templateName && lastStep?.output && !templateStr.includes('{{previousOutput}}')) {
    prompt = `Previous agent output:\n\n${lastStep.output}\n\n---\n\n${prompt}`;
  }

  if (!resumingPersistentSession) {
    const prefixes: string[] = [];
    const userCtx = loadUserContext(thread);
    if (userCtx) prefixes.push(userCtx);
    if (agentConfig.directive) prefixes.push(resolveSystemVars(agentConfig.directive));
    if (thread.artifactPath && !isUserInitiated) prefixes.push(THREAD_PROTOCOL_PREAMBLE);
    if (prefixes.length > 0) prompt = prefixes.join('\n\n') + '\n\n' + prompt;
  }

  // Phase 6: include buffered user messages in the next step's prompt.
  // Messages accumulated while the previous step was executing are appended
  // so the agent sees the user's reply.
  if (thread.metadata?.pendingMessages?.length) {
    // Take the last 10 messages to cap prompt growth
    const messages = thread.metadata.pendingMessages.slice(-10);
    const count = thread.metadata.pendingMessages.length;
    const dropped = count > 10 ? count - 10 : 0;
    const header = dropped > 0
      ? `User replies (last ${messages.length}, ${dropped} earlier dropped):`
      : `User replies (${count} buffered):`;
    prompt += `\n\n---\n\n${header}\n\n${messages.join('\n\n')}`;
    // Clear buffer synchronously on in-memory object
    thread.metadata.pendingMessages = [];
    // Fire-and-forget persist — see thread-executor.ts bufferUserMessage for
    // rationale on why set() is used instead of mutate() here.
    threadStore.set(thread).catch(() => {});
  }

  return prompt.trim();
}
