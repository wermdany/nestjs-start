import { Logger } from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * 环境变量的**单一事实来源**：变量名、默认值、类型转换、校验规则、跨字段一致性。
 *
 * ## 三条刻意的规矩
 *
 * 1. **默认值只在读取端（`read*Config`），校验端不注入默认值**。
 *    每个默认值都是一个导出常量（`DEFAULT_PORT` / `DEFAULT_DATABASE_DRIVER` / …），
 *    被校验器与读取函数**共同 import** —— 所以不存在"两处各写一遍默认值"导致的漂移。
 *    `validateEnv()` 只回答一个问题：「**给了的值**合不合法」，并且**不写回 `process.env`**。
 * 2. **布尔值：新变量严格，`ENABLE_SWAGGER` 宽容**。新变量只接受恰好 `'true'` / `'false'`，
 *    写 `yes` / `1` 直接启动失败；而 `ENABLE_SWAGGER` 保持既有的
 *    「含糊真值不算数」语义（见 `src/swagger/is-swagger-enabled.ts`，那条规则已被 e2e 钉住）。
 * 3. **不做 `forbidNonWhitelisted`**。`process.env` 里必然有大量无关变量（PATH / HOME / …），
 *    白名单只会误杀。
 *
 * ## 什么时候会跑
 *
 * `validateEnv` 被 `AppConfigModule` 交给 `ConfigModule.forRoot({ validate })`。
 * 注意 `@nestjs/config` 是在 **`forRoot()` 被调用的那一刻同步校验**的 ——
 * 也就是「模块定义时」，而不是应用启动后。所以 `main.ts` 用了 `await import('./app.module')`
 * 把加载推迟到 `bootstrap()` 内部，好让失败落进已有的 `catch`（否则会变成模块加载期的裸堆栈）。
 *
 * 完整契约与预留说明见 `docs/configuration.md`。
 */

/** 读取环境变量的入参形状（`process.env` 与手写对象都满足），与 `isSwaggerEnabled(env)` 保持一致。 */
export type EnvSource = Record<string, string | undefined>;

// ── 默认值与取值域（默认值的唯一来源） ────────────────────────────────────────

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];
export const DEFAULT_NODE_ENV: NodeEnv = 'development';

export const DEFAULT_PORT = 3000;
export const PORT_MIN = 1;
export const PORT_MAX = 65535;

export const BOOLEAN_VALUES = ['true', 'false'] as const;
export type BooleanString = (typeof BOOLEAN_VALUES)[number];

/** 校验是否"多一个字段就 400"（映射到 `ValidationPipe` 的 `forbidNonWhitelisted`）。 */
export const DEFAULT_STRICT_VALIDATION = false;
/** 是否套响应信封 `{ success, data }`（映射到 `ResponseEnvelopeInterceptor`）。 */
export const DEFAULT_ENVELOPE = true;

export const DATABASE_DRIVERS = [
  'memory',
  'postgres',
  'mysql',
  'sqlite',
] as const;
export type DatabaseDriver = (typeof DATABASE_DRIVERS)[number];
export const DEFAULT_DATABASE_DRIVER: DatabaseDriver = 'memory';

/** 各驱动的默认端口（`memory` / `sqlite` 没有端口）。 */
export const DEFAULT_DATABASE_PORTS: Readonly<
  Partial<Record<DatabaseDriver, number>>
> = {
  postgres: 5432,
  mysql: 3306,
};

/** 只有 `sqlite` 不需要 host / user（用 `DATABASE_NAME` 当文件路径）。 */
export const FILE_BASED_DATABASE_DRIVERS: readonly DatabaseDriver[] = [
  'sqlite',
];

export const DEFAULT_DATABASE_POOL_SIZE = 10;
export const DATABASE_POOL_SIZE_MAX = 100;
export const DEFAULT_DATABASE_SSL = false;
export const DEFAULT_DATABASE_LOGGING = false;
export const DEFAULT_DATABASE_SYNCHRONIZE = false;
export const DEFAULT_DATABASE_MIGRATIONS_RUN = false;

export const DEFAULT_CORS_ORIGINS: readonly string[] = ['*'];
export const DEFAULT_THROTTLE_TTL_SECONDS = 60;
export const DEFAULT_THROTTLE_LIMIT = 100;

export const DEFAULT_SWAGGER_SERVER_URL = 'http://localhost:3000';

// ── 类型判断与强制转换（env 里一切都是字符串） ────────────────────────────────

export function isNodeEnv(value: unknown): value is NodeEnv {
  return (
    typeof value === 'string' &&
    (NODE_ENVS as readonly string[]).includes(value)
  );
}

export function isDatabaseDriver(value: unknown): value is DatabaseDriver {
  return (
    typeof value === 'string' &&
    (DATABASE_DRIVERS as readonly string[]).includes(value)
  );
}

