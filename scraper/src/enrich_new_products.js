const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { variantConflict } = require("./utils/variantGuard");
const { loadDoneImageIndex, isDoneProduct } = require("./utils/doneImages");

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
const STATUS_FILE = path.join(OUTPUT_DIR, "product_enrichment_status.csv");
const MASTER_JSON = path.join(OUTPUT_DIR, "product_enrichment_status.json");
const SEARCH_AUDIT_FILE = path.join(OUTPUT_DIR, "search_audit.csv");
const AUDIT_QUEUE_FILE = path.join(OUTPUT_DIR, "rescrape_queue.csv");
const RETRY_AUDIT = argv.includes("--retry-audit");
const RETRY_UNFOUND = argv.includes("--retry-unfound");
const RETRY_DONE = argv.includes("--retry-done");
const INCLUDE_DONE = argv.includes("--include-done") || RETRY_DONE;
const MIN_MATCH = Number(process.env.ENRICH_MIN_MATCH || 0.72);
const FORCE_NAMES = new Set((process.env.ENRICH_FORCE_NAMES || "").split("|").map(normalize).filter(Boolean));

const SOURCES = [
  { name: "czone.com.pk", domain: "czone.com.pk", search: q => "https://www.czone.com.pk/search.aspx?search=" + encodeURIComponent(q) },
  { name: "pclab.pk", domain: "pclab.pk", search: q => "https://pclab.pk/?s=" + encodeURIComponent(q) + "&post_type=product" },
  { name: "tech.com.pk", domain: "tech.com.pk", search: q => "https://tech.com.pk/?s=" + encodeURIComponent(q) + "&post_type=product" },
  { name: "mhktechzone.com", domain: "mhktechzone.com", search: q => "https://www.mhktechzone.com/?s=" + encodeURIComponent(q) + "&post_type=product" },
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

function appendSearchAudit(row) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const headers = ["Timestamp", "Product ID", "Target product", "Retailer", "Query", "Search URL", "Candidate name", "Candidate URL", "Score", "Decision", "Reason"];
  const exists = fs.existsSync(SEARCH_AUDIT_FILE);
  const values = [row.timestamp || new Date().toISOString(), row.productId || "", row.targetName || "", row.retailer || "", row.query || "", row.searchUrl || "", row.candidateName || "", row.candidateUrl || "", row.score == null ? "" : Number(row.score).toFixed(4), row.decision || "", row.reason || ""];
  fs.appendFileSync(SEARCH_AUDIT_FILE, (!exists ? headers.map(csvEscape).join(",") + "\n" : "") + values.map(csvEscape).join(",") + "\n", "utf8");
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
  // Color is part of the SKU when the target names one. Do not let the generic
  // token filter hide "black" and accept a blue/rose/white variant instead.
  const colors = ["black", "white", "silver", "grey", "gray", "red", "blue", "green", "pink", "purple", "gold", "orange", "yellow", "rose", "graphite", "off white"];
  const targetNorm = normalize(target);
  const candidateNorm = normalize(candidate);
  const targetColor = colors.find(color => new RegExp("\\b" + color.replace(/[- ]/g, "[ -]?") + "\\b").test(targetNorm));
  const candidateColor = colors.find(color => new RegExp("\\b" + color.replace(/[- ]/g, "[ -]?") + "\\b").test(candidateNorm));
  if (targetColor && candidateColor && targetColor !== candidateColor) return 0;

  const a = tokens(target);
  const b = tokens(candidate);
  if (!a.size || !b.size) return 0;

  // Different color, motherboard suffix, WIFI or PLUS edition and so on
  // are different products no matter how much of the name lines up.
  if (variantConflict(target, candidate)) return 0;

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

// Two products with different names that resolved to one competitor page are
// a variant mix-up until proven otherwise (a Black and a White version both
// getting the same photos). Both are moved to PARTIAL so they are not written
// to the import CSV and get retried on the next run. Products whose names are
// identical are left alone, since those are real duplicate listings.
function flagSharedSourcePages(records) {
  const byUrl = new Map();
  for (const r of records) {
    if (!["MATCHED", "PARTIAL"].includes(r.status) || !r.sourceUrl) continue;
    if (!byUrl.has(r.sourceUrl)) byUrl.set(r.sourceUrl, []);
    byUrl.get(r.sourceUrl).push(r);
  }
  let flagged = 0;
  for (const [url, group] of byUrl) {
    const names = new Set(group.map(r => normalize(r.name)));
    if (group.length < 2 || names.size < 2) continue;
    for (const r of group) {
      if (r.status !== "MATCHED") continue;
      r.status = "PARTIAL";
      r.reason = "Shared source page: " + group.filter(o => o !== r).map(o => o.id || o.name).join(", ") +
        " also matched " + url + ". Possible variant mix-up, review before import";
      flagged++;
    }
  }
  if (flagged) console.log("Flagged " + flagged + " products that share a source page with a differently named product");
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

async function searchSite(page, source, productName, productId = "", targetName = productName) {
  let best = null;

  for (const query of queryVariants(productName)) {
    const searchUrl = source.search(query);
    try {
      console.log("    CHECK " + source.name + " | query: " + query);
      await goto(page, searchUrl, 2);

      // $$eval (not $eval): $eval hands the callback a single matched
      // Element, which has no .map — that's the "anchors.map is not a
      // function" error. $$eval hands back the full NodeList as an array.
      // $eval also throws outright when zero elements match, which is what
      // produced the "failed to find element matching selector" errors on
      // pages with no results at all.
      const links = await page.$$eval("a[href]", anchors => anchors.map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || a.getAttribute("title") || a.querySelector("img")?.alt || "").trim(),
        title: (a.getAttribute("title") || "").trim()
      })).filter(x => x.href));

      const candidates = [];
      for (const item of links) {
        const candidateText = clean(item.text || item.title);
        if (!candidateText || !isProductUrl(item.href, source.domain)) continue;
        const score = scoreMatch(productName, candidateText);
        candidates.push({ url: item.href, score, matchedText: candidateText, source: source.name });
      }
      candidates.sort((a, b) => b.score - a.score);
      const unique = new Map();
      for (const candidate of candidates) {
        if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
      }
      const ranked = [...unique.values()];
      appendSearchAudit({ productId, targetName, retailer: source.name, query, searchUrl, decision: "SITE_CHECKED", reason: "Product links inspected: " + ranked.length });
      for (const candidate of ranked.slice(0, 25)) {
        const decision = candidate.score >= MIN_MATCH ? "CANDIDATE" : candidate.score >= 0.35 ? "CLOSE_MATCH_REJECTED" : "LOW_SCORE_REJECTED";
        const reason = decision === "CANDIDATE" ? "Search-title score meets minimum; product page title will be validated" :
          decision === "CLOSE_MATCH_REJECTED" ? "Below minimum match threshold" : "Insufficient product-name overlap";
        appendSearchAudit({ productId, targetName, retailer: source.name, query, searchUrl, candidateName: candidate.matchedText, candidateUrl: candidate.url, score: candidate.score, decision, reason });
      }
      if (ranked[0] && (!best || ranked[0].score > best.score)) best = ranked[0];
      if (best && best.score >= 0.92) return best;
    } catch (e) {
      console.log("    CHECK FAILED " + source.name + " | " + e.message);
      appendSearchAudit({ productId, targetName, retailer: source.name, query, searchUrl, decision: "SITE_ERROR", reason: e.message });
    }
  }

  return best;
}

