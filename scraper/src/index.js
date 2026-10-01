const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { loadMasterProducts } = require("./utils/helpers");
const TechpScraper = require("./scrapers/TechpScraper");
const TechladScraper = require("./scrapers/TechladScraper");
const ZahcomputersScraper = require("./scrapers/ZahcomputersScraper");
const PclabScraper = require("./scrapers/PclabScraper");

/**
 * Main orchestrator for scraping all products
 */
class ScraperOrchestrator {
  constructor() {
    this.allProducts = [];
    this.allResults = {};
    this.errors = [];
  }

  async run() {
    console.log("=== Starting Product Scraper Orchestrator ===\n");
    
    // 1. Load master products
    console.log("Loading master products...");
    const masterProducts = loadMasterProducts();
    console.log("Loaded " + masterProducts.length + " master products\n");
    
    // 2. Initialize scrapers
    const scrapers = [
      { name: "tech.com.pk", scraper: new (require("./scrapers/TechpScraper"))() },
      { name: "techlad.pk", scraper: new (require("./scrapers/TechladScraper"))() },
      { name: "zahcomputers.pk", scraper: new (require("./scrapers/ZahcomputersScraper"))() },
      { name: "pclab.pk", scraper: new (require("./scrapers/PclabScraper"))() },
    ];
    
    // Initialize all scrapers
    for (const { name, scraper } of scrapers) {
      try {
        await scraper.init(true);
        console.log("Initialized " + name);
      } catch (e) {
        console.error("Failed to initialize " + name + ": " + e.message);
      }
    }
    
    // Group products by source
    const productsBySource = {};
    
    for (const product of masterProducts) {
      const source = (product.source || product.sourceBrand || product.Source || "").trim();
      if (!productsBySource[source]) productsBySource[source] = [];
      productsBySource[source].push(product);
    }
    
    console.log("\nProducts by source:");
    for (const [source, products] of Object.entries(productsBySource).sort((a,b) => b[1].length - a[1].length)) {
      console.log("  " + source + ": " + products.length);
    }
    
    // Process each source with appropriate scraper
    const allResults = [];
    
    for (const [source, products] of Object.entries(productsBySource)) {
      console.log("\n=== Processing " + source + " (" + products.length + " products) ===");
      
      // Find appropriate scraper
      let scraper = this.getScraperForSource(source);
      if (!scraper) {
        console.log("No scraper available for " + source + ", skipping...");
        continue;
      }
      
      try {
        await scraper.init(true);
        const results = await this.scrapeProducts(scraper, products);
        console.log("Scraped " + results.length + " products for " + source);
        allResults.push(...results);
      } catch (e) {
        console.error("Error scraping " + source + ": " + e.message);
      } finally {
        await scraper.close();
      }
    }
    
    // Save all results
    this.saveAllResults(allResults);
    
    console.log("\n=== SCRAPING COMPLETE ===");
    console.log("Total products scraped: " + allResults.length);
  }
  
  getScraperForSource(source) {
    const lower = source.toLowerCase();
    
    if (lower.includes("thermalright")) return new (require("./scrapers/TechpScraper"))();
    if (lower.includes("asus")) return new (require("./scrapers/TechpScraper"))();
    if (lower.includes("msi")) return new (require("./scrapers/PclabScraper"))();
    if (lower.includes("a4tech") || lower.includes("bloody")) return new (require("./scrapers/TechpScraper"))();
    if (lower.includes("ugreen")) return new (require("./scrapers/TechpScraper"))();
    if (lower.includes("pxn")) return new (require("./scrapers/PclabScraper"))();
    if (lower.includes("maxsun")) return new (require("./scrapers/PclabScraper"))();
    if (lower.includes("whatsapp")) return null; // WhatsApp images - no scraper
    if (lower.includes("gm multi-brand") || lower.includes("gm multi brand")) return new (require("./scrapers/TechpScraper"))();
    if (lower.includes("thermalright")) return new (require("./scrapers/TechpScraper"))();
    
    return null;
  }
  
  getGenericScraper() {
    return new (require("./scrapers/TechpScraper"))();
  }
  
  async scrapeProducts(scraper, products) {
    const results = [];
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log("  [" + (i+1) + "/" + products.length + "] " + product.name);
      
      try {
        // Search for product on site
        const productUrl = await this.searchProduct(scraper, product);
        
        if (productUrl) {
          const data = await this.scrapeProduct(scraper, productUrl, product);
          if (data) {
            data.originalProduct = product;
            data.matchedName = product.name;
            this.downloadProductImages(data);
            results.push(data);
            console.log("    Scraped successfully");
          } else {
            console.log("    Failed to extract data");
          }
        } else {
          console.log("    Not found on site");
        }
      } catch (e) {
        console.error("    Error: " + e.message);
      }
      
      // Small delay between products
      await new Promise(r => setTimeout(r, 1000));
    }
    
