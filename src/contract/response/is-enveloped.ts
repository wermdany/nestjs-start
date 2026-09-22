import { ENVELOPED } from './response-contract';

/** `ENVELOPED in value` 会把 `value` 收窄成 `object`，用这个接口做返回类型。 */
interface MarkedValue {
  [ENVELOPED]?: true;
}

/**
 * 判断一个返回值是不是**已经**被响应信封包过一次。
 *
 * 只看非枚举 symbol 标记，不看结构 —— 原因与 {@link isPaginatedResult} 相同：
 * 业务对象里合法出现 `success` / `data` 字段时不该被误判。
 *
 * 拦截器靠它做幂等（`ApiContractModule` 被 import 多次时信封不会套两层）。
 */
export function isEnveloped(value: unknown): value is MarkedValue {
  return typeof value === 'object' && value !== null && ENVELOPED in value;
}
