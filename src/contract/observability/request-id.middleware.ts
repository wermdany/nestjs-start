import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NestMiddleware } from '@nestjs/common';
import { runWithRequestContext } from './request-context';

/** 请求 id 的响应头名（同时在 `ErrorBody.traceId` 里回给客户端）。 */
export const REQUEST_ID_HEADER = 'x-request-id';

/** 请求对象上挂的字段名 —— 中间件靠它做幂等，过滤器靠它兜底取 id。 */
export const REQUEST_ID_PROP = 'requestId';

/**
 * 只接受**保守字符集**的客户端 id：字母数字 + `._-`，8~128 位。
 *
 * 为什么不能直接信任入参：响应头会被原样回写（`res.setHeader`），
 * 而日志里也会带上它。宽松接受等于把"客户端可控内容"引到日志与响应头里。
 * 不合法就换成服务端生成的 UUID —— 而不是报错，请求 id 不该成为一次请求的失败原因。
 */
const ACCEPTED_CLIENT_ID = /^[A-Za-z0-9._-]{8,128}$/;

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  [REQUEST_ID_PROP]?: string;
}

interface ResponseLike {
  setHeader: (name: string, value: string) => void;
}

function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;

  return candidate && ACCEPTED_CLIENT_ID.test(candidate)
    ? candidate
    : randomUUID();
}

/**
 * 给每个请求分配一个 id，做三件事：
 *
 * 1. 写入 `AsyncLocalStorage`（`getRequestId()` 在任意一层可用）；
 * 2. 回写 `x-request-id` 响应头（成功和失败都有，客户端排障时能直接抄）；
 * 3. 在**所有**异常（含未匹配路由的 404）上被 `AppExceptionFilter` 读进 `traceId`。
 *
 * ## 幂等
 *
 * 用请求对象上的属性做标记：一旦已经处理过就直接 `next()`。
 * 这样即使 `ApiContractModule` 被 import 了两次（中间件会被注册两遍），
 * 请求拿到的仍是**同一个** id，而不是两套 id 在日志里打架。
 *
 * ## 为什么挂在 module 的 `configure()` 上而不是 main.ts
 *
 * 中间件必须在**路由匹配之前**跑：这样未匹配路由的 404 也带得上 id。
 * `ApiContractModule.configure()` 里 `forRoutes('/{*splat}')` 覆盖全部路径。
 *
 * ⚠️ **不能写 `forRoutes('*')`**：Nest 11 底层是 Express 5，
 * path-to-regexp v8 要求通配符必须命名 —— `'*'` / `'/*'` / `'(.*)'` 会直接抛
 * `TypeError: Missing parameter name`。`/{*splat}` 是 v8 的写法（`{}` 表示可选，
 * 所以根路径 `/` 也被覆盖）。
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestLike, res: ResponseLike, next: () => void): void {
    if (req[REQUEST_ID_PROP]) {
      next();

      return;
    }

    const requestId = resolveRequestId(req.headers?.[REQUEST_ID_HEADER]);

    req[REQUEST_ID_PROP] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestContext({ requestId }, next);
  }
}
