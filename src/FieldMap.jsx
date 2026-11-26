import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Crosshair, Minus, Plus } from "@phosphor-icons/react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { asset, getJson } from "./data.js";

const token = import.meta.env.VITE_TIANDITU_TK;
const imageWidth = 1550;
const imageHeight = 1110;
const archivedImage = asset("/media/doumen-survey-detail.jpg");
const satelliteImage = asset("/media/doumen-satellite.webp");
const aerialPhoto = asset("/media/dahaoyong-aerial.webp");
// 卫星底图约 20 米一像素，放大后会发虚；达到该级别后在同一位置叠入真实高清影像。
const DETAIL_ZOOM = 13.5;
const DETAIL_MAX_ZOOM = 16;
// 放大到该级别、且画面中心离村点不超过这个距离（米）时，推进到无人机航拍。
// 用「＋」或在地图中间滚轮时村点会随放大离开画面中心，所以不按村点离画面中心的远近判断。
const AERIAL_ZOOM = 15.25;
const AERIAL_RANGE = 700;
// 推进的支点离画面边缘至少留这么多像素。
const EDGE = 24;
const PHOTO_START = { scale: 1.18, x: 0, y: 0 };

// 高清实拍影像：Esri 公共影像服务（Web Mercator，与卫星底图位置对齐）。需联网，取不到时保持卫星底图。
export const DETAIL_IMAGERY = Object.freeze({
  name: "Esri World Imagery",
  url: "https://www.esri.com/en-us/arcgis/products/arcgis-online/services/basemaps",
  credit: "Esri, Maxar, Earthstar Geographics, GIS User Community",
  tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
});

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

// 无人机航拍没有做地理配准，不能叠在地图上，只作为整幅近景按需推进。
const closeups = [
  { id: "dahao", photoId: "aerial", url: aerialPhoto, position: villages[0].coordinates,
    label: "大濠冲村航拍 · 2026-07-13", alt: "大濠冲村农田、沟渠与村落的无人机航拍" },
];

