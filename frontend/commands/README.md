# 命令工作台

- `state.ts` 管理命令集草稿、异步请求和版本状态。命令与文档复用 `shared/commands` 契约。
- `workbench.vue` 装配导航、工作区和确认窗口；`editor.vue` 编辑定义；`panels.vue` 展示文档、试跑与版本。
- 中文文案集中在 `text.ts`，样式集中在 `style.css`。
- AI 返回值只进入待审核草稿，明确采用后才修改编辑器；保存、验证、发布和试跑期间禁用编辑。
- 命令集支持 JSON 导入、导出，导入经共享 Zod schema 严格校验，替换未保存修改前需要确认。

## API 假设

- `/api/projects` 返回 `Workspace`，各命令集操作返回完整 `Project`，生成返回 `{ bundle, documentation }`。
- 请求优先使用实际 SDK 签名 `aioPlugin.json(method, path, value)`；独立本机开发使用 `fetch` 且不发送 Cookie。
- 预览请求的 `argv` 包含当前完整命令路径及参数值。验证使用当前编辑草稿；发布先保存脏草稿，服务端重新验证保存的版本。
- CLI 入口可由命令集的可选 `cli_connection` 提供，支持 URL 字符串或 `{ endpoint, url, command, revision }`。嵌入宿主时缺少此字段需要填写宿主 origin 与 source UUID；只有独立本机开发模式会生成当前 origin 的 `/api/cli/{id}`。
- AIO 已安装模式允许用户填写宿主 origin、source UUID 和账号，只输出 `login --password-stdin` 与 `connect --source --project` 命令，不收集密码。
- `settings.vue` 使用 `/api/settings` 读取脱敏配置并保存入口、模型、协议和密钥。宿主允许入口列表非空时只能选择列表项；密钥留空保留，清除需要确认，不写入浏览器存储。
- `expected_updated_at` 来自最近一次服务端返回值；并发冲突作为操作错误保留当前编辑内容。
