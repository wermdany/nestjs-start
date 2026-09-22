import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * 所有字段变可选，但保留 `CreateUserDto` 上的校验装饰器
 * （校验规则只写一遍，Update 版靠 `PartialType` 复用）。
 *
 * 为什么用 `@nestjs/swagger` 的 `PartialType` 而不是 `@nestjs/mapped-types` 的那个：
 * 两个在**校验**上完全等价，但只有 Swagger 版会同时把字段元数据复制过来，
 * `PATCH` 的请求体 schema 才有内容（Nest 官方文档对这一点有明确说明）。
 * `@nestjs/swagger` 依赖的正是同一版 `@nestjs/mapped-types@2.1.1`，所以不会出现两份实现。
 *
 * ## ⚠️ `skipNullProperties: false` 不能省
 *
 * `PartialType` 默认给每个字段挂 `@IsOptional()`，而它的语义是 **null 也跳过校验** ——
 * 于是 `PATCH {"tags": null}` 会写进 `tags: null`，击穿 `UserDto.tags: string[]`。
 *
 * 源码（`@nestjs/mapped-types/dist/partial-type.helper.js`）里这个选项的语义是**反着的**：
 *
 * ```js
 * options.skipNullProperties === false
 *   ? applyValidateIfDefinedDecorator   // 只在 undefined 时跳过 ⇒ null 照常校验 ← 我们要的
 *   : applyIsOptionalDecorator;         // 默认：null / undefined 都跳过
 * ```
 *
 * 名字读作"是否**跳过** null 属性"，`false` = 不跳过 = null 也要过校验。
 */
export class UpdateUserDto extends PartialType(CreateUserDto, {
  skipNullProperties: false,
}) {}
