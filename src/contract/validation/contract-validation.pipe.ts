import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata, ValidationPipeOptions } from '@nestjs/common';
import type { ErrorDetail } from './error-contract';
import { isErrorLocation } from './error-location';
import { annotateErrorDetails } from './validation-exception.factory';

/**
 * 在默认 `ValidationPipe` 之上**只加一件事**：给每条字段明细补上 `location`。
 *
 * ## 为什么必须继承，而不是改 `exceptionFactory`
 *
 * `exceptionFactory(errors)` 的入参只有 `ValidationError[]` —— `ArgumentMetadata`
 * 在 `transform()` 的局部作用域里，工厂拿不到。所以位置信息只能在这里补：
 * `transform()` 手里同时有 `metadata.type` 和"校验失败会抛什么"。
 *
 * ```ts
 * // 于是 `field: "id"` 不再有歧义：
 * GET  /users/abc      → errors: [{ field: "id", location: "param", code: "INVALID_TYPE" }]
 * POST /users {id:…}   → errors: [{ field: "id", location: "body",  code: "INVALID_TYPE" }]
 * ```
 *
 * ## 只做浅包装
 *
 * 不改校验逻辑、不改状态码、不改文案：捕获到校验用的 `BadRequestException` 后
 * 把 `errors[]` 逐条加上 `location` 再抛。任何**不是**本仓库那种对象载荷的异常
 * （字符串、`{ message: string[] }` 之类）原样放行 —— 交给 `AppExceptionFilter` 规范化。
 */
export class ContractValidationPipe extends ValidationPipe {
  constructor(options: ValidationPipeOptions = {}) {
    super(options);
  }

  override async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    try {
      return await super.transform(value, metadata);
    } catch (error) {
      throw this.withLocation(error, metadata.type);
    }
  }

  private withLocation(error: unknown, type: string): unknown {
    if (!(error instanceof BadRequestException) || !isErrorLocation(type)) {
      return error;
    }

    const payload = error.getResponse();

    if (typeof payload !== 'object' || payload === null) {
      return error;
    }

    const { errors } = payload as { errors?: unknown };

    if (!Array.isArray(errors)) {
      return error;
    }

    return new BadRequestException({
      ...(payload as Record<string, unknown>),
      errors: annotateErrorDetails(errors as ErrorDetail[], type),
    });
  }
}
