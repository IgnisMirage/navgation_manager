<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import MapCanvas from "./components/MapCanvas.vue";
import PointInspector from "./components/PointInspector.vue";
import { loadMapFromFiles, type OccupancyGrid } from "./map";
import {
  addPoint, deletePoint, emptyWaypoints, parseWaypointsYaml, serializeWaypointsYaml,
  linkState, setLink, toggleEdge, updatePoint, type Link, type Point, type WaypointsData,
} from "./waypoints";

type Mode = "select" | "addWp" | "addEdge";

const grid = ref<OccupancyGrid | null>(null);
const data = ref<WaypointsData>(emptyWaypoints());
const selected = ref<string | null>(null);
const edgeFrom = ref<string | null>(null);
const mode = ref<Mode>("select");
const status = ref("YAML を選択してください");
const nameError = ref("");
const settingsOpen = ref(false);
const mapSource = ref("");
const wpFileName = ref(loadSetting("wpFileName", "wp.yaml"));
/** 右クリックメニュー。name があればポイント上、null なら空き地 */
const menu = ref<{ cx: number; cy: number; name: string | null; x: number; y: number } | null>(null);
/** 「ポイントを編集」中のポイント。これだけがドラッグで動かせる */
const editing = ref<string | null>(null);
/** 接続元・接続先を選んだあとの、片道/両方向の選択ダイアログ */
const linkDialog = ref<{ from: string; to: string; cx: number; cy: number } | null>(null);

const selectedPoint = computed<Point | null>(
  () => data.value.waypoints.find((p) => p.name === selected.value) ?? null,
);

const hint: Record<Mode, string> = {
  select: "ポイントをタップで選択 / 右クリック(長押し)でメニュー",
  addWp: "地図をタップしてwaypointを追加",
  addEdge: "接続元 → 接続先の順にポイントをタップ(そのあと片道/両方向を選択)",
};

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`navmgr.${key}`) || fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(`navmgr.${key}`, value);
  } catch {
    // 保存できない環境(プライベートモード等)では、その場の設定だけ使う
  }
}

function setMode(m: Mode) {
  mode.value = m;
  edgeFrom.value = null;
  editing.value = null;
  linkDialog.value = null;
  status.value = hint[m];
}

async function onMapFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  try {
    const r = await loadMapFromFiles(Array.from(input.files ?? []));
    grid.value = r.grid;
    mapSource.value = r.source;
    settingsOpen.value = false;
    const { resolution, origin } = r.grid.meta;
    status.value = `${r.source}: ${r.grid.width}x${r.grid.height}px / ${resolution} m/px / origin (${origin[0]}, ${origin[1]})`;
  } catch (err) {
    status.value = `地図の読み込み失敗: ${(err as Error).message}`;
  }
  input.value = "";
}

async function onWpFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    data.value = parseWaypointsYaml(await file.text());
    selected.value = null;
    settingsOpen.value = false;
    status.value = `読み込み: waypoint ${data.value.waypoints.length}件 / パス ${data.value.edges.length}件`;
  } catch (err) {
    status.value = `waypoint の読み込み失敗: ${(err as Error).message}`;
  }
  input.value = "";
}

