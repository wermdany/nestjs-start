import { ConsoleLogger, Logger } from '@nestjs/common';
import { readLogConfig } from '@/config';
import { AppLogger } from './app-logger';
import type { AppLoggerOptions } from './app-logger';

/** 已安装的实例（模块级单例：`Logger.overrideLogger()` 是进程级状态，只能有一个）。 */
let installed: AppLogger | undefined;

/**
 * 全局安装点。**幂等**：重复调用返回同一个实例（配置只在第一次生效）。
 *
 * 为什么需要"两个安装点"：
 *
 * 1. `main.ts` 在**模块顶层**调用它 —— 这样 `validateEnv()` 这类**早于**
 *    `NestFactory.create()` 的日志也走新 logger（配置告警是最需要结构化的那批）；
 * 2. `LoggingModule` 的 provider 工厂也调用它 —— 这样**任何**用 `AppModule` 组装的进程
 *    （e2e、`pnpm openapi:export`、将来的 worker）都自动拿到同一套日志，
 *    而不是只有 `main.ts` 那条路径有。
 *
 * 两处谁先执行都可以：先来的创建实例，后来的复用。
 */
export function installLogger(
  overrides: Partial<AppLoggerOptions> = {},
): AppLogger {
  if (installed) {
    return installed;
  }

  const config = readLogConfig(process.env);
  const logger = new AppLogger({
    level: config.level,
    pretty: config.pretty,
    file: config.toFile
      ? {
          dir: config.dir,
          file: config.file,
          maxBytes: config.maxBytes,
          maxFiles: config.maxFiles,
        }
      : undefined,
    ...overrides,
  });

  Logger.overrideLogger(logger);
  registerProcessHandlers(logger);

  installed = logger;

  return logger;
}

/** 已安装的实例（没装过就是 `undefined`）。 */
export function getInstalledLogger(): AppLogger | undefined {
  return installed;
}

/**
 * 卸下全局安装，把 Nest 的默认 logger 放回去（**测试专用**）。
 *
 * 之所以需要它：`Logger.overrideLogger()` 是**进程级**静态状态，
 * 一个测试文件里装了自定义 logger，同一 worker 后续的文件会跟着受影响。
 */
export function uninstallLogger(): void {
  installed = undefined;
  Logger.overrideLogger(new ConsoleLogger());
}

let handlersRegistered = false;

/**
 * `useLogger` / `overrideLogger` 覆盖不到的最后一层：**进程级未处理异常**。
 *
 * - `unhandledRejection`：记一条 `error` 并继续（Node 默认行为就是"不退出"）；
 * - `uncaughtException`：记 `fatal` → **flush** → 退出码 1。进程状态此时已不可信，
 *   继续跑比退出更危险；flush 是为了不丢掉这条最重要的日志。
 */
function registerProcessHandlers(logger: AppLogger): void {
  if (handlersRegistered) {
    return;
  }

  handlersRegistered = true;

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandledRejection', reason);
  });

  process.on('uncaughtException', (error: unknown) => {
    logger.fatal('uncaughtException', error);

    void logger.flush().finally(() => process.exit(1));
  });
}
