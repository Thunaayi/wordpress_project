const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { loadMasterProducts, loadDBProducts, calculateSimilarity, calculateNewPrice } = require("./utils/helpers");
const TechpScraper = require("./scrapers/TechpScraper");
const TechladScraper = require("./scrapers/TechladScraper");
const ZahcomputersScraper = require("./scrapers/ZahcomputersScraper");
const PclabScraper = require("./scrapers/PclabScraper");
const CzoneScraper = require("./scrapers/CzoneScraper");
const TechmatchedScraper = require("./scrapers/TechmatchedScraper");
const ZestrogamingScraper = require("./scrapers/ZestrogamingScraper");

// Minimum similarity score (0-1, from helpers.calculateSimilarity) for a
// search result to be treated as a confirmed match. Below this, the result
// still gets saved, but goes in needsReview instead of being auto-applied.
// 0.65 is a starting point, not a guarantee — see the README note about why
// even a "good" match can be the wrong color/variant of the right product.
const MATCH_THRESHOLD = 0.65;

/**
 * Main orchestrator for scraping all products
 */
class ScraperOrchestrator {
  constructor() { this.errors = []; }

  async run() {
    console.log("=== Starting Product Scraper Orchestrator ===\n");
    const masterProducts = loadMasterProducts();
    const dbProducts = loadDBProducts();
    console.log("Loaded " + masterProducts.length + " master products");
    console.log("Loaded " + dbProducts.length + " WooCommerce products");

    const scraperMap = {
      "tech.com.pk": new TechpScraper(),
      "techlad.pk": new TechladScraper(),
      "zahcomputers.pk": new ZahcomputersScraper(),
      "pclab.pk": new PclabScraper(),
      "czone.com.pk": new CzoneScraper(),
      "techmatched.pk": new TechmatchedScraper(),
      "zestrogaming.com": new ZestrogamingScraper()
    };

    for (const [name, scraper] of Object.entries(scraperMap)) {
      try { await scraper.init(true); console.log("Initialized " + name); }
      catch (e) { console.error("Failed to initialize " + name + ": " + e.message); }
    }

    const confirmed = [], needsReview = [], notFound = [];
    for (let i = 0; i < masterProducts.length; i++) {
      const product = masterProducts[i];
      console.log("\n[" + (i + 1) + "/" + masterProducts.length + "] " + product.name);
      try {
        const candidates = this.getCandidateScrapers(product, scraperMap);
        let result = null;

        for (const scraper of candidates) {
          if (!scraper || !scraper.browser) continue;
          result = await this.searchProduct(scraper, product);
          if (result && result.score >= 0.55) break;
        }

        if (!result) {
          notFound.push({ product, reason: "No sufficiently good competitor match found" });
          continue;
        }

        const data = await this.scrapeProduct(result.scraper, result.url, product);
        if (!data) {
          notFound.push({ product, reason: "Found candidate but extraction failed" });
          continue;
        }

        data.originalProduct = product;
        data.matchedName = product.name;
        data.siteMatchConfidence = result.score;
        const wpMatch = this.findBestDBMatch(product.name, dbProducts);
        data.wordpressId = wpMatch ? wpMatch.product.id : null;
        data.wordpressSku = wpMatch ? wpMatch.product.sku : null;
        data.wordpressMatchConfidence = wpMatch ? wpMatch.score : 0;
        data.suggestedPrice = calculateNewPrice(product.price);
        data.matchSource = result.scraper.siteConfig.name;
        data.matchUrl = result.url;

        const overall = Math.min(data.siteMatchConfidence, data.wordpressMatchConfidence);
        if (overall >= MATCH_THRESHOLD && data.wordpressId) {
          confirmed.push(data);
          console.log("  MATCH " + Math.round(overall * 100) + "% via " + data.matchSource);
        } else {
          needsReview.push(data);
          console.log("  REVIEW " + Math.round(overall * 100) + "% via " + data.matchSource);
        }
      } catch (e) {
        notFound.push({ product, reason: e.message });
        console.error("  ERROR: " + e.message);
      }
      await new Promise(r => setTimeout(r, 350));
    }

    for (const scraper of Object.values(scraperMap)) {
      try { await scraper.close(); } catch {}
    }
    this.saveAllResults(confirmed, needsReview, notFound);
    console.log("\n=== COMPLETE ===");
    console.log("Confirmed: " + confirmed.length + " | Review: " + needsReview.length + " | Not found: " + notFound.length);
  }

