export type ErrorCode =
  | "INVALID_ARGUMENT" | "INVALID_STATE" | "UNSUPPORTED_FORMAT"
  | "ASSET_NOT_FOUND" | "AMBIGUOUS_ASSET" | "DEPENDENCY_MISSING" | "DEPENDENCY_CYCLE"
  | "ASSET_CONFLICT" | "VERSION_CONFLICT" | "OWNERSHIP_CONFLICT"
  | "SOURCE_NOT_FOUND" | "SOURCE_MISMATCH" | "SOURCE_REWIND" | "SOURCE_UNTRUSTED"
  | "CONTENT_MODIFIED" | "TARGET_UNSUPPORTED" | "LOCK_MISMATCH" | "ADAPTER_CHANGED"
  | "NOT_MANUAL_ROOT" | "OWNER_NOT_FOUND" | "GIT_FAILED"
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
