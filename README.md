# Flock

Flock is private, browser-local editing intelligence for Stitch-generated Astro sites.

The website is the editing surface:

1. Run the Astro development server.
2. Click **Edit with Flock**.
3. Select a Stitch section on the page.
4. Describe the desired result.
5. Keep or revert the live preview.

There is no Flock dashboard, hosted project, AI backend, conversation store, or production runtime.

## Architecture

```text
Live Astro page
├── in-page section editor
├── section intelligence packet
└── dedicated Web Worker
    └── WebLLM local model
            │ proposed complete .astro section
            ▼
Local Astro integration
├── stale-source check
├── identity and preservation checks
├── external-script and size checks
├── Astro compiler check
├── one atomic file write
└── keep / revert
```

Inference runs in the owner's browser. The Astro development integration performs no AI work and has access only to the local project files needed to resolve and replace one selected section.

## Install

```bash
npm install --save-dev @flock/capsule
npx flock install
npm run dev
```

The installer adds one Astro integration:

```js
import flock from '@flock/capsule';

export default defineConfig({
  integrations: [flock()],
});
```

Flock activates only during `astro dev` and only accepts same-origin requests from localhost.

## Local AI

The first edit lazily downloads a local coder model through WebLLM and caches model assets in the browser. Flock currently selects one of two internal profiles:

- compact: Qwen2.5 Coder 0.5B;
- standard: Qwen2.5 Coder 1.5B on devices reporting at least 8 GB of memory.

There is no model picker. The editor includes one **Remove local model** control. Prompts, source, edit history, and conversations are not persisted by Flock.

A WebGPU-capable browser is required for local inference.

## Editing transaction

For each edit, Flock:

1. compiles only the selected section's source, Stitch contract slice, facts, occurrences, relevant recipes and tokens, preservation values, and review context;
2. interprets the instruction into a small permission-bearing edit intent;
3. generates one complete Astro section locally;
4. submits the candidate with the source hash it was based on;
5. validates and compiles the candidate before writing;
6. gives the local model one constrained repair attempt when validation fails;
7. writes one file atomically and lets Astro HMR render it;
8. retains one in-memory baseline until the owner chooses **Keep** or **Revert**.

Multiple preview refinements preserve the baseline from before the first preview. Git and the project filesystem remain the durable history.

## Default preservation policy

Unless the interpreted instruction explicitly authorizes a change, Flock preserves:

- visible static content;
- links and form destinations;
- image and media sources;
- `data-section-id`;
- `data-stitch-role="section"`.

Candidates are also rejected when they are stale, empty, oversized, introduce an external script, or fail the Astro compiler.

## Ownership boundary

Flock reads Stitch artifacts but never changes them:

```text
.stitch/manifest.json
.stitch/contract.json
.stitch/provenance.json
.stitch/run.json
.stitch/visuals/**
.stitch/failures/**
```

It writes only the selected generated `.astro` section file.

## Production

`astro build` receives no Flock script, panel, endpoint, model, credential, or Stitch artifact. Flock is an owner-development tool only.

## Development

```bash
npm install
npm test
npm run check
```
