import type { ExecutionContext } from '@nestjs/common';
import { Public } from '../../decorators/public.decorator';

/**
 * 认证测试的**测试替身**（fixtures）。
 *
 * 放在 `__tests__/fixtures/` 而不是写成 `*.spec.ts`：
 * - jest 的 `testRegex: \.spec\.ts$` 不会把它当成测试套件（否则报"没有用例"）；
 * - `tsconfig.build.json` 把整个 `__tests__` 目录排除在构建之外，所以它不会进 `dist/`。
 */

/** 单测里用的固定密钥（与生产配置无关）。 */
export const TEST_SECRET = 'unit-test-secret-please-do-not-reuse';

/** 演示账号里那个密码，单测里多处复用。 */
export const NEO_PASSWORD = 'matrix';

export interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: unknown;
}

/** 造一个只有 `Authorization` 头（可选）的请求对象。 */
export function makeRequest(authorization?: string): FakeRequest {
  return {
    headers: authorization === undefined ? {} : { authorization },
  };
}

/**
 * 造一个**够用**的 `ExecutionContext`。
 *
 * 守卫只用到 `switchToHttp().getRequest()`、`getHandler()`、`getClass()` 三样，
 * 所以替身也只实现这三样（外加几个被 `ArgumentsHost` 要求、但这条路径上不会被调用的方法）。
 * 完整手写 Nest 的 `ExecutionContext` 接口要二十来个方法，那只会把测试淹没在噪音里 ——
 * 所以这里显式 `as unknown as ExecutionContext` 收窄一次，代价是替身不完整这件事
 * 必须由 **e2e** 来兜底（真应用里跑一遍）。
 */
export function fakeExecutionContext(
  request: FakeRequest,
  handler: () => unknown,
  controller: object,
): ExecutionContext {
  const http = {
    getRequest: <T>() => request as unknown as T,
    getResponse: () => ({}),
    getNext: () => undefined,
  };

  return {
    switchToHttp: () => http,
    getHandler: () => handler,
    getClass: () => controller,
    getType: () => 'http',
    getArgs: () => [request],
    getArgByIndex: () => request,
    switchToRpc: () => ({ getContext: () => ({}), getData: () => undefined }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => undefined }),
  } as unknown as ExecutionContext;
}

// ── 元数据探针：用**真装饰器**标注，守卫通过 Reflector 读 ────────────────────────
// 方法都声明 `this: void`：它们不使用 `this`，这样"把方法当函数值传出去"
// （`X.prototype.method`）在类型与 lint 两层都是安全的。

/** 类级公开：所有方法都免认证。 */
@Public()
export class PublicProbeController {
  publicRoute(this: void): void {}
}

/** 一点元数据都没有：默认拒绝（fail-closed）的那一类。 */
export class ProtectedProbeController {
  protectedRoute(this: void): void {}
}
