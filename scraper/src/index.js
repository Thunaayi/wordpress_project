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
  constructor() {
    this.errors = [];
  }

  async run() {
    console.log("=== Starting Product Scraper Orchestrator ===\n");

    // 1. Load master products (the distributor price lists)
    console.log("Loading master products...");
    const masterProducts = loadMasterProducts();
    console.log("Loaded " + masterProducts.length + " master products\n");

    // 2. Load your actual WordPress catalog, so scraped results can be tied
    //    to a real product ID/SKU instead of just a name.
    console.log("Loading current WooCommerce products...");
    const dbProducts = loadDBProducts();
    console.log("Loaded " + dbProducts.length + " WooCommerce products\n");

    // 3. Initialize scrapers ONCE, keyed by name, reused everywhere below.
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

    // Group distributor products by source brand/sheet
    const productsBySource = {};
    for (const product of masterProducts) {
      const source = (product.source || product.sourceBrand || "").trim();
      if (!productsBySource[source]) productsBySource[source] = [];
      productsBySource[source].push(product);
    }

    console.log("\nProducts by source:");
    for (const [source, products] of Object.entries(productsBySource).sort((a, b) => b[1].length - a[1].length)) {
      console.log("  " + source + ": " + products.length);
    }

    const confirmed = [];
    const needsReview = [];
    const notFound = [];

    for (const [source, products] of Object.entries(productsBySource)) {
      console.log("\n=== Processing " + source + " (" + products.length + " products) ===");

      const scraperName = this.getScraperNameForSource(source);
      const scraper = scraperName ? scraperMap[scraperName] : null;
      if (!scraper) {
        console.log("No scraper available for " + source + ", skipping...");
        continue;
      }

      try {
        const { matched, review, missing } = await this.scrapeProducts(scraper, products, dbProducts);
        console.log(
          "  " + matched.length + " confirmed, " + review.length + " need manual review, " + missing.length + " not found"
        );
        confirmed.push(...matched);
        needsReview.push(...review);
        notFound.push(...missing);
      } catch (e) {
        console.error("Error scraping " + source + ": " + e.message);
      }
    }

    for (const [name, scraper] of Object.entries(scraperMap)) {
      try {
        await scraper.close();
      } catch (e) {
        console.error("Failed to close " + name + ": " + e.message);
      }
    }

    this.saveAllResults(confirmed, needsReview, notFound);

    console.log("\n=== SCRAPING COMPLETE ===");
    console.log("Confirmed matches: " + confirmed.length);
    console.log("Needs manual review: " + needsReview.length);
    console.log("Not found: " + notFound.length);
  }

  getScraperNameForSource(source) {
    const lower = source.toLowerCase();

    if (lower.includes("thermalright")) return "tech.com.pk";
    if (lower.includes("asus")) return "tech.com.pk";
    if (lower.includes("msi")) return "pclab.pk";
    if (lower.includes("a4tech") || lower.includes("bloody")) return "tech.com.pk";
    if (lower.includes("ugreen")) return "tech.com.pk";
    if (lower.includes("pxn")) return "pclab.pk";
    if (lower.includes("maxsun")) return "pclab.pk";
    if (lower.includes("whatsapp")) return null; // WhatsApp images - no scraper
    if (lower.includes("gm multi-brand") || lower.includes("gm multi brand")) return "tech.com.pk";

    return null;
  }

  async scrapeProducts(scraper, products, dbProducts) {
    const matched = [];
    const review = [];
    const missing = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log("  [" + (i + 1) + "/" + products.length + "] " + product.name);

      try {
        const siteMatch = await this.searchProduct(scraper, product);

        if (siteMatch) {
          const data = await this.scrapeProduct(scraper, siteMatch.url, product);
          if (data) {
            data.originalProduct = product;
            data.matchedName = product.name;
            data.siteMatchConfidence = siteMatch.score;

            // Tie this back to a real WordPress product so the output is
            // directly usable for an update, not just a pile of scraped data.
            const wpMatch = this.findBestDBMatch(product.name, dbProducts);
            data.wordpressId = wpMatch ? wpMatch.product.id : null;
            data.wordpressSku = wpMatch ? wpMatch.product.sku : null;
            data.wordpressMatchConfidence = wpMatch ? wpMatch.score : 0;
            data.suggestedPrice = calculateNewPrice(product.price);

            // Both the site match AND the WordPress match need to clear the
            // bar for this to be auto-applied. Either one being shaky means
            // a person should look at it first.
            const overallConfidence = Math.min(data.siteMatchConfidence, data.wordpressMatchConfidence);

            if (overallConfidence >= MATCH_THRESHOLD && data.wordpressId) {
              matched.push(data);
              console.log("    Matched (site " + Math.round(data.siteMatchConfidence * 100) + "%, WP " + Math.round(data.wordpressMatchConfidence * 100) + "%)");
            } else {
              review.push(data);
              console.log("    Low confidence (site " + Math.round(data.siteMatchConfidence * 100) + "%, WP " + Math.round(data.wordpressMatchConfidence * 100) + "%) — flagged for review");
            }
          } else {
            missing.push({ product, reason: "found a page but could not extract data" });
            console.log("    Failed to extract data");
          }
        } else {
          missing.push({ product, reason: "no candidate found on site" });
          console.log("    Not found on site");
        }
      } catch (e) {
        missing.push({ product, reason: e.message });
        console.error("    Error: " + e.message);
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    return { matched, review, missing };
  }

  // Finds the best-matching existing WordPress product for a distributor
  // product name, using the same calculateSimilarity the rest of the repo
  // already defines (and previously never called).
  findBestDBMatch(productName, dbProducts) {
    let best = null;
    for (const dbProduct of dbProducts) {
      const score = calculateSimilarity(productName, dbProduct.name);
      if (!best || score > best.score) {
        best = { product: dbProduct, score };
      }
    }
    return best;
  }

  async searchProduct(scraper, product) {
    const searchUrl = scraper.siteConfig.searchUrl.replace("{query}", encodeURIComponent(product.name));

    try {
      await scraper.goto(searchUrl);
      await scraper.sleep(2000);

      const resultSelectors = scraper.siteConfig.searchSelectors?.results || ".search-results, .products-grid, .product-listing";
      const linkSelectors = scraper.siteConfig.selectors?.productLink
        ? [scraper.siteConfig.selectors.productLink]
        : [".product-item a", ".product-card a", ".product a"];

      await scraper.waitForSelector(resultSelectors);

      let best = null;
      for (const linkSel of linkSelectors) {
        const links = await scraper.page.$$(linkSel);
        for (const link of links) {
          try {
            const text = await link.evaluate((el) => el.textContent.trim());
            const href = await link.evaluate((el) => el.getAttribute("href"));
            if (!text || !href) continue;

            const score = calculateSimilarity(product.name, text);
            if (!best || score > best.score) {
              best = { url: href, score, matchedText: text };
            }
          } catch (e) {
            // Skip this link if it errors out
          }
        }
      }

      return best;
    } catch (e) {
      console.log("Search failed: " + e.message);
      return null;
    }
  }

  async scrapeProduct(scraper, productUrl, originalProduct) {
    await scraper.goto(productUrl);
    await scraper.sleep(2000);

    const specsTab = scraper.siteConfig.selectors.specsTab;
    if (specsTab) {
      await scraper.clickElement(specsTab);
      await scraper.sleep(1000);
    }

    await scraper.scrollToBottom();
    await scraper.sleep(1000);

    const name = await scraper.extractText(scraper.siteConfig.selectors.name);
    const price = await scraper.extractText(scraper.siteConfig.selectors.price);
    const originalPrice = await scraper.extractText(scraper.siteConfig.selectors.originalPrice);
    const description = await scraper.extractText(scraper.siteConfig.selectors.description);
    const shortDescription = await scraper.extractText(scraper.siteConfig.selectors.shortDescription);
    const brand = await scraper.extractText(scraper.siteConfig.selectors.brand);
    const sku = await scraper.extractText(scraper.siteConfig.selectors.sku);
    const availability = await scraper.extractText(scraper.siteConfig.selectors.availability);
    const breadcrumbs = await scraper.extractText(scraper.siteConfig.selectors.breadcrumbs);

    const specs = await this.extractSpecs(scraper);

    const mainImage = await scraper.extractAttribute(scraper.siteConfig.selectors.mainImage, "src");
    const galleryImages = await scraper.extractAllAttributes(scraper.siteConfig.selectors.galleryImages, "src");
    const allImages = [mainImage, ...galleryImages].filter(Boolean);

    const imagePaths = await this.downloadProductImages(allImages);

    return {
      name: name || "Unknown",
      price: this.parsePrice(price),
      originalPrice: this.parsePrice(originalPrice),
      description: description || "",
      shortDescription: shortDescription || "",
      specs: specs || {},
      brand: brand || this.extractBrandFromName(name || originalProduct.name),
      sku: sku || this.generateSku(name || originalProduct.name),
      category: this.extractCategory(breadcrumbs),
      availability: availability || "In Stock",
      images: imagePaths,
      sourceUrl: scraper.page.url(),
      scrapedAt: new Date().toISOString(),
    };
  }

  async extractSpecs(scraper) {
    // FIX: the old version built `tableSpecs` and then never copied it into
    // `specsResult` — it always returned {}. The loop below is what was missing.
    const tableSpecs =
      (await scraper.page.$$eval(
        ".specifications-table tr, .product-specifications tr, .product-attributes tr, .data-table tr, .woocommerce-product-attributes tr",
        (rows) => {
          return rows
            .map((row) => {
              const cells = row.querySelectorAll("th, td");
              if (cells.length >= 2) {
                return { label: cells[0].textContent.trim(), value: cells[1].textContent.trim() };
              }
              return null;
            })
            .filter(Boolean);
        }
      )) || [];

    const specsResult = {};
    for (const spec of tableSpecs) {
      if (spec.label && spec.value) {
        specsResult[spec.label.toLowerCase().replace(/[^a-z0-9]/g, "_")] = spec.value;
      }
    }

    return specsResult;
  }

  parsePrice(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[^0-9.]/g, "")) || 0;
  }

  extractBrandFromName(name) {
    const brands = [
      "thermalright", "asus", "msi", "logitech", "razer", "steelseries", "xpg", "cougar", "ugreen",
      "a4tech", "bloody", "pxn", "maxsun", "lian li", "gigabyte", "deepcool", "id-cooling", "be quiet",
      "noctua", "arctic", "fractal design", "phanteks", "nzxt", "hyte", "inwin", "seasonic", "evga",
      "asrock", "biostar", "colorful", "gainward", "palit", "zotac", "inno3d", "thermaltake", "antec",
      "silverstone", "darkflash", "aigo", "jonsbo", "segotep", "dahua", "crucial", "silicon power",
      "alpha", "lexar", "pny", "ramsta", "hiksemi",
    ];
    const lowerName = (name || "").toLowerCase();
    for (const brand of brands) {
      if (lowerName.includes(brand)) return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
    return (name || "").split(" ")[0];
  }

  generateSku(name) {
    return (name || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 50);
  }

  extractCategory(breadcrumbs) {
    const categories = [
      "Motherboard", "Graphics Card", "Cooling Solutions", "Casing", "Power Supply", "Monitor", "Mouse",
      "Keyboard", "Headset", "Headphones", "Memory (RAM)", "Storage", "Laptop", "Gaming Laptop", "Webcam",
      "Microphone", "Speakers", "Gaming Chair", "Gaming Desk", "Controllers", "Router", "Switch", "UPS",
      "Projector", "TV", "Thermal Paste", "CPU Cooler", "Liquid Cooler", "Case Fan", "PSU Extension Cables",
      "Presenters", "Monitor Arm", "Projector Screen", "Graphic Tablet", "LCD", "LEDs", "Mousepad", "Earbuds",
      "Processors (CPU)", "Mini PC (NUC)", "Projectors", "ROG ALLY", "Routers", "Scanner", "Switches",
      "WIRELESS ADAPTERs",
    ];
    for (const cat of categories) {
      if (breadcrumbs?.toLowerCase().includes(cat.toLowerCase())) return cat;
    }
    return "Uncategorized";
  }

  // Takes an array of image URLs, returns an array of local filenames.
  // FIX: previously called twice per product — once here (correctly, on
  // real URLs) and again in scrapeProducts() on the SAME data object after
  // data.images had already been overwritten with local filenames, so the
  // second call tried to "download" local filenames as if they were URLs
  // and failed silently every time. Now only called once.
  async downloadProductImages(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) return [];

    const baseDir = path.join(__dirname, "../../data/images");
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    const paths = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      if (!url) continue;

      try {
        const filename = "img_" + Date.now() + "_" + i + this.getImageExtension(url);
        const savePath = path.join(baseDir, filename);

        await new Promise((resolve, reject) => {
          const protocol = url.startsWith("https") ? https : http;
          const req = protocol.get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              fs.writeFileSync(savePath, Buffer.concat(chunks));
              resolve();
            });
          });
          req.on("error", reject);
          req.setTimeout(30000, () => reject(new Error("Timeout")));
        });

        paths.push(filename);
      } catch (e) {
        console.error("Failed to download image: " + url + " (" + e.message + ")");
      }
    }
    return paths;
  }

  getImageExtension(url) {
    try {
      const urlObj = new URL(url);
      const match = urlObj.pathname.match(/\.(jpg|jpeg|png|webp|gif|avif)(?:\?.*)?$/i);
      return match ? match[0].split("?")[0] : ".jpg";
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
      // Only `confirmed` carries both a real wordpressId AND a confidence
      // above threshold on both the site match and the WordPress match —
      // that's the only bucket meant for an unattended update script.
      confirmed,
      needsReview,
      notFound,
    };

    fs.writeFileSync(path.join(outputDir, "scraped_products.json"), JSON.stringify(output, null, 2));
    console.log("Saved results to output/scraped_products.json");
    console.log("  -> confirmed: " + confirmed.length + " (has a real WordPress product ID, safe to auto-apply)");
    console.log("  -> needsReview: " + needsReview.length + " (check these by hand before touching WordPress)");
    console.log("  -> notFound: " + notFound.length);
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
