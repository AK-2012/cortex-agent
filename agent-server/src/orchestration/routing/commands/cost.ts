import type { Destination, PlatformAdapter } from '@platform/index.js';
import { formatCostReport, checkBudget, setBudget } from '@domain/costs/cost-tracker.js';
import { Icons } from '../../../core/icons.js';

export async function handleCostCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const project = trimmedMessage.split(/\s+/).slice(1).join(' ').trim() || null;
  await adapter.postMessage(dest, { text: await formatCostReport(project) });
}

export async function handleBudgetCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const args = trimmedMessage.split(/\s+/).slice(1);
  if (args.length === 0) {
    const b = await checkBudget();
    await adapter.postMessage(dest, {
      text: `*Budget*\n• Daily: $${b.dailyBudget} (spent: $${b.dailySpent.toFixed(2)}, remaining: $${b.dailyRemaining.toFixed(2)})\n• Monthly: $${b.monthlyBudget} (spent: $${b.monthlySpent.toFixed(2)}, remaining: $${b.monthlyRemaining.toFixed(2)})`,
    });
    return;
  }
  const daily = args.find(a => a.includes('/d'))?.replace(/[^\d.]/g, '');
  const monthly = args.find(a => a.includes('/m'))?.replace(/[^\d.]/g, '');
  const result = await setBudget({
    daily_usd: daily ? parseFloat(daily) : undefined,
    monthly_usd: monthly ? parseFloat(monthly) : undefined,
  });
  await adapter.postMessage(dest, { text: `${Icons.ok} Budget updated: $${result.daily_usd}/day, $${result.monthly_usd}/month` });
}
