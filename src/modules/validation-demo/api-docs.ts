import type { FeatureDocs } from '@/swagger/api-docs.options';
import {
  IdsDto,
  ReceivedCheckedBodyDto,
  ReceivedPlainBodyDto,
  ReceivedRawBodyDto,
  StrictProbeResultDto,
} from './dto/webhook-response.dto';
import { UserDto } from './user.dto';

/**
 * `validation-demo` 模块对 OpenAPI 的**自描述**。
 *
 * 理由与形状见 `FeatureDocs` 的注释；同款实现见 `src/auth/api-docs.ts`。
 *
 * 本模块是**教学活文档**（把每种校验行为都跑一遍）。这份描述符是它与"生产文档"
 * 之间**唯一**的连接点 —— 组合根消费它，`src/swagger/` 完全不知道本模块存在。
 * 所以删掉本模块时，只需同步删掉 `app.module.ts` 里 `VALIDATION_DEMO_DOCS` 那一项。
 *
 * ⚠️ 顺序即 `components.schemas` 的键顺序，不要重排。
 */
export const VALIDATION_DEMO_DOCS: FeatureDocs = {
  tag: {
    name: 'validation-demo',
    description: '参数校验 / 响应契约的活文档（内存版 users 资源）',
  },
  responseModels: [
    UserDto,
    IdsDto,
    StrictProbeResultDto,
    ReceivedCheckedBodyDto,
    ReceivedRawBodyDto,
    ReceivedPlainBodyDto,
  ],
};
