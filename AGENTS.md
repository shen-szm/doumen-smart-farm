# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## 斗门大屏

按照实际农业值守平台划分气象、地理态势、预警和田间影像。使用深海军蓝、钢蓝和青色，蓝黄橙红对应官方预警级别。地图、现场照片与数据都沿用能查证的来源，完整出处放在详情中。

以卫星图为主视图，达到近景比例时平滑过渡到可核验的现场影像，保留复位操作。首页聚焦值守指标、时间和状态，图表明细和处置使用站内弹窗，弹窗内容独立滚动，卡片内容不得互相遮挡。生产档案与作业台账按用户要求内联在首屏下方，不放进弹窗。

地图默认只显示必要点位。卫星底图约 20 米一像素，放大到约 13.5 级后，同一位置淡入真实高清影像（Esri World Imagery，可放大到 16 级），缩小后淡出；取不到影像时保持底图。大濠冲村的无人机航拍在约 15 级、且画面中心离村点 700 米以内时推进，用滚轮、「＋」还是双指放大都一样，不再一格滚轮就被切走；小濠冲村不用地图截图充当近景。进入航拍后可独立缩放照片，保留复位操作。详情弹窗始终居中，日报正文和宽表格在弹窗内完整滚动。

## 斗门大屏 · 约定（2026-11-25）

