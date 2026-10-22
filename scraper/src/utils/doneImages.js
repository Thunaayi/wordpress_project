const fs = require("fs");
const path = require("path");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tif", ".tiff"]);
const GENERIC_NAME_WORDS = new Set([
  "the", "and", "for", "with", "from", "price", "in", "new", "latest", "gaming",
  "computer", "computers", "pc", "desktop", "black", "white", "wireless", "wired",
  "original", "official", "product", "products", "series", "edition", "version",
  "model", "brand", "internal", "external", "storage", "drive", "solid", "state",
  "disk", "ssd", "hdd", "memory", "ram", "graphics", "card", "cooler", "cooling",
  "fan", "fans", "case", "casing", "power", "supply", "keyboard", "mouse", "headset",
  "headphone", "monitor", "display", "motherboard", "processor", "cpu", "laptop",
  "chair", "controller", "cable", "adapter", "mechanical", "gaming"
]);

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
  const escaped = token.split(" ").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]+");
  return new RegExp("(?:^|[^a-z0-9])" + escaped + "(?:$|[^a-z0-9])", "i").test(filename);
}

function nameMatchesFilename(name, filename) {
  const normalizedName = normalize(name);
  if (normalizedName.length < 8) return false;
  if (filename === normalizedName || filename.startsWith(normalizedName + " ")) return true;

  // Product titles can be reordered or have a brand/prefix added by a retailer.
  // Require all distinctive title tokens to occur in the image filename, rather
  // than requiring the entire title to be the filename prefix.
  const tokens = normalizedName.split(" ").filter(token => token.length >= 2 && !GENERIC_NAME_WORDS.has(token));
  if (tokens.length < 2) return false;
  return tokens.every(token => hasDelimitedToken(filename, token));
}

function isDoneProduct(product, index) {
  if (!index || !Array.isArray(index.files) || !index.files.length) return false;
  const id = clean(product.id || product.ID);
  const sku = clean(product.sku || product.SKU);
  const name = clean(product.name || product.Name);
  return index.files.some(file => {
    if (id && hasDelimitedToken(file.normalized, id)) return true;
    if (sku && sku.length >= 3 && hasDelimitedToken(file.normalized, sku)) return true;
    return nameMatchesFilename(name, file.normalized);
  });
}

module.exports = { loadDoneImageIndex, isDoneProduct };
