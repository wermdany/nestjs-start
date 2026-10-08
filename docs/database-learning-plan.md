# 数据库学习计划（从零开始 · 面向 nestjs-start）

> **这份文件解决一个问题**：你**从来没有学过数据库**，机器上也没装过数据库，
> 而 `nestjs-learning-plan.md` / `learning-next.md` 里关于数据库的部分全是
> "先做 Repository 端口再说"「明确跳过」这类**结论**，没有一条路径告诉你**第一周该干什么**。
>
> **定位**：不是替代 [learning-next.md](learning-next.md)，而是它的**前置补课**。
> 那份文件负责「接回 NestJS 时怎么做」；本文负责「**在你还不认识数据库的时候，从哪下手、怎么验收**」。
>
> **实测基线**（2026-09-26，本机）：macOS 15.6.1 (arm64)、Node v25.9.0、
> `sqlite3` **3.43.2 系统自带**、`node:sqlite` **内置可用**（实测建表/插入/查询通过）、
> Docker **29.6.1 + Compose v5.3.0 已装但守护进程未启动**、Homebrew 7.0.6、
> **没有 `psql` / `mysql` 客户端**、磁盘余量 283 GB。
>
> **范围**：关系型数据库 **SQL 基础 → 建模与约束 → 事务与并发 → 接回 NestJS**。
> 分库分表、主从复制、NoSQL、性能调优按 §6 明确跳过。

---

## 0. 使用说明

### 0.1 适合谁

- **完全零基础**：没写过一行 SQL，没装过数据库，分不清 MySQL / Postgres / SQLite；
- 已经会一点 TypeScript / NestJS（本仓库的水平就够）；
- 目标不是"成为 DBA"，而是**能自己建模、能读懂 `EXPLAIN`、能把数据库接进一个 Nest 服务并对并发正确**。

### 0.2 先破除三个误解（不然会在第一周就放弃）

| 误解 | 事实 |
| --- | --- |
| "我得先装 MySQL/Postgres 才能学" | **不用**。你机器上已经有 `sqlite3`（系统自带）和 Node 内置的 `node:sqlite` —— 前两周**零安装**就能学完 SQL 与建模 |
| "数据库很难，要先把理论学完" | 反了。**先跑起来再补理论**：第一天就能建表查到数据，理论（范式、隔离级别）在第 2–3 周才需要，而且那时你已经有直觉了 |
| "SQL 是上古遗物，ORM 会替我写" | ORM 生成的 SQL 出问题时**只有你能看懂它**；而且本仓库最值钱的一条数据库知识（唯一约束 vs 先查后写）恰恰是 ORM 藏起来的那层 |

### 0.3 两种数据库，先搞清你要学哪种

| | 嵌入式（SQLite） | 客户端-服务端（Postgres / MySQL） |
| --- | --- | --- |
| 形态 | 一个**文件**，进程内直接打开 | 一个**常驻服务**，通过网络连 |
| 安装 | 你已经有了 | Docker 一行命令（§4.1） |
| 适合学 | SQL 语法、建模、约束、索引、事务基础 | **并发、隔离级别、连接池、用户权限、真正的迁移** |
| 本仓库对应 | `DATABASE_DRIVER=sqlite`（**已支持**，`DATABASE_NAME` 就是文件路径） | `DATABASE_DRIVER=postgres`（契约已立好） |
| 局限 | 单写者、类型弱（可用 `STRICT` 表补救）、没有真正的并发 | 要管服务、端口、密码、数据卷 |

**所以路线是**：第 1–2 周用 SQLite（零安装、专注 SQL 本身），第 3 周起用 Docker 里的 Postgres（学并发与"真"数据库）。**不要一上来就装 Postgres** —— 你会把时间花在 Docker/端口/密码上，而不是 SQL 上。

### 0.4 每一章的固定结构

沿用 [nestjs-learning-plan.md](nestjs-learning-plan.md) 的约定，不另造一套：

| 段落 | 含义 |
| --- | --- |
| 🎯 知识点 | 这一章必须掌握的概念清单 |
| 🔍 本机/本仓库对照 | 概念对应你机器上的哪条命令、仓库里的哪个文件 |
| 🛠 练习任务 | `- [ ]` 复选框，**自己动手敲**；本文不含可直接粘贴的"答案代码" |
| ✅ 自测标准 | 达到什么程度算过关（都能用命令验证） |

### 0.5 进度怎么记

```bash
grep -c '^- \[x\]' docs/database-learning-plan.md   # 已完成
grep -c '^- \[ \]' docs/database-learning-plan.md   # 未完成
```

### 0.6 四周节奏（每周 5–8 小时）

| 周 | 内容 | 用什么 | 对应章节 |
| --- | --- | --- | --- |
| 第 0 周（半天） | 心智模型 + 把库跑起来 | SQLite（内置） | §1 |
| 第 1 周 | SQL 基础 | SQLite | §2 |
| 第 2 周 | 建模、约束、索引 | SQLite | §3 |
| 第 3 周 | 事务、并发、隔离级别 | **Docker Postgres** | §4 |
| 第 4 周 | 接回 NestJS（Repository 端口 → 适配器 → 迁移） | 两者都用 | §5 |

> **如果你今天只有 10 分钟**，就做 §1.3 的第一个练习：在内存库建一张 `users` 表、插一行、查出来。
> 剩下的计划等你亲眼看过"数据真的存下来了"再读。

---

## 1. 第 0 周：把"数据库"落到实处

### 🎯 知识点

- **为什么不用 JSON / CSV 文件**：三个真实痛点 ——
  ① 并发写会**丢数据**（两个进程同时读-改-写）；② 写到一半断电会**留下半个文件**（没有原子性）；
  ③ 想查"age > 30 且 role = admin"必须**把整个文件读进内存**自己过滤。
  数据库存在的意义就是替你解决这三件事：**并发控制、原子性、按条件高效检索**。
- **关系模型**：数据放在**表**里，表由**行**（一条记录）和**列**（字段）组成；
  每行靠**主键**唯一标识；表之间靠**外键**建立关系。
- **SQL 是声明式的**：你写「**要什么**」（`WHERE age > 30`），
  数据库的**查询规划器**决定「**怎么取**」（用哪个索引、先扫哪张表）。
  这是它和 `array.filter()` 最本质的区别 —— 也是为什么**索引**能起作用。
- **嵌入式 vs 客户端-服务端**（见 §0.3 的表）。
- **数据库 / 库（database） vs 表（table） vs 行/列** 的层级关系：
  一个 Postgres 服务里有多个 database，一个 database 里有多个 table。SQLite 一个文件就是一个 database。

### 🔍 本机对照

