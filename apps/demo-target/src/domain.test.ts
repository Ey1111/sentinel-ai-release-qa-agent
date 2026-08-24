import { describe, expect, it } from "vitest";
import { applyProjectAction } from "./domain";

const alpha = { id: "project-alpha", name: "Alpha" };

describe("TaskForge project persistence policy", () => {
  it("persists a renamed project in normal mode", () => {
    const result = applyProjectAction([alpha], { type: "rename", id: alpha.id, name: "Beta" }, "none");
    expect(result).toEqual({ visible: [{ id: "project-alpha", name: "Beta" }], persisted: [{ id: "project-alpha", name: "Beta" }] });
  });

  it("injects rename-persistence by changing only visible state", () => {
    const result = applyProjectAction([alpha], { type: "rename", id: alpha.id, name: "Beta" }, "rename-persistence");
    expect(result).toEqual({ visible: [{ id: "project-alpha", name: "Beta" }], persisted: [alpha] });
  });

  it("injects delete-failure by retaining persisted state", () => {
    const result = applyProjectAction([alpha], { type: "delete", id: alpha.id }, "delete-failure");
    expect(result).toEqual({ visible: [], persisted: [alpha] });
  });
});
