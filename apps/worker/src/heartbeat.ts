export type WorkerHeartbeat = {
  at: string;
  service: "sentinel-worker";
  status: "idle";
};

export function createHeartbeat(now = new Date()): WorkerHeartbeat {
  return { at: now.toISOString(), service: "sentinel-worker", status: "idle" };
}
