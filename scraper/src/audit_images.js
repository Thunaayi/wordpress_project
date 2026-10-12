const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "output");
const RESULTS_FILE = path.join(OUTPUT_DIR, "enriched_products.json");
const AUDIT_CSV = path.join(OUTPUT_DIR, "image_audit.csv");
const argv = process.argv.slice(2);
const LIMIT = Number((argv.find(a => a.startsWith("--limit=")) || "").split("=")[1] || 0);

function clean(value) {
  return String(value ?? "").trim();
}

function keyOf(product) {
  return clean(product.id || product.ID || product.sku || product.SKU || product.name || product.Name);
}

function readResults() {
  if (!fs.existsSync(RESULTS_FILE)) {
    throw new Error("Missing " + RESULTS_FILE + ". Run the enrichment scraper first.");
  }
  const parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
  const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.products || []);
  if (!Array.isArray(results)) throw new Error("Unexpected JSON structure in enriched_products.json");
  return { parsed, results };
}

function resolveImage(value) {
  const raw = clean(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return null;
  const normalized = raw.replace(/^[.\\/]+/, "").replace(/\\/g, path.sep).replace(/\//g, path.sep);
  const fullPath = path.resolve(ROOT, normalized);
  if (!fullPath.startsWith(path.resolve(ROOT) + path.sep)) return null;
  return fullPath;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function main() {
  const { parsed, results } = readResults();
  const allFiles = new Map();
  const productDuplicates = [];
  const missingFiles = [];
  const urlOnly = [];
  const perProductLimit = LIMIT > 0 ? results.slice(0, LIMIT) : results;

  for (const product of perProductLimit) {
    const id = keyOf(product);
    const images = Array.isArray(product.images) ? product.images : [];
    const hashesForProduct = new Map();
    const pathsForProduct = new Set();
    let valid = 0;

    for (const imageValue of images) {
      const imagePath = clean(imageValue);
      const filePath = resolveImage(imagePath);
      if (!filePath) {
        if (/^https?:\/\//i.test(imagePath)) {
          urlOnly.push({ id, name: product.name || product.Name || "", image: imagePath, issue: "Remote URL is not a local file; not hashed" });
        }
        continue;
      }
      if (!fs.existsSync(filePath)) {
        missingFiles.push({ id, name: product.name || product.Name || "", image: imagePath, issue: "File not found" });
        continue;
      }

      const relative = path.relative(ROOT, filePath).split(path.sep).join("/");
      if (pathsForProduct.has(relative)) {
        productDuplicates.push({ id, name: product.name || product.Name || "", image: relative, duplicateOf: relative, hash: "", issue: "Repeated path in product JSON" });
        continue;
      }
      pathsForProduct.add(relative);
      valid++;

      let hash;
      try { hash = sha256(filePath); }
      catch (error) {
        missingFiles.push({ id, name: product.name || product.Name || "", image: relative, issue: "Could not read: " + error.message });
        continue;
      }

      if (!hashesForProduct.has(hash)) {
        hashesForProduct.set(hash, relative);
      } else {
        productDuplicates.push({
          id, name: product.name || product.Name || "", image: relative,
          duplicateOf: hashesForProduct.get(hash), hash, issue: "Identical file contents within product"
        });
      }

      const global = allFiles.get(hash) || [];
      global.push({ id, name: product.name || product.Name || "", image: relative });
      allFiles.set(hash, global);
    }

  }

  const crossProductDuplicates = [];
  for (const [hash, entries] of allFiles.entries()) {
    const uniquePaths = [...new Set(entries.map(entry => entry.image))];
    if (uniquePaths.length > 1) {
      crossProductDuplicates.push({ hash, files: uniquePaths, products: [...new Set(entries.map(entry => entry.id))] });
    }
  }

  const lines = [[
    "Product ID", "Product name", "Issue", "Image file", "Duplicate of", "SHA-256"
  ].join(",")];
  for (const row of productDuplicates) {
    lines.push([row.id, row.name, row.issue, row.image, row.duplicateOf, row.hash].map(csvEscape).join(","));
  }
  for (const row of missingFiles) {
    lines.push([row.id, row.name, row.issue, row.image, "", ""].map(csvEscape).join(","));
  }
  for (const row of urlOnly) {
    lines.push([row.id, row.name, row.issue, row.image, "", ""].map(csvEscape).join(","));
  }
  for (const group of crossProductDuplicates) {
    for (const entry of group.files) {
      lines.push(["", group.products.join("; "), "Identical bytes used across products", entry, group.files.filter(file => file !== entry).join("; "), group.hash].map(csvEscape).join(","));
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(AUDIT_CSV, lines.join("\n") + "\n");

  console.log("=== Image audit (read-only) ===");
  console.log("Products inspected: " + perProductLimit.length + (LIMIT ? " (limited)" : ""));
  console.log("Product-level duplicate entries: " + productDuplicates.length);
  console.log("Cross-product identical-file groups: " + crossProductDuplicates.length);
  console.log("Missing/unreadable image files: " + missingFiles.length);
  console.log("Remote image URLs not locally audited: " + urlOnly.length);
  console.log("Report: " + AUDIT_CSV);
  console.log("No files or enrichment JSON were changed.");
}

main();
