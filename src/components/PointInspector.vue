<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { hasEdge, type Point, type WaypointsData } from "../waypoints";

const props = defineProps<{ point: Point; data: WaypointsData; nameError: string }>();
const emit = defineEmits<{
  (e: "update", patch: Partial<Point>): void;
  (e: "toggle-edge", from: string, to: string): void;
  (e: "delete"): void;
}>();

// 名前は確定(change)時に検証する。入力途中の重複で弾かれないよう下書きを持つ
const nameDraft = ref(props.point.name);
watch(() => props.point.name, (n) => { nameDraft.value = n; });

function commitName() {
  if (nameDraft.value === props.point.name) return;
  emit("update", { name: nameDraft.value });
}

const others = computed(() => props.data.waypoints.filter((p) => p.name !== props.point.name));
const incoming = computed(() => props.data.edges.filter((e) => e.to === props.point.name).map((e) => e.from));

const num = (e: Event) => Number((e.target as HTMLInputElement).value);
const deg = computed(() => (((props.point.theta ?? 0) * 180) / Math.PI).toFixed(1));
</script>

<template>
  <div class="inspector">
    <label>ポイント名
      <input v-model="nameDraft" @change="commitName" />
    </label>
    <p v-if="nameError" class="err">{{ nameError }}</p>
    <div class="grid">
      <label>x (m)
        <input type="number" step="0.01" :value="point.x" @change="emit('update', { x: num($event) })" />
      </label>
      <label>y (m)
        <input type="number" step="0.01" :value="point.y" @change="emit('update', { y: num($event) })" />
      </label>
      <label>theta (rad)
        <input type="number" step="0.01" :value="point.theta ?? 0" @change="emit('update', { theta: num($event) })" />
      </label>
      <label>theta (°)
        <input type="number" step="1" :value="deg" @change="emit('update', { theta: (num($event) * Math.PI) / 180 })" />
      </label>
    </div>

    <h4>接続先(このポイント → 選んだポイント)</h4>
    <p v-if="others.length === 0" class="hint">他のポイントがありません</p>
    <label v-for="o in others" :key="o.name" class="check">
      <input type="checkbox" :checked="hasEdge(data, point.name, o.name)" @change="emit('toggle-edge', point.name, o.name)" />
      {{ o.name }}
    </label>
    <p v-if="incoming.length" class="hint">接続元: {{ incoming.join(", ") }}</p>

    <button class="danger" @click="emit('delete')">このポイントを削除</button>
  </div>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; gap: 8px; }
label { display: flex; flex-direction: column; font-size: 13px; gap: 2px; }
input:not([type="checkbox"]) { width: 100%; min-width: 0; box-sizing: border-box; padding: 10px; font-size: 16px; border: 1px solid #b0bec5; border-radius: 6px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.check { flex-direction: row; align-items: center; gap: 10px; font-size: 16px; padding: 6px 0; }
.check input { width: 22px; height: 22px; }
h4 { margin: 8px 0 0; font-size: 14px; }
.hint { font-size: 12px; color: #607d8b; margin: 0; }
.err { color: #e53935; font-size: 12px; margin: 0; }
</style>
