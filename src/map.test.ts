import { describe, expect, it } from "vitest";
import { buildGrid, parseMapYaml, pixelToWorld, worldToPixel } from "./map";

const yamlText = `image: map.png
resolution: 0.05
origin: [-1.0, -2.0, 0.0]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.196
`;

describe("parseMapYaml", () => {
  it("ROS形式を解釈する", () => {
    const m = parseMapYaml(yamlText);
    expect(m.image).toBe("map.png");
    expect(m.resolution).toBe(0.05);
    expect(m.origin).toEqual([-1, -2, 0]);
    expect(m.negate).toBe(false);
  });
  it("必須項目が無ければエラー", () => {
    expect(() => parseMapYaml("resolution: 0.05")).toThrow();
  });
});

describe("buildGrid", () => {
  it("黒=占有, 白=空き, 灰=不明", () => {
    const meta = parseMapYaml(yamlText);
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 205, 205, 205, 255]);
    expect(Array.from(buildGrid(meta, px, 3, 1).data)).toEqual([100, 0, -1]);
  });
});

describe("座標変換", () => {
  it("往復で元に戻る", () => {
    const g = buildGrid(parseMapYaml(yamlText), new Uint8ClampedArray(4 * 40 * 20), 40, 20);
    const [px, py] = worldToPixel(g, 0.5, -1.0);
    const [x, y] = pixelToWorld(g, px, py);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(-1.0);
  });
});
