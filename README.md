# IDP Extraction Lab - Static BYOK PWA

## 项目定位

IDP Extraction Lab 是一个前端为主的文档提取实验项目，使用本地浏览器执行 BYOK（Bring Your Own Key）方式的提取流程。

- 采用 Vite + Service Worker，支持 GitHub Pages 等静态托管
- 无需 CFML、Node 后端服务、Python 或 `.env` 运行时依赖
- 包含本地运行时（`vendor/agrun.js`）、公开示例文档（`samples/`）和页面工作流配置
- 默认不在仓库中放置客户文档、Golden 数据或生产凭据

当前源码已按职责重构为：

- `src/app/`：应用入口和主事件编排
- `src/runtime/`：Worker 与运行时桥接
- `src/providers/`：Provider 适配与归一化
- `src/validation/`：字段校验与结构化输出处理
- `src/state/`：本地状态与持久化
- `src/ui/`：渲染组件与图形控件
- `src/i18n/`：国际化资源
- `src/contracts/`：提示词与动作契约

## 核心工作流

```text
PDF / 图像 + 提取契约
  -> PDF.js 渲染
  -> 专用 Worker
  -> 选定的 BYOK Provider（Gemini / OpenAI）
  -> 决定性校验
  -> 可控 inspect_region 决策
  -> 精准裁切 + 复核视图
  -> 定向重读与证据驱动回写
  -> JSON 化结果与加密 IndexedDB 持久化
```

关键特征：

- UI 只负责生成 `idp_extraction_contract_v1`，不要求用户手写 JSON Schema
- Provider 输出按契约 allowlist 映射，未知字段会丢弃
- 缺失字段保留 `null`，不做猜测填充（fail-closed）
- 每个字段/行都需要证据锚点（bbox）要求，无证据时不伪造高亮
- 缩略图为低并发后台队列，优先渲染当前页，再逐步推进其余页

## 安全边界（实验性质）

本项目为内部实验，不是生产级凭据体系。

- Provider 端点固定为官方 Gemini/OpenAI 域名
- Provider 密钥不进入 URL、UI 状态、导出、Trace、Service Worker 缓存或 GitHub Actions
- 密钥输入为密码框，保存在 IndexedDB 的 AES-GCM 256-bit 设备密钥下加密
- 每条加密记录包含版本/存储/记录 ID 元数据
- 已知限制：无法防御同源恶意脚本、浏览器扩展、受损依赖或当前页面解锁后的劫持

数据库 `idp-extraction-lab-v1` 包含：

- `vault`
- `provider_credentials`
- `documents`
- `runs`
- `artifacts`

应用请求持久化配额为 250MB 或浏览器配额的 80%（取较低者）；持久化失败时会提示尽快导出数据。

## 平台能力与约束

### 能力

- 本地化语言：`en`、`zh-CN`、`ms`、`ja`、`vi`
- 桌面端支持三栏可调布局（字段 / 文档 / 结果）
- 字段与结果高亮遵循验证后的 bbox
- PWA 采用用户确认式更新，不自动后台热更新
- 离线模式可查看壳与本地历史，提取与测试连接会被禁用

### 约束

- 文件上限：20MB，页面数：50 页
- 主渲染：144 DPI；复核渲染：400 DPI（最大 500 DPI）
- 缩放上限：4x；派生视图最大 16MP / 8MB
- 每个未解决问题：最多 2 次补检，单次决策最多 6 个区域
- 总迭代：5 次；总调用：60 次；超时：10 分钟
- 不支持 HITL、任意外部端点、文件系统、shell、子代理或无界递归

坐标规则：Provider 边界使用 `box_2d=[ymin,xmin,ymax,xmax]`（0~1000 整数）；内部归一化为 `{x,y,width,height}`。
反向、越界、零面积、页外、超大区域会被拒绝。

## 最近复现说明（2026-08-14）

- 示例文档：`samples/SYN_USD_PO_TEST001.pdf`
- 已知结果：1 页、5 条行项全部命中；关键定位命中 10/10；可复核问题 0
- Provider 模型调用：1 次（基于真实 BYOK）

该结果来自受控示例，仅用于回归验证，不代表对任意客户文档的生产准确率。

另外一次针对缺失字段的失败闭环测试显示：

- 仍能保留运行稳定性
- 缺失字段保持 `null`
- 追踪记录了 `required_field_missing` 与定位预算耗尽信息
- 未生成伪造值或伪造 bbox

12 页私有回归样本在本地也进行了验证，出现了 60 次调用上限导致的中途终止。该情况用于预算与可观测性验证，不作为准确率结论。

## 开发与验证

建议环境：Node.js 24。

```powershell
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm ci
npm run dev
```

打开 Vite 页面后，在 Provider 设置中填入测试密钥并手动点击：

- `Test connection`
- `Run Extraction`

这两项都会发起真实付费调用。

### 常用命令

```powershell
npm test
npm run build
npm run scan:dist
npm run verify:standalone
npm run qa:browser
npm run qa:pwa-update
npm run check
```

`verify:standalone` 依赖 `.github/workflows/pages.yml`，仓库若缺失该文件会显示失败。

## GitHub Pages 与迁移说明

- 静态产物使用 `dist/` 发布
- 通过静态部署链路发布，不引入服务端 secrets
- 发布前请确保 `.gitignore` 已过滤：`node_modules/`、`dist/`、日志和临时文件

独立迁移到新仓库时建议保留：

- `package.json`
- `vite.config.mjs`
- `index.html`
- `.github/`

并重新运行：

```powershell
npm ci
npm run check
```

## 离线与服务端行为

- SW 会缓存壳文件、PDF.js、agrun、图标及示例 PDF
- Provider POST 请求始终走网络，不会写入 Cache API
- 离线时可查看历史与切换语言，但不会误报成功提取

## 目录外范围

- ERP 对接与数据写入
- Golden 评分与生产级准确率承诺
- 客户真实文档上云托管
- CI 中的模型准确率仿真
