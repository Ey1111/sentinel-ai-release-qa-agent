export const breakModes = ["none", "rename-persistence", "login-failure", "api-500", "slow-network", "delete-failure"] as const;
export type BreakMode = (typeof breakModes)[number];
export type Project = { id: string; name: string };
export type ProjectAction =
  | { type: "create"; project: Project }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string };

export function parseBreakMode(value: string | null): BreakMode {
  return breakModes.find((mode) => mode === value) ?? "none";
}

export function applyProjectAction(projects: Project[], action: ProjectAction, mode: BreakMode) {
  let visible: Project[];
  if (action.type === "create") visible = [...projects, action.project];
  else if (action.type === "rename") visible = projects.map((project) => project.id === action.id ? { ...project, name: action.name } : project);
  else visible = projects.filter((project) => project.id !== action.id);

  const persistenceBroken = (action.type === "rename" && mode === "rename-persistence") || (action.type === "delete" && mode === "delete-failure");
  return { visible, persisted: persistenceBroken ? projects : visible };
}
