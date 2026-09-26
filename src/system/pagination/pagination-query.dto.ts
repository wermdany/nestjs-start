import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';
import { IsOptionalNotNull } from '../validation/is-optional-not-null.decorator';

/** 不传 `limit` 时的默认页大小。 */
export const PAGE_SIZE_DEFAULT = 10;

/**
 * 服务端硬上限。超过它**截断**而不是报错 —— 这是照 Google
 * [AIP-158](https://google.aip.dev/158) 的做法：
 * "should coerce down to the maximum permitted page size"。
 */
export const PAGE_SIZE_MAX = 50;

/**
 * 所有列表接口共用的分页参数。
 *
 * 两个容易踩的点：
 *
 * 1. query 里全是字符串，而且我们**没有**开 `enableImplicitConversion`，
 *    所以数字字段必须显式写 `@Type(() => Number)`；
 * 2. `@Transform` 在 `@Type` 之后、校验之前执行，所以"先转数字 → 再截断 → 最后校验"
 *    这个顺序是成立的：`?limit=999` 被截成 50，而 `?limit=abc` 依旧是 400。
 *
 * `@ApiProperty(Optional)` 是**显式**的，不是靠 `@nestjs/swagger` 插件推的：
 * 分页参数会被复用到每个列表接口，schema 一旦靠推断，插件配置一改就会整体漂移。
 */
export class PaginationQueryDto {
  /** 页码，从 1 开始。 */
  @ApiPropertyOptional({
    description: '页码，从 1 开始',
    example: 1,
    default: 1,
    minimum: 1,
    type: Number,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** 每页条数；超过上限会被**截断**成上限，而不是报错。 */
  @ApiPropertyOptional({
    description: `每页条数，超过 ${PAGE_SIZE_MAX} 会被截断成 ${PAGE_SIZE_MAX}（不是报错）`,
    example: PAGE_SIZE_DEFAULT,
    default: PAGE_SIZE_DEFAULT,
    minimum: 1,
    maximum: PAGE_SIZE_MAX,
    type: Number,
  })
  @Type(() => Number)
  @Transform(({ value }: { value: unknown }) =>
    Math.min(Number(value), PAGE_SIZE_MAX),
  )
  @IsInt()
  @Min(1)
  limit: number = PAGE_SIZE_DEFAULT;
}

/**
 * 造一个带排序白名单的分页 DTO。
 *
 * 把 `sortableColumns` 做成**必填参数**，是照搬 [nestjs-paginate](https://github.com/ppetzold/nestjs-paginate)
 * 的做法（它把 `sortableColumns` 标为 `Required: true`）：排序字段最终会进 `ORDER BY`，
 * 必须是硬白名单。忘了传白名单时，子类里根本没有 `sortBy` 这个字段，
 * 请求带上它就 `whitelist` 拦成 400 —— 所以"漏掉白名单"绝**不会**退化成"随便排序"。
 *
 * `@ApiPropertyOptional({ enum })` 必须手写：这个类是**函数体内动态生成**的，
 * Swagger 插件不保证处理到它；而枚举值又只有调用方知道。
 *
 * @example
 * ```ts
 * export class QueryUsersDto extends createPaginationQueryDto(['id', 'name']) {
 *   @IsOptionalNotNull() @IsString() keyword?: string;
 * }
 * ```
 */
export function createPaginationQueryDto<const T extends readonly string[]>(
  sortableColumns: T,
) {
  class SortablePaginationQueryDto extends PaginationQueryDto {
    /** 排序字段，只接受白名单里的列。 */
    @ApiPropertyOptional({
      description: '排序字段（只接受白名单里的列）',
      enum: [...sortableColumns],
      example: sortableColumns[0],
    })
    @IsOptionalNotNull()
    @IsIn([...sortableColumns])
    sortBy?: T[number];
  }

  return SortablePaginationQueryDto;
}
