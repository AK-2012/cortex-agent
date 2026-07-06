# ui-contract/ — @cortex-agent/ui-contract

Shared client↔server contract for the Cortex Web UI (DR-0018 §2). The frontend
imports **only types + zod input schemas** from here, so the backend contract has
one source of truth and cannot drift. All DTO types are re-exported (not copied)
from `agent-server`'s built `ui-service` declarations; type-only, erased at build,
so there is no runtime coupling.

| filename | role | function |
|---|---|---|
| `src/dto.ts` | types | Type-only re-export of ui-service DTOs / unions / param+arg+return maps from `@cortex-agent/server` (+ `CostSummary` from the costs domain) |
| `src/schemas.ts` | schemas | One zod input schema per QueryScope / MutateOp; `queryInputSchemas` / `mutateInputSchemas` keyed maps consumed by the tRPC router |
| `src/contract.parity.ts` | guard | Compile-time drift guard: `z.infer<schema>` ≡ `QueryParamMap`/`MutateArgsMap`; typecheck fails if a schema falls out of lock-step |
| `src/app-router.ts` | types | `AppRouter` re-export point (placeholder `unknown` until Stage-1 task 3 defines the tRPC router) |
| `src/index.ts` | barrel | Public entry: re-exports dto + schemas + AppRouter |
| `src/schemas.test.ts` | test | Runtime zod parse/reject tests + map completeness |

## Notes

- Depends on `@cortex-agent/server` (`workspace:*`) for type-only re-exports; this
  also gives pnpm the topological order to build agent-server first.
- `dto.ts` deep-imports `@cortex-agent/server/dist/domain/ui-service/types.js`, so
  agent-server must be built before this package typechecks. `pnpm -w build` (gate)
  handles the ordering; run it before `pnpm -w typecheck`.
- zod pinned to `^4.4.3` to match the version already resolved in the workspace lock.
