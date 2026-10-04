<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { pixelToWorld, worldToPixel, type OccupancyGrid } from "../map";
import type { WaypointsData } from "../waypoints";

const props = defineProps<{
  grid: OccupancyGrid | null;
  waypoints: WaypointsData;
  selected: string | null;
  /** 接続モードで始点として選択中のポイント */
  edgeFrom: string | null;
  /** 「ポイントを編集」中のポイント。これだけがドラッグで動かせる */
  editing: string | null;
}>();

const emit = defineEmits<{
  /** タップ。ポイント上なら name、空き地なら null。x,y は世界座標[m]、cx,cy は画面位置(CSSピクセル) */
  (e: "tap", name: string | null, x: number, y: number, cx: number, cy: number): void;
  (e: "move", name: string, x: number, y: number): void;
  /** 編集中ポイントの向きを回転。theta は世界座標系のラジアン(-π, π]、x軸正方向が0 */
  (e: "rotate", name: string, theta: number): void;
  /** 右クリック(タッチでは長押し)。cx, cy はメニューを出す画面位置(CSSピクセル) */
  (e: "context", name: string | null, x: number, y: number, cx: number, cy: number): void;
}>();

const HIT_RADIUS = 22; // タッチ操作を想定して大きめ(画面px)
const POINT_RADIUS = 9;
const STICK_LEN = 46; // 編集中ポイントの向きの棒の長さ(画面px)
const HANDLE_HIT = 22; // 棒の先端(つまみ)を掴める範囲(画面px)
const PROTRACTOR_R = 80; // 分度器の半径(画面px)

const canvas = ref<HTMLCanvasElement>();
let offscreen: HTMLCanvasElement | null = null;
let scale = 1;
let tx = 0;
let ty = 0;

function renderOffscreen(g: OccupancyGrid) {
  const c = document.createElement("canvas");
  c.width = g.width;
  c.height = g.height;
  const img = new ImageData(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i] === 100 ? 0 : g.data[i] === 0 ? 255 : 205;
    img.data.set([v, v, v, 255], i * 4);
  }
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

function fitView() {
  const c = canvas.value;
  if (!c || !props.grid) return;
  scale = Math.min(c.width / props.grid.width, c.height / props.grid.height) * 0.95;
  tx = (c.width - props.grid.width * scale) / 2;
  ty = (c.height - props.grid.height * scale) / 2;
}

const toScreen = (g: OccupancyGrid, x: number, y: number): [number, number] => {
  const [px, py] = worldToPixel(g, x, y);
  return [px * scale + tx, py * scale + ty];
};

