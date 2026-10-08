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
import { installLogger } from '@/observability';
import { resolvePlatformOptions } from '@/platform';
import { resolveApiDocsOptions } from '@/swagger/api-docs.options';
import { setupSwagger } from '@/swagger/setup-swagger';

// 在**模块顶层**安装全局 logger：`validateEnv()` 比 `NestFactory.create()` 更早，
// 只靠 `LoggingModule` 的话，配置告警与配置错误仍然是默认格式（见 install-logger.ts）。
installLogger();

/**
 * 入口只做七件事：**安装日志**（模块顶层）→ 校验配置 → 创建应用 → 安全头 → CORS →
 * 关闭钩子 → 文档 → 监听。
 *
 * 端口 / 主机 / 文档启停 / CORS 来源 / 限流参数**全部来自配置**（`src/config/`），
 * 这里不再有硬编码常量。限流的**守卫**不在入口 —— 它挂在 `PlatformModule` 的
 * `APP_GUARD` 上（`app.module.ts`）。
 */
async function bootstrap(): Promise<void> {
  // ① 校验环境变量。**必须放在这里**（入口的第一件事），而不是交给
  // `ConfigModule.forRoot({ validate })`：那个选项是 async + 在模块定义期执行，
  // 失败会走 Nest 内部的 ExceptionHandler（一行带堆栈的 ERROR + 进程退出），
  // 到不了下面这个 catch。详见 `src/config/app-config.module.ts` 的注释。
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  // CORS：选项来自 `PlatformModule`（配置 → 选项的投影在那里，含"通配来源不许带凭证"
  // 这条政策）。**必须在 `listen()` 之前**调用 —— `listen()` 会触发 `init()`，
  // 而路由是在那一步注册到 Express 上的；之后再加中间件就排在路由后面，等于不生效。
  //
  // 这里之所以不用 `cors()` 中间件（模块里 `configure()`）写法：`cors` 包不是本仓库的
  // 直接依赖（只随 `@nestjs/platform-express` 传递安装），pnpm 的严格 node_modules 下
  // `src/` 里 import 它会失败；`app.enableCors()` 由 Nest 自己 require 它，零新增依赖。
  app.enableCors(resolvePlatformOptions(app).cors);

  // 关闭钩子：没有它，`Ctrl+C`（SIGTERM/SIGINT）不会触发 `onApplicationShutdown`，
  // 日志文件流也就没人 flush + 关闭（`LoggingModule` 的钩子正是干这个的）。
  app.enableShutdownHooks();

  const resolved = readResolvedConfig(app.get(ConfigService));

  // 一行摘要：环境 / 端口 / 文档 / CORS / 限流 / 各 namespace 的当前值（不含任何密码）。
  // 仍标着 `(预留)` 的只有 `database`（还没有消费者的配置，见 RESERVED_NAMESPACES）。
  Logger.log(formatConfigSummary(resolved), 'bootstrap');

  // `/docs` 的启停规则在 `src/config/swagger.config.ts`（经由 `isSwaggerEnabled()`）：
  // 非 production 默认开启；production 需要 ENABLE_SWAGGER=true 才暴露。
  // 文档选项（启停 + serverUrl + 业务自描述的 tags/responseModels）由 `ApiDocsModule`
  // 合成，入口只负责取出并传入 —— 与 `export-openapi.ts` 消费的是**同一份**。
  // 必须在 listen()/init() **之前**调用（见 setup-swagger.ts 的说明）。
  setupSwagger(app, resolveApiDocsOptions(app));

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
