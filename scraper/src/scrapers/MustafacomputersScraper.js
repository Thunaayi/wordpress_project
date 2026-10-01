const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class MustafacomputersScraper extends BaseScraper {
  constructor() {
    super(SITES.mustafacomputers);
  }
}

module.exports = MustafacomputersScraper;
