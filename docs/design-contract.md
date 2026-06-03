# Design Contract

The Stitch Design Contract is the heart of the project.

It is not a UI kit. It is a semantic contract for campaign pages:

```text
Brand tokens + page grammar + component recipes + safety policies
```

The contract lets Stitch normalize messy pages into predictable concepts such as:

- `Hero.primaryCta.label`
- `FeatureGrid.items`
- `Section.variant`
- `Brand.colors.accent`
- `Pricing.plans`

Future changes should prefer:

```text
user request -> semantic operation -> spec patch -> regenerate section
```

Only adopted/custom React sites should fall back to raw code patches.
