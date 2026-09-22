import type { ErrorCode as ErrorCodeUnion } from '@nest-start/api-contract';

/**
 * `ErrorCode` 的**值对象**（前端消费的是 `@nest-start/api-contract` 里的联合类型）。
 *
 * 为什么类型在包里、值在这里：契约包要求**零运行时导出**（这样服务端 import 它会被完全擦除，
 * 运行时不必先构建它）。所以联合类型是唯一事实来源，值对象只是它的一个可枚举镜像，
 * 并且下面有一句**编译期断言**保证两者不会漂移。
 *
 * ⚠️ 这些字符串是**对外契约**：可以新增，不能改名。
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  REQUIRED: 'REQUIRED',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_LENGTH: 'INVALID_LENGTH',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  NOT_ALLOWED_VALUE: 'NOT_ALLOWED_VALUE',
  RESERVED_NAME: 'RESERVED_NAME',
  TOO_MANY_ITEMS: 'TOO_MANY_ITEMS',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  UNKNOWN_CONSTRAINT: 'UNKNOWN_CONSTRAINT',
} as const;

/**
 * 对外暴露的类型就是共享契约里的那个联合类型（不是 `typeof ErrorCode[...]`）——
 * 这样"包里加了新成员、这里忘了加"能被下面的断言抓住，而不是被 `typeof` 悄悄吸收。
 */
export type ErrorCode = ErrorCodeUnion;

/**
 * 编译期穷尽性断言：值对象必须覆盖联合类型的**每一个**成员。
 * 往 `@nest-start/api-contract` 的 `ErrorCode` 里加成员却忘了在这里加 —— 构建直接失败。
 */
type UncoveredErrorCode = Exclude<
  ErrorCodeUnion,
  (typeof ErrorCode)[keyof typeof ErrorCode]
>;
const assertErrorCodeCovered: UncoveredErrorCode extends never ? true : never =
  true;
void assertErrorCodeCovered;

const KNOWN_ERROR_CODES = new Set<string>(Object.values(ErrorCode));

/** 判断一个来自运行时载荷的值是不是合法的错误码（跨信任边界时要先过这一关）。 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value);
}

/**
 * class-validator 的**约束名 → 语义 code** 映射。
 *
 * 为什么要这层映射：`constraints` 的 key 是**库的实现细节**（`isInt` / `min` / `matches`），
 * 换到 Zod、Valibot 或自研校验器就全变了。对外只承诺语义，换库只需改这张表。
 *
 * 加了自己的自定义校验器就顺手在这里加一行 —— 忘了也不会静默：会落到
 * `UNKNOWN_CONSTRAINT`，那也是"该补映射表了"的信号。
 */
export const VALIDATION_CONSTRAINT_CODES: Readonly<Record<string, ErrorCode>> =
  {
    // 必填
    isDefined: ErrorCode.REQUIRED,
    isNotEmpty: ErrorCode.REQUIRED,
    isNotEmptyObject: ErrorCode.REQUIRED,
    // 类型
    isString: ErrorCode.INVALID_TYPE,
    isNumber: ErrorCode.INVALID_TYPE,
    isInt: ErrorCode.INVALID_TYPE,
    isBoolean: ErrorCode.INVALID_TYPE,
    isArray: ErrorCode.INVALID_TYPE,
    isObject: ErrorCode.INVALID_TYPE,
    isDate: ErrorCode.INVALID_TYPE,
    // 白名单取值
    isIn: ErrorCode.NOT_ALLOWED_VALUE,
    isEnum: ErrorCode.NOT_ALLOWED_VALUE,
    // 格式
    isEmail: ErrorCode.INVALID_FORMAT,
    isUrl: ErrorCode.INVALID_FORMAT,
    isUuid: ErrorCode.INVALID_FORMAT,
    matches: ErrorCode.INVALID_FORMAT,
    // 长度
    isLength: ErrorCode.INVALID_LENGTH,
    minLength: ErrorCode.INVALID_LENGTH,
    maxLength: ErrorCode.INVALID_LENGTH,
    // 数值区间
    min: ErrorCode.OUT_OF_RANGE,
    max: ErrorCode.OUT_OF_RANGE,
    // 数组
    arrayMaxSize: ErrorCode.TOO_MANY_ITEMS,
    arrayMinSize: ErrorCode.TOO_MANY_ITEMS,
    arrayUnique: ErrorCode.TOO_MANY_ITEMS,
    // 自定义（约束名取自 `@ValidatorConstraint({ name })`）
    isNotReservedName: ErrorCode.RESERVED_NAME,
    // `forbidNonWhitelisted: true` 时 class-validator 用它报"多了字段"
    whitelistValidation: ErrorCode.UNKNOWN_FIELD,
  };

/** 查一个约束名对应的语义 code；没登记就返回 `UNKNOWN_CONSTRAINT`。 */
export function codeOfConstraint(constraint: string): ErrorCode {
  return (
    VALIDATION_CONSTRAINT_CODES[constraint] ?? ErrorCode.UNKNOWN_CONSTRAINT
  );
}
