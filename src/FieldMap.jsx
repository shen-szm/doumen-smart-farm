import { useEffect, useRef, useState } from "react";
import { Crosshair, Minus, Plus } from "@phosphor-icons/react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { asset, getJson } from "./data.js";

const token = import.meta.env.VITE_TIANDITU_TK;
const imageWidth = 1550;
const imageHeight = 1110;
const archivedImage = asset("/media/doumen-survey-detail.jpg");
const satelliteImage = asset("/media/doumen-satellite.webp");

export const villages = [
  { id: "dahao", name: "大濠冲村", label: "稻田与排洪渠", map: [.2923, .5874], coordinates: [22.22410, 113.15785],
    summary: "调研记录包含大濠冲村连片稻田和大庙坑排洪渠。强降雨前可先核对排水通道与低洼段。",
    source: "斗门镇乡村调研，图 3" },
  { id: "xiaohao", name: "小濠冲村", label: "荔枝种植", map: [.3284, .5622], coordinates: [22.22667, 113.16875],
    summary: "调研记录包含小濠冲村的荔枝种植与销售。果园是后续开展土壤墒情和果树灌溉监测的候选场景。",
    source: "斗门镇乡村调研，产业发展章节" },
];

// 拟试点地块：依据《大濠冲村空间布局专题地图》中西部沿海高速旁的重点整治地块示意勾绘，边界待基地确认。
const PILOT_FIELD = Object.freeze({
  name: "拟试点地块",
  note: "拟试点地块（示意范围）· 依据空间布局专题图勾绘，边界待基地设备接入后确认",
  bounds: [
    [22.2296, 113.1503], [22.2318, 113.1538], [22.2307, 113.1587], [22.2281, 113.1579], [22.2270, 113.1531],
  ],
});

function addMarker(map, village, point, select) {
  const marker = L.marker(point, {
    title: village.name,
    alt: village.name,
    icon: L.divIcon({ className: "village-pin", iconSize: [22, 22], iconAnchor: [11, 11] }),
  }).addTo(map);
  marker.bindTooltip(village.name, {
    permanent: true, interactive: false,
    direction: village.id === "dahao" ? "left" : "right",
    offset: [village.id === "dahao" ? -14 : 14, 0], className: "village-name",
  });
  marker.getElement()?.setAttribute("aria-label", village.name);
  marker.on("click", () => select(village));
}

