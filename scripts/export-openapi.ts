import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from '@/app.module';
import { validateEnv } from '@/config';
import { installLogger } from '@/observability';
import { resolveApiDocsOptions } from '@/swagger/api-docs.options';
import { SWAGGER_JSON_PATH, buildDocument } from '@/swagger/setup-swagger';

// 与 `main.ts` 一样：这个入口不经过 `main.ts`，但也要让日志走同一套实现
// （`installLogger()` 幂等，重复调用无害）。
installLogger();

/**
 * 把 OpenAPI 文档落盘成 `openapi/openapi.json`（`pnpm openapi:export`）。
 *
 * 为什么要把文档**提交进仓库**：
 *
 * 1. 前端不必起服务也能生成类型 / 客户端（`openapi-typescript`、`orval`）；
 * 2. CI 里可以用 `oasdiff` 之类做**破坏性变更检测** —— 字段删了、类型收紧了，
 *   在 PR 阶段就红，而不是等前端联调；
 * 3. code review 里能直接看到"这次改了什么契约"，而不是 diff 一堆装饰器。
 *
 * 用的是和线上**同一个** `buildDocument()`，所以落盘产物与 `/docs-json` 一致。
 */
async function main(): Promise<void> {
  // 与 `main.ts` 一样先校验环境变量 —— 这也是个会创建应用的入口，
  // 不该在配置坏掉的时候生成出一份"看起来正常"的文档。
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule, { logger: false });

  try {
    await app.init();

    // 文档选项（`serverUrl` + 业务自描述的 tags / responseModels）由 `ApiDocsModule`
    // 从配置与业务描述符合成 —— 于是落盘产物与 `/docs-json` 必然一致，
    // 而不是"两个入口各自拼一遍，慢慢漂移"。
    const document = buildDocument(app, resolveApiDocsOptions(app));
    const outputDir = join(process.cwd(), 'openapi');
    const outputPath = join(outputDir, 'openapi.json');

    await mkdir(outputDir, { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(document, null, 2)}\n`,
      'utf8',
    );

    Logger.log(
      `OpenAPI 文档已写出：${outputPath}（线上入口是 /${SWAGGER_JSON_PATH}）`,
      'openapi:export',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error
      ? (error.stack ?? error.message)
      : (JSON.stringify(error) ?? 'unknown non-Error thrown'),
    undefined,
    'openapi:export',
  );

  process.exitCode = 1;
});
