const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class TechmatchedScraper extends BaseScraper {
  constructor() {
    super(SITES.techmatched);
  }
}

module.exports = TechmatchedScraper;
