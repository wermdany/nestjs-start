import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigModule } from '@/config';
import type { AppConfig } from '@/config';
import { ApiContractModule } from '@/contract';
import type { ApiContractOptions } from '@/contract';
import { ValidationDemoModule } from '@/modules/validation-demo/validation-demo.module';

/**
 * 把「应用配置」映射成「契约层选项」—— 这是**配置真正生效**的地方。
 *
 * | 配置 | 契约层选项 | 效果 |
 * | --- | --- | --- |
 * | `app.strictValidation`（`STRICT_VALIDATION`） | `forbidNonWhitelisted` | `true` 时多一个未声明字段就 400（默认静默剥掉） |
 * | `app.envelope`（`ENABLE_ENVELOPE`） | `envelope` | `false` 时成功响应是 handler 的裸返回值（失败侧不受影响） |
 *
 * 这层映射刻意放在**组合根**，而不是 `src/config/` 或 `src/contract/`：
 * 前者不该认识契约、后者不该认识配置，把两者粘起来是 `app.module.ts` 的职责。
 * 单独导出成函数还有一个好处：测试可以直接拿它验证映射（见 `config.e2e-spec.ts`）。
 */
export function apiContractOptionsFactory(
  config: ConfigService,
): ApiContractOptions {
  const { strictValidation, envelope } = config.getOrThrow<AppConfig>('app');

  return {
    forbidNonWhitelisted: strictValidation,
    envelope,
  };
}

/**
 * 组装顺序有意为「**配置 → 契约 → 业务**」：
 *
 * 1. `AppConfigModule` 先来 —— 它加载 `.env` 并把五个 namespace 注册成全局配置；
 * 2. `ApiContractModule.forRootAsync()` 挂全局的管道 / 过滤器 / 拦截器 + 请求 id 中间件，
 *    选项**从配置读**（所以 `STRICT_VALIDATION` / `ENABLE_ENVELOPE` 这两个环境变量真有作用）；
 * 3. 业务模块。
 *
 * 注意环境变量的**校验不在这里**：它在 `main.ts` 创建应用之前显式执行
 * （原因见 `src/config/app-config.module.ts` 的注释 —— `ConfigModule` 的 `validate`
 * 选项是 async + 模块定义期执行，失败会走 Nest 内部通道而不是 `bootstrap().catch`）。
 *
 * 三个模块的**依赖方向是单向的**：`config` 不认识 `contract`，`contract` 也不认识 `config`
 * —— 所以 `ApiContractModule` 可以被单独 import 进测试模块（e2e 里的探针模块就是这么做的，
 * 它们没有 `ConfigService` 也不会报缺 provider）。两者唯一的粘合点就是上面的工厂函数。
 */
@Module({
  imports: [
    AppConfigModule,
    ApiContractModule.forRootAsync({
      inject: [ConfigService],
      useFactory: apiContractOptionsFactory,
    }),
    ValidationDemoModule,
  ],
})
export class AppModule {}
