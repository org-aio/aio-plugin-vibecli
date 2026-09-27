# 接口验收

`npm run check` 验证类型、参数解析、QuickJS 限额、AI 完成协议、持久化隔离，以及独立产物的生成、失败反馈、发布与回滚闭环。设置 `VIBECLI_TEST_DATABASE_URL` 启用 PostgreSQL；设置 `VIBECLI_TEST_AIO_BIN` 验证实际主体 CLI 与二进制哈希。

`npm run test:container` 启动正式 ELF，验证与宿主相同的只读、无网络和临时目录限额。`VIBECLI_TEST_DOCKER_CONTEXT` 可指定 Docker 上下文。

`npm run test:browser` 验证工作台、发布回滚、模型设置及桌面和移动端布局。它会改变开发实例的数据与模型设置，请按根 README 使用专用验收实例。
