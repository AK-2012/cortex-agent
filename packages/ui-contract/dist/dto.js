// Re-exported ui-service contract types (zero-duplication, DR-0018 §2).
// Source of truth: agent-server/src/domain/ui-service/types.ts. We import the
// BUILT declarations so the frontend shares one definition and cannot drift.
// All re-exports are type-only → fully erased at build, no runtime coupling to
// agent-server (the frontend never bundles backend code).
export {};
