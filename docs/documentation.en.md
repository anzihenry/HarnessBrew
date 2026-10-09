---
title: Project Documentation Standard
status: current
owner: project-maintainers
updated: 2026-10-09
owners:
  - project-maintainers
reviewIntervalDays: 90
---

# Project Documentation Standard

[中文主版本](documentation.md)

Standard version: 1.0. Covers repository documentation and associated research, product, design, engineering, project management, release, and operations documentation.

“Must” defines a delivery requirement; “should” defines a default practice that may be adapted; “may” defines an option. Projects may reduce directory and file splitting according to scale, but mandatory delivery requirements still apply. This project follows the standard. See the [initiative entry](initiatives/process/documentation-standard/README.en.md) for the HarnessBrew assessment.

## 1. Principles

- Maintained reference documents describe current knowledge, rules, and procedures. Initiative documents record requirements, design, execution, and outcomes for one body of work. Release records describe delivery facts for a version.
- Each authoritative definition, task status, and original evidence item must have one maintenance location. Other documents link to it; summaries must agree with authoritative definitions.
- Initiative delivery must update affected maintained documents. Historical records retain their original context and must not be mistaken for current instructions.
- Every maintained document must have an owner. Delivery checks are the primary gate; periodic review supplements them.

## 2. Directory structure

```text
README.md / README.en.md
CHANGELOG.md / CHANGELOG.en.md
docs/
├── README.md / README.en.md
├── documentation.md / documentation.en.md
├── research/
├── product/
├── design/
├── engineering/
│   └── decisions/
├── guides/
├── planning/
├── initiatives/
│   ├── feature/
│   ├── improvement/
│   ├── refactor/
│   ├── research/
│   └── process/
└── releases/
```

Create directories only when they contain real content. Each domain directory must have bilingual README entries. Add entries to other subdirectories when navigation needs them. Establish a numbered decision index; every initiative must have bilingual entries.

| Location | Responsibility |
| --- | --- |
| Root README | Purpose, core capabilities, prerequisites, shortest working example, documentation entry, and license; link detailed instructions in guides |
| Root CHANGELOG | Version summaries of additions, changes, fixes, and breaking changes; link detailed release records; use current status |
| docs/README | Documentation map and reading paths by reader need |
| research | Research knowledge reusable across the product and multiple initiatives; state dates, sources, methodological limitations, and applicability |
| product | Current positioning, audiences, capabilities, business rules, and success metrics; change-specific requirements belong in initiatives |
| design | Current user journeys, information architecture, interaction patterns, visual standards, and design system |
| engineering | Current architecture, module boundaries, data models, interface contracts, security/performance constraints, and technical decisions |
| guides | Repeatable instructions for use, development, testing, deployment, operations, troubleshooting, and release procedures |
| planning | Cross-initiative roadmaps, priorities, milestones, dependencies, resource allocation, overall risks, and collaboration rules |
| initiatives | The process from goal to delivery for a specific body of work; associated research materials and design process stay with the initiative |
| releases | Content, status, compatibility, acceptance, and publication evidence for a version or explicit release event |

Research itself may be an initiative. Extract reusable findings into research and link the original materials. Historical research reports support findings only for their stated time, sample, and questions.

## 3. Initiatives

Create an initiative for work with a clear goal and completion criteria that needs multiple kinds of information or a traceable process. An initiative may span versions and phases. Small fixes and copy edits may be recorded in Issues/PRs while updating affected documents.

| Category | Primary goal |
| --- | --- |
| feature | Add or extend product capabilities |
| improvement | Improve existing experience, performance, or reliability |
| refactor | Improve internal structure and maintainability |
| research | Conduct focused investigation, experiments, or exploration |
| process | Improve development, collaboration, delivery, or operations workflows |

Choose one category based on the primary goal; record other attributes in the entry. Use a stable subject name, such as `initiatives/feature/adapter-upgrade/`, rather than an owner, status, or implementation phase.

```text
initiatives/feature/adapter-upgrade/
├── README.md / README.en.md       Required: entry
├── requirements.md / .en.md      Optional: requirements and acceptance criteria
├── research.md / .en.md          Optional: questions, methods, and findings
├── design.md / .en.md            Optional: solution and decisions
├── plan.md / .en.md              Optional: tasks, dependencies, progress, risks
├── validation.md / .en.md        Optional: validation and delivery checks
├── assets/                      Optional: images, diagrams, attachments
└── evidence/                    Optional: reports, data, artifact digests
```

A small initiative may combine everything in README; a complex design may split into `experience-design.md` and `technical-design.md`. Initiative plans manage execution; planning manages cross-initiative coordination. With an external task tool, documents retain goals, milestones, and links while the tool owns task status. Otherwise, maintain tasks in the initiative plan. Declare the sole maintenance location.

## 4. Status and lifecycle

