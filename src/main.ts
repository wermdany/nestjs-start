import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { setupSwagger } from '@/swagger/setup-swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // `/docs` 的启停规则见 src/swagger/is-swagger-enabled.ts：
  // 非 production 默认开启；production 需要 ENABLE_SWAGGER=true 才暴露。
  setupSwagger(app);

  await app.listen(3000);
}

bootstrap().catch((error: unknown) => {
  const isError = error instanceof Error;

  const message = isError
    ? error.message
    : `Unknown Error: ${JSON.stringify(error)}`;

  const stack = isError ? error.stack : '';

  Logger.error(message, stack, 'bootstrap');

  process.exitCode = 1;
});
