// Machines tab — STRUCTURAL STUB (prototype.dc.html L1237–1274). GAP-M: there is no tRPC machines
// scope (machines.json + client-manager registry is a Stage-7 backend extension, plan §2.1/§6
// Stage 7). Reproduces the prototype's aggregate-header + list shell with an empty body + a flagged
// note, so the tab's structure/spacing matches; real machine cards land with the Stage-7 scope.
export function RightMachinesTab() {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 18px',
          borderBottom: '1px solid #EFF1F5',
          flex: 'none',
        }}
      >
        <span style={{ fontSize: 10.5, color: '#5B6472' }}>Machines</span>
        <span style={{ marginLeft: 'auto', font: "500 10.5px 'IBM Plex Mono',monospace", color: '#5B6472' }}>
          —
        </span>
      </div>
      <div
        style={{
          flex: 1,
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '26px 12px',
            border: '1px dashed #E7E9EE',
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8A93A2' }}>No machines scope yet</div>
          <div style={{ fontSize: 10.5, color: '#B6BDC9', marginTop: 4, lineHeight: 1.6 }}>
            Connected machines and their live runs will appear here once the machines registry query
            (machines.json + client-manager) lands in a later stage.
          </div>
        </div>
      </div>
    </>
  );
}
