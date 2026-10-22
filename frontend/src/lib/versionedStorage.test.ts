import { describe, it, expect, beforeEach } from "vitest";
import { readVersionedItem, writeVersionedItem } from "./versionedStorage";

const opts = {
  version: 2,
  parseData: (d: unknown) => (typeof d === "number" ? d : null),
  migrateLegacy: (l: unknown) => (typeof l === "string" ? Number(l) : null),
};

describe("versionedStorage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips an envelope", () => {
    writeVersionedItem("k", 2, 7);
    expect(localStorage.getItem("k")).toBe('{"version":2,"data":7}');
    expect(readVersionedItem("k", opts)).toBe(7);
  });

  it("returns null when missing", () => {
    expect(readVersionedItem("k", opts)).toBeNull();
  });

  it("migrates a legacy raw value and rewrites it as an envelope", () => {
    localStorage.setItem("k", "5");
    expect(readVersionedItem("k", { ...opts, migrateLegacy: (l) => Number(l) })).toBe(5);
    expect(localStorage.getItem("k")).toBe('{"version":2,"data":5}');
  });

  it("migrates a legacy non-JSON string", () => {
    localStorage.setItem("k", "abc");
    expect(
      readVersionedItem("k", { ...opts, migrateLegacy: (l) => (l === "abc" ? 1 : null) }),
    ).toBe(1);
  });

  it("does not rewrite when legacy migration fails", () => {
    localStorage.setItem("k", "{}");
    expect(readVersionedItem("k", { ...opts, migrateLegacy: () => null })).toBeNull();
    expect(localStorage.getItem("k")).toBe("{}");
  });

  it("ignores envelopes from another version", () => {
    localStorage.setItem("k", '{"version":9,"data":1}');
    expect(readVersionedItem("k", opts)).toBeNull();
  });
});