| Document type | Allowed statuses |
| --- | --- |
| Maintained reference | draft: not effective; current: currently valid; superseded: replaced or no longer applicable |
| Initiative | proposed: under assessment; active: underway; paused: suspended; completed: criteria met; cancelled: terminated |
| Release | planned: planned; verified: specific candidate accepted; released: officially published; cancelled: publication terminated; withdrawn: published version withdrawn |

Split initiative files follow initiative status by default; translations keep the same status. Historical content states its applicable time through context. Navigation documents and this standard use maintained-reference statuses. Release subdocuments follow their release; entries manage raw materials and generated reports.

Paused initiatives must state reasons and resumption conditions. Cancelled ones record reasons and disposition of existing work. Completed ones must record acceptance evidence, remaining work, updates to Chinese and English maintained documents, and independent review. Move follow-up work into linked tasks or initiatives. Initiative completion and official publication are separate facts.

Archive through status and indexes, keeping paths stable. Current navigation prioritizes current documents. Superseded documents must state the reason and link their replacement at the beginning; explicitly state when there is no replacement. Correct factual errors in historical records with a correction note; record subsequent behavior changes in new initiatives and maintained documents.

Verified must identify the candidate artifact and commit; changed artifacts require renewed acceptance. Released must record official publication time, artifact identity, publication address, and evidence. Withdrawn records reasons and guidance. A repository version alone does not prove publication.

## 5. Naming, metadata, and languages

Directories and filenames must use lowercase English with hyphens. Entries use `README.md`; root `CHANGELOG.md` is also a conventional exception. Initiatives use subject names; releases should use a path such as `releases/1.3.0/`. Repeated records may use dates, for example `interviews/2026-10-09-developer-a.md`.

Every formally maintained Markdown document must have YAML metadata:

```yaml
---
title: Adapter Upgrade
status: active
owner: team-platform
updated: 2026-10-09
---
```

Title names the document. Status must be valid for its type. Owner must identify a person or team defined in project configuration. Updated uses `YYYY-MM-DD` and means the last substantive update or validity review; formatting alone does not refresh it. Versions, applicability, and replacement relationships may be additional fields or prose.

Chinese is the default primary language. Formally maintained documents must have English translations; other languages are optional. Chinese uses the standard filename, English `.en.md`, and other languages an agreed identifier such as `.ja.md`. Versions link to each other; translations identify the Chinese primary version. English owner/status match Chinese, title is translated, and updated records the actual update or review of that language.

Maintained references, initiative entries and split files, and release notes require both languages. Original interviews, logs, and generated reports keep their original language with a bilingual entry or summary. Mark translations that lag during ongoing work; they must be synchronized before delivery. A notice does not replace the update.

## 6. Required content and templates

Required content is standardized; section order and file splitting are flexible. Explain inapplicable items. Combined documents must still cover applicable content.

| Type | Required content |
| --- | --- |
| Maintained reference | Current rules or facts, applicability, references |
| Initiative entry | Goal, scope, status, owner, completion criteria, document navigation |
| Requirements | User problem, intended outcomes, scope/non-goals, acceptance criteria |
| Research | Questions, methods/sample, findings, limitations, sources |
| Design | Background/constraints, solution, key decisions, risks, validation method |
| Plan | Tasks, dependencies, owners, progress, risks, completion criteria |
| Validation | Acceptance results, evidence, remaining issues, delivery documentation check, independent review conclusion |
| Release | Version/status, delivered changes, compatibility, artifact identity, acceptance/publication evidence; mark steps not yet performed |
| Technical decision | Context, alternatives, decision/reasons, consequences, replacement relationships |

Long-lasting decisions about technology, boundaries, formats, or compatibility must be recorded in `engineering/decisions/` with stable numbers such as `0001-preparation-boundary.md`. Translations share the number. Draft decisions use draft; adopted and valid ones use current. Changed decisions get a new record; mark the old one superseded and link the new one. Local implementation details may remain in initiative designs.

## 7. Navigation, references, assets, and evidence

Root README provides quick start and the main entry; docs/README provides reading paths; domain READMEs describe scope and current content; initiatives/README lists initiatives by category/status; releases/README lists versions/status. Index titles and statuses must agree with source metadata and cannot be a separate source of facts. Reading order and purpose are maintained by people; tools may generate or validate indexes.

Repository links must be relative, with section anchors where useful. Chinese links prefer Chinese documents; English links prefer English. Label untranslated originals by language. Update references when moving files; checks must validate files and applicable section anchors. Historical evidence states the version or commit it supports.

Assets holds explanatory images, diagrams, and attachments; evidence holds reports, measurements, and artifact digests, stored beside their owning documents. Initiative evidence belongs to initiatives; version evidence belongs to releases. Store shared evidence once. Entries or validation documents must explain purpose, generation method, and commit/artifact identity. Large or unsuitable repository materials may live externally with accessible addresses and necessary identity information.

