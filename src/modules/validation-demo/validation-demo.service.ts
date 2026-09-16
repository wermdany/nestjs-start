import { Injectable } from '@nestjs/common';
import { buildPaginatedResult } from '@/contract';
import type { PaginatedResult } from '@/contract';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from './dto/user-role.enum';
import {
  EmailAlreadyExistsException,
  UserNotFoundException,
} from './exceptions';
import type { User } from './user.dto';

/**
 * 纯内存实现（本阶段不碰数据库），只为把各种校验行为跑通。
 * 注意它是**单例**，所以同一个测试文件内的用例共享状态。
 */
@Injectable()
export class ValidationDemoService {
  private readonly users = new Map<number, User>();
  private nextId = 1;

  constructor() {
    this.seed();
  }

  create(dto: CreateUserDto): User {
    this.assertEmailAvailable(dto.email);

    const id = this.nextId++;
    const user: User = {
      id,
      name: dto.name,
      email: dto.email,
      age: dto.age,
      role: dto.role,
      tags: dto.tags ?? [],
      address: dto.address,
    };

    this.users.set(id, user);

    return user;
  }

  findAll(query: QueryUsersDto): PaginatedResult<User> {
    const keyword = query.keyword?.toLowerCase();
    const sortBy = query.sortBy ?? 'id';

    const matched = [...this.users.values()]
      .filter((user) => (query.role ? user.role === query.role : true))
      .filter((user) => this.matchesKeyword(user, keyword))
      .sort((a, b) => compareValues(a[sortBy], b[sortBy]));

    const start = (query.page - 1) * query.limit;

    // 响应信封由 buildPaginatedResult 统一拼，service 只管"取到这一页"。
    return buildPaginatedResult(
      matched.slice(start, start + query.limit),
      matched.length,
      query,
    );
  }

  findOne(id: number): User {
    const user = this.users.get(id);

    if (!user) {
      throw new UserNotFoundException(id);
    }

    return user;
  }

  update(id: number, dto: UpdateUserDto): User {
    const current = this.findOne(id);

    if (dto.email !== undefined && dto.email !== current.email) {
      this.assertEmailAvailable(dto.email);
    }

    const updated: User = { ...current, ...dto };

    this.users.set(id, updated);

    return updated;
  }

  private matchesKeyword(user: User, keyword?: string): boolean {
    if (!keyword) {
      return true;
    }

    return (
      user.name.toLowerCase().includes(keyword) ||
      user.email.toLowerCase().includes(keyword)
    );
  }

  private assertEmailAvailable(email: string): void {
    const taken = [...this.users.values()].some((user) => user.email === email);

    if (taken) {
      throw new EmailAlreadyExistsException(email);
    }
  }

  private seed(): void {
    const seedUsers: Omit<User, 'id'>[] = [
      {
        name: 'Neo',
        email: 'neo@example.com',
        age: 30,
        role: UserRole.Admin,
        tags: ['founder'],
      },
      {
        name: 'Trinity',
        email: 'trinity@example.com',
        age: 28,
        role: UserRole.Editor,
        tags: [],
      },
    ];

    for (const seedUser of seedUsers) {
      const id = this.nextId++;
      this.users.set(id, { id, ...seedUser });
    }
  }
}

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  return String(a).localeCompare(String(b));
}
