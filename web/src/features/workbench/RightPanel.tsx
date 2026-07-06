// STUB (task f528): the right panel pane slot. Renders only its pane container (prototype L1093)
// so the three-pane frame proportions are correct — 400px fixed (flex:none). The real right panel
// (Threads/Tasks/Machines tabs + cost bar + Active/History + step-tree cards) is Stage-R sibling C,
// which replaces this file behind the SAME export signature.
export function RightPanel(): JSX.Element {
  return (
    <div
      data-pane="right"
      style={{
        width: '400px',
        flex: 'none',
        background: '#FBFBFC',
        borderLeft: '1px solid #E7E9EE',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    />
  );
}