function bindCloseup(map, frames, motion, setScene) {
  const canvas = map.getContainer();
  const layers = closeups.map((item) => {
    const frame = frames[item.id];
    return { ...item, frame, image: frame.firstElementChild };
  });
  let active = null;
  let phase = null;
  let mapView = null;
  let requested = null;
  let flying = false;
  let animations = [];

  function stopAnimations() {
    animations.forEach((animation) => animation.cancel());
    animations = [];
  }

  function enter(layer, point) {
    active = layer;
    requested = null;
    const animate = !motion.matches && typeof canvas.animate === "function";
    phase = animate ? "entering" : "photo";
    setScene({ shot: layer, phase });
    layer.frame.style.opacity = "1";
    if (!animate) return;

    const duration = 1050;
    const origin = `${point.x}px ${point.y}px`;
    // Leaflet 只负责定位。整幅底图与独立的实景图在同一视窗里接力推进。
    animations = [
      canvas.animate([
        { transform: "scale(1)", transformOrigin: origin },
        { transform: "scale(1.27)", transformOrigin: origin, offset: .54 },
        { transform: "scale(1.44)", transformOrigin: origin },
      ], { duration, easing: "cubic-bezier(.33,.02,.32,1)" }),
      layer.frame.animate([{ opacity: 0 }, { opacity: 0, offset: .28 }, { opacity: 1, offset: .82 }, { opacity: 1 }],
        { duration, easing: "ease-in-out" }),
      layer.image.animate([{ transform: "scale(1.01)" }, { transform: "scale(1.02)", offset: .36 },
        { transform: `scale(${PHOTO_START.scale})` }], { duration, easing: "cubic-bezier(.18,.35,.34,1)" }),
    ];
    animations[0].onfinish = () => {
      if (phase !== "entering") return;
      phase = "photo";
      setScene({ shot: layer, phase });
    };
  }

  function checkView() {
    flying = false;
    if (active) return;
    const zoom = map.getZoom();
    if (zoom < AERIAL_ZOOM) {
      requested = null;
      mapView = { center: map.getCenter(), zoom };
      return;
    }
    const size = map.getSize();
    const center = map.getCenter();
    const candidates = requested ? [requested] : layers;
    const nearest = candidates.flatMap((layer) => {
      if (!layer.image.complete || !layer.image.naturalWidth) return [];
      const distance = map.distance(center, layer.position);
      if (distance > AERIAL_RANGE) return [];
      // 支点取村点当前的位置，已经出画时贴到画面边上。
      const point = map.latLngToContainerPoint(layer.position);
      const anchor = L.point(
        Math.min(Math.max(point.x, EDGE), size.x - EDGE),
        Math.min(Math.max(point.y, EDGE), size.y - EDGE));
      return [{ layer, point: anchor, distance }];
    }).sort((left, right) => left.distance - right.distance)[0];
    if (nearest) enter(nearest.layer, nearest.point);
  }

  function leave() {
    if (!active || phase === "returning") return;
    const shot = active;
    const opacity = getComputedStyle(shot.frame).opacity;
    stopAnimations();
    function finish() {
      shot.frame.style.opacity = "0";
      active = null;
      phase = null;
      setScene(null);
    }
    phase = "returning";
    setScene({ shot, phase });
    const view = mapView ?? { center: shot.position, zoom: AERIAL_ZOOM - 1 };
    map.setView(view.center, view.zoom, { animate: false });
    if (motion.matches || typeof canvas.animate !== "function") {
      finish();
      return;
    }
    const options = { duration: 480, easing: "cubic-bezier(.22,.62,.34,1)" };
    animations = [
      canvas.animate([{ transform: "scale(1.14)" }, { transform: "scale(1)" }], options),
      shot.frame.animate([{ opacity }, { opacity: "0" }], options),
    ];
    animations[1].onfinish = finish;
  }

  const checkLoadedImage = () => { if (!flying) checkView(); };
  const reduceMotion = ({ matches }) => {
    if (matches) animations.filter((animation) => animation.playState === "running").forEach((animation) => animation.finish());
  };
  map.on("moveend", checkView);
  motion.addEventListener("change", reduceMotion);
  layers.forEach(({ image }) => image.addEventListener("load", checkLoadedImage));
  return {
    enter: () => {
      if (active) return;
      requested = layers[0];
      flying = true;
      map.flyTo(requested.position, Math.max(AERIAL_ZOOM, map.getZoom()),
        { animate: !motion.matches, duration: .62 });
    },
    leave,
    stop: () => {
      stopAnimations();
      map.off("moveend", checkView);
      motion.removeEventListener("change", reduceMotion);
      layers.forEach(({ frame, image }) => {
        image.removeEventListener("load", checkLoadedImage);
        frame.style.opacity = "0";
      });
      setScene(null);
    },
  };
}

function addMarker(map, village, point, select) {
  const marker = L.marker(point, {
    alt: village.name,
    icon: L.divIcon({ className: "village-pin", iconSize: [17, 17], iconAnchor: [8, 8] }),
  }).addTo(map);
  marker.bindTooltip(village.name, {
    interactive: false,
    direction: village.id === "dahao" ? "left" : "right",
    offset: [village.id === "dahao" ? -14 : 14, 0], className: "village-name",
  });
  marker.getElement()?.setAttribute("aria-label", village.name);
  marker.on("click", () => select(village));
}

