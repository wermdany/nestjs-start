import { Module } from '@nestjs/common';
import type {
  DynamicModule,
  FactoryProvider,
  MiddlewareConsumer,
  NestModule,
  Provider,
  ValidationPipeOptions,
} from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppExceptionFilter } from './validation/http-exception.filter';
import { createValidationPipe } from './validation/validation-pipe.factory';
import { ResponseEnvelopeInterceptor } from './response/response-envelope.interceptor';
import { RequestIdMiddleware } from './observability/request-id.middleware';

/**
 * `ApiContractModule` 的配置项。
 *
 * 校验相关的字段**平铺在顶层**（`whitelist` / `forbidNonWhitelisted` / `transform` ...），
 * 这样 `forRoot()` 直接就是 `ValidationPipeOptions` 的超集：
 *
 * ```ts
 * ApiContractModule.forRoot()                                     // 全部默认
 * ApiContractModule.forRoot({ forbidNonWhitelisted: true })       // 只调校验开关
 * ApiContractModule.forRoot({ envelope: false })                  // 不要响应信封
 * ```
 */
export interface ApiContractOptions extends ValidationPipeOptions {
  /**
   * 是否全局启用响应信封，默认 `true`。关掉后成功响应是 handler 的裸返回值。
   *
   * 失败响应**不受它影响**：`AppExceptionFilter` 是全局过滤器，始终产出
   * `{ success: false, error, message, code?, traceId?, errors? }`。
   */
  envelope?: boolean;
}

/** `forRootAsync()` 的选项（形状照 Nest 自己的约定：`imports` / `inject` / `useFactory`）。 */
export interface ApiContractAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (
    ...args: any[]
  ) => ApiContractOptions | Promise<ApiContractOptions>;
}

/**
 * 契约层选项的 **DI token**。
 *
 * 为什么要它（而不是像以前那样在 `forRoot()` 里把选项 `useValue` 死）：
 *
 * 1. `forRootAsync()` 才可能实现 —— 选项来自 `ConfigService` 时，工厂是异步的；
 * 2. 测试里可以用 `overrideProvider(API_CONTRACT_OPTIONS).useValue({...})` 换配置，
 *    不必再造一个根模块。
 *
 * 所有增强器都通过 `inject: [API_CONTRACT_OPTIONS]` 读它 —— 于是"选项"只有一处定义。
 */
export const API_CONTRACT_OPTIONS = Symbol('API_CONTRACT_OPTIONS');

/**
 * 请求/响应契约层的**唯一入口**。一次挂三个全局增强器 + 请求 id 中间件：
 *
 * | token | 实现 | 负责 |
 * | --- | --- | --- |
 * | `APP_PIPE` | `createValidationPipe(options)` | 入参校验（whitelist / transform / 结构化错误 + `location`） |
 * | `APP_FILTER` | `AppExceptionFilter` | **失败**响应 `{ success, error, message, code?, traceId?, errors? }` + HTTP 状态码 |
 * | `APP_INTERCEPTOR` | `ResponseEnvelopeInterceptor` | **成功**响应 `{ success: true, data, meta? }` |
 * | 中间件 | `RequestIdMiddleware` | 请求 id → `AsyncLocalStorage` + `x-request-id` 响应头 + `traceId` |
 *
 * `APP_*` 是 Nest 用来「全局挂增强器」的 token：`scanner` 会把整张模块图里这些 token 的
 * provider **实例**收进 `ApplicationConfig`。所以只要根模块 `imports: [ApiContractModule.forRoot()]`
 * 一行，**所有**路由的入参都被校验、所有成功/失败响应都是同一个形状，
 * `main.ts` 里不需要 `useGlobalPipes` / `useGlobalFilters` / `useGlobalInterceptors`。
 *
 * ## 可以安全重复注册
 *
 * 每个 `forRoot()` 调用都会返回一个新的动态模块实例，各自注册一份增强器。
 * Nest 会把 `APP_INTERCEPTOR` 串成一条链，所以理论上写两次会套两层信封 ——
 * 但 `ResponseEnvelopeInterceptor` 是**幂等**的（返回值带 `ENVELOPED` 标记就放行），
 * 请求 id 中间件也是幂等的（请求对象上已有 id 就跳过）。所以
 * "某个共享模块顺手又 import 了一次"不会破坏契约。
 *
 * 仍然建议只在 `AppModule` 里 import 一次：增强器重复注册虽无害，但管道会多跑一遍（浪费）。
 *
 * @example
 * ```ts
 * @Module({ imports: [ApiContractModule.forRoot()] })
 * export class AppModule {}
 * ```
 *
 * @example 选项来自配置
 * ```ts
 * ApiContractModule.forRootAsync({
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({
 *     forbidNonWhitelisted: config.get('app.strictValidation'),
 *     envelope: config.get('app.envelope'),
 *   }),
 * });
 * ```
 */
@Module({})
export class ApiContractModule implements NestModule {
  static forRoot(options: ApiContractOptions = {}): DynamicModule {
    return {
      module: ApiContractModule,
      providers: [
        { provide: API_CONTRACT_OPTIONS, useValue: options },
        ...contractProviders(),
      ],
    };
  }

  static forRootAsync(options: ApiContractAsyncOptions): DynamicModule {
    return {
      module: ApiContractModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: API_CONTRACT_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        ...contractProviders(),
      ],
    };
  }

  /**
   * 请求 id 中间件：`forRoutes('/{*splat}')` 覆盖**所有**路径（含未匹配路由的 404）。
   *
   * ⚠️ 不能写 `forRoutes('*')`：Nest 11 底层是 Express 5，path-to-regexp v8
   * 要求通配符必须命名，`'*'` / `'/*'` / `'(.*)'` 会直接抛 `Missing parameter name`。
   * `{}` 表示可选 ⇒ 根路径 `/` 也被覆盖。
   *
   * 这里显式写 `RequestMethod.ALL` 而不是省略 method：省略只是让 Nest 走默认，
   * 写出来是为了说明"所有方法都要 id"。
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '/{*splat}', method: RequestMethod.ALL });
  }
}

/**
 * 三个全局增强器。**全部**通过 `API_CONTRACT_OPTIONS` 取配置 ——
 * 这样 `forRoot` / `forRootAsync` 只需要提供这一个 provider。
 */
function contractProviders(): Provider[] {
  return [
    {
      provide: APP_PIPE,
      useFactory: (options: ApiContractOptions) =>
        createValidationPipe(toValidationPipeOptions(options)),
      inject: [API_CONTRACT_OPTIONS],
    },
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
    {
      // 注意这里是"永远注册"，`envelope: false` 由拦截器在运行时判断 ——
      // 静态 provider 列表没法按异步工厂的结果增删（`forRootAsync` 的前提）。
      provide: APP_INTERCEPTOR,
      useFactory: (options: ApiContractOptions) =>
        new ResponseEnvelopeInterceptor({ enabled: options.envelope ?? true }),
      inject: [API_CONTRACT_OPTIONS],
    },
  ];
}

/** 把契约层自己的开关摘出去，剩下的就是纯粹的 `ValidationPipeOptions`。 */
function toValidationPipeOptions(
  options: ApiContractOptions,
): ValidationPipeOptions {
  const validation: ApiContractOptions = { ...options };

  delete validation.envelope;

  return validation;
}
