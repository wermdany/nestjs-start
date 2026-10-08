/**
 * 跨业务复用的分页能力（入参 DTO + 结果构造）的**对外门面**。
 *
 * ## 为什么它在 `system/` 而不是 `http-*` 里
 *
 * 分页**不属于** HTTP 契约本身 —— 它是「所有列表接口共用的一套入参约定」：
 * `page` / `limit` / `sortBy` 白名单 + 超限截断。把它放在这里有两个具体好处：
 *
 * 1. **依赖方向干净**：`pagination → http-validation + http-response`。
 *    `http-validation` / `http-response` / `http-contract` **都不认识分页** ——
 *    所以分页可以自由使用 `@nestjs/swagger` 的 `@ApiPropertyOptional`，
 *    而不会污染"契约层零 Swagger 依赖"这条约束（它曾经正是被这个文件破坏的）。
 * 2. **业务侧一眼能找到**：列表 DTO 只要 `extends createPaginationQueryDto([...])`。
 *
 * 规矩与其它模块一致：本桶只做**显式具名导出**（不用 `export *`）。
 */

export {
  createPaginationQueryDto,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PaginationQueryDto,
} from './pagination-query.dto';

export { buildPaginatedResult } from './paginated-result';
export type { PaginatedResult, PaginationMeta } from './paginated-result';
