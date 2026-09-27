# 请求身份

业务 `/api/` 路由接受经校验的 AIO ingress 身份，或独立运行的 Bearer 凭据。
无凭据的开发模式只允许 loopback 来源，客户端不能通过伪造 forwarded 请求头改变作用域。
