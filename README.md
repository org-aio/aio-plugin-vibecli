# VibeCLI

AIO v2 插件，在界面设计命令、参数、JavaScript 逻辑和示例，从同一份契约生成帮助与 Markdown。AI 生成草稿，用户采用后验证、发布；终端读取已发布的活动版本。

## 本机运行

```sh
npm ci
npm run dev -- --port 8791
```

打开 `http://127.0.0.1:8791`，创建命令集、验证并发布。AI 设置中填写模型入口、模型、协议和可选密钥；未配置模型时仍可手动设计命令。

需要包含 VibeCLI 动态入口的 AIO CLI。连接命令可在工作台的连接窗口复制：

```sh
aio vibecli connect http://127.0.0.1:8791/api/cli/<项目UUID>
aio greet --name Ada
aio greet --help
aio --help
```

`.aio/vibecli.json` 只保存连接元数据。`AIO_VIBECLI_URL` 可覆盖端点；独立服务需要凭据时使用 `AIO_VIBECLI_TOKEN`，不把密钥写进项目。

## 运行时边界

- 主体分发器发布一次后，新增命令、参数、逻辑和文档通过命令版本发布生效，无需重新构建或安装主体 CLI。
- 草稿不影响活动版本。发布重新验证保存的草稿；每条命令必须有实际执行逻辑的成功示例，帮助输出不能绕过验证。
- 每次执行读取活动版本，没有静默沿用旧版本的离线缓存；服务不可达时明确失败。一次执行固定使用读取到的版本。
- 首版逻辑只接收 `input` 并同步返回字符串或 JSON，输出追加换行。QuickJS 不提供文件、网络、shell、Node 模块或异步任务。
- 执行限额为 500 ms、16 MiB 内存和 64 KiB 输出。新增原生能力、修改执行协议或主体内置命令仍需更新对应运行时。

## AIO 安装

`npm run build` 生成 Linux x86_64 ELF `dist/server`、本机可运行的 `dist/server.cjs` 和 `dist/frontend/`。原生启动器将内嵌脚本交给已授权镜像内的 Node，不运行 shell。Linux 构建需要 C 编译器，其他平台需要 Zig 交叉编译器。清单为 v2，提供 `/health`、`/aio/describe`，使用宿主 Unix socket、PostgreSQL、加密与模型 broker。

打包工具必须支持 v2 `schema_version` 清单。若出现 `unknown field schema_version`，需要先更新 AIO 的 v2 打包工具；动态命令分发入口与 v2 打包支持是分别需要验收的能力。以下命令只验证和生成本地产物，不会自动安装或上传市场。

```sh
aio plugin validate .
aio plugin package . --git <实际GitHub仓库地址> --version 0.1.0
```

宿主须批准清单锁定的 Node 22 镜像、数据库和加密能力，并应用迁移。模型设置只能选择已授权入口；自定义入口先加入清单授权并发布插件。新增命令逻辑不需要改变插件包。

CLI 使用用户登录会话调用同一插件：

```sh
aio vibecli login <宿主origin> --account <账号> --password-stdin
aio vibecli connect <宿主origin> --source <插件sourceUUID> --project <项目UUID>
aio greet --name Ada
```

密码通过标准输入提供。会话保存在 CLI 专属用户文件，Unix 权限为 `0600`；`AIO_VIBECLI_SESSION_FILE` 可指定位置。会话过期后重新登录。项目和模型设置按宿主租户及用户隔离。

## 独立服务配置

| 变量 | 用途 |
| --- | --- |
| `VIBECLI_DATABASE_URL` | 正式 PostgreSQL，缺少时拒绝正式运行 |
| `VIBECLI_ACCESS_TOKEN` | 独立服务 API 凭据，本机开发无需设置 |
| `VIBECLI_ENCRYPTION_KEY` | 正式独立服务保存模型密钥时使用的 32 字节 Base64 AES 密钥 |
| `VIBECLI_AI_ENDPOINT` / `VIBECLI_AI_MODEL` | 初始模型配置，可由界面覆盖 |
| `VIBECLI_AI_API_KEY` | 初始模型密钥，只在服务环境中设置 |
| `VIBECLI_AI_PROTOCOL` | `responses` 或 `chat-completions` |
| `VIBECLI_DEVELOPMENT=1` | 单文件 artifact 的显式本机开发模式 |
| `VIBECLI_DATA_DIR` | 开发数据目录，默认 `.data` |

文件存储只供本机开发，正式源为 PostgreSQL。模型设置只返回 `has_key`，密钥留空保留，明确清除后删除；AIO 使用宿主加密，独立服务使用 AES-GCM。

## 验证

```sh
npm run check
npm run test:browser
npm run test:container
```

浏览器测试需要本机服务和 Playwright Chromium。`VIBECLI_TEST_DATABASE_URL` 启用正式持久化测试；`VIBECLI_TEST_AIO_BIN` 让 artifact 测试运行真实主体 CLI，并比较新增命令前后的二进制 SHA-256。

Linux x86_64 的 artifact 测试直接启动正式 ELF 入口，其他平台测试本机 Node 归档。容器测试需要 Docker，使用清单中锁定的镜像和宿主的只读、无网络、16 MiB 临时目录限制，可用 `VIBECLI_TEST_DOCKER_CONTEXT` 指定上下文。

浏览器测试会创建项目并覆盖开发实例的模型设置，请使用专用数据目录启动验收服务：

```sh
VIBECLI_DATA_DIR=.data/browser-tests npm run dev -- --host 127.0.0.1 --port 8792
VIBECLI_TEST_UI_URL=http://127.0.0.1:8792 npm run test:browser
```

入口：`shared/commands/model.ts` 定义契约，`backend/commands/runtime.ts` 解析执行，`backend/projects/service.ts` 发布回滚，`frontend/commands/workbench.vue` 提供工作台。真实模型、市场上传和已安装宿主需分别验收。
