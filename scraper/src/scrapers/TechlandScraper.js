const BaseScraper = require('./BaseScraper');
const { SITES } = require('../config/sites');

class TechlandScraper extends BaseScraper {
  constructor() {
    super(SITES.techland);
  }
}

module.exports = TechlandScraper;
