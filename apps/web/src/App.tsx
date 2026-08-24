const navItems = ["Runs", "New Run", "Bug Reports"];

export function App() {
  return (
    <div className="sentinel-shell">
      <aside className="sidebar">
        <a className="brand" href="#main" aria-label="Sentinel home"><span className="brand-mark">S</span><span>Sentinel</span></a>
        <nav aria-label="Primary navigation">
          {navItems.map((item, index) => <a key={item} className={index === 0 ? "active" : ""} href={`#${item.toLowerCase().replace(" ", "-")}`}><span aria-hidden="true">{index === 0 ? "▣" : index === 1 ? "+" : "◇"}</span>{item}</a>)}
        </nav>
        <div className="phase-note"><span>Foundation</span><strong>Phase 1</strong><small>Runtime not connected</small></div>
      </aside>
      <main id="main">
        <header className="page-header"><div><p className="eyebrow">Sentinel workspace</p><h1>Release QA</h1><p>Turn a release goal into a browser-verified acceptance run.</p></div><span className="phase-pill">Phase 1 shell</span></header>
        <section className="run-card" aria-labelledby="new-run-heading">
          <div className="section-heading"><div><p className="step-label">01 · Define scope</p><h2 id="new-run-heading">New test run</h2></div><span className="draft-status">Draft</span></div>
          <form onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="target-url">Target URL</label>
            <input id="target-url" type="url" placeholder="https://staging.example.com" />
            <p className="field-help">Use a test or staging environment you are authorized to inspect.</p>
            <label htmlFor="test-goal">Test Goal</label>
            <textarea id="test-goal" rows={4} placeholder="Test registration, sign in, create a project, rename it, then sign out…" />
            <p className="field-help">Describe the user journey and what success should look like.</p>
            <div className="form-footer"><button type="button" disabled title="Planner arrives in a later phase">Create test plan <span aria-hidden="true">→</span></button><small>Planner is not connected in Phase 1</small></div>
          </form>
        </section>
        <section className="recent-card" aria-labelledby="recent-heading">
          <div className="recent-header"><div><p className="step-label">02 · Review outcomes</p><h2 id="recent-heading">Recent runs</h2></div><button type="button" className="filter" disabled>All statuses</button></div>
          <div className="empty-state"><div className="empty-icon" aria-hidden="true">□</div><h3>No runs yet</h3><p>Your completed release QA runs will appear here with PASS / FAIL status and bug count.</p></div>
        </section>
      </main>
    </div>
  );
}
