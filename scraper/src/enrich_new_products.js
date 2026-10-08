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

const argv = process.argv.slice(2);
function cliValue(name) {
  const prefix = "--" + name + "=";
  const arg = argv.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}
const LIMIT = Number(cliValue("limit") || process.env.ENRICH_LIMIT || 0);
const START = Number(cliValue("start") || process.env.ENRICH_START || 0);
const ALLOW_UNLIMITED = process.env.ENRICH_ALLOW_UNLIMITED === "1";
const ONLY_MISSING = process.env.ENRICH_ALL !== "1";
const STATUS_FILE = path.join(OUTPUT_DIR, "product_enrichment_status.csv");
const MASTER_JSON = path.join(OUTPUT_DIR, "product_enrichment_status.json");
const MIN_MATCH = Number(process.env.ENRICH_MIN_MATCH || 0.72);

const SOURCES = [
  { name: "czone.com.pk", domain: "czone.com.pk", search: q => "https://www.czone.com.pk/search.aspx?search=" + encodeURIComponent(q) },
  { name: "pclab.pk", domain: "pclab.pk", search: q => "https://pclab.pk/?s=" + encodeURIComponent(q) + "&post_type=product" },
  { name: "tech.com.pk", domain: "tech.com.pk", search: q => "https://tech.com.pk/?s=" + encodeURIComponent(q) + "&post_type=product" },
  { name: "techlad.pk", domain: "techlad.pk", search: q => "https://techlad.pk/?s=" + encodeURIComponent(q) + "&post_type=product" },
  { name: "zahcomputers.pk", domain: "zahcomputers.pk", search: q => "https://zahcomputers.pk/?s=" + encodeURIComponent(q) + "&post_type=product" },
  { name: "techmatched.pk", domain: "techmatched.pk", search: q => "https://techmatched.pk/?s=" + encodeURIComponent(q) + "&post_type=product" },
  { name: "zestrogaming.com", domain: "zestrogaming.com", search: q => "https://zestrogaming.com/?s=" + encodeURIComponent(q) + "&post_type=product" },
];

const GENERIC = new Set([
  "the","and","for","with","from","pakistan","price","in","new","latest","gaming",
  "computer","computers","pc","desktop","black","white","wireless","wired","original",
  "official","product","products","series","edition","version","model","brand",
  "internal","external","storage","drive","solid","state","disk","ssd","hdd",
  "memory","ram","graphics","card","cooler","cooling","fan","fans","case","casing",
  "power","supply","keyboard","mouse","headset","headphone","monitor","display",
  "motherboard","processor","cpu","laptop","chair","controller","cable","adapter"
]);

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function normalize(s) {
  return clean(s).toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(normalize(s).split(" ").filter(t => t.length >= 2 && !GENERIC.has(t)));
}

function criticalTokens(s) {
  return [...tokens(s)].filter(t =>
    /\d/.test(t) ||
    t.length >= 5 ||
    /^(rtx|gtx|rx|ryzen|core|ultra|pro|xt|xtx|ti|super|oc|nvme|pcie|ddr[3456]|wifi|usb|m2|gen[2345])$/.test(t)
  );
}

