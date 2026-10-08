/**
 * 成功侧响应信封的**对外门面**。
 *
 * ## 职责边界
 *
 * 这一个模块只管「成功响应怎么包」：拦截器 + 幂等标记 + 逃生门 + 分页识别标记。
 * **失败侧**（异常 → 错误信封）在 `../http-validation`；**线上形状**在 `../http-contract`。
 *
 * 依赖方向：`http-response → http-contract`（只取类型），单向。
 *
 * 规矩与其它模块一致：模块内部互相引用走**具体文件**，本桶只做对外门面、
 * 只做**显式具名导出**（不用 `export *` —— 它会在同名时静默遮蔽，且暴露面失控）。
 */

// ── 线上形状（转出，方便"响应侧"的消费方只认一个入口）────────────────────────
export type {
  ErrorBody,
  ErrorDetail,
  ErrorLocation,
  ResponseBody,
  SuccessBody,
} from '../http-contract';

// ── 标记：非枚举 symbol，wire 形状不变，但让增强器可靠识别 ─────────────────────
export { ENVELOPED, PAGINATED_RESULT } from './response-contract';

// ── 判定（纯函数，可单测）─────────────────────────────────────────────────────
export { isEnveloped } from './is-enveloped';
export { isPaginatedResult } from './is-paginated-result';

// ── 逃生门：显式声明"这条路由不要信封" ────────────────────────────────────────
export { NO_ENVELOPE_METADATA, NoEnvelope } from './no-envelope.decorator';

// ── 拦截器本体 ────────────────────────────────────────────────────────────────
export { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
export type { ResponseEnvelopeOptions } from './response-envelope.interceptor';
