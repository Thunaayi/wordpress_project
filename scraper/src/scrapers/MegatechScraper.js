const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class MegatechScraper extends BaseScraper {
  constructor() {
    super(SITES.megatech);
  }
}

module.exports = MegatechScraper;
