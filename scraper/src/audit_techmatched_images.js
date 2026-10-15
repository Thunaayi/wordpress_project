const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_DIR = path.join(ROOT, "output");
const IMAGE_DIR = path.join(DATA_DIR, "images");
const INPUT_FILE = process.env.ENRICH_INPUT
  ? path.resolve(process.env.ENRICH_INPUT)
  : path.join(DATA_DIR, "wc-product-export-latest.csv");
const RESULTS_FILE = path.join(OUTPUT_DIR, "enriched_products.json");
const AUDIT_FILE = path.join(OUTPUT_DIR, "techmatched_image_audit.csv");
const argv = process.argv.slice(2);
const RESCRAPE = argv.includes("--rescrape");
const LIMIT = Number((argv.find(a => a.startsWith("--limit=")) || "").split("=")[1] || process.env.ENRICH_LIMIT || 0);

function clean(v) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function norm(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function key(p) { return clean(p.id || p.ID || p.sku || p.SKU) || norm(p.name || p.Name); }
function csv(v) { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function writeCsv(file, headers, rows) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(file, [headers, ...rows].map(row => row.map(csv).join(",")).join("\n") + "\n", "utf8");
}
function imageDims(buf) {
  try {
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xff) { o++; continue; }
        const m = buf[o + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4,0xc8,0xcc].includes(m)) return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
        const len = buf.readUInt16BE(o + 2);
        if (!len) break;
        o += 2 + len;
      }
    }
  } catch {}
  return null;
}
function imageFamily(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // Collapse WordPress generated size suffixes and known resize-only query params
    // for comparison; keep the original URL separately for actual downloading.
    u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp|avif|gif)$)/i, "");
    for (const k of [...u.searchParams.keys()]) if (/^(w|h|width|height|resize|fit|quality|q|crop|zoom)$/i.test(k)) u.searchParams.delete(k);
    return u.origin + u.pathname + (u.search ? u.search : "");
  } catch { return url; }
}
function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) throw new Error("Missing output/enriched_products.json. Run the scraper first.");
  const parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : (parsed.results || parsed.products || []);
  return { parsed, rows };
}
function loadEligibleIds() {
  if (!fs.existsSync(INPUT_FILE)) throw new Error("Original WooCommerce export not found: " + INPUT_FILE);
  const rows = parse(fs.readFileSync(INPUT_FILE, "utf8"), { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
  const noImage = v => !clean(v) || /^(none|null|n\/a|na|no image|no images|not available|-)$/i.test(clean(v));
  return new Set(rows.filter(r => noImage(r.Images || r.images)).map(r => key({ id: r.ID || r.id, sku: r.SKU || r.sku, name: r.Name || r.name })));
}
function getLocalFiles(images) {
  return (Array.isArray(images) ? images : []).map(value => {
    const rel = clean(value).replace(/\\/g, "/");
    const full = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
    return { reference: value, full };
  });
}
async function fetchBinary(url, referer) {
  const client = url.startsWith("https:") ? require("https") : require("http");
  return new Promise((resolve, reject) => {
    const req = client.get(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/124 Safari/537.36", Referer: referer || url, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" } }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (url.split("/").length > 12) return reject(new Error("Too many image redirects"));
        return fetchBinary(new URL(res.headers.location, url).href, referer).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(25000, () => req.destroy(new Error("image request timeout")));
    req.on("error", reject);
  });
}
function slug(v) { return norm(v).replace(/\s+/g, "-").slice(0, 100) || "product"; }
function ext(url) {
  try { const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|avif|gif)$/i); return m ? m[0].toLowerCase() : ".jpg"; } catch { return ".jpg"; }
}
async function extractTechMatchedImages(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => document.readyState === "complete" || document.readyState === "interactive", { timeout: 5000 }).catch(() => {});
  return page.evaluate(() => {
    const candidates = [];
    const add = (value, rank, alt) => {
      if (!value || /^(data:|blob:|javascript:)/i.test(value)) return;
      try { candidates.push({ url: new URL(value, location.href).href, rank, alt: alt || "" }); } catch {}
    };
    const blocked = /(logo|icon|favicon|sprite|placeholder|no[-_ ]?image|loader|spinner|avatar|payment|trustpilot|whatsapp|facebook|instagram|twitter|youtube|badge|seal|captcha|wishlist|zoom-button)/i;
    const gallerySelectors = [
      ".woocommerce-product-gallery__wrapper img",
      ".woocommerce-product-gallery img",
      ".product-gallery img",
      ".product-images img",
      ".product-image-gallery img",
      ".images img",
      "img.wp-post-image"
    ];
    for (const selector of gallerySelectors) {
      document.querySelectorAll(selector).forEach(img => {
        const alt = [img.alt, img.title, img.className, img.id].join(" ");
        if (blocked.test(alt)) return;
        const values = [
          [img.getAttribute("data-large_image"), 100],
          [img.getAttribute("data-large-image"), 98],
          [img.getAttribute("data-full"), 96],
          [img.getAttribute("data-zoom-image"), 94],
          [img.getAttribute("data-src"), 80],
          [img.getAttribute("data-lazy-src"), 78],
          [img.currentSrc, 70],
          [img.getAttribute("src"), 60]
        ];
        for (const [value, rank] of values) add(value, rank, alt);
        for (const attr of ["data-srcset", "srcset"]) {
          const srcset = img.getAttribute(attr);
          if (srcset) {
            const options = srcset.split(",").map(part => {
              const pieces = part.trim().split(/\s+/);
              const width = Number((pieces[1] || "").replace(/w$/, "")) || 0;
              return { url: pieces[0], width };
            }).sort((a,b) => b.width-a.width);
            if (options[0]) add(options[0].url, 85 + Math.min(options[0].width / 10000, 5), alt);
          }
        }
      });
    }
    // Include only image links inside product gallery containers, not every image link on the page.
    document.querySelectorAll(".woocommerce-product-gallery a[href], .product-gallery a[href], .product-images a[href], .images a[href]").forEach(a => {
      if (blocked.test([a.title, a.className, a.getAttribute("aria-label")].join(" "))) return;
      if (/\.(jpe?g|png|webp|avif|gif)(?:\?|$)/i.test(a.href)) add(a.href, 90, a.title || "");
    });
    const seen = new Set();
    return candidates.sort((a,b) => b.rank-a.rank).filter(item => {
      if (blocked.test(item.url) || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  });
}
async function main() {
  const { parsed, rows } = loadResults();
  const eligible = loadEligibleIds();
  const targets = rows.filter(r => clean(r.source).toLowerCase().includes("techmatched") && r.sourceUrl && eligible.has(key(r)));
  const selected = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  console.log("TechMatched products found in saved results and still eligible: " + targets.length);
  console.log("Mode: " + (RESCRAPE ? "targeted rescrape (does not delete old images)" : "read-only audit"));
  if (RESCRAPE && !selected.length) { console.log("No eligible TechMatched products to rescrape."); return; }

  const imageOwners = new Map();
  const productRows = [];
  const fileHashes = new Map();
  for (const product of selected) {
    const localFiles = getLocalFiles(product.images);
    const details = [];
    for (const item of localFiles) {
      let exists = fs.existsSync(item.full);
      let hash = "", size = 0, dimensions = "";
      if (exists) {
        try {
          const buf = fs.readFileSync(item.full);
          hash = crypto.createHash("sha256").update(buf).digest("hex");
          size = buf.length;
          const d = imageDims(buf);
          dimensions = d ? d.width + "x" + d.height : "unknown";
          const group = fileHashes.get(hash) || [];
          group.push({ product: product.name, id: product.id || product.sku, path: item.reference, size, dimensions });
          fileHashes.set(hash, group);
        } catch {}
      }
      details.push({ reference: item.reference, exists, hash, size, dimensions });
      if (hash) {
        const owners = imageOwners.get(hash) || [];
        owners.push({ product, reference: item.reference });
        imageOwners.set(hash, owners);
      }
    }
    productRows.push({ product, details });
  }

  if (RESCRAPE) {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"] });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    const refreshed = new Map();
    for (const product of selected) {
      console.log("\nRescraping images: " + product.name + " | " + product.sourceUrl);
      try {
        const candidates = await extractTechMatchedImages(page, product.sourceUrl);
        const familySeen = new Set();
        const hashSeen = new Set();
        const saved = [];
        for (const candidate of candidates) {
          const family = imageFamily(candidate.url);
          if (familySeen.has(family)) continue;
          familySeen.add(family);
          try {
            const buffer = await fetchBinary(candidate.url, product.sourceUrl);
            if (buffer.length < 1200) continue;
            const dims = imageDims(buffer);
            if (dims && (dims.width < 180 || dims.height < 180)) continue;
            const digest = crypto.createHash("sha256").update(buffer).digest("hex");
            if (hashSeen.has(digest)) continue;
            hashSeen.add(digest);
            const filename = slug(product.name) + "-" + slug(product.id || product.sku || "product") + "-tm-" + saved.length + ext(candidate.url);
            const destination = path.join(IMAGE_DIR, filename);
            fs.mkdirSync(IMAGE_DIR, { recursive: true });
            fs.writeFileSync(destination, buffer);
            saved.push("data/images/" + filename);
            if (saved.length >= 8) break;
          } catch (error) {
            console.log("  image skipped: " + candidate.url + " (" + error.message + ")");
          }
        }
        if (saved.length) {
          // Preserve a backup of the prior image list and all other product fields.
          product.techmatchedPreviousImages = product.images || [];
          product.images = saved;
          product.techmatchedImageRefresh = { refreshedAt: new Date().toISOString(), sourceUrl: product.sourceUrl, count: saved.length };
          if (product.status === "MATCHED" && saved.length < 1) product.status = "PARTIAL";
          refreshed.set(key(product), product);
          console.log("  Saved " + saved.length + " filtered, size-deduplicated image(s). Previous files were retained.");
        } else {
          console.log("  No acceptable gallery images downloaded; existing references left unchanged.");
        }
      } catch (error) {
        console.log("  Page extraction failed; existing references left unchanged: " + error.message);
      }
    }
    await browser.close();
    if (refreshed.size) {
      const merged = new Map(rows.map(r => [key(r), r]));
      for (const [k, value] of refreshed) merged.set(k, value);
      const outputRows = [...merged.values()];
      if (Array.isArray(parsed)) fs.writeFileSync(RESULTS_FILE, JSON.stringify(outputRows, null, 2));
      else fs.writeFileSync(RESULTS_FILE, JSON.stringify({ ...parsed, generatedAt: new Date().toISOString(), total: outputRows.length, results: outputRows }, null, 2));
      console.log("Updated enriched_products.json for " + refreshed.size + " product(s). Other product fields/results were preserved.");
      console.log("Run npm run audit:techmatched-images to refresh the audit after reviewing the new images.");
    }
  }

  // Report current post-rescrape state when requested, otherwise current saved state.
  const latest = loadResults().rows.filter(r => clean(r.source).toLowerCase().includes("techmatched") && r.sourceUrl && eligible.has(key(r)));
  const reportRows = [];
  const exact = new Map();
  for (const product of latest) {
    for (const item of getLocalFiles(product.images)) {
      let hash = "", size = "", dimensions = "", issue = "";
      if (!fs.existsSync(item.full)) issue = "LOCAL_FILE_MISSING";
      else {
        const buf = fs.readFileSync(item.full);
        hash = crypto.createHash("sha256").update(buf).digest("hex");
        size = buf.length;
        const d = imageDims(buf);
        dimensions = d ? d.width + "x" + d.height : "unknown";
        const group = exact.get(hash) || [];
        group.push({ product, path: item.reference, size, dimensions });
        exact.set(hash, group);
      }
      reportRows.push([product.id || "", product.sku || "", product.name || "", product.sourceUrl || "", item.reference, issue || "OK", hash, size, dimensions, product.images?.length || 0, product.techmatchedImageRefresh?.refreshedAt || ""]);
    }
  }
  for (const [hash, group] of exact) {
    if (group.length < 2) continue;
    for (const entry of group) {
      reportRows.push([entry.product.id || "", entry.product.sku || "", entry.product.name || "", entry.product.sourceUrl || "", entry.path, "EXACT_DUPLICATE_HASH shared by " + group.length + " references", hash, entry.size, entry.dimensions, entry.product.images?.length || 0, entry.product.techmatchedImageRefresh?.refreshedAt || ""]);
    }
  }
  writeCsv(AUDIT_FILE, ["Product ID","SKU","Product name","TechMatched URL","Image file","Issue","SHA-256","Bytes","Dimensions","Image count","Last targeted rescrape"], reportRows);
  console.log("Audit report: " + AUDIT_FILE);
  console.log("Products audited: " + latest.length + " | image references: " + reportRows.length);
  console.log("Audit is read-only unless --rescrape was explicitly supplied. Old image files are never deleted.");
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