  getCandidateScrapers(product, scraperMap) {
    const source = String(product.source || product.sourceBrand || "").toLowerCase();
    const name = String(product.name || "").toLowerCase();
    const preferred = [];

    const add = key => {
      const s = scraperMap[key];
      if (s && !preferred.includes(s)) preferred.push(s);
    };

    if (source.includes("whatsapp") || /\\b(?:ssd|nvme|ram|memory|storage)\\b/.test(name)) add("pclab.pk");
    if (source.includes("a4tech") || source.includes("bloody")) add("tech.com.pk");
    if (source.includes("asus")) add("tech.com.pk");
    if (source.includes("msi") || source.includes("pxn") || source.includes("maxsun")) add("pclab.pk");
    if (source.includes("thermalright") || source.includes("ugreen") || source.includes("gm multi")) add("tech.com.pk");

    for (const key of Object.keys(scraperMap)) add(key);
    return preferred;
  }

  getQueryVariants(product) {
    const name = String(product.name || "").trim();
    const clean = name.replace(/[^a-zA-Z0-9]+/g, " ").replace(/\\s+/g, " ").trim();
    const tokens = clean.split(" ").filter(x => x.length >= 3);
    const model = tokens.filter(x => /[0-9]/.test(x) || /[-_]/.test(x)).slice(0, 4).join(" ");
    const brand = (product.sourceBrand || "").trim();
    const variants = [name];
    if (model) variants.push(model + (brand ? " " + brand : ""));
    if (tokens.length > 2) variants.push(tokens.slice(0, Math.min(6, tokens.length)).join(" "));
    return [...new Set(variants.filter(Boolean))];
  }

  async searchProduct(scraper, product) {
    const cfg = scraper.siteConfig;
    const templates = cfg.searchUrls || [cfg.searchUrl];
    const queries = this.getQueryVariants(product);
    let best = null;

    for (const query of queries) {
      for (const template of templates) {
        if (!template) continue;
        const url = template.replace("{query}", encodeURIComponent(query));
        try {
          await scraper.goto(url, { timeout: 45000 });
          await scraper.sleep(900);

          const links = await scraper.page.$$eval("a[href]", (els, base) => els.map(a => {
            const href = a.href || a.getAttribute("href") || "";
            const text = (a.textContent || a.getAttribute("title") || a.querySelector("img")?.alt || "").replace(/\\s+/g, " ").trim();
            return { href, text };
          }).filter(x => x.href), scraper.siteConfig?.baseUrl).catch(() => []);

          for (const item of links) {
            let href = item.href;
            if (!href || /^javascript:|^mailto:|^tel:/i.test(href)) continue;
            if (href.includes("/cart") || href.includes("/checkout") || href.includes("/my-account")) continue;
            if (cfg.productUrlPattern && !cfg.productUrlPattern.test(new URL(href).pathname)) continue;

            const score = calculateSimilarity(product.name, item.text || href);
            const model = this.extractStrongTokens(product.name);
            const text = (item.text || href).toLowerCase();
            const modelHits = model.filter(t => text.includes(t)).length;
            const boosted = Math.min(0.99, score + Math.min(0.20, modelHits * 0.04));

            if (!best || boosted > best.score) best = { url: href, score: boosted, matchedText: item.text, scraper };
          }
          if (best && best.score >= 0.78) return best;
        } catch (e) {
          console.log("  Search attempt failed on " + cfg.name + ": " + e.message);
        }
      }
    }
    return best;
  }

  extractStrongTokens(name) {
    return (String(name).match(/[A-Za-z0-9][A-Za-z0-9._-]{2,}/g) || [])
      .map(x => x.toLowerCase()).filter(x => /[0-9]/.test(x) || x.length >= 5);
  }

  async scrapeProduct(scraper, productUrl, originalProduct) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await scraper.goto(productUrl, { timeout: 60000 });
        await scraper.sleep(700);

        const ProductExtractor = require("./utils/ProductExtractor");
        const extracted = await ProductExtractor.extract(scraper.page);

        const name = extracted.name || originalProduct.name;
        const price = this.parsePrice(extracted.price);
        const imageUrls = extracted.images || [];
        const imagePaths = await this.downloadProductImages(imageUrls, productUrl);

