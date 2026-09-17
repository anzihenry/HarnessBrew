export async function github(route, { method = "GET", body, accept = "application/vnd.github+json", allow404 = false } = {}) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${route}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: accept, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000)
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} ${route}: HTTP ${response.status}`);
  return accept === "application/octet-stream" ? Buffer.from(await response.arrayBuffer()) : response.json();
}

export function assertApproval(environment) {
  if (!environment?.protection_rules?.some((rule) => rule.type === "required_reviewers" && rule.reviewers?.length > 0)) {
    throw new Error("npm-production must have at least one required reviewer; refusing an unapproved publication.");
  }
}
