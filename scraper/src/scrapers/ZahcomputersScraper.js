const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class ZahcomputersScraper extends BaseScraper {
  constructor() {
    super(SITES.zahcomputers);
  }
}

module.exports = ZahcomputersScraper;
