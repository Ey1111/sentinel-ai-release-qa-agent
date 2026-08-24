import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders an honest Phase 1 run creation shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Release QA" })).toBeInTheDocument();
  expect(screen.getByLabelText("Target URL")).toBeInTheDocument();
  expect(screen.getByLabelText("Test Goal")).toBeInTheDocument();
  expect(screen.getByText("No runs yet")).toBeInTheDocument();
  expect(screen.getByText("Phase 1 shell")).toBeInTheDocument();
});
