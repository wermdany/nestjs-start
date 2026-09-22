import type { Type } from '@nestjs/common';
import { getSchemaPath, refs } from '@nestjs/swagger';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';
import { ERROR_LOCATIONS, ErrorCode } from '@/contract';

/**
 * 把运行时响应契约**投影**成 OpenAPI schema。
 *
 * 这里是整个 Swagger 接入里唯一需要"手写"的地方：契约是运行时行为（拦截器 / 过滤器），
 * TypeScript 类型没法自动变成 OpenAPI，所以信封壳子写一遍、被所有路由复用。
 *
 * **为什么现在还是手写**（契约层的 `ErrorDetail` 已经变成纯类型了）：
 * 契约层刻意**零 Swagger 依赖** —— 它的类型定义在 `@nest-start/api-contract`
 * （前后端共享、无任何依赖）。所以 OpenAPI 这边只有两条路：
 *
 * - 在契约层挂 `@ApiProperty` 让插件生成 ⇒ 共享包被文档工具绑住（否决）；
 * - **手写 schema + 一条一致性守卫**（现在这条）⇒ `swagger.e2e-spec.ts` 里有一条
 *   "schema 属性 ↔ 运行时 `errors[]` 键集"的双向断言，改了一边不改另一边就红。
 *
 * `code` / `location` 的**取值**仍然来自契约层（`ErrorCode` / `ERROR_LOCATIONS`），
 * 只有结构是手写的 —— 也就是说枚举不会漂移，漂移的只可能是"少写一个字段"，而那正好被守卫盯住。
 *
 * 控制器**不直接**碰这个文件：它只写 `@ApiOkEnvelope(UserDto, '…')` 这样的薄装饰器，
 * 拼 `allOf` / `$ref` 的活都在这里（见 `api-envelope.decorator.ts`）。
 */
export const RESPONSE_ENVELOPE_REF = '#/components/schemas/ResponseEnvelope';
export const ERROR_ENVELOPE_REF = '#/components/schemas/ErrorEnvelope';
export const ERROR_DETAIL_REF = '#/components/schemas/ErrorDetail';

/** 被包在信封里的 `data` 的形状：单个模型 / 模型数组（元组写法）/ 空（`null`）。 */
export type WrappedData = Type<unknown> | [Type<unknown>] | 'null';

/** 成功信封的公共壳子：`{ success: true, data, meta? }`。 */
export const RESPONSE_ENVELOPE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: { description: 'handler 的返回值（分页时是这一页的数据数组）' },
    meta: {
      description: '仅分页成功时出现',
      type: 'object',
      required: ['totalItems', 'itemsPerPage', 'currentPage'],
      properties: {
        totalItems: { type: 'integer', example: 3 },
        itemsPerPage: { type: 'integer', example: 50 },
        currentPage: { type: 'integer', example: 1 },
      },
    },
  },
};

/** 失败信封的公共壳子：`{ success: false, error, message, code?, traceId?, errors? }`。 */
export const ERROR_ENVELOPE_SCHEMA: SchemaObject = {
  type: 'object',
  // `code` / `traceId` **不在** required 里：框架自身抛的错可能没有业务 code，
  // 而请求 id 中间件跑在 body 解析之后 —— body 解析失败的 400 就没有 traceId。
  required: ['success', 'error', 'message'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string', example: 'Bad Request' },
    message: { type: 'string', example: 'Request validation failed' },
    code: {
      description:
        '机器可读的错误码（前端 `switch` 这个，不要 parse `message`）。框架自身抛的错可能没有。',
      type: 'string',
      enum: [...Object.values(ErrorCode)],
      example: ErrorCode.VALIDATION_FAILED,
    },
    traceId: {
      description:
        '请求 id：同时回写在 `x-request-id` 响应头、并写进服务端日志，用来把一次响应和日志对上。',
      type: 'string',
      example: '3f1c9a4e-6b0a-4e2f-9a1d-6a1b1c2d3e4f',
    },
    errors: {
      description: '仅校验类失败才有（`field` 是权威定位，嵌套用点号）',
      type: 'array',
      items: { $ref: ERROR_DETAIL_REF },
    },
  },
};

/**
 * `errors[]` 元素的 schema（结构手写，**枚举取值来自契约层**）。
 *
 * 与 `@nest-start/api-contract` 的 `ErrorDetail` 是"同源但不同形态"：
 * 那边是运行时用的 TypeScript 类型，这边是 OpenAPI schema。
 * `swagger.e2e-spec.ts` 的守卫会拿真实的校验失败响应来比对这个结构。
 */
