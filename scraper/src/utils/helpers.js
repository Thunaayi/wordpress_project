const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

/**
 * Load all products from master price list
 */
function loadMasterProducts() {
  // Was a hardcoded Windows path (C:/Users/Aimal/...) — only worked on one
  // machine, in one exact folder layout, and wasn't even committed to the repo.
  // Now relative to this file, so it works on any clone as long as the CSV
  // is placed at scraper/data/all_products_MASTER_combined.csv.
  const masterPath = path.join(__dirname, "../../data/all_products_MASTER_combined.csv");
  if (!fs.existsSync(masterPath)) {
    throw new Error(
      "Master products CSV not found at " + masterPath +
      ". Put all_products_MASTER_combined.csv in scraper/data/ before running."
    );
  }
  const masterContent = fs.readFileSync(masterPath, 'utf-8');
  const records = parse(masterContent, { 
    columns: true, 
    skip_empty_lines: true, 
    relax_column_count: true,
    relax_column_count_less: true,
    relax_column_count_more: true
  });
  
  return records.map(r => ({
    source: r['\ufeffSource'] || r.Source || '',
    category: (r.Category || '').trim(),
    name: (r.Name || '').trim(),
    price: parseFloat(r.Price),
    sourceBrand: r.Source || '',
  })).filter(p => p.name && p.price);
}

/**
 * Load existing DB products
 */
function loadDBProducts() {
  // Same fix as loadMasterProducts: was a hardcoded Windows path.
  // Put your current wp-admin > Products > Export file here before running.
  const dbPath = path.join(__dirname, "../../data/wc-product-export-latest.csv");
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      "WooCommerce export not found at " + dbPath +
      ". Export your current products from wp-admin and save it there before running."
    );
  }
  const dbContent = fs.readFileSync(dbPath, 'utf-8');
  const records = parse(dbContent, { 
    columns: true, 
    skip_empty_lines: true,
    relax_column_count: true,
    relax_column_count_less: true,
    relax_column_count_more: true
  });
  
  return records.map(r => ({
    id: r['\ufeffID'] || r.ID || '',
    sku: r.SKU || '',
    name: r.Name || '',
    price: parseInt((r['Regular price'] || '0').toString().replace(/,/g, '')),
    brand: (r.Brands || '').toLowerCase().trim(),
    category: r.Categories || '',
    images: r.Images || '',
    inStock: r['In stock?'] || '1',
    fullData: r,
  })).filter(p => p.name && p.id);
}

/**
 * Normalize brand name
 */
