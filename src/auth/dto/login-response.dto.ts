import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 登录成功的响应模型（信封里的 `data`）。
 *
 * 只有两个字段是**必需**的：令牌本身与它的类型。`expiresIn` 是从 token 的
 * `exp - iat` 读出来的，正常情况下都在；类型上写成可选是为了不撒谎 ——
 * "读不出来"时宁可不给这个字段，也不给一个编出来的数。
 */
export class LoginResponseDto {
  @ApiProperty({
    description: '访问令牌，后续用 `Authorization: Bearer <token>` 发送',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.…',
  })
  accessToken!: string;

  @ApiProperty({ description: '令牌类型，固定 `Bearer`', example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiPropertyOptional({
    description: '有效期（秒），由 token 的 `exp - iat` 得出',
    example: 3600,
  })
  expiresIn?: number;
}
