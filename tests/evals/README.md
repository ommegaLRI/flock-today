# Stitch Evals

Phase 12 keeps the deployment boundary user-owned. The eval target is not “can Stitch publish a site?” It is “can Stitch produce a provider-ready package without leaking private state or pretending to host anything?”

## Deploy package evals

1. **Production package excludes owner tooling**
   - Input: `ExportArtifact` with `profile: "production"`.
   - Expected: `DeployPackage.readiness.status !== "blocked"` only when no `/_stitch`, `project.state.json`, or `events.json` files are present.

2. **Review package is comment-only**
   - Input: review export artifact.
   - Expected: readiness includes an informational `review-runtime-included` warning and does not include owner workbench files.

3. **Owner package warns before public hosting**
   - Input: owner export artifact.
   - Expected: readiness is `needsReview` or stricter with `owner-profile-public-risk`.

4. **Cloudflare Pages package is provider-ready but not provider-connected**
   - Input: production export artifact.
   - Expected: provider is `cloudflarePages`, build command is `npm run build`, output directory is `dist`, and warnings include `provider-api-not-called`.

5. **Manual static package remains portable**
   - Input: production export artifact.
   - Expected: provider is `manualStatic`, manual steps explain how to build and upload `dist` to a user-owned host.

6. **Unknown forms remain warnings**
   - Input: export artifact with migration warning mentioning form destination.
   - Expected: deploy readiness includes `unknown-form-destination` and requires owner review.

7. **No hosting state is created**
   - Input: any deploy package.
   - Expected: package contains instructions/config files only; no OAuth token, project id from provider, deployment URL, or domain state is required.

## Regression rule

A deploy package is a handoff artifact. It must never call a provider API, store credentials, or mark an owner/source export as public-safe by default.

## Phase 13 access/capability evals

1. **Production is visitor-only**
   - Input: production bundle/export/deploy package.
   - Expected: no review runtime, owner workbench, project state, or event history is included.

2. **Review is comment-only**
   - Input: review profile capsule.
   - Expected: `comment:create` and `feedback:export` are allowed; `spec:edit`, `patch:apply`, `bundle:export`, and `deploy:handoff` are denied.

3. **Owner actions require owner unlock**
   - Input: owner profile capsule without owner token/unlock.
   - Expected: spec edits, patch application, feedback import, history restore, export, and deploy handoff are denied.

4. **Owner/source exports are private by default**
   - Input: owner or source export.
   - Expected: public exposure audit warns with `owner-profile-public-risk`.

5. **Production deploy blocks private state**
   - Input: production deploy package containing `project.state.json`, `events.json`, or `public/_stitch` files.
   - Expected: deploy readiness is blocked.

6. **URL parameters are not authority**
   - Input: `?review=1` or similar activation.
   - Expected: review UI can create feedback only; owner capabilities are still unavailable.
