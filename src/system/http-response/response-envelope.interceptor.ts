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
import { ENVELOPED } from './response-contract';
import { isEnveloped } from './is-enveloped';
import { isPaginatedResult } from './is-paginated-result';
import { NO_ENVELOPE_METADATA } from './no-envelope.decorator';

/** 拦截器的开关。用对象而不是布尔，方便以后加 `excludePaths` 之类的选项。 */
export interface ResponseEnvelopeOptions {
  /** 是否启用响应信封，默认 `true`（`ApiContractModule.forRoot({ envelope: false })` 会关掉）。 */
  enabled?: boolean;
}

/**
 * 统一**成功**响应的形状：`{ success: true, data, meta? }`。
 *
 * 失败侧由 `AppExceptionFilter` 负责（见 `response-contract.ts` 的契约说明）：
 * 它产出 `{ success: false, error, message, code?, traceId?, errors? }`，
 * 并把**数字状态码写进 HTTP 状态行**。这个拦截器不碰状态码 ——
 * body 里没有 `statusCode`，前端要数字码就读 `res.status`。
 *
 * ## 挂在哪一层
 *
 * 由 `ApiContractModule.forRoot()` / `forRootAsync()` 注册成 `APP_INTERCEPTOR`
 * （与 `APP_PIPE` / `APP_FILTER` 同样的做法），所以 `main.ts` 里**不需要**
 * `app.useGlobalInterceptors(...)`。
 *
 * ## 两个"能安全重复注册"的设计
 *
 * 1. **开关在运行时判断**（构造函数注入 `enabled`）而不是"注册或不注册" ——
 *    这是 `forRootAsync` 能成立的前提：异步工厂拿到的选项在静态 provider 列表里
 *    是未知的，没法据此增删 provider；
 * 2. **幂等**：返回值已经带 {@link ENVELOPED} 标记就原样放行。所以
 *    `ApiContractModule` 被 import 多次（每个实例都会注册一个 `APP_INTERCEPTOR`）
 *    也不会套出 `data.data`；测试里 `overrideProvider` 换上别的选项同样安全。
 *
 * ## 放行的情况（见 `wraps()`）
 *
 * 这些情况返回值不在"普通 JSON 响应"的语义里，包了就会改变行为甚至破坏协议：
 * `@Render()`（模板渲染）、`@Redirect()`（302 + Location）、`@Sse()`（逐条消息序列化）、
 * `@NoEnvelope()`（显式逃生门）、`StreamableFile`（文件流）。
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  private readonly enabled: boolean;

  constructor(options: ResponseEnvelopeOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled || !this.wraps(context)) {
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

    // 已经被别的拦截器实例（重复注册的 `ApiContractModule`）包过了：原样放行。
    if (isEnveloped(value)) {
      return value as ResponseBody;
    }

    const base: SuccessBody<unknown> = { success: true, data: null };
    const body: ResponseBody = isPaginatedResult(value)
      ? // 分页结果 `{ data, meta }` 的两个字段**提到信封顶层**：
        // 于是列表接口是 `{ success, data: [...], meta: {...} }`，
        // 而不是多一层的 `data: { data, meta }`。
        {
          ...base,
          data: (value as { data: unknown }).data,
          meta: (value as { meta: unknown }).meta,
        }
      : // 返回 `undefined` / `null`（例如 handler 忘了 return）也走信封，`data` 为 `null` ——
        // 保证前端拿到的形状不依赖 handler 写没写 return。
        { ...base, data: value ?? null };

    // 打幂等标记；非枚举 ⇒ `JSON.stringify` 看不见，wire 形状不变。
    Object.defineProperty(body, ENVELOPED, { value: true });

    return body;
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
