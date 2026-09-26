import type { ErrorLocation } from './error-contract';

/** `errors[].location` 的合法取值（顺序即文档里的顺序）。 */
export const ERROR_LOCATIONS = ['body', 'query', 'param'] as const;

/**
 * 判断一个运行时值是不是合法的 `location`。
 *
 * 需要它是因为**跨信任边界**：异常载荷可能来自第三方管道 / 守卫 / 库，
 * 里面的 `location` 不能直接信（和 `isErrorCode` 同一个理由）。
 * `@nestjs/common` 的 `ArgumentMetadata.type` 还多一个 `'custom'`，那个不算 location。
 */
export function isErrorLocation(value: unknown): value is ErrorLocation {
  return (
    typeof value === 'string' &&
    (ERROR_LOCATIONS as readonly string[]).includes(value)
  );
}
