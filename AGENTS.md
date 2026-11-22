# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## 斗门大屏

按照实际农业值守平台划分气象、地理态势、预警和田间影像。使用深海军蓝、钢蓝和青色，蓝黄橙红对应官方预警级别。地图、现场照片与数据都沿用能查证的来源，完整出处放在详情中。

以卫星图为主视图，达到近景比例时平滑过渡到可核验的现场影像，保留复位操作。首页聚焦值守指标、时间和状态，图表明细、处置和档案统一使用站内弹窗，弹窗内容独立滚动，卡片内容不得互相遮挡。
