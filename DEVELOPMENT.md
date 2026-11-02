# 开发说明

维护者文档；使用者看 [README.md](README.md)。

- 包名 `@liuyu-f/dsh-plugin-session-cascade-delete`，实测适配 `@deepseek-ai/dsh` `V0.2.0-rc.*` 到 `0.2.1-rc.5`，`0.2.1-rc.*` 预期全部可用
- 基于 `@huanlin/dsh-plugin-session-delete`（上游 `lsz-asd`）的适配版，增强围绕子代理：级联删除、分支保护、活会话删除
- `src/index.js` Host 半（服务、工具、HTTP 路由）· `src/client.js` Web 半（三个槽位 + 弹窗）· `locale/*.json` 展示元信息 · `cordis.patch.yml`

## 架构

```
界面：conversation.session.header.actions   头部垃圾桶
      sidebar.workspaces.session.menu.item  侧栏会话行菜单
      shell.overlay                         确认弹窗
        │ POST /__chameleon/session/delete（先鉴权，失败即 401）
        ▼
deleteSessionCore(ctx, sessionId, { keepDescendants })
        ├─ collectDescendants  ← ctx.subagents.listDescendants
        ├─ 由深到浅 purgeOne(子会话) → purgeOne(目标会话)
        └─ ctx.emit('api-session/removed', id)  每个被删会话各广播一次
```

工具 `session_delete` 与 HTTP 路由共用 `deleteSessionCore`；工具拒绝删除"本次调用所在的会话"，并多出 `title` / `discover` / `discoverTree` 参数。

`purgeOne` 的顺序：

1. 解析 header 与日志目录
2. `cancel` Agent 并等待 `whenIdle`
3. `sessions.flush`
4. 从会话存储与 Agent 注册表移除 live entry；`session/disposed` 关闭持久化写句柄、让投影缓存写入最终行、并通知界面移除该行
5. 等写句柄释放后删日志目录（两种 id 拼写、清空项目目录，多轮重试确认）
6. 日志确认删净后清理投影缓存与工作区记账
7. 广播移除事件

## 设计约定

1. **会话 id 跨拼写比较。** 根/分支会话是 `session-<uuid>`，子代理是裸 `<uuid>`。统一用 `idsReferToSameSession(a, b)`；存活会话与 Agent 通过 `list()` 枚举后匹配。
2. **级联范围由子代理编目决定。** `ctx.subagents.listDescendants(root)` 是唯一权威；编目外的子会话保留为可按 id 删除的孤儿行。
3. **Host 侧服务从 `ctx` 获取。** 需要官方包时在 `package.json` 声明依赖并安装到 profile；模块解析从插件目录的实际位置开始。
4. **配置从行 `config` 读取。** 设置页没有表单，两个配置项写在 profile 的 `cordis.patch.yml`。
5. **客户端入口是 `window.__ModuleLoader__.load({ id, factory })`。** 平台注入 `react` 与 `dsh-client-ui-primitives`；样式使用宿主 token 与内联样式；展示元信息放在 `locale/*.json` 的嵌套 `meta` 中。
6. **DSH 0.2.1 的新会话立即持久化。** 点"新会话"会创建一个 `blank` 会话（投影缓存 `sessionListMetadata.blank: true`，侧栏只显示当前 blank）；`discover` 会列出它们，删除按普通会话处理。
7. **子代理归属创建它的会话，分叉不接管归属。** 在 A 里创建的子代理，从 A 分叉出的 B 不拥有它们：删除 B 无影响，删除 A 才会删除它们。
8. **子代理不出现在界面上**，删除只能靠级联或按 id 直调工具。

## 开发环境

**本地目录安装**（改代码即生效的前提）：

```sh
dsh plugin --profile desktop add "file:<本目录绝对路径>"
```

路径含空格或中文时加引号。

**热重载**：profile 的 `cordis.patch.yml` 里有指向本插件 `src` 的 `hmr` 行时生效。

```yaml
- id: hmr
  config:
    root:
      - <本目录>/src
```

- `config.root` 在启动时读取，修改后重启一次。
- 客户端改动刷新页面（客户端模块经 SSE 的 `rebuilt` 帧换版本）。
- 保存后约 10 秒生效。

**安装形态核对**：`link:` 安装形成 Junction，编辑即反映；实体副本需 `remove` 后重新 `add` 修回链接。核对两边 `src/index.js` 的大小与时间。
