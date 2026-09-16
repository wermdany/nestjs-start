import { ApiProperty } from '@nestjs/swagger';

/**
 * 字段级明细。失败响应（由 `AppExceptionFilter` 产出）里 `errors[]` 的元素：
 *
 * ```json
 * {
 *   "success": false,
 *   "error": "Bad Request",
 *   "message": "Request validation failed",
 *   "errors": [
 *     { "field": "address.city", "message": "city must be longer than or equal to 2 characters" }
 *   ]
 * }
 * ```
 *
 * 各字段的分工：
 *
 * | 字段 | 给谁用 |
 * | --- | --- |
 * | HTTP 状态行 | 代理 / 缓存 / 监控（**数字状态码只在状态行里**） |
 * | `error` | HTTP 状态短语 |
 * | `message` | 人类可读说明 |
 * | `errors[].field` | **前端映射到表单字段**（嵌套用点号：`address.city`） |
 * | `errors[].message` | 终端用户 |
 *
 * 完整契约（成功侧 `{ success, data, meta? }`）见 `../response/response-contract.ts`。
 * 本文件只放类型，不放实现 —— 过滤器（`./http-exception.filter`）与响应拦截器都依赖它。
 *
 * ⚠️ **本契约有意不含机器可读的错误码（`code`）。** 代价是前端只能用
 * `error` + `message` 区分具体错误（比如 409 的"邮箱重复"和别的冲突）。
 * AIP-193 对此有明确警告：一旦客户端开始 parse message，文案就变成事实上的契约、
 * 以后不能改 —— 所以真要加 `code`，越早加越便宜。见 `docs/validation.md` §9.4。
 */
export class ErrorDetail {
  /** 出问题的字段路径，嵌套时用点号：`address.city`。 */
  @ApiProperty({
    description: '出问题的字段路径，嵌套时用点号',
    example: 'address.city',
  })
  field: string;

  /** 人类可读说明。 */
  @ApiProperty({
    description: '人类可读说明（具体规则看这里，message 只给概述）',
    example: 'city must be longer than or equal to 2 characters',
  })
  message: string;
}

/**
 * 失败响应的形状（由 `AppExceptionFilter` 产出）。
 *
 * 与 `../response/response-contract.ts` 的 `ErrorBody` 是**同一形状的两个名字**，
 * 刻意如此：这个文件是"错误侧"读代码时的本地上下文，`ResponseBody` 是"整体契约"的入口。
 *
 * 注意**没有** `statusCode`：数字状态码只由 HTTP 状态行表达（过滤器用 `response.status(...)` 设置）。
 */
export interface ApiErrorBody {
  /** 判据：失败恒为 `false`（成功侧见 `SuccessBody.success`）。 */
  success: false;
  /** HTTP 状态的短语，如 `Bad Request`。 */
  error: string;
  /** 人类可读说明（校验失败时是固定概述，细节在 `errors[]`）。 */
  message: string;
  /** 字段级明细，只有校验类错误才有。 */
  errors?: ErrorDetail[];
}
