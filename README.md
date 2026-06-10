# 📦 翻箱 FanBox

> vibe coding 的驾驶舱。左手浏览、预览、轻改本机文件，右手内嵌终端直接指挥 coding agent，三方实时联动。

AI 帮你一个下午起十个项目，但它们散在各处、名字认不出、改了啥看不见。翻箱把「找文件 → 跑 agent → 看它改了什么」收进一个窗口：左边文件 × 右边/下边终端 × 原地预览，一个有机整体，省掉 Finder + iTerm + 浏览器三件套之间的反复切换。

桌面版基于零依赖的 `server.js` 后端，外面包一层 Electron（node-pty 真实终端 + xterm.js 渲染），运行时仍是 no-build。

## 快速开始

### 桌面版（推荐）

从 [**Releases**](https://github.com/alchaincyf/fanbox/releases/latest) 下载最新的 `.dmg`，双击安装、拖进「应用程序」即可。Apple Silicon (arm64) 原生。

> 已用 Apple Development 证书签名 + hardened runtime。首次打开若提示「未验证的开发者」：**右键 → 打开 → 确认**即可；要做到任意 Mac 双击零警告，需升级 $99 Developer ID + 公证。
>
> 自己打包：`npm install && npm run dist`，产物在 `dist/`（安装包不入 git，统一走 Releases 分发）。

### 网页版（不打包，直接跑）

```bash
node server.js
```

浏览器打开 `http://localhost:4567`。网页版只有文件浏览/搜索/预览/打开，没有内嵌终端和编辑器（那些靠 Electron 提供）。

> 换端口：`FANBOX_PORT=8080 node server.js`　·　不自动开浏览器：`FANBOX_NO_OPEN=1 node server.js`

### 开发模式（带终端的本地调试）

```bash
npm install          # 首次
npm run app          # electron . 启动桌面版
```

## 核心功能

### 文件 · 找回与预览
- **⌘K 全局模糊搜索** — 文件和文件夹都能找回，记得名字片段就行；`⌘↵` 用编辑器整包打开；`内容:关键词` 切全文搜索。
- **强色实体图标** — 每种文件「长得像它自己」：PDF 红、JS 黄、Markdown 蓝、HTML 橙 `<>`、压缩包琥珀、文件夹扁平实心，扫一眼就认出类型；照片/视频按各自真实比例呈现、视频叠播放键。
- **原地预览** — Markdown 渲染、HTML 实时成品、代码语法高亮、图片/视频/PDF 内嵌（HEIC 直接显示）；底部显示大小/创建/修改时间。
- **缩略图加速** — 图片/视频走缓存缩略图端点（sips/qlmanage），大文件夹滚动和点击都在 0.1 秒内。
- **一键打开** — 默认应用 / VS Code / 在 Finder 显示 / 复制路径 / 复制图片 / 复制文件。
- **收藏 + 最近** — 常用目录收藏常驻；最近打开记录所有查看过的文件（含内部预览），按时间排序。
- **项目徽章** — 文件夹卡片右上角标 node / web / py / rs / go 徽章，AI 一下午起的十个项目一眼认出类型。

### 看 agent 改了什么
- **活的仪表盘** — agent 每写一个文件，那张卡片当场荡开涟漪、弹一下、按改动频率发光并持续呼吸，agent 写到哪光走到哪，让「看 agent 干活」有现场感。
- **会话回放** — 「变更」面板里点「▶ 回放」，像刷视频一样拖时间轴，重现这段时间 agent 一步步改了哪些文件，有播放键和「此刻正在改 X」实时读数。
- **变更收件箱** — 顶栏「变更」按钮汇总本会话所有被改动的文件（跨多个监听目录、跨多个项目），点开回看、点击直达预览。多项目并行跑 agent 时不再各看各的。
- **Git 改动 diff** — 文本预览里一键「查看改动」，用 Monaco 只读 DiffEditor 并排展示 HEAD vs 当前工作区，看清 agent 到底改了哪几行。
- **多目录监听** — 浏览目录 + 每个终端的项目目录同时监听，不在前台的项目变更也实时进收件箱。

### 人 × agent 的顺手联动
- **一键启动 agent** — 终端栏的 Claude / Codex 按钮，一点就在终端跑起对应命令（终端没开自动开）。
- **选中即甩给终端** — 在 md / 代码预览里选一段文字，浮现「发到终端」，点击后内容带残影飞进终端落下，以「文件出处 + 围栏」格式落到输入行（bracketed paste 包裹，不会被 agent 逐行误提交）。
- **环境感知陪伴** — agent 把球踢回给你时终端边缘呼吸提示「轮到你」；长任务完成时文件区荡开涟漪 + 一声极轻的提示音（窗口失焦还发系统通知），右下角 🔔 可静音。

### 终端 · 指挥 agent
- **真实内嵌终端** — node-pty + xterm.js（WebGL 渲染），跑 Claude Code / vim / htop 等 TUI 不花屏，中文宽字符正确。
- **多终端标签 + 态势感知** — 多会话互不干扰，cwd 各自独立；标签上的小圆点显示 agent 运行中 / 空闲 / 已退出，非当前标签有新输出标记未读，长任务完成且窗口失焦时发系统通知。关闭标签不泄漏进程。
- **拖文件进终端** — 从侧栏/文件列表拖文件或文件夹进终端，自动插入路径喂给 agent 当上下文。
- **路径可点击** — 终端里出现的文件名/路径可点击，结合 cwd + 搜索定位最相关的文件，直接在翻箱打开。
- **高优先级布局** — 终端可铺满、可拖到顶/靠右；右靠时预览自动落到文件列表下方，二者垂直互不抢空间。

### 编辑 · 所见即所得
- **Markdown** — Milkdown Crepe 提供飞书/Notion 式所见即所得编辑（自动保护 YAML frontmatter）。
- **代码/JSON/纯文本** — Monaco 编辑器（VS Code 同款内核），随皮肤切换主题。
- **图片编辑** — 自由画笔/直线/箭头/文字/打码、格式转换、压缩、分辨率调整，原生保存（覆盖原图前有确认）。
- **未保存守卫** — 三种编辑器统一拦截未保存退出，Esc 旁路也堵死。

### 外观
- **三套皮肤一键切换**（侧栏左下角），配色、字体、图标、代码高亮整体随之变化，选择记忆在本地：
  - **终端** · Volt 荧光绿 × 炭黑 × 等宽字，工业仪器面板感（默认）
  - **档案** · 奶油纸 × 赤陶橙 × 衬线，温暖纸感档案馆
  - **索引** · 黑白 × 信号红/绿 × 巨号字，编辑式索引日报
- **可折叠面板** — 侧栏 ⌘B 折叠、面板可收起、布局切换有过渡动效。

## 快捷键

| 操作 | 键 |
|---|---|
| 全局搜索 | `⌘K` |
| 折叠侧栏 | `⌘B` |
| 当前目录筛选 | `/` |
| 结果上下选择 | `↑` `↓` |
| 打开/预览 | `↵` |
| 用编辑器打开 | `⌘↵` |
| 后退 | `⌘[` |
| 关闭 | `Esc` |

## 隐私与安全

- 后端只在本机回环地址监听 + 校验 Host 头（挡住 DNS rebinding 类本地攻击），数据不出本机。
- 全部前端资源（含 Markdown 渲染、代码高亮、字体）本地内置，运行时无任何外网请求，离线完全可用。
- HTML 预览在隔离 origin 的沙箱 iframe 里渲染，预览不可信网页也碰不到终端能力。
- 收藏、最近、窗口状态存在 `~/.fanbox/`；缩略图缓存在 `~/.fanbox/thumbs`（按最旧优先自动裁剪，上限 400MB）。
- 配置写入走串行化「读-改-写」+ 原子写（temp + fsync + rename），高频记录不丢数据、不留半截 JSON。
- 文件操作默认轻量：预览只读，编辑保存有确认，删除走系统废纸篓（可恢复）。

## 技术栈

| 层 | 用什么 |
|---|---|
| 后端 | 零依赖 Node.js `server.js`（文件 API + 静态服务 + 缩略图） |
| 桌面壳 | Electron 33 + node-pty（asarUnpack 原生模块） |
| 终端 | xterm.js + addon-webgl + addon-fit + addon-unicode11（CJK 宽度） |
| 编辑器 | Monaco（代码）+ Milkdown Crepe（Markdown 所见即所得） |
| 打包 | electron-builder → 签名 arm64 .dmg |
| Vendor 构建 | esbuild 一次性打包 Milkdown（`npm run build:milkdown`），运行时保持 no-build |

## 构建命令

```bash
npm run app              # 开发：electron . 启动
npm run start            # 只跑网页后端（node server.js）
npm run build:milkdown   # 重新打包 Milkdown vendor（改了 src-vendor 才需要）
npm run build:hljs       # 重新打包 highlight.js + 复制 marked/样式到 public/vendor
npm run dist             # 打包签名 .dmg（被代理挡 GitHub 时加 ELECTRON_MIRROR）
```

> 打包遇到 Electron 下载被墙：`ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" npm run dist`

## 项目结构

```
fanbox/
├── server.js               # 零依赖 Node 后端（文件 API + 缩略图 + 静态服务）
├── electron/
│   ├── main.js             # 主进程（窗口/pty/剪贴板/fs.watch/菜单）
│   └── preload.js          # 暴露 fanboxPty / fanboxFs / fanboxClipboard
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js              # 前端单页应用
│   └── vendor/             # xterm / monaco / milkdown 本地资源
├── src-vendor/
│   └── milkdown-entry.js   # esbuild 入口，产出 public/vendor/milkdown
├── build/
│   ├── icon.icns           # 档案暖色立方体图标
│   └── entitlements.mac.plist
├── docs/                   # 概念/PRD/路线图/验收标准
└── dist/                   # 打包产物（.dmg）
```

## 设计取舍

翻箱不跟 Finder 拼文件操作（剪切/重命名/批量移动），专注「找回 + 预览 + 轻改 + 指挥 agent」这条链路做到顺手。不做云、不做远程、不做账号，本地、零配置、运行时零依赖。

## 验收

每个开发阶段由 5 个独立 subagent 扮演不同角色（重度 vibe coder / 原生审美设计师 / 零文档新用户 / 终端十年老兵 / 破坏性质量官），审「成品 + 真机截图 + 代码」打分，全部 ≥90 分且无红线才算达标。详见 `docs/05-验收角色与评分标准.md`。

MIT License.