async function webSearch(page, productName, productId = "", targetName = productName) {
  const q = productName.replace(/"/g, "");
  const engines = [
    { name: "Google", url: "https://www.google.com/search?q=" + encodeURIComponent(q) },
    { name: "Bing", url: "https://www.bing.com/search?q=" + encodeURIComponent(q) }
  ];
  let best = null;

  for (const engine of engines) {
    try {
      console.log("    CHECK " + engine.name + " | query: " + q);
      await goto(page, engine.url, 2);
      // Same $eval -> $$eval fix as searchSite() above.
      const links = await page.$$eval("a[href]", anchors => anchors.map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || a.getAttribute("aria-label") || "").trim()
      })));
      const candidates = [];
      for (const item of links) {
        if (!item.href || !item.text) continue;
        const source = SOURCES.find(s => isProductUrl(item.href, s.domain));
        if (!source) continue;
        candidates.push({ url: item.href, score: scoreMatch(productName, item.text), matchedText: clean(item.text), source: source.name });
      }
      candidates.sort((a, b) => b.score - a.score);
      const unique = new Map();
      for (const candidate of candidates) if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
      const ranked = [...unique.values()];
      appendSearchAudit({ productId, targetName, retailer: engine.name, query: q, searchUrl: engine.url, decision: "SEARCH_ENGINE_CHECKED", reason: "Supported-retailer links inspected: " + ranked.length });
      for (const candidate of ranked.slice(0, 25)) {
        const decision = candidate.score >= MIN_MATCH ? "CANDIDATE" : candidate.score >= 0.35 ? "CLOSE_MATCH_REJECTED" : "LOW_SCORE_REJECTED";
        appendSearchAudit({ productId, targetName, retailer: candidate.source + " via " + engine.name, query: q, searchUrl: engine.url, candidateName: candidate.matchedText, candidateUrl: candidate.url, score: candidate.score, decision, reason: decision === "CANDIDATE" ? "Meets search threshold; page title must still validate" : "Below minimum match threshold" });
      }
      if (ranked[0] && (!best || ranked[0].score > best.score)) best = ranked[0];
      if (best && best.score >= 0.85) return best;
    } catch (e) {
      console.log("    CHECK FAILED " + engine.name + " | " + e.message);
      appendSearchAudit({ productId, targetName, retailer: engine.name, query: q, searchUrl: engine.url, decision: "SEARCH_ENGINE_ERROR", reason: e.message });
    }
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
    // addSpec is called two different ways: with real DOM elements (the
    // dt/dd definition-list path below) and with plain strings that are
    // already text (every table/attribute-row/regex/"Feature N" path, which
    // all build their label/value via .map(text) or a regex capture or a
    // literal string before calling addSpec). text() only knows how to read
    // .textContent off a DOM node — called on a plain string it returns ""
    // (strings have no .textContent), which silently nulled out every spec
    // from every path except the dt/dd one. asText handles both.
    const asText = v => (v && typeof v === "object" && "textContent" in v)
      ? text(v)
      : String(v || "").replace(/\s+/g, " ").trim();
    const addSpec = (label, value) => {
      label = asText(label).replace(/[:：]+$/, "");
      value = asText(value);
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

    document.querySelectorAll(".woocommerce-product-gallery img, .woocommerce-product-gallery__wrapper img, .product-gallery img, .product-images img, .product-image-gallery img, .images img").forEach(img => {
      const altText = (attr(img, "alt") + " " + attr(img, "title") + " " + attr(img, "class")).toLowerCase();
      const width = Number(img.naturalWidth || img.width || 0);
      const height = Number(img.naturalHeight || img.height || 0);
      if (/(logo|favicon|icon|sprite|placeholder|no[-_ ]?image|loader|spinner|avatar|payment|trustpilot|whatsapp|facebook|instagram|twitter|youtube|badge|seal|captcha)/i.test(altText)) return;
      // This only catches a small icon when the browser has actually decoded
      // it (naturalWidth/Height > 0). Everything pulled from data-src/
      // data-lazy-src below is, by definition, not rendered yet, so it
      // reports 0x0 here and skips this check entirely — that's the actual
      // bug behind site icons leaking into the gallery. saveImages() below
      // re-checks real pixel dimensions on the downloaded file, which works
      // regardless of load state; this DOM-time check is just a cheap first
      // pass for images that happen to already be loaded.
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
      !/(logo|icon|avatar|payment|sprite|placeholder|loader|spinner|favicon|trustpilot|whatsapp|facebook|instagram|twitter|youtube|badge|seal|captcha)/i.test(u)
    );

    if (!Object.keys(specs).length) {
      // Only read lists inside the product's own content area. A page wide
      // search picks up menus, footers and sidebars as "specs".
      const CHROME = "nav, header, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo'], " +
        ".menu, .nav, .navbar, .navigation, .breadcrumb, .breadcrumbs, .footer, .header, .sidebar, .widget, " +
        ".related, .upsells, .cross-sells, .product-categories, .mega-menu, .dropdown, .social, .tabs-nav, ul.tabs, .wc-tabs, .woocommerce-tabs ul.tabs";
      const CONTENT_ROOTS = [
        ".woocommerce-product-details__short-description", "#tab-description", ".woocommerce-Tabs-panel--description",
        ".product-description", ".product_description", ".product-short-description", ".short-description",
        "[itemprop='description']", ".product-details", ".product-info", ".entry-summary", ".product-summary", ".summary"
      ];
      const roots = CONTENT_ROOTS.flatMap(sel => [...document.querySelectorAll(sel)]);
      const seenLi = new Set();
      let featureIndex = 1;
      roots.forEach(root => {
        root.querySelectorAll("ul li, ol li").forEach(li => {
          if (seenLi.has(li) || li.closest(CHROME)) return;
          seenLi.add(li);
          const value = text(li);
          // Real features are sentences or phrases. Short link-only items and
          // items that are just a link are menu entries.
          const onlyLink = li.children.length === 1 && li.children[0].tagName === "A" &&
            text(li.children[0]) === value;
          if (value.length >= 12 && value.length <= 500 && !onlyLink &&
              !/^(add to cart|buy now|in stock|out of stock|reviews?|share|home|shop|my account|login|register|contact|about|privacy|terms|returns?|shipping|faq)/i.test(value)) {
            addSpec("Feature " + featureIndex++, value);
          }
        });
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

// Query params that only ever request a resized/recompressed rendition of
// the SAME source image (WordPress's Photon/Jetpack CDN — i0.wp.com and
// similar — uses exactly these: ?fit=500%2C500, ?w=500, ?resize=300%2C300).
// Stripping them, not just the WordPress "-300x300" filename suffix below,
// is what collapses "the same product photo at five different sizes" down
// to one URL instead of five gallery entries. Left off: params that could
// plausibly distinguish genuinely different images on some other CDN (an
// image index/id, a cache-busting token, etc.) — only the well-known
// resize/quality/crop ones are removed.
const RESIZE_ONLY_QUERY_PARAMS = new Set(["w", "h", "width", "height", "resize", "fit", "quality", "q", "crop", "zoom"]);

function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // Preserve the source path and query. Some stores only serve a resized
    // derivative, so stripping "-300x300" or resize query parameters can turn
    // a valid image URL into HTTP 404. saveImages() deduplicates identical bytes.
    return u.href;
  } catch {
    return null;
  }
}

// DOM-time naturalWidth/naturalHeight (checked in extractProductOnce above)
// is 0 for any image that hasn't rendered yet, which is exactly the common
// case for the data-src/data-lazy-src attributes this scraper reads from —
// so that filter silently does nothing for lazy images, the ones most
// likely to be small site chrome (icons, badges, wishlist/zoom buttons)
// rather than product photos. This reads real dimensions from the
// downloaded file instead, which works regardless of whether the source
// page ever actually rendered the image.
function getImageDimensions(buffer) {
  try {
    // PNG: 8-byte signature, then the IHDR chunk holds width/height as two
    // big-endian uint32s starting at byte 16.
    if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    // JPEG: walk markers until an SOFx segment (0xC0-0xC3, 0xC5-0xC7,
    // 0xC9-0xCB, 0xCD-0xCF — the "Cx" markers that aren't actually
    // start-of-frame, like DHT/0xC4, get excluded), which stores height
    // then width as big-endian uint16s 3 bytes into the segment.
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue; }
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        const segmentLength = buffer.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }
  } catch {}
  return null; // webp/avif/gif or unparseable — let it through, don't guess
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
  const seenUrls = new Set();
  const seenHashes = new Set();
  const base = imageSlug(productName);
  const identity = productId ? "-" + imageSlug(String(productId)) : "";

  for (let i = 0; i < Math.min(urls.length, 8); i++) {
    const url = normalizeImageUrl(urls[i]);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const filename = base + identity + (i ? "-" + i : "") + extension(url);
    const savePath = path.join(dir, filename);

    try {
      const buffer = await fetchBinary(url, sourceUrl);
      if (buffer.length < 1000) continue;

      const dims = getImageDimensions(buffer);
      if (dims && (dims.width < 150 || dims.height < 150)) {
        console.log("      too small (" + dims.width + "x" + dims.height + "), likely site chrome not a product photo, skipped: " + url);
        continue;
      }

      // Different URLs can return identical file bytes. Skip duplicates for
      // this product so the saved image list contains unique downloads.
      const digest = crypto.createHash("sha256").update(buffer).digest("hex");
      if (seenHashes.has(digest)) {
        console.log("      duplicate image skipped: " + url);
        continue;
      }
      seenHashes.add(digest);

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

function hasImageValue(value) {
  const imageValue = clean(value);
  if (!imageValue) return false;
  if (/^(none|null|n\/a|na|no image|no images|not available|-)$/i.test(imageValue)) return false;
  // Any populated WooCommerce Images field counts as an existing image. This
  // intentionally includes Techistics WordPress media URLs and multiple URLs.
  return true;
}

function hasExistingSpecs(row) {
  const entries = Object.entries(row);

  // WooCommerce attribute exports can contain many blank attribute columns.
  // Count only complete, non-empty name/value pairs.
  const attributeIndexes = new Map();
  for (const [key, value] of entries) {
    if (!clean(value)) continue;
    const match = String(key).match(/^attribute\s*(\d+)\s*(name|value)$/i);
    if (match) {
      const index = match[1];
      const side = match[2].toLowerCase();
      const pair = attributeIndexes.has(index) ? attributeIndexes.get(index) : new Set();
      pair.add(side);
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
    .map((r,i) => {
      const existingImages = clean(r.Images || r.images);
      const hasImage = hasImageValue(existingImages);
      const existingDescription = clean(r.Description || r.description);
      const existingShortDescription = clean(r["Short description"] || r.ShortDescription || "");
      return {
        index: i, raw: r, id: clean(r.ID || r.id), sku: clean(r.SKU || r.sku),
        name: clean(r.Name || r.name), category: clean(r.Categories || r.Category || r.category),
        existingImages, hasExistingImage: hasImage, imageStatus: hasImage ? "HAS_IMAGE" : "MISSING_IMAGE",
        existingDescription, existingShortDescription, existingSpecs: hasExistingSpecs(r),
        hasExistingDescription: Boolean(stripHtml(existingDescription || existingShortDescription))
      };
    })
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

function loadPreviouslyCheckedSources() {
  const byProduct = new Map();
  if (!fs.existsSync(SEARCH_AUDIT_FILE)) return byProduct;
  try {
    const rows = parse(fs.readFileSync(SEARCH_AUDIT_FILE, "utf8"), {
      columns: true, skip_empty_lines: true, bom: true
    });
    const knownSources = new Set(SOURCES.map(source => source.name));
    for (const row of rows) {
      const productId = clean(row["Product ID"]);
      const retailer = clean(row.Retailer);
      if (!productId || !knownSources.has(retailer)) continue;
      if (!byProduct.has(productId)) byProduct.set(productId, new Set());
      byProduct.get(productId).add(retailer);
    }
  } catch (error) {
    console.warn("Could not read previous retailer checks; retry mode will stop rather than risk repeating searches: " + error.message);
    throw error;
  }
  return byProduct;
}

function saveOutputs(results, inventory) {
  fs.mkdirSync(OUTPUT_DIR,{recursive:true});
  const byKey = new Map(results.map(r => [productKey(r), r]));

  // Export the inventory split separately for review. These reports are
  // classification-only: image-present products are never sent to enrichment.
  const imageHeaders = ["ID", "SKU", "Name", "Category", "Image status", "Existing image URL", "Existing specs", "Existing description"];
  const imageRows = inventory.map(p => [
    p.id, p.sku, p.name, p.category || "", p.imageStatus, p.existingImages || "",
    p.existingSpecs ? "YES" : "NO", p.hasExistingDescription ? "YES" : "NO"
  ]);
  const writeCsv = (file, headers, rows) => {
    fs.writeFileSync(path.join(OUTPUT_DIR, file), [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\n") + "\n");
  };
  writeCsv("product_image_inventory.csv", imageHeaders, imageRows);
  writeCsv("image_present.csv", imageHeaders, imageRows.filter(row => row[4] === "HAS_IMAGE"));
  writeCsv("image_missing.csv", imageHeaders, imageRows.filter(row => row[4] === "MISSING_IMAGE"));
  fs.writeFileSync(path.join(OUTPUT_DIR, "product_image_inventory.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: inventory.length,
    imagePresent: inventory.filter(p => p.hasExistingImage).length,
    imageMissing: inventory.filter(p => !p.hasExistingImage).length,
    products: inventory.map(p => ({
      id: p.id, sku: p.sku, name: p.name, category: p.category,
      imageStatus: p.imageStatus, existingImages: p.existingImages,
      existingSpecs: p.existingSpecs, hasExistingDescription: p.hasExistingDescription
    }))
  }, null, 2));

  const targets = inventory.filter(p => !p.hasExistingImage);
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
  console.log("Mode: products without an existing image ONLY (image-present products are never enriched)");
  console.log("Minimum match: " + MIN_MATCH);

  const inventory = loadInventory();
  const previous = loadPreviousResults();
  const doneIndex = loadDoneImageIndex(path.join(DATA_DIR, "images", "done"));
  const doneProducts = inventory.filter(p => !p.hasExistingImage && isDoneProduct(p, doneIndex));
  const previouslyCheckedSources = RETRY_UNFOUND ? loadPreviouslyCheckedSources() : new Map();
  const candidateTargets = inventory.filter(p => !p.hasExistingImage && (
    INCLUDE_DONE || FORCE_NAMES.has(normalize(p.name)) || !isDoneProduct(p, doneIndex)
  ));
  let targets;
  if (RETRY_DONE) {
    targets = doneProducts;
    console.log("Explicit done-folder retry mode: selected " + targets.length + " products matched to images in data/images/done.");
  } else if (RETRY_AUDIT) {
    if (!fs.existsSync(AUDIT_QUEUE_FILE)) throw new Error("Audit retry queue not found: " + AUDIT_QUEUE_FILE + ". Run npm run audit first.");
    const queueRows = parse(fs.readFileSync(AUDIT_QUEUE_FILE, "utf8"), { columns: true, skip_empty_lines: true, bom: true });
    const queueKeys = new Set(queueRows.map(row => productKey({ id: row.ID, sku: row.SKU, name: row.Name })).filter(Boolean));
    targets = candidateTargets.filter(p => queueKeys.has(productKey(p)));
    console.log("Audit retry mode: selected " + targets.length + " queued products (still gated by original image-missing inventory).");
  } else if (RETRY_UNFOUND) {
    targets = candidateTargets.filter(p => String(previous.get(productKey(p))?.status || "").toUpperCase() === "NO_MATCH");
    console.log("Unfound-only retry mode: selected " + targets.length + " previously unresolved products; only never-before-checked retailers will be searched.");
  } else {
    targets = candidateTargets.filter(p => {
      const prior = previous.get(productKey(p));
      const priorStatus = String(prior?.status || "").toUpperCase();
      // Explicit product names and --retry-done override the remembered completion status.
      if (FORCE_NAMES.has(normalize(p.name))) return true;
      // NO_MATCH is only retried by --retry-unfound, which excludes every
      // retailer already recorded in the search ledger.
      if (priorStatus === "NO_MATCH") return false;
      return !prior || !["MATCHED", "SKIPPED"].includes(priorStatus);
    });
    // Put explicitly forced names first so a small ENRICH_LIMIT reliably
    // retries the requested products before other pending/partial inventory.
    targets.sort((a, b) => Number(FORCE_NAMES.has(normalize(b.name))) - Number(FORCE_NAMES.has(normalize(a.name))));
  }
  console.log("Inventory: " + inventory.length);
  console.log("Products with existing images (excluded): " + inventory.filter(p => p.hasExistingImage).length);
  console.log("Products matched to data/images/done (normally skipped): " + doneProducts.length);
  console.log("Done-folder override: " + (INCLUDE_DONE ? "enabled" : "disabled") + (RETRY_DONE ? " (retry only done-folder products)" : ""));
  console.log("Products missing images eligible this run: " + candidateTargets.length);
  console.log("Configured start: " + START);
  console.log("Configured limit: " + (LIMIT || "UNLIMITED"));

  let runTargets = targets.slice(START);
  if (LIMIT > 0) runTargets = runTargets.slice(0, LIMIT);
  console.log("To process this run: " + runTargets.length);

  // Hard safety invariant: no product with an existing image may reach the scraper.
  if (runTargets.some(p => p.hasExistingImage)) {
    throw new Error("Safety stop: image-present product entered the enrichment queue.");
  }

  if (!runTargets.length) {
    console.log("No unprocessed image-missing products found.");
    saveOutputs([...previous.values()], inventory);
    return;
  }

  if (!LIMIT && !ALLOW_UNLIMITED) {
    throw new Error("Safety stop: no ENRICH_LIMIT/--limit supplied. Use npm run enrich -- --limit=20 (or set ENRICH_ALLOW_UNLIMITED=1 to process the full image-missing queue).");
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
    const productAuditId = String(target.id || target.sku || "");
    const alreadyChecked = previouslyCheckedSources.get(productAuditId) || new Set();
    const sourcesToSearch = RETRY_UNFOUND
      ? SOURCES.filter(source => !alreadyChecked.has(source.name))
      : SOURCES;
    if (RETRY_UNFOUND) {
      console.log("    Previously checked: " + (alreadyChecked.size ? [...alreadyChecked].join(", ") : "none recorded"));
      console.log("    New retailers available: " + (sourcesToSearch.length ? sourcesToSearch.map(source => source.name).join(", ") : "none"));
    }

    // SKU/model searches are much safer than broad product-name searches.
    for (const term of searchTerms.slice(0, 1)) {
      for (const source of sourcesToSearch) {
        const candidate = await searchSite(page, source, term, target.id || target.sku, target.name);
        if (candidate && (!best || candidate.score > best.score)) best = candidate;
        if (best && best.score >= 0.96) break;
      }
      if (best && best.score >= 0.96) break;
    }

    // Fall back to product-name searches when the SKU is not indexed.
    if (!best || best.score < 0.92) {
      for (const term of searchTerms.slice(target.sku && target.sku.length >= 4 ? 1 : 0)) {
        for (const source of sourcesToSearch) {
          const candidate = await searchSite(page, source, term, target.id || target.sku, target.name);
          if (candidate && (!best || candidate.score > best.score)) best = candidate;
          if (best && best.score >= 0.96) break;
        }
        if (best && best.score >= 0.96) break;
      }
    }

    // External search is a last resort for normal runs. During --retry-unfound,
    // Google/Bing could rediscover the exact same retailers already exhausted,
    // so only newly added, never-before-checked retailer sources are allowed.
    if (!RETRY_UNFOUND && (!best || best.score < MIN_MATCH)) {
      for (const term of searchTerms) {
        const webCandidate = await webSearch(page, term, target.id || target.sku, target.name);
        if (webCandidate && (!best || webCandidate.score > best.score)) best = webCandidate;
        if (best && best.score >= 0.92) break;
      }
    }

    if (!best || best.score < MIN_MATCH) {
      const reason = RETRY_UNFOUND
        ? (sourcesToSearch.length
          ? "Still unresolved after trying newly added retailers: " + sourcesToSearch.map(source => source.name).join(", ")
          : "No new configured retailers remain; all current sources were already checked. Add a new source before retrying.")
        : "No sufficiently confident product-page match";
      console.log("    NOT FOUND (best: " + (best ? best.score.toFixed(2) : "none") + ")");
      appendSearchAudit({
        productId: productAuditId, targetName: target.name,
        retailer: "SCRAPER", query: searchTerms.join(" | "), decision: "NO_MATCH_RECORDED",
        reason
      });
      results.push({
        ...(previous.get(productKey(target)) || {}),
        ...target, status: "NO_MATCH",
        matchScore: best ? best.score : (previous.get(productKey(target))?.matchScore || 0),
        candidateUrl: best?.url || previous.get(productKey(target))?.candidateUrl || "",
        candidateName: best?.matchedText || previous.get(productKey(target))?.candidateName || "",
        reason
      });
      continue;
    }

    try {
      console.log("    " + best.source + " " + best.score.toFixed(2) + " -> " + best.url);
      let data = await extractProduct(page, best.url);
      const pageScore = scoreMatch(target.name, data.name);
      const genericPage = looksLikeGenericProductName(data.name);
      let finalScore = pageScore;

      appendSearchAudit({ productId: target.id || target.sku, targetName: target.name, retailer: best.source || "", query: searchTerms.join(" | "), searchUrl: best.url, candidateName: data.name, candidateUrl: best.url, score: finalScore, decision: (genericPage || finalScore < MIN_MATCH) ? "PRODUCT_PAGE_REJECTED" : "PRODUCT_PAGE_ACCEPTED", reason: genericPage ? "Generic/non-product page title" : finalScore < MIN_MATCH ? "Product page title below minimum match threshold" : "Product page title validated" });
      if (genericPage || finalScore < MIN_MATCH) {
        console.log("    REJECTED CANDIDATE | page title: " + clean(data.name) + " | score " + finalScore.toFixed(2));

        let fallback = null;
        const retryTerms = searchTermsForTarget(target);
        for (const term of retryTerms) {
          const retryCandidates = [];
          if (RETRY_UNFOUND) {
            // Never use a search engine in new-source mode: it may send us back
            // to a retailer already exhausted for this product.
            for (const source of sourcesToSearch) {
              const candidate = await searchSite(page, source, term, productAuditId, target.name);
              if (candidate && candidate.url !== best.url && candidate.score >= MIN_MATCH) retryCandidates.push(candidate);
            }
          } else {
            const candidate = await webSearch(page, term, productAuditId, target.name);
            if (candidate && candidate.url !== best.url && candidate.score >= MIN_MATCH) retryCandidates.push(candidate);
          }

          for (const candidate of retryCandidates) {
            try {
              const retryData = await extractProduct(page, candidate.url);
              const retryScore = scoreMatch(target.name, retryData.name);
              const genericRetry = looksLikeGenericProductName(retryData.name);
              appendSearchAudit({
                productId: productAuditId, targetName: target.name,
                retailer: candidate.source || "", query: term, searchUrl: candidate.url,
                candidateName: retryData.name, candidateUrl: candidate.url, score: retryScore,
                decision: (!genericRetry && retryScore >= MIN_MATCH) ? "FALLBACK_PRODUCT_PAGE_ACCEPTED" : "FALLBACK_PRODUCT_PAGE_REJECTED",
                reason: genericRetry ? "Fallback candidate resolved to a generic/non-product page" :
                  retryScore < MIN_MATCH ? "Fallback product title below minimum match threshold" : "Fallback product title validated"
              });
              if (!genericRetry && retryScore >= MIN_MATCH) {
                fallback = { ...candidate, data: retryData, score: retryScore };
                break;
              }
            } catch (error) {
              appendSearchAudit({
                productId: productAuditId, targetName: target.name,
                retailer: candidate.source || "", query: term, searchUrl: candidate.url,
                candidateName: candidate.matchedText || "", candidateUrl: candidate.url,
                score: candidate.score, decision: "FALLBACK_PRODUCT_PAGE_ERROR", reason: error.message
              });
            }
          }
          if (fallback) break;
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
  flagSharedSourcePages([...merged.values()]);
  saveOutputs([...merged.values()], inventory);

  const counts = results.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  console.log("\n=== COMPLETE ===");
  console.log(JSON.stringify(counts, null, 2));
  console.log("Image inventory: scraper/output/product_image_inventory.csv");
  console.log("Image-present products (excluded): scraper/output/image_present.csv");
  console.log("Image-missing products (eligible): scraper/output/image_missing.csv");
  console.log("Status: scraper/output/product_enrichment_status.csv");
  console.log("Output: scraper/output/enriched_products_woocommerce.csv");
  console.log("Details: scraper/output/enriched_products.json");
  console.log("Search audit (sites, queries, candidates, rejections): scraper/output/search_audit.csv");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
