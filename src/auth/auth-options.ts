import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import type { JwtModuleOptions } from '@nestjs/jwt';

/**
 * 认证层的选项 —— **就是 `JwtModule` 的选项**（`{ secret, signOptions }`）。
 *
 * 为什么不再包一层自己的 options token（更早的版本有这么一层）：
 * 本模块要配的只有"密钥 + 有效期"，而 `JwtModule` 已经把这两件事表达完了；
 * 再包一层只会多一个需要同步的副本，以及一个只在测试里用到的注入点。
 *
 * 配置 → 选项的映射放在**组合根**（`app.module.ts` 的 `jwtOptionsFactory`），
 * 所以 `src/auth/` 里没有一行 `@/config` —— 它可以被单独 import 进测试模块。
 */
export type AuthOptions = JwtModuleOptions;

/** `forRootAsync()` 的选项（形状照 Nest 自己的约定：`imports` / `inject` / `useFactory`）。 */
export interface AuthAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (...args: any[]) => AuthOptions | Promise<AuthOptions>;
}
