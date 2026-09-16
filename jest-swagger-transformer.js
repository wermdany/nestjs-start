/**
 * 给 **ts-jest** 用的 `@nestjs/swagger` 插件桥。
 *
 * 为什么需要它：`nest build` 会跑 `@nestjs/swagger` 的 AST 变换（见 `nest-cli.json` 的
 * `compilerOptions.plugins`），但 jest 走的是 ts-jest、在内存里编译，**不会**应用 Nest CLI 的插件。
 * 不接这一步的话，e2e 里 `SwaggerModule.createDocument()` 生成的 schema 会是空的 ——
 * 文档与校验规则就不再同源，而测试却看不出问题。
 *
 * 写法照 Nest 官方文档（jest ^29 的新版 `transform` 形式）：
 * `module.exports.factory` 收到 ts-jest 的 compiler service，返回插件的 `before` 变换器。
 *
 * ⚠️ 改了下面的配置就要**递增 `version`** —— jest 只认这个数字来判断配置变了、需要清缓存。
 */
const transformer = require('@nestjs/swagger/plugin');

module.exports.name = 'nestjs-swagger-transformer';
module.exports.version = 1;

/** @param {{ program: import('typescript').Program }} cs */
module.exports.factory = (cs) => transformer.before({}, cs.program);
