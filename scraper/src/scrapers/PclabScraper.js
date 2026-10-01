const BaseScraper = require('./BaseScraper');
const { SITES } = require('../config/sites');

class PclabScraper extends BaseScraper {
  constructor() {
    super(SITES.pclab);
  }

  async scrape() {
    console.log('Starting PCLabs scraper...');
    // Implementation similar to TechpScraper but with pclab selectors
  }
}

module.exports = PclabScraper;
