import { Module } from '@nestjs/common';
import type {
  DynamicModule,
  Provider,
  ValidationPipeOptions,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppExceptionFilter } from './validation/http-exception.filter';
import { createValidationPipe } from './validation/validation-pipe.factory';
import { ResponseEnvelopeInterceptor } from './response/response-envelope.interceptor';

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
   * `{ success: false, error, message, errors? }`。
   */
  envelope?: boolean;
}

/**
 * 请求/响应契约层的**唯一入口**。`forRoot()` 一次挂三个全局增强器：
 *
 * | token | 实现 | 负责 |
 * | --- | --- | --- |
 * | `APP_PIPE` | `createValidationPipe(options)` | 入参校验（whitelist / transform） |
 * | `APP_FILTER` | `AppExceptionFilter` | **失败**响应 `{ success: false, error, message, errors? }` + HTTP 状态码 |
 * | `APP_INTERCEPTOR` | `ResponseEnvelopeInterceptor` | **成功**响应 `{ success: true, data, meta? }` |
 *
 * `APP_*` 是 Nest 用来「全局挂增强器」的 token：`scanner` 会把整张模块图里这些 token 的
 * provider **实例**收进 `ApplicationConfig`。所以只要根模块 `imports: [ApiContractModule.forRoot()]`
 * 一行，**所有**路由的入参都被校验、所有成功/失败响应都是同一个形状，
 * `main.ts` 里不需要 `useGlobalPipes` / `useGlobalFilters` / `useGlobalInterceptors`。
 *
 * 选项在 `forRoot()` 被调用的那一刻就捕获进实例了（`useValue`）—— 这是刻意的简化，
 * 少一层 options token 的间接。代价是测试里**不能**用 `overrideProvider()` 换选项：
 * 要换配置就再 `forRoot({...})` 一次，或在单测里直接用 `createValidationPipe({...})` 造一个管道。
 *
 * @example
 * ```ts
 * @Module({ imports: [ApiContractModule.forRoot()] })
 * export class AppModule {}
 * ```
 */
@Module({})
export class ApiContractModule {
  static forRoot(options: ApiContractOptions = {}): DynamicModule {
    const { envelope = true, ...validation } = options;

    const providers: Provider[] = [
      { provide: APP_PIPE, useValue: createValidationPipe(validation) },
      { provide: APP_FILTER, useClass: AppExceptionFilter },
    ];

    if (envelope) {
      providers.push({
        provide: APP_INTERCEPTOR,
        useValue: new ResponseEnvelopeInterceptor(),
      });
    }

    return { module: ApiContractModule, providers };
  }
}
