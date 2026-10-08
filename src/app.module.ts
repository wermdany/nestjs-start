import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '@/auth';
import type { AuthOptions } from '@/auth';
import { AUTH_DOCS } from '@/auth/api-docs';
import { AppConfigModule } from '@/config';
import type { AppConfig, JwtConfig } from '@/config';
import { ApiContractModule } from '@/http-enhancers.module';
import type { ApiContractOptions } from '@/http-enhancers.module';
import { LoggingModule } from '@/observability';
import { PlatformModule, platformOptionsFactory } from '@/platform';
import { ApiDocsModule, docsProvider } from '@/swagger/api-docs.module';
import { ValidationDemoModule } from '@/modules/validation-demo/validation-demo.module';
import { VALIDATION_DEMO_DOCS } from '@/modules/validation-demo/api-docs';

/**
 * 把「应用配置」映射成「契约层选项」—— 这是**配置真正生效**的地方。
 *
 * | 配置 | 契约层选项 | 效果 |
 * | --- | --- | --- |
 * | `app.strictValidation`（`STRICT_VALIDATION`） | `forbidNonWhitelisted` | `true` 时多一个未声明字段就 400（默认静默剥掉） |
 * | `app.envelope`（`ENABLE_ENVELOPE`） | `envelope` | `false` 时成功响应是 handler 的裸返回值（失败侧不受影响） |
 *
 * 这层映射刻意放在**组合根**，而不是 `src/config/` 或 `src/system/http-validation/`：
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
 * 各业务模块对 OpenAPI 的**自描述**（响应模型 + 标签）。
 *
 * 这是"文档层零业务依赖"的注入点：`src/swagger/` 不 import 任何业务 DTO，
 * 它只消费 `API_DOCS_OPTIONS`；而把业务描述符喂进去是**组合根**的职责 ——
 * 与上面两个工厂函数（配置 → 选项的映射）是同一个模式。
 *
 * ⚠️ **数组顺序会被原样带进文档**，而且是两处：
 *
 * 1. `components.schemas` 里"显式登记的响应模型"的**键顺序**；
 * 2. 顶层 `tags` 的顺序。
 *
 * 它不影响 OpenAPI 语义（对象键顺序无语义），但会影响 `openapi/openapi.json`
 * 的 diff 可读性 —— 所以新增模块时**追加到末尾**，不要插到中间。
 *
 * 新增业务模块时在这里加一项；删模块时删掉对应的一项即可 ——
 * 不需要碰 `src/swagger/` 的任何文件。
 */
export const FEATURE_DOCS = [VALIDATION_DEMO_DOCS, AUTH_DOCS];

/**
 * 把 {@link FEATURE_DOCS} 包成可注入的 provider。
 *
 * 单独导出带类型的那一份（而不是让消费方去 `provider.useValue` 里取）：
 * `Provider` 是个联合类型，取 `useValue` 需要断言 —— 类型信息在这里还没有丢失。
 */
export const FEATURE_DOCS_PROVIDERS = FEATURE_DOCS.map((docs) =>
  docsProvider(docs),
);

/**
 * 组装顺序有意为「**配置 → 契约 → 文档 → 可观测性 → 认证 → 业务 → 平台**」：
 *
 * 1. `AppConfigModule` 先来 —— 它加载 `.env` 并把七个 namespace 注册成全局配置；
 * 2. `ApiContractModule.forRootAsync()` 挂全局的管道 / 过滤器 / 拦截器 + 请求 id 中间件，
 *    选项**从配置读**（所以 `STRICT_VALIDATION` / `ENABLE_ENVELOPE` 这两个环境变量真有作用）；
 * 3. `ApiDocsModule.forRootAsync()` 把「业务自描述的文档」与「配置里的 `SWAGGER_SERVER_URL`」
 *    合成 OpenAPI 的选项（`API_DOCS_OPTIONS`）。它**不做任何 HTTP**：`/docs` 的挂载
 *    仍在入口（`main.ts` / `export-openapi.ts`），因为 `SwaggerModule.setup()` 需要 app 实例；
 * 4. `LoggingModule` 换掉全局 logger 并挂访问日志（配置来自 `LOG_*`）；
 * 5. `AuthModule.forRootAsync()` 挂全局认证守卫（`JwtAuthGuard`），密钥 / 有效期**从配置读**。
 *    它是 **fail-closed** 的：除 `@Public()` 之外的所有路由都要 Bearer token ——
 *    所以 `validation-demo` 的两个控制器上写了显式的 `@Public()`；
 * 6. 业务模块；
 * 7. `PlatformModule.forRootAsync()` **最后** —— 它挂全局限流守卫（`ThrottlerGuard`），
 *    选项同样从配置读（`CORS_ORIGINS` / `THROTTLE_*`）。放在最后是**刻意的**：
 *    两个 `APP_GUARD` 按注册顺序短路，于是未认证 + 超限得到的是 **401 而不是 429**。
 *    代价与调整方式写在 `src/platform/platform.module.ts` 的注释里。
 *    它同时提供 `PLATFORM_OPTIONS`，入口用 `resolvePlatformOptions(app)` 取 CORS 选项。
 *
 * 注意环境变量的**校验不在这里**：它在 `main.ts` 创建应用之前显式执行
 * （原因见 `src/config/app-config.module.ts` 的注释 —— `ConfigModule` 的 `validate`
 * 选项是 async + 模块定义期执行，失败会走 Nest 内部通道而不是 `bootstrap().catch`）。
 *
 * 各模块的**依赖方向是单向的**：`config` 不认识 `contract` / `auth` / `swagger` / `platform`，
 * `contract` 与 `auth` 也互不认识，`swagger` 谁都**不认识**（只被组合根注入选项），
 * `platform` 只认识 `config` —— 所以它们都能被单独 import 进测试模块。
 * 唯一的粘合点就是上面三个工厂函数与 `FEATURE_DOCS_PROVIDERS`。
 */
@Module({
  imports: [
    AppConfigModule,
    ApiContractModule.forRootAsync({
      inject: [ConfigService],
      useFactory: apiContractOptionsFactory,
    }),
    // 文档选项：业务自描述（providers）+ 配置（工厂里的 ConfigService）。
    ApiDocsModule.forRootAsync({ providers: FEATURE_DOCS_PROVIDERS }),
    // 可观测性：全局 logger（stdout + 本地文件）+ 访问日志。
    // 放在契约层之后：访问日志要用请求 id（它在 finish 回调里从请求对象上取，见 middleware 注释）。
    LoggingModule,
    AuthModule.forRootAsync({
      inject: [ConfigService],
      useFactory: jwtOptionsFactory,
    }),
    ValidationDemoModule,
    // 平台层**最后**：CORS / 限流的配置从这里开始生效，且限流守卫排在认证守卫之后
    // （未认证 + 超限 → 401 优先）。CORS 的真正接线在 `main.ts`（`app.enableCors`）。
    PlatformModule.forRootAsync({
      inject: [ConfigService],
      useFactory: platformOptionsFactory,
    }),
  ],
})
export class AppModule {}
