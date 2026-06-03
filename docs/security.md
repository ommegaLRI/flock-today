# Security and privacy model

Stitch separates public viewing, client review, and owner editing.

## Rules

- URL parameters are never authority.
- Review links can create comments only.
- Only owners can generate patches, edit specs, or publish.
- Client comments are untrusted input.
- Model output is untrusted until validated.
- Publishing requires explicit owner approval by default.
- Secrets must never be bundled into public JavaScript.

## Capture defaults

The capture layer should not collect cookies, local storage, form values, or network request bodies. Screenshot capture should prefer element or section crops unless full-page context is explicitly requested.