function extractCapacity(s) {
  const n = normalize(s);
  const m = n.match(/\b(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/);
  return m ? m[1] + m[2] : null;
}

function extractRam(s) {
  const n = normalize(s);
  const m = n.match(/\b(\d+|\d+\s*\+\s*\d+)\s*gb\s*(?:ddr[3456]|ram|memory)?\b/);
  return m ? m[1].replace(/\s+/g, "") + "gb" : null;
}

function modelTokens(s) {
  return criticalTokens(s).filter(t => /\d/.test(t) || /^(rtx|gtx|rx|ryzen|core|nvme|m2|pcie)/.test(t));
}

function scoreMatch(target, candidate) {
  const a = tokens(target);
  const b = tokens(candidate);
  if (!a.size || !b.size) return 0;

  const capA = extractCapacity(target);
  const capB = extractCapacity(candidate);
  if (capA && capB && capA !== capB) return 0;

  const ramA = extractRam(target);
  const ramB = extractRam(candidate);
  if (ramA && ramB && ramA !== ramB) return 0;

  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? intersection / union : 0;

  const ca = criticalTokens(target);
  const cb = new Set(criticalTokens(candidate));
  let criticalHit = 0;
  for (const t of ca) if (cb.has(t)) criticalHit++;
  const criticalCoverage = ca.length ? criticalHit / ca.length : jaccard;

  const ma = modelTokens(target);
  const mb = new Set(modelTokens(candidate));
  let modelHit = 0;
  for (const t of ma) if (mb.has(t)) modelHit++;
  const modelCoverage = ma.length ? modelHit / ma.length : criticalCoverage;

  const na = normalize(target);
  const nb = normalize(candidate);
  const containment = na === nb ? 1 : (na.includes(nb) || nb.includes(na) ? 0.98 : 0);

  return Math.max(containment, criticalCoverage * 0.55 + jaccard * 0.25 + modelCoverage * 0.20);
}

function queryVariants(name) {
  const all = normalize(name).split(" ").filter(Boolean);
  const important = all.filter(t => !GENERIC.has(t));
  const variants = [name];

  if (important.length >= 3) variants.push(important.slice(0, 8).join(" "));
  if (important.length >= 2) variants.push(important.slice(0, 5).join(" "));

  const model = important.filter(t => /\d/.test(t) || t.length >= 5).slice(0, 5);
  if (model.length >= 2) variants.push(model.join(" "));

  return [...new Set(variants.map(clean).filter(Boolean))];
}

function searchTermsForTarget(target) {
  const terms = [];
  if (target.sku && target.sku.length >= 4) terms.push(target.sku);
  terms.push(...queryVariants(target.name));
  return [...new Set(terms.map(clean).filter(Boolean))];
}

function looksLikeGenericProductName(name) {
  return /^(home|shop|products?|brands?|categories?|category|search|corsair|lian li|a4tech|zalman|cooler master|deepcool|asus|msi|gigabyte|kingston|logitech)$/i.test(clean(name));
}

function isProductUrl(href, domain) {
  try {
    const u = new URL(href);
    if (!u.hostname.includes(domain)) return false;
    if (/cart|checkout|my-account|login|wishlist|compare|feed|tag|category|categories|product-category|author|brand|brands|shop|search/i.test(u.pathname)) return false;
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function goto(page, url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (response && response.status() < 500) {
        await page.waitForFunction(
          () => document.readyState === "complete" || document.readyState === "interactive",
          { timeout: 5000 }
        ).catch(() => {});
        return response;
      }
      throw new Error("HTTP " + (response ? response.status() : "no response"));
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last || new Error("navigation failed");
}

async function searchSite(page, source, productName) {
  let best = null;

  for (const query of queryVariants(productName)) {
    try {
      await goto(page, source.search(query), 2);

      const links = await page.$$eval("a[href]", anchors => anchors.map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || a.getAttribute("title") || a.querySelector("img")?.alt || "").trim(),
        title: (a.getAttribute("title") || "").trim()
      })).filter(x => x.href));

      for (const item of links) {
        const candidateText = clean(item.text || item.title);
        if (!candidateText || !isProductUrl(item.href, source.domain)) continue;

        const score = scoreMatch(productName, candidateText);
        if (!best || score > best.score) {
          best = { url: item.href, score, matchedText: candidateText, source: source.name };
        }
      }

      if (best && best.score >= 0.92) return best;
    } catch (e) {}
  }

  return best;
}

