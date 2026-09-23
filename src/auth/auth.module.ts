import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from './users.service';
import type { AuthAsyncOptions, AuthOptions } from './auth-options';
import type { DynamicModule, Provider } from '@nestjs/common';

/**
 * 认证模块：**一行接入**，挂一个全局守卫。
 *
 * | 提供者 | 负责 |
 * | --- | --- |
 * | `JwtModule`（import 进来的） | 签发与验签（`JwtService`）；密钥 / 有效期来自选项 |
 * | `UsersService` | 内存写死的用户表（**没有角色**） |
 * | `AuthService` | 用户名 + 密码 → JWT |
 * | `APP_GUARD` → `JwtAuthGuard` | 全站默认要求 Bearer 凭证；`@Public()` 是白名单 |
 *
 * ## 为什么选项就是 `JwtModuleOptions`
 *
 * 本模块要配的只有"密钥 + 有效期"，`JwtModule` 已经把它们表达完了；
 * 再包一层自己的 options token 只会多一个需要同步的副本。配置 → 选项的映射
 * 放在**组合根**（`app.module.ts` 的 `jwtOptionsFactory`），所以 `src/auth/`
 * 里没有一行 `@/config` —— 它能被单独 import 进测试模块。
 *
 * ## fail-closed 的代价
 *
 * 全局守卫意味着**新加的路由自动受保护**；公开必须写 `@Public()`。
 * 本仓库里 `validation-demo` 的两个控制器就是显式公开的（那里也写清了为什么）。
 *
 * @example 选项来自配置
 * ```ts
 * @Module({
 *   imports: [
 *     AuthModule.forRootAsync({
 *       inject: [ConfigService],
 *       useFactory: (config: ConfigService) => ({
 *         secret: config.getOrThrow('jwt').secret,
 *         signOptions: { expiresIn: config.getOrThrow('jwt').expiresIn },
 *       }),
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class AuthModule {
  static forRoot(options: AuthOptions): DynamicModule {
    return {
      module: AuthModule,
      imports: [JwtModule.register(options)],
      controllers: [AuthController],
      providers: authProviders(),
    };
  }

  static forRootAsync(options: AuthAsyncOptions): DynamicModule {
    return {
      module: AuthModule,
      imports: [
        JwtModule.registerAsync({
          inject: options.inject ?? [],
          // 同一个工厂只跑一次：它产出的就是 `JwtModuleOptions`。
          useFactory: options.useFactory,
        }),
      ],
      controllers: [AuthController],
      providers: authProviders(),
    };
  }
}

function authProviders(): Provider[] {
  return [
    UsersService,
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ];
}
