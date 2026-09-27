# scripts

`dev.mjs` 启动 Nuxt，通过 loopback TCP 验证本机请求身份。

`build.mjs` 输出静态前端，`archive.mjs` 将完整 Nitro 服务与依赖封装成 `server.cjs`；`runtime.cjs` 在运行时解包到私有临时目录。

`launcher.c` 和 `launcher.S` 将脚本嵌入正式 ELF，以匿名内存文件交给镜像内 Node 执行；不启动 shell，不修改宿主校验或容器限制。`launcher.mjs` 在 Linux x86_64 使用 C 编译器，其他平台使用 Zig。

`build.sh` 是 AIO 交付入口，使用 npm 锁文件安装、检查和构建。
