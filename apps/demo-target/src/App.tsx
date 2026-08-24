import { FormEvent, useState } from "react";
import { applyProjectAction, breakModes, type BreakMode, type Project, type ProjectAction } from "./domain";

const SESSION_KEY = "taskforge:session";
const PROJECTS_KEY = "taskforge:projects";
const DEMO_EMAIL = "qa@taskforge.local";
const DEMO_PASSWORD = "sentinel-demo";

function readProjects(): Project[] {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]") as Project[]; } catch { return []; }
}

function delayFor(mode: BreakMode) {
  return mode === "slow-network" ? new Promise((resolve) => setTimeout(resolve, 900)) : Promise.resolve();
}

export function App({ initialBreakMode = "none" }: { initialBreakMode?: BreakMode }) {
  const [mode, setMode] = useState(initialBreakMode);
  const [signedIn, setSignedIn] = useState(() => localStorage.getItem(SESSION_KEY) === "active");
  const [projects, setProjects] = useState<Project[]>(readProjects);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"create" | "rename" | null>(null);
  const [selected, setSelected] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");

  const updateMode = (next: BreakMode) => {
    setMode(next);
    const url = new URL(window.location.href);
    url.searchParams.set("breakMode", next);
    window.history.replaceState({}, "", url);
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError(""); setBusy(true); await delayFor(mode);
    const data = new FormData(form);
    if (mode === "login-failure" || data.get("email") !== DEMO_EMAIL || data.get("password") !== DEMO_PASSWORD) {
      setError("Unable to sign in. Check your credentials and try again."); setBusy(false); return;
    }
    localStorage.setItem(SESSION_KEY, "active"); setSignedIn(true); setBusy(false);
  };

  const mutate = (action: ProjectAction) => {
    const result = applyProjectAction(projects, action, mode);
    setProjects(result.visible);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(result.persisted));
  };

  const submitProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setBusy(true); await delayFor(mode);
    if (dialog === "create" && mode === "api-500") { setError("API 500: Project could not be created."); setBusy(false); setDialog(null); return; }
    const name = projectName.trim();
    if (!name) { setError("Project name is required."); setBusy(false); return; }
    if (dialog === "create") mutate({ type: "create", project: { id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()), name } });
    if (dialog === "rename" && selected) mutate({ type: "rename", id: selected.id, name });
    setBusy(false); setDialog(null); setSelected(null); setProjectName("");
  };

  const logout = () => { localStorage.removeItem(SESSION_KEY); setSignedIn(false); setError(""); };

  return (
    <div className="taskforge-shell">
      <header className="topbar"><a className="tf-brand" href="/">Task<span>Forge</span></a><div className="mode-control"><label htmlFor="break-mode">Break mode</label><select id="break-mode" value={mode} onChange={(event) => updateMode(event.target.value as BreakMode)}>{breakModes.map((item) => <option key={item} value={item}>{item === "none" ? "Normal" : item}</option>)}</select></div></header>
      {!signedIn ? (
        <main className="login-layout"><section className="login-copy"><p className="kicker">Project delivery, without the noise</p><h1>Keep the work moving.</h1><p>TaskForge is a controlled demo application for validating real browser QA workflows.</p><div className="fixture"><strong>Demo credentials</strong><code>{DEMO_EMAIL}</code><code>{DEMO_PASSWORD}</code></div></section><section className="login-panel"><p className="panel-label">Workspace access</p><h2>Welcome back</h2><p>Sign in to manage your projects.</p><form onSubmit={login}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required />{error && <p role="alert" className="error">{error}</p>}<button disabled={busy} type="submit">{busy ? "Signing in…" : "Log in"}</button></form></section></main>
      ) : (
        <main className="projects-layout"><div className="workspace-header"><div><p className="kicker">TaskForge workspace</p><h1>Projects</h1><p>Plan, rename, and retire release workspaces.</p></div><div className="header-actions"><button type="button" className="secondary" onClick={logout}>Log out</button><button type="button" onClick={() => { setProjectName(""); setDialog("create"); }}><span aria-hidden="true">+ </span>New project</button></div></div>{error && <p role="alert" className="error banner">{error}</p>}<section className="project-table" aria-label="Projects"><div className="table-head"><span>Project name</span><span>Status</span><span>Actions</span></div>{projects.length === 0 ? <div className="project-empty"><strong>No projects yet</strong><p>Create a project to start planning release work.</p></div> : projects.map((project) => <div className="project-row" key={project.id}><div className="project-name"><span aria-hidden="true">TF</span><strong>{project.name}</strong></div><span className="status"><i />Active</span><div className="row-actions"><button className="icon-button" type="button" aria-label={`Rename ${project.name}`} onClick={() => { setSelected(project); setProjectName(project.name); setDialog("rename"); }}>Rename</button><button className="icon-button danger" type="button" aria-label={`Delete ${project.name}`} onClick={() => mutate({ type: "delete", id: project.id })}>Delete</button></div></div>)}</section>
        {dialog && <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog"><p className="panel-label">Project details</p><h2 id="dialog-title">{dialog === "create" ? "Create project" : "Rename project"}</h2><form onSubmit={submitProject}><label htmlFor="project-name">{dialog === "create" ? "Project name" : "New project name"}</label><input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} autoFocus /><div className="dialog-actions"><button type="button" className="secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving…" : dialog === "create" ? "Create project" : "Save name"}</button></div></form></section></div>}
        </main>
      )}
      <footer><span>TaskForge Demo Target</span><span>Mode: <strong>{mode}</strong></span></footer>
    </div>
  );
}
