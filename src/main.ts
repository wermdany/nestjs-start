import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from '@/app.module';
import {
  EnvValidationError,
  formatConfigSummary,
  readResolvedConfig,
  validateEnv,
} from '@/config';
import { setupSwagger } from '@/swagger/setup-swagger';

/**
 * 入口只做五件事：**校验配置** → 创建应用 → 安全头 → 文档 → 监听。
 *
 * 端口 / 主机 / 文档启停**全部来自配置**（`src/config/`），这里不再有硬编码常量。
 */
async function bootstrap(): Promise<void> {
  // ① 校验环境变量。**必须放在这里**（入口的第一件事），而不是交给
  // `ConfigModule.forRoot({ validate })`：那个选项是 async + 在模块定义期执行，
  // 失败会走 Nest 内部的 ExceptionHandler（一行带堆栈的 ERROR + 进程退出），
  // 到不了下面这个 catch。详见 `src/config/app-config.module.ts` 的注释。
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  const resolved = readResolvedConfig(app.get(ConfigService));

  // 一行摘要：环境 / 端口 / 文档 / 各预留 namespace 的当前值（不含任何密码）。
  Logger.log(formatConfigSummary(resolved), 'bootstrap');

  // `/docs` 的启停规则仍在 `src/swagger/is-swagger-enabled.ts`：
  // 非 production 默认开启；production 需要 ENABLE_SWAGGER=true 才暴露。
  // 必须在 listen()/init() **之前**调用（见 setup-swagger.ts 的说明）。
  setupSwagger(app, {
    enabled: resolved.swagger.enabled,
    serverUrl: resolved.swagger.serverUrl,
  });

  // `host` 未设时**不传第二个参数** —— Node 默认绑定全部网卡；
  // 显式传 `undefined` 会走另一条重载路径，行为不够直白。
  await (resolved.app.host
    ? app.listen(resolved.app.port, resolved.app.host)
    : app.listen(resolved.app.port));
}

bootstrap().catch((error: unknown) => {
  // 配置错误：`message` 本身就是「改哪个变量」的清单，堆栈只会把它淹没。
  if (error instanceof EnvValidationError) {
    Logger.error(error.message, undefined, 'bootstrap');
    process.exitCode = 1;

    return;
  }

  const isError = error instanceof Error;

  const message = isError
    ? error.message
    : `Unknown Error: ${JSON.stringify(error)}`;

  const stack = isError ? error.stack : '';

  Logger.error(message, stack, 'bootstrap');

  process.exitCode = 1;
});