export function FieldMap({ onVillage, onMapInfo, onPlot, onPhoto }) {
  const container = useRef(null);
  const map = useRef(null);
  const recenter = useRef(null);
  const pilot = useRef(null);
  const aerialFrames = useRef({});
  const photoLayer = useRef(null);
  const closeup = useRef(null);
  const drag = useRef(null);
  const callback = useRef(onVillage);
  callback.current = onVillage;
  const plotCallback = useRef(onPlot);
  plotCallback.current = onPlot;
  const [mode, setMode] = useState("satellite");
  const [satellite, setSatellite] = useState(null);
  const [mapFallback, setMapFallback] = useState(false);
  const [showPilot, setShowPilot] = useState(false);
  const [scene, setScene] = useState(null);
  const [detailActive, setDetailActive] = useState(false);
  const [photoView, setPhotoView] = useState(PHOTO_START);

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
    setDetailActive(false);
    const mapInstance = L.map(canvas, {
      crs: isArchive ? L.CRS.Simple : L.CRS.EPSG3857,
      zoomControl: false, attributionControl: isOnline, scrollWheelZoom: true,
      minZoom: isArchive ? -3 : 9, maxZoom: isArchive ? 1 : isOnline ? 18 : DETAIL_MAX_ZOOM,
      zoomSnap: isOnline ? 1 : .25, zoomDelta: isOnline ? 1 : .5,
      // 滚轮一格约放大一级（Leaflet 默认约 1.25 级，放大卫星图时步子太大）。
      wheelPxPerZoomLevel: 66,
      zoomAnimation: !motion.matches, fadeAnimation: !motion.matches,
      markerZoomAnimation: !motion.matches,
    });
    map.current = mapInstance;
    let fallbackTimer;
    let detailRetry;
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

      // 高清实拍影像：图层常驻但透明，放大到 DETAIL_ZOOM 后在同一位置淡入，位置与卫星底图严格对齐。
      // 一个瓦片都取不到（当前网络访问不到影像源）就撤掉图层，保持卫星底图，3 分钟后再试。
      const detailPane = mapInstance.createPane("detail");
      detailPane.style.zIndex = "405";
      detailPane.style.opacity = "0";
      detailPane.style.pointerEvents = "none";
      let detailLayer = null;
      let detailVisible = false;
      let detailDown = false;
      const startDetail = () => {
        detailLayer = L.tileLayer(DETAIL_IMAGERY.tileUrl, {
          pane: "detail", maxNativeZoom: DETAIL_MAX_ZOOM, maxZoom: DETAIL_MAX_ZOOM, keepBuffer: 1,
        }).addTo(mapInstance);
        let loads = 0;
        let errors = 0;
        detailLayer.on("tileload", () => { loads += 1; });
        detailLayer.on("tileerror", () => {
          errors += 1;
          if (loads > 0 || errors < 4) return;
          detailDown = true;
          mapInstance.removeLayer(detailLayer);
          detailLayer = null;
          if (detailVisible) showDetail(false);
          detailRetry = window.setTimeout(() => { detailDown = false; }, 180_000);
        });
      };
      function showDetail(visible) {
        if (visible === detailVisible) return;
        detailVisible = visible;
        detailPane.style.transition = motion.matches ? "none" : "opacity .7s ease";
        detailPane.style.opacity = visible ? "1" : "0";
        setDetailActive(visible);
      }
      const syncDetail = () => {
        if (mapInstance.getZoom() < DETAIL_ZOOM || detailDown) showDetail(false);
        else {
          if (!detailLayer) startDetail();
          showDetail(true);
        }
      };
      mapInstance.on("zoomend", syncDetail);
      syncDetail();

      mapInstance.createPane("pilot").style.zIndex = "410";
      pilot.current = L.polygon(PILOT_FIELD.bounds, {
        pane: "pilot", color: "#e8c95c", weight: 2, dashArray: "7 5", fillColor: "#e8c95c", fillOpacity: 0.13,
      }).bindTooltip(PILOT_FIELD.note, { sticky: true, className: "village-name pilot-tip" })
        .on("click", () => plotCallback.current?.());
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
    if (!isArchive) {
      closeup.current = bindCloseup(mapInstance, aerialFrames.current, motion, (next) => {
        setScene(next);
        if (!next) setPhotoView(PHOTO_START);
      });
    }
    recenter.current();
    // 页面刚打开时各面板边加载边变尺寸。地图跟着变尺寸时画面是贴着左上角摆的，画面中心会一点一点偏走，
    // 所以用户还没动过地图之前，每变一次尺寸就重新定位一次；动过之后窗口尺寸变化不再重置视野。
    const inputTypes = ["wheel", "pointerdown", "touchstart", "dblclick"];
    let touched = false;
    const mark = () => { touched = true; };
    for (const type of inputTypes) canvas.parentElement.addEventListener(type, mark, { passive: true, capture: true });
    const resize = new ResizeObserver(() => {
      mapInstance.invalidateSize({ pan: false, animate: false });
      if (!isOnline && !touched) recenter.current();
    });
    resize.observe(canvas);
    return () => {
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(detailRetry);
      resize.disconnect();
      for (const type of inputTypes) canvas.parentElement.removeEventListener(type, mark, { capture: true });
      closeup.current?.stop();
      closeup.current = null;
      pilot.current = null;
      mapInstance.remove();
      map.current = null;
    };
  }, [mode, satellite]);

  useEffect(() => {
    if (pilot.current && map.current && showPilot) pilot.current.addTo(map.current);
    else pilot.current?.remove();
  }, [mode, satellite, showPilot]);

  function updatePhotoView(update) {
    const bounds = photoLayer.current?.getBoundingClientRect();
    if (!bounds) return;
    setPhotoView((view) => {
      const next = update(view, bounds);
      const limitX = bounds.width * (next.scale - 1) / 2;
      const limitY = bounds.height * (next.scale - 1) / 2;
      return {
        scale: next.scale,
        x: Math.min(limitX, Math.max(-limitX, next.x)),
        y: Math.min(limitY, Math.max(-limitY, next.y)),
      };
    });
  }

  function zoomPhoto(multiplier, cursor) {
    updatePhotoView((view, bounds) => {
      const scale = Math.min(3.35, Math.max(1, view.scale * multiplier));
      const ratio = scale / view.scale;
      const x = cursor ? cursor.clientX - bounds.left - bounds.width / 2 : 0;
      const y = cursor ? cursor.clientY - bounds.top - bounds.height / 2 : 0;
      return { scale, x: view.x * ratio + x * (1 - ratio), y: view.y * ratio + y * (1 - ratio) };
    });
  }

  useEffect(() => {
    const layer = photoLayer.current;
    if (!scene || !layer) return;
    const wheel = (event) => {
      event.preventDefault();
      if (scene.phase !== "photo" || event.deltaY === 0) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      zoomPhoto(Math.exp(-Math.min(120, Math.max(-120, delta)) * .0025), event);
    };
    layer.addEventListener("wheel", wheel, { passive: false });
    const resize = new ResizeObserver(() => updatePhotoView((view) => view));
    resize.observe(layer);
    return () => {
      drag.current = null;
      resize.disconnect();
      layer.removeEventListener("wheel", wheel);
    };
  }, [scene]);

  function beginDrag(event) {
    if (scene?.phase !== "photo" || event.button !== 0 || photoView.scale <= 1) return;
    const { pointerId, clientX, clientY } = event;
    drag.current = { pointerId, clientX, clientY, x: photoView.x, y: photoView.y };
    event.currentTarget.setPointerCapture(pointerId);
  }

  function moveDrag(event) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const { clientX, clientY } = event;
    updatePhotoView((view) => ({ ...view, x: start.x + clientX - start.clientX, y: start.y + clientY - start.clientY }));
  }

  const ready = scene?.phase === "photo";

  return <div className="map-view">
    <div className="map-stage" data-photo-active={Boolean(scene)} data-photo-phase={scene?.phase}>
      <div className="map-canvas" ref={container} aria-label="斗门区调研地图" inert={Boolean(scene)} style={{ zIndex: 0 }} />
      {mode !== "archive" && <div className="aerial-reveal" ref={photoLayer} aria-hidden={!scene}
        onPointerDown={beginDrag} onPointerMove={moveDrag} onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={(event) => { if (ready) zoomPhoto(1.28, event); }}>
        {closeups.map(({ id, url, alt }) => <div key={id} ref={(node) => { aerialFrames.current[id] = node; }}
          className="aerial-shot" aria-hidden={scene?.shot.id !== id}>
          <img src={url} draggable="false" alt={alt}
            style={{ transform: `translate(${photoView.x}px, ${photoView.y}px) scale(${photoView.scale})` }} />
        </div>)}
      </div>}
      {ready && <div className="aerial-reveal-caption"><span>{scene.shot.label}</span>
        {onPhoto && <button type="button" className="text-button" onClick={() => onPhoto(scene.shot.photoId)}>查看原图</button>}
      </div>}
      <div className="map-controls" aria-label={scene ? "近景影像操作" : "地图操作"}>
        <button type="button" title="放大" aria-label={scene ? "放大近景影像" : "放大地图"} disabled={scene ? !ready || photoView.scale >= 3.35 : false}
          onClick={() => scene ? zoomPhoto(1.25) : map.current?.zoomIn()}><Plus size={19} /></button>
        <button type="button" title="缩小" aria-label={scene ? "缩小近景影像" : "缩小地图"} disabled={scene ? !ready || photoView.scale <= 1 : false}
          onClick={() => scene ? zoomPhoto(.8) : map.current?.zoomOut()}><Minus size={19} /></button>
        {mode !== "archive" && (satellite || mode === "online") && <button type="button" className="map-scene-button"
          title={scene ? "回到放大前的地图" : "推进到大濠冲村 2026-07-13 的无人机航拍"}
          aria-label={scene ? "返回地图" : "农田近景"} disabled={scene?.phase === "returning"}
          onClick={() => scene ? closeup.current?.leave() : closeup.current?.enter()}>
          {scene ? <><ArrowLeft size={16} /> 返回地图</> : <><Camera size={17} /> 农田近景</>}
        </button>}
        {!scene && <button type="button" title="复位" aria-label="恢复地图视图" onClick={() => recenter.current?.()}><Crosshair size={19} /></button>}
      </div>
    </div>
    <div className="map-utility">
      <p className="map-hint">{scene ? "滚轮缩放影像 · 拖动查看局部"
        : mode === "satellite" ? detailActive ? "高清实拍影像 · 放大到村点可进入航拍" : "滚轮放大，查看高清实拍影像"
          : mode !== "archive" ? "拖动平移 · 滚轮缩放" : "拖动平移 · 滚轮缩放"}</p>
      <div className="map-provenance">
        {!scene && mode === "satellite" && <button type="button" aria-pressed={showPilot} onClick={() => setShowPilot(!showPilot)}>
          {showPilot ? "隐藏试点地块" : "显示试点地块"}
        </button>}
        {!scene && token && <button type="button" onClick={() => { setMapFallback(false); setMode(mode === "online" ? "satellite" : "online"); }}>
          {mode === "online" ? "Sentinel-2" : "天地图"}
        </button>}
        <button type="button" onClick={onMapInfo}>{mode === "online" ? "天地图影像" : mode === "satellite" ? "影像来源" : mapFallback ? "卫星影像不可用 · 调研地图" : "调研地图"}</button>
      </div>
      {mode === "satellite" && satellite && <span className="map-credit">
        {/* 放大后署名前面会多出高清影像的一段。用完整署名占位，地图画面的高度不随署名变长而变。 */}
        <span className="map-credit-reserve" aria-hidden="true">{DETAIL_IMAGERY.credit} · {satellite.attribution}</span>
        <span className="map-credit-text">{detailActive && `${DETAIL_IMAGERY.credit} · `}{satellite.attribution}</span>
      </span>}
    </div>
  </div>;
}
