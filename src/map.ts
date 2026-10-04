import { load } from "js-yaml";

export interface MapMeta {
  image: string;
  resolution: number;
  origin: [number, number, number];
  negate: boolean;
  occupiedThresh: number;
  freeThresh: number;
}

/** 占有格子。data は画像と同じ並び(左上が先頭)で、値は 0=空き, 100=占有, -1=不明 */
export interface OccupancyGrid {
  meta: MapMeta;
  width: number;
  height: number;
  data: Int8Array;
}

export function parseMapYaml(text: string): MapMeta {
  const raw = load(text);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("YAMLの形式が不正です");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.image !== "string") throw new Error("image が指定されていません");
  if (typeof r.resolution !== "number" || r.resolution <= 0) {
    throw new Error("resolution が不正です");
  }
  if (!Array.isArray(r.origin) || r.origin.length < 3 || !r.origin.every((v) => typeof v === "number")) {
    throw new Error("origin は [x, y, yaw] の数値配列で指定してください");
  }
  return {
    image: r.image,
    resolution: r.resolution,
    origin: [r.origin[0], r.origin[1], r.origin[2]],
    negate: r.negate === 1 || r.negate === true,
    occupiedThresh: typeof r.occupied_thresh === "number" ? r.occupied_thresh : 0.65,
    freeThresh: typeof r.free_thresh === "number" ? r.free_thresh : 0.196,
  };
}

/** RGBA画素列を ROS map_server (trinary) と同じ規則で占有格子へ変換する */
export function buildGrid(meta: MapMeta, rgba: Uint8ClampedArray, width: number, height: number): OccupancyGrid {
  const data = new Int8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const avg = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    const p = meta.negate ? avg / 255 : (255 - avg) / 255;
    data[i] = p > meta.occupiedThresh ? 100 : p < meta.freeThresh ? 0 : -1;
  }
  return { meta, width, height, data };
}

/** 世界座標[m] -> 画像ピクセル座標(yawは無視する) */
export function worldToPixel(g: OccupancyGrid, x: number, y: number): [number, number] {
  const { resolution, origin } = g.meta;
  return [(x - origin[0]) / resolution, g.height - (y - origin[1]) / resolution];
}

/** 画像ピクセル座標 -> 世界座標[m] */
export function pixelToWorld(g: OccupancyGrid, px: number, py: number): [number, number] {
  const { resolution, origin } = g.meta;
  return [origin[0] + px * resolution, origin[1] + (g.height - py) * resolution];
}

export async function loadImageData(file: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/**
 * ユーザーが選択したファイル群から地図を読み込む。
 * YAML だけが選ばれた場合は、PC側のサーバーに同じ YAML の場所を探してもらい、画像もそこから読む。
 */
export async function loadMapFromFiles(files: File[]): Promise<{ grid: OccupancyGrid; source: string }> {
  const yamlFile = files.find((f) => /\.ya?ml$/i.test(f.name));
  if (!yamlFile) throw new Error("YAMLファイルを選択してください");
  const yamlText = await yamlFile.text();
  const meta = parseMapYaml(yamlText);
  const base = (p: string) => p.split(/[\\/]/).pop()!;
  const imageFile =
    files.find((f) => f.name === base(meta.image)) ?? files.find((f) => /\.(png|pgm)$/i.test(f.name));
  if (imageFile) {
    const img = await loadImageData(imageFile);
    return { grid: buildGrid(meta, img.data, img.width, img.height), source: yamlFile.name };
  }

  const res = await fetch("/api/resolve-map", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: yamlFile.name, yaml: yamlText }),
  });
  if (!res.ok) throw new Error(await res.text());
  const img = await loadImageData(await res.blob());
  const source = decodeURIComponent(res.headers.get("x-map-path") ?? yamlFile.name);
  return { grid: buildGrid(meta, img.data, img.width, img.height), source };
}
