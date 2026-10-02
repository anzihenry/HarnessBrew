export type ErrorCode =
  | "INVALID_ARGUMENT" | "INVALID_STATE" | "UNSUPPORTED_FORMAT"
  | "ASSET_NOT_FOUND" | "AMBIGUOUS_ASSET" | "DEPENDENCY_MISSING" | "DEPENDENCY_CYCLE"
  | "ASSET_CONFLICT" | "VERSION_CONFLICT" | "OWNERSHIP_CONFLICT"
  | "SOURCE_NOT_FOUND" | "SOURCE_MISMATCH" | "SOURCE_REWIND" | "SOURCE_UNTRUSTED"
  | "CONTENT_MODIFIED" | "TARGET_UNSUPPORTED" | "LOCK_MISMATCH" | "ADAPTER_CHANGED"
  | "TARGET_MODIFIED" | "INVALID_PLAN" | "CAPABILITY_DENIED" | "ADAPTER_FAILED"
  | "NOT_MANUAL_ROOT" | "OWNER_NOT_FOUND" | "GIT_FAILED"
  | "ADAPTER_IN_USE" | "PLAN_NOT_FOUND" | "INTERNAL_ERROR" | "SOURCE_IN_USE"
  | "STATE_CORRUPT" | "PLAN_STALE" | "RECOVERY_REQUIRED" | "RECOVERY_CONFLICT" | "LOCK_TIMEOUT";

export class HarnessError extends Error {
  get recovery(): { action: "recover"; preserveEvidence: true } | undefined {
    return this.code === "RECOVERY_REQUIRED" || this.code === "RECOVERY_CONFLICT" ? { action: "recover", preserveEvidence: true } : undefined;
  }
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