- **首屏必须完整可见。** `useScreenFit`（`src/App.jsx`）把标题、指标条、三栏看板放进页头与播报条之间：窗口模式缩放比不低于 0.8 时整体微缩，否则保留滚动；全屏或地址带 `?fit=1` 时始终整屏。底部滚动播报条常驻，任何面板都不得被它遮住。新增面板后在 1080p、1440×900、1366×768 三种尺寸下复验。
- **「近 N 日」必须带真实起止日期。** 数据源有发布滞后（NASA POWER 日值滞后 3–4 天、太阳辐射再晚数日；ERA5-Land 约 5 天），统计窗口一律按实际区间标注，不得只写「近 10 日」或「最新」。
- **页面上所有带日期的内容都要自动更新，不许靠人手刷新。**（用户 2026-11-25 的要求）数据一律走 `server/api.mjs` 的后台定时刷新：取数型接口按周期主动取数并把结果写到 `data-cache/`，刷新型数据（卫星苗情、卫星表层墒情、区域水环境）定时核对、只补新增部分。新增数据源时照这个接，不要新增静态数据文件。日期不写死在代码里，事实性记录除外（`src/records.js` 的历史事件、照片拍摄日期、公开报告的发布日期）。并不是每天都有新数据的来源（云量、发布周期、上游滞后），在弹层里显示「最近核对」时间，让使用者分得清「没更新」和「没数据」。
- **作物口径只有一份。** 农事日历、生育期作物系数和逐月农事要点都在 `src/cropCalendar.js`，前后端共用；灌溉参考作物按季节取本月在田、可灌溉且需水最旺的一茬。番茄只是拟试点地块的可选场景，帕尔马番茄试验数据是「外部参考」，不进主导航。
- **模型派生数据如实记账。** 虫情灯诱、农事作业台账由真实气象日值推算，界面按投运口径呈现（不出现「模拟 / 待接入 / 示意」字样），方法说明放在详情页，并在交接文档里写明是模型输出。接入实测设备后替换。
- **发布与回滚。** 发布一律用 `bash deploy/publish.sh <标签>`，回滚用 `bash deploy/rollback.sh <标签>`；`live` 分支指向当前线上版本，发布成功后打 `vX.Y.Z-live` 标签。每个修复单独提交，便于按提交回滚；同一文件里混着多处修改时按项拆成多个提交（按改动块暂存），并保证每个提交单独拿出来都能用——后面的提交用到的定义要在前面的提交里已有。2026-11-25 已实测 v1.2.0-live → v1.3.0-live → 回滚 → 再发布的完整链路；11-25 发布 v1.3.1-live、v1.4.0-live、v1.5.0-live，11-26 发布 v1.6.0-live、v1.6.1-live、v1.6.2-live，每次发布后都在线上把全部入口复验了一遍。
- **外部影像要写全署名。** 高清实拍影像来自 Esri World Imagery，由观众浏览器直接联网取瓦片，署名按提供方要求列全（`DETAIL_IMAGERY.credit`）。更换影像源时同步改署名和详情弹窗里的来源说明。
- **地图放大后要能进航拍，打开时中心不能偏。**（用户 2026-11-26 指出「放大地图后没有过渡成实拍图」，查清后定的）航拍推进按画面中心到大濠冲村点的地面距离判断（`AERIAL_RANGE`），不要改回按村点离画面中心的像素距离判断——用「＋」或在地图中间滚轮时村点会离开中心，航拍就进不去。页面加载时面板尺寸会变，用户没动过地图之前每变一次就重新定位一次，否则画面中心会偏走约 1 公里。地图下方的提示行行数固定，提示文字或署名变长不能让地图画面变矮。巡检脚本会先点「复位」，查不出打开时的视野问题；验证地图要另跑一遍不点复位、按用户屏幕尺寸做的操作（`map-diag2.mjs`）。用户说某个功能「没了」时，先按用户的屏幕尺寸和操作方式复现，再下结论。
- **管理通道与端口。** 路径是本机 → 公网 2222 → 服务器电脑的 WSL（`ssh wsl`）→ Windows（`doumen_deploy`）。2222、2221 两个端口由用户维护，**不要改动它们的绑定或配置**。私钥不落服务器，靠 Windows 的 ssh-agent 转发；每一层主机密钥都严格校验。
- **界面要像真实在用的运营平台，不要有「生成感」。**（用户 2026-11-25 的要求；11-26 又指出顶栏的标识和导航图标「AI 痕迹太重」）首屏是读数不是展示：指标 + 数值 + 时间，用绝对时间；不放装饰图标、迷你走势线、数字滚动动效（天气现象、地图控件、等级标签这类传达信息的保留）。品牌标识是自绘的「田」字方格（`BrandMark`），直接放在名称左边，不装圆角底框；顶栏导航只用文字；网站图标 `public/favicon.svg` / `.ico` 与它保持一致。不要换回图标库里的通用图标。
- **数据不正常时的说法要如实。**（2026-11-26 产品审查后的约定）数据还没到写「获取中」，取不到写「…暂不可用」，不能让人一直等；没有数据时不下结论——不显示警示色、不播报结论。带时间段的建议（喷药时段等）只取还没结束的；改用备用数据时标注「上次预报」。判断工具是 `hasData`、`pendingText`、`upcomingSpray`（`src/App.jsx`），新增数据面板时照这个接，并用浏览器拦住接口验证一遍。
- **页面入口自带启动画面。** `index.html` 里的静态「正在加载」提示和加载失败时的「重新加载」不依赖框架，应用挂载后自动被替换，不要删。
- **现场录像循环、静音。** 右栏「现场监控」播放 `public/media/monitor/clips.json` 里最新一段录像：`loop`、`muted`，文件本身不带音轨，不设声音开关，自动播放被拦时给「点击播放」。原始录像放项目根目录的 `现场监控/`（已忽略，不进版本库），文件名带日期；执行 `node scripts/prepare-monitor.mjs` 生成网页版本并更新清单。画面上标「回放」和日期，不写成直播。
- **页面下方的「农情分析」只用现有接口的真实数据出图。** 新增图表接在 `AnalysisSection`（`src/App.jsx`），图表组件放 `src/charts.jsx`，在滚到附近时才初始化。没有数据源的图不要加。文案写成值班口径的短句（如「喷药：最近适宜时段 今 13:00–15:00」），公式编号、标准号、数据集名称和「由…派生，辅助…」一类的介绍语不进首屏和播报条；来源、口径、计算方法放进弹层里折叠的「数据说明与来源」（`Metadata` 按说明类标签自动收纳）。标题、表头、图例里的英文缩写（ET0、ETc、Kc、NDVI）写中文。不写「演示」一类措辞。
- `src/styles.css` 是 CRLF 换行，其余源码是 LF；批量替换时不要改变换行符。
