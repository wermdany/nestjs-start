import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { AppLogger } from './app-logger';
import { installLogger } from './install-logger';
import { RequestLogMiddleware } from './request-log.middleware';

/**
 * 可观测性模块：一行接入，把全局 logger 换成 {@link AppLogger} 并挂上访问日志。
 *
 * | 提供者 / 挂载 | 负责 |
 * | --- | --- |
 * | `AppLogger`（provider 工厂 → `installLogger()`） | 全局 logger：stdout + 本地文件、自动带 `traceId`/`userId` |
 * | `RequestLogMiddleware` | 每个请求一条访问日志（状态码决定级别） |
 * | `onApplicationShutdown` | 打一条关闭日志 + **flush / 关闭文件流**（`enableShutdownHooks()` 后 `Ctrl+C` 也会走到） |
 *
 * ## 为什么安装点在**模块**里，而不只在 `main.ts`
 *
 * `Logger.overrideLogger()` 是进程级静态状态，理论上只需要在入口装一次。
 * 但只装 `main.ts` 的话，任何**不经过 `main.ts`** 的组装路径（e2e、`pnpm openapi:export`、
 * 将来的 CLI/worker）都拿不到这套日志 —— 于是"测试里的日志行为"和"生产的"不一致。
 * 放进模块的 provider 工厂后，凡是 import 了 `AppModule` 的进程都自动一致；
 * `main.ts` 顶层那次调用则额外覆盖"模块还没创建之前"的启动日志（`validateEnv`）。
 */
@Module({
  providers: [
    {
      provide: AppLogger,
      useFactory: () => installLogger(),
    },
  ],
})
export class LoggingModule implements NestModule, OnApplicationShutdown {
  constructor(private readonly logger: AppLogger) {}

  configure(consumer: MiddlewareConsumer): void {
    // 覆盖所有路径，含未匹配路由的 404。
    // ⚠️ 不能写 `'*'`：Nest 11 底层是 Express 5，通配符必须命名（见 ApiContractModule 的注释）。
    consumer
      .apply(RequestLogMiddleware)
      .forRoutes({ path: '/{*splat}', method: RequestMethod.ALL });
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log('shutting down', LoggingModule.name, {
      signal: signal ?? 'unknown',
    });

    // flush 之后再关流：否则最后几条（包括上面这条）可能还在队列里。
    await this.logger.close();
  }
}
