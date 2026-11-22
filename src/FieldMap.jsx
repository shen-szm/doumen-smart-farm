import { useEffect, useRef, useState } from "react";
import { Camera, Crosshair, Minus, Plus } from "@phosphor-icons/react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { asset, getJson } from "./data.js";

const token = import.meta.env.VITE_TIANDITU_TK;
const imageWidth = 1550;
const imageHeight = 1110;
const archivedImage = asset("/media/doumen-survey-detail.jpg");
const satelliteImage = asset("/media/doumen-satellite.webp");
const aerialPhoto = asset("/media/dahaoyong-aerial.webp");
const xiaohaoDetail = asset("/media/xiaohai-satellite-detail.webp");
const AERIAL_ZOOM_START = 13.35;
const AERIAL_ZOOM_END = 14.5;

export const villages = [
  { id: "dahao", name: "大濠冲村", label: "稻田与排洪渠", map: [.2923, .5874], coordinates: [22.22410, 113.15785],
    summary: "调研记录包含大濠冲村连片稻田和大庙坑排洪渠。强降雨前可先核对排水通道与低洼段。",
    source: "斗门镇乡村调研，图 3" },
  { id: "xiaohao", name: "小濠冲村", label: "荔枝种植", map: [.3284, .5622], coordinates: [22.22667, 113.16875],
    summary: "调研记录包含小濠冲村的荔枝种植与销售。果园是后续开展土壤墒情和果树灌溉监测的候选场景。",
    source: "斗门镇乡村调研，产业发展章节" },
];

// 拟试点地块：依据《大濠冲村空间布局专题地图》中西部沿海高速旁的重点整治地块勾绘。
export const PILOT_FIELD = Object.freeze({
  name: "拟试点地块",
  note: "拟试点地块 · 西部沿海高速旁，依据空间布局专题图勾绘",
  bounds: [
    [22.2296, 113.1503], [22.2318, 113.1538], [22.2307, 113.1587], [22.2281, 113.1579], [22.2270, 113.1531],
  ],
});

const closeups = [
  { id: "dahao", url: aerialPhoto, position: villages[0].coordinates,
    label: "大濠冲村 · 无人机航拍 · 2026-07-13" },
  { id: "xiaohao", url: xiaohaoDetail, position: villages[1].coordinates,
    label: "小濠冲村 · 团队调研卫星截图" },
];

