export type ErrorCode =
  | "INVALID_ARGUMENT" | "INVALID_STATE" | "UNSUPPORTED_FORMAT"
  | "ASSET_NOT_FOUND" | "AMBIGUOUS_ASSET" | "DEPENDENCY_MISSING" | "DEPENDENCY_CYCLE"
  | "ASSET_CONFLICT" | "VERSION_CONFLICT" | "OWNERSHIP_CONFLICT"
  | "STATE_CORRUPT" | "PLAN_STALE" | "RECOVERY_REQUIRED" | "LOCK_TIMEOUT";

export class HarnessError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "HarnessError";
  }
}
