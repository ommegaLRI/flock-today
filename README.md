# Flock

Flock is an open-source system for migrating simple marketing pages into portable React campaign sites, then letting the generated site carry its own private editing, feedback, patching, history, and publishing workflow.

## Current architecture

```text
Private migration endpoint
  → MigrationBootstrap
  → open-source Flock ingestion
  → FlockProject
  → install plan + file tree
  → portable React campaign bundle
  → private capsule / review runtime / deploy handoff
```

The private migration endpoint can be smart: crawling, screenshots, asset extraction, model-heavy interpretation, and high-fidelity normalization. The open-source project owns the durable handoff after that point. The handoff artifact is an open `MigrationBootstrap`, so users are not locked into a hosted Flock workspace.

## Phase progression

1. **Spec-first round trip** — `ChangePin → PatchPlan → CampaignPageSpec → regenerated files`.
2. **No-backend capsule loop** — generated pages can create local review pins and preview safe patches.
3. **Owner spec editing** — direct owner edits validate against the contract and regenerate output.
4. **Portable publish bundle** — production/review/owner build profiles and provider-ready handoff plans.
5. **Capture-to-contract normalization** — simple HTML/capture inputs become a canonical campaign spec and migration report.
6. **Contract-constrained inference** — models propose structured `SpecOperation[]`; the kernel validates every operation.
7. **Project state and provenance** — user-owned event log, snapshots, undo foundation, and bundle provenance.
8. **User-owned feedback transport** — portable feedback bundles via download, email, GitHub issue URL, or user-owned POST endpoint.
9. **Migration bootstrap ingestion** — private migration returns an open bootstrap payload; open-source Flock validates, ingests, and compiles it.
10. **Bootstrap-to-site installer** — a bootstrap becomes a complete `FlockProject` with a root folder, manifest, install plan, file roles, next actions, and portable project files.
11. **Real export artifact** — a `FlockProject` becomes a concrete, profile-aware `ExportArtifact` with file inclusion, privacy summary, validation, receipt, and download-ready metadata.

## Core loop

```text
Capture / private migration
→ MigrationBootstrap
→ validate + ingest
→ FlockProjectState
→ FlockProject install plan
→ CampaignPageSpec
→ profile-aware portable bundle
→ concrete ExportArtifact
→ capsule-owned feedback/edit/history/publish workflow
```

## Package map

- `packages/contract` — shared schemas and vocabulary: specs, pins, project state, feedback bundles, bootstrap payloads, project manifests, install plans.
- `packages/compiler` — spec-first compiler, bootstrap ingestion, React campaign generation, bundle creation, project installation planning.
- `packages/kernel` — safety, spec operations, project-state reducers, provenance, feedback import, bootstrap ownership checks.
- `packages/capsule` — review runtime and private workbench assets bundled into generated sites.
- `packages/adapters` — inference providers, deploy handoff plans, feedback transport handoffs, bootstrap import/download plans.

## The important boundary

The migration endpoint may be private, but its output is not. `MigrationBootstrap` is an open handoff artifact containing the design-contract version, brand spec, campaign page spec, content strategy, migration report, assets, integrations, source provenance, warnings, and recommended build profile.

From that point forward, the generated site/repo owns the workflow. Flock does not need to host project state, feedback, previews, or publishing.

## Phase 10 install boundary

`MigrationBootstrap` is the portable handoff from the private migration endpoint. `FlockProject` is the installed, user-owned result. It answers:

- which root directory should be written,
- which files are canonical versus generated,
- which files are public, private, or capsule assets,
- which build profile is active,
- which warnings must be reviewed, and
- what the owner should do next.

The installer still does not create a zip, GitHub repo, or provider deployment. It produces a complete file tree and install plan so those actions can be implemented cleanly in later phases.


## Phase 11 export artifact boundary

`FlockProject` is now exportable as a concrete `ExportArtifact`. An export artifact is still user-owned and provider-neutral, but it is more than a plan: it contains the included files, byte counts, privacy summary, validation result, receipt, download filename, and next actions.

Export profiles make privacy explicit:

- **production** exports public/generated site files and excludes owner workbench, review runtime, project state, event history, and migration bootstrap by default.
- **review** exports comment-only review runtime while excluding owner patching/publishing tools and private history.
- **owner** exports the full capsule and private state for a user-owned/private workflow.
- **source** exports the full portable project source, including canonical state and migration provenance.

The export layer still does not call provider APIs, create GitHub repos, or host files. It creates the artifact that later deploy adapters can consume safely.

## Phase 12 deploy package boundary

`ExportArtifact` can now be converted into a concrete `DeployPackage`. A deploy package is provider-specific, but it is still only a handoff artifact: it contains provider-ready files, commands, readiness warnings, manual steps, and environment notes. It never calls a hosting API, creates a provider project, stores credentials, or configures DNS.

The first concrete targets are:

- **Cloudflare Pages** — recommended default for static campaign sites. The package includes build command `npm run build`, output directory `dist`, provider handoff metadata, manual setup steps, and privacy/readiness warnings.
- **Manual static** — portable fallback for any static host. The package explains how to build locally and upload `dist` to a user-owned host.

The lifecycle is now:

```text
Private migration endpoint
→ MigrationBootstrap
→ FlockProject
→ ExportArtifact
→ DeployPackage
→ user-owned hosting account
```

The deploy package makes hosting practical without turning Flock into a host. Real provider API deployment, GitHub repo creation, OAuth, domains, and build logs remain later phases.

## Phase 13 capability-gated capsule access

The capsule now has an explicit capability model. URL parameters can reveal review UI, but they are never authority for owner actions.

Build profiles map to capabilities:

- **production**: visitor-only. No review runtime, no owner workbench, no patch/export/deploy controls.
- **review**: comment-only. Reviewers can create pins and export feedback bundles, but cannot edit specs, apply patches, import feedback, export owner bundles, or create deploy handoffs.
- **owner**: private owner workflow. Spec editing, patch application, history restore, export artifacts, and deploy handoff actions require an owner-unlocked context.

Every export/deploy path can now carry a `PublicExposureAudit` that checks whether owner tools, project state, event history, review runtime, or migration bootstrap files are included. Production deploy packages should be public-safe by default; review packages should remain comment-only; owner/source packages should stay private or be protected by user-owned hosting access controls.

The security rule remains:

```text
review link = feedback invitation
owner unlock = edit/export/deploy capability
model output = proposal only
kernel validation = required before changes
```


## Phase 14 real artifact materialization

`ExportArtifact` is now materializable. The export layer can produce a concrete `MaterializedArtifact` that contains real file contents, a deterministic bundle payload, integrity metadata, privacy warnings, and a download receipt.

The lifecycle is now:

```text
Private migration endpoint
→ MigrationBootstrap
→ FlockProject
→ ExportArtifact
→ MaterializedArtifact
→ DeployPackage
→ user-owned hosting account
```

Phase 14 intentionally uses a simple `FlockBundleJson` format first. It is download-ready and deterministic, while binary ZIP compression remains an adapter concern for a later phase. This keeps ownership real without adding hosting, OAuth, provider uploads, or deployment state.

Materialization preserves the privacy rules introduced earlier:

- production materializations should exclude owner tools and private state;
- review materializations can include comment-only runtime but not owner patching tools;
- owner/source materializations may include private history and should remain in user-owned private storage.
