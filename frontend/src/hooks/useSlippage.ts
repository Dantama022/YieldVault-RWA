import { useState, useCallback } from "react";
import { readVersionedItem, writeVersionedItem } from "../lib/versionedStorage";
import {
  SLIPPAGE_DEFAULT_PERCENT,
  SLIPPAGE_HIGH_THRESHOLD_PERCENT,
  SLIPPAGE_MAX_PERCENT,
  SLIPPAGE_MIN_PERCENT,
  clampSlippagePercent,
  isValidSlippagePercent,
} from "../forms/schemas/slippageSchema";

/**
 * Slippage tolerance persistence (percent).
 *
 * The old key `yv_slippage_bps` was misnamed — it always stored percent values
 * (e.g. 0.5 = 0.5%), never basis points. It is superseded by
 * `yv_slippage_percent`; values saved under the legacy key are migrated on the
 * first read.
 */
const STORAGE_KEY = "yv_slippage_percent";
const LEGACY_STORAGE_KEY = "yv_slippage_bps";
const PRESETS = [0.1, 0.5, 1] as const;

const STORAGE_VERSION = 1;

function toValidSlippage(value: unknown): number | null {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && isValidSlippagePercent(n) ? n : null;
}

function readStored(): number {
  try {
    const stored = readVersionedItem<number>(STORAGE_KEY, {
      version: STORAGE_VERSION,
      parseData: toValidSlippage,
      // Pre-envelope format: the percent as a bare number string.
      migrateLegacy: toValidSlippage,
    });
    if (stored !== null) return stored;
    if (localStorage.getItem(STORAGE_KEY) !== null) return SLIPPAGE_DEFAULT_PERCENT;

    // Migrate any value saved under the old (misnamed) key.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      const legacyValue = toValidSlippage(legacy);
      if (legacyValue !== null) {
        writeVersionedItem(STORAGE_KEY, STORAGE_VERSION, legacyValue);
        return legacyValue;
      }
    }
    return SLIPPAGE_DEFAULT_PERCENT;
  } catch {
    return SLIPPAGE_DEFAULT_PERCENT;
  }
}

export function useSlippage() {
  const [slippage, setSlippageState] = useState<number>(readStored);

  /**
   * Update the slippage tolerance (percent). Out-of-range values are clamped
   * into [SLIPPAGE_MIN_PERCENT, SLIPPAGE_MAX_PERCENT] before being stored.
   */
  const setSlippage = useCallback((value: number) => {
    const bounded = clampSlippagePercent(value);
    setSlippageState(bounded);
    writeVersionedItem(STORAGE_KEY, STORAGE_VERSION, bounded);
  }, []);

  const minReceived = useCallback(
    (amount: number) => Math.max(amount * (1 - slippage / 100), 0),
    [slippage],
  );

  return {
    slippage,
    setSlippage,
    presets: PRESETS,
    isHighSlippage: slippage > SLIPPAGE_HIGH_THRESHOLD_PERCENT,
    minReceived,
    /** Lower bound of the accepted slippage range (percent). */
    minPercent: SLIPPAGE_MIN_PERCENT,
    /** Upper bound of the accepted slippage range (percent). */
    maxPercent: SLIPPAGE_MAX_PERCENT,
  };
}
