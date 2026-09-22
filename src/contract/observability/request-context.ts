import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 一次请求的上下文。目前只有请求 id，但这是"能在任意一层拿到请求级信息"的入口 ——
 * 以后要加 `userId` / trace 采样标记，只在这里扩字段。
 */
export interface RequestContext {
  requestId: string;
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
