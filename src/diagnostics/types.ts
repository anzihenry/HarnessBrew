export interface DoctorFinding { category: "content" | "target" | "dependency" | "ownership" | "state"; code: string; severity: "error" | "warning" | "info"; digest?: string; affectedAssets?: string[]; message: string; asset?: string; operation?: string; resource?: string; actions: string[] }
export interface DoctorReport { healthy: boolean; complete: boolean; findings: DoctorFinding[] }
