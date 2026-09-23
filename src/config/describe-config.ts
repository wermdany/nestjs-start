import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from './app.config';
import { DEFAULT_JWT_SECRET } from './env';
import type { JwtConfig } from './jwt.config';
import type { DatabaseConfig } from './database.config';
import type { CorsConfig, ThrottleConfig } from './platform.config';
import type { SwaggerConfig } from './swagger.config';

/**
 * 一次把六个 namespace 读出来（`main.ts` 用它做启动日志与接线）。
 *
 * 每个 namespace 的接口都是**手写**的，而不是靠 `ConfigService` 的 `infer: true` 推导 ——
 * 这样类型与测试断言的是同一份定义，也不依赖 `ConfigService` 的泛型魔法。
 */
export interface ResolvedConfig {
  app: AppConfig;
  swagger: SwaggerConfig;
  cors: CorsConfig;
  throttle: ThrottleConfig;
  jwt: JwtConfig;
  database: DatabaseConfig;
}

/**
 * 🅿️ **还没有消费者**的 namespace。
 *
 * 只影响启动摘要的显示（会加上 `(预留)` 后缀），提醒"这些配置现在还是空转的"。
 * A2（CORS / 限流）与 B1（数据库）接上线时，把对应项从这里删掉即可。
 */
export const RESERVED_NAMESPACES: readonly (keyof ResolvedConfig)[] = [
  'cors',
  'throttle',
  'database',
];

export function readResolvedConfig(config: ConfigService): ResolvedConfig {
  return {
    app: config.getOrThrow<AppConfig>('app'),
    swagger: config.getOrThrow<SwaggerConfig>('swagger'),
    cors: config.getOrThrow<CorsConfig>('cors'),
    throttle: config.getOrThrow<ThrottleConfig>('throttle'),
    jwt: config.getOrThrow<JwtConfig>('jwt'),
    database: config.getOrThrow<DatabaseConfig>('database'),
  };
}

/**
 * 把连接串里的**用户名与密码**换成 `***`。
 *
 * 为什么需要它：日志里出现 `postgres://user:secret@host/db` 是典型的事故来源
 * （日志会被采集、转发、贴进工单）。密码**任何情况下**都不该出现在日志里。
 *
 * 解析不了的值（例如 sqlite 的方言字符串）原样返回 —— 脱敏工具不该成为新的失败点。
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);

    if (url.username) {
      url.username = '***';
    }

    if (url.password) {
      url.password = '***';
    }

    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * 认证配置的摘要：只说明密钥是**已配置**还是**内置默认值**，以及有效期 ——
 * **绝不输出密钥本身**（它会进启动日志、CI 输出与工单截图）。
 */
function describeJwt(jwt: JwtConfig): string {
  const secret =
    jwt.secret === DEFAULT_JWT_SECRET ? 'secret:(默认)' : 'secret:(已配置)';

  return `expires:${jwt.expiresIn},${secret}`;
}

/** 数据库目标的脱敏描述：`postgres@localhost:5432/appdb` / `memory`。 */
function describeDatabase(database: DatabaseConfig): string {
  if (database.driver === 'memory') {
    return 'memory';
  }

  if (database.url) {
    return `${database.driver}@${redactUrl(database.url)}`;
  }

  const port = database.port === undefined ? '' : `:${database.port}`;
  const name = database.name ? `/${database.name}` : '';

  return `${database.driver}@${database.host ?? '(未设)'}${port}${name}`;
}

/**
 * 一行启动摘要。**绝不包含密码，也绝不包含 JWT 密钥**（`describeDatabase` 只输出脱敏后的
 * 连接串，`describeJwt` 只输出"默认/已配置"与有效期）。
 *
 * ```
 * env=development port=3000 host=(默认: 全部网卡) swagger=on(http://localhost:3000)
 *   jwt=expires:1h,secret:(默认) cors=*(预留) throttle=60s/100(预留) db=memory(预留)
 * ```
 */
export function formatConfigSummary(resolved: ResolvedConfig): string {
  const withReservationMark = (
    namespace: keyof ResolvedConfig,
    text: string,
  ): string =>
    RESERVED_NAMESPACES.includes(namespace) ? `${text}(预留)` : text;

  return [
    `env=${resolved.app.env}`,
    `port=${resolved.app.port}`,
    `host=${resolved.app.host ?? '(默认: 全部网卡)'}`,
    `swagger=${
      resolved.swagger.enabled ? `on(${resolved.swagger.serverUrl})` : 'off'
    }`,
    `jwt=${describeJwt(resolved.jwt)}`,
    withReservationMark('cors', `cors=${resolved.cors.origins.join(',')}`),
    withReservationMark(
      'throttle',
      `throttle=${resolved.throttle.ttlSeconds}s/${resolved.throttle.limit}`,
    ),
    withReservationMark(
      'database',
      `db=${describeDatabase(resolved.database)}`,
    ),
  ].join(' ');
}

/** `main.ts` 的便捷入口：读配置 + 一行摘要。 */
export function describeConfig(config: ConfigService): string {
  return formatConfigSummary(readResolvedConfig(config));
}
