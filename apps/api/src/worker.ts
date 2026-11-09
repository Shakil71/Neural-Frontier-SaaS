import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadConfig } from "./config/config.js";
import { JobWorker } from "./modules/jobs/job-worker.js";
import { WorkerModule } from "./worker.module.js";

/**
 * Background worker (systemd: neural-frontier-worker.service). Same configuration as the API.
 * SIGTERM: stop claiming, abort running jobs and hand them back to the queue, then exit.
 */
const config = loadConfig();
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
const worker = app.get(JobWorker);
worker.start();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.get(Logger).log({ signal }, "worker shutting down");
  await worker.stop();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