async function webSearch(page, productName) {
  const q = productName.replace(/"/g, "");
  const engines = [
    "https://www.google.com/search?q=" + encodeURIComponent(q),
    "https://www.bing.com/search?q=" + encodeURIComponent(q)
  ];

  let best = null;

  for (const searchUrl of engines) {
    try {
      await goto(page, searchUrl, 2);
      const links = await page.$$eval("a[href]", anchors => anchors.map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || a.getAttribute("aria-label") || "").trim()
      })));

      for (const item of links) {
        if (!item.href || !item.text) continue;
        const source = SOURCES.find(s => isProductUrl(item.href, s.domain));
        if (!source) continue;
        const score = scoreMatch(productName, item.text);
        if (!best || score > best.score) {
          best = { url: item.href, score, matchedText: clean(item.text), source: source.name };
        }
      }

      if (best && best.score >= 0.85) return best;
    } catch (e) {}
  }

  return best;
}

async function extractProductOnce(page, url) {
  await goto(page, url, 3);

  const data = await page.evaluate(() => {
    const text = el => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const attr = (el, name) => el?.getAttribute(name) || "";
    const meta = name => document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]')?.content || "";

    const jsonLd = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const parsed = JSON.parse(s.textContent);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && typeof item === "object") {
            if (item["@graph"]) jsonLd.push(...item["@graph"]);
            else jsonLd.push(item);
          }
        }
      } catch {}
    });

    const products = jsonLd.filter(x => String(x["@type"] || "").toLowerCase().includes("product"));
    const p = products[0] || {};

    const firstText = selectors => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && text(el)) return text(el);
      }
      return "";
    };

    const description = firstText([
      ".woocommerce-product-details__short-description",
      ".short-description",
      ".product-short-description",
      ".product-description",
      ".description",
      ".product-details .description",
      ".product-desc",
      ".tab-content.description",
      "[itemprop='description']"
    ]) || meta("og:description") || meta("description") || p.description || "";

    const title = firstText([
      "h1.product_title",
      "h1.product-title",
      "h1.product-name",
      "h1.product_name",
      "[itemprop='name']",
      "h1"
    ]) || meta("og:title") || p.name || document.title || "";

    const specs = {};
    const addSpec = (label, value) => {
      label = text(label).replace(/[:：]+$/, "");
      value = text(value);
      if (!label || !value || label.length > 100 || value.length > 1000) return;
      if (/^(add to cart|buy now|reviews?|sku|price)$/i.test(label)) return;
      specs[label] = value;
    };

    document.querySelectorAll("table tr").forEach(row => {
      const cells = [...row.querySelectorAll("th,td")].map(text).filter(Boolean);
      if (cells.length >= 2) addSpec(cells[0], cells.slice(1).join(" "));
    });

    document.querySelectorAll("dl").forEach(dl => {
      [...dl.querySelectorAll("dt")].forEach(dt => {
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName !== "DD") dd = dd.nextElementSibling;
        if (dd) addSpec(dt, dd);
      });
    });

    document.querySelectorAll(".woocommerce-product-attributes-item,.product-attribute,.product_attribute,.attribute,.specification,.specifications li,.specs li,.product-specs li,.product-specification,.product-specifications li,.spec-row,.spec-item,.specification-row,.specification-item,.technical-specifications li,.technical-specs li,.product-details li,.product-info li,.accordion-item,.tab-pane li").forEach(row => {
      const cells = [...row.querySelectorAll("th,td,.label,.value,.name,.attribute-label,.attribute-value,.woocommerce-product-attributes-item__label,.woocommerce-product-attributes-item__value,[class*=\"label\"],[class*=\"value\"],[class*=\"name\"]")].map(text).filter(Boolean);
      if (cells.length >= 2) addSpec(cells[0], cells.slice(1).join(" "));
      else {
        const m = text(row).match(/^([^:：|]{2,100})\s*[:：|]\s*(.{2,1000})$/);
        if (m) addSpec(m[1], m[2]);
      }
    });

    [...document.querySelectorAll("h2,h3,h4,h5,strong,b")].filter(el => /specifications?|technical details?|product details?|features?/i.test(text(el))).forEach(heading => {
      let node = heading.nextElementSibling;
      for (let i = 0; node && i < 8; i++, node = node.nextElementSibling) {
        node.querySelectorAll?.("tr").forEach(row => {
          const cells = [...row.querySelectorAll("th,td")].map(text).filter(Boolean);
          if (cells.length >= 2) addSpec(cells[0], cells.slice(1).join(" "));
        });
        node.querySelectorAll?.("li").forEach(li => {
          const m = text(li).match(/^([^:：|]{2,100})\s*[:：|]\s*(.{2,1000})$/);
          if (m) addSpec(m[1], m[2]);
        });
      }
    });

    const imageCandidates = [];
    const pushImage = value => {
      if (!value) return;
      try { imageCandidates.push(new URL(value, location.href).href); } catch {}
    };

    const jsonImages = p.image;
    if (Array.isArray(jsonImages)) jsonImages.forEach(pushImage);
    else pushImage(jsonImages);

    pushImage(meta("og:image"));
    pushImage(meta("twitter:image"));

    document.querySelectorAll("img").forEach(img => {
      const altText = (attr(img, "alt") + " " + attr(img, "title") + " " + attr(img, "class")).toLowerCase();
      const width = Number(img.naturalWidth || img.width || 0);
      const height = Number(img.naturalHeight || img.height || 0);
      if (/(logo|favicon|icon|sprite|placeholder|no[-_ ]?image|loader|spinner|avatar|payment|trustpilot|whatsapp|facebook|instagram|twitter|youtube|badge|seal|captcha)/i.test(altText)) return;
      if (width > 0 && height > 0 && (width < 120 || height < 120)) return;

      [
        "data-large_image","data-large-image","data-full","data-zoom-image",
        "data-src","data-lazy-src","data-original","src"
      ].forEach(a => pushImage(attr(img, a)));

      for (const a of ["data-srcset","srcset"]) {
        const raw = attr(img, a);
        if (raw) raw.split(",").forEach(part => pushImage(part.trim().split(/\s+/)[0]));
      }
    });

    document.querySelectorAll("a[href]").forEach(a => {
      const href = attr(a, "href");
      if (/\.(jpe?g|png|webp|gif|avif)(?:\?|$)/i.test(href)) pushImage(href);
    });

    const images = [...new Set(imageCandidates)].filter(u =>
      !/(logo|icon|avatar|payment|sprite|placeholder|loader|spinner|favicon|trustpilot)/i.test(u)
    );

    if (!Object.keys(specs).length) {
      let featureIndex = 1;
      document.querySelectorAll("ul li, ol li").forEach(li => {
        const value = text(li);
        if (value.length >= 12 && value.length <= 500 &&
            !/^(add to cart|buy now|in stock|out of stock|reviews?)/i.test(value)) {
          addSpec("Feature " + featureIndex++, value);
        }
      });
    }

    const price = p.offers?.price || p.offers?.[0]?.price ||
      firstText([".price", ".product-price", ".special-price", "[itemprop='price']"]) || "";

    const brand = (typeof p.brand === "string" ? p.brand : p.brand?.name) ||
      firstText(["[itemprop='brand']", ".brand", ".brand-name", ".manufacturer"]) || "";

    const sku = p.sku || firstText(["[itemprop='sku']", ".sku", ".product-sku", ".product-code"]) || "";

    return {
      name: title,
      description,
      price: String(price || ""),
      brand: String(brand || ""),
      sku: String(sku || ""),
      specs,
      images
    };
  });

  return { ...data, sourceUrl: page.url() };
}

