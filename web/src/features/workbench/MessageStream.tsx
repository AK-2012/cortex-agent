import { MORNING } from './chat-content';
import { ToolCallsRow } from './ToolCallsRow';
import { InlineThreadCardProto } from './InlineThreadCardProto';
import { ApprovalCard } from './ApprovalCard';

// Message stream — 1:1 from prototype.dc.html L131–357 (morning session, running). DATA GAP
// (transcript — Stage 4): no session-transcript tRPC scope, so the divider / user bubble / tool-call
// row / assistant text+chips are the prototype's exact morning content rendered as static content.
// The only live surface is the inline thread card (threads.get). Approval card is Stage-5 gap.

const mono = "'IBM Plex Mono',monospace";

function Divider({ text }: { text: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, height: 1, background: '#EFF1F5' }} />
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', color: '#B6BDC9' }}>{text}</div>
      <div style={{ flex: 1, height: 1, background: '#EFF1F5' }} />
    </div>
  );
}

function UserBubble({ text }: { text: string }): JSX.Element {
  return (
    <div
      style={{
        alignSelf: 'flex-end',
        maxWidth: '75%',
        animation: 'cxmsg .34s cubic-bezier(.22,1,.36,1) both',
        background: '#F1F2F5',
        borderRadius: '14px 14px 4px 14px',
        padding: '9px 14px',
        fontSize: 13.5,
        lineHeight: 1.55,
        color: '#191C22',
      }}
    >
      {text}
    </div>
  );
}

function AssistantBlock({
  text,
  chips,
}: {
  text: string;
  chips?: { text: string; bg: string; color: string }[];
}): JSX.Element {
  return (
    <div style={{ animation: 'cxmsg .34s cubic-bezier(.22,1,.36,1) both', fontSize: 14, lineHeight: 1.65, color: '#22262E' }}>
      {text}
      {chips && chips.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {chips.map((c, i) => (
            <span
              key={i}
              style={{
                font: `600 11.5px ${mono}`,
                background: c.bg,
                color: c.color,
                padding: '3px 9px',
                borderRadius: 6,
              }}
            >
              {c.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageStream(): JSX.Element {
  return (
    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '22px 32px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <Divider text={MORNING.divider} />
        <UserBubble text={MORNING.userMessage} />
        <ToolCallsRow calls={MORNING.toolCalls} />
        <AssistantBlock text={MORNING.assistant1} chips={MORNING.assistant1Chips} />
        <AssistantBlock text={MORNING.assistant2} />
        <InlineThreadCardProto />
        <ApprovalCard approval={MORNING.approval} />
      </div>
    </div>
  );
}
