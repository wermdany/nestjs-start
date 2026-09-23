import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

/** 内存用户表的条目。 */
export interface DemoUser {
  id: string;
  username: string;
  /**
   * ⚠️ **明文**密码。
   *
   * 这是刻意的演示妥协（"在内存里写死"）：真实的用户表必须存
   * bcrypt / argon2 这类**加盐单向哈希**，比对时比对哈希。
   * 除了这一处，本模块的其它部分（校验、签发、守卫、错误形状）都与真实实现同形，
   * 所以换掉这张表不影响其它代码。
   */
  password: string;
}

/**
 * 内存用户表 —— **写死两个演示账号**，不接数据库（本阶段非目标）。
 *
 * | 用户名 | 密码 | `sub` |
 * | --- | --- | --- |
 * | `neo` | `matrix` | `1` |
 * | `trinity` | `zion` | `2` |
 *
 * 它是 `AuthService` 唯一的依赖，所以将来换成 `UsersRepository`（DB 端口）时，
 * 改动只会落在这个类的实现上。
 */
@Injectable()
export class UsersService {
  private readonly users: readonly DemoUser[] = [
    { id: '1', username: 'neo', password: 'matrix' },
    { id: '2', username: 'trinity', password: 'zion' },
  ];

  /**
   * 按用户名找用户。
   *
   * 用户名在这一层**不再做归一化**：`LoginDto` 的 `@Transform` 已经 trim + 转小写
   * （见那个 DTO 的注释）。这样"存进来的值"和"比出来的值"是同一个东西。
   */
  findByUsername(username: string): DemoUser | undefined {
    return this.users.find((user) => user.username === username);
  }

  /**
   * 校验密码：**常量时间比较**。
   *
   * 先各自 SHA-256 再 `timingSafeEqual`，比的是定长 buffer ——
   * 既不暴露长度，也不暴露"猜对了几位"。在明文存储的前提下，
   * 这条至少把"便宜的时序攻击"去掉了。
   */
  verifyPassword(user: DemoUser, password: string): boolean {
    return constantTimeEquals(user.password, password);
  }
}

function constantTimeEquals(expected: string, actual: string): boolean {
  return timingSafeEqual(digestOf(expected), digestOf(actual));
}

function digestOf(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
