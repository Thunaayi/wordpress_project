const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const {
  loadMasterProducts,
  loadDBProducts,
  calculateSimilarity,
  calculateNewPrice,
  normalizeName,
  extractModelTokens,
  extractBrandFromName,
} = require("./utils/helpers");

const TechpScraper = require("./scrapers/TechpScraper");
const TechladScraper = require("./scrapers/TechladScraper");
const ZahcomputersScraper = require("./scrapers/ZahcomputersScraper");
const PclabScraper = require("./scrapers/PclabScraper");
const CzoneScraper = require("./scrapers/CzoneScraper");
const TechmatchedScraper = require("./scrapers/TechmatchedScraper");
const ZestrogamingScraper = require("./scrapers/ZestrogamingScraper");
const ProductExtractor = require("./utils/ProductExtractor");

const MATCH_THRESHOLD = 0.70;
const REQUEST_DELAY_MS = 350;

class ScraperOrchestrator {
  constructor() {
    this.errors = [];
  }

  async run() {
    console.log("=== Starting robust product scraper ===\n");

    const masterProducts = loadMasterProducts();
    const dbProducts = loadDBProducts();

    console.log("Loaded " + masterProducts.length + " master products");
    console.log("Loaded " + dbProducts.length + " WooCommerce products\n");

    const scraperMap = {
      "tech.com.pk": new TechpScraper(),
      "techlad.pk": new TechladScraper(),
      "zahcomputers.pk": new ZahcomputersScraper(),
      "pclab.pk": new PclabScraper(),
      "czone.com.pk": new CzoneScraper(),
      "techmatched.pk": new TechmatchedScraper(),
      "zestrogaming.com": new ZestrogamingScraper(),
    };

    for (const [name, scraper] of Object.entries(scraperMap)) {
      try {
        await scraper.init(true);
        console.log("Initialized " + name);
      } catch (e) {
        console.error("Failed to initialize " + name + ": " + e.message);
      }
    }

    const confirmed = [];
    const needsReview = [];
    const notFound = [];

    for (let i = 0; i < masterProducts.length; i++) {
      const product = masterProducts[i];
      console.log("\n[" + (i + 1) + "/" + masterProducts.length + "] " + product.name);

      try {
        const candidates = this.getScrapersForProduct(product, scraperMap);
        let result = null;

        for (const scraper of candidates) {
          result = await this.scrapeFromSite(scraper, product, dbProducts);
          if (result && result.data) break;
        }

        if (!result || !result.data) {
          notFound.push({ product, reason: "No sufficiently good competitor match found" });
        } else if (result.confirmed) {
          confirmed.push(result.data);
        } else {
          needsReview.push(result.data);
        }
      } catch (e) {
        console.error("  ERROR: " + e.message);
        notFound.push({ product, reason: e.message });
      }

      await this.sleep(REQUEST_DELAY_MS);
    }

    for (const scraper of Object.values(scraperMap)) {
      try { await scraper.close(); } catch {}
    }

    this.saveAllResults(confirmed, needsReview, notFound);
    console.log("\n=== COMPLETE ===");
    console.log("Confirmed: " + confirmed.length);
    console.log("Needs review: " + needsReview.length);
    console.log("Not found: " + notFound.length);
  }

  getScrapersForProduct(product, scraperMap) {
    const source = String(product.source || product.sourceBrand || "").toLowerCase();
    const brand = String(extractBrandFromName(product.name) || "").toLowerCase();

    const preferred = [];
    const add = (name) => {
      if (scraperMap[name] && !preferred.includes(scraperMap[name])) preferred.push(scraperMap[name]);
    };

    if (source.includes("thermalright") || source.includes("asus") ||
        source.includes("a4tech") || source.includes("bloody") ||
        source.includes("ugreen") || source.includes("gm multi")) add("tech.com.pk");
    if (source.includes("msi") || source.includes("pxn") || source.includes("maxsun")) add("pclab.pk");

    // Brand-aware fallbacks make the scraper useful even when the distributor
    // source field is missing or inconsistent.
    if (["msi", "pxn", "maxsun", "asus", "thermalright"].includes(brand)) add("pclab.pk");
    if (["ugreen", "a4tech", "bloody"].includes(brand)) add("tech.com.pk");

    // Czone and PCLab have large current catalogs, so use them as the broad
    // fallback rather than silently skipping unknown source brands.
    add("czone.com.pk");
    add("pclab.pk");
    add("tech.com.pk");
    add("techlad.pk");
    add("zahcomputers.pk");
    add("techmatched.pk");
    add("zestrogaming.com");

    return preferred;
  }

