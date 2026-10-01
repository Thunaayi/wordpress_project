const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class TechpScraper extends BaseScraper {
  constructor() {
    super(SITES.tech);
  }

  async scrape() {
    console.log("Starting Tech.com.pk scraper...");
    // Implementation similar to BaseScraper but with tech.com.pk specifics
  }
}

module.exports = TechpScraper;
