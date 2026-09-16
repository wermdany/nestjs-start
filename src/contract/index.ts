/**
 * 契约模块（`src/contract/`）的**对外门面**。
 *
 * 三条刻意的规矩：
 *
 * 1. **模块内部互相引用一律走具体文件**（例如 `api-contract.module.ts` 里写
 *    `./validation/validation-pipe.factory`），绝不走这个桶 —— 这样桶永远不参与循环依赖。
 * 2. **用显式具名导出，不用 `export *`**。实测过：两个模块互相通过同一个桶引用时，
 *    `export *` 的**书写顺序**决定哪一侧拿到 `undefined`（往桶里加一行就可能弄坏
 *    无关模块）；重名时 `export *` 还会静默遮蔽。
 * 3. **消费方绝不能**写 `import type { RawBody } from '@/contract'` 这类类型导入 ——
 *    它会在运行时被擦除，`emitDecoratorMetadata` 只会发出 `Object`，
 *    而 `Object` 在 `ValidationPipe` 的跳过名单里，于是校验**静默失效**
 *    （同一个非法 body 会从 400 变成 201，且没有任何报错或警告）。详见 docs/validation.md §8。
 */

export { ApiContractModule } from './api-contract.module';
export type { ApiContractOptions } from './api-contract.module';

// ── 校验：全局管道 + 参数级豁免 + 自定义校验器 ────────────────────────────────
export {
  DEFAULT_VALIDATION_PIPE_OPTIONS,
  createValidationPipe,
  resolveValidationPipeOptions,
} from './validation/validation-pipe.factory';

export { AppExceptionFilter } from './validation/http-exception.filter';
// `ErrorDetail` 现在是**类**（为了挂 `@ApiProperty` 让 `/docs` 能生成 `$ref`），
// 所以按值导出；只当类型用的消费方行为不变。
export { ErrorDetail } from './validation/error-contract';
export type { ApiErrorBody } from './validation/error-contract';

export {
  VALIDATION_FAILED_MESSAGE,
  createValidationExceptionFactory,
  flattenValidationErrors,
} from './validation/validation-exception.factory';

export { RawBody } from './validation/raw-body.decorator';

export {
  IsNotReservedName,
  IsNotReservedNameConstraint,
} from './validation/is-not-reserved-name.validator';

// ── 响应：成功信封 + 逃生门 ───────────────────────────────────────────────────
export { PAGINATED_RESULT } from './response/response-contract';
export type {
  ErrorBody,
  ResponseBody,
  SuccessBody,
} from './response/response-contract';

export { ResponseEnvelopeInterceptor } from './response/response-envelope.interceptor';
export { isPaginatedResult } from './response/is-paginated-result';
export { NoEnvelope } from './response/no-envelope.decorator';

// ── 分页：共享入参 DTO + 结果构造 ─────────────────────────────────────────────
export {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PaginationQueryDto,
  createPaginationQueryDto,
} from './pagination/pagination-query.dto';

export { buildPaginatedResult } from './pagination/paginated-result';
export type {
  PaginatedResult,
  PaginationMeta,
} from './pagination/paginated-result';
