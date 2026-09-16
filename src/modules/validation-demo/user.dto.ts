import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AddressDto } from './dto/address.dto';
import { UserRole } from './dto/user-role.enum';

/**
 * `users` 资源的响应模型。
 *
 * 从原来的 `interface User` 升级成**类**，是因为 OpenAPI 的 `$ref` 需要一个运行时的类引用，
 * 而接口在编译后什么都不剩、`@ApiProperty` 也无处可挂。做成类之后：
 *
 * - `/docs` 里 `GET /users/:id` 的 `data` 直接指向 `UserDto`，字段与约束都在文档里；
 * - service 侧靠文件末尾的 `export type User = UserDto` 保持原有代码**零改动**。
 *
 * 注意这里**没有**校验装饰器：它是出参模型，校验只发生在入参 DTO 上。
 */
export class UserDto {
  @ApiProperty({ description: '自增 id，从 1 开始', example: 1 })
  id: number;

  @ApiProperty({
    description: '用户名',
    example: 'Neo',
    minLength: 2,
    maxLength: 20,
  })
  name: string;

  @ApiProperty({
    description: '邮箱',
    example: 'neo@example.com',
    format: 'email',
  })
  email: string;

  @ApiPropertyOptional({
    description: '年龄',
    example: 30,
    minimum: 0,
    maximum: 150,
  })
  age?: number;

  @ApiProperty({ description: '角色', enum: UserRole, example: UserRole.Admin })
  role: UserRole;

  @ApiProperty({ description: '标签', type: [String], example: ['founder'] })
  tags: string[];

  @ApiPropertyOptional({ description: '地址', type: () => AddressDto })
  address?: AddressDto;
}

/**
 * 兼容别名：service 与控制器里写的是 `User`，语义上就是"响应模型"。
 * 用 `type` 而不是 `interface extends`，避免多一层名义类型。
 */
export type User = UserDto;