    return results;
  }
  
  async searchProduct(scraper, product) {
    // Try direct URL construction first
    const searchUrl = scraper.siteConfig.searchUrl.replace("{query}", encodeURIComponent(product.name));
    
    try {
      await scraper.goto(searchUrl);
      await scraper.sleep(2000);
      
      // Try to find product link in search results
      const resultSelectors = scraper.siteConfig.searchSelectors?.results || ".search-results, .products-grid, .product-listing";
      const linkSelectors = scraper.siteConfig.searchSelectors?.results ? [scraper.siteConfig.selectors.productLink] : [".productCard a, .productCard a, .productCard a, .product-item a", ".product-card a", ".product a"];
      
      await scraper.waitForSelector(resultSelectors);
      
      // Try to find matching product link
      for (const linkSel of linkSelectors) {
        const links = await scraper.page.$$(linkSel);
        for (const link of links) {
          try {
            const text = await link.evaluate(el => el.textContent.trim().toLowerCase());
            const href = await link.evaluate(el => el.getAttribute("href"));
            
            if (text && this.nameMatches(text, scraper)) {
              return href;
            }
          } catch (e) {
            // Skip this link if error
          }
        }
      }
    } catch (e) {
      console.log("Search failed: " + e.message);
    }
    
    return null;
  }
  
  nameMatches(text, scraper) {
    // Simple fuzzy match - check if key product terms are in the text
    return true; // Simplified for now
  }
  
  async scrapeProduct(scraper, productUrl, originalProduct) {
    await scraper.goto(productUrl);
    await scraper.sleep(2000);
    
    // Try specs tab
    const specsTab = scraper.siteConfig.selectors.specsTab;
    if (specsTab) {
      await scraper.clickElement(specsTab);
      await scraper.sleep(1000);
    }
    
    await scraper.scrollToBottom();
    await scraper.sleep(1000);
    
    // Extract data
    const name = await scraper.extractText(scraper.siteConfig.selectors.name);
    const price = await scraper.extractText(scraper.siteConfig.selectors.price);
    const originalPrice = await scraper.extractText(scraper.siteConfig.selectors.originalPrice);
    const description = await scraper.extractText(scraper.siteConfig.selectors.description);
    const shortDescription = await scraper.extractText(scraper.siteConfig.selectors.shortDescription);
    const brand = await scraper.extractText(scraper.siteConfig.selectors.brand);
    const sku = await scraper.extractText(scraper.siteConfig.selectors.sku);
    const availability = await scraper.extractText(scraper.siteConfig.selectors.availability);
    const breadcrumbs = await scraper.extractText(scraper.siteConfig.selectors.breadcrumbs);
    
    // Specs extraction
    const specs = await this.extractSpecs(scraper);
    
    // Images
    const mainImage = await scraper.extractAttribute(scraper.siteConfig.selectors.mainImage, "src");
    const galleryImages = await scraper.extractAllAttributes(scraper.siteConfig.selectors.galleryImages, "src");
    const allImages = [mainImage, ...galleryImages].filter(Boolean);
    
    // Download images
    const imagePaths = await this.downloadProductImages({ images: allImages });
    
    return {
      name: name || "Unknown",
      price: this.parsePrice(price),
      originalPrice: this.parsePrice(originalPrice),
      description: description || "",
      shortDescription: shortDescription || "",
      specs: specs || {},
      brand: brand || this.extractBrandFromName(name),
      sku: sku || this.generateSku(name),
      category: this.extractCategory(breadcrumbs),
      availability: availability || "In Stock",
      images: imagePaths,
      sourceUrl: scraper.page.url(),
      scrapedAt: new Date().toISOString(),
    };
  }
  
  async extractSpecs(scraper) {
    const specsResult = {};
    
    // Table specs
    const tableSpecs = await scraper.page.$$eval(".specifications-table tr, .product-specifications tr, .product-attributes tr, .data-table tr, .woocommerce-product-attributes tr", rows => {
      return rows.map(row => {
        const cells = row.querySelectorAll("th, td");
        if (cells.length >= 2) {
          return { label: cells[0].textContent.trim(), value: cells[1].textContent.trim() };
        }
        return null;
      }).filter(Boolean);
    }) || [];
    
    
    
    return specsResult;
  }
  
  parsePrice(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[^0-9.]/g, "")) || 0;
  }
  
  extractBrandFromName(name) {
    const brands = ["thermalright", "asus", "msi", "logitech", "razer", "steelseries", "xpg", "cougar", "ugreen", "a4tech", "bloody", "pxn", "maxsun", "lian li", "cougar", "gigabyte", "deepcool", "id-cooling", "be quiet", "noctua", "arctic", "fractal design", "phanteks", "nzxt", "hyte", "inwin", "seasonic", "evga", "asrock", "biostar", "colorful", "gainward", "palit", "zotac", "inno3d", "thermaltake", "antec", "silverstone", "darkflash", "aigo", "jonsbo", "segotep", "dahua", "crucial", "silicon power", "alpha", "lexar", "pny", "zotac", "ramsta", "hiksemi"];
    const lowerName = name.toLowerCase();
    for (const brand of brands) {
      if (lowerName.includes(brand)) return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
    return name.split(" ")[0];
  }
  
  generateSku(name) {
    return name.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 50);
  }
  
  extractCategory(breadcrumbs) {
    const categories = ["Motherboard", "Graphics Card", "Cooling Solutions", "Casing", "Power Supply", "Monitor", "Mouse", "Keyboard", "Headset", "Headphones", "Memory (RAM)", "Storage", "Laptop", "Gaming Laptop", "Webcam", "Microphone", "Speakers", "Gaming Chair", "Gaming Desk", "Controllers", "Router", "Switch", "UPS", "Projector", "TV", "Thermal Paste", "CPU Cooler", "Liquid Cooler", "Case Fan", "PSU Extension Cables", "Presenters", "Monitor Arm", "Projector Screen", "Graphic Tablet", "LCD", "LEDs", "Mousepad", "Earbuds", "Graphic Tablet", "Processors (CPU)", "Mini PC (NUC)", "Monitor Arm", "Projectors", "ROG ALLY", "Routers", "Scanner", "Switches", "TV", "Thermal Paste", "UPS", "WIRELESS ADAPTERs", "Webcam"];
    for (const cat of categories) {
      if (breadcrumbs?.toLowerCase().includes(cat.toLowerCase())) return cat;
    }
    return "Uncategorized";
  }
  
  generateSku(name) {
    return name.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 50);
  }
  
  async downloadProductImages(data) {
    if (!data.images || data.images.length === 0) return [];
    
    const baseDir = path.join(__dirname, "../../data/images");
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    
    const paths = [];
    for (let i = 0; i < data.images.length; i++) {
      const url = data.images[i];
      if (!url) continue;
      
      try {
        const ext = this.getImageExtension(url);
        const filename = "img_" + Date.now() + "_" + i + this.getImageExtension(data.images[i]);
        const savePath = path.join(__dirname, "../../data/images", filename);
        
        await new Promise((resolve, reject) => {
          const protocol = url.startsWith("https") ? https : http;
          const req = (url.startsWith("https") ? https : http).get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
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
        console.error("Failed to download image: " + url);
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
  
  generateSku(name) {
    return name.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 50);
  }
  
  extractBrandFromName(name) {
    const brands = ["thermalright", "asus", "msi", "logitech", "razer", "steelseries", "xpg", "cougar", "ugreen", "a4tech", "bloody", "pxn", "maxsun", "lian li", "cougar", "gigabyte", "deepcool", "id-cooling", "be quiet", "noctua", "arctic", "fractal design", "phanteks", "nzxt", "hyte", "inwin", "seasonic", "evga", "asrock", "biostar", "colorful", "gainward", "palit", "zotac", "inno3d", "thermaltake", "antec", "silverstone", "darkflash", "aigo", "jonsbo", "segotep", "dahua", "crucial", "silicon power", "alpha", "lexar", "pny", "zotac", "ramsta", "hiksemi"];
    const lowerName = name.toLowerCase();
    for (const brand of brands) {
      if (lowerName.includes(brand)) return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
    return name.split(" ")[0];
  }
  
  generateSku(name) {
    return name.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 50);
  }
  
  saveAllResults(allResults) {
    const outputDir = path.join(__dirname, "../../output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    const output = {
      scrapedAt: new Date().toISOString(),
      totalProducts: allResults.length,
      products: allResults,
    };
    
    fs.writeFileSync(path.join(__dirname, "../../output/scraped_products.json"), JSON.stringify(output, null, 2));
    console.log("Saved " + allResults.length + " products to output/scraped_products.json");
  }
}

module.exports = ScraperOrchestrator;

// Run the orchestrator
(async () => {
  const orchestrator = new ScraperOrchestrator();
  await orchestrator.run();
})().catch(e => { console.error(e); process.exit(1); });
