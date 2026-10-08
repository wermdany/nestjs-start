import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import type { ErrorDetail, ErrorLocation } from '../http-contract';

/** 校验失败时统一的人类可读概述（字段级细节在 `errors[]` 里）。 */
export const VALIDATION_FAILED_MESSAGE = 'Request validation failed';

/**
 * 把 class-validator 的 `ValidationError[]` 拍平成 `{ field, message }[]`。
 *
 * 两件事：
 *
 * 1. **路径**：嵌套结构走 `children`，字段路径用点号拼（`address.city`）——
 *    这就是 JSON:API 的 `source.pointer` / RFC 9457 扩展成员想表达的东西：
 *    **字段定位是结构化字段，不该靠 parse 文案**；
 * 2. **location**：这里**填不了** —— `exceptionFactory` 拿不到 `ArgumentMetadata`。
 *    位置由 `ContractValidationPipe`（`./contract-validation.pipe`）在抛出前补上。
 *
 * 注意自定义 `exceptionFactory` 收到的是 class-validator 的**原始**错误树
 * （`property` 是局部名、`constraints` 的消息没有路径前缀），路径要自己拼；
 * Nest 默认那条路径会在它自己的 `flattenValidationErrors()` 里把路径前缀塞进文案。
 *
 * ⚠️ 明细里**没有** `code`：本仓库已移除错误码，于是"哪个约束失败"只由 `message`
 * 表达（它是 class-validator 的原文，可直接展示给终端用户）。见 `ErrorDetail` 的注释。
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
      ([, message]): ErrorDetail => ({
        field: path,
        message,
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
 * 用 `BadRequestException` 携带一个**对象**载荷（`{ message, errors }`），
 * 最后由全局 `AppExceptionFilter` 统一补上 `success` / `error` / `traceId`，
 * 并把 400 写进 HTTP 状态行。
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
