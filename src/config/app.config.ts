import { registerAs } from '@nestjs/config';
import {
  DEFAULT_ENVELOPE,
  DEFAULT_NODE_ENV,
  DEFAULT_PORT,
  DEFAULT_STRICT_VALIDATION,
  isNodeEnv,
  toBoolean,
  toInt,
  toOptionalString,
} from './env';
import type { EnvSource, NodeEnv } from './env';

/**
 * 应用自身的配置（`config.getOrThrow<AppConfig>('app')`）。
 *
 * | 字段 | 来源 | 默认 | 消费者 |
 * | --- | --- | --- | --- |
 * | `env` | `NODE_ENV` | `development` | 各处的环境判断（日志、swagger、告警） |
 * | `port` | `PORT` | `3000` | ✅ `main.ts` 的 `app.listen(port)` |
 * | `host` | `HOST` | 未设 | ✅ `main.ts`：仅在设置时才传给 `listen` |
 * | `strictValidation` | `STRICT_VALIDATION` | `false` | ✅ `app.module.ts` → 契约层的 `forbidNonWhitelisted` |
 * | `envelope` | `ENABLE_ENVELOPE` | `true` | ✅ `app.module.ts` → 契约层的响应信封开关 |
 *
 * 后两项是**契约层的开关** —— 映射发生在 `app.module.ts`
 * （`apiContractOptionsFactory`）。放在 `app` namespace 是因为它们描述的是"这个应用
 * 要不要严格校验 / 要不要信封"，而不是某个基础设施组件的参数。
 *
 * `host` 刻意保持「未设就是不传」：Node 默认绑定全部网卡，静默改成一个具体地址会
 * 改变部署行为（容器里的健康检查会立刻连不上）。
 */
export interface AppConfig {
  env: NodeEnv;
  port: number;
  host?: string;
  /** 多一个未声明字段就 400（`forbidNonWhitelisted`）。 */
  strictValidation: boolean;
  /** 成功响应是否套 `{ success, data, meta? }` 信封。 */
  envelope: boolean;
}

export function readAppConfig(env: EnvSource = process.env): AppConfig {
  return {
    env: isNodeEnv(env.NODE_ENV) ? env.NODE_ENV : DEFAULT_NODE_ENV,
    port: toInt(env.PORT, DEFAULT_PORT),
    host: toOptionalString(env.HOST),
    strictValidation: toBoolean(
      env.STRICT_VALIDATION,
      DEFAULT_STRICT_VALIDATION,
    ),
    envelope: toBoolean(env.ENABLE_ENVELOPE, DEFAULT_ENVELOPE),
  };
}

export const appConfig = registerAs('app', () => readAppConfig(process.env));
