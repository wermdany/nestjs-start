import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import type { ErrorDetail } from './error-contract';

/** 校验失败时统一的人类可读概述（字段级细节在 `errors[]` 里）。 */
export const VALIDATION_FAILED_MESSAGE = 'Request validation failed';

/**
 * 把 class-validator 的 `ValidationError[]` 拍平成 `{ field, message }[]`。
 *
 * 嵌套结构走 `children`，字段路径用点号拼（`address.city`）—— 这就是
 * JSON:API 的 `source.pointer` / RFC 9457 扩展成员想表达的东西：
 * **字段定位是结构化字段，不该靠 parse 文案**。
 *
 * 注意自定义 `exceptionFactory` 收到的是 class-validator 的**原始**错误树
 * （`property` 是局部名、`constraints` 的消息没有路径前缀），路径要自己拼；
 * Nest 默认那条路径会在 `flattenValidationErrors()` 里把路径前缀塞进文案。
 */
export function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): ErrorDetail[] {
  return errors.flatMap((error) => {
    const path = error.property
      ? parentPath
        ? `${parentPath}.${error.property}`
        : error.property
      : parentPath || '(request)';

    const ownConstraints = Object.values(error.constraints ?? {}).map(
      (message): ErrorDetail => ({ field: path, message }),
    );

    return [
      ...ownConstraints,
      ...flattenValidationErrors(error.children ?? [], path),
    ];
  });
}

/**
 * 给 `ValidationPipe` 用的 `exceptionFactory`：输出结构化错误而不是字符串数组。
 *
 * 用 `BadRequestException` 携带一个**对象**载荷，最后由全局 `AppExceptionFilter`
 * 统一补上 `success` / `error`，并把 400 写进 HTTP 状态行。
 */
export function createValidationExceptionFactory(): (
  errors: ValidationError[],
) => BadRequestException {
  return (errors) =>
    new BadRequestException({
      message: VALIDATION_FAILED_MESSAGE,
      errors: flattenValidationErrors(errors),
    });
}
