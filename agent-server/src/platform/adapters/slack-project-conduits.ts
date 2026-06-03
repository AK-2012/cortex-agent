// input:  ./project-conduits.js
// output: SlackProjectConduitsStore (backward-compat alias of ProjectConduitsStore)
// pos:    Compat shim — the store is now platform-agnostic (project-conduits.ts).
//         Kept so existing Slack imports resolve unchanged.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export { ProjectConduitsStore as SlackProjectConduitsStore } from './project-conduits.js';
