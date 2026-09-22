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
 * ⚠️ **两个 namespace 目前都没有消费者**（🅿️ 预留）。它们属于 A2 的 `PlatformModule`：
 * CORS 与 `ThrottlerModule` 的**接线**还没做，但配置契约、默认值与启动期校验先立在这里，
 * 这样 A2 落地时只需要在模块里读配置，不用再动 `main.ts` / env 契约。
 *
 * 一旦接上，请把 `src/config/describe-config.ts` 里 `RESERVED_NAMESPACES` 对应的项删掉
 * —— 那行日志会自己告诉你哪些配置还是"空转"的。
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
