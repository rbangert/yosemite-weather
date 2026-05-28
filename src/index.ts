import { setupSchema } from "./db";
import { startServer } from "./api/server";
import { poll } from "./poller";
import { config } from "./config";

setupSchema();
startServer();

// Initial poll on startup, then on interval
await poll();
setInterval(poll, config.pollIntervalMs);
