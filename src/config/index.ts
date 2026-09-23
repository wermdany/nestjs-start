/**
 * 配置模块（`src/config/`）的**对外门面**。
 *
 * 与 `src/contract/index.ts` 同一套规矩：**内部互相引用走具体文件**（`api-contract.module.ts`
 * 里写 `./env` 而不是 `@/config`），门面只做**显式具名导出**，不用 `export *`
 * （`export *` 的重名遮蔽与书写顺序问题在契约层的注释里记过）。
 */

export {
  AppConfigModule,
  resolveEnvFilePaths,
  shouldIgnoreEnvFile,
} from './app-config.module';

// ── env 契约：常量 + 校验 + 转换 ──────────────────────────────────────────────
export { configWarnings, EnvValidationError, validateEnv } from './env';
export type { EnvSource, NodeEnv } from './env';
export {
  BOOLEAN_VALUES,
  DATABASE_DRIVERS,
  DATABASE_POOL_SIZE_MAX,
  DEFAULT_CORS_ORIGINS,
  DEFAULT_DATABASE_DRIVER,
  DEFAULT_DATABASE_LOGGING,
  DEFAULT_DATABASE_MIGRATIONS_RUN,
  DEFAULT_DATABASE_POOL_SIZE,
  DEFAULT_DATABASE_PORTS,
  DEFAULT_DATABASE_SSL,
  DEFAULT_DATABASE_SYNCHRONIZE,
  DEFAULT_ENVELOPE,
  DEFAULT_JWT_EXPIRES_IN,
  DEFAULT_JWT_SECRET,
  DEFAULT_NODE_ENV,
  DEFAULT_PORT,
  DEFAULT_STRICT_VALIDATION,
  DEFAULT_SWAGGER_SERVER_URL,
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL_SECONDS,
  JWT_EXPIRES_IN_PATTERN,
  JWT_SECRET_MIN_WARN_LENGTH,
  NODE_ENVS,
  parseCorsOrigins,
  toBoolean,
  toInt,
  toOptionalInt,
  toOptionalString,
} from './env';
export type { DatabaseDriver } from './env';

// ── 六个 namespace 的读取函数与 registerAs 工厂 ───────────────────────────────
export { appConfig, readAppConfig } from './app.config';
export type { AppConfig } from './app.config';

export { readSwaggerConfig, swaggerConfig } from './swagger.config';
export type { SwaggerConfig } from './swagger.config';

export {
  corsConfig,
  readCorsConfig,
  readThrottleConfig,
  throttleConfig,
} from './platform.config';
export type { CorsConfig, ThrottleConfig } from './platform.config';

export { jwtConfig, readJwtConfig } from './jwt.config';
export type { JwtConfig } from './jwt.config';

export { databaseConfig, readDatabaseConfig } from './database.config';
export type { DatabaseConfig } from './database.config';

// ── 启动摘要与脱敏 ────────────────────────────────────────────────────────────
export {
  describeConfig,
  formatConfigSummary,
  readResolvedConfig,
  redactUrl,
  RESERVED_NAMESPACES,
} from './describe-config';
export type { ResolvedConfig } from './describe-config';
