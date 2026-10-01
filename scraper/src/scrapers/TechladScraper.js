const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class TechladScraper extends BaseScraper {
  constructor() {
    super(SITES.techlad);
  }
}

module.exports = TechladScraper;
