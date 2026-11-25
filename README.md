# 斗门智慧农田

珠海斗门农情监测大屏，包含卫星底图、实时气象和预警查询、卫星表层墒情、田间影像、农业生产档案及灌溉实测回放。

## 本地启动

使用 Node.js 22 或更高版本。

```sh
npm ci
npm run dev -- --port 4173
```

在浏览器打开 http://127.0.0.1:4173。正式答辩可先执行 `npm run build`，再执行 `npm run preview -- --host 127.0.0.1 --port 4173`。本地服务同时提供网页和数据接口。

## 数据与配置

所有数据都由服务器后台定时刷新（没人打开页面也照常进行），结果写入服务器项目目录下的 `data-cache/`；页面只读取结果。`vite preview` 与 `npm run dev` 启动时开始刷新，`npm run build` 不取数。

- `GET /api/observations` 读取 [中国天气网斗门站实况](https://www.weather.com.cn/weather1d/101280702.shtml)，展示气温、相对湿度、风速、气压和过去 24 小时雨量。
- `GET /api/weather` 读取斗门参考坐标 `22.21, 113.30` 的 [Open-Meteo 逐小时预报](https://open-meteo.com/en/docs)。每 15 分钟刷新，失联时保留最后一份成功返回的预报。`node scripts/refresh-data.mjs --weather` 重建随构建发布的兜底快照。
- `GET /api/alerts` 每 5 分钟查询 [中国天气网官方生效预警](https://www.weather.com.cn/alarm/)，筛选珠海市及斗门区。记录保留发布机构、区域、原等级和时间。已配置 `QWEATHER_HOST` 和 `QWEATHER_KEY` 时可使用和风天气作为优先来源。生效过的预警自动记入 `GET /api/alert-history`（保留 90 天）。
- `GET /api/soil-profile` 读取 [Open-Meteo ERA5-Land 再分析](https://open-meteo.com/en/docs/historical-weather-api) 的近 60 天三层土壤体积含水量（表层 0–7 cm / 根区 7–28 cm / 深层 28–100 cm），按 GB/T 20481-2017《气象干旱等级》以相对湿度六级分档（田间持水量 0.30 m³/m³，FAO-56 表 19）。服务端缓存 6 小时，`node scripts/refresh-data.mjs --soil` 刷新快照。
- `GET /api/agro` 读取 [NASA POWER 农业气象日值](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)（近 90 日 + 去年同期），服务端按 [FAO-56 Penman-Monteith](https://www.fao.org/4/x0490e/x0490e00.htm) 计算参考蒸散 ET0 与番茄作物需水 ETc，输出近 10 日灌溉参考量、近 30 日同期同比与国标农气事件扫描（暴雨 GB/T 28592、高温热害 QX/T 208、寒露风 GB/T 34816）。`node scripts/refresh-data.mjs --agro` 刷新快照。
- `GET /api/ndvi`：苗情 NDVI 时序来自 [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/) 的 Sentinel-2 L2A（免注册）。服务器每 6 小时检索影像目录，出现云量低于 30% 的新影像才下载计算，展示近 240 天的过境。
- 默认底图使用 2025 年 Sentinel-2 自然色影像。 [EOxCloudless 许可与署名](https://cloudless.eox.at/license-non-commercial) 。`VITE_TIANDITU_TK` 可增加天地图图层。
- `GET /api/satellite-soil`：卫星表层墒情来自 [NOAA CPC SMOPS 日值](https://ftp.cpc.ncep.noaa.gov/precip/PORT/SEMDP/SOIL-MOISTURE/SMOPS/DATA/)，覆盖两个村的 0.25° 网格。服务器每 6 小时核对，滚动保留最近 14 天；源文件是 NetCDF-4，用 h5wasm 解析。
- 首屏右栏的「现场监控」循环、静音播放现场录像（`public/media/monitor/`，清单 `clips.json`）；原始录像放项目根目录的 `现场监控/`，执行 `node scripts/prepare-monitor.mjs` 转成网页版本。
- 首屏下方的「农情分析」用接口数据出 12 张图表（温湿度、降水、风速气压、墒情、蒸散、辐射、月度统计、水分平衡、卫星墒情与苗情、虫情、农事作业构成），滚到附近才初始化。
- `GET /api/water-quality`：区域水环境来自 [珠海市生态环境局斗门分局公开报告](https://www.doumen.gov.cn/zdlyxxgk/hjbhxxgk/szhj/index.html)。服务器每天核对栏目列表，新报告自动抓取并解析表格。
- 随构建发布的快照 `public/data/*-snapshot.json` 只在服务器从未成功取数时兜底，静态部署直接读取；`node scripts/refresh-cached.mjs [ndvi] [satellite-soil] [water-quality]` 重建后三份。
- `VITE_CAMERA_HLS_URL` 支持授权的 HLS 地址，例如 MediaMTX 输出。视频流由基地提供，摄像头详情支持播放失败后重试。
- 灌溉回放来自 [Stuard 番茄田公开试验，第二版](https://data.mendeley.com/datasets/35wh56287y/2)，使用 CC BY 4.0。回放保留 20 cm 土壤湿度、水表读数和意大利当地日期。水表的论文单位与设备手册有差异，界面展示原始数值，详情提供来源。
- 调研档案包含「农田照片」中选取的航拍、地面走访照片、大濠冲村空间布局专题图高清翻拍（珠海市测绘院/广东省地图院，2024 年 3 月）与小濠冲村土名地界划分初图。航拍原片拍摄于 2026 年 7 月 13 日。
- 界面附带自动轮播演示模式（顶部「演示模式」按钮）、农情日报（自动汇总，支持打印导出）与二十四节气农时提示（太阳视黄经推算）。

平台仅提供查看、分析和处置建议。实际田间滴灌、传感器和视频需经基地授权后接入。
