# End-to-end demo

This walks one Run through the whole chain: create, plan, approve, queue, Worker claim, real Chromium execution, PostgreSQL persistence, and viewing the result.

The demo uses `SENTINEL_LLM_PROVIDER=mock`, which selects a scripted provider that only knows TaskForge. Real browser actions and real evidence are produced, but the decisions are scripted. The UI labels this as `MOCK FIXTURE`. It is not evidence of real model quality.

## 1. Prepare

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

In `.env`, set:

```text
SENTINEL_LLM_PROVIDER=mock
SENTINEL_ALLOW_LOCALHOST=true
```

## 2. Start PostgreSQL

```bash
docker compose up -d --wait
```

Any PostgreSQL works if `DATABASE_URL` points at it. Tables are created on first use.

## 3. Start the services

```bash
pnpm dev
```

This starts the web app (3000), API (4000), Worker, and TaskForge (4174). The Worker logs `demo script, not a real model` while in this mode.

## 4. Run the demo

In a second terminal:

```bash
pnpm demo:e2e
```

Expected output: a run with result `PASS` for normal TaskForge, then a run with result `FAIL` and one bug draft for `breakMode=login-failure`. Each prints a link to open at `http://localhost:3000/?runId=...`.

## 5. Check that results survive a restart

Stop `pnpm dev`, start it again, and reopen a printed link. The status, steps, and bug draft are read back from PostgreSQL. Screenshots are read from `artifacts/runs/<run_id>/`, so keep that directory.

## From the UI

Open `http://localhost:3000`, enter `http://localhost:4174/` as the target, create and accept the plan, then choose **Start run**. Add `?breakMode=login-failure` to the target to see a failure.

## With a real model

In `.env`, set your own key and the test account. Only the secret names are sent to the model; the worker fills in the values, and only on origins listed in `SENTINEL_SECRET_ALLOWED_ORIGINS`.

```text
SENTINEL_LLM_PROVIDER=deepseek
SENTINEL_LLM_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=<your key>
SENTINEL_ALLOW_LOCALHOST=true
SENTINEL_SECRET_ALLOWED_ORIGINS=http://localhost:4174
SENTINEL_SECRET_TASKFORGE_EMAIL=qa@taskforge.local
SENTINEL_SECRET_TASKFORGE_PASSWORD=sentinel-demo
```

Restart the services, then run `pnpm demo:e2e --real`. A real model can decide differently each time, so one passing pair is not an evaluation.

TaskForge prints its demo credentials on the sign-in page. Sentinel redacts them and withholds screenshots of that page, so expect text evidence rather than an image there.

## Run states

| Status | Meaning |
| --- | --- |
| `QUEUED` | Waiting for a Worker. No browser action has happened. |
| `RUNNING` | A Worker holds the Run and is heartbeating. |
| `COMPLETED` | A verdict was recorded. See `result`: `PASS`, `FAIL`, or `UNCERTAIN`. |
| `FAILED` | Stopped without a verdict. See `failureReason`. |

If a Worker dies mid-run, its Run becomes `FAILED` with `WORKER_LOST` after 60 seconds. It is not retried automatically, because repeating browser actions could change the target twice.
