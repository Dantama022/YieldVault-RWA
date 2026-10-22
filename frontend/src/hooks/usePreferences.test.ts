import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePreferences } from "./usePreferences";

const KEY = "yieldvault-preferences:GABC";

describe("usePreferences storage", () => {
  beforeEach(() => localStorage.clear());

  it("migrates the legacy unversioned object into a v1 envelope", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ theme: "dark", notifications: { priceAlerts: true } }),
    );

    const { result } = renderHook(() => usePreferences("GABC"));

    expect(result.current.preferences.theme).toBe("dark");
    expect(result.current.preferences.notifications.priceAlerts).toBe(true);
    expect(result.current.preferences.notifications.depositAlerts).toBe(true);
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.version).toBe(1);
    expect(stored.data.theme).toBe("dark");
  });

  it("writes updates as a versioned envelope", () => {
    const { result } = renderHook(() => usePreferences("GABC"));
    act(() => result.current.setTheme("light"));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      version: 1,
      data: { theme: "light" },
    });
  });

  it("falls back to defaults for corrupt or unknown-version data", () => {
    localStorage.setItem(KEY, "not json");
    expect(renderHook(() => usePreferences("GABC")).result.current.preferences.theme).toBe(
      "system",
    );
    localStorage.setItem(KEY, JSON.stringify({ version: 99, data: { theme: "dark" } }));
    expect(renderHook(() => usePreferences("GABC")).result.current.preferences.theme).toBe(
      "system",
    );
  });
});
