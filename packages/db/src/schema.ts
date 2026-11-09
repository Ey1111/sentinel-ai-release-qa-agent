import type { AssertionResult, BugReport, Evidence } from "@sentinel/contracts";
import type { LLMCallMetadata } from "@sentinel/llm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { RunPlanRecord } from "./run-store";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const runsTable = pgTable("sentinel_runs", {
  id: text("id").primaryKey(),
  targetUrl: text("target_url").notNull(),
  testGoal: text("test_goal").notNull(),
  maxSteps: integer("max_steps").notNull(),
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull(),
  status: text("status").notNull(),
  plan: jsonb("plan").$type<RunPlanRecord>(),
  result: text("result"),
  failureReason: text("failure_reason"),
  claimedBy: text("claimed_by"),
  heartbeatAt: timestamptz("heartbeat_at"),
  queuedAt: timestamptz("queued_at"),
  startedAt: timestamptz("started_at"),
  finishedAt: timestamptz("finished_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const stepsTable = pgTable("sentinel_run_steps", {
  runId: text("run_id").notNull().references(() => runsTable.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  sequence: integer("sequence").notNull(),
  description: text("description").notNull(),
  expected: text("expected").notNull(),
  assertion: jsonb("assertion").$type<AssertionResult>().notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.id] })]);

export const evidenceTable = pgTable("sentinel_evidence", {
  runId: text("run_id").notNull().references(() => runsTable.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  stepId: text("step_id").notNull(),
  payload: jsonb("payload").$type<Evidence>().notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.id] }), index("sentinel_evidence_id_idx").on(table.id)]);

export const bugDraftsTable = pgTable("sentinel_bug_drafts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runsTable.id, { onDelete: "cascade" }),
  stepId: text("step_id").notNull(),
  revision: integer("revision").notNull(),
  status: text("status").notNull(),
  report: jsonb("report").$type<BugReport>().notNull(),
  provenance: jsonb("provenance").$type<LLMCallMetadata>().notNull(),
}, (table) => [index("sentinel_bug_drafts_run_idx").on(table.runId)]);

// Kept beside the table definitions so the two stay in step; there is no drizzle-kit in this repo.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sentinel_runs (
  id text PRIMARY KEY,
  target_url text NOT NULL,
  test_goal text NOT NULL,
  max_steps integer NOT NULL,
  allowed_origins jsonb NOT NULL,
  status text NOT NULL,
  plan jsonb,
  result text,
  failure_reason text,
  claimed_by text,
  heartbeat_at timestamptz,
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_runs_queue_idx ON sentinel_runs (status, queued_at);
CREATE TABLE IF NOT EXISTS sentinel_run_steps (
  run_id text NOT NULL REFERENCES sentinel_runs(id) ON DELETE CASCADE,
  id text NOT NULL,
  sequence integer NOT NULL,
  description text NOT NULL,
  expected text NOT NULL,
  assertion jsonb NOT NULL,
  PRIMARY KEY (run_id, id)
);
CREATE TABLE IF NOT EXISTS sentinel_evidence (
  run_id text NOT NULL REFERENCES sentinel_runs(id) ON DELETE CASCADE,
  id text NOT NULL,
  step_id text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (run_id, id)
);
CREATE INDEX IF NOT EXISTS sentinel_evidence_id_idx ON sentinel_evidence (id);
CREATE TABLE IF NOT EXISTS sentinel_bug_drafts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES sentinel_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL,
  report jsonb NOT NULL,
  provenance jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS sentinel_bug_drafts_run_idx ON sentinel_bug_drafts (run_id);
`;
