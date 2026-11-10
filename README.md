# Level Builder — Web Greybox Level Design Workbench

**Level Builder** 是一款直接在浏览器中运行的 3D / 2D 白盒关卡设计工作台（Greybox Level Design Workbench），支持三视口实时联动（3D 立体视口、2D 俯视蓝图、2D 动态剖面/横版视口）、玩家与敌人 3D 视野锥及相机视锥体分析、跳跃抛物线能力包络线校验、实机物理漫游测试（Playtest），以及导出至 Unity C# / glTF (GLB) / OBJ / SVG / Markdown 设计文档。

---

## 🌐 在线访问 (GitHub Pages)

本项目已内置 **在线纯前端网页模式（Online Static Web Mode）** 与 **GitHub Pages 自动构建工作流**（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）：
- 在线打开网页即可直接使用全部 **3D 立体空间 / 2D 横版卷轴 / 2D 俯视角地牢** 关卡设计工具、模板库、实机物理漫游与文件导入/导出功能。
- 所有编辑进度实时自动保存在浏览器的 `localStorage` 中，无需依赖本地后端服务器。

### 开启 GitHub Pages 步骤
1. 将本仓库推送到 GitHub（`main` 分支）。
2. 进入 GitHub 仓库页面 ➔ **Settings** ➔ **Pages**。
3. 在 **Build and deployment** 下将 **Source** 选择为 **`GitHub Actions`**。
4. 等待 Actions 中的 `Deploy Level Builder to GitHub Pages` 执行完成（约 1 分钟），即可通过生成的 `https://<你的用户名>.github.io/Level-Builder/` 在线访问！

---

## 💻 本地运行（含 AI Bridge & MCP 服务）

如果需要在本地配合 Claude Code / OpenAI Codex CLI 实时驱动关卡生成：

```bash
npm install
npm start
```
或者直接双击根目录下的 `启动LevelForge.bat`。

可选环境变量（Bridge / CLI / MCP / Vite 代理共用）：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `LEVELFORGE_PORT` | `4399` | Bridge 服务端口 |
| `LEVELFORGE_LEVEL_FILE` | `levels/current.level.json` | 关卡文件路径（可指向别的关卡，或用于测试而不动正式文件） |

Bridge 只接受来自本机 / 局域网页面的请求（按 `Origin` 校验）；CLI、MCP、curl 等不带 `Origin` 的本机工具不受影响。