| 你机器上的东西 | 怎么用 | 实测状态 |
| --- | --- | --- |
| `/usr/bin/sqlite3` | 交互式 SQL 命令行，**学 SQL 的主力工具** | 3.43.2 系统自带 ✅ |
| `node:sqlite`（Node 内置） | 在 JS/TS 里跑 SQL，**不装任何 npm 包** | Node 25.9.0 实测可用 ✅ |
| Docker + Compose | 第 3 周起跑 Postgres | 已装，**守护进程未启动** ⚠️ |
| Homebrew | 装 `psql` 客户端等（**不是必需**） | 7.0.6 ✅ |
| `psql` / `mysql` 客户端 | **没有，也不需要** —— 用 `docker compose exec db psql` | 未安装 |

> ⚠️ 一条你迟早会撞上的坑：**macOS 自带的 SQLite 与 Homebrew 装的不是同一个**。
> 别 `brew install sqlite` —— 你现在这个 `/usr/bin/sqlite3` 已经够用，装第二个只会让
> `which sqlite3` 变得含糊。

### 🛠 练习任务

- [ ] 打开交互式 SQL 命令行，确认版本与"语法模式"：

  ```bash
  sqlite3 :memory:            # 内存库：退出即消失，最适合练手
  .version                    # → 3.43.2
  .help                       # 看一眼有哪些 dot 命令（都带 . 前缀）
  .quit
  ```

- [ ] 在内存库建第一张表并查出来（**今天必须完成的那个练习**）：

  ```sql
  CREATE TABLE users (
    id    INTEGER PRIMARY KEY,
    name  TEXT    NOT NULL,
    email TEXT    NOT NULL UNIQUE
  );
  INSERT INTO users (name, email) VALUES ('Neo', 'neo@example.com');
  SELECT * FROM users;
  ```
  验证：`.tables` 列出 `users`；`.schema users` 打印出你刚才写的那段 DDL。

- [ ] 把它落成**文件**再打开一次，体会"库就是一个文件"：

  ```bash
  sqlite3 /tmp/learn.db "CREATE TABLE t(x); INSERT INTO t VALUES (1);"
  sqlite3 /tmp/learn.db "SELECT * FROM t;"     # → 1（数据还在）
  ls -l /tmp/learn.db                          # 就是一个普通文件
  ```

- [ ] **亲手看到 JSON 文件为什么不够用**：开两个终端，各自循环
      "读文件 → 加一条 → 写回"，跑几百次，然后数一下最终条数 —— 你会看到**少了一些**。
      （用 SQLite 做同样的事不会丢。）这个实验比任何解释都有说服力。

- [ ] 用 Node 内置的 `node:sqlite` 跑一次上面第一条 SQL（不装任何包）：

  ```js
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  db.prepare('INSERT INTO users (name) VALUES (?)').run('Neo');
  console.log(db.prepare('SELECT * FROM users').all());
  ```

