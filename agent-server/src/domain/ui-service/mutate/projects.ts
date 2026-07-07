// input:  UiServiceDeps + { name }
// output: create-project handler → Ok<{ id }> | Err (invalid-name / already-exists)
// pos:    mutate handler for 'projects.create'

import type { UiServiceDeps, Result, ProjectCreateReturn } from '../types.js';

export async function handleCreateProject(
  deps: UiServiceDeps,
  args: { name: string },
): Promise<Result<ProjectCreateReturn>> {
  const created = deps.projectStore.createProject(args.name);
  if ('project' in created) {
    return { ok: true, data: { id: created.project.id } };
  }
  return { ok: false, code: created.code, message: created.message };
}
