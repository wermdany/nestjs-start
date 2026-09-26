import { ValidateIf } from 'class-validator';

/**
 * 「可以不给，但给了就不能是 `null`」—— 用来替代 `@IsOptional()` 的默认语义。
 *
 * ## 为什么需要它
 *
 * class-validator 的 `@IsOptional()` 官方语义是"值为 `null` **或** `undefined` 时
 * 跳过该属性上的**所有**校验"，很多人误以为它的意思是"字段可以不存在"。后果是：
 *
 * ```http
 * PATCH /users/1  {"tags": null}   # @IsOptional() @IsArray() → 全部跳过 → 通过
 * ```
 *
 * 于是响应里出现 `"tags": null`，而 DTO / OpenAPI 里 `tags` 是
 * `string[]`（required，非 nullable）—— **运行时响应违反了自己发布的 schema**。
 * 按"键集"断言的契约测试照不到它（键没变，值错了）。
 *
 * ## 它做的事
 *
 * `@ValidateIf((_o, value) => value !== undefined)`：缺席（`undefined`）跳过校验，
 * 显式 `null` **照常校验** ⇒ `@IsArray()` / `@IsInt()` 会把它打成 400。
 *
 * ```ts
 * @IsOptionalNotNull() @IsArray() tags?: string[];
 * ```
 *
 * ⚠️ 如果某个字段的业务语义**就是**"显式传 null = 清空"，不要用它：
 * 那种情况应该把类型写成 `T | null`、在 Swagger 上标 `nullable: true`，并让 service 显式处理。
 * 两种语义混用才是真正的坑。
 */
export const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object, value: unknown) => value !== undefined);
