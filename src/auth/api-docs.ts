import type { FeatureDocs } from '@/swagger/api-docs.options';
import { LoginResponseDto } from './dto/login-response.dto';
import { ProfileDto } from './dto/profile.dto';

/**
 * 认证模块对 OpenAPI 的**自描述**。
 *
 * ## 为什么由业务模块自己声明（而不是文档层维护一张登记表）
 *
 * `@nestjs/swagger` 不会为"只出现在响应里"的模型自动建 `components.schemas`
 * （原因见 `FeatureDocs` 的注释）。所以必须有一份"响应模型登记表"。
 *
 * 它放在这里而不是 `src/swagger/`，是为了让依赖方向正确：
 * **业务 → 文档描述符**（业务知道自己的响应模型，这本来就该由它说），
 * 而不是 **文档 → 业务**（那会让新增一个业务模块必须去改 `src/swagger/`，
 * 也让文档层没法单独复用）。
 *
 * 组合根（`app.module.ts`）把本对象注入 `ApiDocsModule`；两个文档入口
 * （`/docs-json` 与 `pnpm openapi:export`）消费的是同一份。
 *
 * ⚠️ 新增"只作为响应出现"的 DTO 时必须加进 `responseModels`，否则文档里会是悬空
 * `$ref`（`openapi.e2e-spec.ts` 有通用守卫，漏加会直接变红）。
 */
export const AUTH_DOCS: FeatureDocs = {
  tag: {
    name: 'auth',
    description:
      '认证：`POST /auth/login` 用内存用户表换 JWT，`GET /auth/profile` 需要 Bearer token',
  },
  // ⚠️ 顺序即 components.schemas 的键顺序，不要重排
  responseModels: [LoginResponseDto, ProfileDto],
};
