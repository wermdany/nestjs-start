import { Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import {
  REDIRECT_METADATA,
  RENDER_METADATA,
  SSE_METADATA,
} from '@nestjs/common/constants';
import { map, type Observable } from 'rxjs';
import type { ResponseBody, SuccessBody } from './response-contract';
import { isPaginatedResult } from './is-paginated-result';
import { NO_ENVELOPE_METADATA } from './no-envelope.decorator';

/**
 * 统一**成功**响应的形状：`{ success: true, data, meta? }`。
 *
 * 失败侧由 `AppExceptionFilter` 负责（见 `response-contract.ts` 的契约说明）：
 * 它产出 `{ success: false, error, message, errors? }`，并把**数字状态码写进 HTTP 状态行**。
 * 这个拦截器不碰状态码 —— body 里不再有 `statusCode`，前端要数字码就读 `res.status`。
 *
 * ## 挂在哪一层
 *
 * 由 `ApiContractModule.forRoot()` 注册成 `APP_INTERCEPTOR`（与 `APP_PIPE` / `APP_FILTER`
 * 同样的做法），所以 `main.ts` 里**不需要** `app.useGlobalInterceptors(...)`。
 *
 * ## 放行的情况（见 `wraps()`）
 *
 * 这些情况返回值不在"普通 JSON 响应"的语义里，包了就会改变行为甚至破坏协议：
 * `@Render()`（模板渲染）、`@Redirect()`（302 + Location）、`@Sse()`（逐条消息序列化）、
 * `@NoEnvelope()`（显式逃生门）、`StreamableFile`（文件流）。
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.wraps(context)) {
      return next.handle();
    }

    return next.handle().pipe(
      map<unknown, ResponseBody>((value) => {
        return this.envelope(value);
      }),
    );
  }

  /** handler 的返回值是否属于"普通 JSON 响应"，即是否该包信封。 */
  private wraps(context: ExecutionContext): boolean {
    // 装饰器可以打在方法上，也可以打在控制器上，所以两处都要读。
    const targets = [context.getHandler(), context.getClass()];
    const skips = [
      NO_ENVELOPE_METADATA,
      RENDER_METADATA,
      REDIRECT_METADATA,
      SSE_METADATA,
    ];

    return !skips.some((metadataKey) =>
      targets.some(
        (target) => Reflect.getMetadata(metadataKey, target) !== undefined,
      ),
    );
  }

  private envelope(value: unknown): ResponseBody {
    // 文件流由 `express-adapter` 的 `reply()` 直接 pipe 到响应，包成 JSON 会毁掉它。
    if (isStreamableFile(value)) {
      return value as ResponseBody;
    }

    const base: SuccessBody<unknown> = { success: true, data: null };

    if (isPaginatedResult(value)) {
      // 分页结果 `{ data, meta }` 的两个字段**提到信封顶层**：
      // 于是列表接口是 `{ success, data: [...], meta: {...} }`，
      // 而不是多一层的 `data: { data, meta }`。
      const paginated = value as { data: unknown; meta: unknown };

      return { ...base, data: paginated.data, meta: paginated.meta };
    }

    // 返回 `undefined` / `null`（例如 handler 忘了 return）也走信封，`data` 为 `null` ——
    // 保证前端拿到的形状不依赖 handler 写没写 return。
    return { ...base, data: value ?? null };
  }
}

/**
 * `@nestjs/common` 的根入口**不导出** `StreamableFile`（它在 `@nestjs/common/file-stream` 子路径下），
 * 而 `instanceof` 又需要一个运行时的类引用。为了不把这种边角依赖扩散到一个"一定会被执行"的
 * 拦截器里，这里改成鸭子类型判断：类名 + `getStream` 方法。
 *
 * 这样即使以后 Nest 换了导入路径，拦截器也不会在加载期就炸掉。
 */
function isStreamableFile(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    getStream?: unknown;
    constructor?: { name?: string };
  };

  return (
    typeof candidate.getStream === 'function' &&
    candidate.constructor?.name === 'StreamableFile'
  );
}
