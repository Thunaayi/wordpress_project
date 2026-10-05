const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");

puppeteer.use(StealthPlugin());

/**
 * Base Scraper Class
 * Handles common functionality for all site scrapers
 */
class BaseScraper {
  constructor(siteConfig) {
    this.siteConfig = siteConfig;
    this.browser = null;
    this.page = null;
    this.results = [];
    this.errors = [];
  }

  async init(headless = true) {
    this.browser = await puppeteer.launch({
      headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });
    
    this.page = await this.browser.newPage();
    
    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    
    await this.page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,ur;q=0.8",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
    });
    
    await this.page.setRequestInterception(true);
    this.page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["font", "media", "stylesheet"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  async goto(url, options = {}) {
    const maxRetries = 4;
    const timeout = options.timeout || 60000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.page.goto(url, { 
          waitUntil: "domcontentloaded", 
          timeout 
        });
        if (response && response.ok()) {
          return response;
        }
        throw new Error("HTTP " + response?.status());
      } catch (error) {
        console.log("Attempt " + attempt + "/" + maxRetries + " failed for " + url + ": " + error.message);
        if (attempt === maxRetries) throw error;
        await this.sleep(2000 * attempt);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForSelector(selectors, timeout = 10000) {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    
    for (const selector of selectorArray) {
      try {
        await this.page.waitForSelector(selector, { timeout: 3000, visible: true });
        return selector;
      } catch (e) {
      }
    }
    return null;
  }

  async extractText(selectors, attribute = "textContent") {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    
    for (const selector of selectorArray) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          const value = await this.page.evaluate((el, attr) => {
            return attr === "textContent" ? el.textContent.trim() : el.getAttribute(attr);
          }, element, attribute);
          if (value && value.trim()) return value.trim();
        }
      } catch (e) {
      }
    }
    return null;
  }

  async extractAttribute(selectors, attribute) {
    return this.extractText(selectors, attribute);
  }

  async extractAllText(selector) {
    try {
      return await this.page.$$eval(selector, elements => 
        elements.map(el => el.textContent.trim()).filter(t => t.trim())
      );
    } catch (e) {
      return [];
    }
  }

  async extractAllAttributes(selector, attribute) {
    try {
      return await this.page.$$eval(selector, (elements, attr) => 
        elements.map(el => el.getAttribute(attr)).filter(v => v)
      , attribute);
    } catch (e) {
      return [];
    }
  }

  async clickElement(selectors) {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    
    for (const selector of selectorArray) {
      try {
        await this.page.waitForSelector(selector, { timeout: 3000, visible: true });
        await this.page.click(selector);
        return true;
      } catch (e) {
      }
    }
    return false;
  }

  async scrollToBottom() {
    await this.page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
  }

  async downloadImage(imageUrl, savePath) {
    try {
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const response = await this.page.goto(imageUrl, { 
        waitUntil: "networkidle0",
        timeout: 30000 
      });
      
      if (response && response.ok()) {
        const buffer = await response.buffer();
        fs.writeFileSync(savePath, buffer);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to download " + imageUrl + ": " + error.message);
      return false;
    }
  }

  saveResults(filename) {
    const output = {
      site: this.siteConfig.name,
      scrapedAt: new Date().toISOString(),
      totalProducts: this.results.length,
      products: this.results,
      errors: this.errors,
    };
    
    fs.writeFileSync(path.join(__dirname, "../../output", filename), JSON.stringify(output, null, 2));
    console.log("Saved " + this.results.length + " products to " + filename);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async scrape() {
    throw new Error("scrape() must be implemented by child class");
  }
}

module.exports = BaseScraper;
