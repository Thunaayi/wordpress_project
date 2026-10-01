const BaseScraper = require('./BaseScraper');
const { SITES } = require('../config/sites');

class UltracomputersScraper extends BaseScraper {
  constructor() {
    super(SITES.ultracomputers);
  }
}

module.exports = UltracomputersScraper;