const BRAND_ALIASES = {
  'asus': ['asus', 'rog', 'tuf', 'prime', 'proart'],
  'msi': ['msi', 'mag', 'mpg', 'ventus', 'shadow'],
  'logitech': ['logitech', 'g pro', 'mx master', 'mx keys', 'lightspeed'],
  'thermalright': ['thermalright', 'tr'],
  'lian li': ['lian li', 'lianli', 'uni fan', 'galahad', 'lancool'],
  'cougar': ['cougar'],
  'ugreen': ['ugreen'],
  'pxn': ['pxn'],
  'a4tech': ['a4tech', 'bloody'],
  'razer': ['razer'],
  'steelseries': ['steelseries'],
  'xpg': ['xpg', 'adata'],
  'cooler master': ['cooler master', 'coolermaster'],
  'corsair': ['corsair'],
  'g.skill': ['g.skill', 'gskill'],
  'kingston': ['kingston'],
  'wd': ['wd', 'western digital'],
  'seagate': ['seagate'],
  'samsung': ['samsung'],
  'intel': ['intel'],
  'amd': ['amd'],
  'nvidia': ['nvidia'],
  'jabra': ['jabra'],
  'hyperx': ['hyperx'],
  'plantronics': ['plantronics', 'poly'],
  'aula': ['aula'],
  'attack shark': ['attack shark'],
  'benq': ['benq', 'zowie'],
  'zidli': ['zidli'],
  'glorious': ['glorious'],
  'gigabyte': ['gigabyte', 'aorus'],
  'xpg': ['xpg', 'adata'],
  'deepcool': ['deepcool'],
  'id-cooling': ['id-cooling', 'idcooling'],
  'be quiet': ['be quiet', 'bequiet'],
  'noctua': ['noctua'],
  'arctic': ['arctic'],
  'fractal design': ['fractal design', 'fractaldesign'],
  'phanteks': ['phanteks'],
  'nzxt': ['nzxt'],
  'hyte': ['hyte'],
  'inwin': ['inwin'],
  'seasonic': ['seasonic'],
  'evga': ['evga'],
  'asrock': ['asrock'],
  'biostar': ['biostar'],
  'colorful': ['colorful'],
  'gainward': ['gainward'],
  'palit': ['palit'],
  'zotac': ['zotac'],
  'inno3d': ['inno3d'],
  'thermaltake': ['thermaltake'],
  'antec': ['antec'],
  'silverstone': ['silverstone'],
  'darkflash': ['darkflash'],
  'aigo': ['aigo'],
  'jonsbo': ['jonsbo'],
  'segotep': ['segotep'],
  'dahua': ['dahua'],
  'crucial': ['crucial'],
  'silicon power': ['silicon power'],
  'alpha': ['alpha'],
  'lexar': ['lexar'],
  'pny': ['pny', 'pnz'],
  'zotac': ['zotac'],
  'ramsta': ['ramsta'],
  'hiksemi': ['hiksemi'],
  'whatsapp': ['whatsapp'],
  'gm': ['gm'],
  'game sir': ['gamesir', 'game sir'],
  'silverstone': ['silverstone'],
  'id-cooling': ['id-cooling', 'idcooling'],
  'colorful': ['colorful'],
  'gainward': ['gainward'],
  'palit': ['palit'],
  'zotac': ['zotac'],
  'inno3d': ['inno3d'],
  'thermaltake': ['thermaltake'],
  'antec': ['antec'],
  'segotep': ['segotep'],
  'dahua': ['dahua'],
  'crucial': ['crucial'],
  'silicon power': ['silicon power'],
  'alpha': ['alpha'],
  'lexar': ['lexar'],
  'pny': ['pny', 'pnz'],
  'zotac': ['zotac'],
  'ramsta': ['ramsta'],
  'hiksemi': ['hiksemi'],
  'game max': ['gamemax', 'game max'],
  'evolve': ['evolve'],
  'gameon': ['gameon'],
  'jabra': ['jabra'],
  'hyperx': ['hyperx'],
  'plantronics': ['plantronics', 'poly'],
  'aula': ['aula'],
  'attack shark': ['attack shark'],
  'benq': ['benq', 'zowie'],
  'zidli': ['zidli'],
  'glorious': ['glorious'],
};

function normalizeBrand(brand) {
  const b = brand.toLowerCase().trim();
  for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    if (aliases.includes(b)) return canon;
  }
  return b;
}

function extractBrandFromName(name) {
  const lowerName = name.toLowerCase();
  for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    if (canon === 'gm') continue;
    for (const alias of aliases) {
      if (lowerName.includes(alias.toLowerCase())) return canon;
    }
  }
  return null;
}

