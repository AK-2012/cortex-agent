# ui-contract/ — @cortex-agent/ui-contract

Shared client↔server contract for the Cortex Web UI (DR-0018 §2). The frontend
imports **only types + zod input schemas + the AppRouter type** from here, so the
backend contract has one source of truth and cannot drift. DTO types AND the zod
input schemas are re-exported (not copied) from `agent-server`'s built `ui-service`
module; DTOs are type-only (erased), schemas are a runtime re-export. The AppRouter
type is a type-only re-export. This package depends on agent-server but agent-server
does NOT depend on it — a one-directional (acyclic) edge, so `pnpm -w build` orders
agent-server first.

| filename | role | function |
|---|---|---|
| `src/dto.ts` | types | Type-only re-export of ui-service DTOs / unions / param+arg+return maps from `@cortex-agent/server` (+ `CostSummary` from the costs domain). Includes the Stage-7 config contract (`ConfigSnapshot` + sub-DTOs, `ConfigGetParams`, `ConfigSetArgs`, `ConfigSetReturn`) |
| `src/schemas.ts` | schemas | Runtime + type re-export of `queryInputSchemas` / `mutateInputSchemas` (+ the individual schemas) from `@cortex-agent/server/dist/domain/ui-service/input-schemas.js`. Source of truth lives in agent-server so the tRPC router can consume the schemas without agent-server importing this package (which would close a build cycle) |
| `src/contract.parity.ts` | guard | Compile-time drift guard: `z.infer<schema>` ≡ `QueryParamMap`/`MutateArgsMap`; typecheck fails if a schema falls out of lock-step |
| `src/app-router.ts` | types | Type-only re-export of the real `AppRouter` from `@cortex-agent/server/dist/domain/ui-service/app-router.js` |
| `src/index.ts` | barrel | Public entry: re-exports dto + schemas + AppRouter |
| `src/schemas.test.ts` | test | Runtime zod parse/reject tests + map completeness |

## Notes

- Depends on `@cortex-agent/server` (`workspace:*`) for the type-only DTO/AppRouter
  re-exports AND the runtime schema re-export; this gives pnpm the topological order to
  build agent-server first. agent-server never imports this package (acyclic).
- `dto.ts` / `schemas.ts` / `app-router.ts` deep-import `@cortex-agent/server/dist/...`,
  so agent-server must be built before this package typechecks. `pnpm -w build` (gate)
  handles the ordering; run it before `pnpm -w typecheck`.
- zod pinned to `^4.4.3` to match the version resolved in the workspace lock (agent-server
  now also depends on zod, as the schema source-of-truth lives there).
