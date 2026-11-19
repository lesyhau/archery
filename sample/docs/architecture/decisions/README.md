# Architecture Decision Records

One file per decision, named `NNNN-short-title.md` (e.g. `0001-use-postgresql.md`).

Each ADR starts with YAML front matter:

```yaml
---
status: proposed        # proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
qualityGoals: []        # ids from data/quality-goals.yaml
constraints: []         # ids from data/constraints.yaml
---
```

followed by the sections **Context**, **Decision**, **Consequences**
(see https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
