# 运行与生成

运行与验证调用共享命令契约和受限 QuickJS 执行器。模型仅生成草稿，文档从通过 schema 校验的命令集确定性生成。
模型默认使用 Responses SSE；`VIBECLI_AI_PROTOCOL=chat-completions` 可显式选择 Chat Completions，Responses 不受支持的 HTTP 状态允许回退。
宿主运行通过 `broker_socket` 的 `/egress/responses` 或 `/egress`；独立运行直接请求当前用户设置的模型基址，拒绝重定向。
请求总时间不超过 60 秒，响应不超过 2 MiB，流式生成必须有完整结束事件。
