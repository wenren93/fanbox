# Domain Docs

How engineering skills should consume this repository’s domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repository root.
- **`docs/adr/`**: read ADRs relevant to the area being changed.

If either location does not exist, proceed silently. Domain documentation is created lazily when terms or decisions are resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
├── lib/
├── public/
└── server.js
```

## Use the glossary’s vocabulary

When naming a domain concept in issues, proposals, tests, or code, use the term defined in `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether it belongs to the project’s language or record the gap for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
