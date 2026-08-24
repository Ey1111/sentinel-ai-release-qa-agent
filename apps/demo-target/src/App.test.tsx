import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { App } from "./App";

beforeEach(() => localStorage.clear());

it("supports the normal login and create-project flow", async () => {
  render(<App initialBreakMode="none" />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa@taskforge.local" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "sentinel-demo" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Release QA" } });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  expect(await screen.findByText("Release QA")).toBeInTheDocument();
});

it("rejects valid credentials in login-failure mode", async () => {
  render(<App initialBreakMode="login-failure" />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa@taskforge.local" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "sentinel-demo" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to sign in");
});
