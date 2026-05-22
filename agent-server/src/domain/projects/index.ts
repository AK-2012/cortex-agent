// Barrel re-export for domain/projects/ — single import surface for all callers.
// Physical split: project-types + project-store

export type { Project } from './project-types.js';
export { ProjectStore, projectStore } from './project-store.js';
