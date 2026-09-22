import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { ApiErrorBody, ErrorDetail } from './error-contract';
import { ErrorCode, isErrorCode } from './error-code';
import { isErrorLocation } from './error-location';
import { getRequestId } from '../observability/request-context';
import { REQUEST_ID_PROP } from '../observability/request-id.middleware';

/**
 * 全局异常过滤器：把**所有**异常收敛成同一个 {@link ApiErrorBody} 形状
 * `{ success: false, error, message, code?, traceId?, errors? }`，
 * 并把**数字状态码写进 HTTP 状态行**。
 *
 * 为什么需要它（而不是只改管道的 `exceptionFactory`）：
 * `exceptionFactory` 只能管校验错误；404 / 409 / 500 是 service 或框架抛的，
 * 只有过滤器能统一它们。否则前端要面对"400 是数组、404 是字符串"两套解析。
 *
 * ## 出口只有一个形状（包括别人的异常）
 *
 * Nest 内建 / 第三方管道与守卫抛异常的**传统载荷**是
 * `{ statusCode, message: string[], error }`（`ParseFilePipe`、`ParseUUIDPipe`、
 * 任何人局部挂的 `new ValidationPipe()`…）。这类载荷里的 `message` 是**字符串数组**，
 * 如果只认字符串就会退化成"message = 状态短语、明细全丢"。
 * 所以这里统一规范化：数组 message 逐条变成 `errors[]`，
 * 而 `message` 兜底成第一条明细 —— 前端永远只需要一套解析。
 *
 * ## 为什么 body 里不再带 `statusCode`
 *
 * 数字状态码属于 HTTP 层，前端读 `res.status` 就有；在 body 里冗余一份既没有信息增量，
 * 又多一个"和状态行漂移"的隐患。所以这里只调 `response.status(...)`。
 * `error`（状态短语）保留，它是人话标识。
 *
 * ## 安全边界（RFC 9457 §5 / OWASP）
 *
 * 非 `HttpException` 的内部异常**只回一个通用文案**，细节（堆栈、SQL、类名）只进日志
 * —— 不通过 HTTP 泄漏实现细节。`traceId` 是日志与响应之间唯一的那根线。
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => {
        json: (body: ApiErrorBody) => void;
      };
      headersSent?: boolean;
    }>();

    // 响应已经开始往外写（例如 `@Sse()` 已建流之后才抛错）时再调
    // `status()/json()` 会抛 `ERR_HTTP_HEADERS_SENT` —— 那会让过滤器自己
    // 变成"未处理的异常"。这种情况只能记日志，不能再改响应。
    if (response.headersSent) {
      this.logger.error(
        `Exception after response started: ${this.describe(exception)}`,
      );

      return;
    }

    const { statusCode, body } = this.toApiErrorBody(exception, host);

    response.status(statusCode).json(body);
  }

  private toApiErrorBody(
    exception: unknown,
    host: ArgumentsHost,
  ): { statusCode: number; body: ApiErrorBody } {
    const traceId = this.traceIdOf(host);

    if (!(exception instanceof HttpException)) {
      this.logInternalError(exception, host, traceId);

      const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

      return {
        statusCode,
        body: {
          success: false,
          error: this.phraseOf(statusCode),
          message: 'Internal server error',
          code: ErrorCode.INTERNAL_ERROR,
          ...(traceId ? { traceId } : {}),
        },
      };
    }

    const statusCode = exception.getStatus();
    const phrase = this.phraseOf(statusCode);
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return {
        statusCode,
        body: {
          success: false,
          error: phrase,
          message: payload.trim() ? payload : phrase,
          ...(traceId ? { traceId } : {}),
        },
      };
    }

    const { message, errors, code } = payload as {
      message?: unknown;
      errors?: unknown;
      code?: unknown;
    };
    const details = this.normalizeDetails(errors, message);

    return {
      statusCode,
      body: {
        success: false,
        error: phrase,
        message: this.messageOf(message, details, phrase),
        ...(isErrorCode(code) ? { code } : {}),
        ...(traceId ? { traceId } : {}),
        ...(details.length ? { errors: details } : {}),
      },
    };
  }

  /**
   * 把异常的 `errors` / `message` 规范化成 `ErrorDetail[]`。
   *
   * - 本仓库的校验管道：`errors` 已经是 `{ field, message, code?, location? }`；
   * - Nest 内建管道的传统载荷：没有 `errors`，只有 `message: string[]` ⇒
   *   逐条转成 `field: '(request)'`（它们不带字段名，硬编一个字段名会比空更误导）；
   * - 任何一条形状不对的明细直接丢弃，而不是把垃圾透给客户端（跨信任边界）。
   */
  private normalizeDetails(errors: unknown, message: unknown): ErrorDetail[] {
    const raw: unknown[] = Array.isArray(errors)
      ? errors
      : Array.isArray(message)
        ? message.map((item: unknown) => ({
            field: '(request)',
            message: item,
          }))
        : [];

    return raw.flatMap((item): ErrorDetail[] => {
      if (typeof item !== 'object' || item === null) {
        return [];
      }

      const {
        field,
        message: detail,
        code,
        location,
      } = item as Record<string, unknown>;

      if (typeof detail !== 'string') {
        return [];
      }

      return [
        {
          field: typeof field === 'string' && field ? field : '(request)',
          message: detail,
          ...(isErrorCode(code) ? { code } : {}),
          ...(isErrorLocation(location) ? { location } : {}),
        },
      ];
    });
  }

  /**
   * `message` 的取值顺序：字符串（非空白）> 第一条明细 > 状态短语。
   * 空字符串是真实的坑（`new NotFoundException('')`），不能原样透给前端。
   */
  private messageOf(
    message: unknown,
    details: ErrorDetail[],
    phrase: string,
  ): string {
    if (typeof message === 'string' && message.trim()) {
      return message;
    }

    return details[0]?.message ?? phrase;
  }

  /**
   * 请求 id：优先取 `AsyncLocalStorage`（服务端任意一层的唯一来源），
   * 退化到请求对象上的属性（中间件一定写过；单测里手搓的 host 可能没有）。
   */
  private traceIdOf(host: ArgumentsHost): string | undefined {
    const request = host.switchToHttp().getRequest<{
      [REQUEST_ID_PROP]?: string;
    }>();

    return getRequestId() ?? request[REQUEST_ID_PROP];
  }

  private phraseOf(statusCode: number): string {
    return STATUS_CODES[statusCode] ?? 'Error';
  }

  private logInternalError(
    exception: unknown,
    host: ArgumentsHost,
    traceId?: string,
  ): void {
    const request = host.switchToHttp().getRequest<{
      method?: string;
      url?: string;
    }>();
    const where = `${request.method ?? '?'} ${request.url ?? '?'}`;
    const suffix = traceId ? ` [${traceId}]` : '';

    this.logger.error(
      `Unhandled exception on ${where}${suffix}`,
      this.describe(exception),
    );
  }

  /** 堆栈只进日志，绝不进响应体。 */
  private describe(exception: unknown): string {
    if (exception instanceof Error) {
      return exception.stack ?? exception.message;
    }

    return JSON.stringify(exception) ?? 'unknown non-Error thrown';
  }
}
