import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import type { ErrorDetail, ErrorLocation } from './error-contract';
import { codeOfConstraint, ErrorCode } from './error-code';

/** 校验失败时统一的人类可读概述（字段级细节在 `errors[]` 里）。 */
export const VALIDATION_FAILED_MESSAGE = 'Request validation failed';

/**
 * 把 class-validator 的 `ValidationError[]` 拍平成 `{ field, message, code }[]`。
 *
 * 三件事：
 *
 * 1. **路径**：嵌套结构走 `children`，字段路径用点号拼（`address.city`）——
 *    这就是 JSON:API 的 `source.pointer` / RFC 9457 扩展成员想表达的东西：
 *    **字段定位是结构化字段，不该靠 parse 文案**；
 * 2. **code**：`constraints` 的 key 是 class-validator 的约束名（库的实现细节），
 *    经 `codeOfConstraint()` 翻译成对外承诺的语义码（见 `./error-code`）；
 * 3. **location**：这里**填不了** —— `exceptionFactory` 拿不到 `ArgumentMetadata`。
 *    位置由 `ContractValidationPipe`（`./contract-validation.pipe`）在抛出前补上。
 *
 * 注意自定义 `exceptionFactory` 收到的是 class-validator 的**原始**错误树
 * （`property` 是局部名、`constraints` 的消息没有路径前缀），路径要自己拼；
 * Nest 默认那条路径会在它自己的 `flattenValidationErrors()` 里把路径前缀塞进文案。
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

    const ownConstraints = Object.entries(error.constraints ?? {}).map(
      ([constraint, message]): ErrorDetail => ({
        field: path,
        message,
        code: codeOfConstraint(constraint),
      }),
    );

    return [
      ...ownConstraints,
      ...flattenValidationErrors(error.children ?? [], path),
    ];
  });
}

/**
 * 给一组已结构化的明细补上"来自哪里"（`body` / `query` / `param`）。
 *
 * 单独抽成纯函数，是为了让 `ContractValidationPipe` 能在**不改动校验逻辑**的前提下
 * 做一次浅拷贝式的注解 —— 校验失败的构造仍然只有 `flattenValidationErrors` 一个来源。
 */
export function annotateErrorDetails(
  details: readonly ErrorDetail[],
  location: ErrorLocation,
): ErrorDetail[] {
  return details.map((detail) => ({ ...detail, location }));
}

/**
 * 给 `ValidationPipe` 用的 `exceptionFactory`：输出结构化错误而不是字符串数组。
 *
 * 用 `BadRequestException` 携带一个**对象**载荷（`{ code, message, errors }`），
 * 最后由全局 `AppExceptionFilter` 统一补上 `success` / `error` / `traceId`，
 * 并把 400 写进 HTTP 状态行。`code` 在这里就定成 `VALIDATION_FAILED`，
 * 前端不用去猜"这个 400 是校验还是别的"。
 */
export function createValidationExceptionFactory(): (
  errors: ValidationError[],
) => BadRequestException {
  return (errors) =>
    new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message: VALIDATION_FAILED_MESSAGE,
      errors: flattenValidationErrors(errors),
    });
}