function saveWp() {
  const url = URL.createObjectURL(new Blob([serializeWaypointsYaml(data.value)], { type: "text/yaml" }));
  const a = document.createElement("a");
  a.href = url;
  const name = wpFileName.value.trim() || "wp.yaml";
  a.download = /\.ya?ml$/i.test(name) ? name : `${name}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
  settingsOpen.value = false;
}

function onWpFileName() {
  saveSetting("wpFileName", wpFileName.value.trim() || "wp.yaml");
}

function onTap(name: string | null, x: number, y: number, cx: number, cy: number) {
  if (name !== editing.value) editing.value = null; // 編集中のポイント以外をタップしたら編集を終える
  if (mode.value === "addWp") {
    if (name) {
      selected.value = name;
    } else {
      const r = addPoint(data.value, x, y);
      data.value = r.data;
      selected.value = r.name;
    }
  } else if (mode.value === "addEdge") {
    if (!name) return;
    if (edgeFrom.value === null) {
      edgeFrom.value = name;
      status.value = `接続元: ${name} → 接続先をタップ`;
    } else if (edgeFrom.value === name) {
      edgeFrom.value = null;
      status.value = hint.addEdge;
    } else {
      linkDialog.value = { from: edgeFrom.value, to: name, cx: Math.min(cx, window.innerWidth - 230), cy: Math.min(cy, window.innerHeight - 230) };
    }
  } else {
    selected.value = name;
  }
  nameError.value = "";
}

function onContext(name: string | null, x: number, y: number, cx: number, cy: number) {
  if (name) selected.value = name;
  linkDialog.value = null;
  // 画面端でメニューがはみ出さないように寄せる
  menu.value = { cx: Math.min(cx, window.innerWidth - 190), cy: Math.min(cy, window.innerHeight - 160), name, x, y };
}

function placeHere() {
  if (!menu.value) return;
  const r = addPoint(data.value, menu.value.x, menu.value.y);
  data.value = r.data;
  selected.value = r.name;
  menu.value = null;
}

function startEditing() {
  const name = menu.value?.name;
  menu.value = null;
  if (!name) return;
  editing.value = name;
  selected.value = name;
  status.value = `${name}: 本体をドラッグで移動 / 棒の先(橙の丸)をドラッグで角度変更(Shiftで15°刻み) / Esc で終了`;
}

function startLinkFrom() {
  const name = menu.value?.name;
  menu.value = null;
  if (!name) return;
  setMode("addEdge");
  edgeFrom.value = name;
  status.value = `接続元: ${name} → 接続先をタップ`;
}

function deleteFromMenu() {
  const name = menu.value?.name;
  if (name) {
    data.value = deletePoint(data.value, name);
    if (selected.value === name) selected.value = null;
    if (editing.value === name) editing.value = null;
    if (edgeFrom.value === name) edgeFrom.value = null;
  }
  menu.value = null;
}

function chooseLink(link: Link) {
  const d = linkDialog.value;
  if (!d) return;
  data.value = setLink(data.value, d.from, d.to, link);
  const label = { none: "パスを削除", forward: `${d.from} → ${d.to}(片道)`, backward: `${d.to} → ${d.from}(片道)`, both: `${d.from} ⇄ ${d.to}(両方向)` }[link];
  status.value = `${label} に設定しました。続けて接続元をタップ`;
  linkDialog.value = null;
  edgeFrom.value = null;
}

const closePopups = () => {
  menu.value = null;
  settingsOpen.value = false;
  if (linkDialog.value) {
    linkDialog.value = null;
    edgeFrom.value = null;
  }
};
const onKey = (e: KeyboardEvent) => {
  if (e.key !== "Escape") return;
  closePopups();
  editing.value = null;
  edgeFrom.value = null;
};
onMounted(() => {
  window.addEventListener("pointerdown", closePopups);
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closePopups);
  window.removeEventListener("keydown", onKey);
});

function onMove(name: string, x: number, y: number) {
  data.value = updatePoint(data.value, name, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }) ?? data.value;
}

function onRotate(name: string, theta: number) {
  data.value = updatePoint(data.value, name, { theta: Math.round(theta * 10000) / 10000 }) ?? data.value;
}

function onUpdate(patch: Partial<Point>) {
  if (!selected.value) return;
  const next = updatePoint(data.value, selected.value, patch);
  if (!next) {
    nameError.value = "ポイント名が空、または既に使われています";
    return;
  }
  nameError.value = "";
  data.value = next;
  if (patch.name) selected.value = patch.name;
}

function onDelete() {
  if (!selected.value) return;
  data.value = deletePoint(data.value, selected.value);
  selected.value = null;
  editing.value = null;
}
</script>

<template>
  <div class="app">
    <header>
      <button :class="{ active: settingsOpen }" @pointerdown.stop @click="settingsOpen = !settingsOpen">⚙ 設定</button>
      <span class="sep" />
      <button :class="{ active: mode === 'select' }" @click="setMode('select')">選択</button>
      <button :class="{ active: mode === 'addWp' }" :disabled="!grid" @click="setMode('addWp')">WP追加</button>
      <button :class="{ active: mode === 'addEdge' }" :disabled="!grid" @click="setMode('addEdge')">パス接続</button>
      <span class="status">{{ status }}</span>
    </header>
    <div v-if="settingsOpen" class="settings" @pointerdown.stop>
      <h4>地図</h4>
      <label class="btn">YAMLを選ぶ<input type="file" accept=".yaml,.yml" @change="onMapFiles" /></label>
      <p class="hint">{{ mapSource || "未読み込み" }}</p>
      <h4>WP(waypoint とパス)</h4>
      <label class="btn">WP読込<input type="file" accept=".yaml,.yml" @change="onWpFile" /></label>
      <label class="field">保存ファイル名
        <input v-model="wpFileName" @change="onWpFileName" />
      </label>
      <button @click="saveWp">WP保存</button>
    </div>
    <div v-if="menu" class="ctx" :style="{ left: menu.cx + 'px', top: menu.cy + 'px' }" @pointerdown.stop @contextmenu.prevent>
      <button v-if="!menu.name" @click="placeHere">ここにポイントを置く</button>
      <template v-else>
        <button @click="startEditing">ポイントを編集(ドラッグで移動)</button>
        <button @click="startLinkFrom">ここからパスをつなぐ</button>
        <button class="danger" @click="deleteFromMenu">{{ menu.name }} を削除</button>
      </template>
    </div>
    <div v-if="linkDialog" class="ctx" :style="{ left: linkDialog.cx + 'px', top: linkDialog.cy + 'px' }" @pointerdown.stop @contextmenu.prevent>
      <div class="ctx-title">{{ linkDialog.from }} と {{ linkDialog.to }} のパス</div>
      <button :class="{ on: linkState(data, linkDialog.from, linkDialog.to) === 'forward' }" @click="chooseLink('forward')">
        {{ linkDialog.from }} → {{ linkDialog.to }}(片道)
      </button>
      <button :class="{ on: linkState(data, linkDialog.from, linkDialog.to) === 'backward' }" @click="chooseLink('backward')">
        {{ linkDialog.to }} → {{ linkDialog.from }}(片道)
      </button>
      <button :class="{ on: linkState(data, linkDialog.from, linkDialog.to) === 'both' }" @click="chooseLink('both')">
        {{ linkDialog.from }} ⇄ {{ linkDialog.to }}(両方向)
      </button>
      <button class="danger" @click="chooseLink('none')">パスを削除</button>
    </div>
    <main>
      <div class="map">
        <MapCanvas
          :grid="grid"
          :waypoints="data"
          :selected="selected"
          :edge-from="edgeFrom"
          :editing="editing"
          @tap="onTap"
          @move="onMove"
          @rotate="onRotate"
          @context="onContext"
        />
      </div>
      <aside>
        <PointInspector
          v-if="selectedPoint"
          :point="selectedPoint"
          :data="data"
          :name-error="nameError"
          @update="onUpdate"
          @toggle-edge="(f, t) => (data = toggleEdge(data, f, t))"
          @delete="onDelete"
        />
        <p v-else class="hint">ポイントを選択すると、名前・座標・接続先を編集できます。</p>
        <p class="hint">waypoint: {{ data.waypoints.length }} / パス(edge): {{ data.edges.length }}</p>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; background: var(--bar); color: #fff; }
.sep { width: 1px; height: 28px; background: #78909c; margin: 0 4px; }
.status { font-size: 13px; flex: 1; min-width: 200px; }
main { flex: 1; display: flex; min-height: 0; }
.map { flex: 1; min-width: 0; }
aside { width: 320px; padding: 12px; overflow-y: auto; border-left: 1px solid #cfd8dc; box-sizing: border-box; }
.settings { position: fixed; z-index: 10; top: 56px; left: 12px; width: 280px; max-width: calc(100vw - 24px); display: flex; flex-direction: column; gap: 8px; padding: 12px; background: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
.settings h4 { margin: 4px 0 0; font-size: 14px; }
.settings .btn { text-align: center; }
.settings .hint { margin: 0; word-break: break-all; }
.settings .field { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.settings .field input { padding: 10px; font-size: 16px; border: 1px solid #b0bec5; border-radius: 6px; width: 100%; box-sizing: border-box; }
.ctx { position: fixed; z-index: 10; display: flex; flex-direction: column; min-width: 180px; padding: 4px; background: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
.ctx button { text-align: left; background: transparent; color: #263238; }
.ctx button:hover { background: #eceff1; }
.ctx button.danger { color: var(--danger); }
.ctx button.on { background: #bbdefb; font-weight: bold; }
.ctx-title { padding: 6px 12px; font-size: 12px; color: #607d8b; }
.hint { font-size: 13px; color: #607d8b; }
@media (max-width: 800px) {
  main { flex-direction: column; }
  aside { width: auto; height: 40%; border-left: 0; border-top: 1px solid #cfd8dc; }
}
</style>
