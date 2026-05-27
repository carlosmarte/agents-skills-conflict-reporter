#!/usr/bin/env node
// scan-conflicts.mjs — read-only audit of a skills directory for unsurfaced issues.
// Detects duplicate names, overlapping trigger descriptions, near-duplicate bodies,
// dependency-tier inversions, and weak frontmatter. Writes one consolidated report.
// Zero dependencies. Never edits skills, never runs git. Node >= 18.

import { readFileSync, writeFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, relative } from "node:path";

// --- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const opts = { target: null, out: null, format: "md", similarity: 0.75, recursive: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--recursive") opts.recursive = true;
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--format") opts.format = argv[++i];
    else if (a === "--similarity") opts.similarity = Number(argv[++i]);
    else if (a.startsWith("--")) { console.error(`Unknown option: ${a}`); process.exit(2); }
    else if (!opts.target) opts.target = a;
    else { console.error(`Unexpected argument: ${a}`); process.exit(2); }
  }
  return opts;
}

const USAGE = `Usage: scan-conflicts.mjs <target-skills-dir> [options]

  --out <path>          report destination (default ./skill-conflict-report.md / .json)
  --format md|json      output format (default md)
  --similarity <0..1>   overlap/duplicate threshold (default 0.75)
  --recursive           walk nested dirs instead of only direct children
  --help                this message

Read-only. Writes exactly one report file; never edits skills or runs git.`;

// --- frontmatter + body parsing -------------------------------------------
// Minimal, dependency-free YAML-ish frontmatter reader: top-level "key: value"
// pairs and simple "key: [a, b]" / block list arrays. Sufficient for SKILL.md.
function parseSkill(text) {
  const fm = {};
  let body = text;
  let parseError = null;
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) {
    parseError = "no frontmatter block (expected leading '---' fences)";
  } else {
    body = m[2] || "";
    const lines = m[1].split(/\r?\n/);
    let curKey = null;
    for (const raw of lines) {
      if (!raw.trim() || /^\s*#/.test(raw)) continue;
      const blockItem = /^\s*-\s+(.*)$/.exec(raw);
      if (blockItem && curKey) {
        (fm[curKey] ||= []).push(stripQuotes(blockItem[1].trim()));
        continue;
      }
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
      if (!kv) continue;
      const key = kv[1];
      const val = kv[2].trim();
      if (val === "" ) { fm[key] = []; curKey = key; continue; } // start of block list
      curKey = null;
      const inline = /^\[(.*)\]$/.exec(val);
      if (inline) fm[key] = inline[1].split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
      else fm[key] = stripQuotes(val);
    }
  }
  return { fm, body, parseError };
}
const stripQuotes = (s) => s.replace(/^["']|["']$/g, "");

// --- discovery -------------------------------------------------------------
function findSkills(targetDir, recursive) {
  const found = [];
  const skip = new Set(["node_modules", ".git"]);
  function visit(dir, depth) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isFile() && e.name === "SKILL.md") found.push(full);
      else if (e.isDirectory() && !skip.has(e.name)) {
        // Always descend one level (direct children); only go deeper if recursive.
        if (depth < 1 || recursive) visit(full, depth + 1);
      }
    }
  }
  // Look for a SKILL.md directly in each child dir, plus the target itself.
  let entries;
  try { entries = readdirSync(targetDir, { withFileTypes: true }); }
  catch (err) { console.error(`Cannot read target dir '${targetDir}': ${err.message}`); process.exit(2); }
  for (const e of entries) {
    if (e.isFile() && e.name === "SKILL.md") found.push(join(targetDir, e.name));
    else if (e.isDirectory() && !skip.has(e.name)) visit(join(targetDir, e.name), 1);
  }
  return [...new Set(found)];
}

