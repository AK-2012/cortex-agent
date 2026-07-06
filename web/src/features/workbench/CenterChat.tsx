import { ChatHeader } from './ChatHeader';
import { MessageStream } from './MessageStream';
import { Composer } from './Composer';

// CENTER CHAT pane — 1:1 rebuild from prototype.dc.html L103–395 (workspace-chat view, Stage-R RB
// sibling B, task 89e7). Fills the fluid center pane (flex:1;min-width:0) of the workbench frame.
// Default = the 00-workbench proto-shot state: morning-session, running=true.
//
// Structure: chat header (title · profile chip · running pill · ⌘K) + message stream (TODAY divider,
// user bubble, collapsed tool-call row, assistant text + result chips, an inline thread card wired to
// REAL threads.get [live], an inline approval-required card) + composer (input · running status line
// · slash chip · stop/send).
//
// DATA GAPS (rendered structurally with the prototype's representative content; flagged in the
// completion note with paired stage):
//   • chat transcript body — NO tRPC scope (Stage 4 session send/stream) → static representative copy
//   • approval card — NO approvals scope (Stage 5) → representative APR-0007, inert buttons
//   • composer send — NON-functional (Stage 4) → input + slash palette are local visual state only
// The one LIVE surface is the inline thread card (threads.get + live re-flow).
export function CenterChat(): JSX.Element {
  // Header running pill / composer status line / send-vs-stop follow the morning-session default.
  const running = true;

  const onCmdK = () => {
    // Trigger the global ⌘K command palette (AppShell mounts it via a window keydown hook).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  };

  return (
    <div
      data-pane="center"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        minHeight: 0,
      }}
    >
      <ChatHeader running={running} onCmdK={onCmdK} />
      <MessageStream />
      <Composer running={running} />
    </div>
  );
}
