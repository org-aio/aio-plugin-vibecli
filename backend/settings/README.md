# 模型设置

`GET /api/settings` 只返回模型基址、模型名、协议、授权地址与密钥是否存在。
`PUT /api/settings` 按已验证的租户和用户保存；空白密钥保留现有值，`clear_key: true` 明确删除。
AIO 使用宿主 cryptography broker 保存密文。独立生产需要 Base64 编码的 32 字节 `VIBECLI_ENCRYPTION_KEY`；本机开发自动生成 0600 私有密钥。
PostgreSQL 是正式存储，开发文件 `settings.json` 只保存密文，事务/互斥保证并发保存不会丢失已有密钥。
