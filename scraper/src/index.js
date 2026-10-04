const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

const {
  loadMasterProducts,
  loadDBProducts,
  calculateSimilarity,
  calculateNewPrice,
  normalizeName,
  extractModelTokens,
  extractBrandFromName,
  hasVariantMismatch,
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

    // czone.com.pk is deliberately NOT in this list. Its search.aspx
    // endpoint 404s (confirmed by fetching it directly), and there's no
    // evidence the brands in this pipeline are even carried there — it was
    // added as an unverified guess and never actually confirmed working.
    // Every product was paying 3 retries x 2 templates x 2 queries for a
    // dead endpoint, 100% failure, zero matches, across the whole run. If
    // you confirm the real search URL by hand (type a query into czone's
    // actual search box and check the Network tab for the request it makes
    // — it may be a JS/AJAX call, not a simple page you can GET), add it
    // back to sites.js and re-add it here.

    // PCLab has a large current catalog, so use it as the broad fallback
    // rather than silently skipping unknown source brands.
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

    // siteMatch.score only reflects the search-results snippet (link text or
    // URL slug), which can be a generic blurb without the version/color that
    // actually distinguishes this product — that's how a V3-White page slid
    // through at 95% against a "V6 Black" request. Now that the real page is
    // open, re-check the match against its ACTUAL title, which is the one
    // place the true variant can't be hidden, and trust whichever score is
    // more skeptical.
    const pageNameScore = calculateSimilarity(product.name, data.name);
    data.siteMatchConfidence = Math.min(siteMatch.score, pageNameScore);

    if (hasVariantMismatch(normalizeName(product.name), normalizeName(data.name))) {
      console.log("    Rejected: page title is \"" + data.name + "\" — variant mismatch against \"" + product.name + "\"");
      return null;
    }

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
      const templates = scraper.siteConfig.searchUrls ||
        [scraper.siteConfig.searchUrl || (scraper.siteConfig.baseUrl + "/?s={query}")];

      for (const template of templates) {
        const searchUrl = template.replace("{query}", encodeURIComponent(query));

        try {
          await scraper.goto(searchUrl);
          await scraper.sleep(900);

          const candidates = await scraper.page.$$eval("a[href]", (links, baseUrl) => {
          return links.map((link) => ({
            text: (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim(),
            href: (() => {
              try { return new URL(link.getAttribute("href"), baseUrl).href; }
              catch { return ""; }
            })()
          })).filter(x => x.href);
        }, scraper.siteConfig.baseUrl);

        let best = null;
        for (const candidate of candidates) {
          if (!this.isLikelyProductUrl(candidate.href, scraper.siteConfig)) continue;

          // Track which source actually produced the score, so the log says
          // what was really compared instead of always printing the link's
          // visible text — that text can be something like "Add to cart" or
          // blank while the real match came from the URL slug, which was
          // printing a confusing "Found on X: Add to cart" with no clue that
          // the slug, not the button label, is what scored well.
          const textScore = calculateSimilarity(product.name, candidate.text);
          const slugName = this.slugToName(candidate.href);
          const slugScore = calculateSimilarity(product.name, slugName);
          const score = Math.max(textScore, slugScore);
          const matchedText = slugScore >= textScore ? slugName : candidate.text;

          if (!best || score > best.score) {
            best = { url: candidate.href, score, matchedText };
          }
        }

          if (best && best.score >= 0.50) return best;
        } catch (e) {
          console.log("  Search failed on " + scraper.siteConfig.name + ": " + e.message);
        }
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

      // Czone's real product pages match config.productUrlPattern
      // (slug-p.<id>.aspx), already checked above. The blanket "any .aspx
      // URL" fallback this used to have was matching Cart.aspx, Login.aspx,
      // Default.aspx and the like — those are real czone URLs and pass the
      // host check, but they're not products. A page like that has nothing
      // useful for calculateSimilarity to compare against, and whatever
      // scrap of link text it does carry (a cart badge count, a nav label)
      // can accidentally look like a match. Reject known non-product
      // filenames explicitly instead of trusting ".aspx" alone.
      if (host === "czone.com.pk") {
        const NON_PRODUCT_ASPX = /\/(default|cart|login|logon|register|signup|signin|wishlist|compare|checkout|myaccount|account|search|contactus|aboutus|sitemap|error|forgotpassword|basket|order|tracking)\.aspx$/i;
        if (NON_PRODUCT_ASPX.test(parsed.pathname)) return false;

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

    // Many themes hide the real spec sheet behind a "Specifications" /
    // "Additional Information" tab that only renders once clicked. Try the
    // common ones; harmless no-op if the site doesn't use tabs at all.
    try {
      const clicked = await scraper.clickElement([
        "a[href='#tab-additional_information']", "a[href='#tab-specification']",
        "#tab-title-additional_information a", ".specification-tab", ".tab-specs",
        "a[data-tab='specification']", "a[data-tab='additional_information']",
        "#tab-specifications", ".specs-tab",
      ]);
      if (clicked) await scraper.sleep(500);
    } catch (e) {
      // non-fatal: site doesn't use tabs, specs are probably already visible
    }

    // Lazy-loaded galleries only swap in the real photo once it scrolls into
    // view — without this, extraction can grab the site's generic "no photo"
    // placeholder icon instead of the actual product image.
    try {
      await scraper.scrollToBottom();
      await scraper.sleep(800);
    } catch (e) {
      // non-fatal, extraction still runs on whatever loaded
    }

    // Some gallery sliders (Slick/Swiper/Owl and similar) only keep ONE
    // photo's <img src> in the DOM at a time and swap it via JS when a
    // thumbnail is clicked, rather than keeping every slide present (which
    // ProductExtractor's plain DOM read would already catch on its own).
    // Click through whatever thumbnails exist and collect the main image's
    // src after each click, so multi-photo products don't come back with
    // only the one photo that happened to be showing on page load.
    const extraGalleryImages = await this.collectGalleryImagesByClicking(scraper);

    const extracted = await ProductExtractor.extract(scraper.page);
    if (extraGalleryImages.length) {
      extracted.images = [...new Set([...(extracted.images || []), ...extraGalleryImages])];
    }

    if (!extracted.name) {
      return null;
    }

    const sku = extracted.sku || this.generateSku(extracted.name);

    // Name files after the product we're actually trying to fill in (the
    // distributor/master name, which is what the rest of the pipeline and
    // the WordPress match are keyed on) rather than a timestamp, so anyone
    // looking at data/images can tell which photo belongs to which product
    // without opening the JSON.
    const imageIdentity = (originalProduct && originalProduct.name) || extracted.name || sku;
    const imageUrls = [...new Set(extracted.images || [])];
    const imagePaths = await this.downloadProductImages(imageUrls, scraper.page.url(), imageIdentity, sku);

    return {
      // Display name comes from YOUR distributor list, not the scraped
      // page's own title. The scraped title is still used upstream (in
      // scrapeFromSite) to score the match and catch a color/version
      // mismatch — but once a match is accepted, your source name is the
      // ground truth for what this product is actually called, not however
      // a given site's template happens to word its own listing.
      name: (originalProduct && originalProduct.name) || extracted.name || "Unknown",
      scrapedPageTitle: extracted.name || "",
      price: this.parsePrice(extracted.price),
      currency: extracted.currency || "PKR",
      description: extracted.description || "",
      shortDescription: extracted.description || "",
      specs: extracted.specs || {},
      brand: extracted.brand || this.extractBrandFromName(extracted.name),
      sku,
      category: this.extractCategory(extracted.breadcrumbs),
      availability: extracted.availability || "Unknown",
      images: imagePaths,
      imageUrls,
      sourceUrl: scraper.page.url(),
      scrapedAt: new Date().toISOString(),
    };
  }

  // Turns a product name into a safe, readable filename fragment:
  // "Thermalright TL-M10 Vision LCD Black" -> "thermalright-tl-m10-vision-lcd-black"
  slugify(text) {
    const slug = String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 60);
    return slug || "product";
  }

  // Clicks through common gallery-thumbnail selectors one at a time and
  // records whatever the "main" product image's src is after each click.
  // Harmless no-op on a site that keeps all slides in the DOM at once
  // (ProductExtractor already catches those); this is specifically for
  // sliders that swap a single <img> via JS per click.
  async collectGalleryImagesByClicking(scraper) {
    const thumbnailSelectors = [
      ".flex-control-thumbs img", ".woocommerce-product-gallery__image--placeholder",
      ".product-thumbnails img", ".thumbnail-list img", ".gallery-thumbs img",
      ".slick-thumbs img", ".swiper-thumbs img", ".product-gallery-thumbs img",
      ".thumbnails img", ".pdp-thumbnails img",
    ];
    const mainImageSelectors = [
      ".woocommerce-product-gallery__image img", ".product-main-image img",
      ".product-image-main img", ".pdp-main-image img", ".main-image img",
    ];

    const collected = [];
    try {
      for (const thumbSel of thumbnailSelectors) {
        const thumbs = await scraper.page.$$(thumbSel);
        if (!thumbs.length) continue;

        for (let i = 0; i < Math.min(thumbs.length, 12); i++) {
          try {
            await thumbs[i].click();
            await scraper.sleep(400);
            const src = await scraper.page.evaluate((selectors) => {
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                  const v = el.getAttribute("data-large_image") || el.getAttribute("data-src") || el.src;
                  if (v) return v;
                }
              }
              return null;
            }, mainImageSelectors);
            if (src) collected.push(new URL(src, scraper.page.url()).href);
          } catch (e) {
            // this particular thumbnail wasn't clickable, move on
          }
        }
        break; // found a working thumbnail selector, no need to try the rest
      }
    } catch (e) {
      // non-fatal — extraction still runs on whatever ProductExtractor found
    }
    return [...new Set(collected)];
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

  async downloadProductImages(imageUrls, referer, productIdentity, sku) {
    if (!imageUrls.length) return [];

    const baseDir = path.join(__dirname, "../../data/images");
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    const slug = this.slugify(productIdentity);
    const skuPart = sku ? "_" + this.slugify(sku).substring(0, 20) : "";

    const paths = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      try {
        // A short hash of the URL (not a timestamp) keeps re-runs of the same
        // product deterministic — the same photo gets the same filename
        // instead of piling up duplicates every time the scraper runs again.
        const urlHash = crypto.createHash("md5").update(url).digest("hex").substring(0, 8);
        const filename = slug + skuPart + "_" + (i + 1) + "_" + urlHash + this.getImageExtension(url);
        const savePath = path.join(baseDir, filename);
        await this.downloadUrlWithRetry(url, savePath, referer);
        paths.push(filename);
      } catch (e) {
        console.error("    Image failed: " + e.message);
      }
    }
    return paths;
  }

  // A DNS blip or a dropped connection shouldn't cost a product all its
  // photos — retry transient network failures (ENOTFOUND, ECONNRESET,
  // ETIMEDOUT, a dropped connection) a couple of times before giving up.
  // An HTTP error (404, etc.) isn't transient, so that fails immediately.
  async downloadUrlWithRetry(url, savePath, referer, maxAttempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.downloadUrl(url, savePath, referer);
      } catch (e) {
        lastError = e;
        const transient = /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|Timeout/i.test(e.message || "");
        if (!transient || attempt === maxAttempts) throw e;
        console.log("    Image attempt " + attempt + "/" + maxAttempts + " failed (" + e.message + "), retrying...");
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    throw lastError;
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
