Please update me when files in this folder change

Thread domain layer — S7 split result of thread-manager.ts (1098 lines) (2026-04-26).
External callers should import from index.ts, not reference sub-files directly.

| filename | role | function |
|---|---|---|
| `utils.ts` | utility | isDefaultThread / isAdHocThread / getSessionKey / parseTarget / resolveStageName |
| `artifact-io.ts` | I/O | readArtifact / cleanupWorkspace / getModifiedFilesFromSession / getSessionFileChanges / renderModifiedFilesWithDiff / FileChange |
| `template-loader.ts` | config | loadConfig / startConfigWatcher / stopConfigWatcher / getTemplate / getAgent / listTemplates / listTemplateNames / listAgents / resolveFileRef |
| `prompt-builder.ts` | build | buildStepPrompt / buildConversationPrompt / resolveSystemVars / resolveAgentSlotConfig / resolveTemplateAgents / formatEndpoint / pickStepTemplate / THREAD_PROTOCOL_PREAMBLE |
| `state-machine.ts` | state machine | createThread / addAgentToThread / resolveNextStep / evaluateTransitions / recordStepResult / completeThread / failThread / cancelThread / abortThread / detectAbortMarker |
| `runner.ts` | runtime | runThread / continueThread / buildThreadSummary — thread execution engine, registers handle via runningExecutions |
| `hook-runner.ts` | hook | executeLifecycleHook — lifecycle hook script executor + hook agent runner |
| `index.ts` | entry | barrel re-export, the only import point for all external callers |

## Internal dependency order (acyclic)

```
utils.ts          → threadStore, thread-types
artifact-io.ts    → threadStore, REPO_ROOT, fs, diff
template-loader.ts → DATA_DIR, REPO_ROOT, template-resolver, thread-types
prompt-builder.ts  → template-loader, artifact-io, threadStore, thread-types, memory/user-context
state-machine.ts   → threadStore, template-loader, prompt-builder, utils, artifact-io
index.ts           → all 5 above
```
