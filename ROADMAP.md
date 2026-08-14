# ROADMAP.md

## 目标状态（2026-08-14）

本项目当前位于“结构治理 + 文档化同步”阶段。核心代码已完成重构，下一步目标是补齐发布链条与治理闭环。

## 里程碑

### 已完成（M1）

- `src` 分层重构：按应用、运行时、provider、验证、状态、UI、i18n、契约组织。
- 更新主入口与运行时引用：`index.html` 指向 `src/app/main.js`。
- Vite 资产映射更新：`src/contracts/*`, `src/validation/*`, `src/providers/*`, `src/i18n/*`, `src/runtime/*`。
- 测试引用路径更新与验证脚本就绪。
- 追加 `.gitignore` 与 `docs/cleanup-plan.md`。
- `README.md` 已进行结构化重写。

### 进行中（M2）

- 文档链完整化：
  - 完成 `DESIGN.md`, `SPEC.md`, `EPIC.md`。
  - 待补齐 `ROADMAP.md`, `TASK.md`（当前任务）。
- 对齐 `verify:standalone` 依赖项：补齐必要发布文件/流程依赖，减少阻塞。

### 未完成（M3）

- `.github/workflows/pages.yml` 及其发布文档联动。
- 删除/归档 `docs/cleanup-plan.md` 中高概率无用项（`tmp-*`, `vite-*log`）
  - 需先确认外部脚本或排障流程不会再次依赖。
- 再次确认 `i18n.mjs` 与 `validation` 的边界是否可进一步合并（当前保持分离）。

## 近期任务（优先级 P0）

1. 补齐发布工作流并让 `npm run verify:standalone` 可无条件通过（或更新脚本为新事实约束）。
2. 形成 `TASK.md` 的最终任务与 Owner/期限。
3. 运行一次完整验证（`npm run check`、`npm run qa:browser`、`npm run qa:pwa-update`）后产出审计记录。

## 中期任务（优先级 P1）

1. 清理临时文件（`tmp-desktop.png`, `tmp-mobile.png`, `vite-*.log`）前置确认。
2. 为 `tmp` 规则补充 `docs/cleanup-plan.md` 的“决策记录与删除条件”。
3. 引入仓库可视化目录清单（若有发布需求可选）。

## 长期任务（优先级 P2）

1. 分析可合并模块（`i18n.mjs` / `localization.js`, `validation-core.js` / `validator.mjs`）并决定是否收敛。
2. 考虑基线可复现性文档（`canary`）与实际验证日志归档策略。

## 里程碑关闭条件

- 结构重构：无旧路径残留、`import`/测试通过。
- 发布可复现：`verify:standalone`、`build`、`scan:dist` 与 QA 脚本可通过。
- 文档一致性：六份文档（`README` + 5 份规划类）状态字段一致。
