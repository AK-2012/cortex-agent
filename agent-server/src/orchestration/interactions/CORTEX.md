Please update me when files in this folder change

orch/interactions/ — User interaction state layer.
Stores requestId-keyed state machines for specific interaction modes (plan approval, ask-user Q&A, etc.).
Referenced by orch/ upper-layer modules via singleton references, must not inversely depend on layers outside orch/.

| filename | role | function |
|---|---|---|
| `plan-approvals.ts` | singleton | Unified requestId-keyed plan approval state (merges pendingPlans + pendingHookPlans, provides register/lookup/resolve/reject/clearByChannel API, publishes plan.approved on resolve [S6-A]) |
| `update-prompt-slack.ts` | factory | createSlackUpdatePrompt — Slack UpdatePrompt impl with 3 pre-registered actionIds |
