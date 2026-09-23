import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from './app.config';
import { jwtConfig } from './jwt.config';
import { databaseConfig } from './database.config';
import { DEFAULT_NODE_ENV, isNodeEnv } from './env';
import { corsConfig, throttleConfig } from './platform.config';
import { swaggerConfig } from './swagger.config';
import type { EnvSource } from './env';

/**
 * 要加载的 `.env` 文件，**按优先级从高到低**（与 Nest 官方文档的建议一致）：
 *
 * ```
 * .env.${NODE_ENV}.local   ← 个人覆盖，最高优先级
 * .env.local               ← 个人覆盖（test 环境跳过，避免测试结果依赖本机文件）
 * .env.${NODE_ENV}         ← 环境级默认值
 * .env                     ← 团队默认值
 * ```
 *
 * `NODE_ENV` 未设时按 `development` 拼路径 —— 直接用 `process.env.NODE_ENV` 会拼出
 * `.env.undefined` 这种既不报错也不生效的坑。
 */
export function resolveEnvFilePaths(env: EnvSource = process.env): string[] {
  const nodeEnv = isNodeEnv(env.NODE_ENV) ? env.NODE_ENV : DEFAULT_NODE_ENV;

  return [
    `.env.${nodeEnv}.local`,
    ...(nodeEnv === 'test' ? [] : ['.env.local']),
    `.env.${nodeEnv}`,
    '.env',
  ];
}

/** 测试环境不读任何 `.env` 文件：测试结果不该依赖开发者本机有没有 `.env`。 */
export function shouldIgnoreEnvFile(env: EnvSource = process.env): boolean {
  return env.NODE_ENV === 'test';
}

/**
 * 配置模块。根模块 `imports: [AppConfigModule]` 一行接入，六个 namespace 全局可用：
 *
 * ```ts
 * const app = config.getOrThrow<AppConfig>('app');
 * ```
 *
 * ## 为什么这里**没有** `ConfigModule.forRoot({ validate })`
 *
 * 三个理由叠在一起，让 `validate` 选项在"要给人看的问题清单"这件事上不可用：
 *
 * 1. `ConfigModule.forRoot()` 是 **async** 的 —— 校验抛出的异常变成 Promise rejection；
 * 2. 它在**模块定义时**就被调用（`@Module({ imports: [ConfigModule.forRoot(...)] })`），
 *    所以任何 import 到本文件的代码都会触发校验 —— 失败点取决于 import 顺序；
 * 3. 这个 rejection 由 Nest 内部的 `ExceptionHandler` 接手（只打日志 + 进程退出），
 *    既不 reject `NestFactory.create()`，也不进 `bootstrap().catch` —— 结果是
 *    "一行带堆栈的 ERROR"，正是我们想避免的形态（实测过）。
 *
 * 所以校验改为在**入口显式调用**：`main.ts` 在创建应用之前跑 `validateEnv(process.env)`。
 * 位置固定、可被 `try/catch`、能打印多行清单。代价是**每个入口都要记得调用一次**
 * （见 `src/main.ts` 与 `src/swagger/export-openapi.ts`）。
 *
 * 完整契约见 `docs/configuration.md`。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      // 全局可用：业务模块不必再 import ConfigModule。
      isGlobal: true,
      // 缓存 process.env 的读取（配置在启动后不会变）。
      cache: true,
      envFilePath: resolveEnvFilePaths(),
      ignoreEnvFile: shouldIgnoreEnvFile(),
      load: [
        appConfig,
        swaggerConfig,
        corsConfig,
        throttleConfig,
        jwtConfig,
        databaseConfig,
      ],
    }),
  ],
})
export class AppConfigModule {}