async function extractProduct(page, url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await extractProductOnce(page, url);
    } catch (e) {
      lastError = e;
      if (!/detached frame|frame was detached|execution context was destroyed/i.test(String(e.message || e))) {
        throw e;
      }
      await new Promise(r => setTimeout(r, 800 * attempt));
      try {
        await goto(page, url, 2);
      } catch {}
    }
  }
  throw lastError || new Error("product extraction failed");
}

function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    u.pathname = u.pathname.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, "");
    return u.href;
  } catch {
    return null;
  }
}

function extension(url) {
  try {
    const ext = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i);
    return ext ? ext[0].toLowerCase() : ".jpg";
  } catch {
    return ".jpg";
  }
}

function fetchBinary(url, referer, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? require("https") : require("http");
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": referer || ""
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return fetchBinary(new URL(res.headers.location, url).href, referer, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode));
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function imageSlug(name) {
  return normalize(name)
    .replace(/\b(price|in pakistan|pakistan)\b/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "product";
}

async function saveImages(urls, sourceUrl, productName, productId) {
  const dir = path.join(DATA_DIR, "images");
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  const base = imageSlug(productName);
  const identity = productId ? "-" + imageSlug(String(productId)) : "";

  for (let i = 0; i < Math.min(urls.length, 8); i++) {
    const url = normalizeImageUrl(urls[i]);
    if (!url) continue;

    const filename = base + identity + (i ? "-" + i : "") + extension(url);
    const savePath = path.join(dir, filename);

    try {
      const buffer = await fetchBinary(url, sourceUrl);
      if (buffer.length < 1000) continue;
      fs.writeFileSync(savePath, buffer);
      saved.push("data/images/" + filename);
    } catch (e) {
      console.log("      image failed: " + e.message);
    }
  }

  return saved;
}

function productKey(p) { return p.id || p.sku || normalize(p.name); }

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function hasStructuredSpecs(value) {
  const html = String(value || "");
  if (!html.trim()) return false;

  // A product-spec table generally has repeated rows with label/value cells.
  const tableRows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const labelValueRows = tableRows.filter(([, row]) => {
    const cells = [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)];
    return cells.length >= 2 && cells.slice(0, 2).every(([, cell]) => stripHtml(cell).length > 0);
  });
  if (labelValueRows.length >= 2) return true;

  const definitionPairs = [...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>[\s\S]{0,500}?<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)]
    .filter(([, label, value]) => stripHtml(label) && stripHtml(value));
  if (definitionPairs.length >= 2) return true;

  const listItems = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map(([, item]) => stripHtml(item))
    .filter(item => item.length >= 5 && item.length <= 350);
  const labelledItems = listItems.filter(item => /^[^:：|]{2,70}\s*[:：|]\s*\S/.test(item));
  if (labelledItems.length >= 2) return true;

  // Some stores use unlabelled feature bullets. Only treat these as specs when
  // several contain technical measurements/standards, not generic marketing copy.
  const technicalItems = listItems.filter(item =>
    /\b\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|ghz|mhz|gb|tb|mb|w|watts?|rpm|°c|°f|v|volts?|ports?|cores?|threads?|ddr[3456]|pcie|usb\s*[\d.]|wi-?fi|bluetooth|atx|matx|mini-itx|am5|lga\s*\d+)\b/i.test(item)
  );
  if (technicalItems.length >= 3) return true;

  const plain = stripHtml(html);
  return /\b(specifications?|technical specifications?|technical details?)\b/i.test(plain) &&
    /\b\d+(?:\.\d+)?\s*(?:mm|cm|ghz|mhz|gb|tb|w|rpm|ddr[3456]|pcie|usb)\b/i.test(plain);
}

