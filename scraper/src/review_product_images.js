const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "output");
const IMAGE_DIR = path.join(DATA, "images");
const RESULTS = path.join(OUT, "enriched_products.json");
const QUEUE = path.join(OUT, "image_review_queue.csv");
const APPLY = process.argv.includes("--apply");
const COLOR = new Set(["black","white","red","blue","navy","lime","green","pink","purple","violet","yellow","orange","silver","gray","grey","beige","cream","brown","gold"]);
const clean = v => String(v ?? "").replace(/\s+/g, " ").trim();
const norm = v => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const key = p => clean(p.id || p.ID || p.sku || p.SKU) || norm(p.name || p.Name);
const csv = v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const writeCsv = (file, headers, rows) => fs.writeFileSync(file, [headers, ...rows].map(r => r.map(csv).join(",")).join("\n") + "\n", "utf8");
function localPath(ref) { const s = clean(ref).replace(/\\/g, "/"); return path.isAbsolute(s) ? s : path.resolve(ROOT, s); }
function readRows() {
  if (!fs.existsSync(RESULTS)) throw new Error("Missing output/enriched_products.json");
  const parsed = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  return { parsed, rows: Array.isArray(parsed) ? parsed : (parsed.results || parsed.products || []) };
}
function imageText(ref) { return norm(path.basename(clean(ref))); }
function colors(s) { return new Set(norm(s).split(" ").filter(w => COLOR.has(w)).map(w => w === "grey" ? "gray" : w)); }
function scan(rows) {
  const hashOwners = new Map();
  for (const product of rows) for (const ref of (Array.isArray(product.images) ? product.images : [])) {
    const p = localPath(ref);
    if (!fs.existsSync(p)) continue;
    try {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      const owners = hashOwners.get(hash) || [];
      owners.push({ product, ref });
      hashOwners.set(hash, owners);
    } catch {}
  }
  const headers = ["Product ID","SKU","Product name","Image order (1=cover)","Image path","SHA-256","Issue","Action","Notes"];
  const report = [];
  for (const product of rows) {
    const images = Array.isArray(product.images) ? product.images : [];
    images.forEach((ref, index) => {
      const p = localPath(ref);
      let hash = "";
      try { if (fs.existsSync(p)) hash = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } catch {}
      const duplicateOwners = hash ? hashOwners.get(hash) || [] : [];
      const issues = [];
      if (!fs.existsSync(p)) issues.push("MISSING_FILE");
      const productColors = colors(product.name);
      const fileColors = colors(path.basename(clean(ref)));
      if (productColors.size === 1 && fileColors.size === 1 && [...productColors][0] !== [...fileColors][0]) issues.push("FILENAME_COLOR_CONFLICT");
      if (/(rear|back|port|connector|motherboard|usb|io|i-o)/i.test(norm(path.basename(clean(ref))) ) && /(port|io|i-o|rear|back|connector|detail|close up|shield)/i.test(norm(path.basename(clean(ref))))) issues.push("LIKELY_DETAIL_NOT_COVER");
      if (duplicateOwners.length > 1) issues.push("EXACT_DUPLICATE_BYTES");
      if (/(transparent|no[-_ ]?background|cutout|isolated|white[-_ ]?bg|white[-_ ]?background|transparent[-_ ]?bg)/i.test(norm(path.basename(clean(ref)))) issues.push("BACKGROUND_STYLE_REVIEW");
      if (!issues.length) issues.push("REVIEW_VISUALLY");
      report.push([product.id || "",product.sku || "",product.name || "",index+1,ref,hash,issues.join(";"),"", "Use KEEP, COVER, or REMOVE. REMOVE only unlinks the reference; it never deletes the file."]);
    });
  }
  writeCsv(QUEUE, headers, report);
  console.log("Wrote " + QUEUE + " with " + report.length + " image rows.");
  console.log("Open the CSV in Excel/LibreOffice. Fill Action with KEEP, COVER, or REMOVE, save it, then run npm run images:review -- --apply.");
}
function apply(rows, parsed) {
  if (!fs.existsSync(QUEUE)) throw new Error("Review queue missing; run without --apply first.");
  const instructions = parse(fs.readFileSync(QUEUE, "utf8"), { columns: true, skip_empty_lines: true, bom: true });
  const grouped = new Map();
  for (const row of instructions) {
    const action = clean(row.Action).toUpperCase();
    if (!action) continue;
    if (!["KEEP","COVER","REMOVE"].includes(action)) throw new Error("Invalid Action '" + action + "' for product " + row["Product ID"]);
    const id = clean(row["Product ID"]);
    const k = id || norm(row["Product name"]);
    const arr = grouped.get(k) || [];
    arr.push({ ...row, action });
    grouped.set(k, arr);
  }
  const backup = path.join(OUT, "enriched_products.before_image_review_" + new Date().toISOString().replace(/[:.]/g,"-") + ".json");
  fs.copyFileSync(RESULTS, backup);
  let changed = 0;
  for (const product of rows) {
    const actions = grouped.get(clean(product.id) || norm(product.name));
    if (!actions) continue;
    const byRef = new Map(actions.map(a => [clean(a["Image path"]), a.action]));
    const old = Array.isArray(product.images) ? product.images : [];
    let next = old.filter(ref => byRef.get(clean(ref)) !== "REMOVE");
    const coverRows = actions.filter(a => a.action === "COVER");
    if (coverRows.length > 1) throw new Error("Only one COVER action allowed per product: " + product.name + ". Backup made at " + backup);
    if (coverRows.length === 1) {
      const cover = clean(coverRows[0]["Image path"]);
      if (!next.some(ref => clean(ref) === cover)) throw new Error("Chosen cover is removed or not assigned to product " + product.name);
      next = [next.find(ref => clean(ref) === cover), ...next.filter(ref => clean(ref) !== cover)];
    }
    if (JSON.stringify(old) !== JSON.stringify(next)) { product.images = next; changed++; }
  }
  if (Array.isArray(parsed)) fs.writeFileSync(RESULTS, JSON.stringify(rows, null, 2));
  else {
    const field = Array.isArray(parsed.results) ? "results" : "products";
    fs.writeFileSync(RESULTS, JSON.stringify({ ...parsed, generatedAt: new Date().toISOString(), [field]: rows }, null, 2));
  }
  console.log("Updated image references for " + changed + " products. Files were not renamed or deleted.");
  console.log("Backup: " + backup);
  console.log("Regenerate any downstream import CSVs from enriched_products.json before importing into WooCommerce.");
}
try {
  fs.mkdirSync(OUT, { recursive: true });
  const { parsed, rows } = readRows();
  if (APPLY) apply(rows, parsed); else scan(rows);
} catch (error) { console.error(error.stack || error); process.exitCode = 1; }
