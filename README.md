# dsh-plugin-session-cascade-delete

[![npm](https://img.shields.io/npm/v/@liuyu-f/dsh-plugin-session-cascade-delete)](https://www.npmjs.com/package/@liuyu-f/dsh-plugin-session-cascade-delete)
[![license](https://img.shields.io/npm/l/@liuyu-f/dsh-plugin-session-cascade-delete)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![DSH Desktop](https://img.shields.io/badge/DSH%20Desktop-0.2.0--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

> **适配 DeepSeek Harness 官方桌面版 `V0.2.0-rc.2`。** 槽位名、服务签名会随版本变化，其他版本请自行核对。

在 DeepSeek Harness 中彻底删除会话，并清理界面本身不会清理的数据。

会话头部有一个垃圾桶按钮，侧栏会话行的 "..." 菜单中有一项「删除会话」。确认后会删除该会话的日志目录、投影缓存、工作区记账，以及**它拥有的子代理会话**；运行中的会话会先被停止。适用于 Web 界面及一切基于 Web 外壳的客户端。

同时提供 agent 工具 `session_delete`。

![侧栏菜单里的「删除会话」](https://raw.githubusercontent.com/liuyu-f/dsh-plugin-session-cascade-delete/main/docs/manual-menu.png)
![删除确认弹窗](https://raw.githubusercontent.com/liuyu-f/dsh-plugin-session-cascade-delete/main/docs/manual-confirm.png)

## 安装

两条渠道装的是同一个包，任选其一。

**npm（推荐）** —— 安装已发布版本：

```sh
dsh plugin --profile desktop add @liuyu-f/dsh-plugin-session-cascade-delete
```

**GitHub** —— 安装指定 tag 的源码：

```sh
dsh plugin --profile desktop add github:liuyu-f/dsh-plugin-session-cascade-delete
```

**通过github安装的是默认分支最新代码**，可能包含尚未发布的改动。

## 怎么用

| 入口       | 位置                            |
| ---------- | ------------------------------- |
| 头部垃圾桶 | 会话标题旁的动作区              |
| 菜单项     | 侧栏会话行 "..." → 「删除会话」 |
| agent 工具 | `session_delete`（参数见下）    |

侧栏菜单项与确认弹窗（截图为深色主题）：

**删掉一个父会话时，它拥有的子代理会话会被一并删除**（最深者先删）。

- **会话正在运行时**：先停止它的任务，再删除；弹窗会提示这一点。
- **分叉会话（fork）是独立的**：删掉一个分叉不会连带删除任何东西，也不会牵连子代理。
- **子代理归属"创建它的那个会话"**（DSH 的机制）：若先在 A 会话里创建了子代理、再从 A 分叉出 B，那么**删除 B 对子代理没有影响，删除 A 才会删除它们**。分叉只复制对话上下文，不接管子代理的归属。

## agent 工具

agent 也能删除会话，并在结果里报告实际删掉了什么：

| 参数            | 作用                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`     | 直接指定要删的会话 id（推荐）                                                                                                      |
| `title`         | 只知道标题时用；**只有在标题唯一时才会删**，否则报错并列出候选                                                                     |
| `discover`      | 只列出本 profile 知道的会话，不删任何东西；当前会话在标题后标 ` > (当前会话)`                                                      |
| `discoverTree`  | **只列出某一个会话拥有的子代理树**（id、深度、父级），不删任何东西。删除前不需要用它——删除本身就会级联，结果里会报告实际删掉了什么 |
| `keepSubagents` | 只删这一个会话，保留它的子代理会话（默认是连子会话一起删）                                                                         |

两条安全约束：

- **拒绝删除本次调用所在的会话**（工具结果必须写进那个日志），并拒绝删除"其树中包含本次调用所在会话"的会话。
- 注意区分：被拒绝的是"**本次工具调用所在的会话**"，不是"你界面上正打开着的会话"——后者可以正常删除。

## 配置（可选）

写在 profile 的 `cordis.patch.yml` 里（本插件不导出 `Config` schema，故设置页没有表单）：

```yaml
- id: session-delete
  name: "@liuyu-f/dsh-plugin-session-cascade-delete"
  config:
    deleteSubagents: false # 默认 true：删父会话时连子代理会话一起删
    sessionsRoot: "" # 可选：覆盖会话日志根目录，默认 $DSH_HOME/sessions
```

## 删掉了什么

一次删除会清理：会话日志目录 → 投影缓存（缓存行与磁盘文档）→ 工作区记账（所属工作区成员、归档、置顶）→ 子代理会话（由深到浅）→ 并通知界面立即移除对应的行。

任何一步没做成，都不会静默：结果报告里会有一条 `INCOMPLETE`，列出是哪一步、什么原因。**日志确认删净之后才会动记账**，所以不会出现"删一半、会话掉进未分组"的坏行。

## 更新与卸载

```sh
# 换版本：先移除再安装。已安装状态下直接再装会报 ambiguous-install。
dsh plugin --profile desktop remove @liuyu-f/dsh-plugin-session-cascade-delete
dsh plugin --profile desktop add @liuyu-f/dsh-plugin-session-cascade-delete
```

## 关于这个插件

`@huanlin/dsh-plugin-session-delete`（[上游仓库](https://github.com/lsz-asd/dsh-plugin-session-delete)）的新 DSH 适配版，改动与增强围绕子代理：级联删除、分支保护、活会话删除、会话 id 两种拼写的处理。维护者文档见 [DEVELOPMENT.md](https://github.com/liuyu-f/dsh-plugin-session-cascade-delete/blob/main/DEVELOPMENT.md)。

## 版本

| 版本  | 变更                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.4 | README 增加 Awesome DSH Plugin 徽章（已提交收录 PR #6699）；文档简化：`DEVELOPMENT.md` 移除发布流程与旧版更新日志，README 去掉钉版本说明 |
| 1.0.3 | `discover` 列出会话时，当前会话的标记从行首移到标题之后（`标题 > (当前会话)`）：标题才是读者比对的字段，行首的标记跨行容易看错                             |
| 1.0.2 | 删除当前打开的会话后清空主视图，不再新建会话。此前复用 `startSession()`（新建会话流程），每次删除都可能留下一个内存中的 `(untitled)` 会话，重启才消失      |
| 1.0.1 | `discoverTree` 不再被描述成删除前的必要步骤。此前 agent 会先预览级联范围再删除，实际删除本身即级联、结果也会报告删除了什么，预览只在调用方明确要求时才需要 |
| 1.0.0 | 首个版本：界面删除入口（会话头部 + 侧栏菜单）、`session_delete` 工具、子代理级联删除、分支会话保护、运行中会话先停止                                       |
