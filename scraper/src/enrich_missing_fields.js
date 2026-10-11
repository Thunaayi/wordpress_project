const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_DIR = path.join(ROOT, "output");
const INPUT_FILE = process.env.ENRICH_INPUT
  ? path.resolve(process.env.ENRICH_INPUT)
  : path.join(DATA_DIR, "wc-product-export-latest.csv");
const RESULTS_FILE = path.join(OUTPUT_DIR, "enriched_products.json");
const STATUS_FILE = path.join(OUTPUT_DIR, "field_enrichment_status.csv");

function argValue(name, fallback = "") {
  const prefix = "--" + name + "=";
  const arg = process.argv.slice(2).find(value => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const LIMIT = Math.max(0, Number(argValue("limit", process.env.ENRICH_LIMIT || 0)));
const START = Math.max(0, Number(argValue("start", process.env.ENRICH_START || 0)));
const RETRY_DESCRIPTION = process.argv.includes("--retry-description");
const RETRY_SPECS = process.argv.includes("--retry-specs");
const RETRY_ALL = process.argv.includes("--retry-all");
const NAV_TIMEOUT = Math.max(10000, Number(process.env.ENRICH_NAV_TIMEOUT || 35000));

function clean(value) {
  return String(value ?? "").replace(/\\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function productKey(product) {
  return clean(product.id || product.ID || product.sku || product.SKU) || normalize(product.name || product.Name);
}

function hasImageValue(value) {
  const imageValue = clean(value);
  return Boolean(imageValue) && !/^(none|null|n\\/a|na|no image|no images|not available|-)$/i.test(imageValue);
}

function loadInventory() {
  if (!fs.existsSync(INPUT_FILE)) throw new Error("Input CSV not found: " + INPUT_FILE);
  const rows = parse(fs.readFileSync(INPUT_FILE, "utf8"), {
    columns: true, skip_empty_lines: true, relax_column_count: true, bom: true
  });
  const imageState = new Map();
  for (const row of rows) {
    const key = productKey(row);
    if (!key) continue;
    imageState.set(key, hasImageValue(row.Images || row.images));
  }
  return imageState;
}

function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) {
    throw new Error("Missing " + RESULTS_FILE + ". Run the main enrichment scraper first.");
  }
  const parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
  const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.products || []);
  if (!Array.isArray(results)) throw new Error("Unexpected enrichment JSON shape.");
  return { parsed, results };
}

function isUsefulText(value) {
  const text = clean(value);
  return text.length >= 30 &&
    !/^(description|product description|read more|show more|add to cart|buy now)$/i.test(text);
}

function chooseLonger(current, candidate) {
  const a = clean(current);
  const b = clean(candidate);
  if (!isUsefulText(b)) return a;
  if (!a) return b;
  return b.length > a.length ? b : a;
}

async function extractDetails(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForFunction(
    () => document.readyState === "complete" || document.readyState === "interactive",
    { timeout: 5000 }
  ).catch(() => {});

  return page.evaluate(() => {
    const text = element => (element?.innerText || element?.textContent || "")
      .replace(/\\u00a0/g, " ").replace(/\\s+/g, " ").trim();
    const meta = selector => document.querySelector(selector)?.content || "";
    const firstText = selectors => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const value = text(element);
        if (value.length >= 30) return value;
      }
      return "";
    };

    const structuredProducts = [];
    const walkJson = value => {
      if (!value) return;
      if (Array.isArray(value)) return value.forEach(walkJson);
      if (typeof value !== "object") return;
      const type = value["@type"];
      if ((Array.isArray(type) ? type : [type]).some(item => String(item || "").toLowerCase() === "product")) {
        structuredProducts.push(value);
      }
      if (value["@graph"]) walkJson(value["@graph"]);
      if (value.mainEntity) walkJson(value.mainEntity);
      if (value.itemListElement) walkJson(value.itemListElement);
    };
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try { walkJson(JSON.parse(script.textContent)); } catch {}
    });
    const product = structuredProducts[0] || {};

    const fullDescription = firstText([
      "#tab-description",
      "#description",
      ".woocommerce-Tabs-panel--description",
      ".woocommerce div.product .woocommerce-tabs #tab-description",
      "[itemprop='description']",
      ".product-description",
      ".product__description",
      ".product-detail-description",
      ".product-details-description",
      ".tab-content .description",
      ".description-tab",
      ".description"
    ]);

    const shortDescription = firstText([
      ".woocommerce-product-details__short-description",
      ".short-description",
      ".product-short-description",
      ".short_description",
      ".product-summary",
      ".summary .description"
    ]);

    const cleanHtml = value => String(value || "")
      .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, " ")
      .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">").replace(/\\s+/g, " ").trim();

    const description = fullDescription ||
      cleanHtml(product.description) ||
      clean(meta('meta[property="og:description"]')) ||
      clean(meta('meta[name="description"]'));

    const specs = {};
    const addSpec = (label, value) => {
      const key = text({ textContent: label }).replace(/[:：]+$/, "");
      const val = text({ textContent: value });
      if (!key || !val || key.length > 100 || val.length > 1000) return;
      if (/^(sku|price|availability|reviews?|add to cart|buy now)$/i.test(key)) return;
      if (!specs[key]) specs[key] = val;
    };

    document.querySelectorAll("table tr").forEach(row => {
      const cells = [...row.querySelectorAll("th,td")].map(text).filter(Boolean);
      if (cells.length >= 2) addSpec(cells[0], cells.slice(1).join(" | "));
    });
    document.querySelectorAll("dl").forEach(dl => {
      [...dl.querySelectorAll("dt")].forEach(dt => {
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName !== "DD") dd = dd.nextElementSibling;
        if (dd) addSpec(text(dt), text(dd));
      });
    });
    document.querySelectorAll(
      ".woocommerce-product-attributes-item,.product-attribute,.product_attribute,.attribute-row,.spec-row,.spec-item,.specification-row,.specification-item,.product-specs li,.specifications li,.technical-specifications li,.technical-specs li"
    ).forEach(row => {
      const label = row.querySelector("th,.label,.name,[class*='label'],[class*='name']");
      const value = row.querySelector("td,.value,[class*='value']");
      if (label && value) addSpec(text(label), text(value));
      else {
        const match = text(row).match(/^([^:：|]{2,100})\\s*[:：|]\\s*(.{2,1000})$/);
        if (match) addSpec(match[1], match[2]);
      }
    });

    const addProperties = value => {
      if (!value || typeof value !== "object") return;
      const properties = value.additionalProperty;
      for (const property of (Array.isArray(properties) ? properties : properties ? [properties] : [])) {
        if (property && typeof property === "object") {
          addSpec(property.name || property.propertyID, property.value);
        }
      }
    };
    structuredProducts.forEach(addProperties);

    const descriptionText = value => cleanHtml(value);
    return {
      title: firstText(["h1.product_title", "h1.product-title", "h1.product-name", "h1"]) || product.name || document.title || "",
      description: descriptionText(description),
      shortDescription: descriptionText(shortDescription),
      specs,
      sourceUrl: location.href
    };
  });
}

