// input:  ./types.js (RichBlock/ModalDefinition/ActionElement)
// output: Question types + buildQuestion*/buildPlan* builders
// pos:    Platform-independent interactive component builder
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { RichBlock, ModalDefinition, ActionElement } from './types.js';
import { Icons } from '../core/icons.js';

// --- Question group types ---

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionRecord {
  pendingId: string;
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface QuestionGroup {
  groupId: string;
  questions: QuestionRecord[];
  answers: Map<string, { header: string; value: string | string[] }>;
}

// --- AskUserQuestion builders ---

export function buildQuestionGroupBlocks(group: QuestionGroup): RichBlock[] {
  const blocks: RichBlock[] = [];
  const allAnswered = group.answers.size === group.questions.length;
  for (const [qIdx, q] of group.questions.entries()) {
    if (qIdx > 0) blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: `*${q.header}*\n${q.question}` });
    const answer = group.answers.get(q.pendingId);
    if (answer) {
      const formatted = Array.isArray(answer.value) ? `[${answer.value.join(', ')}]` : answer.value;
      blocks.push({ type: 'context', text: `${Icons.ok} ${formatted}` });
    } else {
      const optionsList = q.options.map(o => o.label).join(' · ');
      blocks.push({ type: 'context', text: `_${optionsList}_` });
    }
  }
  if (!allAnswered) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button' as const,
        text: `Answer (${group.answers.size}/${group.questions.length})`,
        actionId: 'ask_user_question_open_modal',
        value: group.groupId,
        style: 'primary' as const,
      }],
    });
  }
  return blocks;
}

export function buildQuestionModalDefinition(group: QuestionGroup): ModalDefinition {
  const fields: ModalDefinition['fields'] = [];
  for (const [qIdx, q] of group.questions.entries()) {
    let questionText = `*${q.header}*\n${q.question}`;
    if (q.options.some(o => o.description)) {
      for (const option of q.options) {
        if (option.description) questionText += `\n• *${option.label}*: ${option.description}`;
      }
    }
    fields.push({ type: 'section', text: questionText });
    // Only add select field when there are options — Slack rejects empty option lists.
    if (q.options.length > 0) {
      fields.push({
        type: q.multiSelect ? 'multi_select' : 'select',
        blockId: `q_${qIdx}`,
        label: q.multiSelect ? 'Select one or more' : 'Select one',
        actionId: 'selection',
        placeholder: q.multiSelect ? 'Select one or more' : 'Select one',
        options: q.options.map((option, optIdx) => ({
          label: option.label,
          value: String(optIdx),
        })),
        optional: true,
      });
      fields.push({
        type: 'text_input',
        blockId: `q_${qIdx}_other`,
        label: 'Or type your answer',
        actionId: 'other_text',
        placeholder: 'Custom answer (overrides selection above)',
        optional: true,
      });
    } else {
      // Free-form text only — no select, text_input is required.
      fields.push({
        type: 'text_input',
        blockId: `q_${qIdx}_other`,
        label: 'Your answer',
        actionId: 'other_text',
        placeholder: 'Type your answer',
        optional: false,
      });
    }
  }
  return {
    callbackId: 'ask_user_question_modal_submit',
    title: 'Questions',
    submitLabel: 'Submit',
    closeLabel: 'Cancel',
    privateMetadata: JSON.stringify({ groupId: group.groupId }),
    fields,
  };
}

// --- Plan approval builders ---

export function buildPlanApprovalContent(requestId: string): { richBlocks: RichBlock[]; actions: ActionElement[] } {
  return {
    richBlocks: [
      { type: 'section', text: `${Icons.memo} *Plan ready for review.* Approve to proceed or provide feedback.` },
    ],
    actions: [
      { type: 'button', text: 'Approve', actionId: 'hook_plan_approve', value: requestId, style: 'primary' },
      { type: 'button', text: 'Provide Feedback', actionId: 'hook_plan_feedback', value: requestId },
    ],
  };
}

export function buildPlanFeedbackModal(requestId: string): ModalDefinition {
  return {
    callbackId: 'hook_plan_feedback_submit',
    title: 'Plan Feedback',
    submitLabel: 'Submit',
    closeLabel: 'Cancel',
    privateMetadata: JSON.stringify({ requestId }),
    fields: [{
      type: 'text_input',
      blockId: 'feedback',
      label: 'Your feedback (Cortex will revise the plan)',
      actionId: 'text',
      multiline: true,
      placeholder: 'What should be changed?',
    }],
  };
}