function hasExistingSpecs(row) {
  const entries = Object.entries(row);

  // WooCommerce attribute exports can contain many blank attribute columns.
  // Count only complete, non-empty name/value pairs.
  const attributeIndexes = new Set();
  for (const [key, value] of entries) {
    if (!clean(value)) continue;
    const match = String(key).match(/^attribute\s*(\d+)\s*(name|value)$/i);
    if (match) {
      const index = match[1];
      const side = match[2].toLowerCase();
      const pair = attributeIndexes.has(index) ? attributeIndexes.get(index) : new Set();
      pair.add(side);
      attributeIndexes.add(index);
      attributeIndexes.set(index, pair);
    }
  }
  if ([...attributeIndexes.values()].filter(pair => pair.has("name") && pair.has("value")).length >= 2) {
    return true;
  }

  const explicit = entries.filter(([key, value]) =>
    /^(specifications?|specs?|features?|technical\s*details?)$/i.test(String(key).trim()) && clean(value)
  );
  if (explicit.some(([, value]) => hasStructuredSpecs(value) || stripHtml(value).length >= 100)) return true;

  // Product descriptions and short descriptions frequently hold the specs even
  // when WooCommerce's dedicated attribute columns are empty.
  const descriptions = entries
    .filter(([key]) => /^(description|short description|shortdescription|product description)$/i.test(String(key).trim()))
    .map(([, value]) => value)
    .filter(Boolean);
  return descriptions.some(hasStructuredSpecs);
}

