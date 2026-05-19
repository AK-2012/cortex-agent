// input:  agent/user message text + primary/compound outputs
// output: shouldAutoRunCompound + combineFinalOutputs
// pos:    /compound-simple auto-append rules for schedule/dispatch
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

function shouldAutoRunCompound(message) {
  if (typeof message !== 'string') return true;
  return !message.includes('/compound-simple');
}

function combineFinalOutputs(primaryOutput, compoundOutput) {
  const primary = typeof primaryOutput === 'string' ? primaryOutput.trim() : '';
  const compound = typeof compoundOutput === 'string' ? compoundOutput.trim() : '';

  if (!primary) return compound || null;
  if (!compound) return primary;
  return `${primary}\n\n--- Auto compound ---\n${compound}`;
}

export {
  shouldAutoRunCompound,
  combineFinalOutputs,
};
