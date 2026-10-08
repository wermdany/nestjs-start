import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { DynamicModule, Provider } from '@nestjs/common';
import { PLATFORM_OPTIONS, throttlerOptionsFactory } from './platform.options';
import type { PlatformAsyncOptions, PlatformOptions } from './platform.options';

/**
 * **平台层**：与业务无关、但每个请求都要经过的基础设施。
 *
 * ## 它现在管什么
 *
 * | 关注点 | 落点 | 由谁接线 |
 * | --- | --- | --- |
 * | 限流 | `ThrottlerModule` + `{ provide: APP_GUARD, useClass: ThrottlerGuard }` | **本模块** |
 * | 平台选项（CORS / 限流） | `PLATFORM_OPTIONS` token | 本模块提供，入口消费 |
 * | CORS | `app.enableCors(options.cors)` | **入口**（`main.ts`），理由见 `platform.options.ts` |
 *
 * 刻意**不塞进** `ApiContractModule`：那边管的是「请求/响应**形状**」
 * （信封、校验、错误出口），而这里管的是「请求**能不能进来、进多快**」。
 * 两者混在一起会让"只想改响应格式"的人碰到限流策略。
 *
 * ## `APP_GUARD` 的**注册顺序**是有语义的：401 优先于 429
 *
 * `ThrottlerGuard` 与认证模块的 `JwtAuthGuard` 都是 `APP_GUARD`，Nest 按
 * **模块扫描顺序**把它们串起来，命中就短路。所以本模块必须在 `AppModule.imports`
 * 里排在 `AuthModule` **之后**：
 *
 * ```
 * 未认证 + 超限  →  401（先判断"你是谁"，再判断"你太快了"）
 * ```
 *
 * 代价写清楚（这是一个**有意的取舍**，不是遗漏）：被认证守卫拒绝的请求**不会**
 * 计入限流计数 —— 拿无效 token 刷受保护路由**不受**本限流器约束。
 * `POST /auth/login` 这类 `@Public()` 路由照常被限流，所以撞库有保护；
 * 若将来要连"匿名刷受保护路由"一起限（DoS 场景），把本模块移到 `AuthModule`
 * **之前**即可，代价是未认证请求的 429 会盖过 401。
 *
 * ## 为什么 CORS 不在这里 `configure()` 成中间件
 *
 * `cors` 包不是本仓库的直接依赖（随 `@nestjs/platform-express` 传递安装），
 * pnpm 的严格 node_modules 下 `src/` 里 `import cors from 'cors'` 会直接失败；
 * 而 `app.enableCors()` 是 Nest 自己 `require('cors')`（见 `express-adapter.js`），
 * 零新增依赖，且必然注册在路由之前。
 */
@Module({})
export class PlatformModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    return {
      module: PlatformModule,
      imports: [ThrottlerModule.forRoot(options.throttle)],
      providers: [
        { provide: PLATFORM_OPTIONS, useValue: options },
        ...guardProviders(),
      ],
      exports: [PLATFORM_OPTIONS],
    };
  }

  /**
   * 选项来自配置（`AppModule` 的用法）。
   *
   * ⚠️ 限流器的工厂注入的是 `ConfigService`，**不是**本模块刚注册的
   * `PLATFORM_OPTIONS`：`forRootAsync()` 的工厂在 **`ThrottlerModule` 自己的注入器**
   * 里求值，而模块封装让它看不到 `PlatformModule` 的 provider
   * （`ThrottlerModule` 并不 import 本模块，反过来才对）。
   * `AppConfigModule` 是 `isGlobal: true` ⇒ `ConfigService` 到处都可见，
   * 于是两个工厂各自读一遍同一个 `throttle` namespace —— 映射函数是同一个，
   * 不存在"两套策略"的可能。
   */
  static forRootAsync(options: PlatformAsyncOptions): DynamicModule {
    return {
      module: PlatformModule,
      imports: [
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: throttlerOptionsFactory,
        }),
        ...(options.imports ?? []),
      ],
      providers: [
        {
          provide: PLATFORM_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        ...guardProviders(),
      ],
      exports: [PLATFORM_OPTIONS],
    };
  }
}

/**
 * 平台层的全局守卫。单独抽出来是为了让上面两个静态方法**用同一份**定义 ——
 * 少一处"加了守卫却只加在一个分支上"的机会。
 */
function guardProviders(): Provider[] {
  return [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ];
}
