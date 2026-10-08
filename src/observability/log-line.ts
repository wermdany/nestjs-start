import type { LogLevel } from '@nestjs/common';

/**
 * 日志行的**构造**（纯函数，无 I/O）—— 之所以把它从 logger 里拆出来，
 * 是因为"输出"很难测而"生成一行"很好测：级别过滤、字段注入、脱敏、截断
 * 全都能用喂对象 + 断言的方式钉住。
 */

/** 级别从低到高；`LOG_LEVEL=warn` 表示"warn 及以上才输出"。 */
export const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * 键名命中它的字段值会被替换成 {@link REDACTED}（大小写不敏感，**递归**生效）。
 *
 * 这是"最后一道兜底"：调用方本该只写自己明确选择暴露的字段，
 * 但人总会手滑把 `headers` / `dto` 整个丢进来 —— 日志比请求更不该泄漏凭证。
 */
export const SENSITIVE_KEY = /authorization|cookie|password|secret|token/i;

export const REDACTED = '[redacted]';

/** 单个值 / 序列化结果的最大长度：一条日志不该把文件撑爆。 */
export const MAX_VALUE_LENGTH = 2_000;

/** 堆栈单独放宽上限（它本来就长，但也不该无限）。 */
export const MAX_STACK_LENGTH = 8_000;

/** 结构化日志行的形状 —— 也就是**文件里每一行的 JSON**。 */
export interface LogLine {
  time: string;
  level: LogLevel;
  msg: string;
  context?: string;
  /** 与响应头 `x-request-id`、失败信封的 `traceId` 是同一个值。 */
  traceId?: string;
  /** JWT 的 `sub`（守卫在认证成功后写进请求上下文）。 */
  userId?: string;
  stack?: string;
  [key: string]: unknown;
}

export interface LogLineInput {
  level: LogLevel;
  message: unknown;
  context?: string;
  /** 请求级信息；通常直接来自 `getRequestContext()`。 */
  request?: { requestId?: string; userId?: string };
  stack?: string;
  /** 调用方附加的结构化字段（会被脱敏）。 */
  fields?: Record<string, unknown>;
  /** 注入时间，便于测试。 */
  now?: Date;
}

/** 保留字段：调用方字段里同名的会被忽略（见 `buildLogLine` 的注释）。 */
const RESERVED_KEYS = new Set([
  'time',
  'level',
  'msg',
  'context',
  'traceId',
  'userId',
  'stack',
]);

/** `LOG_LEVEL=warn` 时 `log` / `debug` / `verbose` 直接丢弃。 */
export function isLevelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[threshold];
}

function truncate(text: string, maxLength = MAX_VALUE_LENGTH): string {
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}…[truncated]`
    : text;
}

/**
 * 兜底序列化：**永不抛**。
 *
 * 三条保护：敏感键脱敏、循环引用标记、超长截断。日志写不出来不能成为
 * 请求失败的原因，所以这里连 `JSON.stringify` 的异常也要吞掉。
 */
export function safeStringify(
  value: unknown,
  maxLength = MAX_VALUE_LENGTH,
): string {
  const seen = new WeakSet<object>();
  let text: string;

  try {
    const json = JSON.stringify(value, (key, item: unknown) => {
      if (SENSITIVE_KEY.test(key)) {
        return REDACTED;
      }

      if (typeof item === 'bigint') {
        return item.toString();
      }

      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) {
          return '[circular]';
        }

        seen.add(item);
      }

      return item;
    });

    text = json ?? fallbackText(value);
  } catch {
    text = fallbackText(value);
  }

  return truncate(text, maxLength);
}

/**
 * 兜底字符串化：只对"一定有直观文本"的类型用 `String()`；
 * 对象/函数给类型标记，而不是 `[object Object]` 这种没有信息量的东西。
 * （`@typescript-eslint/no-base-to-string` 挡的正是后者。）
 */
function fallbackText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return '[function]';
    case 'object':
      return value === null ? 'null' : '[object]';
    default:
      return 'undefined';
  }
}

/** 值 → 字符串：字符串原样、Error 取 message、其它走 safeStringify。 */
export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return truncate(value);
  }

  if (value instanceof Error) {
    return truncate(value.message);
  }

  return safeStringify(value);
}

/** 单个字段：敏感键脱敏，Error 取堆栈，对象走序列化，其余原样。 */
export function sanitizeField(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return REDACTED;
  }

  if (typeof value === 'string') {
    return truncate(value);
  }

  if (value instanceof Error) {
    return truncate(value.stack ?? value.message, MAX_STACK_LENGTH);
  }

  if (typeof value === 'object' && value !== null) {
    return safeStringify(value);
  }

  return value;
}

/**
 * 拼一行日志。
 *
 * 顺序是刻意的：先摊开调用方字段，再写**保留字段** —— 于是 `time` / `level` /
 * `msg` 这类恒有字段不可能被调用方覆盖掉（契约比方便重要）。
 *
 * `traceId` / `userId` 的取值顺序是"请求上下文优先，调用方字段兜底"：
 * 访问日志在 `res.on('finish')` 里打，那时 `AsyncLocalStorage` 已经不在作用域内，
 * 所以它只能从请求对象上取 id 再**显式**作为字段传进来。
 */
export function buildLogLine(input: LogLineInput): LogLine {
  const fields = input.fields ?? {};
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }

    sanitized[key] = sanitizeField(key, value);
  }

  const traceId = firstNonEmpty(input.request?.requestId, fields.traceId);
  const userId = firstNonEmpty(input.request?.userId, fields.userId);
  const message =
    input.message instanceof Error ? input.message.message : input.message;

  return {
    ...sanitized,
    time: (input.now ?? new Date()).toISOString(),
    level: input.level,
    msg: stringifyValue(message),
    ...(input.context ? { context: input.context } : {}),
    ...(traceId ? { traceId } : {}),
    ...(userId ? { userId } : {}),
    ...(input.stack ? { stack: truncate(input.stack, MAX_STACK_LENGTH) } : {}),
  };
}

function firstNonEmpty(...candidates: unknown[]): string | undefined {
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0,
  );
}

/**
 * 一行文本。
 *
 * - `pretty=false`（文件里**永远**是这个）：单行 JSON，便于 `jq` 与采集器；
 * - `pretty=true`（开发环境的 stdout）：人读得下去的一行摘要。
 *
 * "文件永远 JSON、pretty 只作用于终端"是刻意的：机器产物不该因人而异。
 */
export function serializeLine(line: LogLine, pretty: boolean): string {
  if (!pretty) {
    return JSON.stringify(line);
  }

  const head = [
    line.time,
    line.level.toUpperCase().padEnd(5),
    line.traceId ? `[${line.traceId}]` : '',
    line.context ? `[${line.context}]` : '',
    line.msg,
  ]
    .filter(Boolean)
    .join(' ');

  const extras: string[] = [];

  if (line.userId) {
    extras.push(`userId=${line.userId}`);
  }

  for (const [key, value] of Object.entries(line)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }

    extras.push(
      `${key}=${typeof value === 'string' ? value : safeStringify(value, 200)}`,
    );
  }

  if (line.stack) {
    // 只取第一帧：终端里堆栈全展开会把别的日志挤走，完整堆栈在文件里。
    const frame = line.stack.split('\n')[1]?.trim() ?? '';
    extras.push(`at=${frame}`);
  }

  return extras.length > 0 ? `${head} ${extras.join(' ')}` : head;
}
