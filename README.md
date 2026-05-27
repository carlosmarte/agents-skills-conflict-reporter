# agents-skills-conflict-reporter

A single [agentskills.io](https://agentskills.io) skill for Claude Code that **audits a skills
directory for unsurfaced issues** — problems that never throw an error but quietly degrade agent
behavior: two skills claiming the same `name`, descriptions that trigger on the same prompts (so
the harness routes ambiguously), copy-pasted instruction bodies that have drifted apart, and
dependency tiers pointing the wrong way. It cross-references every `SKILL.md` and writes one
consolidated audit report. It is strictly **read-only** — it never edits skills, runs git, or
applies fixes.

The skill lives under `.agents/skills/<name>/` and is mirrored into `.claude/skills/<name>` as a
relative symlink so the harness auto-discovers it.

## Skills

| Skill | What it does |
|-------|--------------|
| [`agents-skills-conflict-reporter`](.agents/skills/agents-skills-conflict-reporter/SKILL.md) | Scans a skills directory for duplicate names, overlapping trigger descriptions, near-duplicate instruction bodies, dependency-tier inversions, and weak frontmatter, then writes a consolidated read-only audit report (Markdown or JSON). |

## What it detects

| Severity | Finding | Why it matters |
|----------|---------|----------------|
| **P0** | duplicate `name:` across two skills | the harness cannot disambiguate which to load |
| **P0** | unparseable / missing frontmatter | the skill is invisible or silently dropped |
| **P1** | high description (trigger) similarity | both skills fire on the same prompts → erratic routing |
| **P1** | near-identical instruction body | duplicated logic that will drift; consolidation candidate |
| **P1** | dependency tier inversion (`project→app→team→org`) | a lower tier depending on a higher one |
| **P2** | missing/short/long description, no trigger cue, missing `name` | weak discoverability or spec drift |

Mirror pairs (`.agents/skills/<name>` ↔ `.claude/skills/<name>`, the same skill via symlink) are
recognized and **not** reported as duplicates.

## Install

### Per skill — `npx skills add`

```bash
npx skills add carlosmarte/agents-skills-conflict-reporter \
  --skill agents-skills-conflict-reporter -a claude-code
```

### From source

```bash
git clone https://github.com/carlosmarte/agents-skills-conflict-reporter.git
# then point your harness at .agents/skills/, or symlink the skill into .claude/skills/
```

## Usage

The bundled scanner is a zero-dependency Node script (`node >= 18`):

```bash
node .agents/skills/agents-skills-conflict-reporter/bin/scan-conflicts.mjs <target-skills-dir> [options]
```

The target dir is the folder whose **direct children** each contain a `SKILL.md` (e.g.
`.agents/skills/`). It always writes to a file — never dumps to stdout — and prints the report
path on completion.

```bash
# Human-readable audit of the canonical skills dir
node .agents/skills/agents-skills-conflict-reporter/bin/scan-conflicts.mjs .agents/skills/

# Machine-readable for a follow-up agent, custom path, stricter overlap threshold
node .agents/skills/agents-skills-conflict-reporter/bin/scan-conflicts.mjs .agents/skills/ \
  --format json --out audit-log.json --similarity 0.6
```

### Options

| Flag | Effect |
|------|--------|
| `--out <path>` | report destination (default `./skill-conflict-report.md`, or `.json` with `--format json`) |
| `--format md\|json` | `md` for human review (default) or `json` for machine/agent consumption |
| `--similarity <0..1>` | pair-similarity threshold for overlap/duplicate findings (default `0.75`) |
| `--recursive` | walk nested directories instead of only direct children |
| `--help` | usage |

### Exit codes (CI-friendly)

`0` clean · `1` P0 conflicts present · `2` only P1/P2 findings. The report file is written in
every case.

## Layout

```
.agents/skills/<name>/SKILL.md                          # source of truth for each skill
.claude/skills/<name> -> ../../.agents/skills/<name>    # relative symlink (harness-discovered)
```

## License

[MIT](LICENSE) © Carlos Marte