## 8. Mandatory delivery checks

Documentation checks are the primary maintenance mechanism. Failure blocks merging, marking an initiative completed, and marking a release released. Record ordinary checks in PRs, initiative checks in validation (or README when combined), and link them from release records to avoid duplicated maintenance.

The delivery owner must explicitly assess impacts on research, product, design, engineering, guides, planning, initiatives, releases, root entry/CHANGELOG, and evidence. For each item record “updated,” “reviewed; no update needed,” or “not applicable.” Explain the last two.

### 8.1 Unified check record

```text
Delivery: change/initiative/version, PR, commit or workspace content identity
Owner:
Impact list: domain/document | disposition | reason and bilingual links
Automated checks: command/CI | result | content identity | logs
Content review: actual behavior, complete impact, contracts, recovery/compatibility
Translation review: equivalent meaning, synchronized examples and limitations
Example validation: relevant commands/examples, environment, results; explain N/A
Acceptance evidence: version/commit/artifact and links
Remaining issues: impact assessment, follow-up task and owner
Independent review: identity, files/evidence read, findings, fixes and recheck
Conclusion: pass/fail | reviewer | date | reviewed content identity
```

### 8.2 Responsibilities

- Automated checks must cover required metadata, type-specific status, naming, local links, bilingual pairs, and index consistency as required CI checks.
- Content review must verify actual behavior, complete impact assessment, translation meaning, and validation of relevant examples. File existence does not prove translation synchronization.
- The delivery owner updates documents and supplies the checklist/evidence. The independent reviewer cannot be the author or editor of these changes.
- Humans or independent AI agents may review using the same checklist. AI must independently read relevant implementation, documentation, and evidence, rather than rely on the author's summary. Record identity, actual scope read, commit, findings, and recheck results.
- Checks and review must bind to a specific commit. An uncommitted draft may bind to a base commit and reviewed file digests; formal delivery must map it to the delivery commit. Subsequent relevant edits require renewed checks/review of affected parts.

Passing requires a complete impact list, all required checks passing, synchronized languages, and no missing documentation or evidence required for this delivery. Unrelated existing issues may be tracked separately with reasons they do not affect delivery. Missing translations or noncompliant affected old documents cannot be dismissed as unrelated.

| Gate | Required confirmation |
| --- | --- |
| Merge | Change impact, automated checks, content/translation checks, independent review |
| Initiative completion | Acceptance, maintained-document updates, both languages, remaining work, check record |
| Official publication | Release notes, compatibility/upgrade guides, delivery checks, candidate and publication evidence |

Reuse checks only when their commit, artifacts, and scope apply. Owners periodically review maintained documents and update updated. Flag overdue documents for review using project intervals; age alone does not make a document superseded.

## 9. Project configuration and migration

Each project must configure domain owners, sole task-management location, automated commands/CI gates, independent review and record location, review intervals, and external material systems in this document. Use confirmed actual values; mark unconfigured items and do not claim gates are installed.

Migrate existing projects by establishing indexes/inventory; assigning locations, statuses, and owners and correcting current contradictions; moving paths and adding metadata/translations in batches; installing automated checks; and obtaining independent acceptance.

New changes immediately follow complete delivery requirements and bring affected old documents into compliance. Assign owners and completion criteria to other gaps. Do not claim repository-wide compliance before migration is complete.

### HarnessBrew project configuration

| Setting | Execution |
| --- | --- |
| Standard | 1.0, applies to this and subsequent deliveries; see initiative validation for migration results |
| Domain owners | project-maintainers: HarnessBrew repository maintainers, responsible for populated domains |
| Tasks | Each initiative README is its sole task-status source; planning manages cross-initiative milestones |
| Automated checks | npm run check:docs included in npm run check; CI documentation job runs test:docs and check:docs |
| Independent review | Independent human or AI; evidence/validation binds conclusions to files; current migration record is independent-review.json |
| Review interval | Review current documents every 90 days; delivery checks take priority; flag overdue items, not automatic invalidity |
| External materials | Redacted reports/digests in repository; large candidates in ignored release-artifacts or protected Actions artifacts |

The approval binds maintained root/docs documents, source and delivery-tool identities. Relevant changes invalidate old conclusions under default check:docs. Authors may run `npm run check:docs -- --structure-only` for preparation, never as delivery approval. A new delivery links its independent conclusion from the active initiative and updates the approval record read by the repository checker (path in script). Structural tooling cannot establish semantic correctness or reviewer independence; review must actually occur.

CI is configured in the repository. GitHub branch protection/required status checks are external administrator settings not changed here; local configuration does not prove remote protection is enabled. Formal merges must make the corresponding checks required.

Replace these project-specific settings when applying elsewhere, retaining mandatory requirements. The [migration initiative](initiatives/process/documentation-standard/README.en.md) records inventory, validation and limitations.
