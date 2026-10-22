import { describe, it, expect, vi, beforeEach } from "vitest";
import { getWalletSessionStart, startWalletSession } from "./walletSession";
import { clearWalletSessionState, SESSION_STORAGE_KEYS, LOCAL_STORAGE_KEYS } from "./sessionCleanup";

describe("clearWalletSessionState", () => {
  const queryClient = {
    clear: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("clears react-query cache and removes known session keys", () => {
    localStorage.setItem("sessionToken", "token-1");
    localStorage.setItem("accessToken", "token-2");
    localStorage.setItem("wallet_session_start", "1234567890");
    localStorage.setItem("yieldvault.preferences", "{\"theme\":\"dark\"}");

    clearWalletSessionState(queryClient);

    expect(queryClient.clear).toHaveBeenCalledTimes(1);

    for (const key of SESSION_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    for (const key of LOCAL_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    // Non-session preference data should remain untouched.
    expect(localStorage.getItem("yieldvault.preferences")).toBe(
      "{\"theme\":\"dark\"}",
    );
  });

  it("clears the versioned wallet_session_start envelope and the legacy raw value", () => {
    startWalletSession(1234567890);
    expect(getWalletSessionStart()).toBe(1234567890);
    clearWalletSessionState(queryClient);
    expect(localStorage.getItem("wallet_session_start")).toBeNull();

    localStorage.setItem("wallet_session_start", "1234567890");
    clearWalletSessionState(queryClient);
    expect(localStorage.getItem("wallet_session_start")).toBeNull();
  });

  it("keeps versioned preference and one-time-UX keys across cleanup", () => {
    const kept: Record<string, string> = {
      "yieldvault-preferences:guest": '{"version":1,"data":{}}',
      "yieldvault:user-preferences:guest": '{"version":1,"data":{}}',
      yv_slippage_percent: '{"version":1,"data":0.5}',
      hasSeenWalkthrough: '{"version":1,"data":true}',
      "yieldvault:first-deposit:GABC": '{"version":1,"data":true}',
    };
    for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v);

    clearWalletSessionState(queryClient);

    for (const [k, v] of Object.entries(kept)) expect(localStorage.getItem(k)).toBe(v);
  });
});
