import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsNotReservedName, IsOptionalNotNull } from '@/contract';
import { AddressDto } from './address.dto';
import { UserRole } from './user-role.enum';

export class CreateUserDto {
  /**
   * `@Transform` 在 `@IsString()` / `@Length()` **之前**执行（class-transformer 先跑，
   * class-validator 后跑），所以长度校验量的是**去掉首尾空格之后**的值 ——
   * 否则 `"  Neo  "` 会带着空格入库，`"  "` 也能骗过 `@Length(2, 20)`。
   *
   * 只在这个 DTO 上做，不做成全局管道行为：webhook 的 `@RawBody()` 载荷、
   * 将来做签名校验用的原始 body 都不能被改写。
   */
  @ApiProperty({
    description:
      '用户名（不允许 admin / root / system 等保留字；首尾空格会被去掉）',
    example: 'Neo',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 20)
  @IsNotReservedName()
  name: string;

  /**
   * 邮箱**归一化**：去空格 + 转小写后再校验、再入库。
   *
   * 不做这一步的话 `NEO@EXAMPLE.COM` 和 `neo@example.com` 会被当成两个不同的邮箱，
   * "全局唯一"这条业务约束就被大小写绕过去了（实测过）。
   */
  @ApiProperty({
    description: '邮箱，全局唯一（比较前会去空格并转小写）',
    example: 'neo@example.com',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: '年龄',
    example: 30,
    minimum: 0,
    maximum: 150,
  })
  // `@IsOptionalNotNull()`（不是 `@IsOptional()`）：可以不传，但显式传 `null` 会被拒。
  // 详见 src/contract/validation/is-optional-not-null.decorator.ts
  @IsOptionalNotNull()
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
  @IsOptionalNotNull()
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
  @IsOptionalNotNull()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}
