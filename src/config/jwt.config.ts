import { registerAs } from '@nestjs/config';
import {
  DEFAULT_JWT_EXPIRES_IN,
  DEFAULT_JWT_SECRET,
  toOptionalString,
} from './env';
import type { EnvSource } from './env';

/**
 * JWT 认证配置（`config.getOrThrow<JwtConfig>('jwt')`）。
 *
 * | 字段 | 来源 | 默认 | 消费者 |
 * | --- | --- | --- | --- |
 * | `secret` | `JWT_SECRET` | `DEFAULT_JWT_SECRET`（**仅开发**） | ✅ `app.module.ts` 的 `jwtOptionsFactory` → `JwtModule` |
 * | `expiresIn` | `JWT_EXPIRES_IN` | `1h` | ✅ 同上（写进 token 的 `exp`） |
 *
 * 默认密钥的存在是为了"不设任何变量也能跑起来"（与其它 namespace 一致），
 * 代价写在 `env.ts` 里：**生产环境没配 `JWT_SECRET`、或仍用那个默认值，
 * `validateEnv()` 会直接拒绝启动** —— 公开的密钥等于没有密钥。
 */
export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export function readJwtConfig(env: EnvSource = process.env): JwtConfig {
  return {
    secret: toOptionalString(env.JWT_SECRET) ?? DEFAULT_JWT_SECRET,
    expiresIn: toOptionalString(env.JWT_EXPIRES_IN) ?? DEFAULT_JWT_EXPIRES_IN,
  };
}

export const jwtConfig = registerAs('jwt', () => readJwtConfig(process.env));
