import { dump, load } from "js-yaml";

/** wp.yaml (ia-deploy-tools-rs の waypoints.rs) と互換のデータ形式 */
export interface Point {
  name: string;
  x: number;
  y: number;
  theta: number | null;
}

export interface Edge {
  from: string;
  to: string;
}

export interface WaypointsData {
  waypoints: Point[];
  targetpoints: Point[];
  edges: Edge[];
}

export const emptyWaypoints = (): WaypointsData => ({ waypoints: [], targetpoints: [], edges: [] });

function parsePoint(v: unknown, kind: string): Point {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p.name !== "string" || typeof p.x !== "number" || typeof p.y !== "number") {
    throw new Error(`${kind} の形式が不正です(name, x, y が必要)`);
  }
  return { name: p.name, x: p.x, y: p.y, theta: typeof p.theta === "number" ? p.theta : null };
}

export function parseWaypointsYaml(text: string): WaypointsData {
  const raw = load(text) as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null) throw new Error("YAMLの形式が不正です");
  const list = (k: string): unknown[] => {
    const v = raw[k];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error(`${k} は配列で指定してください`);
    return v;
  };
  const data: WaypointsData = {
    waypoints: list("waypoints").map((v) => parsePoint(v, "waypoint")),
    targetpoints: list("targetpoints").map((v) => parsePoint(v, "targetpoint")),
    edges: list("edges").map((v) => {
      const e = v as Record<string, unknown> | null;
      if (!e || typeof e.from !== "string" || typeof e.to !== "string") {
        throw new Error("edge の形式が不正です(from, to が必要)");
      }
      return { from: e.from, to: e.to };
    }),
  };
  const names = [...data.waypoints, ...data.targetpoints].map((p) => p.name);
  if (new Set(names).size !== names.length) throw new Error("ポイント名が重複しています");
  return data;
}

export function serializeWaypointsYaml(data: WaypointsData): string {
  return dump({ waypoints: data.waypoints, targetpoints: data.targetpoints, edges: data.edges });
}

const allNames = (d: WaypointsData) => new Set([...d.waypoints, ...d.targetpoints].map((p) => p.name));

export function uniqueName(d: WaypointsData, prefix = "wp"): string {
  const names = allNames(d);
  for (let i = 1; ; i++) {
    if (!names.has(`${prefix}${i}`)) return `${prefix}${i}`;
  }
}

const mm = (v: number) => Math.round(v * 1000) / 1000;

export function addPoint(d: WaypointsData, x: number, y: number): { data: WaypointsData; name: string } {
  const name = uniqueName(d);
  return { data: { ...d, waypoints: [...d.waypoints, { name, x: mm(x), y: mm(y), theta: 0 }] }, name };
}

/** 名前変更時は edges の参照も追従させる。名前が空・重複なら変更しない(null を返す) */
export function updatePoint(d: WaypointsData, oldName: string, patch: Partial<Point>): WaypointsData | null {
  const newName = patch.name ?? oldName;
  if (newName.trim() === "") return null;
  if (newName !== oldName && allNames(d).has(newName)) return null;
  const apply = (p: Point): Point => (p.name === oldName ? { ...p, ...patch, name: newName } : p);
  const rename = (n: string) => (n === oldName ? newName : n);
  return {
    waypoints: d.waypoints.map(apply),
    targetpoints: d.targetpoints.map(apply),
    edges: d.edges.map((e) => ({ from: rename(e.from), to: rename(e.to) })),
  };
}

export function deletePoint(d: WaypointsData, name: string): WaypointsData {
  return {
    waypoints: d.waypoints.filter((p) => p.name !== name),
    targetpoints: d.targetpoints.filter((p) => p.name !== name),
    edges: d.edges.filter((e) => e.from !== name && e.to !== name),
  };
}

export const hasEdge = (d: WaypointsData, from: string, to: string) =>
  d.edges.some((e) => e.from === from && e.to === to);

/** from→to の接続を切り替える(自己ループは作らない) */
export function toggleEdge(d: WaypointsData, from: string, to: string): WaypointsData {
  if (from === to) return d;
  return hasEdge(d, from, to)
    ? { ...d, edges: d.edges.filter((e) => !(e.from === from && e.to === to)) }
    : { ...d, edges: [...d.edges, { from, to }] };
}

/** 2点間のパスの状態。forward は a→b の片道、backward は b→a の片道 */
export type Link = "none" | "forward" | "backward" | "both";

export function linkState(d: WaypointsData, a: string, b: string): Link {
  const f = hasEdge(d, a, b);
  const r = hasEdge(d, b, a);
  return f && r ? "both" : f ? "forward" : r ? "backward" : "none";
}

/** 2点間のパスを指定の状態にする。両方向は a→b と b→a の2本の edge として持つ(片道は1本) */
export function setLink(d: WaypointsData, a: string, b: string, link: Link): WaypointsData {
  if (a === b) return d;
  const rest = d.edges.filter((e) => !(e.from === a && e.to === b) && !(e.from === b && e.to === a));
  const add: Edge[] = [];
  if (link === "forward" || link === "both") add.push({ from: a, to: b });
  if (link === "backward" || link === "both") add.push({ from: b, to: a });
  return { ...d, edges: [...rest, ...add] };
}
