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

/**
 * 全局异常过滤器：把**所有**异常收敛成同一个 {@link ApiErrorBody} 形状
 * `{ success: false, error, message, errors? }`，并把**数字状态码写进 HTTP 状态行**。
 *
 * 为什么需要它（而不是只改管道的 `exceptionFactory`）：
 * `exceptionFactory` 只能管校验错误；404 / 409 / 500 是 service 或框架抛的，
 * 只有过滤器能统一它们。否则前端要面对"400 是数组、404 是字符串"两套解析。
 *
 * 为什么 body 里不再带 `statusCode`：数字状态码属于 HTTP 层，前端读 `res.status` 就有；
 * 在 body 里冗余一份既没有信息增量，又多一个"和状态行漂移"的隐患。所以这里只调
 * `response.status(...)`，不在 body 里重复。`error`（状态短语）保留，它是人话标识。
 *
 * 安全边界（RFC 9457 §5 / OWASP）：非 `HttpException` 的内部异常**只回一个通用文案**，
 * 细节（堆栈、SQL、类名）只进日志 —— 不通过 HTTP 泄漏实现细节。
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => { json: (body: ApiErrorBody) => void };
    }>();

    const { statusCode, body } = this.toApiErrorBody(exception, host);

    response.status(statusCode).json(body);
  }

  private toApiErrorBody(
    exception: unknown,
    host: ArgumentsHost,
  ): { statusCode: number; body: ApiErrorBody } {
    if (!(exception instanceof HttpException)) {
      this.logInternalError(exception, host);

      const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

      return {
        statusCode,
        body: {
          success: false,
          error: this.phraseOf(statusCode),
          message: 'Internal server error',
        },
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return {
        statusCode,
        body: {
          success: false,
          error: this.phraseOf(statusCode),
          message: payload,
        },
      };
    }

    const { message, errors } = payload as {
      message?: unknown;
      errors?: unknown;
    };

    return {
      statusCode,
      body: {
        success: false,
        error: this.phraseOf(statusCode),
        message:
          typeof message === 'string'
            ? message
            : (STATUS_CODES[statusCode] ?? 'Error'),
        ...(Array.isArray(errors) ? { errors: errors as ErrorDetail[] } : {}),
      },
    };
  }

  private phraseOf(statusCode: number): string {
    return STATUS_CODES[statusCode] ?? 'Error';
  }

  private logInternalError(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<{
      method?: string;
      url?: string;
    }>();
    const where = `${request.method ?? '?'} ${request.url ?? '?'}`;

    this.logger.error(
      `Unhandled exception on ${where}`,
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