function normalizeName(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractModelTokens(name) {
  const tokens = name.match(/[a-z0-9]{3,}/gi) || [];
  return new Set(tokens.map(t => t.toLowerCase()));
}

// Two products can share every word except the one that actually makes them
// different items — a color, a Tray/non-Tray CPU variant, a size. Plain
// token/word overlap barely notices a one-word difference like that, which
// is exactly how "... ARGB Black" and "... ARGB White" ended up scoring 95%
// against the same page and getting the same photos. Each group below is a
// set of mutually exclusive values: if both names mention a value from the
// same group and the values differ, that's a real variant mismatch, not a
// fuzzy-matching rounding error.
const VARIANT_GROUPS = [
  ["black", "white", "silver", "grey", "gray", "red", "blue", "green", "pink", "purple", "gold", "orange", "yellow"],
  ["tray", "non-tray", "nontray", "box", "boxed"],
  ["mk", "mkii", "mk2", "v1", "v2", "v3", "v4", "v5", "v6", "v7"],
];

function extractVariantTags(normalizedText) {
  const tags = [];
  for (const group of VARIANT_GROUPS) {
    for (const value of group) {
      const re = new RegExp("(?:^|\\s)" + value.replace(/[-]/g, "[-]?") + "(?:\\s|$)", "i");
      if (re.test(normalizedText)) {
        tags.push(value);
        break; // one match per group is enough to know which value this name claims
      }
    }
  }
  return tags;
}

function hasVariantMismatch(a, b) {
  const tagsA = extractVariantTags(a);
  const tagsB = extractVariantTags(b);
  for (const groupIndex in VARIANT_GROUPS) {
    const group = VARIANT_GROUPS[groupIndex];
    const tagA = tagsA.find((t) => group.includes(t));
    const tagB = tagsB.find((t) => group.includes(t));
    if (tagA && tagB && tagA !== tagB) return true;
  }
  return false;
}

function calculateSimilarity(str1, str2) {
  const a = normalizeName(str1);
  const b = normalizeName(str2);

  // A mismatched color/variant means these are two different SKUs no matter
  // how much of the rest of the name lines up. Cap it well below
  // MATCH_THRESHOLD so it always lands in needsReview instead of being
  // auto-confirmed against the wrong variant's page and photos.
  const variantMismatch = hasVariantMismatch(a, b);

  // The "one fully contains the other" shortcut only means something when
  // the shorter string is actually a real chunk of a product name. Without a
  // floor here, a stray "0" or "4" from a cart badge or quantity widget is a
  // substring of almost anything with a number in it ("...240...") and was
  // scoring 95% against a product it has nothing to do with. Real product
  // names/slugs in this pipeline always run well past this length, so this
  // only blocks noise, not legitimate short matches.
  const MIN_CONTAINMENT_LENGTH = 8;
  const shorterLength = Math.min(a.length, b.length);
  if (shorterLength >= MIN_CONTAINMENT_LENGTH && (a.includes(b) || b.includes(a))) {
    return variantMismatch ? 0.4 : 0.95;
  }

  const tokensA = extractModelTokens(a);
  const tokensB = extractModelTokens(b);

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;

  const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
  let wordIntersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) wordIntersection++;
  }
  const wordUnion = wordsA.size + wordsB.size - wordIntersection;
  const wordJaccard = wordUnion > 0 ? wordIntersection / wordUnion : 0;

  const score = Math.max(jaccard * 0.7 + wordJaccard * 0.3, jaccard);
  return variantMismatch ? Math.min(score, 0.4) : score;
}

function calculateNewPrice(dealerPrice) {
  let margin;
  if (dealerPrice < 5000) margin = Math.min(500, Math.round(dealerPrice * 0.15));
  else if (dealerPrice < 20000) margin = Math.min(1500, Math.round(dealerPrice * 0.10));
  else if (dealerPrice < 50000) margin = Math.min(2000, Math.round(dealerPrice * 0.07));
  else if (dealerPrice < 100000) margin = Math.min(2500, Math.round(dealerPrice * 0.05));
  else margin = Math.min(2500, Math.round(dealerPrice * 0.03));

  const newPrice = dealerPrice + margin;
  if (newPrice < 10000) return Math.round(newPrice / 100) * 100;
  else if (newPrice < 50000) return Math.round(newPrice / 500) * 500;
  else if (newPrice < 100000) return Math.round(newPrice / 1000) * 1000;
  else return Math.round(newPrice / 5000) * 5000;
}

module.exports = {
  loadMasterProducts,
  loadDBProducts,
  normalizeBrand,
  extractBrandFromName,
  normalizeName,
  extractModelTokens,
  calculateSimilarity,
  calculateNewPrice,
  hasVariantMismatch,
  extractVariantTags
};
