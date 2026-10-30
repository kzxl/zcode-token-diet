// Offline estimate of the context that installed skills and plugins cost every session.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHARS_PER_TOKEN = 4;
const PATH_OVERHEAD_CHARS = 90; // absolute path + "(also loadable as ...)" per skill line

function frontmatterDescription(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
  if (!text.startsWith("---")) return "";
  const end = text.indexOf("\n---", 3);
  if (end < 0) return "";
  const block = text.slice(3, end).split(/\r?\n/);
  const out = [];
  let inDesc = false;
  for (const line of block) {
    if (/^description:\s*/.test(line)) {
      inDesc = true;
      out.push(line.replace(/^description:\s*/, ""));
      continue;
    }
    if (inDesc) {
      if (/^[a-zA-Z_][\w-]*:/.test(line)) break;
      out.push(line.trim());
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function scanSkills(root, label, rows) {
  for (const e of readDir(root)) {
    // Skill installers commonly use symlinks/junctions, so test for a directory
    // entry with stat rather than the lstat-based isDirectory().
    let isDir = e.isDirectory();
    if (!isDir) {
      try {
        isDir = fs.statSync(path.join(root, e.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    const f = path.join(root, e.name, "SKILL.md");
    if (!fs.existsSync(f)) continue;
    const d = frontmatterDescription(f);
    if (!d) continue;
    rows.push({
      label,
      name: e.name,
      chars: d.length + PATH_OVERHEAD_CHARS,
      note: "skill description",
    });
  }
}

function scanPlugins(rows) {
  const cache = path.join(os.homedir(), ".zcode", "cli", "plugins", "cache");
  for (const market of readDir(cache)) {
    if (!market.isDirectory()) continue;
    const marketDir = path.join(cache, market.name);
    for (const plugin of readDir(marketDir)) {
      if (!plugin.isDirectory()) continue;
      const pluginDir = path.join(marketDir, plugin.name);
      for (const version of readDir(pluginDir)) {
        if (!version.isDirectory()) continue;
        if (!fs.existsSync(path.join(pluginDir, version.name, ".zcode-plugin", "plugin.json"))) continue;
        const root = path.join(pluginDir, version.name);
        const manifestFile = path.join(root, ".zcode-plugin", "plugin.json");
        let manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        } catch {
          continue;
        }
        const skillDir = manifest.skills
          ? path.resolve(root, typeof manifest.skills === "string" ? manifest.skills : "skills")
          : path.join(root, "skills");
        scanSkills(skillDir, `${plugin.name}@${market.name}`, rows);

        const servers = manifest.mcpServers || {};
        const serverCount = Object.keys(servers).length;
        if (serverCount > 0) {
          rows.push({
            label: `${plugin.name}@${market.name}`,
            name: `[${serverCount} MCP server(s)]`,
            chars: serverCount * 4800, // ~20 tool schemas, ~240 chars each
            note: "tool schemas (estimate, agent-measurable only)",
          });
        }
      }
    }
  }
}

export function dietReport(cwd = process.cwd()) {
  const rows = [];
  scanSkills(path.join(os.homedir(), ".zcode", "skills"), "user", rows);
  scanSkills(path.join(os.homedir(), ".agents", "skills"), "user(.agents)", rows);
  scanSkills(path.join(cwd, ".zcode", "skills"), "workspace", rows);
  scanPlugins(rows);

  const agentsFile = path.join(os.homedir(), ".zcode", "AGENTS.md");
  let agentsNote = "";
  if (fs.existsSync(agentsFile)) {
    const chars = fs.statSync(agentsFile).size;
    agentsNote = `\nAGENTS.md (user): ${(chars / 1024).toFixed(1)} KB (~${Math.round(chars / CHARS_PER_TOKEN)} tokens, always loaded)`;
  }

  const skillRows = rows.filter((r) => r.note === "skill description");
  const schemaRows = rows.filter((r) => r.note !== "skill description");

  const byLabel = new Map();
  for (const r of skillRows) {
    const key = r.label;
    const cur = byLabel.get(key) || { count: 0, chars: 0 };
    cur.count++;
    cur.chars += r.chars;
    byLabel.set(key, cur);
  }

  const totalSkills = skillRows.length;
  const totalSkillChars = skillRows.reduce((n, r) => n + r.chars, 0);
  const schemaChars = schemaRows.reduce((n, r) => n + r.chars, 0);

  const lines = [];
  lines.push("zero-token report — estimated permanent context cost per session");
  lines.push(`formula: ${CHARS_PER_TOKEN} chars/token, +${PATH_OVERHEAD_CHARS} chars per skill line`);
  lines.push("");
  lines.push("GROUP                 ITEMS   EST. TOKENS");
  for (const [label, v] of [...byLabel.entries()].sort((a, b) => b[1].chars - a[1].chars)) {
    lines.push(
      `${label.padEnd(20)}  ${String(v.count).padStart(5)}   ${String(Math.round(v.chars / CHARS_PER_TOKEN)).padStart(10)}`
    );
  }
  if (schemaRows.length) {
    const schemaCount = schemaRows.reduce((n, r) => n + Number(r.name.match(/\d+/)?.[0] || 0), 0);
    lines.push(
      `${"plugin MCP schemas".padEnd(20)}  ${String(schemaCount).padStart(5)}   ${String(Math.round(schemaChars / CHARS_PER_TOKEN)).padStart(10)}`
    );
  }
  lines.push("");
  lines.push(
    `TOTAL ~${Math.round((totalSkillChars + schemaChars) / CHARS_PER_TOKEN)} tokens, ` +
      `every session, before you type anything (${totalSkills} skills).`
  );
  lines.push(agentsNote);

  const top = [...skillRows].sort((a, b) => b.chars - a.chars).slice(0, 12);
  if (top.length) {
    lines.push("", "HEAVIEST SKILL DESCRIPTIONS");
    for (const r of top) {
      lines.push(`  ${String(Math.round(r.chars / CHARS_PER_TOKEN)).padStart(5)}  ${r.name} (${r.label})`);
    }
  }

  lines.push(
    "",
    "WHAT TO DO",
    "  - Disable plugins whose MCP tools you never use: Settings > Plugin Management > Installed.",
    "  - Skills are discovered from disk; move rarely used ones out of ~/.zcode/skills to a backup folder.",
    "  - Prefer one router skill per topic over many narrow skills: 46 descriptions cost the same every turn."
  );

  return { text: lines.join("\n"), stats: { skills: totalSkills, estTokens: Math.round((totalSkillChars + schemaChars) / CHARS_PER_TOKEN) } };
}
