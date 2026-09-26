import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 一次请求的上下文。这是"能在任意一层拿到请求级信息"的入口。
 */
export interface RequestContext {
  requestId: string;
  /**
   * 已认证主体的 id（JWT 的 `sub`），认证成功后由 `JwtAuthGuard` 写入。
   *
   * 未认证的请求、以及 `@Public()` 路由上不会有这个字段 —— 读它的代码要处理 `undefined`。
   */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * 在请求上下文中执行 `callback`（由 `RequestIdMiddleware` 调用一次，包住整条下游链路）。
 *
 * 用的是 Node 的 `AsyncLocalStorage`（`nestjs-cls` 的核心机制）：
 * 一旦在 `run()` 里调用了 `next()`，之后**任何** await / promise 链上的代码
 * 都能通过 `getRequestContext()` 拿到同一个 id，不需要把 `req` 逐层透传。
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

/** 取当前请求上下文；不在请求里（例如启动阶段）返回 `undefined`。 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** 取当前请求 id；不在请求里返回 `undefined`。 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * 把已认证主体的 id 写进**当前**请求上下文（`JwtAuthGuard` 认证成功后调用一次）。
 *
 * 为什么是"就地改 store"而不是重新 `run()`：`AsyncLocalStorage` 的 store 是中间件
 * 创建后传下来的普通对象，在同一个异步上下文里改它等于"补一个字段"，下游立刻可见；
 * 重新 `run()` 只会造出一个下游拿不到的新作用域。
 *
 * 不在请求里调用（单测、启动阶段）是**无操作**，不抛错 —— 认证不该因为观测设施而失败。
 */
export function setRequestUserId(userId: string): void {
  const store = storage.getStore();

  if (store) {
    store.userId = userId;
  }
}
