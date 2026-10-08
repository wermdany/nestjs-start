import { registerAs } from '@nestjs/config';
import {
  DEFAULT_LOG_DIR,
  DEFAULT_LOG_FILE,
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_NODE_ENV,
  defaultLogLevelFor,
  isLogLevelName,
  isNodeEnv,
  toBoolean,
  toInt,
  toOptionalString,
} from './env';
import type { EnvSource, LogLevelName } from './env';

/**
 * 日志配置（`config.getOrThrow<LogConfig>('log')`）。
 *
 * | 字段 | 来源 | 默认 | 说明 |
 * | --- | --- | --- | --- |
 * | `level` | `LOG_LEVEL` | dev=`debug` / test=`warn` / prod=`log` | 输出阈值 |
 * | `toFile` | `LOG_TO_FILE` | 非 test=`true` / test=`false` | 是否写本地文件 |
 * | `dir` | `LOG_DIR` | `logs` | 目录（自动创建） |
 * | `file` | `LOG_FILE` | `app.log` | 活动文件名 |
 * | `maxBytes` | `LOG_MAX_BYTES` | 10MB | 超过即滚动（0 = 只按天） |
 * | `maxFiles` | `LOG_MAX_FILES` | 5 | 保留的历史文件数 |
 * | `pretty` | ——（由 `NODE_ENV` 推导） | 非 production=`true` | **只影响 stdout**，文件永远是 JSON |
 *
 * 两个刻意的默认值：**测试环境不落盘**（不污染仓库、不让写盘拖慢测试），
 * 以及**测试环境默认 `warn`**（`pnpm test:e2e` 的输出保持干净）。
 */
export interface LogConfig {
  level: LogLevelName;
  toFile: boolean;
  dir: string;
  file: string;
  maxBytes: number;
  maxFiles: number;
  pretty: boolean;
}

export function readLogConfig(env: EnvSource = process.env): LogConfig {
  const nodeEnv = isNodeEnv(env.NODE_ENV) ? env.NODE_ENV : DEFAULT_NODE_ENV;

  return {
    level: isLogLevelName(env.LOG_LEVEL)
      ? env.LOG_LEVEL
      : defaultLogLevelFor(nodeEnv),
    toFile: toBoolean(env.LOG_TO_FILE, nodeEnv !== 'test'),
    dir: toOptionalString(env.LOG_DIR) ?? DEFAULT_LOG_DIR,
    file: toOptionalString(env.LOG_FILE) ?? DEFAULT_LOG_FILE,
    maxBytes: toInt(env.LOG_MAX_BYTES, DEFAULT_LOG_MAX_BYTES),
    maxFiles: toInt(env.LOG_MAX_FILES, DEFAULT_LOG_MAX_FILES),
    pretty: nodeEnv !== 'production',
  };
}

export const logConfig = registerAs('log', () => readLogConfig(process.env));
