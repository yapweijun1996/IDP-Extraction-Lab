# SPEC.md

## 文档版本
- 版本：v1.0（对应当前主分支实现）
- 最后更新：2026-08-14
- 依据：源码与仓库配置（`package.json`, `vite.config.mjs`, `src/*`, `scripts/*`, `tests/*`）

## 1. 范围与边界

### 1.1 项目范围
- 单页静态 PWA。
- 本地运行 BYOK 提取流程。
- 不包含 ERPs、数据库写入、服务器作业、自动化 HITL。

### 1.2 部署模型
- 静态产物发布（`dist/`）。
- 目标环境：GitHub Pages 或同类静态站点。
- 运行时行为不依赖服务器端逻辑。

## 2. 功能需求（Functional Requirements）

### FR-001 本地提取主流程
- 支持上传/选择文档并触发提取。
- 通过主流程契约驱动 Provider。
- 按字段与行项目输出结构化结果。
- 显示提取状态、错误、问题与 Trace。

### FR-002 证据与可追溯性
- 每个字段/行要素在可校验范围内形成 evidence 记录。
- 缺失证据的字段返回 `null` 或 `needs_review`，不得伪造裁切或字段值。

### FR-003 交互可见性
- 支持多语言 UI（`en`, `zh-CN`, `ms`, `ja`, `vi`）。
- 支持桌面三栏布局和移动端标签切换。
- 支持字段增删改、字段拖拽与自定义。

### FR-004 Provider 集成
- 支持 Gemini、OpenAI 提供商选择。
- 支持 provider 配置测试与删除。
- 提供商密钥通过本地加密存储，不落地明文。

### FR-005 离线与更新
- PWA 能缓存核心壳资源。
- Provider 请求为网络直连，不进入 Cache。
- 更新通过用户确认 prompt 触发，支持更新失败重试。

### FR-006 任务与历史
- 结果、运行记录、凭据元信息、文档状态可持久化在本地库。
- 支持导出运行结果。

## 3. 非功能需求（NFR）

### NFR-001 构建与复现
- 支持 `npm run build` 可产出可部署 `dist/`。
- 提供 `scan:dist` 与 `verify:standalone` 命令进行静态一致性与发布可移植性检查。

### NFR-002 质量与自动化
- `npm test` 覆盖核心 runtime/validation/state/ui 测试。
- `qa:browser`/`qa:pwa-update` 用于 UI 回归和 PWA 更新行为验证。

### NFR-003 安全
- Provider 端点固定为官方域名。
- `.gitignore` 必须过滤构建产物与临时文件。
- 禁止将测试密钥写入源码或输出。

### NFR-004 兼容性
- 目标运行在现代 Chromium 系浏览器（Playwright 与本地开发默认）。
- 基础运行时目标为 `es2022`。

## 4. 依赖

### 运行依赖
- `pdfjs-dist@6.2.108`（PDF 渲染）

### 开发依赖
- `vite@8.2.1`
- `vite-plugin-pwa@1.3.0`
- `playwright-core@1.62.1`
- `sharp@0.35.3`
- `fake-indexeddb@6.2.5`

## 5. 约束与限制
- 无后端服务参与（文件读取、提取和状态管理均在客户端）。
- 不对外引入新前端框架。
- 不做大规模 API 抽象重构，当前以结构治理为主。
- 未提交 `.github/workflows/pages.yml` 是一个明确阻塞点，影响 `verify:standalone` 的严格通过。

## 6. 当前实现状态
- 已完成：源码分层重构、路径与 import 全量更新、构建/测试脚本更新、README 精修。
- 进行中：部署链完整性（pages workflow）对齐。
- 待办：清理计划中的临时文件二次确认与删除（在未影响验证前提下）。
