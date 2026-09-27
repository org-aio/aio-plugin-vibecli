# 宿主接入

读取 `AIO_PLUGIN_CONFIG` 的 v2 配置，通过 ingress token 与租户、用户请求头校验身份。
独立运行使用 `VIBECLI_ACCESS_TOKEN`；无凭据的开发模式只接受 loopback 请求。
正式持久化使用宿主数据库或 `VIBECLI_DATABASE_URL`。生产环境缺少数据库时拒绝服务。
模型配置优先读取当前用户的运行时设置，环境变量 `VIBECLI_AI_ENDPOINT`、`VIBECLI_AI_MODEL`、`VIBECLI_AI_API_KEY` 作为初始值。
运行时密钥由宿主 broker 或独立 AES-GCM 加密保存，读取接口不返回明文。
