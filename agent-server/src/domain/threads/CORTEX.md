Please update me when files in this folder change

Thread domain layer — S7 split result of thread-manager.ts (1098 lines) (2026-04-26).
External callers should import from index.ts, not reference sub-files directly.

| filename | role | function |
|---|---|---|
| `utils.ts` | utility | isDefaultThread / isAdHocThread / getSessionKey / parseTarget / resolveStageName |
| `artifact-io.ts` | I/O | readArtifact / cleanupWorkspace / getModifiedFilesFromSession / getSessionFileChanges / renderModifiedFilesWithDiff / FileChange |
| `template-loader.ts` | config | loadConfig / startConfigWatcher / stopConfigWatcher / getTemplate / getAgent / listTemplates / listTemplateNames / listAgents / resolveFileRef |
| `prompt-builder.ts` | build | buildStepPrompt / buildConversationPrompt / resolveSystemVars / resolveAgentSlotConfig / resolveTemplateAgents / resolveTemplateProfiles (template→profile set, used by task-dispatch rate-limit gating) / formatEndpoint / pickStepTemplate / THREAD_PROTOCOL_PREAMBLE |
| `state-machine.ts` | state machine | createThread (DR-0017 W1: manager-template dispatch threads anchor artifactPath on the task node via core/task-node ensureTaskArtifact — durable, never truncated) / addAgentToThread / resolveNextStep / evaluateTransitions / recordStepResult / completeThread / failThread / cancelThread / abortThread / tryEnterWaiting (thread + task children, §8) / peekPendingControl / clearPendingControl / detectSplitFromControl (DR-0015 out-of-band control plane — replaces the old artifact string-marker detectors) |
| `runner.ts` | runtime | runThread / continueThread / resumeThread / buildThreadSummary — thread execution engine, registers handle via runningExecutions. Threads are created by task dispatch (and resumed via the `/webhook/thread-op` `control` bridge). The agent-facing `thread_start` spawn tool was removed: delegation is via the task system (`cortex-task spawn`/`add`). At each step boundary the runner reads metadata.pendingControl (written out-of-band by the thread_abort/split/wait tools, DR-0015) and dispatches abort / split / wait — no artifact scanning. |
| `tree.ts` | tree (DR-0014) | getRootThreadId / getTreeThreads / summarizeTree / checkSpawnGuards (width+nodes+budget) / registerChildSpawn / buildThreadTree — recursive thread-tree identity, resource guards, tree view |
| `contract.ts` | contract (DR-0014) | buildContractPrompt / buildMissionChain / checkContractBudget — structured delegation contracts, ancestor goal chain, per-thread budget breaker |
| `hook-runner.ts` | hook | executeLifecycleHook — lifecycle hook script executor + hook agent runner |
| `index.ts` | entry | barrel re-export, the only import point for all external callers |

## Internal dependency order (acyclic)

```
utils.ts          → threadStore, thread-types
artifact-io.ts    → threadStore, REPO_ROOT, fs, diff
template-loader.ts → DATA_DIR, REPO_ROOT, template-resolver, thread-types
prompt-builder.ts  → template-loader, artifact-io, threadStore, thread-types, memory/user-context
contract.ts        → thread-types (pure)
tree.ts            → threadStore, thread-types
state-machine.ts   → threadStore, template-loader, prompt-builder, utils, artifact-io, contract
index.ts           → all of the above
```
