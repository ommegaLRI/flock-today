# Repo shape

The repo stays lean by splitting on runtime boundaries, not every abstract concept.

```text
contract = language
capture = evidence
compiler = migration
capsule = embedded private layer
kernel = ongoing user-owned decisions
adapters = outside world
cli = advanced/local control
```

Split packages later only when one boundary becomes independently complex.
