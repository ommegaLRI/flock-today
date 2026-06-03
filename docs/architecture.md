# Architecture

Stitch is a compiler-plus-capsule system.

```text
PageCapture -> Design Contract -> CampaignPageSpec -> React Campaign Site + Stitch Capsule
```

The generated React site is an artifact. The canonical source of truth is the `stitch/` directory, especially `page.spec.json`, `brand.spec.json`, `content.strategy.json`, and policies.

## Runtime boundaries

- `contract`: shared language and schemas.
- `capture`: evidence gathering and privacy filtering.
- `compiler`: initial migration and React bundle generation.
- `capsule`: site-carried private workbench/review primitives.
- `kernel`: ongoing user-owned edit and safety logic.
- `adapters`: external provider integrations.

## Hosted surfaces

Stitch-the-company may host:

1. a stateless migration endpoint,
2. an optional inference API,
3. a public demo/marketing page.

It should not host user sites, projects, feedback inboxes, production deployments, or required dashboards.
