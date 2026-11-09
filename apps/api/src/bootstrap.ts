import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./config/config.js";

/** Builds the application. Shared by main.ts, the OpenAPI generator and integration tests. */
export async function createApp(config: AppConfig, opts: { bufferLogs?: boolean } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: opts.bufferLogs ?? true,
  });
  app.useLogger(app.get(Logger));
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(
    helmet({
      // The API serves JSON only; the web app sets its own CSP.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "256kb" });
  // The OAuth token endpoint accepts form-encoded requests (RFC 6749).
  app.useBodyParser("urlencoded", { limit: "16kb", extended: false });
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  if (config.apiDocs) SwaggerModule.setup("api/docs", app, buildOpenApi(app));
  return app;
}

export function buildOpenApi(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle("Neural Frontier API")
    .setDescription(
      "Control-plane API. Authentication is a session cookie set by SSO sign-in. " +
        "State-changing requests require the `x-csrf-token` header from GET /api/v1/auth/session.",
    )
    .setVersion("0.1.0")
    .addCookieAuth("__Host-nf_session")
    .build();
  return SwaggerModule.createDocument(app, doc);
}
