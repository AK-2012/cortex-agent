// input:  nothing (leaf data slice)
// output: startupEn / startupZh — message slice (filled by i18n extraction)
// pos:    one locale slice; aggregated by core/locales/en.ts & zh.ts barrels
// >>> Keep en and zh keys in lockstep (zh typed against keyof typeof startupEn) <<<

export const startupEn = {
  'startup.started': 'Cortex agent v${version} started on ${machine}.',
  'startup.restarted': 'Cortex agent v${version} restarted on ${machine}.',
  'startup.reason': ' Reason: ${reason}.',
} as const;

export const startupZh: Record<keyof typeof startupEn, string> = {
  'startup.started': 'Cortex 代理 v${version} 已在 ${machine} 上启动。',
  'startup.restarted': 'Cortex 代理 v${version} 已在 ${machine} 上重启。',
  'startup.reason': ' 原因：${reason}。',
};