export const ERROR_DETAIL_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['field', 'message'],
  properties: {
    field: {
      type: 'string',
      description: '出问题的字段路径，嵌套时用点号',
      example: 'address.city',
    },
    message: {
      type: 'string',
      description: '人类可读说明（`message` 只给概述，具体规则看这里）',
      example: 'city must be longer than or equal to 2 characters',
    },
    location: {
      description:
        '这个字段路径来自哪里（`@Body()` / `@Query()` / `@Param()` 各不同）。同名不同源时靠它区分。',
      type: 'string',
      enum: [...ERROR_LOCATIONS],
      example: 'body',
    },
    code: {
      description:
        '字段级的机器可读错误码（语义化，不是 class-validator 的约束名）',
      type: 'string',
      enum: [...Object.values(ErrorCode)],
      example: ErrorCode.INVALID_LENGTH,
    },
  },
};

/**
 * 这些 schema 必须**手工注入** `components.schemas`（见 `setup-swagger.ts`）：
 * `$ref` 只是个字符串，`createDocument()` 不会为它去推导组件，缺了它们
 * Swagger UI 上会是"解析不到的定义"。
 */
export const ENVELOPE_COMPONENT_SCHEMAS = {
  ResponseEnvelope: RESPONSE_ENVELOPE_SCHEMA,
  ErrorEnvelope: ERROR_ENVELOPE_SCHEMA,
  ErrorDetail: ERROR_DETAIL_SCHEMA,
} as const;

/**
 * 失败响应的示例，**集中在这里**（而不是每条路由各写一遍）。
 *
 * 为什么失败侧保留示例：`errors[]` 的结构化形态对使用者信息量很大，
 * UI 里有一个可直接复制的样例值得；成功侧的示例则由 DTO 字段上的 `@ApiProperty`
 * 自动合成，不需要（也不该）在控制器里再抄一遍。
 *
 * `traceId` 用一个固定假值：它是每次请求都不同的运行时值，示例里写 `…` 反而不好复制。
 */
export const BAD_REQUEST_EXAMPLE = {
  success: false,
  error: 'Bad Request',
  message: 'Request validation failed',
  code: ErrorCode.VALIDATION_FAILED,
  traceId: '3f1c9a4e-6b0a-4e2f-9a1d-6a1b1c2d3e4f',
  errors: [
    {
      field: 'name',
      location: 'body',
      code: ErrorCode.INVALID_LENGTH,
      message: 'name must be longer than or equal to 2 characters',
    },
  ],
};

export const NOT_FOUND_EXAMPLE = {
  success: false,
  error: 'Not Found',
  message: 'user 999999 not found',
  code: ErrorCode.USER_NOT_FOUND,
  traceId: '3f1c9a4e-6b0a-4e2f-9a1d-6a1b1c2d3e4f',
};

export const CONFLICT_EXAMPLE = {
  success: false,
  error: 'Conflict',
  message: 'email neo@example.com already exists',
  code: ErrorCode.EMAIL_ALREADY_EXISTS,
  traceId: '3f1c9a4e-6b0a-4e2f-9a1d-6a1b1c2d3e4f',
};

export const INTERNAL_EXAMPLE = {
  success: false,
  error: 'Internal Server Error',
  message: 'Internal server error',
  code: ErrorCode.INTERNAL_ERROR,
  traceId: '3f1c9a4e-6b0a-4e2f-9a1d-6a1b1c2d3e4f',
};

/**
 * 把某个模型（或模型数组 / `null`）包进成功信封，生成 `allOf` 组合：
 *
 * ```
 * { allOf: [ { $ref: '#/components/schemas/ResponseEnvelope' },
 *            { properties: { data: { $ref: ... } } } ] }
 * ```
 *
 * `data` 的 `$ref` 用官方的 `getSchemaPath()` / `refs()` 生成，不自己拼字符串 ——
 * 数组必须写成 `{ type: 'array', items: { $ref } }`，**不能**用 `@ApiResponse({ type: [Dto] })`
 * 那套简写（那是"整个响应是数组"的语义，不是"信封里的 data 是数组"）。
 */
export function buildEnvelopeSchema(
  data: WrappedData,
): SchemaObject & { allOf: unknown[] } {
  const dataSchema: SchemaObject | ReferenceObject =
    data === 'null'
      ? { type: 'object', nullable: true, example: null }
      : Array.isArray(data)
        ? { type: 'array', items: { $ref: getSchemaPath(data[0]) } }
        : refs(data)[0];

  return {
    allOf: [
      { $ref: RESPONSE_ENVELOPE_REF },
      { type: 'object', required: ['data'], properties: { data: dataSchema } },
    ],
  };
}