function loadInventory() {
  if (!fs.existsSync(INPUT_FILE)) throw new Error("Input CSV not found: " + INPUT_FILE);
  return parse(fs.readFileSync(INPUT_FILE, "utf8"), { columns:true, skip_empty_lines:true, relax_column_count:true, bom:true })
    .map((r,i) => ({ index:i, raw:r, id:clean(r.ID||r.id), sku:clean(r.SKU||r.sku), name:clean(r.Name||r.name), category:clean(r.Categories||r.Category||r.category), existingImages:clean(r.Images||r.images), existingDescription:clean(r.Description||r.description), existingShortDescription:clean(r["Short description"]||r.ShortDescription||""), existingSpecs:hasExistingSpecs(r) }))
    .filter(p => p.name);
}

function loadPreviousResults() {
  const file = path.join(OUTPUT_DIR, "enriched_products.json");
  if (!fs.existsSync(file)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed.results || parsed.products || []);
    return new Map(rows.map(r => [productKey(r), {
      ...r,
      status: String(r.status || "").toUpperCase()
    }]));
  } catch {
    return new Map();
  }
}

function saveOutputs(results, inventory) {
  fs.mkdirSync(OUTPUT_DIR,{recursive:true});
  const byKey=new Map(results.map(r=>[productKey(r),r]));
  const targets=inventory.filter(p => !p.existingImages || !p.existingSpecs);
  const master=targets.map(p=>byKey.get(productKey(p)) || {...p,status:"PENDING",reason:"Not processed yet"});
  const headers=["ID","SKU","Name","Category","Status","Match score","Matched retailer","Matched product","Matched URL","Images found","Specs found","Description found","Reason"];
  const rows=[headers.join(",")];
  for(const r of master) rows.push([r.id,r.sku,r.name,r.category||"",r.status||"PENDING",r.matchScore||0,r.source||"",r.sourceName||r.candidateName||"",r.sourceUrl||r.candidateUrl||"",(r.images||[]).length,Object.keys(r.specs||{}).length,r.description?"YES":"NO",r.reason||""].map(csvEscape).join(","));
  fs.writeFileSync(STATUS_FILE,rows.join("\n")+"\n");
  fs.writeFileSync(MASTER_JSON,JSON.stringify({generatedAt:new Date().toISOString(),total:master.length,products:master},null,2));

  const groups=["MATCHED","PARTIAL","MULTIPLE_MATCHES","NO_MATCH","ERROR","PENDING","SKIPPED"];
  for(const group of groups){
    const out=[headers.join(",")];
    for(const r of master.filter(x=>x.status===group)) out.push([r.id,r.sku,r.name,r.category||"",r.status,r.matchScore||0,r.source||"",r.sourceName||r.candidateName||"",r.sourceUrl||r.candidateUrl||"",(r.images||[]).length,Object.keys(r.specs||{}).length,r.description?"YES":"NO",r.reason||""].map(csvEscape).join(","));
    fs.writeFileSync(path.join(OUTPUT_DIR,group.toLowerCase()+".csv"),out.join("\n")+"\n");
  }

  const detailed=["ID","SKU","Name","Category","Short description","Description","Images","Specifications","Source URL","Source","Match score","Status","Reason"];
  const detailRows=[detailed.join(",")];
  for(const r of master) detailRows.push([r.id,r.sku,r.name,r.category||"",r.shortDescription||"",r.description||"",(r.images||[]).join(", "),JSON.stringify(r.specs||{}),r.sourceUrl||"",r.source||"",r.matchScore||0,r.status||"",r.reason||""].map(csvEscape).join(","));
  fs.writeFileSync(path.join(OUTPUT_DIR,"enriched_products.csv"),detailRows.join("\n")+"\n");

  const wc=["ID","SKU","Name","Short description","Description","Images"].join(",")+"\n"+master.filter(x=>x.status==="MATCHED"&&x.id).map(r=>[r.id,r.sku,r.name,r.shortDescription||"",r.description||"",(r.images||[]).join(", ")].map(csvEscape).join(",")).join("\n");
  fs.writeFileSync(path.join(OUTPUT_DIR,"enriched_products_woocommerce.csv"),wc+"\n");
  fs.writeFileSync(path.join(OUTPUT_DIR,"enriched_products.json"),JSON.stringify({generatedAt:new Date().toISOString(),total:master.length,results:master},null,2));
  return master;
}