/** 去空格；空串视为「没设」。 */
export function toOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

/**
 * 转整数，读不出来就回退到 `fallback`。
 *
 * ⚠️ 读取端**假定入参已经过 `validateEnv()`**；这里的回退只是兜底，避免产出 `NaN`
 * 把问题带到运行时（`PORT=abc` 会在校验阶段就被拒绝）。
 */
export function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/** 同上，但「没设」时返回 `undefined`（用于「有驱动默认值」的字段，如 `DATABASE_PORT`）。 */
export function toOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

/**
 * 布尔值只认恰好 `'true'` / `'false'`（与 `isSwaggerEnabled()` 同一条规矩）。
 *
 * 校验端用 `@IsIn(BOOLEAN_VALUES)` 把其它写法直接判成错误，所以这里的 `fallback`
 * 只在「没设」时生效 —— 不存在"写错了被静默当成 false"。
 */
export function toBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
}

/** 逗号分隔的 CORS 来源列表；没设就是 `['*']`。 */
export function parseCorsOrigins(value: string | undefined): string[] {
  const trimmed = value?.trim();

  if (!trimmed) {
    return [...DEFAULT_CORS_ORIGINS];
  }

  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * 把 `Record<string, unknown>` 归一成 {@link EnvSource}。
 *
 * `ConfigModule` 传来的对象在真实运行时全是字符串（`process.env` + dotenv），
 * 但类型上是 `Record<string, any>`；测试里也常手搓对象。与其在下游到处 cast，
 * 不如在入口把这层抹平一次：非字符串按 `String()` 处理（与
 * `@nestjs/config` 自己回写 `process.env` 时的做法一致），`null` / `undefined` 视为「没设」。
 */
export function toStringSource(raw: Record<string, unknown>): EnvSource {
  const env: EnvSource = {};

  for (const [key, value] of Object.entries(raw)) {
    env[key] = toEnvString(value);
  }

  return env;
}

/** 单个值的归一化：只对原始类型做 `String()`；对象走 JSON，避免得到 `[object Object]`。 */
function toEnvString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

// ── 校验 ──────────────────────────────────────────────────────────────────────

/**
 * 校验类：字段名**就是**环境变量名，所以报错信息可以直接指回要改的那个变量。
 *
 * 全部字段都是可选的 —— 缺失由读取端补默认值；这里只校验「给了的值」。
 */
class EnvironmentVariables {
  @IsOptional()
  @IsIn([...NODE_ENVS], {
    message: 'NODE_ENV 只能是 development / test / production 之一',
  })
  NODE_ENV?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: `PORT 必须是 ${PORT_MIN}..${PORT_MAX} 之间的整数` })
  @Min(PORT_MIN, { message: `PORT 必须是 ${PORT_MIN}..${PORT_MAX} 之间的整数` })
  @Max(PORT_MAX, { message: `PORT 必须是 ${PORT_MIN}..${PORT_MAX} 之间的整数` })
  PORT?: number;

  @IsOptional()
  @IsString({ message: 'HOST 必须是字符串' })
  HOST?: string;

  /** 契约层：`forbidNonWhitelisted`（多一个字段就 400）。 */
  @IsOptional()
  @IsIn([...BOOLEAN_VALUES], {
    message: "STRICT_VALIDATION 只能是 'true' 或 'false'",
  })
  STRICT_VALIDATION?: string;

  /** 契约层：是否套响应信封。 */
  @IsOptional()
  @IsIn([...BOOLEAN_VALUES], {
    message: "ENABLE_ENVELOPE 只能是 'true' 或 'false'",
  })
  ENABLE_ENVELOPE?: string;

  // ENABLE_SWAGGER 刻意**不校验**：它的规则是"含糊真值不算数"而不是"含糊值即错误"，
  // 见 `src/swagger/is-swagger-enabled.ts`。

  @IsOptional()
  @IsUrl(
    { require_tld: false },
    {
      message:
        'SWAGGER_SERVER_URL 必须是合法 URL（例如 http://localhost:3000）',
    },
  )
  SWAGGER_SERVER_URL?: string;

  @IsOptional()
  @IsString({ message: 'CORS_ORIGINS 必须是字符串（逗号分隔的来源列表）' })
  CORS_ORIGINS?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'THROTTLE_TTL_SECONDS 必须是大于 0 的整数' })
  @Min(1, { message: 'THROTTLE_TTL_SECONDS 必须是大于 0 的整数' })
  THROTTLE_TTL_SECONDS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'THROTTLE_LIMIT 必须是大于 0 的整数' })
  @Min(1, { message: 'THROTTLE_LIMIT 必须是大于 0 的整数' })
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @IsIn([...DATABASE_DRIVERS], {
    message: `DATABASE_DRIVER 只能是 ${DATABASE_DRIVERS.join(' / ')} 之一`,
  })
  DATABASE_DRIVER?: string;

  // ⚠️ 不用 @IsUrl：sqlite 的连接串是 `file:./dev.db` 这种形式。
  @IsOptional()
  @IsString({ message: 'DATABASE_URL 必须是字符串' })
  DATABASE_URL?: string;

  @IsOptional()
  @IsString({ message: 'DATABASE_HOST 必须是字符串' })
  DATABASE_HOST?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({
    message: `DATABASE_PORT 必须是 ${PORT_MIN}..${PORT_MAX} 之间的整数`,
  })
  @Min(PORT_MIN, {
    message: `DATABASE_PORT 必须是 ${PORT_MIN}..${PORT_MAX} 之间的整数`,
  })
  @Max(PORT_MAX, {
    message: `DATABASE_PORT 必须是 ${PORT_MIN}..${PORT_MAX} 之间的整数`,
  })
  DATABASE_PORT?: number;

  @IsOptional()
  @IsString({ message: 'DATABASE_USER 必须是字符串' })
  DATABASE_USER?: string;

  @IsOptional()
  @IsString({ message: 'DATABASE_PASSWORD 必须是字符串' })
  DATABASE_PASSWORD?: string;

  @IsOptional()
  @IsString({ message: 'DATABASE_NAME 必须是字符串' })
  DATABASE_NAME?: string;

  @IsOptional()
  @IsString({ message: 'DATABASE_SCHEMA 必须是字符串' })
  DATABASE_SCHEMA?: string;

  @IsOptional()
  @IsIn([...BOOLEAN_VALUES], {
    message: "DATABASE_SSL 只能是 'true' 或 'false'",
  })
  DATABASE_SSL?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({
    message: `DATABASE_POOL_SIZE 必须是 1..${DATABASE_POOL_SIZE_MAX} 之间的整数`,
  })
  @Min(1, {
    message: `DATABASE_POOL_SIZE 必须是 1..${DATABASE_POOL_SIZE_MAX} 之间的整数`,
  })
  @Max(DATABASE_POOL_SIZE_MAX, {
    message: `DATABASE_POOL_SIZE 必须是 1..${DATABASE_POOL_SIZE_MAX} 之间的整数`,
  })
  DATABASE_POOL_SIZE?: number;

  @IsOptional()
  @IsIn([...BOOLEAN_VALUES], {
    message: "DATABASE_LOGGING 只能是 'true' 或 'false'",
  })
  DATABASE_LOGGING?: string;

  @IsOptional()
  @IsIn([...BOOLEAN_VALUES], {
    message: "DATABASE_SYNCHRONIZE 只能是 'true' 或 'false'",
  })
  DATABASE_SYNCHRONIZE?: string;

  @IsOptional()
  @IsIn([...BOOLEAN_VALUES], {
    message: "DATABASE_MIGRATIONS_RUN 只能是 'true' 或 'false'",
  })
  DATABASE_MIGRATIONS_RUN?: string;
}

