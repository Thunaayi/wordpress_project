const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const IMAGE_DIR = path.join(ROOT, "data", "images");
const OUTPUT_DIR = path.join(ROOT, "output");
const AUDIT_CSV = path.join(OUTPUT_DIR, "image_audit.csv");
const argv = process.argv.slice(2);
const LIMIT = Number((argv.find(a => a.startsWith("--limit=")) || "").split("=")[1] || 0);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff"]);

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function findLocalImages(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error("Local image directory does not exist: " + directory);
  }

  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  walk(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  // This audit intentionally reads only image files physically stored on this PC.
  // It never fetches URLs or checks images hosted on the Techistics website.
  let files = findLocalImages(IMAGE_DIR);
  if (LIMIT > 0) files = files.slice(0, LIMIT);

  const byHash = new Map();
  const unreadable = [];
  for (const filePath of files) {
    try {
      const hash = sha256(filePath);
      const relative = path.relative(ROOT, filePath).split(path.sep).join("/");
      const group = byHash.get(hash) || [];
      group.push({ path: relative, size: fs.statSync(filePath).size });
      byHash.set(hash, group);
    } catch (error) {
      unreadable.push({
        path: path.relative(ROOT, filePath).split(path.sep).join("/"),
        issue: "Could not read file: " + error.message
      });
    }
  }

  const rows = [];
  for (const [hash, group] of byHash.entries()) {
    if (group.length < 2) continue;
    const canonical = group[0].path;
    for (const entry of group) {
      rows.push({
        issue: entry.path === canonical ? "Duplicate group (original candidate)" : "Exact duplicate local file",
        image: entry.path,
        duplicateOf: entry.path === canonical ? "" : canonical,
        hash,
        size: entry.size
      });
    }
  }

  for (const entry of unreadable) {
    rows.push({ issue: entry.issue, image: entry.path, duplicateOf: "", hash: "", size: "" });
  }

  const header = ["Issue", "Local image file", "Duplicate of", "SHA-256", "Size bytes"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([row.issue, row.image, row.duplicateOf, row.hash, row.size].map(csvEscape).join(","));
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(AUDIT_CSV, lines.join("\n") + "\n", "utf8");

  const duplicateGroups = [...byHash.values()].filter(group => group.length > 1);
  console.log("=== Local image audit (read-only) ===");
  console.log("Local image directory: " + IMAGE_DIR);
  console.log("Local image files inspected: " + files.length + (LIMIT > 0 ? " (limited)" : ""));
  console.log("Exact duplicate groups: " + duplicateGroups.length);
  console.log("Files in duplicate groups: " + duplicateGroups.reduce((sum, group) => sum + group.length, 0));
  console.log("Unreadable files: " + unreadable.length);
  console.log("Report: " + AUDIT_CSV);
  console.log("Only local files were inspected. No website requests were made.");
  console.log("No image files were deleted or changed.");
}

main();
