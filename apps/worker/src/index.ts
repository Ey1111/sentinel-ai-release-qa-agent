import { createHeartbeat } from "./heartbeat";

process.stdout.write(`${JSON.stringify(createHeartbeat())}\n`);
