// input:  nothing (pure types module)
// output: UpdateChoice type + UpdatePrompt interface
// pos:    Platform-agnostic interface for server update prompts
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export type UpdateChoice = 'apply' | 'skip' | 'cancel';

export interface UpdatePrompt {
  /** Present an update prompt to the user.
   *  Returns the user's choice, or null if the prompt was dismissed (timeout / superseded). */
  ask(spec: { latestVersion: string }): Promise<UpdateChoice | null>;
}
