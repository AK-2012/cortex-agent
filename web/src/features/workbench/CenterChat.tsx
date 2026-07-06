// STUB (task f528): the center chat pane slot. Renders only its pane container (prototype L103)
// so the three-pane frame proportions are correct — fluid center (flex:1;min-width:0). The real
// chat surface (header + tool-call rows + inline thread/approval cards + composer) is Stage-R
// sibling B, which replaces this file behind the SAME export signature.
export function CenterChat(): JSX.Element {
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
    />
  );
}
