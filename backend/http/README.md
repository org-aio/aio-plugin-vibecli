# HTTP 路由

Nitro 约定入口，`api/` 提供项目与 CLI 路由，`routes/` 提供健康检查和 v2 `/aio/describe` 描述。
`middleware/` 在业务请求进入服务前校验宿主或独立运行身份；健康与描述端点供宿主安装检查使用。