/**
 * 配置校验失败。携带**问题清单**而不是一堆堆栈 ——
 * `main.ts` 拿到它时只打印 `message`（多行清单），不打 stack。
 */
export class EnvValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      [
        '配置校验失败，进程不会启动：',
        ...problems.map((problem) => `  - ${problem}`),
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

function formatReceived(value: unknown): string {
  return value === undefined ? '未设置' : JSON.stringify(value);
}

/**
 * 跨字段一致性：**只有这里能看到"组合起来才成立"的规则**。
 *
 * - `DATABASE_URL` 存在时优先，离散字段可以缺席；
 * - 否则 `driver !== memory` 时必须凑齐 host / user / name（sqlite 只需要 name）；
 * - 生产环境禁止 `DATABASE_SYNCHRONIZE=true`（ORM 自动改表 = 数据事故）。
 */
function findCrossFieldProblems(raw: EnvSource): string[] {
  const nodeEnv = isNodeEnv(raw.NODE_ENV) ? raw.NODE_ENV : DEFAULT_NODE_ENV;
  const driver = isDatabaseDriver(raw.DATABASE_DRIVER)
    ? raw.DATABASE_DRIVER
    : DEFAULT_DATABASE_DRIVER;
  const problems: string[] = [];

  // driver 本身非法时由 @IsIn 报错，这里不再补一条会误导的"缺 host/user/name"。
  if (
    raw.DATABASE_DRIVER === undefined ||
    isDatabaseDriver(raw.DATABASE_DRIVER)
  ) {
    if (
      driver !== DEFAULT_DATABASE_DRIVER &&
      !toOptionalString(raw.DATABASE_URL)
    ) {
      const required: readonly (readonly [string, unknown])[] =
        FILE_BASED_DATABASE_DRIVERS.includes(driver)
          ? [['DATABASE_NAME', raw.DATABASE_NAME]]
          : [
              ['DATABASE_HOST', raw.DATABASE_HOST],
              ['DATABASE_USER', raw.DATABASE_USER],
              ['DATABASE_NAME', raw.DATABASE_NAME],
            ];
      const missing = required
        .filter(
          ([, value]) =>
            toOptionalString(value as string | undefined) === undefined,
        )
        .map(([key]) => key);

      if (missing.length > 0) {
        problems.push(
          `数据库配置不完整：DATABASE_DRIVER=${driver} 时必须提供 DATABASE_URL，` +
            `或同时提供 ${missing.join(' / ')}`,
        );
      }
    }
  }

  if (
    nodeEnv === 'production' &&
    toBoolean(raw.DATABASE_SYNCHRONIZE, DEFAULT_DATABASE_SYNCHRONIZE)
  ) {
    problems.push(
      '生产环境禁止 DATABASE_SYNCHRONIZE=true：让 ORM 自动改表会丢数据。请改用迁移（DATABASE_MIGRATIONS_RUN=true）',
    );
  }

  return problems;
}

/**
 * 只告警不拦截的问题（`validateEnv` 会把它们打到日志里）。
 *
 * 单独抽成纯函数是为了可测：测试直接喂对象断言，不必去 spy logger。
 */
export function configWarnings(raw: EnvSource): string[] {
  const nodeEnv = isNodeEnv(raw.NODE_ENV) ? raw.NODE_ENV : DEFAULT_NODE_ENV;
  const driver = isDatabaseDriver(raw.DATABASE_DRIVER)
    ? raw.DATABASE_DRIVER
    : DEFAULT_DATABASE_DRIVER;
  const warnings: string[] = [];

  if (nodeEnv === 'production') {
    if (parseCorsOrigins(raw.CORS_ORIGINS).includes('*')) {
      warnings.push(
        'CORS_ORIGINS 未配置或为 * —— A2 接上 CORS 之后，生产环境这样配会拒绝启动',
      );
    }

    if (toBoolean(raw.DATABASE_LOGGING, DEFAULT_DATABASE_LOGGING)) {
      warnings.push(
        '生产环境打开了 DATABASE_LOGGING：SQL 可能带出敏感数据，且影响性能',
      );
    }

    if (raw.ENABLE_SWAGGER === 'true') {
      warnings.push('ENABLE_SWAGGER=true：生产环境会暴露完整接口文档');
    }
  }

  // 死配置探测：配了密码但驱动是内存 ⇒ 说明有人以为它在生效。
  if (
    driver === DEFAULT_DATABASE_DRIVER &&
    toOptionalString(raw.DATABASE_PASSWORD) !== undefined
  ) {
    warnings.push(
      `配置了 DATABASE_PASSWORD，但 DATABASE_DRIVER=${DEFAULT_DATABASE_DRIVER}：该配置目前不会生效`,
    );
  }

  return warnings;
}

const logger = new Logger('ConfigModule');

/**
 * `ConfigModule.forRoot({ validate })` 的校验函数。
 *
 * 它的契约是「**抛异常 ⇒ 应用不启动**」，所以这里做两件事：
 * 收集**全部**问题（而不是遇到第一个就返回，免得改一个报一个），然后一次性抛出。
 */
export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  // 先归一成「全是字符串」的视图，下游（跨字段校验、告警）就只用面对一种类型。
  const env = toStringSource(raw);
  const instance = plainToInstance(EnvironmentVariables, env, {
    // 与契约层同一个决定：不开隐式转换，数字字段显式 @Type(() => Number)。
    enableImplicitConversion: false,
  });

  const problems = validateSync(instance).flatMap((error) =>
    Object.values(error.constraints ?? {}).map(
      (message) =>
        `${error.property}: ${message}（收到 ${formatReceived(env[error.property])}）`,
    ),
  );

  problems.push(...findCrossFieldProblems(env));

  if (problems.length > 0) {
    // 去重：同一个字段上并列的多个约束常常给出**同一句**文案
    // （`PORT` 的 @IsInt / @Min / @Max 就是这样），列三遍只会淹没真正的问题。
    throw new EnvValidationError([...new Set(problems)]);
  }

  for (const warning of configWarnings(env)) {
    logger.warn(warning);
  }

  // 返回归一化后的视图（值不变，只是统一成字符串）—— `@nestjs/config` 会把它
  // 赋回 `process.env`。注意这里**不注入默认值**：默认值只存在于各个 `read*Config()`。
  return env;
}
