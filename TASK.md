# TASK.md

## 任务总览

- 更新状态：2026-08-14
- 说明：以下任务以当前仓库源码为主信息源，目标是让结构治理、架构决策与交付状态保持一致。

## 完成任务

### T-001 源码重构
- 目标：完成目录重构与路径同步
- 状态：已完成
- 验收：`src` 已分为 8 个功能目录，旧路径引用已迁移

### T-002 主入口与 Vite 资产对齐
- 目标：更新 `index.html` 与 `vite.config.mjs` 资源映射
- 状态：已完成
- 验收：`isolatedAssets` 与 `generateBundle` 使用新路径，运行时资产仍输出兼容文件名

### T-003 测试与引用更新
- 目标：修订所有测试中的路径引用
- 状态：已完成
- 验收：`tests/*` 使用 `src/*` 新路径（含 runtime、provider、i18n、ui、validation、state）

### T-004 .gitignore 与构建/临时文件治理
- 目标：避免提交 node_modules、dist、临时日志
- 状态：已完成
- 结果：新增 `.gitignore`

### T-005 文档化第一轮
- 目标：更新 README 与清理计划
- 状态：已完成
- 结果：`README.md` 重写，`docs/cleanup-plan.md` 建立

### T-006 文档套件新增
- 目标：补齐 DESIGN/SPEC/EPIC 文档
- 状态：已完成
- 结果：`DESIGN.md`, `SPEC.md`, `EPIC.md` 已创建

## 进行中任务

### T-007 发布链路对齐（阻塞）
- 目标：`verify:standalone` 所需的发布链路文件齐全
- 状态：进行中（阻塞）
- 依赖：`.github/workflows/pages.yml`（当前仓库缺失）
- 备注：`verify-standalone.mjs` 当前要求检查该文件和其核心字段

### T-008 文档闭环（ROADMAP/TASK）
- 目标：同步 `ROADMAP.md` 与 `TASK.md`
- 状态：进行中
- 依赖：部署链和清理决策确认

### T-009 发布前清理确认
- 目标：对 `docs/cleanup-plan.md` 中候选文件执行删前决策
- 状态：进行中
- 依赖：确认临时文件不再需要用于调试/截图/外部脚本

## 待办任务

### T-010 结构边界评审
- 目标：确认 `i18n.mjs` 与 `localization.js` 的职责分界
- 状态：待办
- 产物：边界决策说明（如合并或保留）

### T-011 验证链路证据归档
- 目标：固定 `npm test`、`npm run build`、`npm run scan:dist`、`npm run qa:*` 最近一次结果
- 状态：待办
- 产物：带时间戳的可追溯验证日志说明（非敏感）

### T-012 任务优先级与负责人落表
- 目标：新增责任人/优先级/预估工作量字段（如需要）
- 状态：待办

## Blockers（阻塞项）

1. `.github/workflows/pages.yml` 缺失导致 `verify:standalone` 脚本检查不满足。
2. 文件删除动作（`tmp-*`, `vite-*log`）需先确认无外部依赖。
3. 清理 `dist/` 与 `node_modules` 之外的历史遗留文件前需对比 release/QA 流程。

## 下一步（建议顺序）

1. 先补齐 `.github/workflows/pages.yml` 并完成一次 `npm run check` + `npm run qa:pwa-update`。
2. 形成发布验证快照（输出成功命令清单与时间）。
3. 依据清理门控删除已确认的临时文件。
4. 重新同步 `README` 与本文件中的状态字段。
