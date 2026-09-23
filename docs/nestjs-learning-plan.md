# NestJS 基础学习计划（基于 nestjs-start 仓库 · 不含数据库）

> **骨架**来自官方文档 [docs.nestjs.com](https://docs.nestjs.com) 的章节顺序，不自创章节。
> **范围**：NestJS **框架基础**。数据库（TypeORM / Prisma / Mongoose）、GraphQL、微服务、消息队列按 §6 明确跳过。
> **建议周期**：4 周，每周 5–8 小时。
>
> ⚠️ 官方文档链接以站点侧边栏为准；若某个 slug 有调整，按章节名在侧边栏里找同名条目即可。
>
> 📌 **动手前先读 [`learning-next.md`](learning-next.md)**：本仓库已经把 §2.5 / §2.6 / §2.8 /
> §3.1–3.3 / §5.1 / §5.2 / §5.5 / §5.6 做成了生产级实现，那几章的正确用法是**读代码 + 答自测题**，
> 照下面的练习重做是降级。那份文件按投入产出比重排了真正还没做的事，并给出验收命令。

---

## 0. 使用说明

### 0.1 适合谁

会一点 TypeScript、想系统学 NestJS，但**暂时不想碰数据库**的人。本计划覆盖「能独立写出一个带校验、鉴权、统一错误处理和测试的 REST 服务」所需的全部框架知识。

### 0.2 前置知识

- TypeScript：类、接口、泛型、可选属性、`readonly`、类型断言 —— 能读写即可。
- 装饰器语法：不要求会自己实现装饰器，但必须能读懂 `@Controller()`、`@Injectable()` 这类写法，并知道它作用在类/方法/参数上。
- `async/await` 与 Promise。
- Node.js 与 HTTP 基础：知道请求方法、状态码、请求头/响应头、JSON body。
- RxJS：**不必先系统学**。第 1 周学 Interceptors 时，认识 `Observable`、`pipe`、`map`、`tap`、`catchError` 就够了。

### 0.3 本仓库环境快照（已实测）

| 项目 | 实测值 | 说明 |
| --- | --- | --- |
| NestJS | `@nestjs/common` ^11.0.17 / `core` ^11.0.1 / `platform-express` ^11.1.11 | 主版本 **11** |
| 底层 HTTP | Express **5.2.1** | 注意 Express 5 的路由通配符变化，见 §2.1 |
| Nest CLI | 11.0.24 | `npx nest` 可用；`@nestjs/schematics` 已装，`nest g` 离线可用 |
| 运行时 | Node **v25.9.0**、npm 11.12.1、pnpm 11.8.0 | `engines` 要求 node>=20 / npm>=10 |
| 模块系统 | `package.json` **没有** `"type"` 字段 | 因此编译目标是 **CommonJS**，相对导入可省略扩展名 |
| TS 关键项 | `module`/`moduleResolution`=`nodenext`、`experimentalDecorators`、`emitDecoratorMetadata`、`isolatedModules`、`target` ES2023 | 装饰器与 DI 能工作的前提 |
| 源码 | `src/main.ts`、`src/app.module.ts`、`src/app.controller.ts`、`src/app.service.ts` | 只有 4 个文件 |
| 测试 | `src/app.controller.spec.ts`（单元）、`test/app.e2e-spec.ts` + `test/jest-e2e.json`（e2e） | 当前 **1 单元 + 1 e2e 全绿** |
| 学习用包 | `@nestjs/config`、`@nestjs/swagger`、`class-validator`、`class-transformer`、`@nestjs/cache-manager`、`helmet`、`@nestjs/throttler` 等**均未安装** | 到 §5 再按需安装 |

### 0.4 每章的固定结构

| 段落 | 含义 |
| --- | --- |
| 🎯 知识点 | 这一章必须掌握的概念清单 |
| 🔍 本仓库对照 | 概念在本仓库里对应哪个文件、哪一行、哪条命令 |
| 🛠 练习任务 | `- [ ]` 复选框，**由你自己动手执行**；本文件本身不包含示例代码改动 |
| ✅ 自测标准 | 能达到什么程度算过关 |

### 0.5 进度怎么记

复选框是标准 GFM 任务列表，在 GitHub、VS Code、Typora 里都能直接勾选。也可以在仓库根目录数进度：

```bash
grep -c '^- \[x\]' docs/nestjs-learning-plan.md   # 已完成
grep -c '^- \[ \]' docs/nestjs-learning-plan.md   # 未完成
```

### 0.6 节奏建议

| 周 | 内容 | 对应章节 |
| --- | --- | --- |
| 第 0 周（半天） | 基线与工具链 | §1 |
| 第 1 周 | 核心十章（Overview） | §2 |
| 第 2 周 | Fundamentals 关键基础 | §3 |
| 第 3 周 | Testing 实战 | §4 |
| 第 4 周 | 常用非数据库技巧（选学） | §5 |

---

## 1. 第 0 周：基线与工具链

📖 官方文档：[First steps](https://docs.nestjs.com/first-steps) · [CLI usage](https://docs.nestjs.com/cli/usages)

### 🎯 知识点

- Nest 的分层心智：**Module 是组织单元，Controller 管路由，Provider 管逻辑**。
- `nest` CLI 的作用：生成代码、启动、构建。`nest g` 是学习期最高频的工具。
- `package.json` 每条 script 到底做了什么。
- `nest-cli.json` / `tsconfig.json` / `eslint.config.mjs` / `.prettierrc` 各自负责什么。
- 为什么必须有 `experimentalDecorators` + `emitDecoratorMetadata`，以及 `reflect-metadata` 从哪来。
- `isolatedModules: true` 与 `nodenext` 带来的两个具体约束。

### 🔍 本仓库对照

**`package.json` scripts（逐条）**

| script | 实际命令 | 什么时候用 |
| --- | --- | --- |
| `start` | `nest start` | 编译并运行一次，改代码后要重启 |
| `start:dev` | `nest start --watch` | **学习期主力**，保存即重编译重启 |
| `start:debug` | `nest start --debug --watch` | 需要断点调试时 |
| `build` | `nest build` | 产出 `dist/` |
| `start:prod` | `node dist/main` | 跑构建产物（先 `build`） |
| `test` | `jest` | 跑 `src/**/*.spec.ts` |
| `test:watch` | `jest --watch` | TDD |
| `test:cov` | `jest --coverage` | 看覆盖率 |
| `test:e2e` | `jest --config ./test/jest-e2e.json` | 跑 `test/*.e2e-spec.ts` |
| `lint` | `eslint "{src,apps,libs,test}/**/*.ts" --fix` | 注意**默认会直接改文件** |
| `format` | `prettier --write "src/**/*.ts" "test/**/*.ts"` | 统一格式 |

**配置文件**

- `nest-cli.json`：`sourceRoot: "src"`、`deleteOutDir: true`（每次构建先清空 `dist/`）。以后加 Swagger CLI 插件也是改这里（见 §5.6）。
- `tsconfig.json`：`emitDecoratorMetadata` 让 TS 把构造函数**参数类型**写进 `design:paramtypes` 元数据 —— **这就是 Nest 不需要你手动声明依赖的原因**。`isolatedModules: true` 要求类型专用导出写 `export type`，并禁用 `const enum`。
- 模块系统：`module: "nodenext"` 但 `package.json` 没有 `"type": "module"`，所以产物是 **CommonJS**，相对导入**不需要**写 `.js` 扩展名。一旦你加上 `"type": "module"`，解析规则就变成 ESM，相对导入**必须**带 `.js` 扩展名。这是新手最容易踩的坑之一。
- `reflect-metadata`：本仓库 `src/main.ts` **没有** import 它，因为 `@nestjs/core` 内部已经 `require("reflect-metadata")`。但 `tsconfig.json` 里的装饰器开关一个都不能少。

**CLI 常用命令**

```bash
npx nest g module cats          # 生成 cats/cats.module.ts
npx nest g controller cats      # 生成控制器
npx nest g service cats         # 生成 provider
npx nest g resource cats        # 生成 module+controller+service+dto+entity（CRUD 全套）
npx nest g resource cats --dry-run   # 只看会生成什么，不写文件
npx nest g service cats --flat --no-spec   # 不建目录、不生成 .spec.ts
```

### 🛠 练习任务

- [x] 把当前工作区整理成干净基线：`git stash` 或提交现有改动（`src/main.ts`、`src/app.controller.ts` **已有未提交的修改**，练习前务必先处理）。
- [x] 跑 `npm run start:dev`，浏览器访问 `http://localhost:3000`，确认得到 `Hello World!`。
- [x] 跑 `npm run test` 和 `npm run test:e2e`，确认都是 1 passed。
- [x] 跑 `npx nest g resource temp --dry-run`，把生成清单抄下来（不要真的生成）。
- [x] 用 `nest g` 真的生成一个 `temp` 模块，对着代码读一遍，然后**删掉**这些文件，确认 `npm run build` 仍然通过。
- [x] 做一次包管理器决策：仓库里同时存在 `package-lock.json` 与 `pnpm-lock.yaml`，还有 `pnpm-workspace.yaml`。选定 **一个**（npm 或 pnpm），删掉另一个的 lockfile，之后所有安装命令统一用它。
- [x] 读懂并**解释** `src/main.ts` 里这段改动的危害，写出你的修复版：

  ```ts
  (() => {
    bootstrap().catch((error) => {
      console.log(error);
    });
  })();
  ```

  > 提示：`catch` 里只 `console.log` 会**吞掉启动失败**，进程以退出码 0 结束，容器和 CI 会认为「启动成功」。官方写法是 `void bootstrap();`，配合 `Logger.error` 且 `process.exit(1)`。
- [x] 在 `/` 上试一次 `curl -i http://localhost:3000/?x=1`，观察 `@Query() query` 这个**声明了但没用**的参数（见 §2.1）。

### ✅ 自测标准

- 能不看文档说出 `start:dev` 与 `start` 的区别，以及 `test` 与 `test:e2e` 用的是不是同一份配置。
- 能解释「为什么 `AppService` 没有手写 `new AppService()` 就能在 `AppController` 里用」。
- 能说出 `emitDecoratorMetadata` 关掉之后会发生什么。
- 能说出本仓库产物是 CJS 还是 ESM，以及判断依据。

---

## 2. 第 1 周：核心十章（Overview）

官方 Overview 的十章顺序就是 Nest 的**请求处理链路顺序**：Controller → Provider → Module → 然后按「请求经过的每一层」展开 Middleware → Exception filters → Pipes → Guards → Interceptors → 自定义装饰器。**按这个顺序学，不要跳。**

### 2.1 Controllers（控制器）

📖 [https://docs.nestjs.com/controllers](https://docs.nestjs.com/controllers)

**🎯 知识点**

- `@Controller('cats')` 的路由前缀；控制器类里的方法用 `@Get/@Post/@Put/@Patch/@Delete/@Options/@Head/@All` 声明路由。
- 在方法级再叠一层路径：`@Get(':id')`。
- 参数装饰器：`@Param('id')`、`@Query()`、`@Body()`、`@Headers('x-token')`、`@Req()`、`@Res()`（`@Res()` 会脱离 Nest 的响应管理，谨慎用）。
- 返回值：直接 return 对象会被序列化成 JSON；`async` 方法返回 Promise 时 Nest 自动 await。
- 状态码：`@HttpCode(204)`；POST 默认 201，其余默认 200。
- 响应头：`@Header('Cache-Control', 'none')`。
- 重定向：`@Redirect('/new', 301)`。
- 路由通配符：`?` `+` `*` 以及 `'ab*cd'` 这类模式。
- **Express 5 的重要变化**：底层 `path-to-regexp@8`，**裸 `*` 不再合法**，必须用命名通配符。`@Get('*splat')` 可以，`@Get('*')` 会在启动时报错；可选段用 `{*splat}`。

**🔍 本仓库对照**

- `src/app.controller.ts` —— 全仓库唯一的控制器。`@Controller()` 空前缀 + `@Get()` 空前缀，所以路由就是 `/`。
- 同一个文件里 `getHello(@Query() query)` 的 `query` **声明了但从未使用**：这是参数装饰器最好的练手点。注意 `@Query()` 没有显式类型标注，运行时拿到的就是 Express 的 query 对象。
- `src/app.controller.spec.ts` 直接 `app.get(AppController)` 然后调 `getHello()` —— 说明控制器方法就是普通方法，可单测。
- `test/app.e2e-spec.ts` 用 supertest 打 `GET /`。

**🛠 练习任务**

- [ ] 给 `AppController` 加 `@Get('hello')`，确认 `/hello` 可用而 `/` 仍然可用，理解方法级路径是**追加**在控制器前缀后的。
- [ ] 新增一个 `@Get('echo/:id')`，用 `@Param('id')` 取出来返回，并用 `curl` 验证。
- [ ] 写一个 `@Post('echo')`，用 `@Body()` 接收 JSON 并原样返回，确认默认状态码是 **201**。
- [ ] 给它加 `@HttpCode(200)`，再 `curl -i` 确认状态码变化。
- [ ] 用 `@Query('name')` 修好那个未使用的 `query` 参数：`/?name=neo` 时返回 `Hello neo!`，不带时返回 `Hello World!`。
- [ ] 故意写 `@Get('*')`，启动服务观察报错信息，然后改成 `@Get('*splat')` 让它通过 —— 亲手记住 Express 5 这条坑。
- [ ] 用 `@Res()` 手写一次 `res.status(200).json(...)`，再对比直接 `return` 的写法，说明两者差异。

**✅ 自测标准**

- 能说出 `@Controller('cats')` + `@Get(':id')` 拼出的完整路径。
- 能说出默认状态码规则，以及如何改。
- 能解释为什么绝大部分情况**不该**用 `@Res()`。
- 知道裸 `*` 在 Express 5 下会失败及正确写法。

---

### 2.2 Providers（提供者）

📖 [https://docs.nestjs.com/providers](https://docs.nestjs.com/providers)

**🎯 知识点**

- `@Injectable()` 把一个类标记为「可被 DI 容器管理的 provider」。
- 构造函数注入：Nest 通过 `design:paramtypes` 元数据反射出参数类型并注入实例。
- `private readonly appService: AppService` 这种 TS 参数属性写法为什么在 Nest 里到处都是。
- 默认作用域是**单例**：整个应用只有一个实例（这解释了很多「为什么我改的字段在请求间共享」）。
- Nest 是**控制反转（IoC）**容器：你声明「我要什么」，容器负责构造和组装。
- provider 是**按 token 注册**的，类的默认 token 就是类本身。

**🔍 本仓库对照**

- `src/app.service.ts`：最小 provider，`@Injectable()` + 一个方法，没有依赖。
- `src/app.module.ts` 的 `providers: [AppService]`：**这里注册了才能注入**。忘记注册，启动时会报 `Nest can't resolve dependencies of ...`。
- `src/app.controller.ts` 构造函数 `constructor(private readonly appService: AppService)`：这是全仓库唯一的注入边。

**🛠 练习任务**

- [ ] 新建一个 `LoggerService`（自己写，不用 `@nestjs/common` 的 `Logger`），`@Injectable()` 后在 `AppService` 里注入使用，并在 `AppModule` 注册。
- [ ] 把 `AppService` 从 `providers` 数组里**临时删掉**，启动服务，把报错信息完整抄下来，然后恢复 —— 记住这个错误长什么样。
- [ ] 在 `LoggerService` 里加一个 `count = 0` 字段，每次调用自增；连续请求 `/` 两次，验证它确实是**单例**（第二次不会回到 0）。
- [ ] 用 `@Inject('GREETING')` + `{ provide: 'GREETING', useValue: '你好' }` 注入一个字符串常量（字符串 token 的用法，§3.1 会深入）。

**✅ 自测标准**

- 能解释「不写 `new`，实例从哪来」。
- 能说出 provider 默认作用域，以及它对状态共享的影响。
- 看到 `Nest can't resolve dependencies` 能立刻想到「去模块的 `providers`/`imports` 里找」。

---

### 2.3 Modules（模块）

📖 [https://docs.nestjs.com/modules](https://docs.nestjs.com/modules)

**🎯 知识点**

- `@Module()` 四个字段：`imports`（本模块用到的别人的模块）、`controllers`、`providers`、`exports`（本模块**愿意给出去**的 provider）。
- 每个应用至少有一个根模块；推荐**一个特性一个模块**（feature module）。
- **模块封装**：provider 默认只在声明它的模块内可见，必须 `exports` 才能被别的模块注入 —— 这是 Nest 架构的骨架。
- 共享模块：把公共 provider 封装成模块并 `exports`，谁 import 谁能用。
- `@Global()`：让模块全局可用（`@nestjs/config` 之类的库常用），但**能不用就不用**，会破坏依赖可见性。
- 模块之间可以循环引用 —— 留到 §3.5 用 `forwardRef` 处理。
- `nest g module cats` 生成模块；`nest g resource cats` 会连控制器/service/DTO 一起生成并**自动注册进根模块**。

**🔍 本仓库对照**

- `src/app.module.ts`：`imports: []` 是空的（以后 `ConfigModule`、`CacheModule` 都往这里加），`controllers: [AppController]`、`providers: [AppService]`，没有 `exports`。
- `src/main.ts` 的 `NestFactory.create(AppModule)`：根模块是整个应用的入口。

**🛠 练习任务**

- [ ] 执行 `npx nest g resource cats`，观察生成的 6 个文件，并打开 `src/app.module.ts` 确认 `CatsModule` **已被自动加进 `imports`**。
- [ ] 画出 `CatsModule` 应包含哪些 controller/provider，与 `AppModule` 的边界在哪。
- [ ] 把 `CatsService` 加上 `exports: [CatsService]` 并在 `AppModule` 里 import `CatsModule` 后注入到 `AppService`，跑通；然后**删掉 `exports`**，看报错 —— 亲手验证「模块封装」是真的。
- [ ] 新建 `SharedModule`，提供并导出一个 `ConfigLikeService`，在 `CatsModule` 和 `AppModule` 里各注入一次，确认拿到的是**同一个实例**。
- [ ] 给 `SharedModule` 加 `@Global()`，删掉别人对它的 `imports`，确认仍然可用；然后想清楚「为什么官方不建议这么干」。

**✅ 自测标准**

- 能默写 `@Module()` 的四个字段及各自作用。
- 能解释「provider 不 export 就注入不到」。
- 能说出特性模块的划分依据（按业务能力，而不是按技术层次）。
- 知道 `@Global()` 的代价。

---

### 2.4 Middleware（中间件）

📖 [https://docs.nestjs.com/middleware](https://docs.nestjs.com/middleware)

**🎯 知识点**

- Nest 中间件**就是 Express 中间件**（默认平台下），签名 `(req, res, next)`，必须在最后调用 `next()`，否则请求挂死。
- 两种写法：**函数式**（`export function logger(req, res, next)`）与**类式**（`@Injectable() class LoggerMiddleware implements NestMiddleware { use(...) }`，类式可以注入依赖）。
- 在模块里实现 `NestModule` 接口，用 `configure(consumer)` 挂载：`consumer.apply(X).forRoutes('cats')` / `.forRoutes({ path: 'cats', method: RequestMethod.GET })` / `.exclude(...)`。
- 全局中间件：`app.use(...)` 在 `main.ts` 里（早于所有模块装配生效）。
- 中间件**拿不到**「哪个 handler 会被执行」，也拿不到 handler 的元数据 —— 这是它和 Guard/Interceptor 的核心分工。

**🔍 本仓库对照**

- 目前**一个中间件都没有**，`AppModule` 也没实现 `NestModule`。
- `src/main.ts` 里的 `const app = await NestFactory.create(AppModule)` 之后、`app.listen()` 之前，是放全局中间件的位置。

**🛠 练习任务**

- [ ] 写一个函数式中间件，打印 `method url` 和时间戳，用 `app.use()` 挂到全局，`curl` 验证。
- [ ] 改写为类式 `LoggerMiddleware implements NestMiddleware`，让 `AppModule implements NestModule` 并用 `configure(consumer)` 挂载到所有路由。
- [ ] 用 `.forRoutes({ path: '*splat', method: RequestMethod.ALL })` 挂到全路由（**注意 Express 5 通配符写法**），体验和全局 `app.use()` 的区别。
- [ ] 用 `.exclude('hello')`（或 `{ path: 'hello', method: RequestMethod.GET }`）排除某条路由，验证它不再打印日志。
- [ ] 在类式中间件里注入 `AppService`（注意：不要用 REQUEST 作用域，先试默认作用域），打印 `getHello()` 的返回值。
- [ ] 故意删掉 `next()` 调用，用 `curl --max-time 3` 观察请求**挂死**，然后加回来。

**✅ 自测标准**

- 能说出函数式与类式中间件各自适用场景。
- 能说出中间件的注册位置和生效范围。
- 能解释「为什么中间件不该做鉴权」（拿不到 handler 元数据）。

---

### 2.5 Exception filters（异常过滤器）

📖 [https://docs.nestjs.com/exception-filters](https://docs.nestjs.com/exception-filters)

**🎯 知识点**

- Nest 有**内置全局异常层**：未捕获的异常不会让进程崩，而是转成 `{ statusCode, message }` 响应。
- `HttpException` 及内置子类：`BadRequestException`(400)、`UnauthorizedException`(401)、`ForbiddenException`(403)、`NotFoundException`(404)、`ConflictException`(409) 等。
- 自定义响应体：`throw new BadRequestException({ message: '...', code: 'X' })`。
- 自定义过滤器：`@Catch(HttpException)` + `implements ExceptionFilter` + `catch(exception, host)`，用 `ArgumentsHost` 拿到 `req`/`res`。
- 注册层级：`@UseFilters()` 方法级/控制器级 → `app.useGlobalFilters()` → `{ provide: APP_FILTER, useClass: X }`（**推荐**，因为能注入依赖）。
- 区分「异常类」与「错误对象」：非 `HttpException` 的普通 `Error` 会变成 **500**，且不泄露堆栈给客户端。
- 过滤器**只处理异常**，不处理正常响应（正常响应包装用 Interceptor，见 §2.8）。

**🔍 本仓库对照**

- 全仓库**没有任何异常处理和过滤器**，`AppService.getHello()` 永远成功。
- `test/app.e2e-spec.ts` 目前只断言 200，是加「断言 404/400」的好地方。

**🛠 练习任务**

- [ ] 在 `AppService` 里写 `getHello(name?: string)`，当 `name` 不存在时 `throw new BadRequestException('name is required')`，用 `curl -i` 看默认响应结构。
- [ ] 再抛一个普通 `throw new Error('boom')`，对比状态码和响应体，确认是 **500** 且没有堆栈。
- [ ] 写 `HttpExceptionFilter implements ExceptionFilter`，输出统一结构 `{ statusCode, path, timestamp, message }`。
- [ ] 用 `@UseFilters(HttpExceptionFilter)` 只加在某个方法上，验证**其他路由不受影响** —— 体会「作用域」。
- [ ] 改成全局注册 `{ provide: APP_FILTER, useClass: HttpExceptionFilter }` 到 `AppModule`，让 `HttpExceptionFilter` 构造函数注入 `AppService`，验证依赖可用（对比 `app.useGlobalFilters()` 为什么做不到）。
- [ ] 用 `@Catch()`（不传参）写一个兜底过滤器捕获所有异常，注意它和 `@Catch(HttpException)` 的**注册顺序**决定谁生效。
- [ ] 给 `test/app.e2e-spec.ts` 补一条断言 400 的 e2e 用例。

**✅ 自测标准**

- 能说出内置异常层的默认响应结构。
- 能写出一个自定义过滤器并说清三种注册级别的优先级。
- 能解释 `HttpException` 与普通 `Error` 的区别。
- 知道为什么推荐 `APP_FILTER` 而不是 `useGlobalFilters()`。

---

### 2.6 Pipes（管道）

📖 [https://docs.nestjs.com/pipes](https://docs.nestjs.com/pipes)

**🎯 知识点**

- 管道的两个职责：**转换**（transform，如字符串转数字）和**校验**（validate，不合法就抛异常）。
- 内置管道：`ParseIntPipe`、`ParseBoolPipe`、`ParseFloatPipe`、`ParseUUIDPipe`、`ParseEnumPipe`、`ParseArrayPipe`、`ParseFilePipe`、`DefaultValuePipe`。
- 自定义管道：`@Injectable() class X implements PipeTransform { transform(value, metadata) }`，`metadata` 里带 `type`（`'body' | 'query' | 'param' | 'custom'`）和 `metatype`。
- 三种绑定方式：参数级 `@Body(XPipe)`、控制器级 `@UsePipes(XPipe)`、全局 `app.useGlobalPipes()` 或 `{ provide: APP_PIPE, useClass: X }`。
- `ValidationPipe` 是内置的校验管道，配合 `class-validator` 使用 —— 细节留到 §5.2。
- 管道抛出的异常会被 §2.5 的异常层接住（`BadRequestException` = 400），这两章是连着的。

**🔍 本仓库对照**

- `src/app.controller.ts` 的 `@Query() query` 是**未校验的裸对象**，`/?x=1` 无论传什么都会被接受 —— 这正是管道要解决的问题。
- `test/app.e2e-spec.ts` 没有 400 用例。

**🛠 练习任务**

- [ ] 给 `@Get('echo/:id')` 的 `@Param('id', ParseIntPipe)` 加管道，`/echo/abc` 应该返回 **400**，`/echo/1` 正常。
- [ ] 用 `@Param('id', new ParseIntPipe({ errorHttpStatusCode: HttpStatus.NOT_ACCEPTABLE }))` 自定义错误码，观察响应变化。
- [ ] 自己写一个 `TrimPipe implements PipeTransform`，去掉字符串首尾空格；用 `@Query('name', TrimPipe)` 验证。
- [ ] 写一个 `ParseNamePipe`，当 `name` 为空时抛 `BadRequestException`，理解「校验失败靠抛异常」。
- [ ] 用 `new DefaultValuePipe('World')` + `ParseIntPipe` 组合，让 `/?page` 不带值时有默认值。
- [ ] 把 `TrimPipe` 通过 `{ provide: APP_PIPE, useClass: TrimPipe }` 注册为全局，验证它作用到了所有 `@Query()`。
- [ ] 故意传一个**对象**给 `ParseIntPipe`（`curl 'localhost:3000/echo/1?id[a]=1'`），观察 `ValidationPipe`/`ParseIntPipe` 对异常输入的处理边界。

**✅ 自测标准**

- 能说出管道的两个职责和内置管道名称。
- 能写出一个自定义 `PipeTransform`。
- 能说清参数级/控制器级/全局三级作用范围。
- 知道校验失败要抛什么异常、最终变成几号状态码。

---

### 2.7 Guards（守卫）

📖 [https://docs.nestjs.com/guards](https://docs.nestjs.com/guards)

**🎯 知识点**

- Guard 回答的是「**这个请求该不该继续**」（授权），它**在管道之前**执行。
- `@Injectable() class X implements CanActivate { canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> }`。
- 返回 `false` 时 Nest 抛 **403 ForbiddenException**；也可以直接 throw `UnauthorizedException`（401），便于区分「没登录」和「没权限」。
- `ExecutionContext` 是 `ArgumentsHost` 的子类，能拿到 `switchToHttp().getRequest()/getResponse()`，以及 `getHandler()`、`getClass()`（**这是中间件拿不到的**）。
- 用 `Reflector` 读取元数据：`@SetMetadata('roles', ['admin'])` + `reflector.get('roles', context.getHandler())` —— 这是「声明式鉴权」的雏形。
- 注册：`@UseGuards(XGuard)` 方法级/控制器级、`app.useGlobalGuards()`、`{ provide: APP_GUARD, useClass: XGuard }`。
- 执行顺序：**全局 guard → 控制器级 → 方法级**。

**🔍 本仓库对照**

- **已经实现了**：`src/auth/`（JWT 登录 + 全局 `JwtAuthGuard` + `@Public()` / `@CurrentUser()`）。
  完整说明见 [`docs/authentication.md`](authentication.md) —— 这一章的练习可以改成
  **读实现 + 补自测题**：
  - 守卫为什么是**全局 + fail-closed**，而不是逐条路由 `@UseGuards`？
  - `@Public()` 是怎么被守卫读到的？（`Reflector.getAllAndOverride` 与方法级优先）
  - 为什么守卫只验签、不查库？代价是什么？（用户被禁用后 token 仍有效到过期）
  - 401 的两种原因（`invalid_request` / `invalid_token`）为什么要分开？
- **本章的练习仍然值得做**：仓库里**没有**授权层（角色 / 权限），所以"写一个 `RolesGuard`
  + `@Roles()`"是一个真实的扩展练习 —— 触发条件与改动范围见 `docs/authentication.md` §10。
- `main.ts` 里**没有** `useGlobalGuards()`：守卫走 `AuthModule` 的 `APP_GUARD`。

**🛠 练习任务**

- [ ] 读 `src/auth/roles.guard.ts` 与 `src/auth/__tests__/roles.guard.spec.ts`，把判定矩阵抄成一张表
      （元数据有无 × 主体有无 × 角色是否命中 → 结果）。
- [ ] 写一个**自己的** `AuthGuard implements CanActivate`，检查请求头 `authorization === 'Bearer secret'`，
      不满足时 throw `UnauthorizedException`；加到一条演示路由上验证。
- [ ] 改成返回 `false`，对比 401 与 403 的响应**形状差异**，想清楚为什么本仓库坚持"抛异常而不是返回 false"。
- [ ] 用 `@SetMetadata('roles', ['admin'])` + `Reflector` 写 `RolesGuard`：请求头 `x-role` 不在允许列表就拒绝。
- [ ] 在 `AppController` 上放 `@UseGuards(RolesGuard)`，确认控制器级对**所有方法**生效。
- [ ] 用 `{ provide: APP_GUARD, useClass: AuthGuard }` 全局注册，再给某个路由加 `@Public()` 自定义装饰器（用 `Reflector` 读）来放行 —— 这就是真实项目里「全局鉴权 + 白名单」的标准做法。
- [ ] 在 guard 里注入 `AppService`，验证 `APP_GUARD` 写法下依赖可注入。
- [ ] 写一个 `LoggingInterceptor`-风格的猜测题：把同一段日志分别写进 middleware 和 guard，观察**谁先执行**，用日志顺序验证执行链。

**✅ 自测标准**

- 能说出 guard 与 middleware 的三点区别（拿得到 handler、执行时机、返回值语义）。
- 能写出 `CanActivate` 并区分 401/403 的用法。
- 能用 `Reflector` + `@SetMetadata` 实现声明式权限。
- 能说出全局 guard 与控制器级 guard 的执行顺序。

---

### 2.8 Interceptors（拦截器）

📖 [https://docs.nestjs.com/interceptors](https://docs.nestjs.com/interceptors)

**🎯 知识点**

- Interceptor 是**方法执行前后的切面**（AOP），能力比 guard 更强：能改返回值、改异常、测耗时、重试、超时、缓存。
- `@Injectable() class X implements NestInterceptor { intercept(context, next: CallHandler): Observable<any> }`。
- `next.handle()` 返回 `Observable`；用 RxJS `pipe()` 组合：
  - `tap()` —— 只做副作用（日志、计时）
  - `map()` —— **改造返回值**（统一响应包装 `{ code, data }`）
  - `catchError()` —— 把异常转换成别的异常
  - `timeout()` / `delay()` / `retry()`
- `CallHandler.handle()` **不调用**，路由就不会执行。
- 通过 `ExecutionContext` 拿 `getHandler()` 等，配合 `Reflector` 做声明式行为（比如 `@CacheTTL()`）。
- 注册：`@UseInterceptors()`、`app.useGlobalInterceptors()`、`{ provide: APP_INTERCEPTOR, useClass: X }`。
- 与 middleware 的本质区别：interceptor 跑在**路由处理函数周围**，能拿到 handler 和方法返回值。

**🔍 本仓库对照**

- `src/contract/response/response-envelope.interceptor.ts` 就是"统一响应包装"：`next.handle().pipe(map(...))`
  把返回值包成 `{ success: true, data, meta? }`，并通过 `APP_INTERCEPTOR` 全局注册。
- 它同时演示了 `map()` 之外的判断：`@Render()` / `@Redirect()` / `@Sse()` / `StreamableFile` 用
  `Reflect` 元数据 + 类型判断提前放行（包了就会破坏这些响应）。
- 失败侧不归 interceptor 管：`AppExceptionFilter` 用 `@Catch()` 统一错误形状，两侧合起来才是"成功/失败同一个形状"。
- e2e 断言用的是 `Object.keys(body).sort()` 精确比对键集，见 `src/modules/validation-demo/__tests__/validation-demo.e2e-spec.ts`。

**🛠 练习任务**

- [ ] 写 `LoggingInterceptor`，用 `tap` 打印「before / after」和 `Date.now()` 差值，验证顺序是 handler **之前和之后**各一次。
- [x] 写 `TransformInterceptor`，用 `map` 把返回值包装为 `{ success: true, data }`，`curl` 验证；**同时更新 e2e 断言**，让测试重新变绿。（已实现为 `ResponseEnvelopeInterceptor`，见 `src/contract/response/`）
- [ ] 用 `catchError` 把普通 `Error` 转成 `BadRequestException`，验证响应状态码变化。
- [ ] 用 `timeout(1000)`（或 `timeout(1000)` + `catchError`）给一个 `await sleep(2000)` 的路由加超时，观察返回 500 并思考该换成什么异常。
- [ ] 故意注释掉 `next.handle()`，确认路由**完全未执行**（用 `tap` 里的日志验证）。
- [ ] 用 `Reflector` + `@SetMetadata('cacheSeconds', 5)` 写一个简易内存缓存 interceptor：5 秒内相同请求直接返回上次结果。
- [x] 用 `{ provide: APP_INTERCEPTOR, useValue: ... }` 全局注册，确认它作用在所有路由上。（`ApiContractModule.forRoot()` 里注册）

**✅ 自测标准**

- 能说出 interceptor 与 middleware 的区别，以及各自适合什么。
- 能写出「统一响应包装」和「耗时日志」两个经典 interceptor。
- 能用 `map/tap/catchError/timeout` 各写出一个用例。
- 知道 `next.handle()` 不调用的后果。

---

### 2.9 Custom route decorators（自定义路由装饰器）

📖 [https://docs.nestjs.com/custom-decorators](https://docs.nestjs.com/custom-decorators)

**🎯 知识点**

- `createParamDecorator((data, ctx: ExecutionContext) => value)` 造参数装饰器，例如 `@User()` 直接从 `req.user` 取值。
- `data` 参数支持带参用法：`@User('name')` → `data === 'name'`。
- 参数装饰器可以和管道组合：`@User(new ValidateUserPipe())`。
- `applyDecorators(A(), B())` 把多个装饰器合成一个，例如 `@Auth('admin')` = `@SetMetadata('roles', ...)` + `@UseGuards(RolesGuard)`。
- 装饰器只是「声明元数据 / 挂载逻辑」，**本身不执行业务** —— 这是理解 Nest 全部门面 API 的钥匙。

**🔍 本仓库对照**

- 契约层里已经有一批自定义装饰器：`@RawBody()`、`@NoEnvelope()`、`@IsOptionalNotNull()`
  （`src/contract/`），以及认证层的 `@Public()` / `@CurrentUser()`（`src/auth/decorators/`）。
- 其中 `@CurrentUser()` 是 `createParamDecorator` 的现成范例，`@Public()` 是 `SetMetadata` 的；
  `applyDecorators` 的用法见 `@ApiEnvelopeErrors()`（`src/swagger/api-errors.decorator.ts`）。

**🛠 练习任务**

- [ ] 写 `export const Name = createParamDecorator((data, ctx) => ctx.switchToHttp().getRequest().query.name)`，用 `@Name() name: string` 替换 `@Query('name')`。
- [ ] 给 `@Name('fallback')` 加上带参支持，理解 `data` 的流转。
- [ ] 写 `@User()`：先在前置 guard 里往 `req.user` 挂对象，再用 `@User()` 取出来（体会顺序：guard 先于参数装饰器求值）。
- [ ] 用 `applyDecorators(SetMetadata('roles', roles), UseGuards(RolesGuard))` 定义 `@Roles('admin')`，给控制器方法加一行就完成鉴权声明。
- [ ] 用 `@Name(TrimPipe)` 把自定义装饰器和管道组合起来。

**✅ 自测标准**

- 能独立写出一个 `createParamDecorator` 装饰器。
- 能用 `applyDecorators` 把「元数据 + guard」封装成一个业务装饰器。
- 能解释「装饰器只声明，执行靠框架」。

---

### 2.10 请求生命周期总览（收束章）

📖 官方参考：[Lifecycle 事件](https://docs.nestjs.com/fundamentals/lifecycle-events) · 相关：`/middleware` `/guards` `/interceptors` `/pipes` `/exception-filters` 各章开头的顺序说明

**🎯 知识点**

```
   客户端请求
        │
   ┌────▼─────────────────────────────────────────┐
   │ 1. Middleware        (Express 层, 有 req/res/next)
   ├──────────────────────────────────────────────┤
   │ 2. Guards            (能不能进 → 401/403)
   ├──────────────────────────────────────────────┤
   │ 3. Interceptors(前)  (next.handle() 之前)
   ├──────────────────────────────────────────────┤
   │ 4. Pipes             (转换 + 校验 → 400)
   ├──────────────────────────────────────────────┤
   │ 5. Controller Handler (你的业务方法)
   ├──────────────────────────────────────────────┤
   │ 6. Interceptors(后)  (Observable 流: map/tap)
   ├──────────────────────────────────────────────┤
   │ 7. Exception Filters (任何一步抛异常都到这里)
   └────┬─────────────────────────────────────────┘
        │
   客户端响应
```

**横切关注点该放哪一层**

| 需求 | 该用 | 原因 |
| --- | --- | --- |
| 原始日志、body 解析、CORS | Middleware / `main.ts` | 最早，只有 req/res |
| 认证 / 授权 | **Guard** | 拿得到 handler 和元数据，且早于业务逻辑 |
| 入参转换与校验 | **Pipe** | 天然绑定在参数上 |
| 统一响应包装、耗时日志、缓存 | **Interceptor** | 能包住 handler 的返回值 |
| 统一错误响应 | **Exception Filter** | 专门接异常 |
| 启动/关闭时初始化资源 | **Lifecycle hooks** | 见 §3.9 |

**🛠 练习任务**

- [ ] 把 §2.4–§2.8 你写的 middleware、guard、interceptor、pipe、filter **全部**挂上，只打日志，然后发一个请求，把日志顺序抄下来，与上图逐行对齐。
- [ ] 让 guard 返回 `false`，观察后续的 pipe 和 handler 是否执行（应该**不执行**），验证守卫位置。
- [ ] 让 pipe 校验失败，观察 interceptor 的「前」有没有执行、「后」有没有执行。
- [ ] 让 handler 抛异常，观察 interceptor 的 `catchError` 与 exception filter 谁先接手。
- [ ] 用一张纸默画出这条链路，并在每一层标注「能拿到什么、不能拿到什么」。这张图学完就不会忘。

**✅ 自测标准**

- 能默写这条请求处理链的顺序。
- 拿到一个新需求（例如「记录每个接口的耗时」），能立刻判断该放哪一层。
- 能解释「为什么统一响应包装不能用 middleware，而统一错误响应用 filter」。

---

## 3. 第 2 周：Fundamentals 关键基础

📖 官方文档入口：[https://docs.nestjs.com/fundamentals/custom-providers](https://docs.nestjs.com/fundamentals/custom-providers)（以下每小节单独给链接）
下面按**对写业务的重要性**排序，不是按文档目录顺序。

### 3.1 Custom providers（自定义提供者）

📖 [https://docs.nestjs.com/fundamentals/custom-providers](https://docs.nestjs.com/fundamentals/custom-providers)

**🎯 知识点**

- 完整写法 `{ provide: TOKEN, useClass / useValue / useFactory / useExisting: ... }`。
- `useValue`：注入常量、mock 对象。
- `useClass`：把抽象/接口映射到具体实现（**依赖倒置**的关键）。
- `useFactory`：需要运行时计算或依赖别的 provider 时使用，配合 `inject: [OtherService]`。
- `useExisting`：给同一个实例做**别名**（注意与 `useClass` 的区别：后者会创建**新实例**）。
- 非类 token：字符串或 `Symbol`，注入时用 `@Inject(TOKEN)`。
- `@Inject()` 在构造函数参数和属性上都能用。

**🔍 本仓库对照**

- `src/app.module.ts` 的 `providers: [AppService]` 是**语法糖**，等价于 `{ provide: AppService, useClass: AppService }`。
- 目前没有自定义 token。

**🛠 练习任务**

- [ ] 把 `providers: [AppService]` 改写成 `{ provide: AppService, useClass: AppService }`，确认行为完全不变 —— 这解释了「语法糖」。
- [ ] 定义 `interface Greeter { greet(): string }`，用 `useClass` 绑定一个实现，在控制器里 `@Inject('GREETER')` 注入。
- [ ] 用 `useValue` 注入一个 mock `Greeter`（返回固定字符串），验证不用改业务代码就替换了实现。
- [ ] 用 `useFactory` 写一个需要 `AppService` 参与计算的 provider，并用 `inject: [AppService]`。
- [ ] 用 `useExisting` 给 `AppService` 起一个别名 token，验证两个 token 拿到的是**同一个对象**（对比 `useClass` 会新建实例）。
- [ ] 用 `Symbol('TOKEN')` 作为 token 重做一次，体会为什么大项目偏爱 Symbol。

**✅ 自测标准**

- 能默写 provider 的四种写法及各自场景。
- 能说清 `useClass` 与 `useExisting` 的差别。
- 知道 `@Inject()` 在什么时候必须写。

---

### 3.2 Asynchronous providers（异步提供者）

📖 [https://docs.nestjs.com/fundamentals/async-components](https://docs.nestjs.com/fundamentals/async-components)

**🎯 知识点**

- `useFactory` 可以是 `async`，返回 Promise；Nest 会等所有异步 provider 就绪后才启动应用。
- 用途：启动时读配置、建立连接池、拉远程配置。
- 异步 provider 阻塞的是**应用启动**，不是请求。

**🔍 本仓库对照**

- 无异步 provider；这是 §5.1 `ConfigModule.forRootAsync` 的前置知识。

**🛠 练习任务**

- [ ] 写一个 `useFactory: async () => { await sleep(500); return cfg }` 的 provider，在 `main.ts` 里打印 `app.listen` 前后的时间戳，验证启动被**推迟**。
- [ ] 在该 provider 里 `throw new Error('config load failed')`，观察应用**启动失败**而不是运行时报错。

**✅ 自测标准**

- 能说出异步 provider 影响的是启动还是请求。
- 能写出 `useFactory: async` + `inject`。

---

### 3.3 Dynamic modules（动态模块）

📖 [https://docs.nestjs.com/fundamentals/dynamic-modules](https://docs.nestjs.com/fundamentals/dynamic-modules)

**🎯 知识点**

- 静态模块 `@Module({...})` 是固定的；动态模块返回一个 `DynamicModule` 对象，可以接收参数。
- 惯例：`forRoot(options)` 用于全局单次配置，`forFeature(options)` 用于按需注册，`forRootAsync(options)` 用于需要注入依赖时。
- 动态模块需要 `@Module({})` 装饰一个**空壳类**，`static forRoot(): DynamicModule { return { module: XModule, providers, exports } }`。
- 可以标记 `global: true`。
- 这是所有 Nest 生态库（`@nestjs/config`、`@nestjs/cache-manager`，以及将来会遇到的持久化模块）的统一形态 —— 学会它，看任何库的 README 都能秒懂用法。

**🔍 本仓库对照**

- `src/app.module.ts` 的 `imports: []` 空数组，就是将来放 `ConfigModule.forRoot(...)` 的位置。

**🛠 练习任务**

- [ ] 手写一个 `GreetingModule.forRoot({ prefix })`，把 `prefix` 通过 provider 注入到 service 里并实际改变输出。
- [ ] 给返回的 `DynamicModule` 加 `global: true`，删掉别处的 `imports: [GreetingModule]`，验证仍然可用。
- [ ] 用 `forRoot(options)` + `forFeature(name)` 两个静态方法模拟「全局配置 + 按模块开关」。
- [ ] 解释：为什么 `forRoot` 里 `exports` 写错会导致 `Nest can't resolve dependencies`。

**✅ 自测标准**

- 能独立写出一个 `forRoot` 动态模块。
- 能说出 `forRoot` / `forFeature` / `forRootAsync` 的分工。
- 能读懂任意 Nest 库 README 里的 `imports: [XxxModule.forRoot(...)]`。

---

### 3.4 Injection scopes（注入作用域）

📖 [https://docs.nestjs.com/fundamentals/injection-scopes](https://docs.nestjs.com/fundamentals/injection-scopes)

**🎯 知识点**

- 三种作用域：`Scope.DEFAULT`（单例，**默认**）、`Scope.REQUEST`（每个请求一个新实例）、`Scope.TRANSIENT`（每个注入点一个新实例）。
- `@Injectable({ scope: Scope.REQUEST })`。
- 作用域会**沿依赖链向上冒泡**：注入了 REQUEST 作用域的 provider，自己也会变成 REQUEST 作用域（除非显式调整）。
- 性能代价真实存在：REQUEST 作用域会为每个请求创建新的 DI 子树。
- 替代方案：用 `ModuleRef`（§3.6）按需 `resolve()`，或把请求态数据通过参数传，而不是靠作用域。

**🔍 本仓库对照**

- `AppService`、`AppController` 都是默认单例 —— 所以 §2.2 里那个 `count` 字段会跨请求累加。

**🛠 练习任务**

- [ ] 把 `AppService` 改成 `Scope.REQUEST`，再看 §2.2 那个 `count` 字段：**每次请求都变回 0**。对比前后行为。
- [ ] 给 `AppService` 加 `@Inject(REQUEST) private readonly req: Request`，读取当前请求的 `url`（这是 REQUEST 作用域最经典的用法）。
- [ ] 用 `Scope.TRANSIENT` 写一个 provider，注入到**两个不同**类里，验证两个类拿到的是**不同实例**。
- [ ] 观察控制台：把自己写的 `Scope.REQUEST` provider 数量增加到 3 个，看 Nest 是否给出性能提示日志。
- [ ] 把作用域改回 `DEFAULT`，用「把请求信息当方法参数传」的方式改写，对比两种方案的可测性。

**✅ 自测标准**

- 能说出三种作用域的区别和默认值。
- 能解释「作用域冒泡」。
- 能说出为什么生产代码里要慎用 REQUEST 作用域。

---

### 3.5 Circular dependency（循环依赖）

📖 [https://docs.nestjs.com/fundamentals/circular-dependency](https://docs.nestjs.com/fundamentals/circular-dependency)

**🎯 知识点**

- 两个类/模块互相注入时，Nest 无法决定构造顺序 → 报错。
- 解法：`forwardRef(() => OtherService)` 用在 `@Inject` 和模块 `imports` 里。
- `@Inject(forwardRef(() => BService))` 在参数上。
- **循环依赖是设计问题**，`forwardRef` 只是让启动通过；更好的做法是抽公共模块或引入事件。
- 模块级：`imports: [forwardRef(() => BModule)]`。

**🔍 本仓库对照**

- 目前没有循环依赖；这章是为 §5 之后拆模块时做准备。

**🛠 练习任务**

- [ ] 造两个互相注入的 service，先看**原始报错信息**（`Nest cannot create the X module... A circular dependency`），抄下来。
- [ ] 用 `@Inject(forwardRef(...))` + `forwardRef` 修好，确认启动通过。
- [ ] 用模块级 `forwardRef` 再造一次两个模块互相 import 的场景并修好。
- [ ] 写出「不用 forwardRef 的第三种解法」：把共享逻辑抽到第三个模块，或改用事件解耦。

**✅ 自测标准**

- 能识别循环依赖报错。
- 能用 `forwardRef` 临时救火，并知道它不是最终解法。

---

### 3.6 Module reference（ModuleRef）

📖 [https://docs.nestjs.com/fundamentals/module-ref](https://docs.nestjs.com/fundamentals/module-ref)

**🎯 知识点**

- `ModuleRef` 可以从容器里**动态**取实例：`moduleRef.get(Service)`、`moduleRef.resolve(Service)`（会创建新的作用域子树）。
- `get` 支持 `{ strict: false }` 跨模块查找（默认只在本模块内找）。
- 用途：插件式架构、按需解析、避免 REQUEST 作用域冒泡。

**🔍 本仓库对照**

- 无使用；结合 §3.4 的替代方案一起理解。

**🛠 练习任务**

- [ ] 在 `AppService` 里注入 `ModuleRef`，用 `get(AppService)` 拿到自身实例，验证可用。
- [ ] 用 `get(OtherService, { strict: false })` 跨模块取一个没在本模块注册的 provider，对比不加 `strict` 时的报错。
- [ ] 用 `resolve(AppService)` 拿两次，验证拿到的是**不同实例**（作用域子树）。

**✅ 自测标准**

- 能说出 `get` 与 `resolve` 的区别。
- 知道 `strict: false` 的用途和风险。

---

### 3.7 Lazy-loading modules（懒加载模块）

📖 [https://docs.nestjs.com/fundamentals/lazy-loading-modules](https://docs.nestjs.com/fundamentals/lazy-loading-modules)

**🎯 知识点**

- `LazyModuleLoader.load(() => SomeModule)` 在运行时按需加载模块（类似动态 `import()`），用于减少启动时间。
- 懒加载的模块**不参与** `dependencies` 扫描，用它要显式 `load()` 一次。
- 在 guard / interceptor / handler 里调用是常见做法。

**🔍 本仓库对照**

- 无使用。可选章节，理解概念即可。

**🛠 练习任务**

- [ ] 在 `AppService` 注入 `LazyModuleLoader`，把 `AppModule` 里 `CatsModule` 的静态 `imports` 改成运行时 `load()`，用日志验证它**启动时未加载**。
- [ ] 对比懒加载前后的启动日志差异。

**✅ 自测标准**

- 能说出懒加载解决的问题。
- 知道懒加载模块不能被静态注入。

---

### 3.8 Execution context（执行上下文）

📖 [https://docs.nestjs.com/fundamentals/execution-context](https://docs.nestjs.com/fundamentals/execution-context)

**🎯 知识点**

- `ArgumentsHost`：`getArgs()`、`switchToHttp()`、`switchToRpc()`、`switchToWs()`、`getType()` —— 「平台无关」的关键抽象。
- `ExecutionContext extends ArgumentsHost`，额外提供 `getClass()`、`getHandler()`、`getArgs()`。
- 用 `host.getType()` 写能同时适配 HTTP / RPC / WS 的通用 guard / filter。
- **这是 §2.7 guard 与 §2.5 filter 底层共用的东西**，学到这里应该回头看一遍那两章的代码。

**🔍 本仓库对照**

- 还没有 guard / filter；等你写完 §2.5 和 §2.7 的练习再回来读本章，效果最好。

**🛠 练习任务**

- [ ] 在自定义 guard 里分别打印 `context.getType()`、`getClass().name`、`getHandler().name` 和 `getArgs().length`。
- [ ] 写一个 `createGenericFilter`，根据 `host.getType() === 'http'` 决定响应方式（先只实现 http 分支）。

**✅ 自测标准**

- 能说出 `ArgumentsHost` 与 `ExecutionContext` 的区别。
- 能说出 `getHandler()` 带来的能力（对比 middleware）。

---

### 3.9 Lifecycle events（生命周期事件）

📖 [https://docs.nestjs.com/fundamentals/lifecycle-events](https://docs.nestjs.com/fundamentals/lifecycle-events)

**🎯 知识点**

- 接口：`OnModuleInit`、`OnApplicationBootstrap`、`OnModuleDestroy`、`BeforeApplicationShutdown`、`OnApplicationShutdown`。
- 调用顺序：模块初始化自底向上（依赖优先），`onModuleInit` → `onApplicationBootstrap` → 处理请求 → `onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`。
- **必须显式开启关闭钩子**：`app.enableShutdownHooks()`，否则收不到 `SIGTERM` 等信号。
- 适合做：启动时预热缓存、注册外部任务；关闭时释放连接、flush 日志。
- 不要在 `onModuleInit` 里做重活（阻塞启动）。

**🔍 本仓库对照**

- `src/main.ts` **没有** `enableShutdownHooks()`；练习会加上。
- `AppService` 没有任何生命周期钩子。

**🛠 练习任务**

- [ ] 在 `AppService` 里实现全部 5 个钩子，各打一条日志，`Ctrl+C` 停止服务时观察**关闭阶段**是否打印（先不加 `enableShutdownHooks`）。
- [ ] 在 `main.ts` 加 `app.enableShutdownHooks()`，再 `Ctrl+C` 一次，确认关闭钩子**这次才被触发**。
- [ ] 在 `CatsModule` 和 `AppModule` 各加一个 `onModuleInit` 日志，验证「依赖模块先初始化」。
- [ ] 给 `onModuleInit` 加一个 2 秒的 `await sleep`，确认它**阻塞启动**。

**✅ 自测标准**

- 能说出 5 个钩子的名字和大致顺序。
- 能说出 `enableShutdownHooks()` 的必要性。
- 知道哪些初始化/清理逻辑适合放钩子。

---

### 3.10 Platform agnosticism（平台无关）

📖 [https://docs.nestjs.com/fundamentals/platform-agnosticism](https://docs.nestjs.com/fundamentals/platform-agnosticism)

**🎯 知识点**

- Nest 核心与 HTTP 平台解耦；默认 `@nestjs/platform-express`，可换成 Fastify。
- 换平台只需改 `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())` 并替换平台相关依赖。
- 换平台后，依赖 Express 特性的代码（`@Req()` 里的 Express 类型、`app.use`、Multer 等）会失效 —— 这就是为什么「尽量用 Nest 抽象，少碰底层 `req`」。
- `NestExpressApplication` / `NestFastifyApplication` 泛型用于拿到平台特有的 API。

**🔍 本仓库对照**

- `@nestjs/platform-express` + `@types/express` ^5 已装；`main.ts` 用的是默认 Express 平台。
- 本仓库的 `@Res()`、`app.use()` 练习都属于**平台相关**写法，这章解释它们的代价。

**🛠 练习任务**

- [ ] 阅读本章，列出你在 §2 里写过的**平台相关**代码清单（`@Req()`、`@Res()`、`app.use()`）。
- [ ] 用 `NestFactory.create<NestExpressApplication>(AppModule)` 拿到泛型实例，调用一个 Express 独有方法（如 `app.set('trust proxy', 1)`），验证泛型的作用。
- [ ] **不要**真的切 Fastify（需要装包）—— 只写出切换的完整步骤伪代码。

**✅ 自测标准**

- 能说出换平台的步骤和主要破坏点。
- 能说出为什么业务代码应优先用 Nest 抽象。

---

## 4. 第 3 周：Testing 实战

📖 官方文档：[Unit testing](https://docs.nestjs.com/fundamentals/unit-testing) · [Testing（e2e）](https://docs.nestjs.com/fundamentals/testing)

本仓库**已经有两套测试样板**，这是最好的教材，逐行读。

### 🎯 知识点

- `Test.createTestingModule({...}).compile()` 造一个**只包含声明内容的 DI 容器**，不启动 HTTP 服务。
- 单元测试：`module.get(Service)` 取实例；依赖用 `providers` 原样给，或用 `overrideProvider(X).useValue(mock)` 替换。
- e2e 测试：`moduleFixture.createNestApplication()` + `app.init()`，再用 `supertest` 打真实 HTTP。
- `app.close()` 必须调用，否则 jest 会因句柄未释放而告警/挂住。
- 两套 jest 配置：
  - 单元测试用 `package.json` 里的内联配置：`rootDir: "src"`、`testRegex: ".*\\.spec\\.ts$"`。
  - e2e 用独立文件 `test/jest-e2e.json`：`rootDir: "."`、`testRegex: "\\.e2e-spec\\.ts$"`。
- 覆盖率来源 `collectCoverageFrom: ["**/*.(t|j)s"]`，输出到 `../coverage`（相对 `rootDir: src`）。
- 用 `await app.init()` 而不是 `app.listen()`：不占端口，supertest 直接操作 `app.getHttpServer()`。

### 🔍 本仓库对照

- `src/app.controller.spec.ts`：`beforeAll` 里 `Test.createTestingModule({ controllers: [AppController], providers: [AppService] })`，然后 `app.get(AppController)` 直接调方法。注意它**没有 mock `AppService`**，是「真依赖」的集成式单测。
- `test/app.e2e-spec.ts`：`imports: [AppModule]`（**整个应用**），`INestApplication<App>` 泛型，supertest 断言 200 + 文本。
- `test/jest-e2e.json` 与 `package.json` 的 `jest` 字段是两套独立配置。

### 🛠 练习任务

- [ ] 逐行读 `src/app.controller.spec.ts`，在纸上标注每一行的作用（容器、取实例、断言）。
- [ ] 用 `overrideProvider(AppService).useValue({ getHello: () => 'mocked' })` 重写这个 spec，让它在**不依赖真实 `AppService`** 的情况下通过，体会 mock 的意义。
- [ ] 给 §2.5 的 `HttpExceptionFilter` 写单元测试：构造一个假 `ArgumentsHost`（`switchToHttp` 返回带 `getResponse` 的对象），断言 `res.status().json()` 被正确调用。
- [ ] 给 §2.7 的 `AuthGuard` 写单元测试：假 `ExecutionContext` 覆盖「有正确 header → true」和「无 header → 抛 401」两条路径。
- [ ] 给 `test/app.e2e-spec.ts` 补用例：404、400（管道校验失败）、401（guard 拒绝）、响应包装后的结构。
- [ ] 跑 `npm run test:cov`，打开 `coverage/` 的 HTML 报告，找出**未被覆盖**的分支并补测。
- [ ] 故意删掉 e2e 里的 `app.close()`，观察 jest 的提示信息，然后加回来。
- [ ] 在 `src/` 下新建一个 `*.e2e-spec.ts`，用 `npm run test` 跑一次，确认它**不会**被单元测试配置匹配到（`rootDir`/`testRegex` 的作用）。

### ✅ 自测标准

- 能默写单元测试与 e2e 测试的模板代码。
- 能说出 `overrideProvider` 的三种用法（`useValue` / `useClass` / `useFactory`）。
- 能解释两份 jest 配置为什么会互相隔离。
- 知道 `app.close()` 为什么不能省。

---

## 5. 第 4 周：常用非数据库技巧（选学，按需）

> 本章每个小节都标注了**需要安装的包**；本仓库当前**均未安装**。仍然**不涉及数据库**。

### 5.1 Configuration（配置）

📖 [https://docs.nestjs.com/techniques/configuration](https://docs.nestjs.com/techniques/configuration) · 已装 `@nestjs/config@4`

- `ConfigModule.forRoot({ isGlobal: true })` + 根目录 `.env`；`ConfigService.get('PORT')` / `getOrThrow('X')`。
- 类型化配置：`registerAs('db', () => ({...}))` + `ConfigService.get('db.host')` / `ConfigType<typeof ...>`。
- 启动时校验：`validate` 选项（配 `class-validator` 或 `joi`）。
- `.env` **必须**进 `.gitignore`；用 `.env.example` 提交模板。
- 🔍 **本仓库对照**：`src/config/`（5 个 namespace：`app` / `swagger` / `cors` / `throttle` / `database`），
  完整说明见 [`docs/configuration.md`](configuration.md)。三个值得注意的结论：
  - `ConfigModule.forRoot()` 是 **async** 且在**模块定义时**执行校验 —— 校验失败会走 Nest 内部的
    `ExceptionHandler`（一行带堆栈的 ERROR），**不经过 `bootstrap().catch`**；所以本仓库把
    `validateEnv(process.env)` 放在 `main.ts` 的第一行显式调用；
  - 默认值只在 `read*Config()` 里，校验器不注入默认值 —— 避免"两处默认值漂移"；
  - `@nestjs/config` 目前必须锁 `^4.0.4`（12.x 是 ESM-only，本仓库是 CJS → TS1479）。
- 练习（均已完成）：
  - [x] 安装 `@nestjs/config`，把 `main.ts` 里硬编码的 `3000` 改成配置里的 `app.port`。
  - [x] 建 `.env.example`，确认 `.env` / `.env.local` 已被 `.gitignore` 忽略（`.env.*` + `!.env.example`）。
  - [x] 用 `registerAs` 写命名空间配置，并带类型使用（`AppConfig` / `SwaggerConfig` / `DatabaseConfig` …）。
  - [x] 让不合法的配置值**启动失败**：`PORT=abc node dist/main` → 非零退出 + 多行问题清单。
  - [ ] 进阶（未做）：`ConfigModule.forRoot({ validate })` 与"入口显式校验"的取舍，见
    `docs/configuration.md` §5.1 —— 想自己验证的话，把它接回去跑一次 `PORT=abc node dist/main`，
    观察错误形态的差别。

### 5.2 Validation（校验）

📖 [https://docs.nestjs.com/techniques/validation](https://docs.nestjs.com/techniques/validation) · 需装 `class-validator`、`class-transformer`、`@nestjs/mapped-types`

- DTO 类 + 装饰器：`@IsString()`、`@IsInt()`、`@Min()`、`@IsOptional()`、`@IsEmail()`、`@Length()`。
- 全局 `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`。
- 三个常用开关的含义：`whitelist`（剥掉未声明字段）、`forbidNonWhitelisted`（多字段直接 400）、`transform`（把 payload 变成 DTO 实例）。
- `@nestjs/mapped-types` 的 `PartialType` / `PickType` / `OmitType` / `IntersectionType` 复用 DTO（`nest g resource` 生成的 Update DTO 就是 `PartialType(CreateXDto)`）。
- 自定义校验：`@ValidatorConstraint()` + `registerDecorator`。
- 练习：
  - [ ] 装包并把 `ValidationPipe` 注册为全局，用 `curl` 给一个 `@Post` 发非法 body，观察 400 的 `message` 数组结构。
  - [ ] 写 `CreateCatDto`，加 3 个校验装饰器，并分别测试通过/失败。
  - [ ] 打开 `whitelist` 前后各发一次多余字段，对比是「被剥掉」还是「400」。
  - [ ] 用 `PartialType` 手写一遍 `UpdateCatDto`，与 `nest g resource` 生成版对比。
  - [ ] 写一个自定义校验器（如「名字不能叫 admin」）并注册使用。

### 5.3 Serialization（序列化）

📖 [https://docs.nestjs.com/techniques/serialization](https://docs.nestjs.com/techniques/serialization) · 需装 `class-transformer`（随 5.2）

- `ClassSerializerInterceptor` + `class-transformer` 的 `@Exclude()` / `@Expose()` / `@Transform()` 控制响应字段。
- 经典用途：把 `password` 这类字段从响应里**始终**剔除。
- `@SerializeOptions()` 可设置 `excludeExtraneousValues` 等。
- 练习：
  - [ ] 写一个 `UserDto`，给 `password` 加 `@Exclude()`，用 `ClassSerializerInterceptor` 验证它不出现在响应里。
  - [ ] 用 `@Transform(({ value }) => value.toUpperCase())` 处理一个字段。
  - [ ] 说明它与 §5.2「入参校验」的方向差异（一个是**入**，一个是**出**）。

### 5.4 Logger（日志）

📖 [https://docs.nestjs.com/techniques/logger](https://docs.nestjs.com/techniques/logger)

- 用内置 `Logger`（`new Logger(Ctx.name)`）替代 `console.log`；Nest 启动日志也用同一套。
- `app.useLogger(customLogger)` 替换全局实现（对接 pino/winston 的入口）。
- 日志级别、生产环境输出 JSON 的思路。
- **回到 §1**：`main.ts` 里的 `console.log(error)` 应该改成 `Logger.error` + `process.exit(1)`。
- 练习：
  - [ ] 把仓库里所有 `console.log` 换成 `Logger`，观察输出格式变化（含时间戳和上下文）。
  - [ ] 写一个自定义 `LoggerService implements LoggerService`，只保留 `error` 输出，用 `app.useLogger()` 挂上。
  - [ ] 顺便修掉 §1 那个吞掉启动错误的写法。

### 5.5 错误处理实践

📖 参考 §2.5 [/exception-filters](https://docs.nestjs.com/exception-filters)

- 业务异常继承 `HttpException`，形成自己的异常族（`InsufficientBalanceException` 等）。
- 全局 filter 统一响应结构，输出稳定的 `code`/`message`/`traceId`。
- 区分「可暴露给客户端的信息」与「内部细节」——永远不要把堆栈返回给客户端。
- 练习：
  - [x] 定义 2 个业务异常类，都继承 `HttpException`。（`src/modules/validation-demo/exceptions.ts`：409 / 404）
  - [x] 让全局 filter 输出统一结构，并保证 500 情况下**不返回堆栈**。
  - [x] 把 §2.8 的 `TransformInterceptor` 与统一错误结构对齐，让**成功与失败的响应形状一致**。
        （成功 `{ success: true, data, meta? }`，失败 `{ success: false, error, message, errors? }`，数字状态码留在 HTTP 状态行，见 `docs/validation.md` §9）

### 5.6 OpenAPI / Swagger

📖 [https://docs.nestjs.com/openapi/introduction](https://docs.nestjs.com/openapi/introduction) · [CLI 插件](https://docs.nestjs.com/openapi/cli-plugin)（本仓库已实现，见 `src/swagger/`）

- `DocumentBuilder` + `SwaggerModule.createDocument` + `SwaggerModule.setup('docs', app, doc)`。
- 用 `@ApiProperty()` 描述 DTO；`@ApiTags()`、`@ApiOperation()`、`@ApiResponse()` 描述接口。
- **CLI 插件**（推荐）：在 `nest-cli.json` 加 `"plugins": ["@nestjs/swagger"]`，class-validator 的约束与注释自动变成 schema。
- 练习：
  - [x] 装包，在 `main.ts` 挂文档，访问 `http://localhost:3000/docs` 看到 UI。（`setupSwagger(app)`；按环境启停见 `is-swagger-enabled.ts`）
  - [x] 给一个 DTO 加 `@ApiProperty`，对比 UI 上的 schema 变化。
  - [x] 配置 CLI 插件后重启，确认手写的 `@ApiProperty` 可以删掉仍然有 schema。（仍保留少数显式写入：枚举、分页、以及契约层的信封投影 —— 见 `docs/validation.md` §9.7）
  - [x] 让 e2e 里的文档与构建产物一致：`jest-e2e.json` 里给 ts-jest 挂 `astTransformers`，桥接文件是仓库根的 `jest-swagger-transformer.js`。

### 5.7 Caching（缓存）

📖 [https://docs.nestjs.com/techniques/caching](https://docs.nestjs.com/techniques/caching) · 需装 `@nestjs/cache-manager`（+ `cache-manager`）

- `CacheModule.register({ ttl, max })`（内存实现，**不涉及数据库**）。
- `CacheInterceptor` + `@CacheKey()` + `@CacheTTL()` 自动缓存 GET 响应。
- `CACHE_MANAGER` 注入后手动 `get`/`set`/`del`。
- 练习：
  - [ ] 起一个带 `await sleep(1000)` 的路由，对比开启 `CacheInterceptor` 前后的响应时间。
  - [ ] 用 `@CacheKey()` / `@CacheTTL()` 覆盖默认行为。
  - [ ] 用 `CACHE_MANAGER` 手动实现「写操作后失效缓存」。

### 5.8 安全基础（不含认证体系实现）

📖 [CORS](https://docs.nestjs.com/security/cors) · [Helmet](https://docs.nestjs.com/security/helmet) · [Rate limiting](https://docs.nestjs.com/security/rate-limiting) · [CSRF](https://docs.nestjs.com/security/csrf) · [Encryption and Hashing](https://docs.nestjs.com/security/encryption-and-hashing)

- `app.enableCors({ origin: [...], credentials: true })`；预检请求 `OPTIONS` 的处理。
- `helmet`（需装）守一批安全响应头。
- 限流 `@nestjs/throttler`（需装）：`ThrottlerModule.forRoot([{ ttl, limit }])` + `{ provide: APP_GUARD, useClass: ThrottlerGuard }` —— **这是 §2.7 和 §3.1 的组合应用**。
- CSRF 的适用场景（cookie 会话 vs Bearer token）；`csurf` 已废弃，改为 `csrf-csrf` 等方案。
- 加密与哈希：`crypto`/`bcrypt` 概览 —— 认证体系（Passport、JWT）属于下一阶段。
- 练习：
  - [ ] 开启 CORS 并用 `curl -H 'Origin: http://example.com' -i` 观察 `Access-Control-Allow-Origin`。
  - [ ] 装 `helmet`，对比开启前后响应头差异。
  - [ ] 装 `@nestjs/throttler`，把 limit 设成 3，用 `for i in {1..5}` 快速请求，观察第 4 次返回 **429**。

### 5.9 Versioning（API 版本控制）

📖 [https://docs.nestjs.com/techniques/versioning](https://docs.nestjs.com/techniques/versioning)

- `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })` + `@Version('1')` / `@Version(['1','2'])`。
- 也支持 `HEADER` / `MEDIA_TYPE` / `CUSTOM` 类型。
- 练习：
  - [ ] 开启 URI 版本控制，确认路由变成 `/v1/...`。
  - [ ] 给同一路由加两个版本并返回不同内容，用 `curl` 分别验证。

### 5.10 可选拓展（有余力再学）

- **File upload** 📖 [/techniques/file-upload](https://docs.nestjs.com/techniques/file-upload) — `FileInterceptor` + `@UploadedFile()` + Multer。练习：做一个接收单个文件并回显大小的接口。
- **HTTP module** 📖 [/techniques/http-module](https://docs.nestjs.com/techniques/http-module) — 需装 `@nestjs/axios`；用它去请求一个公开 API，练习 `HttpService` 的 Observable 用法。
- **Task scheduling** 📖 [/techniques/task-scheduling](https://docs.nestjs.com/techniques/task-scheduling) — 需装 `@nestjs/schedule`；`@Cron()` / `@Interval()` + `ScheduleModule.forRoot()`。练习：每秒打一条日志。
- **Server-Sent Events** 📖 [/techniques/server-sent-events](https://docs.nestjs.com/techniques/server-sent-events) — `@Sse()` + `Observable`，**这是 §2.8 学 RxJS 的最好回报**。练习：做一个每秒推送一次时间的 `@Sse('clock')`。

---

## 6. 明确不学（本阶段跳过）

| 主题 | 是什么 | 什么时候学 |
| --- | --- | --- |
| **Database**、TypeORM / Prisma / Mongoose / MikroORM | 数据持久化 | 本计划完成后**第一件事**；届时只需学「Repository/DTO 映射」+ 事务 |
| GraphQL | 另一种 API 风格（`@nestjs/graphql`） | 需要 schema-first 接口时 |
| WebSockets / SSE 之外的实时通信 | 双向长连接（`@nestjs/websockets`） | 需要推送/聊天时 |
| Microservices | 跨进程通信（`@nestjs/microservices`） | 拆分服务时 |
| CQRS / 事件溯源 | 架构模式（`@nestjs/cqrs`） | 业务复杂度上来后 |
| 消息队列（BullMQ 等） | 异步任务 | 需要削峰/延迟任务时 |
| Deployment / Devtools / Mau | 上线与调试 | 准备上线时 |

> 说明：以上都建立在**本计划的 §2–§4** 之上。跳过它们不影响你写出一个完整的、可测的 REST 服务。

---

## 7. 进度总表

### 7.1 勾选汇总

| 阶段 | 章节 | 完成 |
| --- | --- | --- |
| 第 0 周 | §1 基线与工具链 | [ ] |
| 第 1 周 | §2.1 Controllers | [ ] |
| 第 1 周 | §2.2 Providers | [ ] |
| 第 1 周 | §2.3 Modules | [ ] |
| 第 1 周 | §2.4 Middleware | [ ] |
| 第 1 周 | §2.5 Exception filters | [ ] |
| 第 1 周 | §2.6 Pipes | [ ] |
| 第 1 周 | §2.7 Guards | [ ] |
| 第 1 周 | §2.8 Interceptors | [ ] |
| 第 1 周 | §2.9 Custom decorators | [ ] |
| 第 1 周 | §2.10 请求生命周期总览 | [ ] |
| 第 2 周 | §3.1 Custom providers | [ ] |
| 第 2 周 | §3.2 Asynchronous providers | [ ] |
| 第 2 周 | §3.3 Dynamic modules | [ ] |
| 第 2 周 | §3.4 Injection scopes | [ ] |
| 第 2 周 | §3.5 Circular dependency | [ ] |
| 第 2 周 | §3.6 Module reference | [ ] |
| 第 2 周 | §3.7 Lazy-loading modules | [ ] |
| 第 2 周 | §3.8 Execution context | [ ] |
| 第 2 周 | §3.9 Lifecycle events | [ ] |
| 第 2 周 | §3.10 Platform agnosticism | [ ] |
| 第 3 周 | §4 Testing 实战 | [ ] |
| 第 4 周 | §5 常用非 DB 技巧（选学） | [ ] |

### 7.2 学完后的自测问题

- [ ] 默写请求处理链的 7 个阶段。
- [ ] `@Module()` 四个字段各是什么？provider 不 export 会怎样？
- [ ] Guard / Middleware / Interceptor 三者能拿到什么、不能拿到什么？
- [ ] 401 与 403 分别在什么场景返回？
- [ ] 管道校验失败抛什么异常、变成几号状态码？
- [ ] `useClass` 与 `useExisting` 的区别？
- [ ] 默认作用域是什么？REQUEST 作用域的性能代价？
- [ ] `forwardRef` 解决什么？更好的替代方案是什么？
- [ ] `enableShutdownHooks()` 不做会怎样？
- [ ] 单元测试与 e2e 测试各自的 `Test.createTestingModule` 写法？
- [ ] `overrideProvider` 怎么用？
- [ ] `ValidationPipe` 的 `whitelist` 与 `forbidNonWhitelisted` 区别？
- [ ] 怎么把 `password` 从响应里永久剔除？
- [ ] `@nestjs/config` 的 `registerAs` + 类型化访问怎么写？
- [ ] 统一响应包装和统一错误响应分别用哪一层？
- [ ] Express 5 下 `@Get('*')` 为什么会失败？
- [ ] 本仓库产物是 CJS 还是 ESM？判断依据是什么？
- [ ] `emitDecoratorMetadata` 关掉会发生什么？
- [ ] 怎么用一个装饰器同时完成「声明角色 + 挂 guard」？
- [ ] 想给每个接口加限流，最少的代码改动是什么？
