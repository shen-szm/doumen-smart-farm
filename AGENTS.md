# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## 斗门大屏

按照实际农业值守平台划分气象、地理态势、预警和田间影像。使用深海军蓝、钢蓝和青色，蓝黄橙红对应官方预警级别。地图、现场照片与数据都沿用能查证的来源，完整出处放在详情中。

以卫星图为主视图，达到近景比例时平滑过渡到可核验的现场影像，保留复位操作。首页聚焦值守指标、时间和状态，图表明细和处置使用站内弹窗，弹窗内容独立滚动，卡片内容不得互相遮挡。生产档案与作业台账按用户要求内联在首屏下方，不放进弹窗。

地图默认只显示必要点位。近景转场先推进卫星图，再切入并继续放大实景，进入后可独立缩放照片。详情弹窗始终居中，日报正文和宽表格在弹窗内完整滚动。

## 斗门大屏 · 约定（2026-11-25）

- **首屏必须完整可见。** `useScreenFit`（`src/App.jsx`）把标题、指标条、三栏看板放进页头与播报条之间：窗口模式缩放比不低于 0.8 时整体微缩，否则保留滚动；全屏或地址带 `?fit=1` 时始终整屏。底部滚动播报条常驻，任何面板都不得被它遮住。新增面板后在 1080p、1440×900、1366×768 三种尺寸下复验。
- **「近 N 日」必须带真实起止日期。** 数据源有发布滞后（NASA POWER 日值滞后 3–4 天、太阳辐射再晚数日；ERA5-Land 约 5 天），统计窗口一律按实际区间标注，不得只写「近 10 日」或「最新」。
- **作物口径只有一份。** 农事日历、生育期作物系数和逐月农事要点都在 `src/cropCalendar.js`，前后端共用；灌溉参考作物按季节取本月在田、可灌溉且需水最旺的一茬。番茄只是拟试点地块的可选场景，帕尔马番茄试验数据是「外部参考」，不进主导航。
- **模型派生数据如实记账。** 虫情灯诱、农事作业台账由真实气象日值推算，界面按投运口径呈现（不出现「模拟 / 待接入 / 示意」字样），方法说明放在详情页，并在交接文档里写明是模型输出。接入实测设备后替换。
- **发布与回滚。** 发布一律用 `bash deploy/publish.sh <标签>`，回滚用 `bash deploy/rollback.sh <标签>`；`live` 分支指向当前线上版本，发布成功后打 `vX.Y.Z-live` 标签。每个修复单独提交，便于按提交回滚。
- `src/styles.css` 是 CRLF 换行，其余源码是 LF；批量替换时不要改变换行符。
