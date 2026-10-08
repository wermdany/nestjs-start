import { registerAs } from '@nestjs/config';
import {
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL_SECONDS,
  parseCorsOrigins,
  toInt,
} from './env';
import type { EnvSource } from './env';

/**
 * 「平台层」的配置：CORS 与限流。
 *
 * ✅ **两个 namespace 都有消费者了**（曾经是 🅿️ 预留）：`src/platform/` 的
 * `platformOptionsFactory()` 把它们投影成 `CorsOptions` / `ThrottlerModuleOptions`，
 * 于是：
 *
 * - `CORS_ORIGINS` → 入口的 `app.enableCors()`（`main.ts`）；
 * - `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` → `PlatformModule` 里的 `ThrottlerGuard`。
 *
 * 所以它们已经从 `src/config/describe-config.ts` 的 `RESERVED_NAMESPACES` 里删掉了
 * —— 启动摘要里不会再显示 `(预留)`。
 *
 * ⚠️ 生产环境不允许通配来源：`findCrossFieldProblems()` 会在 `CORS_ORIGINS` 未设或含
 * `*` 时**拒绝启动**（理由见 `src/platform/platform.options.ts` 的 `toCorsOptions`）。
 */

/** CORS 允许的来源列表（`config.getOrThrow<CorsConfig>('cors')`）。 */
export interface CorsConfig {
  /** 逗号分隔的 `CORS_ORIGINS` 解析结果；未设置时为 `['*']`。 */
  origins: string[];
}

export function readCorsConfig(env: EnvSource = process.env): CorsConfig {
  return { origins: parseCorsOrigins(env.CORS_ORIGINS) };
}

export const corsConfig = registerAs('cors', () => readCorsConfig(process.env));

/** 限流配置（`config.getOrThrow<ThrottleConfig>('throttle')`）。 */
export interface ThrottleConfig {
  /** 时间窗长度（秒）。 */
  ttlSeconds: number;
  /** 一个时间窗内允许的请求数。 */
  limit: number;
}

export function readThrottleConfig(
  env: EnvSource = process.env,
): ThrottleConfig {
  return {
    ttlSeconds: toInt(env.THROTTLE_TTL_SECONDS, DEFAULT_THROTTLE_TTL_SECONDS),
    limit: toInt(env.THROTTLE_LIMIT, DEFAULT_THROTTLE_LIMIT),
  };
}

export const throttleConfig = registerAs('throttle', () =>
  readThrottleConfig(process.env),
);
