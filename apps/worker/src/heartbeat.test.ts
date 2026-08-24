import { expect, it } from "vitest";
import { createHeartbeat } from "./heartbeat";

it("publishes an honest idle heartbeat before run execution exists", () => {
  expect(createHeartbeat(new Date("2026-08-24T04:00:00.000Z"))).toEqual({
    at: "2026-08-24T04:00:00.000Z",
    service: "sentinel-worker",
    status: "idle",
  });
});
