import { config } from "../config";
import { handleRequest } from "./routes";

export function startServer(): void {
  Bun.serve({
    port: config.apiPort,
    fetch: handleRequest,
  });

  console.log(`API server listening on http://localhost:${config.apiPort}`);
}
