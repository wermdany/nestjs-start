import type { ValidationPipeOptions } from '@nestjs/common';
import { ContractValidationPipe } from './contract-validation.pipe';
import { createValidationExceptionFactory } from './validation-exception.factory';

/**
 * 全局校验管道的默认开关：
 * - whitelist：剥掉 DTO 上没声明校验装饰器的字段
 * - forbidNonWhitelisted：**false** —— 未声明字段只被 whitelist 静默剥掉，不报错。
 *   设成 true 会改成"直接 400"：对契约更严格，但前端/埋点只要多带一个 query 参数就会 400。
 *   注意两者必须成对理解：`forbidNonWhitelisted` 只是 `whitelist` 内部的一个分支，
 *   单独开它（whitelist: false）是**完全没有效果**的。
 * - transform：把 plain object 转成 DTO 实例（`@Type()`、默认值、`@Type(() => Number)` 才会生效）
 * - exceptionFactory：校验失败输出结构化错误
 *   `{ code: 'VALIDATION_FAILED', message: 'Request validation failed',
 *      errors: [{ field, message, code }] }`，
 *   而不是 Nest 默认的字符串数组。失败响应的 `success` / `error` / `traceId` 由
 *   `AppExceptionFilter` 补齐（管道只负责把明细结构化）。`errors[].location` 由
 *   `ContractValidationPipe` 补（见那个文件里"为什么必须继承"的说明）。
 *
 * 刻意**没有**设 `transformOptions.enableImplicitConversion`：
 * query 的类型转换请显式写在 DTO 字段上（`@Type(() => Number)`），
 * 否则 `"123"` 会被静默转成 `123` 而通过 `@IsInt()`。
 */
export const DEFAULT_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  exceptionFactory: createValidationExceptionFactory(),
};

/**
 * 把调用方传入的选项叠加在默认开关之上。
 * 单独抽出来是为了让 `ApiContractModule.forRoot()` 和参数级 `createValidationPipe()`
 * 共用同一份合并逻辑。
 */
export function resolveValidationPipeOptions(
  options: ValidationPipeOptions = {},
): ValidationPipeOptions {
  return {
    ...DEFAULT_VALIDATION_PIPE_OPTIONS,
    ...options,
  };
}

/**
 * 造一个配好默认开关的 `ContractValidationPipe`。
 * 用在参数级/控制器级 `@UsePipes()` 上，或作为不使用 `ApiContractModule` 时的备选。
 */
export function createValidationPipe(
  options: ValidationPipeOptions = {},
): ContractValidationPipe {
  return new ContractValidationPipe(resolveValidationPipeOptions(options));
}