export function FieldMap({ onVillage, onMapInfo }) {
  const container = useRef(null);
  const map = useRef(null);
  const recenter = useRef(null);
  const callback = useRef(onVillage);
  callback.current = onVillage;
  const [mode, setMode] = useState("satellite");
  const [satellite, setSatellite] = useState(null);
  const [mapFallback, setMapFallback] = useState(false);
  const [showPilot, setShowPilot] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getJson("/media/doumen-satellite.json", controller.signal).then(setSatellite).catch(() => {
      if (!controller.signal.aborted) { setMode("archive"); setMapFallback(true); }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode === "satellite" && !satellite) return;
    const isOnline = mode === "online";
    const isArchive = mode === "archive";
    const canvas = container.current;
    const mapInstance = L.map(canvas, {
      crs: isArchive ? L.CRS.Simple : L.CRS.EPSG3857,
      zoomControl: false, attributionControl: isOnline, scrollWheelZoom: false,
      minZoom: isArchive ? -3 : 9, maxZoom: isArchive ? 1 : isOnline ? 18 : 15,
      zoomSnap: isOnline ? 1 : .25, zoomDelta: isOnline ? 1 : .5,
    });
    map.current = mapInstance;
    let fallbackTimer;
    if (isOnline) {
      recenter.current = () => mapInstance.setView([22.237, 113.202], 13);
      const tiles = (layer, attribution) => L.tileLayer(
        `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(token)}`,
        { subdomains: "01234567", attribution, maxZoom: 18 },
      ).addTo(mapInstance);
      const aerial = tiles("img", "天地图影像");
      tiles("cia", "天地图注记");
      fallbackTimer = window.setTimeout(() => { setMode("satellite"); setMapFallback(true); }, 9000);
      aerial.once("tileload", () => window.clearTimeout(fallbackTimer));
      for (const village of villages) {
        if (village.coordinates) addMarker(mapInstance, village, village.coordinates, (v) => callback.current(v));
      }
    } else if (!isArchive) {
      const bounds = L.latLngBounds(satellite.bounds);
      recenter.current = () => {
        // 初始视图以两个调研村为中心放大，可缩小回全区影像。
        mapInstance.setMinZoom(Math.min(12, mapInstance.getBoundsZoom(bounds)));
        const focus = L.latLngBounds(villages.map(({ coordinates }) => coordinates)).pad(1.35);
        const zoom = Math.min(13.25, Math.max(12.6, mapInstance.getBoundsZoom(focus, false) - 0.5));
        mapInstance.setView(focus.getCenter(), zoom, { animate: false });
      };
      L.imageOverlay(satelliteImage, bounds, {
        alt: "Sentinel-2 斗门区卫星影像", className: "satellite-map-image",
      }).on("error", () => { setMode("archive"); setMapFallback(true); }).addTo(mapInstance);
      mapInstance.setMaxBounds(bounds.pad(0.08));
      if (showPilot) {
        L.polygon(PILOT_FIELD.bounds, {
          color: "#e8c95c", weight: 2, dashArray: "7 5", fillColor: "#e8c95c", fillOpacity: 0.13,
        }).bindTooltip(PILOT_FIELD.note, { sticky: true, className: "village-name pilot-tip" }).addTo(mapInstance);
      }
      for (const village of villages) addMarker(mapInstance, village, village.coordinates, (v) => callback.current(v));
      L.control.scale({ imperial: false, maxWidth: 90, position: "bottomright" }).addTo(mapInstance);
    } else {
      const bounds = [[0, 0], [imageHeight, imageWidth]];
      recenter.current = () => {
        const fill = Math.max(container.current.clientWidth / imageWidth, container.current.clientHeight / imageHeight);
        const zoom = Math.ceil(Math.log2(fill * 1.06) * 4) / 4;
        mapInstance.setView([imageHeight * .50, imageWidth * .50], zoom, { animate: false });
      };
      L.imageOverlay(archivedImage, bounds, { alt: "2018 年斗门区地图", className: "archived-map-image" }).addTo(mapInstance);
      mapInstance.setMaxBounds(L.latLngBounds(bounds).pad(.18));
      for (const village of villages) {
        const [x, y] = village.map;
        addMarker(mapInstance, village, [(1 - y) * imageHeight, x * imageWidth], (v) => callback.current(v));
      }
    }
    recenter.current();
    // 滚轮缩放采用「点击地图激活、移出后让回页面滚动」的手动模式。
    const enableWheel = () => { mapInstance.scrollWheelZoom.enable(); canvas.classList.add("wheel-zoom"); };
    const disableWheel = () => mapInstance.scrollWheelZoom.disable();
    mapInstance.on("click", enableWheel);
    canvas.addEventListener("mouseleave", disableWheel);
    const resize = new ResizeObserver(() => {
      mapInstance.invalidateSize({ pan: false, animate: false });
      if (!isOnline) recenter.current();
    });
    resize.observe(canvas);
    return () => {
      window.clearTimeout(fallbackTimer);
      canvas.removeEventListener("mouseleave", disableWheel);
      resize.disconnect();
      mapInstance.remove();
      map.current = null;
    };
  }, [mode, satellite, showPilot]);

  return <div className="map-stage">
    <div className="map-canvas" ref={container} aria-label="斗门区调研地图" />
    <div className="map-hint" role="status">拖动平移 · 点击地图后滚轮缩放</div>
    <div className="map-key"><span className="map-key-dot" /> 村级调研点</div>
    {mode === "satellite" && showPilot && <div className="map-key pilot-key"><i className="pilot-swatch" /> 拟试点地块（示意）</div>}
    <div className="map-controls" aria-label="地图操作">
      <button type="button" title="放大" aria-label="放大地图" onClick={() => map.current?.zoomIn()}><Plus size={19} /></button>
      <button type="button" title="缩小" aria-label="缩小地图" onClick={() => map.current?.zoomOut()}><Minus size={19} /></button>
      <button type="button" title="复位" aria-label="恢复地图视图" onClick={() => recenter.current?.()}><Crosshair size={19} /></button>
    </div>
    <div className="map-provenance">
      {mode === "satellite" && satellite && <a className="map-credit" href={satellite.sourceUrl} target="_blank" rel="noreferrer">{satellite.attribution}</a>}
      {mode === "satellite" && <button type="button" aria-pressed={showPilot} onClick={() => setShowPilot(!showPilot)}>
        {showPilot ? "隐藏试点地块" : "显示试点地块"}
      </button>}
      {token && <button type="button" onClick={() => { setMapFallback(false); setMode(mode === "online" ? "satellite" : "online"); }}>
        {mode === "online" ? "Sentinel-2" : "天地图"}
      </button>}
      <button type="button" onClick={onMapInfo}>{mode === "online" ? "天地图影像" : mode === "satellite" ? "影像来源" : mapFallback ? "卫星影像不可用 · 调研地图" : "调研地图"}</button>
    </div>
  </div>;
}
