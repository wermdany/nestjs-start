import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidationOptions,
  type ValidatorConstraintInterface,
} from 'class-validator';

/** 禁止用作 `name` 的保留字。比较时忽略大小写与首尾空格。 */
const RESERVED_NAMES = ['admin', 'root', 'system'];

/**
 * class-validator 自定义约束的实现。
 *
 * 注意它**没有注入任何依赖**，所以不需要在 `main.ts` 里配容器。
 * 一旦给它加了构造函数依赖，就必须先从 `class-validator` 引入 `useContainer` 并在
 * `main.ts` 里绑定 Nest 容器（Nest 没有 `app.useContainer`）：
 *
 * ```ts
 * import { useContainer } from 'class-validator';
 * useContainer(app.select(AppModule), { fallbackOnErrors: true });
 * ```
 *
 * 否则 class-validator 会用 `new` 直接实例化它，依赖会是 undefined。
 */
@ValidatorConstraint({ name: 'isNotReservedName', async: false })
@Injectable()
export class IsNotReservedNameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    // 缺失/null 交给 @IsString() / @Length() 去报，避免这里再补一条
    // `name "undefined" is a reserved name` 这种误导性消息。
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value !== 'string') {
      return false;
    }

    return !RESERVED_NAMES.includes(value.trim().toLowerCase());
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} "${String(args.value)}" is a reserved name (${RESERVED_NAMES.join(', ')})`;
  }
}

/**
 * 属性装饰器：`@IsNotReservedName()`。
 * 与 `IsNotReservedNameConstraint` 放在同一个文件里，这是官方自定义校验器的组织方式。
 */
export function IsNotReservedName(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      constraints: [],
      validator: IsNotReservedNameConstraint,
    });
  };
}
