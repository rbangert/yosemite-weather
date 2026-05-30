import { setupSchema } from "./db";
import { startServer } from "./api/server";
import { poll, pollSynopticObservations } from "./poller";
import { pollSnotel } from "./snotel/poller";
import { config } from "./config";

setupSchema();
startServer();

// NWS: forecast + NWS station observations on a 15-min cycle.
await poll();
setInterval(poll, config.pollIntervalMs);

// Synoptic: real-station observations on a longer cycle to stay within free-
// tier service-unit limits. Skipped entirely when token is not configured.
if (config.synopticApiToken) {
  await pollSynopticObservations();
  setInterval(pollSynopticObservations, config.synopticPollIntervalMs);
} else {
  console.log("SYNOPTIC_API_TOKEN not set — Synoptic observations disabled.");
}

// SNOTEL: backfill historical SWE on first run, then refresh daily.
pollSnotel().catch((err) => console.error("SNOTEL poll failed:", err));
setInterval(() => pollSnotel().catch((err) => console.error("SNOTEL poll failed:", err)), config.snotelPollIntervalMs);
