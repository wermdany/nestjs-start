import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '@/auth';
import type { AuthOptions } from '@/auth';
import { AppConfigModule } from '@/config';
import type { AppConfig, JwtConfig } from '@/config';
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
 * 把「JWT 配置」映射成「认证层选项」—— 同一个理由，映射放在**组合根**：
 * `src/config/` 不该认识认证是怎么实现的，`src/auth/` 也不该认识 `@nestjs/config`
 * （那样它就没法被单独 import 进测试模块了）。
 *
 * 选项的形状就是 `JwtModuleOptions`：`secret` 用于签名与验签，
 * `signOptions.expiresIn` 决定 token 的 `exp`（在 `src/auth/` 侧不再重复一遍配置）。
 */
export function jwtOptionsFactory(config: ConfigService): AuthOptions {
  const { secret, expiresIn } = config.getOrThrow<JwtConfig>('jwt');

  return { secret, signOptions: { expiresIn } };
}

/**
 * 组装顺序有意为「**配置 → 契约 → 认证 → 业务**」：
 *
 * 1. `AppConfigModule` 先来 —— 它加载 `.env` 并把六个 namespace 注册成全局配置；
 * 2. `ApiContractModule.forRootAsync()` 挂全局的管道 / 过滤器 / 拦截器 + 请求 id 中间件，
 *    选项**从配置读**（所以 `STRICT_VALIDATION` / `ENABLE_ENVELOPE` 这两个环境变量真有作用）；
 * 3. `AuthModule.forRootAsync()` 挂全局认证守卫（`JwtAuthGuard`），密钥 / 有效期**从配置读**。
 *    它是 **fail-closed** 的：除 `@Public()` 之外的所有路由都要 Bearer token ——
 *    所以 `validation-demo` 的两个控制器上写了显式的 `@Public()`；
 * 4. 业务模块。
 *
 * 注意环境变量的**校验不在这里**：它在 `main.ts` 创建应用之前显式执行
 * （原因见 `src/config/app-config.module.ts` 的注释 —— `ConfigModule` 的 `validate`
 * 选项是 async + 模块定义期执行，失败会走 Nest 内部通道而不是 `bootstrap().catch`）。
 *
 * 三个模块的**依赖方向是单向的**：`config` 不认识 `contract` / `auth`，
 * `contract` 与 `auth` 也互不认识 —— 所以它们都能被单独 import 进测试模块。
 * 唯一的粘合点就是上面那两个工厂函数。
 */
@Module({
  imports: [
    AppConfigModule,
    ApiContractModule.forRootAsync({
      inject: [ConfigService],
      useFactory: apiContractOptionsFactory,
    }),
    AuthModule.forRootAsync({
      inject: [ConfigService],
      useFactory: jwtOptionsFactory,
    }),
    ValidationDemoModule,
  ],
})
export class AppModule {}