  async scrapeFromSite(scraper, product, dbProducts) {
    const siteMatch = await this.searchProduct(scraper, product);
    if (!siteMatch || siteMatch.score < 0.50) return null;

    console.log("  Found on " + scraper.siteConfig.name +
      " (" + Math.round(siteMatch.score * 100) + "%): " + siteMatch.matchedText);

    const data = await this.scrapeProduct(scraper, siteMatch.url, product);
    if (!data || !data.name || data.name === "Unknown") return null;

    data.originalProduct = product;
    data.matchedName = product.name;
    data.siteMatchConfidence = siteMatch.score;

    const wpMatch = this.findBestDBMatch(
      data.name || product.name,
      dbProducts,
      product
    );

    data.wordpressId = wpMatch ? wpMatch.product.id : null;
    data.wordpressSku = wpMatch ? wpMatch.product.sku : null;
    data.wordpressMatchConfidence = wpMatch ? wpMatch.score : 0;
    data.suggestedPrice = calculateNewPrice(product.price);

    // Never auto-apply a weak site match. The result remains in needsReview
    // when the WooCommerce match is uncertain or missing.
    const overallConfidence = Math.min(
      data.siteMatchConfidence,
      data.wordpressMatchConfidence || 0
    );

    data.overallConfidence = overallConfidence;

    return {
      data,
      confirmed: Boolean(data.wordpressId && overallConfidence >= MATCH_THRESHOLD)
    };
  }

  findBestDBMatch(productName, dbProducts, originalProduct) {
    let best = null;
    const originalSku = String(originalProduct && originalProduct.sku || "").trim().toLowerCase();

    for (const dbProduct of dbProducts) {
      let score = calculateSimilarity(productName, dbProduct.name);

      const dbSku = String(dbProduct.sku || "").trim().toLowerCase();
      if (originalSku && dbSku && originalSku === dbSku) score = Math.max(score, 0.99);

      if (!best || score > best.score) best = { product: dbProduct, score };
    }

    return best;
  }

  async searchProduct(scraper, product) {
    const queries = this.buildSearchQueries(product);

    for (const query of queries) {
      const template = scraper.siteConfig.searchUrl || (scraper.siteConfig.baseUrl + "/?s={query}");
      const searchUrl = template.replace("{query}", encodeURIComponent(query));

      try {
        await scraper.goto(searchUrl);
        await scraper.sleep(900);

        const candidates = await scraper.page.$$eval("a[href]", (links, baseUrl) => {
          return links.map((link) => ({
            text: (link.innerText || link.textContent || "").replace(/\\s+/g, " ").trim(),
            href: (() => {
              try { return new URL(link.getAttribute("href"), baseUrl).href; }
              catch { return ""; }
            })()
          })).filter(x => x.href && x.text);
        }, scraper.siteConfig.baseUrl);

        let best = null;
        for (const candidate of candidates) {
          if (!this.isLikelyProductUrl(candidate.href, scraper.siteConfig)) continue;

          const score = Math.max(
            calculateSimilarity(product.name, candidate.text),
            calculateSimilarity(product.name, this.slugToName(candidate.href))
          );

          if (!best || score > best.score) {
            best = { url: candidate.href, score, matchedText: candidate.text };
          }
        }

        if (best && best.score >= 0.50) return best;
      } catch (e) {
        console.log("  Search failed on " + scraper.siteConfig.name + ": " + e.message);
      }
    }

    return null;
  }

  buildSearchQueries(product) {
    const name = String(product.name || "").trim();
    const tokens = [...extractModelTokens(name)];
    const modelLike = tokens.filter((t) =>
      /[0-9]/.test(t) || /^(rtx|rx|gtx|g|pro|xt|ti|ultra|max|plus)$/i.test(t)
    );

    const compact = [extractBrandFromName(name), ...modelLike]
      .filter(Boolean)
      .join(" ")
      .trim();

    return [...new Set([name, compact].filter((q) => q.length >= 3))];
  }

