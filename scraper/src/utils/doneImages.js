const fs = require("fs");
const path = require("path");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tif", ".tiff"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function walkImages(directory, found = []) {
  if (!fs.existsSync(directory)) return found;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkImages(fullPath, found);
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      found.push({ path: fullPath, filename: entry.name, normalized: normalize(path.basename(entry.name, path.extname(entry.name))) });
    }
  }
  return found;
}

function loadDoneImageIndex(doneDirectory) {
  return { directory: doneDirectory, files: walkImages(doneDirectory) };
}

function hasDelimitedToken(filename, value) {
  const token = normalize(value);
  if (!token) return false;
  const escaped = token.split(" ").map(part => part.replace(/[.*+?^$\u007b\u007d()|[\]\\]/g, "\\$&")).join("[^a-z0-9]+");
  return new RegExp("(?:^|[^a-z0-9])" + escaped + "(?:$|[^a-z0-9])", "i").test(filename);
}

function isDoneProduct(product, index) {
  if (!index || !Array.isArray(index.files) || !index.files.length) return false;
  const id = clean(product.id || product.ID);
  const sku = clean(product.sku || product.SKU);
  const name = normalize(product.name || product.Name);
  return index.files.some(file => {
    if (id && hasDelimitedToken(file.normalized, id)) return true;
    if (sku && sku.length >= 3 && hasDelimitedToken(file.normalized, sku)) return true;
    if (name.length >= 8 && (file.normalized === name || file.normalized.startsWith(name + " "))) return true;
    return false;
  });
}

module.exports = { loadDoneImageIndex, isDoneProduct };
