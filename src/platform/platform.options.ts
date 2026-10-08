import type {
  DynamicModule,
  FactoryProvider,
  INestApplication,
} from '@nestjs/common';
// ⚠️ 深路径：`CorsOptions` **没有**从 `@nestjs/common` 的根导出（实测 `index.d.ts` 里没有它），
// 而 `app.enableCors()` 的参数类型正是它。`@nestjs/common` 没有 `exports` 映射，
// 所以这条深路径在 `moduleResolution: nodenext` 下能正常解析。
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { CorsConfig, ThrottleConfig } from '@/config';

/**
 * 「平台层」选项的 **DI token**。
 *
 * 与契约层的 `API_CONTRACT_OPTIONS`、文档层的 `API_DOCS_OPTIONS` 是同一套约定：
 * 选项只有**一处定义**，模块与入口都从这里读，测试里可以直接
 * `overrideProvider(PLATFORM_OPTIONS).useValue({...})` 换掉整套平台行为。
 */
export const PLATFORM_OPTIONS = Symbol('PLATFORM_OPTIONS');

/**
 * 平台层选项 —— 装的是**各库能直接消费的形状**，不是配置本身。
 *
 * ## 为什么在模块里再投影一次（而不是把 `cors` / `throttle` namespace 原样传下去）
 *
 * 两个消费者的输入形状不同（`app.enableCors()` 要 `CorsOptions`，
 * `ThrottlerModule` 要 `ThrottlerModuleOptions`），但它们都要经过**同一个政策决定**：
 * 通配来源必须关掉凭证、`ttl` 必须从秒换成毫秒。把投影集中在
 * {@link platformOptionsFactory} 里，政策就只有一份，入口与模块各取自己那一半
 * —— 与 `ApiDocsOptions`「入口只取不拼」的思路同构。
 *
 * CORS 的**接线不在模块里**：`cors` 包不是本仓库的直接依赖（它只随
 * `@nestjs/platform-express` 一起安装，pnpm 的严格 node_modules 下 `src/` 里
 * `import 'cors'` 会直接失败），所以由入口调用 `app.enableCors(options.cors)`
 * —— 那正是 Nest 官方推荐的写法，也天然躲开了「中间件注册得比路由晚」的坑。
 */
export interface PlatformOptions {
  /** 直接喂给 `app.enableCors()`。 */
  cors: CorsOptions;
  /** 直接喂给 `ThrottlerModule.forRoot()` / `forRootAsync()`。 */
  throttle: ThrottlerModuleOptions;
}

/** `forRootAsync()` 的输入（形状照 Nest 自己的约定，与 `ApiContractAsyncOptions` 一致）。 */
export interface PlatformAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (...args: any[]) => PlatformOptions | Promise<PlatformOptions>;
}

/**
 * 需要**显式暴露**给浏览器的响应头。
 *
 * 跨域时 JS 只能读到 CORS 安全列表里的头，自定义头必须列进
 * `Access-Control-Expose-Headers` —— 否则前端拿不到它们，而这两组头恰好都是
 * 「客户端需要读、才用得上」的：
 *
 * | 头 | 谁写的 | 前端拿它做什么 |
 * | --- | --- | --- |
 * | `x-request-id` | 请求 id 中间件 | 它就是响应体里的 `traceId`；报障时把它一起贴出来 |
 * | `X-RateLimit-Limit` / `-Remaining` / `-Reset` | `ThrottlerGuard` | 提前退避，而不是撞上 429 才知道 |
 * | `Retry-After` | `ThrottlerGuard`（被限流时） | 429 之后等多久再试 |
 *
 * ⚠️ 名字**大小写敏感**（`Access-Control-Expose-Headers` 的值按字面匹配），
 * 所以要照抄各库实际发出的写法：请求 id 是小写，限流头是 `X-RateLimit-*`。
 */
export const CORS_EXPOSED_HEADERS = [
  'x-request-id',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
] as const;

/**
 * 429 的 `message` 文案。
 *
 * 为什么要覆盖默认值：`@nestjs/throttler` 的默认文案是
 * `'ThrottlerException: Too Many Requests'` —— 它把库名写进了对外契约，
 * 而本仓库的 `message` 是给调用方看的人话。
 *
 * ⚠️ `TOO_MANY_REQUESTS_EXAMPLE`（`src/swagger/envelope.schema.ts`）里抄了同一句话
 * —— 文档层刻意**不** import 运行时层（401 的示例也是这么做的），改这里时要一起改。
 */
