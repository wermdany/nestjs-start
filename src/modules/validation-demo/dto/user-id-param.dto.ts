import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * 路由参数 `:id` 的校验。
 *
 * **为什么用 DTO 而不是 `@Param('id', ParseIntPipe)`**：
 * `ParseIntPipe` 的异常是在构造函数里造好的、只接受一个字符串，所以它的内建消息
 * `Validation failed (numeric string is expected)` **结构上就带不出字段名**，
 * 而且 `message` 是**字符串**（DTO 校验走的是 `{ code, message, errors[] }`），前端要写两套解析。
 *
 * 换成 `@Param() params: UserIdParamDto` 之后，走的是同一套全局管道：
 * - 失败时得到结构化的明细：`errors: [{ field: "id", location: "param",
 *   code: "INVALID_TYPE" | "OUT_OF_RANGE", message: "…" }]` —— 有字段名、有位置、有机器判据；
 * - 顺带补上 `ParseIntPipe` 没有的**范围校验**（它连 `-5` 和 `0` 都放行，
 *   这在改造成 `GET /users/-5` 时表现为 404 而不是 400）。
 */
export class UserIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number;
}
