# EPIC.md

## EPIC-01：源码结构治理（已完成）

目标：将平铺 `src` 拆分为职责分层目录，减少耦合与维护成本。

状态：✅ 已完成

完成项：
- 建立 `src/app`, `src/runtime`, `src/providers`, `src/validation`, `src/state`, `src/ui`, `src/i18n`, `src/contracts`。
- 将主入口切到 `src/app/main.js`。
- 同步 `import`、测试引用、Vite 资产映射。

验收标准：
- 构建通过且行为未引入新语义变更。
- `src` 结构清晰且可按层查找。

## EPIC-02：提取运行时与文档完整性（进行中）

目标：保持提取主链路在重构后稳定，保留证据与 fail-closed 行为。

状态：⚠️ 进行中（可运行链路已保持）

完成项：
- `runtime/`, `providers/`, `validation/` 分层并保持契约约束。
- 证据失效与缺失情形继续走可追溯失败路径。
- 本地化、布局、缩略图与渲染能力保留。

待补齐：
- 与新目录下文档对齐的最终用户行为文档（本次补齐已推进）。

验收标准：
- `npm run check` 相关链路在支持 BYOK 的真实环境下可复现。
- 关键异常行为（mapping fail / inspect stop / needs_review）保持不变。

## EPIC-03：离线、PWA 与验证自动化（进行中）

目标：保证离线行为可验证、PWA 更新有提示性流程。

状态：⚠️ 进行中

完成项：
- Vite PWA 插件接入与显式更新策略。
- `NetworkOnly` 保障 Provider 请求不缓存。
- `qa:pwa-update` 与 `qa:browser` 脚本存在且用于验收。

风险：
- 发布验证命令 `verify:standalone` 依赖 `.github/workflows/pages.yml`，当前仓库中未纳入该文件。

## EPIC-04：仓库治理与安全边界（进行中）

目标：降低运行时噪音、明确可清理项。

状态：⚠️ 进行中

完成项：
- 新增 `.gitignore`。
- 新增 `docs/cleanup-plan.md` 并列出无用文件候选。
- `THIRD_PARTY_NOTICES.md` 与示例样本哈希保留。

待办：
- 将临时日志/截图进入正式确认流程后再清理。

验收标准：
- `git status` 不受构建缓存和临时文件污染。
- 每次清理动作都有验证闭环（test/build/scan）。

## EPIC-05：文档体系（进行中）

目标：以分层文档统一记录架构、需求、路线图与任务。

状态：✅ 已开始

完成项：
- 更新 `README.md`。
- 新建 `DESIGN.md`, `SPEC.md`, `EPIC.md`。

进行中：
- 已同步 `ROADMAP.md`, `TASK.md`。

验收标准：
- 文档术语一致、状态一致、可直接用于交接。
