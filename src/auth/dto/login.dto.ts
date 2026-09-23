import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/**
 * 登录入参。
 *
 * `username` 与 `password` 的处理**刻意不对称**：
 *
 * - 用户名是**标识符**：去空格 + 转小写（否则 `Neo` / `neo ` 都得让用户自己记住大小写）；
 * - 密码是**秘密**：一个字符都不改。首尾空格是密码的一部分，trim 会**静默改变凭证**
 *   （用户复制粘贴时带的空格会变成一个神秘的"密码不对"）。
 *
 * 这也解释了为什么归一化写在 DTO 上而不是"全局管道行为"：它是个**字段语义**问题
 * （与 `CreateUserDto` 给 name/email 去空格是同一类判断）。
 */
export class LoginDto {
  @ApiProperty({
    description: '用户名（去首尾空格、大小写不敏感）',
    example: 'neo',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'username 必须是字符串' })
  @Length(1, 32, { message: 'username 长度必须是 1..32' })
  username!: string;

  @ApiProperty({
    description: '密码（**不去空格**：首尾空格是密码的一部分）',
    example: 'matrix',
    minLength: 1,
    maxLength: 72,
  })
  @IsString({ message: 'password 必须是字符串' })
  @Length(1, 72, { message: 'password 长度必须是 1..72' })
  password!: string;
}
