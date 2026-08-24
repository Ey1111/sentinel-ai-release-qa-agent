import { expect, test } from "@playwright/test";

const login = async (page: import("@playwright/test").Page) => {
  await page.getByLabel("Email").fill("qa@taskforge.local");
  await page.getByLabel("Password").fill("sentinel-demo");
  await page.getByRole("button", { name: "Log in" }).click();
};

test.beforeEach(async ({ page }) => {
  await page.goto("/?breakMode=none");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("normal flow logs in, creates, renames, deletes, and logs out", async ({ page }) => {
  await login(page);
  await page.screenshot({ path: "artifacts/phase-1-taskforge-projects.png", fullPage: true });
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Release QA");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("Release QA")).toBeVisible();
  await page.getByRole("button", { name: "Rename Release QA" }).click();
  await page.getByLabel("New project name").fill("Release Gate");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Release Gate")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Release Gate")).toBeVisible();
  await page.getByRole("button", { name: "Delete Release Gate" }).click();
  await expect(page.getByText("Release Gate")).not.toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("rename-persistence makes a renamed project revert after reload", async ({ page }) => {
  await page.goto("/?breakMode=rename-persistence");
  await login(page);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Original name");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Rename Original name" }).click();
  await page.getByLabel("New project name").fill("Changed name");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Changed name")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Original name")).toBeVisible();
});
