# Release Verification Runbook

## One-time prerequisites

Production releases use **Publish approved npm candidate** (`.github/workflows/release.yml`). Dispatch it from `main` once; after automated verification there is one `npm-production` approval. No candidate run ID, report upload, or manual tag creation is required.

Before enabling the workflow:

1. Configure **required reviewers** on the GitHub `npm-production` environment. Naming an environment alone does not require approval. Choose reviewers explicitly; never remove the approval rule to get a run through. Restrict deployments to `main` and disable administrator bypass where available.
2. Provision a dedicated, preferably ephemeral runner with labels `self-hosted` and `harnessbrew-runtime`. It must support the repository's checkout/upload Actions versions, Node 22, npm 11.17.0, Git, and the authenticated CLI used by the existing runtime preflight. Pin and review the CLI version on this runner.
3. This runner executes reviewed code from protected `main` only. Do not let fork/PR jobs or unrelated repositories use it. Restrict its runner group to this release workflow where supported; protect changes to release workflows and scripts with repository review rules. A label is a routing selector, not an isolation boundary.
4. Keep runtime credentials local to that dedicated runner, outside its checkout. Never upload authentication files, copy a developer's personal home into CI, or provision npm publishing credentials on the runtime runner. Use a separate runner account/environment with no personal files and rebuild it between runs.
5. Configure npm trusted publishing for this repository's `release.yml` workflow and the `npm-production` environment. The GitHub-hosted publish job requests OIDC only after approval.
6. After validating the runner and authentication, set repository variable `HARNESSBREW_RUNTIME_READY=true`. This is an explicit operator readiness declaration, not an online-health check. An unavailable runner leaves the runtime job queued; authentication errors fail the probes.

The readiness job checks the actual required-reviewer rule and the readiness declaration before building. The publish job checks the reviewer rule again. GitHub, not a JSON field in a report, enforces the approval.

## Prepare and trigger

Update package/lock/source versions, changelog and release notes. Commit the reviewed release source to `main`. The version must be new; do not republish 0.7.1 with modified bytes.

Run **Publish approved npm candidate**, selecting `main`. The dispatch commit is immutable for the entire run; later pushes do not change it.

The workflow then:

1. Calls the reusable **Release candidate** workflow for the exact dispatch SHA. It validates source and builds one candidate.
2. Runs deterministic `release:gate` jobs on Linux and macOS using that same candidate.
3. Only after **both** jobs succeed, runs authenticated Codex skill/instruction/agent/MCP probes on the dedicated runner.
4. Downloads the candidate and all three reports from the **same workflow run**, checks their identity and completeness, and uploads an approved evidence bundle.
5. Waits for the single `npm-production` approval.
6. Revalidates the approved bundle, creates or verifies an immutable tag, creates a draft Release and uploads/verifies six attachments.
7. Publishes the exact tarball with npm provenance, runs the registry smoke test, rechecks all attachments, then makes the Release public.

There is no externally supplied candidate run ID to accidentally reference a failed or unrelated run. Job dependencies require the complete reusable candidate workflow and runtime job to succeed. All downloads refer to outputs of those jobs; there is no "latest artifact" lookup.

## Machine-checked evidence

The verifier rejects missing reports, unknown schemas, dirty source, wrong source SHA/version/filename/digest, missing or duplicate probes, skipped/failed probes, invalid timestamps, and evidence older than 72 hours (with five minutes of clock-skew tolerance). Deterministic reports must include artifact, package-smoke, and packaged-e2e checks for the correct platforms.

The runtime report must contain exactly four passing Codex probes, CLI version, observed markers and required events. MCP also records that the local fixture actually received the tool call. A top-level `passed` is not sufficient.

Report integrity is rooted in the trusted workflow/runner and same-run Actions artifacts, not in self-authentication of JSON. A malicious runner or administrator remains outside this guarantee. Do not accept manually uploaded reports as a substitute.

## Approval and public attachments

Review the run's successful jobs and approved evidence bundle, then approve the protected deployment. The public Release contains:

- the exact npm `.tgz`
- `artifact-manifest.json`
- `SHA256SUMS`
- `release-gate-linux.json`
- `release-gate-macos.json`
- `runtime-report.json`

Uploads are downloaded again and hash-checked. Missing attachments prevent finalization; existing assets with different bytes are never overwritten. The release starts as a draft so a smoke-test failure does not announce a successful release.

## Failure recovery

- Before publication: fix source defects and create a new reviewed release commit. For transient failures, use **Re-run failed jobs** so successful candidate outputs are reused.
- Artifact names bind the run ID and build attempt. A rerun of the entire workflow creates a new candidate; never use it to overwrite an already approved/published version with different bytes.
- If npm accepted the version but smoke testing/finalization failed, rerun the failed publish job. It checks the registry tarball SHA-256 and skips publication only when the bytes match. Network/permission errors are not treated as "version absent".
- Existing tags must resolve to the candidate commit. Existing assets must match local bytes. A conflict fails closed and needs investigation, not `--force` or an overwrite.
- If the approved evidence exceeds 72 hours or Actions artifacts expire, stop and prepare a new release with fresh evidence; do not bypass the verifier.
- A new publish-job attempt may require approval again. "One approval" describes the normal successful path, not a reusable approval for arbitrary retries.
- npm and GitHub are not an atomic transaction. If npm succeeds but a later step fails, the npm version remains public; recovery completes the draft Release rather than pretending to roll npm back.

Standalone **Release candidate** dispatch and local `release:preflight` remain useful diagnostics, but their reports do not bypass the automated production gate. Historical Release attachments are not backfilled by this workflow.
