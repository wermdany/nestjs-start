import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsNotReservedName } from '@/contract';
import { AddressDto } from './address.dto';
import { UserRole } from './user-role.enum';

export class CreateUserDto {
  @ApiProperty({
    description: '用户名（不允许 admin / root / system 等保留字）',
    example: 'Neo',
  })
  @IsString()
  @Length(2, 20)
  @IsNotReservedName()
  name: string;

  @ApiProperty({ description: '邮箱，全局唯一', example: 'neo@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: '年龄',
    example: 30,
    minimum: 0,
    maximum: 150,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  /**
   * 这个 `@ApiProperty` 是**刻意显式**的，不靠 CLI 插件从 `@IsEnum(UserRole)` 推。
   *
   * 实测：枚举的推导在 `nest build`（Nest CLI 跑 AST 变换）下正常，但在 **ts-jest** 下
   * 会因为插件解析不到跨文件导入的 `UserRole` 而退化成 `{ type: 'object' }`。
   * Schema 属于对外契约，不能依赖"某个构建路径恰好能推出来"。
   */
  @ApiProperty({
    description: '角色',
    enum: UserRole,
    example: UserRole.Viewer,
  })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({
    description: '标签（最多 5 个）',
    type: [String],
    example: ['founder'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  tags?: string[];

  /**
   * `@Type(() => AddressDto)` 不能省：只有它会把这个 plain object 转成 `AddressDto` 实例，
   * `@ValidateNested()` 才有东西可校验。少写 `@Type` 时嵌套校验会**静默失效**。
   */
  @ApiPropertyOptional({
    description: '地址（嵌套对象）',
    type: () => AddressDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}
