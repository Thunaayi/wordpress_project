const BaseScraper = require("./BaseScraper");
const { SITES } = require("../config/sites");

class ZestrogamingScraper extends BaseScraper {
  constructor() {
    super(SITES.zestrogaming);
  }
}

module.exports = ZestrogamingScraper;
