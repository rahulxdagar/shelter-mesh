import type { PostgrestError } from "@supabase/supabase-js";

export type RpcErrorCode =
  | "OUT_OF_STOCK"
  | "FACILITY_CLOSED"
  | "HOLD_EXPIRED"
  | "HOLD_NOT_ACTIVE"
  | "HOLD_NOT_EXPIRED"
  | "ALREADY_REHELD"
  | "NO_MATCH"
  | "OUT_OF_RANGE"
  | "INCIDENT_CLOSED"
  | "FROST_INACTIVE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NETWORK"
  | "UNKNOWN";

export class RpcError extends Error {
  constructor(
    public code: RpcErrorCode,
    public detail: string,
  ) {
    super(detail || code);
  }
}

const KNOWN = new Set<string>([
  "OUT_OF_STOCK", "FACILITY_CLOSED", "HOLD_EXPIRED", "HOLD_NOT_ACTIVE", "HOLD_NOT_EXPIRED",
  "ALREADY_REHELD", "NO_MATCH", "OUT_OF_RANGE", "INCIDENT_CLOSED", "FROST_INACTIVE", "FORBIDDEN", "NOT_FOUND",
]);

export function toRpcError(err: PostgrestError | Error | unknown): RpcError {
  if (err instanceof RpcError) return err;
  const e = err as Partial<PostgrestError> & { message?: string };
  const message = e?.message ?? "";
  if (KNOWN.has(message)) return new RpcError(message as RpcErrorCode, e.details ?? message);
  if (/fetch|network|Failed to fetch|Load failed/i.test(message)) {
    return new RpcError("NETWORK", "No connection to the Cold-Grid network.");
  }
  return new RpcError("UNKNOWN", e?.details || message || "Something went wrong.");
}

/** Calls a Postgres function and throws a typed RpcError on failure. */
export async function rpc<T>(
  call: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<T> {
  let res: { data: T | null; error: PostgrestError | null };
  try {
    res = await call;
  } catch (err) {
    throw toRpcError(err);
  }
  if (res.error) throw toRpcError(res.error);
  return res.data as T;
}
