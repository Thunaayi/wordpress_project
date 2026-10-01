const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class CzoneScraper extends BaseScraper {
  constructor() {
    super(SITES.czone);
  }
}

module.exports = CzoneScraper;
