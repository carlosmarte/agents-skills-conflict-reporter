---
name: agents-skills-conflict-reporter
description: Scan a skills directory for unsurfaced issues — duplicate skill names, overlapping trigger descriptions that cause routing collisions, near-duplicate instruction bodies, dependency-tier inversions, and weak frontmatter — and write a consolidated, read-only audit report (Markdown or JSON). Non-destructive: it never edits skills, runs git, or applies fixes. Use when the user asks to audit a skills folder, find conflicting or duplicate skills, diagnose why the wrong skill keeps firing, check `.agents/skills/` or `.claude/skills/` for overlaps, or generate a skill-conflict report before reviewing a batch of imported skills.
tier: project
license: Apache-2.0
compatibility: zero-dependency Node script (node>=18); read access to the target dir, write access to the output path
---

# Agents-Skills Conflict Reporter

Skill repositories accumulate **unsurfaced issues** — problems that never throw an error
but quietly degrade agent behavior: two skills claiming the same `name`, descriptions that
trigger on the same user phrasing (so the harness routes ambiguously), copy-pasted
instruction bodies that drift apart, or dependency tiers that point the wrong way. This
skill scans a target skills directory, cross-references every `SKILL.md`, and writes a
single consolidated audit report. It is strictly **read-only** — it analyzes and reports,
it does not fix.

## When to use

- "Audit `.agents/skills/` for conflicts" / "check this skills folder for duplicates".
- "Why does the wrong skill keep firing?" — overlapping trigger descriptions.
- Before manually approving a freshly imported batch of skills.
- As a scheduled, non-destructive background audit of a skill monorepo.

## What it detects

| Severity | Finding | Why it matters |
|----------|---------|----------------|
| **P0 conflict** | duplicate `name:` across two skills | the harness cannot disambiguate which to load |
| **P0 conflict** | unparseable / missing frontmatter | the skill is invisible or silently dropped |
| **P1 overlap** | high description (trigger) similarity | both skills fire on the same prompts → erratic routing |
| **P1 duplicate** | near-identical instruction body | duplicated logic that will drift; consolidation candidate |
| **P1 conflict** | dependency tier inversion (project→app→team→org violated) | a lower tier depending on a higher one |
| **P2 improvement** | missing/short/long description, no trigger cue, missing `name` | weak discoverability or spec drift |

The mirror pair `.agents/skills/<name>` ↔ `.claude/skills/<name>` (same `name`, one a symlink
of the other) is recognized and **not** reported as a duplicate.

## Usage

```bash
node bin/scan-conflicts.mjs <target-skills-dir> [options]
```

The target dir is the folder whose **direct children** each contain a `SKILL.md`
(e.g. `.agents/skills/`). Always writes to a file — never dumps the report to stdout —
and prints the report path on completion.

### Options

- `--out <path>` — report destination. Default `./skill-conflict-report.md` (or `.json` with `--format json`).
- `--format md|json` — `md` (human review, default) or `json` (machine/agent consumption).
- `--similarity <0..1>` — pair-similarity threshold for overlap/duplicate findings. Default `0.75`.
- `--recursive` — walk nested directories instead of only direct children.
- `--help` — usage.

### Exit codes (CI-friendly)

`0` clean · `1` P0 conflicts present · `2` only P1/P2 findings. The report file is written
in every case.

## Examples

```bash
# Human-readable audit of the canonical skills dir
node bin/scan-conflicts.mjs .agents/skills/

# Machine-readable for a follow-up agent, custom path, stricter overlap threshold
node bin/scan-conflicts.mjs .agents/skills/ --format json --out audit-log.json --similarity 0.6
```

## Boundaries

This skill **only reports**. Resolving a finding — renaming a duplicate, merging
overlapping skills, fixing a description — is a separate manual or skill-driven step, by
design: the analysis phase is decoupled from the fixing phase so a human can review the
report first. It performs no writes other than the single report file and runs no git or
package commands.
