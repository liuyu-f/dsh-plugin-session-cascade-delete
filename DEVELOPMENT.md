# 开发说明

维护者文档；使用者看 [README.md](README.md)。

- 包名 `@liuyu-f/dsh-plugin-session-cascade-delete`，面向 `@deepseek-ai/dsh` `0.2.0-rc.2`
- 基于 `@huanlin/dsh-plugin-session-delete`（上游 `lsz-asd`）的新 DSH 适配版，改动与增强主要围绕子代理：级联删除、分支保护、活会话删除
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

工具 `session_delete` 与 HTTP 路由共用 `deleteSessionCore`；差异只有两点：工具拒绝删除"本次调用所在的会话"，且多出 `title` / `discover` / `discoverTree` 参数。

`purgeOne` 的顺序即正确性：解析 header → 停 agent → `sessions.flush(session)` → 删日志目录（两种 id 拼写、清空项目目录，扫描 4 轮确认）→ **确认删净后才动记账** → 广播移除。

## 必须遵守的规则

**1. 会话 id 比较一律跨拼写。** 根/分支会话是 `session-<uuid>`，子代理是裸 `<uuid>`；同一会话在不同数据源里两种形态都会出现。用 `idsReferToSameSession(a, b)`；查存活会话遍历 `sessions.list()`、查存活 agent 遍历 `agents.list()`——`sessions.get` / `agents.get` 是按 canonical 键精确查表，拼写不符会**静默查不到**。

**2. 级联只认子代理编目。** `ctx.subagents.listDescendants(root)` 是"拥有哪些子代理"的唯一权威。不要用 header 的 `parentSession` 推断：它无法区分子代理与 fork 分支，v0.6.0 因此删分支时连带删掉了同源分支。编目没列出的子会话宁可留成可按 id 删除的孤儿行。

**3. Host 侧从 `ctx` 取服务，不 import `@deepseek-ai/*`。** 本插件以 `link:` 形式装进 profile，Node 从**插件目录的真实路径**向上找 `node_modules`，而官方包住在 app 内（`app.asar/dsh/node_modules/`），沿途都没有 `@deepseek-ai/`，裸模块名解析必然失败。确实需要某个包（如为导出 `Config`）就在 `package.json` 里声明依赖并让它被真正安装到位——**不要手动复制包进插件的 `node_modules`**。
（解析成功与否取决于安装方式：`link:` 不行，装进 profile 的 tarball/registry 副本可以。判据：在插件目录跑 `node -e "console.log(require.resolve('@deepseek-ai/dsh-tools'))"`。）

**4. 不导出 `Config`。** 导出本身是官方支持的，但要求 `Config['~standard'].validate` 存在（schemastery schema）；不是 schemastery 时 Cordis 的 `resolveConfig` 会抛 `TypeError: … reading 'validate'`。本插件为 2 个配置项不值得引入该依赖，因此从行配置防御性读取（README 已说明只能写在 profile YAML 里）。

**5. 客户端。** 入口 `window.__ModuleLoader__.load({ id, factory })`，平台注入 `react` 与 `dsh-client-ui-primitives`，不能 import 宿主 CSS。破坏性确认按钮抄宿主规则：`outline` 变体 + 文字 `--dsw-alias-state-error-primary`。弹窗文案在 `client.js` 的内置中英词典里（`resolveText` 兜底），`locale/*.json` 只放展示元信息且**必须嵌套**（`{"meta":{...}}`，扁平会被静默忽略）。

**6. DSH 新会话没有持久化痕迹。** 点"新会话"即在内存生成，首发消息前不落盘、界面不列出，因此无记录可删、删完仍存在——这是设计行为。以 `hasPersistedArtifacts(ctx, root, sid)`（查磁盘目录 + 缓存文档）判定：`discover` 加标记，删除路径明确拒绝并劝阻重试。

**7. 子会话不被编目列出时不会级联**，成为孤儿行；子代理不出现在界面上，删它只能靠级联或按 id 直调工具。均为刻意取舍。

**8. 子代理归属"创建它的会话"，分叉不接管归属**（DSH 的机制，实测确认）。在 A 里创建的子代理，从 A 分叉出的 B **不拥有**它们：删除 B 对其无影响，删除 A 才会删除它们。因此级联按"目标会话所拥有的子代理"计算是正确且完整的，**不要**为了让分叉"接手"子代理去改归属权。

## 开发环境

**本地目录安装**（改代码即生效的前提）：

```sh
dsh plugin --profile desktop add "file:<本目录绝对路径>"
```

路径含空格或中文时**必须加引号**。

**热重载**：仅当 profile 的 `cordis.patch.yml` 里有指向本插件 `src` 的 `hmr` 行时才生效。

```yaml
- id: hmr
  config:
    root:
      - <本目录>/src
```

- `config.root` **在启动时读取**：改了它、或换过安装形态（`link:` ↔ 实体副本），要重启一次之后编辑才生效；没有这一行时改动**不会**被运行中的进程看见，必须重启。
- 客户端改动需刷新页面（客户端模块经 SSE 的 `rebuilt` 帧换版本；改动没体现时先刷新排除时序）。
- 保存后不是瞬时生效（约 10 秒）。排查"改了没生效"：在工具输出里插一行临时字符串，等待后调用，看它是否出现。

**安装形态核对**：`link:` 安装会形成 Junction，编辑即反映；若装成了**实体副本**（例如先装到 profile 又移动了目录），工作区的编辑永远不会被加载。核对两边 `src/index.js` 的大小与时间，必要时 `remove` 后重新 `add` 修回链接。
