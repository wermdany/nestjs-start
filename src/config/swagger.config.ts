import { registerAs } from '@nestjs/config';
import { isSwaggerEnabled } from '@/swagger/is-swagger-enabled';
import { DEFAULT_SWAGGER_SERVER_URL, toOptionalString } from './env';
import type { EnvSource } from './env';

/**
 * OpenAPI 文档的配置（`config.getOrThrow<SwaggerConfig>('swagger')`）。
 *
 * | 字段 | 来源 | 默认 | 消费者 |
 * | --- | --- | --- | --- |
 * | `enabled` | `ENABLE_SWAGGER` + `NODE_ENV` | 非 production 开 | ✅ `main.ts` → `setupSwagger(app, { enabled })` |
 * | `serverUrl` | `SWAGGER_SERVER_URL` | `http://localhost:3000` | ✅ `main.ts` → `setupSwagger(app, { serverUrl })` |
 *
 * `enabled` 的**规则本身**仍然住在 `src/swagger/is-swagger-enabled.ts`（那里有 4 种组合的
 * e2e 把行为钉死）。这里只是把它接进配置体系 —— 依赖方向是 `config → swagger` 的单向引用，
 * `src/swagger/` 反过来不认识 `src/config/`（所以那些模块可以被单独测试）。
 */
export interface SwaggerConfig {
  enabled: boolean;
  serverUrl: string;
}

export function readSwaggerConfig(env: EnvSource = process.env): SwaggerConfig {
  return {
    enabled: isSwaggerEnabled(env),
    serverUrl:
      toOptionalString(env.SWAGGER_SERVER_URL) ?? DEFAULT_SWAGGER_SERVER_URL,
  };
}

export const swaggerConfig = registerAs('swagger', () =>
  readSwaggerConfig(process.env),
);
