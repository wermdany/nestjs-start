import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { REQUEST_ID_PROP } from '@/system/request-context';
import { AppLogger } from './app-logger';

interface RequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  [REQUEST_ID_PROP]?: string;
}

interface ResponseLike {
  statusCode?: number;
  on: (event: 'finish', listener: () => void) => void;
}

/**
 * 访问日志：每个请求一条，带 `method` / `url` / `status` / `durationMs` / `traceId`。
 *
 * ## 为什么 id 在 `finish` 回调里才读
 *
 * `res.on('finish')` 触发时，`AsyncLocalStorage` 的请求上下文**已经不在作用域内**了
 * （那是 HTTP 服务器事件循环里的另一个回调），所以 `getRequestId()` 拿不到东西。
 * 但 request-id 中间件早就在请求对象上写了 `REQUEST_ID_PROP`（它注释里写着
 * "过滤器靠它兜底取 id"）—— 这里正是同一个兜底思路。
 *
 * 好处不只是"能拿到"：**两个中间件的注册顺序变得无关紧要**。哪怕访问日志先跑，
 * finish 回调执行时 request-id 中间件早已跑完并把 id 写在请求对象上了。
 *
 * ## 级别
 *
 * 5xx → `error`、4xx → `warn`、其余 → `log`。这样"错误率"看板直接筛 `level=error`，
 * 而 404 扫描器不会把告警刷爆。
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: RequestLike, res: ResponseLike, next: () => void): void {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const status = res.statusCode ?? 0;
      const durationMs =
        Math.round(Number(process.hrtime.bigint() - startedAt) / 1e4) / 100;

      this.logger[levelFor(status)]('request completed', {
        method: req.method ?? '?',
        url: req.originalUrl ?? req.url ?? '?',
        status,
        durationMs,
        // 显式带上：finish 时 ALS 已失效（见类注释）；ALS 有值时以它为准。
        traceId: req[REQUEST_ID_PROP],
      });
    });

    next();
  }
}

function levelFor(status: number): 'error' | 'warn' | 'log' {
  if (status >= 500) {
    return 'error';
  }

  return status >= 400 ? 'warn' : 'log';
}
