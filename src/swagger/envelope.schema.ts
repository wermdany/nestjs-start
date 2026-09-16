import type { Type } from '@nestjs/common';
import { getSchemaPath, refs } from '@nestjs/swagger';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';

/**
 * 把运行时响应契约（`src/contract/response/response-contract.ts`）**投影**成 OpenAPI schema。
 *
 * 这里是整个 Swagger 接入里唯一需要"手写"的地方：契约是运行时行为（拦截器 / 过滤器），
 * TypeScript 类型没法自动变成 OpenAPI，所以信封壳子写一遍、被所有路由复用。
 * 改契约时**必须同步这个文件**（`swagger.e2e-spec.ts` 会断言关键结构）。
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

/** 失败信封的公共壳子：`{ success: false, error, message, errors? }`。 */
export const ERROR_ENVELOPE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['success', 'error', 'message'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string', example: 'Bad Request' },
    message: { type: 'string', example: 'Request validation failed' },
    errors: {
      description: '仅校验类失败才有（`field` 是权威定位，嵌套用点号）',
      type: 'array',
      items: { $ref: ERROR_DETAIL_REF },
    },
  },
};

/**
 * `errors[]` 元素的 schema。
 *
 * 与 `src/contract/validation/error-contract.ts` 的 `ErrorDetail` **同源但不同形态**：
 * 那边是运行时用的 TypeScript 类型，这边是 OpenAPI schema。
 * 之所以不在类上挂 `@ApiProperty` 让插件生成：契约层要保持**零 Swagger 依赖**。
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
 */
export const BAD_REQUEST_EXAMPLE = {
  success: false,
  error: 'Bad Request',
  message: 'Request validation failed',
  errors: [
    {
      field: 'name',
      message: 'name must be longer than or equal to 2 characters',
    },
  ],
};

export const NOT_FOUND_EXAMPLE = {
  success: false,
  error: 'Not Found',
  message: 'user 999999 not found',
};

export const CONFLICT_EXAMPLE = {
  success: false,
  error: 'Conflict',
  message: 'email neo@example.com already exists',
};

export const INTERNAL_EXAMPLE = {
  success: false,
  error: 'Internal Server Error',
  message: 'Internal server error',
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
