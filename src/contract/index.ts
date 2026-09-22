/**
 * 契约模块（`src/contract/`）的**对外门面**。
 *
 * 四条刻意的规矩：
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
 * 4. **线上形状（wire contract）定义在 `@nest-start/api-contract`**（前后端共享的纯类型包），
 *    这里转出类型、只放服务端运行时需要的东西（值对象、增强器、装饰器）。
 *    契约层**不依赖任何 Swagger 包**：OpenAPI 投影全在 `src/swagger/`。
 */

export { ApiContractModule, API_CONTRACT_OPTIONS } from './api-contract.module';
export type {
  ApiContractAsyncOptions,
  ApiContractOptions,
} from './api-contract.module';

// ── 校验：全局管道 + 参数级豁免 + 自定义校验器 + 业务异常 ─────────────────────
export {
  DEFAULT_VALIDATION_PIPE_OPTIONS,
  createValidationPipe,
  resolveValidationPipeOptions,
} from './validation/validation-pipe.factory';

export { ContractValidationPipe } from './validation/contract-validation.pipe';

export { AppExceptionFilter } from './validation/http-exception.filter';
export { ApiException } from './validation/api-exception';

// `ErrorDetail` 是**纯类型**（定义在共享契约包里），所以只能 `export type` ——
// 这也正是"契约层零 Swagger 依赖"的代价与好处：OpenAPI 那边改用手写 schema + 一致性守卫。
export type {
  ApiErrorBody,
  ErrorBody,
  ErrorDetail,
  ErrorLocation,
} from './validation/error-contract';

export {
  codeOfConstraint,
  ErrorCode,
  isErrorCode,
  VALIDATION_CONSTRAINT_CODES,
} from './validation/error-code';

export { ERROR_LOCATIONS, isErrorLocation } from './validation/error-location';

export {
  annotateErrorDetails,
  VALIDATION_FAILED_MESSAGE,
  createValidationExceptionFactory,
  flattenValidationErrors,
} from './validation/validation-exception.factory';

export { IsOptionalNotNull } from './validation/is-optional-not-null.decorator';

export { RawBody } from './validation/raw-body.decorator';

export {
  IsNotReservedName,
  IsNotReservedNameConstraint,
} from './validation/is-not-reserved-name.validator';

// ── 可观测性：请求 id（进错误信封 / 响应头 / 日志） ─────────────────────────────
export {
  getRequestContext,
  getRequestId,
  runWithRequestContext,
} from './observability/request-context';
export type { RequestContext } from './observability/request-context';

export {
  REQUEST_ID_HEADER,
  REQUEST_ID_PROP,
  RequestIdMiddleware,
} from './observability/request-id.middleware';

// ── 响应：成功信封 + 逃生门 ───────────────────────────────────────────────────
export { ENVELOPED, PAGINATED_RESULT } from './response/response-contract';
export type { ResponseBody, SuccessBody } from './response/response-contract';

export { ResponseEnvelopeInterceptor } from './response/response-envelope.interceptor';
export type { ResponseEnvelopeOptions } from './response/response-envelope.interceptor';
export { isEnveloped } from './response/is-enveloped';
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