function ease(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function bindCloseupReveal(map, frames, motion, onLabel) {
  const layers = closeups.map((item) => {
    const frame = frames[item.id];
    return { ...item, frame, image: frame.firstElementChild };
  });
  let selected = null;
  let caption = null;
  let zoomTarget = null;
  let pendingFrame;
  const geographicOverlays = [
    map.getPane("markerPane"), map.getPane("tooltipPane"), map.getPane("pilot"),
    map.getContainer().querySelector(".leaflet-control-scale"),
  ];

  const update = () => {
    pendingFrame = undefined;
    const { zoom, center } = zoomTarget ?? { zoom: map.getZoom(), center: map.getCenter() };
    const progress = ease((zoom - AERIAL_ZOOM_START) / (AERIAL_ZOOM_END - AERIAL_ZOOM_START));
    const viewport = map.getSize();
    const mid = viewport.divideBy(2);
    const origin = map.project(center, zoom).subtract(mid);
    const visible = progress > 0 ? layers.flatMap((layer) => {
      const { image, position } = layer;
      if (!image.complete || !image.naturalWidth) return [];
      const point = map.project(position, zoom).subtract(origin);
      const edge = Math.min(point.x, viewport.x - point.x, point.y, viewport.y - point.y);
      if (edge < 4) return [];
      return [{ layer, point, edge, distance: point.distanceTo(mid) }];
    }) : [];
    const nearest = visible.reduce((best, entry) => !best || entry.distance < best.distance ? entry : best, null);
    const active = visible.find(({ layer }) => layer === selected);
    const target = active && active.distance <= (nearest?.distance ?? Infinity) + 24 ? active : nearest;
    selected = target?.layer ?? null;
    const coefficient = progress * ease((target?.edge ?? 0) / Math.max(32, Math.min(viewport.x, viewport.y) * .17));
    const reveal = motion.matches ? Number(coefficient >= .55) : coefficient;
    for (const layer of layers) {
      layer.frame.style.opacity = layer === selected ? reveal : 0;
      layer.frame.style.transition = motion.matches ? "none" : "opacity .28s ease, clip-path .26s ease-out";
      if (layer !== selected) continue;
      const { x, y } = target.point;
      const extent = Math.hypot(Math.max(x, viewport.x - x), Math.max(y, viewport.y - y)) + 1;
      const focusRadius = motion.matches ? extent : 30 + (extent - 30) * Math.sqrt(reveal);
      layer.frame.style.clipPath = `circle(${focusRadius}px at ${x}px ${y}px)`;
    }
    // 航拍画面未做正射校正，铺满后隐藏地图标线和尺度，防止把照片当作测绘底图。
    const coversMap = reveal >= .995;
    geographicOverlays.forEach((element) => {
      if (element) element.style.visibility = coversMap ? "hidden" : "";
    });
    const nextCaption = reveal > .22 ? selected.label : null;
    if (nextCaption !== caption) {
      caption = nextCaption;
      onLabel(caption);
    }
  };
  const sync = () => { pendingFrame ??= window.requestAnimationFrame(update); };
  const animate = ({ zoom, center }) => { zoomTarget = { zoom, center }; sync(); };
  const settle = () => { zoomTarget = null; sync(); };
  map.on("move zoom resize", sync);
  map.on("zoomanim", animate);
  map.on("zoomend moveend", settle);
  motion.addEventListener("change", sync);
  layers.forEach(({ image }) => image.addEventListener("load", sync));
  sync();

  return () => {
    if (pendingFrame !== undefined) window.cancelAnimationFrame(pendingFrame);
    map.off("move zoom resize", sync);
    map.off("zoomanim", animate);
    map.off("zoomend moveend", settle);
    motion.removeEventListener("change", sync);
    layers.forEach(({ frame, image }) => {
      image.removeEventListener("load", sync);
      frame.style.opacity = "0";
    });
    onLabel(null);
  };
}

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

export function FieldMap({ onVillage, onMapInfo, onPlot }) {
  const container = useRef(null);
  const map = useRef(null);
  const recenter = useRef(null);
  const pilot = useRef(null);
  const aerialFrames = useRef({});
  const callback = useRef(onVillage);
  callback.current = onVillage;
  const plotCallback = useRef(onPlot);
  plotCallback.current = onPlot;
  const [mode, setMode] = useState("satellite");
  const [satellite, setSatellite] = useState(null);
  const [mapFallback, setMapFallback] = useState(false);
  const [showPilot, setShowPilot] = useState(true);
  const [aerialLabel, setAerialLabel] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    // 底图清单加载失败先重试一次，仍失败才回退到档案底图。
    const load = (retry) => getJson("/media/doumen-satellite.json", controller.signal).then(setSatellite).catch(() => {
      if (controller.signal.aborted) return;
      if (retry) window.setTimeout(() => load(false), 3000);
      else { setMode("archive"); setMapFallback(true); }
    });
    load(true);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode === "satellite" && !satellite) return;
    const isOnline = mode === "online";
    const isArchive = mode === "archive";
    const canvas = container.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mapInstance = L.map(canvas, {
      crs: isArchive ? L.CRS.Simple : L.CRS.EPSG3857,
      zoomControl: false, attributionControl: isOnline, scrollWheelZoom: true,
      minZoom: isArchive ? -3 : 9, maxZoom: isArchive ? 1 : isOnline ? 18 : 15,
      zoomSnap: isOnline ? 1 : .25, zoomDelta: isOnline ? 1 : .5,
      zoomAnimation: !motion.matches, fadeAnimation: !motion.matches,
      markerZoomAnimation: !motion.matches,
    });
    map.current = mapInstance;
    let fallbackTimer;
    let stopCloseup;
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
        // 初始视野覆盖两村和拟试点地块，缩小可回看全区。
        mapInstance.setMinZoom(Math.min(12, mapInstance.getBoundsZoom(bounds)));
        const focus = L.latLngBounds([...villages.map(({ coordinates }) => coordinates), ...PILOT_FIELD.bounds]).pad(1.35);
        const zoom = Math.min(13.25, Math.max(12.6, mapInstance.getBoundsZoom(focus, false) - 0.5));
        mapInstance.setView(focus.getCenter(), zoom, { animate: false });
      };
      L.imageOverlay(satelliteImage, bounds, {
        alt: "Sentinel-2 斗门区卫星影像", className: "satellite-map-image",
      }).on("error", () => { setMode("archive"); setMapFallback(true); }).addTo(mapInstance);
      mapInstance.setMaxBounds(bounds.pad(0.08));
      mapInstance.createPane("pilot").style.zIndex = "410";
      pilot.current = L.polygon(PILOT_FIELD.bounds, {
        pane: "pilot", color: "#e8c95c", weight: 2, dashArray: "7 5", fillColor: "#e8c95c", fillOpacity: 0.13,
      }).bindTooltip(PILOT_FIELD.note, { sticky: true, className: "village-name pilot-tip" })
        .on("click", () => plotCallback.current?.());
      for (const village of villages) addMarker(mapInstance, village, village.coordinates, (v) => callback.current(v));
      L.control.scale({ imperial: false, maxWidth: 90, position: "bottomright" }).addTo(mapInstance);
      stopCloseup = bindCloseupReveal(mapInstance, aerialFrames.current, motion, setAerialLabel);
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
    // 容器初始尺寸为 0 时才需要二次定位；用户后续缩放不因窗口尺寸变化被重置。
    let pendingInitialFit = canvas.clientWidth === 0 || canvas.clientHeight === 0;
    const resize = new ResizeObserver(() => {
      const needFit = pendingInitialFit;
      pendingInitialFit = false;
      mapInstance.invalidateSize({ pan: false, animate: false });
      if (!isOnline && needFit) recenter.current();
    });
    resize.observe(canvas);
    return () => {
      window.clearTimeout(fallbackTimer);
      resize.disconnect();
      stopCloseup?.();
      pilot.current = null;
      mapInstance.remove();
      map.current = null;
    };
  }, [mode, satellite]);

  useEffect(() => {
    if (pilot.current && map.current && showPilot) pilot.current.addTo(map.current);
    else pilot.current?.remove();
  }, [mode, satellite, showPilot]);

  function showFieldCloseup() {
    const instance = map.current;
    if (!instance) return;
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const zoom = Math.max(AERIAL_ZOOM_END, instance.getZoom());
    instance.flyTo(closeups[0].position, zoom, { animate, duration: .9 });
  }

  return <div className="map-view">
    <div className="map-stage">
      <div className="map-canvas" ref={container} aria-label="斗门区调研地图" style={{ zIndex: 0 }} />
      {mode === "satellite" && <div className="aerial-reveal" aria-hidden="true">
        {closeups.map(({ id, url }) => <div key={id} ref={(node) => { aerialFrames.current[id] = node; }}
          style={{ position: "absolute", inset: 0, opacity: 0 }}>
          <img src={url} draggable="false" alt="" />
        </div>)}
      </div>}
      {!aerialLabel && <div className="map-key"><span className="map-key-dot" /> 村级调研点</div>}
      {!aerialLabel && mode === "satellite" && showPilot && <button type="button" className="map-key pilot-key pilot-key-button" onClick={() => plotCallback.current?.()}
        title="查看拟试点地块详情"><i className="pilot-swatch" /> 拟试点地块</button>}
      {aerialLabel && <div className="aerial-reveal-caption" role="status">{aerialLabel}</div>}
      <div className="map-controls" aria-label="地图操作">
        <button type="button" title="放大" aria-label="放大地图" onClick={() => map.current?.zoomIn()}><Plus size={19} /></button>
        <button type="button" title="缩小" aria-label="缩小地图" onClick={() => map.current?.zoomOut()}><Minus size={19} /></button>
        {mode === "satellite" && satellite && <button type="button" title="农田近景" aria-label="农田近景" onClick={showFieldCloseup}><Camera size={19} /></button>}
        <button type="button" title="复位" aria-label="恢复地图视图" onClick={() => recenter.current?.()}><Crosshair size={19} /></button>
      </div>
    </div>
    <div className="map-utility">
      <p className="map-hint">{aerialLabel ? "缩小或复位可返回卫星图" : mode === "satellite" ? "拖动平移 · 放大查看实拍影像" : "拖动平移 · 滚轮缩放"}</p>
      <div className="map-provenance">
        {mode === "satellite" && satellite && <span className="map-credit">{satellite.attribution}</span>}
        {mode === "satellite" && <button type="button" aria-pressed={showPilot} onClick={() => setShowPilot(!showPilot)}>
          {showPilot ? "隐藏试点地块" : "显示试点地块"}
        </button>}
        {token && <button type="button" onClick={() => { setMapFallback(false); setMode(mode === "online" ? "satellite" : "online"); }}>
          {mode === "online" ? "Sentinel-2" : "天地图"}
        </button>}
        <button type="button" onClick={onMapInfo}>{mode === "online" ? "天地图影像" : mode === "satellite" ? "影像来源" : mapFallback ? "卫星影像不可用 · 调研地图" : "调研地图"}</button>
      </div>
    </div>
  </div>;
}
