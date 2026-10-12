const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_DIR = path.join(ROOT, "output");
const INPUT_FILE = process.env.ENRICH_INPUT
  ? path.resolve(process.env.ENRICH_INPUT)
  : path.join(DATA_DIR, "wc-product-export-latest.csv");
const RESULTS_FILE = path.join(OUTPUT_DIR, "enriched_products.json");
const AUDIT_CSV = path.join(OUTPUT_DIR, "product_quality_audit.csv");
const QUEUE_CSV = path.join(OUTPUT_DIR, "rescrape_queue.csv");

const GENERIC = new Set([
  "the","and","for","with","from","pakistan","price","in","new","latest","gaming",
  "computer","computers","pc","desktop","black","white","wireless","wired","original",
  "official","product","products","series","edition","version","model","brand",
  "internal","external","storage","drive","solid","state","disk","ssd","hdd",
  "memory","ram","graphics","card","cooler","cooling","fan","fans","case","casing",
  "power","supply","keyboard","mouse","headset","headphone","monitor","display",
  "motherboard","processor","cpu","laptop","chair","controller","cable","adapter"
]);

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normalize(value) { return clean(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function key(value) { return clean(value.id || value.ID || value.sku || value.SKU) || normalize(value.name || value.Name); }
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, headers, rows) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(file, [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\n") + "\n", "utf8");
}
function hasImageValue(value) {
  const s = clean(value);
  return Boolean(s) && !/^(none|null|n\/a|na|no image|no images|not available|-)$/i.test(s);
}
function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : (parsed.results || parsed.products || []);
  return new Map(rows.map(row => [key(row), row]));
}
function tokens(value) {
  return [...new Set(normalize(value).split(" ").filter(token => token.length > 1 && !GENERIC.has(token)))];
}
function criticalTokens(value) {
  return tokens(value).filter(token => /\d/.test(token) || /^(rtx|gtx|rx|ryzen|core|ultra|pro|xt|xtx|ti|super|oc|nvme|pcie|ddr[3456]|wifi|usb|m2|gen[2345])$/.test(token));
}
function nameScore(target, source) {
  const a = tokens(target), b = tokens(source);
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const targetCritical = criticalTokens(target);
  const sourceCritical = new Set(criticalTokens(source));
  // A different model number/capacity is not a close match; it is a rejection.
  if (targetCritical.some(token => /\\d/.test(token) && !sourceCritical.has(token))) return 0;
  const intersection = a.filter(token => setB.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const score = union ? intersection / union : 0;
  return Number(score.toFixed(4));
}
function descriptionHasStructuredSpecs(value) {
  const raw = String(value ?? "");
  if (!raw.trim()) return false;
  const tableRows = [...raw.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .filter(([, row]) => [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].length >= 2);
  if (tableRows.length >= 2) return true;
  const definitionPairs = [...raw.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>[\s\S]{0,500}?<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)]
    .filter(([, label, content]) => clean(label.replace(/<[^>]+>/g, "")) && clean(content.replace(/<[^>]+>/g, "")));
  if (definitionPairs.length >= 2) return true;

  const plain = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:tr|td|th|li|p|div|dd|dt|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const labelled = plain.split(/[\n|•;]/).map(clean).filter(line =>
    /^[^:：]{2,55}\s*[:：]\s*\S{1,}/.test(line)
  );
  const technical = (plain.match(/\b\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|ghz|mhz|gb|tb|mb|w|watts?|rpm|°c|°f|v|volts?|ports?|cores?|threads?|ddr[3456]|pcie|usb\s*[\d.]|wi-?fi|bluetooth|atx|matx|mini-itx|am5|lga\s*\d+)\b/gi) || []).length;
  const hasSpecHeading = /\b(specifications?|technical details?|product details|features)\b/i.test(plain);
  return labelled.length >= 2 || technical >= 3 || (hasSpecHeading && technical >= 1);
}

function imageReferenceIssues(images, productName, productId) {
  const issues = [];
  const list = Array.isArray(images) ? images : (images ? String(images).split(/[,\n]/).map(clean).filter(Boolean) : []);
  const seen = new Set();
  for (const image of list) {
    const reference = clean(image);
    if (!reference) continue;
    const normalizedRef = normalize(reference);
    if (seen.has(normalizedRef)) issues.push("DUPLICATE_IMAGE_REFERENCE");
    seen.add(normalizedRef);

    if (/^https?:\/\//i.test(reference)) continue;
    const relative = reference.replace(/^[.][/\\]/, "");
    const fullPath = path.resolve(ROOT, relative);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      issues.push("LOCAL_IMAGE_FILE_MISSING:" + reference);
      continue;
    }

    const base = path.basename(fullPath, path.extname(fullPath));
    const baseNorm = normalize(base);
    const opaque = /^(product|image|img)[ _-]?\d+([ _-]\d+)?$/i.test(base);
    const id = clean(productId);
    const filenameScore = nameScore(productName, base);
    if (opaque || (filenameScore < 0.18 && (!id || !base.includes(id)))) {
      issues.push("IMAGE_FILENAME_NOT_DESCRIPTIVE:" + reference);
    }
  }
  if (!list.length) issues.push("NO_IMAGES");
  return [...new Set(issues)];
}
function main() {
  if (!fs.existsSync(INPUT_FILE)) throw new Error("Original inventory CSV not found: " + INPUT_FILE);
  const inventoryRows = parse(fs.readFileSync(INPUT_FILE, "utf8"), {
    columns: true, skip_empty_lines: true, relax_column_count: true, bom: true
  });
  const enriched = loadResults();
  const auditHeaders = ["ID","SKU","Name","Category","Original image status","Prior status","Source","Source product name","Name score","Image count","Specs object count","Structured specs in description","Description present","Image issues","Audit decision","Retry reasons","Source URL"];
  const queueHeaders = ["ID","SKU","Name","Category","Reason","Prior status","Source URL","Name score","Specs count","Image count"];
  const auditRows = [], queueRows = [];
  let excludedWithImages = 0;

  for (const raw of inventoryRows) {
    const name = clean(raw.Name || raw.name);
    if (!name) continue;
    const product = {
      id: clean(raw.ID || raw.id),
      sku: clean(raw.SKU || raw.sku),
      name,
      category: clean(raw.Categories || raw.Category || raw.category),
      hasImage: hasImageValue(raw.Images || raw.images)
    };
    if (product.hasImage) {
      excludedWithImages++;
      continue;
    }

    const result = enriched.get(key(product)) || enriched.get(key(raw)) || {};
    const sourceName = clean(result.sourceName || result.candidateName);
    const score = nameScore(product.name, sourceName);
    const specs = result.specs && typeof result.specs === "object" ? result.specs : {};
    const specsCount = Object.keys(specs).filter(k => clean(specs[k])).length;
    const descriptionPresent = Boolean(clean(result.description || result.shortDescription));
    const embeddedSpecs = descriptionHasStructuredSpecs(result.description || result.shortDescription);
    const images = Array.isArray(result.images) ? result.images : [];
    const imageIssues = imageReferenceIssues(images, product.name, product.id);
    const reasons = [];

    if (!sourceName) reasons.push("SOURCE_PRODUCT_NAME_MISSING");
    else if (score < 0.28) reasons.push("SOURCE_PRODUCT_NAME_MISMATCH");
    if (!specsCount && !embeddedSpecs) reasons.push("SCRAPED_SPECS_MISSING");
    if (!descriptionPresent) reasons.push("SCRAPED_DESCRIPTION_MISSING");
    if (!images.length) reasons.push("SCRAPED_IMAGES_MISSING");
    for (const issue of imageIssues) {
      if (issue.startsWith("LOCAL_IMAGE_FILE_MISSING:")) reasons.push("LOCAL_IMAGE_FILE_MISSING");
      else if (issue.startsWith("IMAGE_FILENAME_NOT_DESCRIPTIVE:")) reasons.push("IMAGE_FILENAME_NOT_DESCRIPTIVE");
      else reasons.push(issue);
    }
    if (!result.status || ["NO_MATCH","ERROR","PENDING","PARTIAL"].includes(String(result.status).toUpperCase())) {
      reasons.push("STATUS_" + (String(result.status || "UNPROCESSED").toUpperCase()));
    }

    const uniqueReasons = [...new Set(reasons)];
    const decision = uniqueReasons.length ? "REVIEW_AND_RETRY" : "PASS";
    const sourceUrl = clean(result.sourceUrl || result.candidateUrl);
    auditRows.push([
      product.id,product.sku,product.name,product.category,"MISSING_IMAGE",
      result.status || "UNPROCESSED",result.source || "",sourceName,score,images.length,specsCount,
      embeddedSpecs ? "YES" : "NO",descriptionPresent ? "YES" : "NO",imageIssues.join(" | "),decision,uniqueReasons.join(" | "),sourceUrl
    ]);
    if (uniqueReasons.length) {
      queueRows.push([
        product.id,product.sku,product.name,product.category,uniqueReasons.join(" | "),
        result.status || "UNPROCESSED",sourceUrl,score,specsCount,images.length
      ]);
    }
  }

  writeCsv(AUDIT_CSV, auditHeaders, auditRows);
  writeCsv(QUEUE_CSV, queueHeaders, queueRows);
  const pass = auditRows.filter(row => row[14] === "PASS").length;
  console.log("=== Product quality audit (read-only) ===");
  console.log("Original inventory rows inspected: " + inventoryRows.length);
  console.log("Products excluded because original Images field is populated: " + excludedWithImages);
  console.log("Image-missing products audited: " + auditRows.length);
  console.log("Passed quality checks: " + pass);
  console.log("Needs review/re-scrape: " + queueRows.length);
  console.log("Quality report: " + AUDIT_CSV);
  console.log("Re-scrape queue: " + QUEUE_CSV);
  console.log("No website requests were made. No source inventory or image files were changed.");
}
main();