function draw() {
  const c = canvas.value;
  if (!c) return;
  const ctx = c.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  const g = props.grid;
  if (!g || !offscreen) return;

  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, tx, ty);
  ctx.drawImage(offscreen, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const dpr = c.width / c.clientWidth;
  const pos = new Map<string, [number, number]>();
  for (const p of [...props.waypoints.waypoints, ...props.waypoints.targetpoints]) {
    pos.set(p.name, toScreen(g, p.x, p.y));
  }

  // パス: 片道は矢印1つ(青)、往復(両方向)は線の両端に矢印(緑)
  const keys = new Set(props.waypoints.edges.map((e) => `${e.from}\0${e.to}`));
  const head = (tip: [number, number], ang: number) => {
    const h = 10 * dpr;
    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(tip[0] - h * Math.cos(ang - 0.4), tip[1] - h * Math.sin(ang - 0.4));
    ctx.lineTo(tip[0] - h * Math.cos(ang + 0.4), tip[1] - h * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  };
  ctx.lineWidth = 2 * dpr;
  for (const e of props.waypoints.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const both = keys.has(`${e.to}\0${e.from}`);
    if (both && e.from > e.to) continue; // 往復は1回だけ描く
    const color = both ? "#2e7d32" : "#1e88e5";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const off = POINT_RADIUS * dpr;
    const tipB: [number, number] = [b[0] - Math.cos(ang) * off, b[1] - Math.sin(ang) * off];
    const tipA: [number, number] = [a[0] + Math.cos(ang) * off, a[1] + Math.sin(ang) * off];
    ctx.beginPath();
    ctx.moveTo(tipA[0], tipA[1]);
    ctx.lineTo(tipB[0], tipB[1]);
    ctx.stroke();
    head(tipB, ang);
    if (both) head(tipA, ang + Math.PI);
  }

  // ポイント(向きの矢印と名前つき)
  ctx.font = `${13 * dpr}px sans-serif`;
  for (const p of props.waypoints.waypoints) {
    const [sx, sy] = pos.get(p.name)!;
    const r = POINT_RADIUS * dpr;
    const sel = p.name === props.selected;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = p.name === props.edgeFrom ? "#fb8c00" : sel ? "#43a047" : "#e53935";
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    if (p.name === props.editing) {
      // 編集中(ドラッグで動かせる)ポイントは二重の輪で示す
      ctx.beginPath();
      ctx.arc(sx, sy, r + 6 * dpr, 0, Math.PI * 2);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "#fb8c00";
      ctx.stroke();
    }
    // theta は世界座標系(y上向き)なので画面では y を反転
    const th = p.theta ?? 0;
    const isEditing = p.name === props.editing;
    const len = isEditing ? STICK_LEN * dpr : r * 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(th) * len, sy - Math.sin(th) * len);
    ctx.strokeStyle = "#000";
    ctx.stroke();
    if (isEditing) {
      // 棒の先のつまみ。ここをドラッグすると角度を変えられる
      ctx.beginPath();
      ctx.arc(sx + Math.cos(th) * len, sy - Math.sin(th) * len, 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "#fb8c00";
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
    ctx.fillStyle = "#000";
    ctx.fillText(p.name, sx + r + 3 * dpr, sy - r);
  }

  if (rotating) {
    const p = props.waypoints.waypoints.find((q) => q.name === rotating);
    if (p) {
      const [sx, sy] = pos.get(p.name)!;
      drawProtractor(ctx, dpr, sx, sy, p.theta ?? 0);
    }
  }
}

/** 角度を変えている間だけ、ポイントを中心に透過の分度器と現在の角度を描く */
function drawProtractor(ctx: CanvasRenderingContext2D, dpr: number, sx: number, sy: number, theta: number) {
  const R = PROTRACTOR_R * dpr;
  const at = (a: number, rad: number): [number, number] => [sx + Math.cos(a) * rad, sy - Math.sin(a) * rad];
  ctx.save();
  // 盤面
  ctx.beginPath();
  ctx.arc(sx, sy, R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fill();
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeStyle = "rgba(38, 50, 56, 0.6)";
  ctx.stroke();
  // 0° から現在の角度までの扇形
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.arc(sx, sy, R * 0.55, 0, -theta, theta > 0); // 画面はy下向きなので符号を反転
  ctx.closePath();
  ctx.fillStyle = "rgba(251, 140, 0, 0.35)";
  ctx.fill();
  // 目盛り(5°ごと、15°ごとに長く、90°ごとに数字)
  ctx.font = `${12 * dpr}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180;
    const len = d % 45 === 0 ? 14 : d % 15 === 0 ? 9 : 5;
    const [x1, y1] = at(a, R);
    const [x2, y2] = at(a, R - len * dpr);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = (d % 45 === 0 ? 2 : 1) * dpr;
    ctx.strokeStyle = "rgba(38, 50, 56, 0.7)";
    ctx.stroke();
    if (d % 90 === 0) {
      const [tx2, ty2] = at(a, R + 12 * dpr);
      ctx.fillStyle = "rgba(38, 50, 56, 0.85)";
      ctx.fillText(`${d === 270 ? -90 : d}°`, tx2, ty2);
    }
  }
  // 現在の向き
  const [hx, hy] = at(theta, R);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(hx, hy);
  ctx.lineWidth = 2.5 * dpr;
  ctx.strokeStyle = "#fb8c00";
  ctx.stroke();
  // 角度の数値
  const deg = Math.round((theta * 180) / Math.PI);
  ctx.font = `bold ${22 * dpr}px sans-serif`;
  ctx.fillStyle = "rgba(38, 50, 56, 0.9)";
  const [lx, ly] = at(theta + Math.PI, R * 0.4);
  ctx.fillText(`${deg}°`, lx, ly);
  ctx.restore();
}

function resize() {
  const c = canvas.value;
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr;
  c.height = c.clientHeight * dpr;
  fitView();
  draw();
}

function hitTest(sx: number, sy: number): string | null {
  const g = props.grid;
  const c = canvas.value;
  if (!g || !c) return null;
  const dpr = c.width / c.clientWidth;
  let best: string | null = null;
  let bestD = HIT_RADIUS * dpr;
  for (const p of props.waypoints.waypoints) {
    const [x, y] = toScreen(g, p.x, p.y);
    const d = Math.hypot(x - sx, y - sy);
    if (d <= bestD) {
      best = p.name;
      bestD = d;
    }
  }
  return best;
}

/** 編集中ポイントの棒の先(つまみ)付近か。ポイント本体を掴む操作とは区別する */
function hitHandle(sx: number, sy: number): boolean {
  const g = props.grid;
  const c = canvas.value;
  const name = props.editing;
  if (!g || !c || !name) return false;
  const p = props.waypoints.waypoints.find((q) => q.name === name);
  if (!p) return false;
  const dpr = c.width / c.clientWidth;
  const [cx, cy] = toScreen(g, p.x, p.y);
  const th = p.theta ?? 0;
  const tipX = cx + Math.cos(th) * STICK_LEN * dpr;
  const tipY = cy - Math.sin(th) * STICK_LEN * dpr;
  const dTip = Math.hypot(sx - tipX, sy - tipY);
  const dCenter = Math.hypot(sx - cx, sy - cy);
  if (dTip <= HANDLE_HIT * dpr && dTip < dCenter) return true;
  // 棒の途中(ポイント本体の近くは除く)も掴めるようにする
  if (dCenter > 16 * dpr) {
    const vx = tipX - cx;
    const vy = tipY - cy;
    const t = Math.min(1, Math.max(0, ((sx - cx) * vx + (sy - cy) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(sx - (cx + vx * t), sy - (cy + vy * t)) <= 14 * dpr;
  }
  return false;
}

/** ポイント中心からポインタへの向きを、世界座標系の角度(1°刻み、Shiftで15°刻み)として返す */
function angleTo(name: string, sx: number, sy: number, snap15: boolean): number | null {
  const g = props.grid;
  const p = props.waypoints.waypoints.find((q) => q.name === name);
  if (!g || !p) return null;
  const [cx, cy] = toScreen(g, p.x, p.y);
  if (Math.hypot(sx - cx, sy - cy) < 4) return null;
  let deg = (Math.atan2(-(sy - cy), sx - cx) * 180) / Math.PI;
  const step = snap15 ? 15 : 1;
  deg = Math.round(deg / step) * step;
  if (deg <= -180) deg += 360; // (-180, 180] に正規化
  return (deg * Math.PI) / 180;
}

const screenToWorld = (sx: number, sy: number) =>
  pixelToWorld(props.grid!, (sx - tx) / scale, (sy - ty) / scale);

// ---- 操作: 1本指ドラッグ=パン(選択中ポイント上なら移動) / ピンチ=ズーム / タップ=tap通知
const pointers = new Map<number, { x: number; y: number }>();
let lastDist = 0;
let dragPoint: string | null = null;
/** 角度を変えている最中のポイント(分度器を表示する間だけ設定される) */
let rotating: string | null = null;
let skipTap = false;
let downPos: { x: number; y: number } | null = null;
let moved = false;

function localPos(e: { clientX: number; clientY: number }) {
  const r = canvas.value!.getBoundingClientRect();
  const dpr = canvas.value!.width / r.width;
  return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
}

function zoomAt(cx: number, cy: number, factor: number) {
  const next = Math.min(Math.max(scale * factor, 0.05), 100);
  const f = next / scale;
  tx = cx - (cx - tx) * f;
  ty = cy - (cy - ty) * f;
  scale = next;
}

function onDown(e: PointerEvent) {
  // マウスの右・中ボタンはパン/タップ操作に使わない(右クリックはメニュー用)
  if (e.pointerType === "mouse" && e.button !== 0) return;
  canvas.value!.setPointerCapture(e.pointerId);
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  lastDist = 0;
  if (pointers.size === 1) {
    downPos = p;
    moved = false;
    skipTap = false;
    rotating = null;
    dragPoint = null;
    if (props.editing && hitHandle(p.x, p.y)) {
      rotating = props.editing;
      skipTap = true;
      draw();
    } else {
      const hit = hitTest(p.x, p.y);
      dragPoint = hit !== null && hit === props.editing ? hit : null;
    }
  } else {
    dragPoint = null;
    rotating = null;
    moved = true;
  }
}

function onMove(e: PointerEvent) {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = localPos(e);
  pointers.set(e.pointerId, cur);
  if (downPos && Math.hypot(cur.x - downPos.x, cur.y - downPos.y) > 8) moved = true;
  if (rotating && pointers.size === 1) {
    const theta = angleTo(rotating, cur.x, cur.y, e.shiftKey);
    if (theta !== null) emit("rotate", rotating, theta);
    draw();
    return;
  }
  if (pointers.size === 1) {
    if (!moved) return;
    if (dragPoint && props.grid) {
      const [x, y] = screenToWorld(cur.x, cur.y);
      emit("move", dragPoint, x, y);
    } else {
      tx += cur.x - prev.x;
      ty += cur.y - prev.y;
      draw();
    }
  } else if (pointers.size === 2) {
    const [a, b] = Array.from(pointers.values());
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / lastDist);
    lastDist = dist;
    draw();
  }
}

function onUp(e: PointerEvent) {
  const p = pointers.get(e.pointerId);
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);
  lastDist = 0;
  if (e.type === "pointerup" && wasSingle && !moved && !skipTap && p && props.grid) {
    const [x, y] = screenToWorld(p.x, p.y);
    emit("tap", hitTest(p.x, p.y), x, y, e.clientX, e.clientY);
  }
  dragPoint = null;
  if (rotating) {
    rotating = null; // 分度器を消す
    draw();
  }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  if (!props.grid) return;
  const p = localPos(e);
  const [x, y] = screenToWorld(p.x, p.y);
  emit("context", hitTest(p.x, p.y), x, y, e.clientX, e.clientY);
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const p = localPos(e);
  zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  draw();
}

watch(
  () => props.grid,
  (g) => {
    offscreen = g ? renderOffscreen(g) : null;
    fitView();
    draw();
  },
);
watch(() => [props.waypoints, props.selected, props.edgeFrom, props.editing], draw, { deep: true });

onMounted(() => {
  window.addEventListener("resize", resize);
  resize();
});
onBeforeUnmount(() => window.removeEventListener("resize", resize));
</script>

<template>
  <canvas
    ref="canvas"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @wheel="onWheel"
    @contextmenu="onContextMenu"
  />
</template>

<style scoped>
canvas { width: 100%; height: 100%; display: block; background: #eceff1; touch-action: none; }
</style>
