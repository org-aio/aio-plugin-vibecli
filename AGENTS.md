# VibeCLI

- 本仓库是 AIO v2 process 插件，命令定义和版本是产品数据，不写进主体 CLI 二进制。
- `shared/commands/model.ts` 是命令契约；参数解析、预览和正式执行共用后端执行器。
- 正式环境使用 AIO 授予的 PostgreSQL，按宿主租户和用户隔离；文件存储仅用于显式本机开发。
- 生成的 JavaScript 在 QuickJS 中运行，禁止将其交给 eval、Node vm、shell 或宿主 import。
- AI 只产出草稿。发布必须重新验证保存的草稿，文档、实现和测试以同一版本保存。
- 前端经 aioPlugin 通信桥访问宿主，不接受前端自报租户或用户身份。
- 注释使用中文；不要提交本机路径、密钥、账号或环境状态。
- 验证：`npm ci`、`npm run typecheck`、`npm test`、`npm run build`。开发：`npm run dev -- --host 127.0.0.1 --port 8791`。
