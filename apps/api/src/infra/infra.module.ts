import { type DynamicModule, Global, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DatabaseService } from "./database.service.js";
import { RedisService } from "./redis.service.js";

/** Configuration and connections, created once and shared by every domain module. */
@Global()
@Module({})
export class InfraModule {
  private static instance: DynamicModule | null = null;

  static forRoot(config: AppConfig): DynamicModule {
    // Same module object on every import, so Nest instantiates each provider exactly once.
    InfraModule.instance ??= {
      module: InfraModule,
      providers: [{ provide: APP_CONFIG, useValue: config }, DatabaseService, RedisService],
      exports: [APP_CONFIG, DatabaseService, RedisService],
    };
    return InfraModule.instance;
  }
}
