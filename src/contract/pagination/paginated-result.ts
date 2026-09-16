import { PAGINATED_RESULT } from '../response/response-contract';
import { PaginationQueryDto } from './pagination-query.dto';

/** 列表接口的统一响应形状。 */
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * 分页元信息。只保留三个**服务端才知道**的数：
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | `totalItems` | 过滤之后的总条数 |
 * | `itemsPerPage` | 这一页的页大小（已按 `PAGE_SIZE_MAX` 截断） |
 * | `currentPage` | 当前页码（从 1 开始） |
 *
 * **为什么不算 `totalPages`**：它是 `Math.ceil(totalItems / itemsPerPage)`，
 * 客户端一行就能算，服务端多传一个字段只是多一个可能和另外两个不一致的地方
 * （尤其当 `totalItems` 以后换成估算值时）。前端要显示"第 x / y 页"自己 `ceil` 一下即可。
 *
 * 字段命名对齐 [nestjs-paginate](https://github.com/ppetzold/nestjs-paginate)（JSON:API 风格），
 * 以后换库或对齐前端都不用改字段名。
 */
export interface PaginationMeta {
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
}

/**
 * 把「已经切好的一页数据 + 过滤后的总数」拼成统一响应。
 *
 * 注意 `totalItems` 是**过滤之后**的总数，不是全表总数。上数据库之后这一步
 * 会变成一条昂贵的 `COUNT`，届时要考虑让它可选或估算 —— 参考 nestjs-paginate
 * 的 `buildCountQuery` / `optimizedCount`，以及 AIP-158 里 "total_size may be an estimate"。
 *
 * 返回值上会打一个**非枚举**的 {@link PAGINATED_RESULT} 标记：
 * `ResponseEnvelopeInterceptor` 靠它把 `data` / `meta` 提到响应信封顶层。
 * 标记是不可枚举的 symbol，`JSON.stringify` 看不见 —— 所以 wire 形状与类型都没变。
 */
export function buildPaginatedResult<T>(
  data: T[],
  totalItems: number,
  query: Pick<PaginationQueryDto, 'page' | 'limit'>,
): PaginatedResult<T> {
  const result: PaginatedResult<T> = {
    data,
    meta: {
      totalItems,
      itemsPerPage: query.limit,
      currentPage: query.page,
    },
  };

  Object.defineProperty(result, PAGINATED_RESULT, { value: true });

  return result;
}