function missingDescription(product) {
  return !clean(product.description);
}

function missingSpecs(product) {
  return !product.specs || typeof product.specs !== "object" || Object.keys(product.specs).length === 0;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const imageState = loadInventory();
  const { parsed, results } = loadResults();

  // The original WooCommerce export is authoritative for the safety rule.
  // Never open a product page if its original Images field is already populated.
  const safeResults = results.filter(product => {
    const key = productKey(product);
    return key && imageState.get(key) === false;
  });

  const targets = safeResults.filter(product => {
    const descriptionMissing = missingDescription(product);
    const specsMissing = missingSpecs(product);
    if (RETRY_ALL) return true;
    if (RETRY_DESCRIPTION && descriptionMissing) return true;
    if (RETRY_SPECS && specsMissing) return true;
    if (RETRY_DESCRIPTION || RETRY_SPECS) return false;
    return descriptionMissing || specsMissing;
  });

  let batch = targets.slice(START);
  if (LIMIT > 0) batch = batch.slice(0, LIMIT);

  console.log("=== Independent description/specification enrichment ===");
  console.log("Inventory records: " + imageState.size);
  console.log("Products with existing WooCommerce images (excluded): " + [...imageState.values()].filter(Boolean).length);
  console.log("Safe image-missing results: " + safeResults.length);
  console.log("Records needing selected extraction: " + targets.length);
  console.log("This batch: " + batch.length);

  if (!batch.length) {
    console.log("No eligible records in this batch.");
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run"],
    defaultViewport: { width: 1440, height: 1000 }
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (["font", "media"].includes(request.resourceType())) request.abort();
    else request.continue();
  });

  const byKey = new Map(results.map(product => [productKey(product), product]));
  const audit = [];
  try {
    for (let index = 0; index < batch.length; index++) {
      const product = batch[index];
      const key = productKey(product);
      const sourceUrl = clean(product.sourceUrl || product.candidateUrl);
      console.log("\\n[" + (index + 1) + "/" + batch.length + "] " + (product.name || key));

      const row = {
        id: product.id || "", sku: product.sku || "", name: product.name || "",
        sourceUrl, descriptionBefore: Boolean(clean(product.description)),
        specsBefore: Object.keys(product.specs || {}).length,
        descriptionAfter: Boolean(clean(product.description)),
        specsAfter: Object.keys(product.specs || {}).length,
        status: "", error: ""
      };

      if (!sourceUrl) {
        row.status = "NO_SOURCE_URL";
        row.error = "No saved matched product URL; run the main matcher for this product first.";
        audit.push(row);
        console.log("  SKIP: no saved matched URL");
        continue;
      }

      try {
        const extracted = await extractDetails(page, sourceUrl);
        const oldDescription = clean(product.description);
        const oldShortDescription = clean(product.shortDescription);
        const newDescription = clean(extracted.description);
        const newShortDescription = clean(extracted.shortDescription);

        // Preserve existing non-empty fields; only replace an empty field, or
        // replace with a demonstrably more complete full description.
        if (!oldDescription && newDescription) {
          product.description = newDescription;
        } else if (oldDescription && newDescription.length > oldDescription.length * 1.25) {
          product.description = newDescription;
        }
        if (!oldShortDescription && newShortDescription) {
          product.shortDescription = newShortDescription;
        }

        const oldSpecs = product.specs && typeof product.specs === "object" ? product.specs : {};
        product.specs = { ...oldSpecs, ...(extracted.specs || {}) };
        product.sourceUrl = extracted.sourceUrl || sourceUrl;
        product.descriptionExtraction = {
          attemptedAt: new Date().toISOString(),
          sourceUrl: product.sourceUrl,
          descriptionFound: Boolean(clean(product.description)),
          shortDescriptionFound: Boolean(clean(product.shortDescription)),
          specsFound: Object.keys(product.specs).length,
          title: extracted.title || ""
        };

        const missing = [];
        if (!clean(product.description)) missing.push("description");
        if (!Object.keys(product.specs).length) missing.push("specifications");
        if (!(product.images || []).length) missing.push("images");
        product.status = missing.length ? "PARTIAL" : "MATCHED";
        product.reason = missing.length ? "Missing: " + missing.join(", ") : "";

        row.descriptionAfter = Boolean(clean(product.description));
        row.specsAfter = Object.keys(product.specs).length;
        row.status = missing.length ? "PARTIAL" : "UPDATED";
        console.log("  description: " + (row.descriptionAfter ? "yes" : "missing") + " | specs: " + row.specsAfter);
      } catch (error) {
        row.status = "ERROR";
        row.error = error.message || String(error);
        product.descriptionExtraction = {
          attemptedAt: new Date().toISOString(),
          sourceUrl,
          error: row.error
        };
        console.log("  ERROR: " + row.error);
      }

      audit.push(row);
      // Checkpoint after every product so interrupted runs can safely resume.
      const output = Array.isArray(parsed) ? [...byKey.values()] : {
        ...parsed, generatedAt: new Date().toISOString(),
        total: byKey.size, results: [...byKey.values()]
      };
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
    }
  } finally {
    await browser.close();
  }

  const headers = ["ID", "SKU", "Name", "Source URL", "Description before", "Description after", "Specs before", "Specs after", "Status", "Error"];
  const lines = [headers.join(",")];
  for (const row of audit) {
    lines.push([
      row.id, row.sku, row.name, row.sourceUrl, row.descriptionBefore ? "YES" : "NO",
      row.descriptionAfter ? "YES" : "NO", row.specsBefore, row.specsAfter, row.status, row.error
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(STATUS_FILE, lines.join("\\n") + "\\n");
  console.log("\\nSaved updated results: " + RESULTS_FILE);
  console.log("Field audit: " + STATUS_FILE);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
