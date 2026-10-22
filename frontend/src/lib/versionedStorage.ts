/**
 * Versioned localStorage envelope: `{ "version": <n>, "data": <payload> }`.
 *
 * Values written before versioning existed (raw strings, bare JSON) are
 * detected on read, passed to a caller-supplied `migrateLegacy`, and rewritten
 * as an envelope so future shape changes can be migrated explicitly.
 */

export interface VersionedEnvelope<T> {
  version: number;
  data: T;
}

export interface ReadVersionedOptions<T> {
  /** Current schema version of the stored payload. */
  version: number;
  /** Validate/normalise a payload stored at the current version; null = invalid. */
  parseData: (data: unknown) => T | null;
  /** Convert a pre-envelope value (parsed JSON, or the raw string) to `T`; null = unusable. */
  migrateLegacy: (legacy: unknown) => T | null;
}

export function isVersionedEnvelope(value: unknown): value is VersionedEnvelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { version?: unknown }).version === "number" &&
    "data" in value
  );
}

export function writeVersionedItem<T>(key: string, version: number, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version, data } satisfies VersionedEnvelope<T>));
  } catch {
    // storage quota exceeded or unavailable — callers keep in-memory state
  }
}

export function readVersionedItem<T>(key: string, options: ReadVersionedOptions<T>): T | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }

  if (isVersionedEnvelope(parsed)) {
    // Envelopes from a different version cannot be interpreted safely.
    return parsed.version === options.version ? options.parseData(parsed.data) : null;
  }

  const migrated = options.migrateLegacy(parsed);
  if (migrated !== null) writeVersionedItem(key, options.version, migrated);
  return migrated;
}
