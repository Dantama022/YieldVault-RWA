import type { QueryClient } from "@tanstack/react-query";

export const SESSION_STORAGE_KEYS = [
  "sessionToken",
  "accessToken",
  "refreshToken",
  "authToken",
  "walletAddress",
  "yv.auth.token",
  "yv.refresh.token",
  "yv.wallet.address",
] as const;

/**
 * Wallet-session keys cleared on disconnect/expiry. `wallet_session_start` is a
 * versioned envelope (see `lib/versionedStorage`).
 *
 * Deliberately NOT cleared: user preference and one-time-UX keys, which are
 * versioned envelopes that must survive a session — `yieldvault-preferences:*`,
 * `yieldvault:user-preferences:*`, `yv_slippage_percent`, `hasSeenWalkthrough`
 * and `yieldvault:first-deposit:*` (wallet-scoped). The legacy
 * `yv_slippage_bps` key is migrated and removed by `useSlippage`.
 */
export const LOCAL_STORAGE_KEYS = [
  "wallet_session_start",
] as const;

export function clearWalletSessionState(queryClient: Pick<QueryClient, "clear">) {
  queryClient.clear();
  for (const key of SESSION_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  for (const key of LOCAL_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}
