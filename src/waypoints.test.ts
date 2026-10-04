import { describe, expect, it } from "vitest";
import {
  addPoint, deletePoint, emptyWaypoints, hasEdge, linkState, parseWaypointsYaml,
  serializeWaypointsYaml, setLink, toggleEdge, updatePoint,
} from "./waypoints";

const sample = () => {
  let d = addPoint(emptyWaypoints(), 1, 2).data;
  d = addPoint(d, 3, 4).data;
  return toggleEdge(d, "wp1", "wp2");
};

describe("waypoints", () => {
  it("名前が重複しないように自動採番する", () => {
    expect(sample().waypoints.map((p) => p.name)).toEqual(["wp1", "wp2"]);
  });
  it("リネームで edges も追従する", () => {
    const d = updatePoint(sample(), "wp1", { name: "A" })!;
    expect(d.edges).toEqual([{ from: "A", to: "wp2" }]);
  });
  it("重複・空のリネームは拒否する", () => {
    expect(updatePoint(sample(), "wp1", { name: "wp2" })).toBeNull();
    expect(updatePoint(sample(), "wp1", { name: " " })).toBeNull();
  });
  it("削除すると接続も消える", () => {
    expect(deletePoint(sample(), "wp1").edges).toEqual([]);
  });
  it("接続は切り替わり、自己ループは作らない", () => {
    const d = sample();
    expect(hasEdge(toggleEdge(d, "wp1", "wp2"), "wp1", "wp2")).toBe(false);
    expect(toggleEdge(d, "wp1", "wp1")).toBe(d);
  });
  it("YAML の往復で内容が保たれる", () => {
    const d = sample();
    expect(parseWaypointsYaml(serializeWaypointsYaml(d))).toEqual(d);
  });
  it("theta 省略は null として読む", () => {
    const d = parseWaypointsYaml("waypoints:\n  - {name: a, x: 0, y: 0}\n");
    expect(d.waypoints[0].theta).toBeNull();
    expect(d.edges).toEqual([]);
  });
  it("不正なYAMLはエラー", () => {
    expect(() => parseWaypointsYaml("waypoints: [{name: a}]")).toThrow();
  });
});

describe("setLink", () => {
  const base = () => addPoint(addPoint(emptyWaypoints(), 0, 0).data, 1, 1).data;
  it("片道は1本、両方向は往復の2本になる", () => {
    expect(setLink(base(), "wp1", "wp2", "forward").edges).toEqual([{ from: "wp1", to: "wp2" }]);
    expect(setLink(base(), "wp1", "wp2", "backward").edges).toEqual([{ from: "wp2", to: "wp1" }]);
    expect(setLink(base(), "wp1", "wp2", "both").edges).toEqual([
      { from: "wp1", to: "wp2" },
      { from: "wp2", to: "wp1" },
    ]);
  });
  it("状態を読み取れ、切り替えても重複しない", () => {
    let d = setLink(base(), "wp1", "wp2", "both");
    expect(linkState(d, "wp2", "wp1")).toBe("both");
    d = setLink(d, "wp1", "wp2", "forward");
    expect(d.edges).toHaveLength(1);
    expect(linkState(d, "wp1", "wp2")).toBe("forward");
    expect(linkState(d, "wp2", "wp1")).toBe("backward");
    expect(linkState(setLink(d, "wp1", "wp2", "none"), "wp1", "wp2")).toBe("none");
  });
  it("他のポイントのパスには触らない", () => {
    let d = addPoint(base(), 2, 2).data;
    d = setLink(d, "wp1", "wp3", "forward");
    expect(setLink(d, "wp1", "wp2", "both").edges).toContainEqual({ from: "wp1", to: "wp3" });
  });
});