// --- text similarity (token Jaccard) ---------------------------------------
const STOP = new Set(("a an and are as at be by для for from has have in is it its of on or that the to use used when with this your you skill skills").split(/\s+/));
function tokenSet(s) {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ") // drop fenced code from bodies
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );
}
function jaccard(aSet, bSet) {
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

// --- tier inversion --------------------------------------------------------
// Spec §3.3: dependency direction must not invert project->app->team->org.
const TIER_RANK = { application: 0, app: 0, project: 1, team: 2, org: 3, enterprise: 4, company: 5 };

// --- mirror detection ------------------------------------------------------
// Two paths are mirrors if one resolves (via symlink) to the other's directory.
function realDir(skillPath) {
  try { return realpathSync(skillPath); } catch { return skillPath; }
}

// --- main ------------------------------------------------------------------
const opts = parseArgs(process.argv.slice(2));
if (opts.help || !opts.target) { console.log(USAGE); process.exit(opts.help ? 0 : 2); }
if (!["md", "json"].includes(opts.format)) { console.error("--format must be md or json"); process.exit(2); }
if (!(opts.similarity >= 0 && opts.similarity <= 1)) { console.error("--similarity must be 0..1"); process.exit(2); }

const targetDir = resolve(opts.target);
const skillPaths = findSkills(targetDir, opts.recursive);

const skills = skillPaths.map((p) => {
  let text = "";
  try { text = readFileSync(p, "utf8"); } catch (e) { text = ""; }
  const { fm, body, parseError } = parseSkill(text);
  return {
    path: p,
    rel: relative(targetDir, p) || p,
    real: realDir(p),
    name: typeof fm.name === "string" ? fm.name : null,
    description: typeof fm.description === "string" ? fm.description : "",
    tier: typeof fm.tier === "string" ? fm.tier : null,
    dependencies: Array.isArray(fm.dependencies) ? fm.dependencies : [],
    body,
    parseError: parseError || (text === "" ? "empty or unreadable file" : null),
    descTokens: tokenSet(typeof fm.description === "string" ? fm.description : ""),
    bodyTokens: tokenSet(body),
  };
});

const findings = { p0: [], p1: [], p2: [] };

// P0: parse / frontmatter failures
for (const s of skills) {
  if (s.parseError) findings.p0.push({ type: "frontmatter-error", skills: [s.rel], detail: s.parseError });
  else if (!s.name) findings.p0.push({ type: "missing-name", skills: [s.rel], detail: "no `name:` in frontmatter" });
}

// Mirror map: group by resolved real path so symlink mirrors collapse to one identity.
const pushTo = (map, key, val) => { const arr = map.get(key); if (arr) arr.push(val); else map.set(key, [val]); };
const byReal = new Map();
for (const s of skills) pushTo(byReal, s.real, s);
const mirrorOf = (a, b) => a.real === b.real;

// P0: duplicate names (excluding mirror pairs that resolve to the same file)
const byName = new Map();
for (const s of skills) if (s.name) pushTo(byName, s.name, s);
for (const [name, group] of byName) {
  if (group.length < 2) continue;
  // collapse mirrors: distinct only if they don't resolve to the same real path
  const distinct = [];
  for (const s of group) if (!distinct.some((d) => mirrorOf(d, s))) distinct.push(s);
  if (distinct.length >= 2) {
    findings.p0.push({ type: "duplicate-name", skills: distinct.map((s) => s.rel), detail: `name '${name}' declared by ${distinct.length} distinct skills` });
  }
}

// Pairwise overlap / duplicate (only between named, parse-clean, non-mirror skills)
const clean = skills.filter((s) => !s.parseError && s.name);
for (let i = 0; i < clean.length; i++) {
  for (let j = i + 1; j < clean.length; j++) {
    const a = clean[i], b = clean[j];
    if (mirrorOf(a, b)) continue;
    const descSim = jaccard(a.descTokens, b.descTokens);
    const bodySim = jaccard(a.bodyTokens, b.bodyTokens);
    if (descSim >= opts.similarity) {
      findings.p1.push({ type: "trigger-overlap", skills: [a.name, b.name], detail: `description similarity ${descSim.toFixed(2)} — both may fire on the same prompts`, score: descSim });
    }
    if (bodySim >= opts.similarity) {
      findings.p1.push({ type: "duplicate-body", skills: [a.name, b.name], detail: `instruction-body similarity ${bodySim.toFixed(2)} — likely duplicated logic`, score: bodySim });
    }
  }
}

// P1: dependency tier inversion
for (const s of clean) {
  if (s.tier == null || !(s.tier in TIER_RANK) || s.dependencies.length === 0) continue;
  const selfRank = TIER_RANK[s.tier];
  for (const dep of s.dependencies) {
    const depName = String(dep).replace(/@.*$/, ""); // drop version spec
    const target = clean.find((x) => x.name === depName);
    if (target && target.tier in TIER_RANK && TIER_RANK[target.tier] < selfRank) {
      findings.p1.push({ type: "tier-inversion", skills: [s.name, depName], detail: `${s.tier} skill depends on lower tier '${target.tier}'` });
    }
  }
}

// P2: description quality
for (const s of clean) {
  const d = s.description;
  const len = d.length;
  if (len < 40) findings.p2.push({ type: "weak-description", skills: [s.name], detail: `description very short (${len} chars) — poor discoverability` });
  else if (len > 1024) findings.p2.push({ type: "long-description", skills: [s.name], detail: `description very long (${len} chars)` });
  if (len >= 40 && !/\b(use when|trigger|when the user|when you|after|before)\b/i.test(d))
    findings.p2.push({ type: "no-trigger-cue", skills: [s.name], detail: "description lacks a 'use when…' trigger cue" });
}

// --- report rendering ------------------------------------------------------
const ts = new Date().toISOString();
const total = findings.p0.length + findings.p1.length + findings.p2.length;
const exitCode = findings.p0.length ? 1 : (findings.p1.length + findings.p2.length ? 2 : 0);

function renderMd() {
  const L = [];
  L.push(`# Skill Conflict Report`, "");
  L.push(`- **Target:** \`${opts.target}\``);
  L.push(`- **Generated:** ${ts}`);
  L.push(`- **Skills scanned:** ${skills.length}`);
  L.push(`- **Findings:** ${total}  (P0: ${findings.p0.length} · P1: ${findings.p1.length} · P2: ${findings.p2.length})`);
  L.push(`- **Similarity threshold:** ${opts.similarity}`, "");
  if (total === 0) L.push(`✅ No conflicts, duplicates, or improvement findings detected.`, "");
  const section = (title, items, emptyMsg) => {
    L.push(`## ${title}`, "");
    if (!items.length) { L.push(`_${emptyMsg}_`, ""); return; }
    L.push(`| Finding | Skills | Detail |`, `|---|---|---|`);
    for (const f of items) L.push(`| \`${f.type}\` | ${f.skills.map((s) => `\`${s}\``).join(", ")} | ${f.detail} |`);
    L.push("");
  };
  section("P0 — Conflicts (block: must resolve)", findings.p0, "none");
  section("P1 — Duplicates & Overlaps (review)", findings.p1.sort((a, b) => (b.score || 0) - (a.score || 0)), "none");
  section("P2 — Improvements (advisory)", findings.p2, "none");
  L.push(`---`, `_Read-only audit. No files were modified. Resolve findings manually or with a follow-up skill._`, "");
  return L.join("\n");
}

function renderJson() {
  return JSON.stringify({
    schema: "agents-skills-conflict-reporter/v1",
    target: opts.target,
    generated: ts,
    similarityThreshold: opts.similarity,
    skillsScanned: skills.length,
    summary: { total, p0: findings.p0.length, p1: findings.p1.length, p2: findings.p2.length },
    findings,
    skills: skills.map((s) => ({ name: s.name, path: s.rel, tier: s.tier, parseError: s.parseError })),
  }, null, 2);
}

const outPath = resolve(opts.out || (opts.format === "json" ? "skill-conflict-report.json" : "skill-conflict-report.md"));
const content = opts.format === "json" ? renderJson() : renderMd();
try { writeFileSync(outPath, content); }
catch (e) { console.error(`Cannot write report to '${outPath}': ${e.message}`); process.exit(2); }

console.log(`Scanned ${skills.length} skill(s) under ${opts.target}`);
console.log(`Findings — P0: ${findings.p0.length}, P1: ${findings.p1.length}, P2: ${findings.p2.length}`);
console.log(`Report written to: ${outPath}`);
process.exit(exitCode);