async function main() {
  console.log("=== Techistics product enrichment ===");
  console.log("Input: " + INPUT_FILE);
  console.log("Mode: " + (ONLY_MISSING ? "missing fields only" : "all products"));
  console.log("Minimum match: " + MIN_MATCH);

  const inventory = loadInventory();
  const previous = loadPreviousResults();
  const candidateTargets = ONLY_MISSING ? inventory.filter(p => !p.existingImages || !p.existingSpecs) : inventory;
  const targets = candidateTargets.filter(p => {
    const prior = previous.get(productKey(p));
    const priorStatus = String(prior?.status || "").toUpperCase();
    return !prior || !["MATCHED", "SKIPPED"].includes(priorStatus);
  });
  console.log("Inventory: " + inventory.length);
  console.log("Missing-field candidates: " + candidateTargets.length);
  console.log("Configured start: " + START);
  console.log("Configured limit: " + (LIMIT || "UNLIMITED"));

  let runTargets = targets.slice(START);
  if (LIMIT > 0) runTargets = runTargets.slice(0, LIMIT);
  console.log("To process this run: " + runTargets.length);

  if (!runTargets.length) {
    console.log("No target products found.");
    return;
  }

  if (!LIMIT && !ALLOW_UNLIMITED) {
    throw new Error("Safety stop: no ENRICH_LIMIT/--limit supplied. Use npm run enrich -- --limit=20 (or set ENRICH_ALLOW_UNLIMITED=1 for a full missing-field run).");
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run"],
    defaultViewport: { width: 1440, height: 900 }
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  await page.setRequestInterception(true);
  page.on("request", req => {
    if (["font","media","stylesheet"].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  const results = [];

  for (let i = 0; i < runTargets.length; i++) {
    const target = runTargets[i];
    console.log("\n[" + (i + 1) + "/" + runTargets.length + "] " + target.name);

    let best = null;

    const searchTerms = searchTermsForTarget(target);

    // SKU/model searches are much safer than broad product-name searches.
    for (const term of searchTerms.slice(0, 1)) {
      for (const source of SOURCES) {
        const candidate = await searchSite(page, source, term);
        if (candidate && (!best || candidate.score > best.score)) best = candidate;
        if (best && best.score >= 0.96) break;
      }
      if (best && best.score >= 0.96) break;
    }

    // Fall back to product-name searches when the SKU is not indexed.
    if (!best || best.score < 0.92) {
      for (const term of searchTerms.slice(target.sku && target.sku.length >= 4 ? 1 : 0)) {
        for (const source of SOURCES) {
          const candidate = await searchSite(page, source, term);
          if (candidate && (!best || candidate.score > best.score)) best = candidate;
          if (best && best.score >= 0.96) break;
        }
        if (best && best.score >= 0.96) break;
      }
    }

    // External search is a last resort, not the first matcher.
    if (!best || best.score < MIN_MATCH) {
      for (const term of searchTerms) {
        const webCandidate = await webSearch(page, term);
        if (webCandidate && (!best || webCandidate.score > best.score)) best = webCandidate;
        if (best && best.score >= 0.92) break;
      }
    }

    if (!best || best.score < MIN_MATCH) {
      console.log("    NOT FOUND (best: " + (best ? best.score.toFixed(2) : "none") + ")");
      results.push({
        ...target, status: "NO_MATCH",
        matchScore: best ? best.score : 0,
        candidateUrl: best?.url || "", candidateName: best?.matchedText || "", reason: "No sufficiently confident product-page match"
      });
      continue;
    }

    try {
      console.log("    " + best.source + " " + best.score.toFixed(2) + " -> " + best.url);
      let data = await extractProduct(page, best.url);
      const pageScore = scoreMatch(target.name, data.name);
      const genericPage = looksLikeGenericProductName(data.name);
      let finalScore = pageScore;

      if (genericPage || finalScore < MIN_MATCH) {
        console.log("    REJECTED CANDIDATE | page title: " + clean(data.name) + " | score " + finalScore.toFixed(2));

        let fallback = null;
        const retryTerms = searchTermsForTarget(target);
        for (const term of retryTerms) {
          const candidate = await webSearch(page, term);
          if (!candidate || candidate.url === best.url || candidate.score < MIN_MATCH) continue;
          try {
            const retryData = await extractProduct(page, candidate.url);
            const retryScore = scoreMatch(target.name, retryData.name);
            if (!looksLikeGenericProductName(retryData.name) && retryScore >= MIN_MATCH) {
              fallback = { ...candidate, data: retryData, score: retryScore };
              break;
            }
          } catch {}
        }

        if (!fallback) {
          results.push({
            ...target, status: "NO_MATCH", matchScore: finalScore,
            source: best.source, candidateUrl: best.url, candidateName: data.name,
            reason: "Candidate rejected: generic/non-product page or insufficient product-title match"
          });
          continue;
        }

        best = fallback;
        data = fallback.data;
        finalScore = fallback.score;
      }

      const images = await saveImages(data.images, data.sourceUrl, target.name, target.id || i + 1);
      const description = clean(data.description);
      const shortDescription = description.length > 500
        ? description.slice(0, 497).replace(/\s+\S*$/, "") + "..."
        : description;

      const specs = data.specs || {};
      const missing = [
        !description ? "description" : "",
        !Object.keys(specs).length ? "specifications" : "",
        !images.length ? "images" : ""
      ].filter(Boolean);

      results.push({
        ...target,
        status: missing.length ? "PARTIAL" : "MATCHED",
        reason: missing.length ? "Missing: " + missing.join(", ") : "",
        matchScore: Number(finalScore.toFixed(4)),
        source: best.source,
        sourceUrl: data.sourceUrl,
        sourceName: data.name,
        description,
        shortDescription,
        specs: data.specs || {},
        images,
        brand: data.brand || "",
        sourceSku: data.sku || "",
        sourcePrice: data.price || ""
      });

      console.log(
        "    MATCHED | score " + finalScore.toFixed(2) +
        " | specs " + Object.keys(data.specs || {}).length +
        " | images " + images.length
      );
    } catch (e) {
      console.log("    ERROR: " + e.message);
      results.push({
        ...target, status: "ERROR", error: e.message,
        source: best.source, sourceUrl: best.url, matchScore: best.score
      });
    }
  }

  await browser.close();
  const merged = new Map(previous);
  for (const r of results) merged.set(productKey(r), r);
  saveOutputs([...merged.values()], inventory);

  const counts = results.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  console.log("\n=== COMPLETE ===");
  console.log(JSON.stringify(counts, null, 2));
  console.log("Status: scraper/output/product_enrichment_status.csv");
  console.log("Output: scraper/output/enriched_products_woocommerce.csv");
  console.log("Details: scraper/output/enriched_products.json");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
