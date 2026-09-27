# VibeCLI 后端

`http/` 是 Nitro 文件路由；`hosting/` 处理 AIO v2 身份与配置；`projects/` 管理隔离的命令项目和发布事务；`commands/` 处理生成、执行与验证。
正式运行只接受 PostgreSQL。没有宿主配置的显式开发模式可以使用 `.data/projects.json`，仅支持单进程本机调试。
代码与文档从同一发布版本读取。草稿预览不修改活动版本，生成结果也不会自动覆盖草稿。