- [ ] 打开 [SQLBolt](https://sqlbolt.com/) 做完**前 6 课**（浏览器里交互，零安装）。
      看不懂的先跳过，第 1 周会逐个讲。

### ✅ 自测标准

- 能说出"用 JSON 文件当数据库"的三个具体问题，以及数据库分别怎么解决。
- 能解释 `sqlite3 :memory:` 与 `sqlite3 /tmp/learn.db` 的区别。
- 知道本仓库的 `DATABASE_DRIVER` 支持哪四个取值，以及 `sqlite` 为什么只需要 `DATABASE_NAME`。

---

## 2. 第 1 周：SQL 基础（SQLite，零安装）

> 本阶段**全部练习都用同一张 `users` 表** —— 它的字段就是本仓库
> [user.dto.ts](../src/modules/validation-demo/user.dto.ts) 的 `UserDto`。
> 这样你学的每一条 SQL，第 4 周都能原样搬回项目里。

先用下面这段建表（**故意先不带约束**，约束在第 2 周补）：

```sql
-- 建议：在一个文件库里练，这样能跨会话保留数据
-- sqlite3 ~/learn/users.db
CREATE TABLE users (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL,
  age   INTEGER,
  role  TEXT NOT NULL
);
INSERT INTO users (name, email, age, role) VALUES
  ('Neo',     'neo@example.com',     30, 'admin'),
  ('Trinity', 'trinity@example.com', 28, 'editor'),
  ('Morpheus','morpheus@example.com', NULL, 'viewer');
```

### 2.1 查询：SELECT / WHERE / ORDER BY / LIMIT

**🎯 知识点**

- `SELECT 列 FROM 表 WHERE 条件 ORDER BY 列 [ASC|DESC] LIMIT n OFFSET m` —— 这是 SQL 的骨架。
- 逻辑顺序 ≠ 书写顺序：`FROM → WHERE → SELECT → ORDER BY → LIMIT`。
  （所以 `WHERE` 里**不能**用 `SELECT` 起的别名，`ORDER BY` 里**可以**。）
- 比较与逻辑：`= != <> > >= < <=`、`AND OR NOT`、`BETWEEN`、`IN (...)`、`LIKE '%neo%'`。
- `COUNT(*)` / `COUNT(列)`（**后者不数 NULL**）/ `MIN` / `MAX` / `AVG` / `SUM`。
- 别名：`SELECT name AS 姓名`（**列别名会影响 JSON 的键名** —— 这是第 4 周会踩的坑）。

**🔍 本仓库对照**

- [pagination-query.dto.ts](../src/system/pagination/pagination-query.dto.ts) 的
  `page` / `limit` / `sortBy` 最终就是 `LIMIT` / `OFFSET` / `ORDER BY`。
  `(page - 1) * limit` 这个偏移量算法现在写在内存里（[validation-demo.service.ts:73](../src/modules/validation-demo/validation-demo.service.ts#L73)），
  上数据库后由你写进 SQL。

**🛠 练习任务**

- [ ] 查出所有 `admin`，按 `age` 倒序。
- [ ] 查出 `age` 在 25 到 35 之间的人（分别用 `BETWEEN` 和 `>= AND <=` 各写一遍）。
- [ ] 用 `LIKE` 找出邮箱以 `neo` 开头的人。
- [ ] 把 `page=2&limit=1`（第二页、每页 1 条）翻译成 `LIMIT 1 OFFSET 1`，并解释为什么是 1 不是 2。
- [ ] `SELECT COUNT(*)` 与 `SELECT COUNT(age)` 各跑一次，**解释结果为什么不同**（有一条 `age` 是 NULL）。
- [ ] 统计每个 `role` 各有多少人：`SELECT role, COUNT(*) FROM users GROUP BY role;`
- [ ] 用 `HAVING` 筛出"人数 ≥ 1 的角色"，想清楚 `WHERE` 与 `HAVING` 的分工。

**✅ 自测标准**

- 能默写一个带 `WHERE` + `ORDER BY` + `LIMIT/OFFSET` 的查询，并说出它的实际执行顺序。
- 能解释 `COUNT(*)` 与 `COUNT(列)` 的差别。
- 能说出 `WHERE` 与 `HAVING` 的区别（一个过滤**行**，一个过滤**组**）。

### 2.2 NULL：新手第一个大坑

**🎯 知识点**

- **`NULL` 不是 0、不是空字符串，是"未知"**。
- 所以 **`WHERE age = NULL` 永远不返回任何行**，必须写 `IS NULL` / `IS NOT NULL`。
  原因：任何与"未知"的比较结果还是"未知"，而"未知"不算通过。
- `NULL` 参与运算/聚合时的传染性：`1 + NULL = NULL`；`AVG` / `SUM` 会**忽略** NULL。
- 三值逻辑：`TRUE` / `FALSE` / `UNKNOWN`。`NOT (NULL = 1)` 也是"未知"，不是 true。

**🔍 本仓库对照**

- 这正是本仓库 `@IsOptionalNotNull()` 存在的理由（[is-optional-not-null.decorator.ts](../src/system/http-validation/is-optional-not-null.decorator.ts)）：
  class-validator 的 `@IsOptional()` 官方语义是"值为 `null` **或** `undefined` 时跳过所有校验"，
  所以在**入库前**就会放行 `null`，最终让 `null` 击穿 schema（review-backlog §1.2 实测过）。
- **一句话记住**：API 层的"字段可以不存在"与数据库层的"值是未知"，是**两个不同的概念**。
  想清楚"清空"到底应该存 `NULL`、空字符串、还是空数组 —— 这是建模决策，不是细节。

**🛠 练习任务**

- [ ] 分别跑 `SELECT * FROM users WHERE age = NULL;`（返回 0 行）与 `... WHERE age IS NULL;`（返回 Morpheus），
      把两个结果贴进笔记。
- [ ] 用 `COALESCE(age, 0)` 把 NULL 显示成 0，说明它和 `IFNULL` 的关系。
- [ ] 故意不写 `age` 插一行，看它是 `NULL` 还是报错（答案：`NULL`，因为列允许空且没有默认值）。
- [ ] 思考并写下：本仓库的 `PATCH /users/:id` 收到 `{"age": null}` 时，数据库里应该发生什么？
      （**没有标准答案**，但你必须能说出自己选的语义与代价。）[验证：仓库现在会 400]

**✅ 自测标准**

- 能解释为什么 `= NULL` 不成立，以及什么时候必须用 `IS NULL`。
- 能说出 `COUNT(*)` / `COUNT(列)` / `AVG(列)` 对 NULL 的三种不同处理。

### 2.3 写入：INSERT / UPDATE / DELETE

**🎯 知识点**

- `INSERT INTO t (a, b) VALUES (1, 2)`；一次插多行用逗号分隔。
- `UPDATE t SET a = 1 WHERE 条件` —— ⚠️ **忘了 WHERE 会改整张表**（生产事故的经典形态）。
  习惯：**先写 `SELECT` 确认影响范围，再把它改写成 `UPDATE`**。
- `DELETE FROM t WHERE 条件` —— 同样先 `SELECT` 后 `DELETE`。
- `RETURNING`（SQLite 3.35+ / Postgres 都支持）：
  `INSERT ... RETURNING id` 能直接拿到刚生成的 id，
  比"插入后再查一次"更安全（并发下后者可能拿到别人的行）。
- 主键自增：`INTEGER PRIMARY KEY`（SQLite 里它就是 rowid 的别名）；Postgres 用 `GENERATED ... AS IDENTITY`。

**🔍 本仓库对照**

- [validation-demo.service.ts](../src/modules/validation-demo/validation-demo.service.ts) 的
  `create` / `update` / `findOne` 就是这三条语句的手写版本，
  其中 `this.nextId++` 将来会被数据库的自增主键**整个替掉**（`nextId` 是单例内存里的假 id）。

**🛠 练习任务**

- [ ] 插一行新用户，用 `RETURNING id` 打印新 id。
- [ ] 把 Morpheus 的 `age` 改成 40；**改之前先 `SELECT` 一遍确认只有一行会被影响**。
- [ ] 故意执行一次**没有 WHERE** 的 `UPDATE`（在一个临时表上做），再 `SELECT` 看整张表被改了什么。
      把这条记成规则：**危险语句先在副本上试**。
- [ ] 删掉一条，再用 `COUNT(*)` 确认少了 1 行。
- [ ] 用 `BEGIN; ... ROLLBACK;` 包住一次 `DELETE`，观察回滚后数据还在（这是第 3 章的预演）。

**✅ 自测标准**

- 能说出改写语句前必须先做什么，以及为什么。
- 能解释 `RETURNING` 相比"插入后再查"的优势。
- 知道主键应该由谁生成（**数据库**，不是应用里的 `nextId++`）。

### 2.4 JOIN：把两张表连起来

**🎯 知识点**

- 为什么要拆表：`tags`、`address` 这类多值/嵌套字段塞进一行会**没法索引、没法统计**。
- `INNER JOIN`：只保留两边都匹配上的行；`LEFT JOIN`：保留左表全部，右表缺失处为 NULL。
- `JOIN ... ON a.user_id = b.id`；**忘记 `ON` 会笛卡尔积**（行数相乘，是大表上的灾难）。
- 一对多（一个用户多个 tag）→ 子表加外键列；多对多 → 中间表（`user_tags`）。

**🔍 本仓库对照**

- `UserDto` 里有 `tags: string[]` 和嵌套的 `address: { city, ... }` ——
  **这正是初学者最常建模错的两个字段**，第 3 章 §3.2 会专门解决。
- 现在内存实现里 `findAll` 靠 `[...this.users.values()].filter(...)`（[第 68-71 行](../src/modules/validation-demo/validation-demo.service.ts#L68-L71)），
  上数据库后就变成 `WHERE` + `JOIN`。

**🛠 练习任务**

- [ ] 新建 `user_tags(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, tag TEXT NOT NULL)`，
      给 Neo 加 `founder`、`hacker` 两个标签，给 Trinity 加 `matrix`。
- [ ] `INNER JOIN` 查出"每个 tag 属于谁"。
- [ ] `LEFT JOIN` 查出所有用户及其标签 —— 观察没有标签的用户那一行 `tag` 是 NULL（**这是 LEFT JOIN 的标志**）。
- [ ] 用 `GROUP BY user_id` + `COUNT(tag)` 统计每人有几个标签。
- [ ] 故意写一个**不带 `ON`** 的 JOIN，看行数变成多少（3 用户 × 5 标签 = 15 行），
      把"笛卡尔积"这个词和现象绑在一起。

**✅ 自测标准**

- 能说出 INNER / LEFT JOIN 的差别，以及什么时候必须用 LEFT。
- 能画出"用户-标签"的表结构（含外键），并解释为什么不把 tags 塞进一行。
- 知道忘写 `ON` 会发生什么。

---

## 3. 第 2 周：建模与约束（把 `UserDto` 变成表）

> 这一周的目标：**让数据库自己保证数据是对的**。
> 现在本仓库把"邮箱不能重复"放在应用层（`assertEmailAvailable()`），
> 第 3 章会证明这在并发下是**错的**。约束是数据库最被低估的能力。

### 3.1 键与约束

**🎯 知识点**

| 约束 | 作用 | 例子 |
| --- | --- | --- |
| `PRIMARY KEY` | 唯一标识一行；隐含 NOT NULL + UNIQUE；建索引 | `id INTEGER PRIMARY KEY` |
| `UNIQUE` | 该列/列组合不允许重复（**可以有多个 NULL**） | `email TEXT NOT NULL UNIQUE` |
| `NOT NULL` | 不允许未知值 | `role TEXT NOT NULL` |
| `DEFAULT` | 不写时的默认值 | `created_at ... DEFAULT (datetime('now'))` |
| `CHECK` | 值必须满足表达式 | `CHECK (role IN ('admin','editor','viewer'))` |
| `FOREIGN KEY` | 引用另一张表的主键；`ON DELETE CASCADE / RESTRICT / SET NULL` | `user_id REFERENCES users(id)` |

- **SQLite 的外键默认是关的**！必须 `PRAGMA foreign_keys = ON;`（每个连接都要）。
  这是一个真实的坑：**你以为有外键保护，其实没有**。Postgres 则始终生效。
- 复合唯一：`UNIQUE(user_id, tag)`（同一个用户不能有两个一样的标签）。
- SQLite 的类型是"亲和性"（弱类型）：往 `INTEGER` 列塞字符串**不报错**。
  想要真类型检查用 **`CREATE TABLE ... STRICT`**（3.37+，你的是 3.43.2 支持）。

**🛠 练习任务**

- [ ] 重建 `users` 表（先 `DROP TABLE`），把 §2 那张"故意不带约束"的表补齐：
      `email UNIQUE`、`role CHECK`、`age CHECK (age IS NULL OR age >= 0)`、
      `created_at TEXT NOT NULL DEFAULT (datetime('now'))`。
- [ ] 逐个"故意违规"并记下报错原文：
      插重复 email / 插非法 role / 插负 age / 不写 name。
      **这四条报错信息你要能认出来** —— 第 4 章要靠它们把 500 变成 409/400。
- [ ] 给 `user_tags` 加外键 + `PRAGMA foreign_keys = ON`，
      然后 `DELETE FROM users WHERE id = 1;` —— 观察 `ON DELETE RESTRICT` 阻止了删除；
      改成 `CASCADE` 再试一次，观察子表的标签被一起删掉。
- [ ] 用 `CREATE TABLE t2 (...) STRICT` 建一张严格表，故意塞错类型，对比普通表的行为。

**✅ 自测标准**

- 能默写六种约束及其用途。
- 知道 SQLite 的外键默认关闭，以及怎么打开。
- 能说出"约束"与"应用层校验"各自应该负责什么（**输入形状** vs **数据不变量**）。

### 3.2 实战建模：`tags` 和 `address` 到底怎么放

这是本仓库 `UserDto` 留给你的真实难题，三个字段三种命运：

| 字段 | 形态 | 可选方案 | 怎么选 |
| --- | --- | --- | --- |
| `name` / `email` / `age` / `role` | 标量 | 直接一列 | 无争议 |
| `tags: string[]` | **多值** | ① 一列存 JSON 文本（SQLite `TEXT` / PG `jsonb`）② 关联表 `user_tags` ③ PG 的 `TEXT[]` 数组列 | 要按 tag 检索/统计 → **关联表**；只是随对象一起读写、从不过滤 → JSON 列 |
| `address: { street, city, zip }` | **值对象**（1:1，且总是整块读写） | ① 展开成 `address_street` / `address_city` 三列 ② 一列 JSON ③ 单独 `addresses` 表 | **展开成列**最省事（能索引、能约束）；字段会继续长（国际地址）或要跨表复用时再拆表 |

**🎯 知识点**

- **第一范式（1NF）**：一个格子只放一个值。
  `tags = 'founder,hacker'` 违反它 —— 后果是"找出所有 hacker"只能 `LIKE '%hacker%'`（错且慢）。
  `tags = '["founder","hacker"]'`（JSON）**没有**违反 1NF（那一格是一个完整值），
  但代价是"按 tag 过滤"要数据库解析 JSON（PG 的 `jsonb` 有 GIN 索引可用，SQLite 要 `json_each`）。
- **第二/第三范式**：一句话够用 —— **非主键列必须依赖整个主键，且不能互相依赖**。
  违背的典型症状是"改一处要改多行"（数据不一致的温床）。
- **反范式是决策不是错误**：把 `totalItems` 缓存进别的表、或把 tags 存 JSON，
  都是拿"写入复杂度/空间"换"读性能"。**关键是你要能说出换的是什么**。
- **迁移（migration）**：表结构一旦有数据就不能"删了重建"。
  第 4 章会用工具做这件事；这一周先手工体会（`ALTER TABLE ADD COLUMN` 很容易，改列类型很难）。

**🛠 练习任务**

- [ ] 用**关联表**实现 tags，写三条查询：
      ① 找出带 `hacker` 标签的用户；② 统计每个 tag 被用了多少次；③ 列出每个用户的 tag 数组（`GROUP_CONCAT`）。
- [ ] 再建一张 `users_json` 表，用 `tags` 存 JSON 文本，把上面三条查询**再写一遍**，
      比较两者的写法难度与可读性（PG 的 `jsonb` 版本第 3 周补做）。
- [ ] 把 `address` 展开成三列，然后回答：如果产品要求"地址是可复用的（一个公司地址被多个用户共享）"，结构要怎么改？
- [ ] 给 `users` 加一列 `updated_at`，想出两种维护方式
      （应用每次写时更新 vs 数据库 trigger），各写一句优缺点。
- [ ] 写下你自己的结论：本仓库的 `tags` 你会选哪种方案？为什么？（写进笔记，第 4 章要照着做）

**✅ 自测标准**

- 能对任意一个字段判断"标量 / 值对象 / 多值 / 一对多 / 多对多"，并给出表结构。
- 能说出把 tags 存 JSON 的两个好处与两个坏处。
- 知道 1NF 到底在禁止什么（一个格子放多个**值**，而不是"不能用 JSON"）。

### 3.3 索引：为什么查询会突然变慢

**🎯 知识点**

- 索引 ≈ 书的目录：没有它就要**全表扫描**（`SCAN`），有它就能**定位**（`SEARCH`）。
- 代价：每个索引都让**写入变慢**（INSERT/UPDATE/DELETE 要同时改索引）并占空间。
  **不要给每一列都加索引。**
- 复合索引遵循**最左前缀**：`INDEX(a, b)` 能加速 `WHERE a = ?` 和 `WHERE a = ? AND b = ?`，
  **不能**加速单独的 `WHERE b = ?`。
- 唯一约束**自带**索引（所以 `UNIQUE(email)` 让"按 email 查"很快）。
- `EXPLAIN QUERY PLAN`（SQLite）/ `EXPLAIN ANALYZE`（Postgres）告诉你**规划器打算怎么取**。
  这是从"猜"变成"看"的那一步。

**🔍 本仓库对照**

- `UNIQUE(email)` 将来同时承担两个职责：**保证不重复**（并发正确性）**和加速查询**。
- 现在 `assertEmailAvailable()` 每次创建用户都遍历整个 Map（O(n)），
  上数据库后会变成 `WHERE email = ?` 走唯一索引（O(log n)）。

**🛠 练习任务**

- [ ] 用脚本往 `users` 里插 **10 万行**（SQLite 用 `WITH RECURSIVE` 生成，很快），
      分别测 `WHERE email = '...'` 加/不加索引的耗时（用 `.timer on` 看时间）。
- [ ] 建 `INDEX idx_users_role_age ON users(role, age)`，然后跑三个查询并看 `EXPLAIN QUERY PLAN`：
      `WHERE role = ?`（用得上）、`WHERE role = ? AND age > ?`（用得上）、`WHERE age > ?`（**用不上**）。
      把三行 `SEARCH` / `SCAN` 输出贴进笔记 —— 这就是"最左前缀"的实证。
- [ ] 给 `email` 建一个**非唯一**索引插重复邮箱（允许），再改成 `UNIQUE`（报错），
      理解"唯一约束 = 索引 + 唯一性检查"。
- [ ] 用 `ANALYZE`（SQLite）/ `EXPLAIN ANALYZE`（PG）对比"规划器估计行数"与"实际行数"。

**✅ 自测标准**

- 能解释索引的收益与代价，以及为什么不该给每列都建索引。
- 能看着 `EXPLAIN` 输出说出这是 `SCAN` 还是 `SEARCH`，并判断索引有没有生效。
- 能说出最左前缀规则，并据此设计一个复合索引。

### 3.4 稳定排序：分页为什么会漏行/重复行

**🎯 知识点**

- `ORDER BY age LIMIT 10 OFFSET 10` 在 `age` 有重复值时**顺序是不确定的** ——
  数据库可以在两次查询里给出不同的相对顺序，于是第 1 页和第 2 页可能出现同一行、或漏掉某行。
- 解法：**排序键必须能唯一确定顺序** ⇒ 追加唯一的 tiebreaker（通常是主键）：
  `ORDER BY age DESC, id DESC`。
- `OFFSET` 越大越慢（数据库仍要扫描并丢弃前 N 行）—— 数据量大后要换**游标分页**，
  且游标必须是**不透明字符串**（[AIP-158](https://google.aip.dev/158)：base64 不算混淆）。

**🔍 本仓库对照 —— 这条已经写在你的 TODO 里了**

- [validation.md §7](validation.md#L450-L452) 明确写着：
  「稳定排序的 tiebreaker：内存里无所谓；**上数据库后 `ORDER BY created_at DESC, id DESC` 必须补**，
  否则翻页会漏行/重复行」；`COUNT` 变贵、游标分页同理。
- 现在 [validation-demo.service.ts:71](../src/modules/validation-demo/validation-demo.service.ts#L71) 用的是
  `sort(a[sortBy], b[sortBy])` —— **没有 tiebreaker**，在内存里靠"数组顺序恰好稳定"侥幸不出错。

**🛠 练习任务**

- [ ] 造 20 行 `age` 全部相同的数据，用 `ORDER BY age LIMIT 5 OFFSET 5` 连查两次，
      **看是否会出现同一行出现在两页里**（多试几次；SQLite 通常会稳定，但 SQL 并不保证）。
- [ ] 改成 `ORDER BY age, id` 再验证一次，说明为什么现在有保证了。
- [ ] 把本仓库的 `findAll` 分页规则改写成 SQL（含 tiebreaker），写进笔记。
- [ ] 用 `EXPLAIN QUERY PLAN` 看 `LIMIT 10 OFFSET 100000` 与 `LIMIT 10 OFFSET 0` 的差别，
      解释"OFFSET 越深越慢"。

**✅ 自测标准**

- 能说出为什么排序键必须包含唯一列，以及不这么做会出现什么用户可见的 bug。
- 知道 `OFFSET` 的性能问题与游标分页的替代形态。

---

## 4. 第 3 周：事务与并发（Docker Postgres）

> 这一周是本计划的**分水岭**：从这里开始，"数据库"才真正是那个替你保证正确性的东西。
> 而你要先拥有一台**真的**数据库 —— SQLite 学不了隔离级别和连接池。

### 4.1 先让数据库跑起来（Docker，一次性）

**🎯 知识点**

- **客户端-服务端模型**：数据库是**常驻进程**，你通过网络（`localhost:5432`）连它；
  认证靠"用户名 + 密码 + 库名"，而不是文件权限。
- **容器**：把"装好的 Postgres"打包成一个可丢弃的进程；数据靠 **volume** 持久化 ——
  `docker compose down` 删容器但**保留数据**，`down -v` 才会连数据一起删。
- **端口映射** `5432:5432` 是"宿主机端口:容器端口"。宿主机端口被占时改成 `5433:5432`。

**🔍 本机状态（实测）**

```bash
docker --version          # Docker version 29.6.1 ✅
docker compose version    # Docker Compose version v5.3.0 ✅
docker ps                 # ❌ cannot connect to the Docker daemon ...
```

> ⚠️ **守护进程没启动**：CLI 装了不等于能用。第一次练习前先**打开 Docker Desktop**（菜单栏出现鲸鱼图标），
> 再跑 `docker ps` —— 它应该返回表头而不是报错。这一步不通过，后面全是白费。

**🛠 练习任务**

- [ ] 启动 Docker Desktop，确认 `docker ps` 正常。
- [ ] 写一个 `compose.yaml`（**建议放在仓库根，第 4 周直接复用**）：

  ```yaml
  services:
    db:
      image: postgres:17-alpine
      environment:
        POSTGRES_USER: app
        POSTGRES_PASSWORD: app_dev_password
        POSTGRES_DB: appdb
      ports:
        - '5432:5432'
      volumes:
        - pgdata:/var/lib/postgresql/data
      healthcheck:
        test: ['CMD-SHELL', 'pg_isready -U app -d appdb']
        interval: 5s
        retries: 10
  volumes:
    pgdata:
  ```

- [ ] `docker compose up -d` → `docker compose ps` 看到 `healthy`。
- [ ] **不需要装 `psql`**：用容器里的客户端连进去

  ```bash
  docker compose exec db psql -U app -d appdb
  \dt          -- 列出表（现在是空的）
  \d users     -- 描述表结构
  \q
  ```

- [ ] 把这台库接进本仓库的配置契约（**明确它为什么现在还不能真跑**）：

  ```bash
  # 你的 env 契约已经能接受这个值（url 优先，见 database.config.ts）
  DATABASE_URL='postgres://app:app_dev_password@localhost:5432/appdb' \
  DATABASE_DRIVER=postgres node dist/main
  # → 启动成功（但还没有任何代码在用这个连接：database namespace 目前是 🅿️ 预留）
  ```

  > 对照实验：`DATABASE_DRIVER=postgres` **不带**任何连接字段 → 进程拒绝启动并列出缺哪些变量（实测过）。

**✅ 自测标准**

- 能说出容器、镜像、volume、端口映射各是什么。
- 能解释 `down` 与 `down -v` 的区别，以及什么时候会想用后者。
- 知道本仓库的 `DATABASE_URL` 优先于离散字段（这是 `database.config.ts` 契约第 1 条）。

### 4.2 事务：要么全做，要么全不做

**🎯 知识点**

- `BEGIN` / `COMMIT` / `ROLLBACK`；事务内的改动在 `COMMIT` 之前**别人看不见**（隔离），
  中途失败 `ROLLBACK` 后**像没发生过**（原子性）。
- **原子性要解决的问题**：转账的两步（扣 A、加 B）不能只做一半；
  "创建用户 + 写审计日志"也不能只成功一半。
- `ACID` 各是什么，一句话即可：
  **A** 原子性（全或无）、**C** 一致性（约束始终成立）、**I** 隔离性（并发互不干扰）、**D** 持久性（commit 后不丢）。
- 长事务的代价：持锁时间长、阻塞别人、膨胀 WAL。**事务要短**。

**🛠 练习任务**

- [ ] 在 psql 里开两个终端（两个 `psql` 会话），A 会话 `BEGIN; UPDATE users SET age = 99 WHERE id = 1;`，
      B 会话 `SELECT age FROM users WHERE id = 1;` —— **B 看到的还是旧值**；
      A `COMMIT` 后 B 再查才是 99。
- [ ] A 会话 `BEGIN; ...; ROLLBACK;`，确认数据没变。
- [ ] 造一次"部分失败"：一个事务里先插一行合法数据、再插一行违反 `UNIQUE` 的数据，
      观察整个事务回滚后**第一行也不在了**。
- [ ] 把本仓库的 `create()`（查重 → 插入）包进一个事务，思考：**这样能防住并发重复吗？**（答案在 §4.3）

**✅ 自测标准**

- 能写出"转账"的事务，并说明不包事务时最坏会发生什么。
- 能解释为什么"持锁时间短"是一个真实的性能要求。

### 4.3 并发下的经典错误：先查后写（check-then-act）

**🎯 知识点**

- 本仓库现在的逻辑是：

  ```
  ① SELECT ... WHERE email = ?   → 不存在，OK
  ② INSERT
  ```

  两个请求**同时**执行时，两个都能在第 ① 步看到"不存在"，于是**都插进去了** —— 邮箱重复。
  这叫 **竞态条件（race condition）**，与代码写得好不好无关，是**架构问题**。
- **事务不能解决它**（在 `READ COMMITTED` 下两个事务互相看不见对方未提交的插入）。
  加 `SELECT ... FOR UPDATE` 能解决，但代价是串行化 + 锁等待。
- **正确解：把不变量交给数据库** —— `UNIQUE(email)` 索引 + **捕获冲突错误**：
  PostgreSQL 报 `23505`（`unique_violation`），把它翻译成 **409 Conflict**。
  这是"应用层保证一致性"和"数据库保证一致性"的分界线。

**🔍 本仓库对照 —— 这就是你现在的代码**

- [validation-demo.service.ts:127-133](../src/modules/validation-demo/validation-demo.service.ts#L127-L133) 的
  `assertEmailAvailable()` 正是"先查后写"，而且它遍历的是**单例内存 Map**，
  所以现在连"两个进程"都还没遇到；换成数据库后**必然**遇到。
- review-backlog 把这条列为「上 DB 时必须一起做」，本文就是它的操作手册。

**🛠 练习任务**

- [ ] 建表 `users(email TEXT NOT NULL UNIQUE)`，在 psql 里用**两个并发会话**手工复现：
      两边都 `BEGIN` 并 `INSERT` 同一个 email，观察**第二个 COMMIT 报 `23505`**。
      把报错原文抄下来。
- [ ] 再做一次对照实验：**去掉 UNIQUE**，同样的两个会话 —— 两个都成功，库里出现重复邮箱。
      这就是"没有约束时竞态会静默地毁数据"。
- [ ] 写一段 Node 脚本（可用 `pg` 或先只写伪代码），并发发起 20 个"创建同一邮箱"的请求，
      统计成功/409 的数量，**期望恰好 1 个成功**。
- [ ] 回答：为什么"先 `BEGIN` 再 `SELECT ... FOR UPDATE`"能防住，
      但用它的代价比 `UNIQUE` 大得多？（提示：锁粒度、吞吐、是否可重试）

**✅ 自测标准**

- 能画出"两个请求同时创建同一邮箱"的时间线，指出问题出在哪一步。
- 知道唯一约束 + 错误码捕获是**正确且推荐**的解法，并能说出它属于哪一层。
- 能说出 `23505` 是什么，以及它应该被翻译成哪个 HTTP 状态码。

### 4.4 隔离级别：它们到底防住了什么

**🎯 知识点**

- 三个现象（[PostgreSQL 官方：事务隔离](https://www.postgresql.org/docs/current/transaction-iso.html)）：
  - **脏读**：读到别人**未提交**的数据（Postgres 任何级别都不会发生）；
  - **不可重复读**：同一事务内两次读同一行，值变了；
  - **幻读**：同一事务内两次同条件查询，**多出/少了行**。
- Postgres 默认 **`READ COMMITTED`**：能防脏读，防不住不可重复读与幻读。
  需要"整个事务看到一致的快照"用 `REPEATABLE READ`；
  需要"顺序化"（最严、会失败重试）用 `SERIALIZABLE`。
- 序列化失败不是 bug：应用要**捕获并重试**。
- 隔离级别越高 → 并发越差、越可能重试。**默认级别对绝大多数业务是对的**。

**🛠 练习任务**

- [ ] 在 `READ COMMITTED` 下复现"不可重复读"：事务 A 读两次同一行，中间事务 B 改了并提交 ——
      A 第二次读到新值。
- [ ] 在 `REPEATABLE READ` 下做同一个实验，A 两次读到**同一个值**（快照）。
- [ ] 复现一次"幻读"（A 两次 `SELECT COUNT(*)`，中间 B 插入了一行符合条件的），
      然后在 `SERIALIZABLE` 下看它变成报错/重试。
- [ ] 把每个现象 + 你实际观察到的输出记成一张表（这比背定义有用十倍）。

**✅ 自测标准**

- 能说出三个并发现象的名字与区别，并知道哪个级别防住了哪个。
- 知道 Postgres 的默认级别是什么。
- 能解释"隔离级别越高，吞吐越低"的原因。

### 4.5 死锁：一句话 + 一次实验

**🎯 知识点**

- 死锁 = 两个事务**互相等对方持有的锁**。数据库会检测到并**牺牲其中一个**（报 `40P01`）。
- 规避：**按固定顺序**访问资源（例如永远先更新 id 小的行）；事务要短；能批量就批量。
- 死锁报错是**可重试**的（和序列化失败一样）。

**🛠 练习任务**

- [ ] 两个会话：A 锁行 1 再锁行 2；B 锁行 2 再锁行 1 —— 制造死锁，抄下报错。
- [ ] 把两边都改成"先锁 id 小的"顺序，确认不再死锁。

**✅ 自测标准**

- 能说出死锁的成因、数据库的处理方式，以及"按固定顺序访问"为什么有效。

---

## 5. 第 4 周：接回 NestJS（主线，前面三周的回报）

> 到这里才开始动仓库的代码。**顺序不能换**：
> Repository 端口 → 适配器 → 迁移 → 分页 → 事务语义。
> 依据见 [learning-next.md §5.2](learning-next.md#L334-L345)（"上 DB 之前**必须**先做这一步"）
> 与 [review-backlog.md §4](review-backlog.md#L495)（持久层那两行）。

### 5.1 阶段 A：Repository 端口（**这一步不需要数据库**）

- [ ] 定义 `UsersRepository` 接口（端口）：`findById` / `findByEmail` / `findAll(query)` / `create` / `update`。
      ⚠️ 接口在 TypeScript 里是**类型**，不能当 DI token（运行时会被擦除）⇒ 用 `Symbol`：

  ```ts
  export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');
  ```
- [ ] 写内存适配器 `InMemoryUsersRepository implements UsersRepository`
      （内容就是把现在 [validation-demo.service.ts](../src/modules/validation-demo/validation-demo.service.ts) 里的 Map 搬过去）。
- [ ] `ValidationDemoService` 改成 `@Inject(USERS_REPOSITORY)`，**不再自己持有 Map**。
- [ ] 在模块里绑定：`{ provide: USERS_REPOSITORY, useClass: InMemoryUsersRepository }`。
- [ ] **验收**：`pnpm build` + 手工 curl 全部行为不变（这是纯重构，**不允许**行为变化）。
      这一步做完，你的 service 已经**完全不知道**数据存在哪儿了。

### 5.2 阶段 B：让 `DATABASE_DRIVER=sqlite` 真的跑起来

- [ ] **先验 CJS 与原生模块**（本仓库的坑清单第 3 条：装任何新包先确认 CJS 兼容性）。
      `node:sqlite` 是内置的、零依赖，但它**不在 TypeORM 的驱动列表里** ——
      所以要么①手写一个 `SqliteUsersRepository`（用 `node:sqlite`，最能学到东西，**建议先做这个**），
      要么②装 `better-sqlite3` 走 ORM。
- [ ] 写 `SqliteUsersRepository`，用 `node:sqlite` 实现同一个接口；
      在本仓库的 env 契约下它只需要两个变量：

  ```bash
  DATABASE_DRIVER=sqlite DATABASE_NAME=./dev.db node dist/main
  ```
- [ ] **验收**：同一个 e2e / 同一组 curl 命令，换 `USERS_REPOSITORY` 的实现后行为一致
      —— 这就是端口的全部价值：**service 一行没改**。
- [ ] 把 SQL 里的坑（§2.2 的 NULL、§3.4 的 tiebreaker）在这里**真的修掉**。

### 5.3 阶段 C：Docker Postgres + 迁移

- [ ] 把 §4.1 的 `compose.yaml` 提交进仓库；`DATABASE_URL` 写进 `.env`（不要 `.env.example`）。

选型判据（不替你决定，但给出本仓库相关的证据）：

| | TypeORM | Prisma |
| --- | --- | --- |
| Nest 集成 | `@nestjs/typeorm` 官方一方，与 `forRootAsync` + options token 模式**同构** | 需要自己包一层 |
| 一套代码跑两种库 | ✅ `sqlite` / `postgres` 换个驱动即可（`better-sqlite3` → `pg`） | ✅ 但要改 datasource |
| 生成产物 | 无（装饰器写在代码里） | `prisma generate` 会产出代码 ⇒ 注意本仓库的**守卫 ⑧**（`src/`/`scripts/` 里不许有编译产物） |
| 迁移 | `typeorm migration:generate/run` | `prisma migrate dev`（体验更好） |
| **本仓库倾向** | **TypeORM**：你的 `database.config.ts` 契约就是为映射成 `TypeOrmModuleOptions` 写的 | 若更看重类型安全与迁移体验，选它但要处理生成物 |

- [ ] 接线：`DatabaseModule.forRootAsync({ inject: [ConfigService], useFactory: databaseOptionsFactory })`
      —— **照抄** [platform.module.ts](../src/platform/platform.module.ts) 与
      [api-docs.module.ts](../src/swagger/api-docs.module.ts) 的既有模式（选项 token + 工厂），
      并遵守 `database.config.ts` 的 5 条约定（`url` 优先 / `port` 已算好 / `memory` 默认 /
      生产禁 `synchronize` / `password` 永不进日志）。
- [ ] 写**第一个迁移**（建 `users` 表），并**永远不要**在生产打开 `synchronize`
      （本仓库的校验器已经会在生产拒绝启动，见 `env.ts` 的跨字段规则）。
- [ ] **验收**：`pnpm test:e2e` 在 SQLite 与 Postgres 两种驱动下都通过；`openapi.json` 无变化。

### 5.4 阶段 D：分页演进（上 DB 必须一起做）

- [ ] 补 **tiebreaker**：`ORDER BY <sortBy> , id DESC`（§3.4）。
- [ ] 处理 **`COUNT` 成本**：数据量大时允许返回**估算值**
      （[AIP-158](https://google.aip.dev/158) 的 "total_size may be an estimate"），
      或按 [nestjs-paginate](https://github.com/ppetzold/nestjs-paginate) 的 `optimizedCount` 思路。
- [ ] 评估**游标分页**：形态是 `?cursor=<不透明字符串>&limit=20`，
      所以 DTO 里用 `@IsString()` 而**不是** `ParseIntPipe`。
- [ ] **验收**：连续翻页不会出现重复行/漏行；`EXPLAIN ANALYZE` 里 `LIMIT` 查询走索引而不是全表扫。

### 5.5 阶段 E：Repository 的数据库语义（真正难的部分）

- [ ] **唯一约束 → 409**：把 `assertEmailAvailable()` 换成"直接 INSERT + 捕获 `23505`"
      （§4.3），把数据库错误**翻译**成 `EmailAlreadyExistsException`。
- [ ] **事务**：跨多表写入（例如"创建用户 + 写审计表"）必须原子。
      在本仓库里它属于 **repository 实现层的职责**，不是 service —— 想清楚边界。
- [ ] **N+1 查询**：一页 20 个用户、每个都要查 tags ⇒ 21 条 SQL。用 `JOIN` 或批量 `IN (...)` 改成 1–2 条。
- [ ] **连接池**：`DATABASE_POOL_SIZE` 已经是配置项（`database.config.ts`）；
      理解"连接是有限资源"、慢查询会占住连接、池满会排队。
- [ ] **e2e 状态隔离**：现在用例共享单例内存（review-backlog §4）。上真库后要选一种：
      每个 `describe` 重建库 / 每个用例包在事务里回滚 / `overrideProvider(USERS_REPOSITORY)` 注入干净实例。

### ✅ 第 4 周总自测

- 能说出为什么 `UsersRepository` 用 `Symbol` 而不是接口当 token。
- 能解释"换驱动时 service 一行不改"是靠什么实现的（依赖倒置）。
- 能说出 `synchronize` 为什么在生产是禁止的。
- 能复述 check-then-act 竞态的时间线，并说出正确解法的两层（唯一约束 + 错误翻译）。

---

## 6. 明确不学（本阶段跳过）

| 主题 | 什么时候学 |
| --- | --- |
| 分库分表 / 读写分离 / 副本 | 单库真的扛不住时（先学会看慢查询与索引） |
| NoSQL（MongoDB / Redis） | 需要文档模型或缓存时；**Redis 优先于 MongoDB**（缓存/限流比换存储模型更常需要） |
| 查询优化深度 / 执行计划细节 | 已经在 §3.3 / §5.4 摸了边；真遇到慢查询再深入 |
| 存储引擎原理 / B+ 树实现 / WAL 细节 | 想懂原理时看 `CMU 15-445`（很硬核，别现在看） |
| `DDIA`（数据密集型应用系统设计） | 有 1–2 年经验后读，是本领域最好的书之一，但现在读会挫败 |
| 数据库高可用 / 备份恢复演练 | 准备上线时（至少要会 `pg_dump` / `pg_restore`） |
| MySQL 特有语法 / 存储过程 / 触发器 | 工作的项目用它时（**先学通用 SQL，方言差异查文档即可**） |

---

## 7. 免费资源（按顺序用，均已核实可访问）

| 顺序 | 资源 | 用它的哪部分 |
| --- | --- | --- |
| 1 | [SQLBolt](https://sqlbolt.com/) | 交互式 SQL 入门，第 1 周配合 §2 用；**零安装** |
| 2 | [SQLite 官方 SQL 语法](https://www.sqlite.org/lang.html) | 语法查询手册（当字典用，不要通读） |
| 3 | [Node.js `node:sqlite` 文档](https://nodejs.org/api/sqlite.html) | 阶段 B 手写适配器时用 |
| 4 | [PostgreSQL 官方教程](https://www.postgresql.org/docs/current/tutorial.html) | 第 3 周起；官方文档质量极高，**值得通读这一章** |
| 5 | [PostgreSQL 约束](https://www.postgresql.org/docs/current/ddl-constraints.html) | §3.1 的权威依据 |
| 6 | [PostgreSQL Exercises](https://pgexercises.com/) | 第 3 周的练习题库（有答案） |
| 7 | [Use The Index, Luke!](https://use-the-index-luke.com/) | §3.3 索引；**面向开发者的索引圣经** |
| 8 | [事务隔离](https://www.postgresql.org/docs/current/transaction-iso.html) | §4.4 的权威依据 |
| 9 | [Nest 官方 Database 章节](https://docs.nestjs.com/techniques/database) | 第 4 周接线时用 |
| 10 | [TypeORM 文档](https://typeorm.io/) / [Prisma 文档](https://www.prisma.io/docs) | §5.3 选型后只读选中的那个 |
| 11 | [AIP-158（分页）](https://google.aip.dev/158) | §5.4；本仓库已有的取舍依据 |

---

## 8. 总自测（学完应当全对）

- [ ] 数据库解决的是文件的哪三个问题？
- [ ] `SELECT` 的**逻辑执行顺序**是什么？为什么 `WHERE` 里不能用列别名？
- [ ] `WHERE age = NULL` 为什么返回 0 行？正确写法是什么？
- [ ] `COUNT(*)` 与 `COUNT(age)` 有什么区别？
- [ ] INNER JOIN 与 LEFT JOIN 的区别？忘写 `ON` 会怎样？
- [ ] 主键 / 唯一 / 非空 / CHECK / 外键各保证什么？
- [ ] SQLite 的外键默认状态是什么？怎么打开？
- [ ] `tags: string[]` 有哪三种存法？各自的代价？
- [ ] 索引的收益和代价分别是什么？最左前缀规则是什么？
- [ ] `EXPLAIN` 输出里看到 `SCAN` 意味着什么？
- [ ] 为什么 `ORDER BY age LIMIT 10 OFFSET 10` 可能漏行？怎么修？
- [ ] 事务的 ACID 各是什么？"转账"不包事务最坏会怎样？
- [ ] "先查后写"在并发下为什么会重复插入？**正确的解法是什么？**
- [ ] `23505` 是什么错误？应该翻译成哪个 HTTP 状态码？
- [ ] `READ COMMITTED` 防住了哪个现象、防不住哪个？
- [ ] 死锁是怎么形成的？为什么"按固定顺序访问"能规避？
- [ ] `synchronize: true` 为什么在生产是禁止的？
- [ ] 为什么换数据库驱动时 service 一行都不用改？
- [ ] N+1 查询是什么？怎么发现、怎么修？
- [ ] 连接池满了会发生什么？

---

## 9. 与现有文档的关系

- [nestjs-learning-plan.md](nestjs-learning-plan.md)：Nest 框架基础路线（本文的姊妹篇，不含数据库）。
- [learning-next.md](learning-next.md)：**下一步做什么**（按投入产出比重排）。
  §5.2 Repository 端口、§6「明确跳过」里的数据库一行，都以本文为前置。
- [configuration.md](configuration.md)：`DATABASE_*` 的变量契约、致命规则、`database` namespace 为什么还是"预留"。
- [validation.md](validation.md)：分页与错误契约里「有意没做」的部分（`COUNT` 成本、游标分页、tiebreaker 的触发条件）。
- [review-backlog.md](review-backlog.md) §4：持久层与 e2e 状态隔离的原始分析。
- [architecture-review.md](architecture-review.md)：模块边界与那些 `grep` 守卫（接 ORM 时**不要**破坏它们）。

> **一条给未来的自己的提醒**：这份计划里的每一步都能用命令验证。
> 如果你发现自己"读完了但没敲过一次 SQL"，那就是没学 —— 回去做 §1.3 的第一个练习。