  isLikelyProductUrl(url, config) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      const expected = String(config.baseUrl || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

      if (expected && host !== expected) return false;

      if (config.productUrlPattern && config.productUrlPattern.test(parsed.pathname)) return true;

      // Czone uses clean product slugs today, while older configs expected
      // /product/*.aspx. Avoid category/account/cart pages.
      if (host === "czone.com.pk") {
        return /\.aspx$/i.test(parsed.pathname) || (
          parsed.pathname.length > 8 &&
          !/^\/(products|product|category|categories|search|account|cart|checkout|login|contact|about|brand|brands|keyboard|mouse|graphic-cards|laptops)(\/|$)/i.test(parsed.pathname)
        );
      }

      return /\/product\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  slugToName(url) {
    try {
      const pathname = new URL(url).pathname;
      return decodeURIComponent(pathname)
        .replace(/\.(aspx|html?)$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/\//g, " ");
    } catch {
      return "";
    }
  }

  async scrapeProduct(scraper, productUrl, originalProduct) {
    await scraper.goto(productUrl);
    await scraper.sleep(700);

    const extracted = await ProductExtractor.extract(scraper.page);

    if (!extracted.name) {
      return null;
    }

    const imageUrls = [...new Set(extracted.images || [])];
    const imagePaths = await this.downloadProductImages(imageUrls, scraper.page.url());

    return {
      name: extracted.name || "Unknown",
      price: this.parsePrice(extracted.price),
      currency: extracted.currency || "PKR",
      description: extracted.description || "",
      shortDescription: extracted.description || "",
      specs: extracted.specs || {},
      brand: extracted.brand || this.extractBrandFromName(extracted.name),
      sku: extracted.sku || this.generateSku(extracted.name),
      category: this.extractCategory(extracted.breadcrumbs),
      availability: extracted.availability || "Unknown",
      images: imagePaths,
      imageUrls,
      sourceUrl: scraper.page.url(),
      scrapedAt: new Date().toISOString(),
    };
  }

  parsePrice(value) {
    if (!value) return 0;
    const text = String(value).replace(/,/g, "");
    const match = text.match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  extractBrandFromName(name) {
    return extractBrandFromName(name) || String(name || "").split(/\s+/)[0];
  }

  generateSku(name) {
    return String(name || "UNKNOWN")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 50);
  }

  extractCategory(breadcrumbs) {
    if (!breadcrumbs) return "Uncategorized";
    const text = breadcrumbs.toLowerCase();
    const categories = [
      "motherboard", "graphics card", "processor", "cpu", "cooling", "casing",
      "power supply", "monitor", "mouse", "keyboard", "headset", "headphones",
      "memory", "ram", "storage", "ssd", "hdd", "laptop", "webcam", "microphone",
      "speakers", "gaming chair", "controller", "router", "switch", "ups",
      "projector", "tv", "thermal paste", "fans", "mousepad", "earbuds"
    ];
    return categories.find((cat) => text.includes(cat)) || "Uncategorized";
  }

  async downloadProductImages(imageUrls, referer) {
    if (!imageUrls.length) return [];

    const baseDir = path.join(__dirname, "../../data/images");
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    const paths = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      try {
        const filename = "img_" + Date.now() + "_" + i + this.getImageExtension(url);
        const savePath = path.join(baseDir, filename);
        await this.downloadUrl(url, savePath, referer);
        paths.push(filename);
      } catch (e) {
        console.error("    Image failed: " + e.message);
      }
    }
    return paths;
  }

  downloadUrl(url, savePath, referer, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (redirects > 4) return reject(new Error("Too many redirects"));

      let target;
      try { target = new URL(url); } catch { return reject(new Error("Invalid image URL")); }

      const client = target.protocol === "https:" ? https : http;
      const req = client.get(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
          "Referer": referer || target.origin + "/",
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        },
        timeout: 25000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return this.downloadUrl(new URL(res.headers.location, target).href, savePath, referer, redirects + 1)
            .then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (buffer.length < 100) return reject(new Error("Image response is empty"));
          fs.writeFileSync(savePath, buffer);
          resolve();
        });
        res.on("error", reject);
      });

      req.on("timeout", () => req.destroy(new Error("Timeout")));
      req.on("error", reject);
    });
  }

  getImageExtension(url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.(jpg|jpeg|png|webp|gif|avif)$/);
      return match ? "." + match[1] : ".jpg";
    } catch {
      return ".jpg";
    }
  }

  saveAllResults(confirmed, needsReview, notFound) {
    const outputDir = path.join(__dirname, "../../output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const output = {
      scrapedAt: new Date().toISOString(),
      matchThreshold: MATCH_THRESHOLD,
      totalConfirmed: confirmed.length,
      totalNeedsReview: needsReview.length,
      totalNotFound: notFound.length,
      confirmed,
      needsReview,
      notFound,
    };

    fs.writeFileSync(
      path.join(outputDir, "scraped_products.json"),
      JSON.stringify(output, null, 2)
    );
    console.log("Saved output/scraped_products.json");
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ScraperOrchestrator;

(async () => {
  try {
    await new ScraperOrchestrator().run();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
