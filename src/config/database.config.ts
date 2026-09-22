import { registerAs } from '@nestjs/config';
import {
  DEFAULT_DATABASE_DRIVER,
  DEFAULT_DATABASE_LOGGING,
  DEFAULT_DATABASE_MIGRATIONS_RUN,
  DEFAULT_DATABASE_POOL_SIZE,
  DEFAULT_DATABASE_PORTS,
  DEFAULT_DATABASE_SSL,
  DEFAULT_DATABASE_SYNCHRONIZE,
  isDatabaseDriver,
  toBoolean,
  toOptionalInt,
  toOptionalString,
} from './env';
import type { DatabaseDriver, EnvSource } from './env';

/**
 * 数据库配置 —— **本次只预留，不接任何 ORM**（🅿️ B1 落地时才消费）。
 *
 * 为什么值得先立契约：等真的要上 TypeORM/Prisma 时，"该有哪些字段、默认值是什么、
 * 少了什么必须启动失败"这些决定会散落在 ORM 模块的 `forRootAsync` 里；
 * 提前定下来之后，B1 只需要把 `config.getOrThrow<DatabaseConfig>('database')`
 * 映射到驱动选项，不需要重新讨论契约。
 *
 * ## 预留的连接契约（B1 必须遵守）
 *
 * 1. **`url` 优先**：`url` 存在时，`host` / `port` / `username` / `password` / `name`
 *    一律忽略（这是社区惯例，也是云厂商只给一个连接串的现实）。B1 里实现映射时先判断 `url`。
 * 2. **`port` 已经算好**：未显式设置时按驱动给默认值（postgres 5432 / mysql 3306），
 *    所以 B1 不需要再写一遍"如果没有端口就用 5432"。
 * 3. **`memory` 是默认驱动**：现在整套服务不连数据库，所以不设任何 `DATABASE_*` 也能启动；
 *    `driver !== 'memory'` 时缺少必要字段会在**启动期**失败（见 `env.ts` 的跨字段校验）。
 * 4. **`synchronize` 在生产环境禁止为 `true`**：校验器会直接拒绝启动，防止 ORM 自动改表。
 * 5. **`password` 是敏感字段**：任何日志/健康检查/调试接口都不得打印它；
 *    打印连接目标请用 `describe-config.ts` 的 `redactUrl()` / 摘要行。
 *
 * ## 与 `@nestjs/config` 的关系
 *
 * 上一层的 `DATABASE_URL` 之类字段在 `env.ts` 里做**形状与跨字段校验**；
 * 这里只负责「读出来 + 补默认值 + 给出稳定的类型」。
 */
export interface DatabaseConfig {
  /** `memory` 表示"还没接数据库"。 */
  driver: DatabaseDriver;
  /** 连接串；存在时优先于下面的离散字段。 */
  url?: string;
  host?: string;
  /** 已按驱动补过默认值（postgres 5432 / mysql 3306）；`memory` / `sqlite` 无端口。 */
  port?: number;
  username?: string;
  /** 敏感：永不进日志。 */
  password?: string;
  /** 数据库名；`sqlite` 时是文件路径。 */
  name?: string;
  /** postgres 之类才有意义。 */
  schema?: string;
  ssl: boolean;
  poolSize: number;
  logging: boolean;
  /** ⚠️ 生产环境为 `true` 会拒绝启动。 */
  synchronize: boolean;
  migrationsRun: boolean;
}

export function readDatabaseConfig(
  env: EnvSource = process.env,
): DatabaseConfig {
  const driver = isDatabaseDriver(env.DATABASE_DRIVER)
    ? env.DATABASE_DRIVER
    : DEFAULT_DATABASE_DRIVER;

  return {
    driver,
    url: toOptionalString(env.DATABASE_URL),
    host: toOptionalString(env.DATABASE_HOST),
    port: toOptionalInt(env.DATABASE_PORT) ?? DEFAULT_DATABASE_PORTS[driver],
    username: toOptionalString(env.DATABASE_USER),
    password: toOptionalString(env.DATABASE_PASSWORD),
    name: toOptionalString(env.DATABASE_NAME),
    schema: toOptionalString(env.DATABASE_SCHEMA),
    ssl: toBoolean(env.DATABASE_SSL, DEFAULT_DATABASE_SSL),
    poolSize:
      toOptionalInt(env.DATABASE_POOL_SIZE) ?? DEFAULT_DATABASE_POOL_SIZE,
    logging: toBoolean(env.DATABASE_LOGGING, DEFAULT_DATABASE_LOGGING),
    synchronize: toBoolean(
      env.DATABASE_SYNCHRONIZE,
      DEFAULT_DATABASE_SYNCHRONIZE,
    ),
    migrationsRun: toBoolean(
      env.DATABASE_MIGRATIONS_RUN,
      DEFAULT_DATABASE_MIGRATIONS_RUN,
    ),
  };
}

export const databaseConfig = registerAs('database', () =>
  readDatabaseConfig(process.env),
);