        return {
          name,
          price,
          originalPrice: 0,
          description: extracted.description || "",
          shortDescription: extracted.description || "",
          specs: extracted.specs || {},
          brand: extracted.brand || this.extractBrandFromName(name),
          sku: extracted.sku || this.generateSku(name),
          category: this.extractCategory(extracted.breadcrumbs),
          availability: extracted.availability || "In Stock",
          images: imagePaths,
          imageUrls,
          sourceUrl: scraper.page.url(),
          scrapedAt: new Date().toISOString()
        };
      } catch (e) {
        if (attempt === 2) {
          console.log("  Product extraction failed: " + e.message);
          return null;
        }
        await scraper.sleep(1000);
      }
    }
    return null;
  }

  findBestDBMatch(productName, dbProducts) {
    let best = null;
    for (const dbProduct of dbProducts) {
      const score = calculateSimilarity(productName, dbProduct.name);
      if (!best || score > best.score) best = { product: dbProduct, score };
    }
    return best;
  }

  parsePrice(str) {
    if (!str) return 0;
    const matches = String(str).replace(/,/g, "").match(/\\d+(?:\\.\\d+)?/g);
    return matches ? parseFloat(matches[matches.length - 1]) : 0;
  }

  extractBrandFromName(name) {
    const brands = ["thermalright","asus","msi","logitech","razer","steelseries","xpg","cougar","ugreen","a4tech","bloody","pxn","maxsun","lian li","gigabyte","deepcool","id-cooling","be quiet","noctua","arctic","fractal design","phanteks","nzxt","seasonic","evga","asrock","biostar","colorful","gainward","palit","zotac","inno3d","thermaltake","antec","silverstone","crucial","silicon power","lexar","pny","ramsta","hiksemi","samsung","kingston","western digital"];
    const lower = String(name || "").toLowerCase();
    return brands.find(b => lower.includes(b)) || lower.split(" ")[0] || "Unknown";
  }

  generateSku(name) { return String(name || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 50); }

  extractCategory(breadcrumbs) {
    const categories = ["Motherboard","Graphics Card","Cooling Solutions","Casing","Power Supply","Monitor","Mouse","Keyboard","Headset","Storage","Laptop","Webcam","Microphone","Processors (CPU)","Memory (RAM)"];
    const b = String(breadcrumbs || "").toLowerCase();
    return categories.find(c => b.includes(c.toLowerCase())) || "Uncategorized";
  }

  async downloadProductImages(urls, referer) {
    const baseDir = path.join(__dirname, "../../data/images");
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    const unique = [...new Set((urls || []).filter(Boolean))];
    const paths = [];

    for (let i = 0; i < unique.length; i++) {
      try {
        const filename = "img_" + Date.now() + "_" + i + this.getImageExtension(unique[i]);
        const savePath = path.join(baseDir, filename);
        await this.downloadUrl(unique[i], savePath, referer);
        paths.push(filename);
      } catch (e) {
        console.log("    Image failed: " + unique[i] + " (" + e.message + ")");
      }
    }
    return paths;
  }

  downloadUrl(url, savePath, referer, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (redirects > 5) return reject(new Error("too many redirects"));
      let u;
      try { u = new URL(url); } catch { return reject(new Error("invalid URL")); }
      const transport = u.protocol === "https:" ? https : http;
      const req = transport.get(u, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Referer": referer || u.origin + "/",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return this.downloadUrl(new URL(res.headers.location, u).href, savePath, referer, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          if (!body.length) return reject(new Error("empty image"));
          fs.writeFileSync(savePath, body);
          resolve();
        });
        res.on("error", reject);
      });
      req.setTimeout(30000, () => { req.destroy(new Error("timeout")); });
      req.on("error", reject);
    });
  }

  getImageExtension(url) {
    try {
      const ext = new URL(url).pathname.match(/\\.(jpe?g|png|webp|gif|avif)$/i);
      return ext ? "." + ext[1].toLowerCase() : ".jpg";
    } catch { return ".jpg"; }
  }

  saveAllResults(confirmed, needsReview, notFound) {
    const outputDir = path.join(__dirname, "../../output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "scraped_products.json"), JSON.stringify({
      scrapedAt: new Date().toISOString(),
      matchThreshold: MATCH_THRESHOLD,
      totalConfirmed: confirmed.length,
      totalNeedsReview: needsReview.length,
      totalNotFound: notFound.length,
      confirmed, needsReview, notFound
    }, null, 2));
  }
}

module.exports = ScraperOrchestrator;

// Run the orchestrator
(async () => {
  const orchestrator = new ScraperOrchestrator();
  await orchestrator.run();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
