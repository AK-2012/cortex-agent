Please update me when files in this folder change

Task system domain — TASKS.md reading (parser), writing (mutator), dispatch (dispatcher), archiving (archiver).
mutator.ts takes over the 17 mutation forwarding responsibilities from the original store/task-repo.ts, serializing write operations via taskStore.runExclusive.

| filename | role | function |
|---|---|---|
| `parser.ts` | read path | TASKS.md parsing |
| `mutator.ts` | write path | 17 mutations via `taskStore.runExclusive`: claim / complete / block / add / batchEdit, etc. |
| `task-lock.ts` | lock | TASKS.yaml file-level lock primitives (acquire / release / read / assert) |
| `lint.ts` | validation | TASKS.md format check |
| `archiver.ts` | archive | Completed task archiving |
| `dispatcher.ts` | dispatch | Automatic task dispatch |
| `dispatch-utils.ts` | utility | Dispatch helper functions |
| `pending-tracker.ts` | tracker | Pending task tracking |
| `store.ts` | adapter | Store access adaptation layer |
| `recommendation/` | subdirectory | Task recommendation |
| `system/` | subdirectory | Task CLI and state machine (CORTEX.md exists) |
