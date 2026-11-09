/* global console, fetch, process, setTimeout */
// Drives the running stack through one passing and one failing TaskForge Run.
// Needs the API, Worker, demo target, and PostgreSQL running with SENTINEL_LLM_PROVIDER=mock. See docs/e2e-demo.md.
const api = process.env.SENTINEL_API_BASE_URL ?? "http://127.0.0.1:4000";
const target = process.env.SENTINEL_DEMO_TARGET ?? `http://localhost:${process.env.DEMO_TARGET_PORT ?? 4174}/`;
const real = process.argv.includes("--real");
const timeoutMs = Number(process.env.SENTINEL_DEMO_TIMEOUT_MS ?? (real ? 300_000 : 90_000));
const goal = real
  ? "Sign in with the provided test account and confirm the Projects workspace appears. Report a failure if sign-in does not succeed."
  : "Sign in and reach the Projects workspace";

async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(`${api}${path}`, { ...init, headers: init.body ? { "content-type": "application/json" } : {} });
  } catch {
    throw new Error(`Cannot reach the API at ${api}. Is it running?`);
  }
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function runScenario(name, url, expected) {
  console.log(`\n== ${name}`);
  const run = await call("/api/v1/runs", { method: "POST", body: JSON.stringify({ targetUrl: url, testGoal: goal, maxSteps: 12 }) });
  const plan = await call(`/api/v1/runs/${run.id}/plan`, { method: "POST" });
  if (plan.provenance.isMock === real) throw new Error(real ? "--real needs a real SENTINEL_LLM_PROVIDER." : "This demo expects SENTINEL_LLM_PROVIDER=mock.");
  if (real) {
    console.log(`model: ${plan.provenance.provider}/${plan.provenance.model}`);
    for (const step of plan.plan.steps) console.log(`  plan: ${step.description} -> ${step.expectedState}`);
  }
  await call(`/api/v1/runs/${run.id}/plan/approve`, { method: "POST", body: JSON.stringify({ version: plan.version }) });
  const started = await call(`/api/v1/runs/${run.id}/start`, { method: "POST" });
  console.log(`run ${run.id}: ${started.runStatus}`);

  const deadline = Date.now() + timeoutMs;
  let last = started.runStatus;
  let state;
  while (Date.now() < deadline) {
    state = await call(`/api/v1/runs/${run.id}`);
    if (state.status !== last) {
      console.log(`status: ${state.status}`);
      last = state.status;
    }
    if (state.status === "COMPLETED" || state.status === "FAILED") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (state?.status !== "COMPLETED") throw new Error(`Run did not complete: ${JSON.stringify(state)}`);

  const [{ steps }, { evidence }, { bugs }] = await Promise.all([
    call(`/api/v1/runs/${run.id}/steps`),
    call(`/api/v1/runs/${run.id}/evidence`),
    call(`/api/v1/runs/${run.id}/bugs`),
  ]);
  for (const step of steps) console.log(`  ${step.verdict}  ${step.description}`);
  console.log(`result: ${state.result}; evidence: ${evidence.length}; bug drafts: ${bugs.length}`);
  for (const bug of bugs) console.log(`  bug: ${bug.title}`);
  console.log(`view: http://localhost:3000/?runId=${run.id}`);
  if (state.result !== expected) throw new Error(`Expected ${expected}, got ${state.result}`);
}

const separator = target.includes("?") ? "&" : "?";
await runScenario("Passing run (normal TaskForge)", target, "PASS");
await runScenario("Failing run (login-failure break mode)", `${target}${separator}breakMode=login-failure`, "FAIL");
console.log(real ? "\nBoth scenarios matched using a real model." : "\nBoth scenarios matched. These results use a scripted demo provider, not a real model.");
