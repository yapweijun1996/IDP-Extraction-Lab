# DESIGN.md

## 设计目标

IDP Extraction Lab 采用前端优先、离线优先的静态单页架构，核心目标为：

- 在浏览器本地执行文档提取流程。
- 提供 BYOK（Bring Your Own Key）模型调用路径。
- 在不改动核心业务语义的前提下，降低代码管理成本。
- 支持可复制的本地验收与可复现构建。

## 总体架构

```text
UI (index.html + idp-lab.css + src/app/main.js)
  -> 应用状态与事件编排（字段、文档、结果、布局、语言、Provider）

PDF 文档
  -> PDF 渲染/缩略图（src/ui/*）

提取契约 + 提示词（src/contracts/*）
  -> runtime worker（src/runtime/runtime-worker.js）

Provider 适配（src/providers/*）
  -> Gemini / OpenAI

校验与结构化映射（src/validation/*）
  -> 结果与证据

持久化与运行记录（src/state/*）
  -> IndexedDB（vault / runs / documents / traces / provider credentials）

服务工作线程与离线能力（vite-plugin-pwa + src/runtime/telemetry.mjs）
  -> 离线壳、显式更新提示与网络-only Provider POST
```

## 源码分层（按目录）

- `src/app/`
  - 应用入口与主流程编排。
  - 已包含：`main.js`
- `src/runtime/`
  - Worker 客户端桥接、Worker 本体、遥测。
  - 已包含：`runtime-client.mjs`, `runtime-worker.js`, `telemetry.mjs`
- `src/providers/`
  - Provider 配置、模型交互与归一化。
  - 已包含：`contract.mjs`, `provider-client.js`, `provider-page-normalizer.js`
- `src/validation/`
  - 响应校验、结构化 JSON 处理。
  - 已包含：`validation-core.js`, `validator.mjs`, `structured-json.js`
- `src/state/`
  - 本地状态、布局、密钥与结果持久化。
  - 已包含：`layout-state.mjs`, `vault.mjs`
- `src/ui/`
  - UI 渲染、图标、缩略图、文本高亮。
  - 已包含：`pdf-renderer.mjs`, `thumbnail-queue.mjs`, `highlight-bbox.mjs`, `icons.mjs`, `g3tooltip.js`
- `src/i18n/`
  - 本地化词条与语言切换。
  - 已包含：`i18n.mjs`, `localization.js`
- `src/contracts/`
  - Prompt 与 worker/action 契约。
  - 已包含：`extraction-prompt.js`, `inspection-action-config.js`

## 关键模块与职责边界

- `src/app/main.js`
  - 负责：字段模型、文档加载、提取发起、页面交互、结果渲染、异常展示。
  - 不直接承担协议耦合逻辑（映射/校验/Provider 交互均委派至对应层）。

- `src/runtime/`
  - `runtime-client.mjs`：启动/通信 Worker。
  - `runtime-worker.js`：执行提取运行时。
  - `telemetry.mjs`：安全 trace 与埋点脱敏。

- `src/providers/`
  - 承担 Provider 的输入输出标准化。
  - 责任边界：Provider 响应必须通过验证与 allowlist 映射。

- `src/validation/`
  - 负责：结构化 JSON 兼容层、字段映射校验、错误分类。
  - 责任边界：失败返回为 `null/needs_review` 而非静默猜测。

- `src/state/`
  - 负责：`localStorage` 布局持久化、IndexedDB Vault 与加密存储。
  - 责任边界：存储对象为状态与运行信息，不包含明文 Provider 密钥。

## 数据流与失败行为

- 成功路径：
  1. 用户定义字段与契约。
  2. Worker 使用契约与 prompt 发起提取。
  3. Provider 结果经过验证与映射。
  4. 生成带证据的结果对象。
  5. 渲染到 UI，并持久化运行记录。

- 失败与降级路径：
  - 任何阶段映射/校验失败都按 fail-closed 处理。
  - 缺失或冲突证据不造假高亮，不覆盖已存在的可信字段。
  - 失败信息可在 Issues Drawer 与 Trace 面板查看。

## 安全与边界设计

- BYOK 实现与本地加密，不引入后端密钥托管。
- Provider POST 使用 `NetworkOnly` 缓存策略，不写入 Cache API。
- PWA 更新采用 `registerType: "prompt"`，用户确认后才激活。
- `.github/workflows/pages.yml` 作为独立部署校验源目前在源码目录缺失，属于当前架构发布链的阻塞项。

## 关键技术决策

- 保持 `.js` 与 `.mjs` 混合扩展名，避免一次性大规模 import 重写。
- 使用分层目录替代平铺结构，降低职责耦合风险。
- 静态资源构建策略：通过 Vite 插件将关键 runtime/样本/assets 映射到固定产物名，兼容 Worker/脚本旧式路径依赖。
- 不新增别名系统（如 `@/`）以减少一次性重构范围。
