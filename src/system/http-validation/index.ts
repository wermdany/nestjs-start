/**
 * 失败侧（异常 → 错误信封）与入参校验的**对外门面**。
 *
 * ## 职责边界
 *
 * | 关注点 | 位置 |
 * | --- | --- |
 * | 线上形状（`ErrorBody` / `ErrorDetail` / `ErrorLocation`） | `../http-contract` |
 * | **失败响应怎么产出**（过滤器、业务异常基类、校验失败工厂） | 本模块 |
 * | **入参怎么校验**（全局管道、参数级豁免、自定义校验器） | 本模块 |
 * | 成功响应怎么包 | `../http-response` |
 * | 请求 id / 上下文 | `../request-context` |
 *
 * 依赖方向：`http-validation → http-contract` + `http-validation → request-context`，单向。
 *
 * 规矩与其它模块一致：模块内部互相引用走**具体文件**，本桶只做对外门面、
 * 只做**显式具名导出**（不用 `export *`）。
 */

// ── 线上形状（转出，让业务侧 import 一个模块就够）─────────────────────────────
export type { ErrorBody, ErrorDetail, ErrorLocation } from '../http-contract';
export { ERROR_LOCATIONS, isErrorLocation } from '../http-contract';

// ── 业务异常 ──────────────────────────────────────────────────────────────────
export { ApiException } from './api-exception';
export { AppExceptionFilter } from './http-exception.filter';

// ── 校验管道（全局那一个 + 可复用的默认开关）──────────────────────────────────
export {
  DEFAULT_VALIDATION_PIPE_OPTIONS,
  createValidationPipe,
  resolveValidationPipeOptions,
} from './validation-pipe.factory';
export { ContractValidationPipe } from './contract-validation.pipe';

// ── 校验错误 → 结构化明细 ─────────────────────────────────────────────────────
export {
  annotateErrorDetails,
  createValidationExceptionFactory,
  flattenValidationErrors,
  VALIDATION_FAILED_MESSAGE,
} from './validation-exception.factory';

// ── 参数级豁免与自定义校验器（业务 DTO 直接用）────────────────────────────────
export { RawBody } from './raw-body.decorator';
export { IsOptionalNotNull } from './is-optional-not-null.decorator';
export {
  IsNotReservedName,
  IsNotReservedNameConstraint,
} from './is-not-reserved-name.validator';
