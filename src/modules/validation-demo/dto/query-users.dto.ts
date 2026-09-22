import { IsEnum, IsString } from 'class-validator';
import { createPaginationQueryDto, IsOptionalNotNull } from '@/contract';
import { UserRole } from './user-role.enum';

/**
 * 分页三件套（`page` / `limit` / `sortBy`）来自共享的 `createPaginationQueryDto()`，
 * 这里只声明本模块自己的过滤条件。
 *
 * 数组里是 `sortBy` 的**白名单**，必填 —— 忘了传就"排不了序"，
 * 而不会变成"任意字段都能排序"（见 `createPaginationQueryDto` 的注释）。
 *
 * 可选字段统一用 `@IsOptionalNotNull()`：query string 本身产生不出 `null`，
 * 但这套 DTO 也可能被程序化调用（内部服务、测试），语义保持一致更省心。
 */
export class QueryUsersDto extends createPaginationQueryDto([
  'id',
  'name',
  'email',
]) {
  @IsOptionalNotNull()
  @IsString()
  keyword?: string;

  @IsOptionalNotNull()
  @IsEnum(UserRole)
  role?: UserRole;
}