export const THROTTLE_ERROR_MESSAGE =
  'Too many requests, please try again later';

/** 来源列表里是否含通配符（`CORS_ORIGINS` 未设时的默认值就是 `['*']`）。 */
export function isWildcardOrigin(origins: readonly string[]): boolean {
  return origins.includes('*');
}

/**
 * 把 `cors` namespace 投影成 `app.enableCors()` 的选项。
 *
 * ## `credentials` 为什么由**来源列表**决定
 *
 * 浏览器规范禁止 `Access-Control-Allow-Origin: *` 与
 * `Access-Control-Allow-Credentials: true` **同时出现**，而 `cors` 包不会替我们修正
 * 这个组合：它会把两个头都发出去，然后浏览器**整条响应**都不给 JS。
 * 所以只有白名单模式才允许带凭证：
 *
 * | `CORS_ORIGINS` | `origin` | `credentials` | 含义 |
 * | --- | --- | --- | --- |
 * | 未设 / 含 `*`（开发默认） | `'*'` | `false` | 任意来源可读，但**不能带 Cookie** |
 * | 显式白名单 | 具体来源数组 | `true` | 只有白名单可读，且可带 Cookie |
 *
 * 生产环境用 `*` 会**在启动期**就被 `validateEnv()` 拒绝（见 `src/config/env.ts`
 * 的 `findCrossFieldProblems`）：通配来源既不能带凭证，也等于没有来源边界。
 */
export function toCorsOptions(cors: CorsConfig): CorsOptions {
  const exposedHeaders = [...CORS_EXPOSED_HEADERS];

  return isWildcardOrigin(cors.origins)
    ? { origin: '*', credentials: false, exposedHeaders }
    : { origin: [...cors.origins], credentials: true, exposedHeaders };
}

/**
 * 把 `throttle` namespace 投影成 `ThrottlerModule` 的选项。
 *
 * ⚠️ **单位换算是这个函数存在的核心理由**：配置层（和运维的直觉）用**秒**，
 * 而 `@nestjs/throttler` 的 `ttl` 是**毫秒** —— 它直接与 `Date.now()` 相加。
 * 少乘这一次 1000，限流窗口就从 60s 变成 60ms（等于没限流，且没人会报错）。
 * 响应头里的 `X-RateLimit-Reset` / `Retry-After` 仍按秒返回，不需要再换算。
 *
 * `limit` 的语义是「窗口内**允许**的请求数」：`limit: 3` ⇒ 第 4 次才 429。
 */
export function toThrottlerOptions(
  throttle: ThrottleConfig,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        ttl: throttle.ttlSeconds * 1000,
        limit: throttle.limit,
      },
    ],
    errorMessage: THROTTLE_ERROR_MESSAGE,
  };
}

/**
 * 配置 → 平台层选项。
 *
 * 与 `apiContractOptionsFactory` / `jwtOptionsFactory` 是**同一职责**（把配置映射成
 * 某个层的选项），但它住在平台层而不是 `app.module.ts`：`PlatformModule` 自己的
 * `ThrottlerModule.forRootAsync()` 也要用它 —— 放组合根会让
 * `app.module.ts` ↔ `platform.module.ts` 形成 import 环。
 */
export function platformOptionsFactory(config: ConfigService): PlatformOptions {
  return {
    cors: toCorsOptions(config.getOrThrow<CorsConfig>('cors')),
    throttle: toThrottlerOptions(config.getOrThrow<ThrottleConfig>('throttle')),
  };
}

/**
 * `ThrottlerModule.forRootAsync()` 的工厂：与 {@link platformOptionsFactory}
 * 读**同一个** namespace、走**同一个**映射函数，所以两处不可能给出不同的限流策略。
 */
export function throttlerOptionsFactory(
  config: ConfigService,
): ThrottlerModuleOptions {
  return platformOptionsFactory(config).throttle;
}

/**
 * 从应用里取出平台层选项（`main.ts` 用它接线 CORS）。
 *
 * ⚠️ 与 `resolveApiDocsOptions()` 的 `strict: false` **刻意相反**：token 缺席时这里
 * **抛错**。文档选项兜底成空对象最多是"少一份文档"，而平台选项兜底
 * （`app.enableCors(undefined)`）会**静默变成 cors 包的默认值 `origin: '*'`** ——
 * 一个安全开关的缺失必须是响的，不能默认放行。
 */
export function resolvePlatformOptions(app: INestApplication): PlatformOptions {
  return app.get<PlatformOptions>(PLATFORM_OPTIONS);
}
