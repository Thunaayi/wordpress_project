const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const IMAGE_DIR = path.join(ROOT, "data", "images");
const OUTPUT_DIR = path.join(ROOT, "output");
const PLAN_CSV = path.join(OUTPUT_DIR, "image_cleanup_plan.csv");
const PLAN_JSON = path.join(OUTPUT_DIR, "image_cleanup_plan.json");
const args = new Set(process.argv.slice(2));
const LIMIT_ARG = process.argv.slice(2).find(arg => arg.startsWith("--limit="));
const LIMIT = Number(LIMIT_ARG ? LIMIT_ARG.split("=")[1] : 0);
const APPLY = args.has("--apply");
const CONFIRMED = args.has("--confirm=YES");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff"]);

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function findImages(directory) {
  if (!fs.existsSync(directory)) throw new Error("Local image directory does not exist: " + directory);
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Never scan quarantine folders on subsequent runs.
        if (entry.name !== ".duplicate-quarantine") walk(fullPath);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  walk(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

function collectDuplicateGroups(files) {
  const byHash = new Map();
  for (const file of files) {
    const hash = sha256(file);
    const group = byHash.get(hash) || [];
    group.push(file);
    byHash.set(hash, group);
  }
  return [...byHash.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([hash, group]) => {
      // Stable canonical choice: shortest relative path, then alphabetical.
      const ordered = group.slice().sort((a, b) => {
        const ar = relative(a), br = relative(b);
        return ar.length - br.length || ar.localeCompare(br);
      });
      return { hash, keep: ordered[0], duplicates: ordered.slice(1) };
    });
}

function writePlan(groups, unreadable) {
  const rows = [];
  for (const group of groups) {
    for (const duplicate of group.duplicates) {
      rows.push({
        action: "QUARANTINE_AFTER_REFERENCE_UPDATE",
        keep: relative(group.keep),
        duplicate: relative(duplicate),
        sha256: group.hash,
        bytes: fs.statSync(duplicate).size
      });
    }
  }
  for (const item of unreadable) rows.push({ action: "REVIEW_UNREADABLE", keep: "", duplicate: relative(item.file), sha256: "", bytes: "", note: item.error });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: "preview",
    localOnly: true,
    note: "No changes are made unless --apply --confirm=YES is supplied. Exact byte-identical files only.",
    duplicateGroups: groups.map(group => ({
      sha256: group.hash,
      keep: relative(group.keep),
      duplicates: group.duplicates.map(relative)
    })),
    redundantFileCount: groups.reduce((sum, group) => sum + group.duplicates.length, 0),
    unreadable: unreadable.map(item => ({ file: relative(item.file), error: item.error })),
    actions: rows
  };
  fs.writeFileSync(PLAN_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const header = ["Action", "Keep file", "Duplicate file", "SHA-256", "Size bytes", "Note"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([row.action, row.keep, row.duplicate, row.sha256, row.bytes, row.note || ""].map(csvEscape).join(","));
  }
  fs.writeFileSync(PLAN_CSV, lines.join("\n") + "\n", "utf8");
  return { payload, rows };
}

function walkOutputFiles(directory, found = []) {
  if (!fs.existsSync(directory)) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "cleanup_backups") walkOutputFiles(fullPath, found);
    } else if (entry.isFile() && /\.(json|csv|txt)$/i.test(entry.name) && ![PLAN_CSV, PLAN_JSON].includes(fullPath)) {
      found.push(fullPath);
    }
  }
  return found;
}

function applyCleanup(groups) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(OUTPUT_DIR, "cleanup_backups", timestamp);
  const quarantineRoot = path.join(IMAGE_DIR, ".duplicate-quarantine", timestamp);
  const replacements = [];

  for (const group of groups) {
    const keep = relative(group.keep);
    for (const duplicate of group.duplicates) {
      replacements.push({ from: relative(duplicate), to: keep, duplicate, keep: group.keep });
    }
  }

  // Back up and rewrite all text outputs containing exact local relative-path references.
  const outputFiles = walkOutputFiles(OUTPUT_DIR);
  const modified = [];
  for (const file of outputFiles) {
    let original;
    try { original = fs.readFileSync(file, "utf8"); }
    catch { continue; }
    let updated = original;
    for (const item of replacements) {
      const variants = [
        item.from,
        item.from.replace(/\//g, "\\")
      ];
      for (const variant of variants) {
        updated = updated.split(variant).join(item.to);
      }
    }
    if (updated !== original) {
      const backupPath = path.join(backupRoot, path.relative(OUTPUT_DIR, file));
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(file, backupPath);
      fs.writeFileSync(file, updated, "utf8");
      modified.push({ file: relative(file), backup: path.relative(ROOT, backupPath).split(path.sep).join("/") });
    }
  }

  // Move redundant copies into quarantine, preserving relative paths. No permanent deletion.
  const moved = [];
  try {
    for (const item of replacements) {
      if (!fs.existsSync(item.duplicate)) continue;
      const target = path.join(quarantineRoot, path.relative(IMAGE_DIR, item.duplicate));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(item.duplicate, target);
      moved.push({ from: relative(item.duplicate), to: relative(target), keep: relative(item.keep) });
    }
  } catch (error) {
    // Do not silently leave a half-applied cleanup. The backups and quarantine preserve recovery options.
    throw new Error("Cleanup stopped during quarantine moves: " + error.message +
      ". Review output/cleanup_backups and data/images/.duplicate-quarantine before retrying.");
  }

  const logPath = path.join(backupRoot, "cleanup_manifest.json");
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify({
    appliedAt: new Date().toISOString(),
    mode: "applied",
    localOnly: true,
    modifiedOutputFiles: modified,
    quarantinedFiles: moved,
    note: "Redundant images were moved to quarantine, not permanently deleted."
  }, null, 2) + "\n", "utf8");
  return { modified, moved, backupRoot, quarantineRoot, logPath };
}

function main() {
  if (APPLY && !CONFIRMED) {
    console.error("Refusing to apply without explicit confirmation.");
    console.error("Review the preview plan, then run: npm run cleanup:images -- --apply --confirm=YES");
    process.exitCode = 2;
    return;
  }

  const allFiles = findImages(IMAGE_DIR);
  const files = LIMIT > 0 ? allFiles.slice(0, LIMIT) : allFiles;
  const groups = collectDuplicateGroups(files);
  const plan = writePlan(groups, []);

  console.log("=== Local image cleanup " + (APPLY ? "APPLY" : "PREVIEW") + " ===");
  console.log("Local image files inspected: " + files.length + (LIMIT > 0 ? " (limited sample; do not apply a limited plan)" : ""));
  console.log("Exact duplicate groups: " + groups.length);
  console.log("Redundant copies in plan: " + plan.payload.redundantFileCount);
  console.log("Preview CSV: " + PLAN_CSV);
  console.log("Preview JSON: " + PLAN_JSON);

  if (!APPLY) {
    console.log("Preview only. No image files or enrichment outputs were changed.");
    console.log("After reviewing the full plan, apply with: npm run cleanup:images -- --apply --confirm=YES");
    return;
  }
  if (LIMIT > 0) throw new Error("Refusing to apply a limited --limit plan. Remove --limit and regenerate the full plan.");

  const result = applyCleanup(groups);
  console.log("Output files updated: " + result.modified.length);
  console.log("Duplicate files moved to quarantine: " + result.moved.length);
  console.log("Backups and manifest: " + relative(result.backupRoot));
  console.log("Quarantine: " + relative(result.quarantineRoot));
  console.log("No files were permanently deleted and no website requests were made.");
}

main();
