import { PAGINATED_RESULT } from './response-contract';

/** `PAGINATED_RESULT in value` 会把 `value` 收窄成 `object`，用这个接口做返回类型。 */
interface MarkedValue {
  [PAGINATED_RESULT]?: true;
}

/**
 * 判断一个 handler 返回值是不是 `buildPaginatedResult()` 造出来的分页结果。
 *
 * 只看**非枚举 symbol 标记**，不看结构（原因见 `response-contract.ts` 里 `PAGINATED_RESULT` 的注释）。
 * 普通域对象即使刚好有 `data` / `meta` 字段也不会被认成"分页"。
 */
export function isPaginatedResult(value: unknown): value is MarkedValue {
  return (
    typeof value === 'object' && value !== null && PAGINATED_RESULT in value
  );
}
