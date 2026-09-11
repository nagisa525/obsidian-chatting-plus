# Chatting with AI Plus

[English](README.md) | [简体中文](README.zh-CN.md)

[![最新版本](https://img.shields.io/github/v/release/nagisa525/obsidian-chatting-plus?include_prereleases&label=release&color=7c3aed)](https://github.com/nagisa525/obsidian-chatting-plus/releases)
[![下载量](https://img.shields.io/github/downloads/nagisa525/obsidian-chatting-plus/total?color=7c3aed)](https://github.com/nagisa525/obsidian-chatting-plus/releases)
[![许可证](https://img.shields.io/github/license/nagisa525/obsidian-chatting-plus?color=7c3aed)](LICENSE)
[![Obsidian](https://img.shields.io/badge/obsidian-1.11.4%2B-7c3aed)](https://obsidian.md)

**直接运行在 Obsidian 仓库中的智能 AI 助手，在手机、平板和桌面端提供一致体验。**

> Chatting with AI Plus 是 [Chatting with AI](https://github.com/o1xhack/obsidian-chatting) 的独立 MIT 许可分支。它保留了上游作者的版权声明，并新增命名对话历史、图片输入、Markdown 数学公式渲染和稳定的移动端聊天布局。
>
> 特别感谢 [o1xhack/obsidian-chatting](https://github.com/o1xhack/obsidian-chatting) 的维护者创建了本项目所基于的开源基础。

<p align="center">
  <img src="assets/screenshot-settings.png" alt="iPhone 上的模型服务设置" width="260">
  <img src="assets/screenshot-chat-cn.png" alt="包含联网搜索结果的中文回答" width="260">
  <img src="assets/screenshot-chat-en.png" alt="带有项目符号列表的英文回答" width="260">
</p>

---

## ✨ 主要特点

- **三种模型服务可选**：Anthropic API、OpenAI API，或直接登录 ChatGPT 账号。
- **14 个仓库原生工具**：读取、编辑、搜索、创建、重命名笔记，管理属性与反向链接。
- **移动端一致体验**：不依赖 Node.js 模块、流式传输或本地回调服务器，同一套代码适用于 iOS、Android 和桌面端。
- **选中文本范围**：选中笔记内容后发送到聊天，助手只修改选中的范围。
- **命名对话历史**：在 History 抽屉中新建、切换、重命名和删除独立对话。
- **图片对话**：可通过图片按钮或粘贴操作附加图片，由支持图片的模型进行识别。
- **Markdown 与公式渲染**：使用 Obsidian 原生 Markdown 渲染器显示回答及常见 LaTeX 公式。
- **系统密钥存储**：API 密钥和 OAuth 凭据保存在 Obsidian SecretStorage 中，不写入 `data.json`。

## 💬 对话历史

点击聊天页顶部的 **New conversation** 按钮，先为新对话命名，再进入新的对话页面。打开 **History** 可以切换、重命名或删除对话。每个对话拥有独立的可见记录和模型上下文，Obsidian 重启后会恢复最近使用的对话。

## 🖼️ 图片附件

点击输入框旁的图片按钮，或把图片直接粘贴到输入框。每条消息最多可附加 4 张 PNG、JPEG、WebP 或 GIF 图片，每张最大 8 MB。图片会发送给当前选择的 AI 服务商，请确认你同意向该服务商提供图片内容。

## ∑ Markdown 与数学公式

助手回答通过 Obsidian 原生 Markdown 渲染器显示。行内和独立公式支持 `$...$`、`$$...$$`，插件还会自动兼容 AI 常见的 `\(...\)`、`\[...\]` 以及 `math`、`latex`、`tex` 围栏代码块格式，同时避免改写普通代码块中的示例。

## 🛠️ 14 个仓库原生工具

| 分组 | 工具 | 功能 |
|---|---|---|
| **读取** | `read_document`、`read_file`、`search_vault`、`list_files`、`get_backlinks`、`get_properties`、`get_current_datetime` | 打开文件、搜索名称和内容、浏览目录、查找反向链接、读取属性以及获取本地时间。 |
| **写入** | `edit_document`、`create_file`、`set_properties` | 精确查找替换、插入或完整替换内容，创建笔记并安全更新 YAML 属性。 |
| **管理** | `rename_file`、`delete_file`、`open_document`、`ask_user` | 重命名或移动文件、按仓库设置移入废纸篓、打开文档，并在操作不明确时询问用户。 |

## ⚙️ 模型服务

| 服务商 | 登录方式 | 默认模型 | 说明 |
|---|---|---|---|
| **Anthropic** | API 密钥 | Claude Sonnet 4.6 | 支持自适应思考、联网搜索和提示词缓存。 |
| **OpenAI** | API 密钥 | Codex 5.3 | 使用 Responses API，支持推理与联网搜索。 |
| **ChatGPT 账号** | 登录 ChatGPT | GPT-5.5 | 使用现有 ChatGPT 套餐，无需单独填写 OpenAI API 密钥。 |

> **关于 ChatGPT 账号登录：** 请求通过 ChatGPT/Codex 后端而不是 `api.openai.com` 发送，需要拥有可使用 Codex 的有效 ChatGPT 套餐。可用模型与 Codex CLI 的模型目录保持一致。

## 🚀 快速开始

插件通过社区目录审核后：

1. 打开 Obsidian 的 **设置 → 第三方插件 → 浏览**。
2. 搜索 **Chatting with AI Plus**。
3. 点击 **安装**，然后点击 **启用**。
4. 打开 **设置 → Chatting with AI Plus**，选择服务商并填写 API 密钥，或点击 **Connect ChatGPT**。
5. 通过左侧功能区图标或命令面板打开聊天。

## 📦 安装

### 社区插件市场

首个版本被社区插件目录接受后，可直接在 Obsidian 的第三方插件市场中搜索并安装 **Chatting with AI Plus**。

### 与上游插件同时安装

Chatting with AI Plus 使用独立的插件 ID、设置、聊天历史、视图类型和 SecretStorage 密钥。它可以和原版 Chatting with AI 同时安装，不会读取、移动或删除原插件的数据。每台设备需要分别配置服务商凭据。

<details>
<summary><b>手动安装 Release</b></summary>

1. 从[最新版本](https://github.com/nagisa525/obsidian-chatting-plus/releases/latest)下载 `main.js`、`manifest.json`、`styles.css`。
2. 将三个文件放入 `<仓库>/.obsidian/plugins/chatting-with-ai-plus/`。
3. 重启或重新加载 Obsidian，然后在第三方插件设置中启用 **Chatting with AI Plus**。

</details>

<details>
<summary><b>从源码构建</b></summary>

```bash
git clone https://github.com/nagisa525/obsidian-chatting-plus.git
cd obsidian-chatting-plus
npm install
npm run build
```

</details>

## 🧭 设计原则

| 原则 | 含义 |
|---|---|
| **移动端不是附属功能** | 所有改动都以 iOS 和 Android 兼容为约束，不使用仅限桌面的 Node.js 模块。 |
| **控制服务商数量** | 通过 Anthropic、OpenAI 和 ChatGPT 账号覆盖主要使用方式，减少移动端兼容组合。 |
| **凭据存放在系统密钥库** | API 密钥和 OAuth 凭据通过 Obsidian SecretStorage 保存，不进入 `data.json`。 |
| **不建立仓库索引** | 采用有上限的线性搜索，不在后台持续索引仓库。 |
| **对话可持久保存** | 命名对话记录保存在本机 `chat-state.json` 中，并在 Obsidian 重启后恢复。 |

## 🗺️ 开发计划

- [x] Anthropic、OpenAI 与 ChatGPT 账号三种服务
- [x] 14 个仓库原生工具
- [x] iOS / Android 兼容
- [x] 选中文本范围操作
- [x] 支持重命名和删除的多对话历史
- [x] 支持模型识别图片附件
- [ ] Obsidian 官方社区插件目录上架
- [ ] 对话归档与搜索
- [ ] 自动跟进上游新增模型

## ❓ 常见问题

<details>
<summary><b>我的笔记会被上传吗？</b></summary>

只有当前任务需要的内容会发送给你选择的模型服务商。助手调用 `read_document`、`search_vault` 等工具取得的内容，以及当前活动笔记上下文，可能成为请求的一部分。插件不会在后台上传或索引整个仓库。

</details>

<details>
<summary><b>真的支持移动端吗？</b></summary>

支持。网络请求使用 Obsidian 的 `requestUrl()`，不使用流式传输、Node.js 专属模块或 localhost OAuth 回调。iOS、Android 和桌面端运行同一套主要代码路径。

</details>

<details>
<summary><b>使用 ChatGPT 账号登录是否免费？</b></summary>

它使用你已有的 ChatGPT 套餐，不产生插件自身的额外费用。你需要拥有可使用 Codex 的有效套餐。Anthropic 和 OpenAI API 的费用则由对应服务商收取。

</details>

<details>
<summary><b>聊天历史和密钥会同步到 iPad 吗？</b></summary>

聊天历史保存在 `<仓库>/.obsidian/plugins/chatting-with-ai-plus/chat-state.json`，默认不会通过 Obsidian Sync 同步。API 密钥与 ChatGPT OAuth 凭据位于每台设备的系统密钥存储中，也不会自动同步，因此需要在 iPad 上单独登录或填写密钥。

</details>

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request。提交代码前请运行：

```bash
npm run lint
npx tsc --noEmit
npm run svelte-check
npm run build
```

影响界面或交互的改动应至少在一个移动平台上测试。

## 🙏 致谢

特别感谢 [o1xhack/obsidian-chatting](https://github.com/o1xhack/obsidian-chatting) 的维护者和贡献者，他们的开源工作构成了 Chatting with AI Plus 的基础。该项目最初派生自 [omarshahine/obsidian-chat](https://github.com/omarshahine/obsidian-chat)。两个上游项目均使用 MIT 许可证，相关版权声明已保留在 `LICENSE` 中。

## 📄 许可证

[MIT](./LICENSE)

---

维护者：[nagisa525](https://github.com/nagisa525)
