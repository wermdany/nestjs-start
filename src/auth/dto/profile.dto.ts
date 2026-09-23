import { ApiProperty } from '@nestjs/swagger';

/**
 * 受保护路由 `/auth/profile` 的响应模型：**token 里的身份**。
 *
 * 它是"JWT 是自描述的"这件事的最短证明 —— 服务端没有查任何存储，
 * 只是把请求对象上那个（由守卫验签后挂上去的）载荷回显出来。
 */
export class ProfileDto {
  @ApiProperty({ description: '主体 id（JWT 的 `sub`）', example: '1' })
  sub!: string;

  @ApiProperty({ description: '用户名', example: 'neo' })
  username!: string;
}
