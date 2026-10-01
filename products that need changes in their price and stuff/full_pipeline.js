const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ============================================================
// PATHS
// ============================================================
const DB_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/original products in db';
const WC_FILE = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/wc-all-products.csv';
const MASTER_FILE = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/claude\u0027s findings/all_products_MASTER_combined.csv';
const OUTPUT_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/the csv with the sku that I can just import into wordpress without ruining anything';
const CREATE_DIR = path.join(OUTPUT_DIR, 'CREATE_CSVs');
const UPDATE_DIR = path.join(OUTPUT_DIR, 'UPDATE_CSVs');
const UNMATCHED_TEMPLATE_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/unmatched_templates_v3';
const UNMATCHED_IMPORT_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/unmatched_import_v3';

// ============================================================
// BRAND ALIASES
// ============================================================
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

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function normalizeBrand(brand) {
  const b = brand.toLowerCase().trim();
  for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    if (aliases.includes(b)) return canon;
  }
  return b;
}

function extractBrandFromSource(source) {
  const lower = source.toLowerCase();
  const brandPatterns = [
    { pattern: /thermalright/, brand: 'thermalright' },
    { pattern: /asus/, brand: 'asus' },
    { pattern: /msi/, brand: 'msi' },
    { pattern: /pxn/, brand: 'pxn' },
    { pattern: /a4tech|bloody/, brand: 'a4tech' },
    { pattern: /ugreen/, brand: 'ugreen' },
    { pattern: /maxsun/, brand: 'maxsun' },
    { pattern: /whats?app/, brand: 'whatsapp' },
  ];
  for (const bp of brandPatterns) {
    if (bp.pattern.test(source)) return bp.brand;
  }
  if (source.includes('gm multi-brand') || source.includes('gm multi brand')) return 'gm';
  const firstWord = source.split(/[\s\(\)]/)[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  return firstWord;
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

function normalizeBrand(brand) {
  const b = brand.toLowerCase().trim();
  for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    if (aliases.includes(b)) return canon;
  }
  return b;
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

function calculateSimilarity(str1, str2) {
  const a = normalizeName(str1);
  const b = normalizeName(str2);
  if (a.includes(b) || b.includes(a)) return 0.95;
  const tokensA = extractModelTokens(a);
  const tokensB = extractModelTokens(b);
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
  let wordIntersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) wordIntersection++;
  const wordUnion = wordsA.size + wordsB.size - wordIntersection;
  const wordJaccard = wordUnion > 0 ? wordIntersection / wordUnion : 0;
  return Math.max(jaccard * 0.7 + wordJaccard * 0.3, jaccard);
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

// ============================================================
// LOAD DATABASE (ALL SOURCES)
// ============================================================
function loadAllDBProducts() {
  console.log('Loading DB products...');
  const products = [];
  
  // 1. Original products folder
  const files = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.csv') && !f.startsWith('wc-') && !f.startsWith('thermalright') && !f.startsWith('motherboards_'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(DB_DIR, file), 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true, relax_column_count_less: true, relax_column_count_more: true });
    for (const r of records) {
      const id = r['\ufeffID'] || r.ID || '';
      const sku = r.SKU || '';
      const name = r.Name || '';
      const price = r['Regular price'] || '';
      const brand = r.Brands || '';
      const categories = r.Categories || '';
      const images = r.Images || '';
      const inStock = r['In stock?'] || '1';
      if (name && id) {
        products.push({ id: id.toString(), sku: sku.toString(), name: name.trim(), price: price ? parseInt(price.toString().replace(/,/g, '')) : 0, brand: brand.toLowerCase().trim(), category: categories.toString(), images: images.toString(), inStock: inStock.toString() === '1' ? '1' : '0', fullData: r });
      }
    }
  }
  
  // 2. wc-all-products.csv (larger export)
  const wcContent = fs.readFileSync(WC_FILE, 'utf-8');
  const wcRecords = parse(wcContent, { columns: true, skip_empty_lines: true, relax_column_count: true, relax_column_count_less: true, relax_column_count_more: true });
  for (const r of wcRecords) {
    const id = r['\ufeffID'] || r.ID || '';
    const sku = r.SKU || '';
    const name = r.Name || '';
    const price = r['Regular price'] || '';
    const brand = r.Brands || '';
    const categories = r.Categories || '';
    const images = r.Images || '';
    const inStock = r['In stock?'] || '1';
    if (name && id) {
      products.push({ id: id.toString(), sku: sku.toString(), name: name.trim(), price: price ? parseInt(price.toString().replace(/,/g, '')) : 0, brand: brand.toLowerCase().trim(), category: categories.toString(), images: images.toString(), inStock: inStock.toString() === '1' ? '1' : '0', fullData: r });
    }
  }
  
  console.log('Loaded ' + products.length + ' total DB products');
  const brandCounts = {};
  for (const p of products) if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
  console.log('DB Brands:', Object.entries(brandCounts).sort((a,b) => b[1]-a[1]).map(x => x[0]+':'+x[1]).join(', '));
  return products;
}

// ============================================================
// LOAD MASTER PRICE LIST
// ============================================================
function loadMasterPriceList() {
  console.log('Loading master price list...');
  const content = fs.readFileSync(MASTER_FILE, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true, relax_column_count_less: true, relax_column_count_more: true });
  
  const products = [];
  for (const r of records) {
    const source = r['\ufeffSource'] || r.Source || '';
    const category = (r.Category || '').trim();
    const name = (r.Name || '').trim();
    const price = parseFloat(r.Price);
    if (source && name && !isNaN(price)) {
      const sourceBrand = extractBrandFromSource(source);
      let finalBrand = sourceBrand;
      if (sourceBrand === 'gm') {
        const extracted = extractBrandFromName(name);
        if (extracted) finalBrand = extracted;
      }
      products.push({ source: source.trim(), sourceBrand: sourceBrand, finalBrand: finalBrand, category: category, name: name, price: price });
    }
  }
  console.log('Loaded ' + products.length + ' master price list products');
  const brandCounts = {};
  for (const p of products) brandCounts[p.finalBrand] = (brandCounts[p.finalBrand] || 0) + 1;
  console.log('Master brands:', Object.entries(brandCounts).sort((a,b) => b[1]-a[1]).map(x => x[0]+':'+x[1]).join(', '));
  return products;
}

function extractBrandFromSource(source) {
  const lower = source.toLowerCase();
  const brandPatterns = [
    { pattern: /thermalright/, brand: 'thermalright' },
    { pattern: /asus/, brand: 'asus' },
    { pattern: /msi/, brand: 'msi' },
    { pattern: /pxn/, brand: 'pxn' },
    { pattern: /a4tech|bloody/, brand: 'a4tech' },
    { pattern: /ugreen/, brand: 'ugreen' },
    { pattern: /maxsun/, brand: 'maxsun' },
    { pattern: /whats?app/, brand: 'whatsapp' },
  ];
  for (const bp of brandPatterns) if (bp.pattern.test(lower)) return bp.brand;
  if (lower.includes('gm multi-brand') || lower.includes('gm multi brand')) return 'gm';
  return lower.split(/[\s\(\)]/)[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function extractBrandFromName(name) {
  const lowerName = name.toLowerCase();
  for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    if (canon === 'gm') continue;
    for (const alias of aliases) if (lowerName.includes(alias.toLowerCase())) return canon;
  }
  return null;
}

function normalizeBrand(brand) { const b = brand.toLowerCase().trim(); for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) if (aliases.includes(b)) return canon; return b; }
function normalizeName(name) { return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function extractModelTokens(name) { const tokens = name.match(/[a-z0-9]{3,}/gi) || []; return new Set(tokens.map(t => t.toLowerCase())); }
function calculateSimilarity(str1, str2) { const a = normalizeName(str1), b = normalizeName(str2); if (a.includes(b) || b.includes(a)) return 0.95; const tokensA = extractModelTokens(a), tokensB = extractModelTokens(b); let intersection = 0; for (const t of tokensA) if (tokensB.has(t)) intersection++; const union = tokensA.size + tokensB.size - intersection; const jaccard = union > 0 ? intersection / union : 0; const wordsA = new Set(a.split(' ').filter(w => w.length > 3)), wordsB = new Set(b.split(' ').filter(w => w.length > 3)); let wordIntersection = 0; for (const w of wordsA) if (wordsB.has(w)) wordIntersection++; const wordUnion = wordsA.size + wordsB.size - wordIntersection; const wordJaccard = wordUnion > 0 ? wordIntersection / wordUnion : 0; return Math.max(jaccard * 0.7 + wordJaccard * 0.3, jaccard); }
function calculateNewPrice(dealerPrice) { let margin; if (dealerPrice < 5000) margin = Math.min(500, Math.round(dealerPrice * 0.15)); else if (dealerPrice < 20000) margin = Math.min(1500, Math.round(dealerPrice * 0.10)); else if (dealerPrice < 50000) margin = Math.min(2000, Math.round(dealerPrice * 0.07)); else if (dealerPrice < 100000) margin = Math.min(2500, Math.round(dealerPrice * 0.05)); else margin = Math.min(2500, Math.round(dealerPrice * 0.03)); const newPrice = dealerPrice + margin; if (newPrice < 10000) return Math.round(newPrice / 100) * 100; else if (newPrice < 50000) return Math.round(newPrice / 500) * 500; else if (newPrice < 100000) return Math.round(newPrice / 1000) * 1000; else return Math.round(newPrice / 5000) * 5000; }

// ============================================================
// MAIN MATCHING & EXPORT
// ============================================================
async function main() {
  // Create directories
  [UPDATE_DIR, CREATE_DIR, UNMATCHED_TEMPLATE_DIR, UNMATCHED_IMPORT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  
  // Load data
  const dbProducts = loadAllDBProducts();
  const masterProducts = loadMasterPriceList();
  
  console.log('\n=== Matching products ===');
  const matches = [];
  const unmatched = [];
  const usedDBIds = new Set();
  
  masterProducts.sort((a, b) => b.price - a.price);
  
  for (const priceProduct of masterProducts) {
    const priceBrand = priceProduct.finalBrand;
    const priceBrandNorm = normalizeBrand(priceBrand);
    const brandFiltered = dbProducts.filter(db => normalizeBrand(db.brand) === priceBrandNorm);
    
    if (brandFiltered.length === 0) {
      unmatched.push(priceProduct);
      continue;
    }
    
    let bestMatch = null, bestScore = 0;
    for (const db of brandFiltered) {
      const score = calculateSimilarity(priceProduct.name, db.name);
      if (score > bestScore && score >= 0.5) { bestScore = score; bestMatch = db; }
    }
    
    if (bestMatch && !usedDBIds.has(bestMatch.id)) {
      usedDBIds.add(bestMatch.id);
      const newPrice = calculateNewPrice(priceProduct.price);
      const margin = newPrice - priceProduct.price;
      matches.push({ priceProduct, dbProduct: bestMatch, score: bestScore, newPrice, margin, dealerPrice: priceProduct.price, currentPrice: bestMatch.price });
    } else {
      unmatched.push(priceProduct);
    }
  }
  
  console.log('\nTotal matches: ' + matches.length);
  console.log('Total unmatched: ' + unmatched.length);
  
  // ============================================================
  // GENERATE UPDATE CSVs (matched products)
  // ============================================================
  console.log('\n=== Generating UPDATE CSVs ===');
  const byCategory = {};
  for (const m of matches) {
    const cat = m.dbProduct.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  }
  
  for (const [cat, catMatches] of Object.entries(byCategory)) {
    if (catMatches.length === 0) continue;
    const safeCat = cat.replace(/[^a-zA-Z0-9]/g, '_');
    let csvContent = 'ID,SKU,Name,Regular price,In stock?,Images\n';
    for (const m of catMatches) {
      csvContent += m.dbProduct.id + ',' + m.dbProduct.sku + ',\"' + m.dbProduct.name.replace(/\"/g, '\"\"') + '\",' + m.newPrice + ',' + m.dbProduct.inStock + ',\"' + m.dbProduct.images.replace(/\"/g, '\"\"') + '\"\n';
    }
    const filename = safeCat + '_price_update.csv';
    fs.writeFileSync(path.join(UPDATE_DIR, filename), csvContent);
    console.log('UPDATE: ' + filename + ' (' + catMatches.length + ' products)');
  }
  
  // Master audit
  let masterCsv = 'ID,SKU,Name,Regular price,In stock?,Images,Category,Source,Dealer Price,Current Price,Margin,Match Score\n';
  for (const m of matches) {
    masterCsv += m.dbProduct.id + ',' + m.dbProduct.sku + ',\"' + m.dbProduct.name.replace(/\"/g, '\"\"') + '\",' + m.newPrice + ',' + m.dbProduct.inStock + ',\"' + m.dbProduct.images.replace(/\"/g, '\"\"') + '\",' + m.dbProduct.category + ',\"' + m.priceProduct.source + '\",' + m.dealerPrice + ',' + m.currentPrice + ',' + m.margin + ',' + m.score.toFixed(2) + '\n';
  }
  fs.writeFileSync(path.join(UPDATE_DIR, 'MASTER_price_update_AUDIT.csv'), masterCsv);
  console.log('Generated MASTER_price_update_AUDIT.csv');
  
  // ============================================================
  // GENERATE CREATE CSVs (unmatched products) - FULL WOOCOMMERCE FORMAT
  // ============================================================
  console.log('\n=== Generating CREATE CSVs ===');
  
  // Group unmatched by brand for separate CREATE CSVs
  const byBrand = {};
  for (const u of unmatched) {
    const brand = normalizeBrand(u.finalBrand);
    if (!byBrand[brand]) byBrand[brand] = [];
    byBrand[brand].push(u);
  }
  
  // WooCommerce CREATE CSV header (full format)
  const CREATE_HEADER = 'ID,Type,SKU,Name,Published,Is featured?,Visibility in catalog,Short description,Description,Date sale price starts,Date sale price ends,Tax status,Tax class,In stock?,Stock,Low stock amount,Backorders allowed?,Sold individually?,Weight (lbs),Length (in),Width (in),Height (in),Allow customer reviews?,Purchase note,Sale price,Regular price,Categories,Tags,Shipping class,Images,Download limit,Download expiry days,Parent,Grouped products,Upsells,Cross-sells,External URL,Button text,Position,Variation Swatches,Attributes Swatches,Brands,Attribute 1 name,Attribute 1 value(s),Attribute 1 visible,Attribute 1 global,Attribute 2 name,Attribute 2 value(s),Attribute 2 visible,Attribute 2 global,Attribute 3 name,Attribute 3 value(s),Attribute 3 visible,Attribute 3 global,Attribute 4 name,Attribute 4 value(s),Attribute 4 visible,Attribute 4 global,Attribute 1 default';
  
  for (const [brand, items] of Object.entries(byBrand)) {
    if (items.length === 0) continue;
    const safeBrand = brand.replace(/[^a-zA-Z0-9]/g, '_');
    let csvContent = CREATE_HEADER + '\n';
    
    for (const item of items) {
      const name = item.name.replace(/\"/g, '\"\"');
      const suggestedPrice = calculateNewPrice(item.price);
      const brandName = item.finalBrand.charAt(0).toUpperCase() + item.finalBrand.slice(1);
      
      // Build basic product row
      const row = [
        '', // ID (blank for new)
        'simple', // Type
        '', // SKU (blank - will be generated)
        '\"' + name + '\"', // Name
        '1', // Published
        '0', // Is featured?
        'visible', // Visibility
        '\"' + name + '\"', // Short description
        '\"' + name + ' - ' + brandName + '\"', // Description
        '', '', // Sale price dates
        'taxable', '', // Tax
        '1', '', '', 'no', 'no', // Stock
        '', '', '', '', // Dimensions
        '1', '', // Reviews, purchase note
        '', suggestedPrice.toString(), // Prices
        item.category || 'Uncategorized', // Categories
        '', // Tags
        '', // Shipping class
        '', // Images (blank - to be filled later)
        '', '', // Downloads
        '', '', '', '', // Parent, grouped, upsells, cross-sells
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', // Variations, attributes
        brandName, // Brands
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
      ];
      csvContent += row.join(',') + '\n';
    }
    
    const filename = safeBrand + '_CREATE.csv';
    const filepath = path.join(CREATE_DIR, filename);
    fs.writeFileSync(filepath, csvContent);
    console.log('CREATE: ' + filename + ' (' + items.length + ' products)');
  }
  
  // Master CREATE audit
  let createAuditCsv = 'Source,Category,Name,Dealer Price,Suggested Retail Price,Brand\n';
  for (const u of unmatched) {
    createAuditCsv += '\"' + u.source + '\",\"' + u.category + '\",\"' + u.name.replace(/\"/g, '\"\"') + '\",' + u.price + ',' + calculateNewPrice(u.price) + ',\"' + u.finalBrand + '\"\n';
  }
  fs.writeFileSync(path.join(CREATE_DIR, 'CREATE_AUDIT_all_unmatched.csv'), createAuditCsv);
  console.log('Generated CREATE_AUDIT_all_unmatched.csv');
  
  // ============================================================
  // UNMATCHED TEMPLATES (for image filling later)
  // ============================================================
  console.log('\n=== Generating unmatched templates ===');
  const unmatchedByGroup = {};
  for (const u of unmatched) {
    const key = u.source + ' || ' + u.category;
    if (!unmatchedByGroup[key]) unmatchedByGroup[key] = [];
    unmatchedByGroup[key].push(u);
  }
  
  for (const [key, items] of Object.entries(unmatchedByGroup)) {
    const [source, category] = key.split(' || ');
    const safeSource = source.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const safeCategory = category.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const filename = safeSource + '_' + safeCategory + '_images_template.csv';
    const filepath = path.join(UNMATCHED_TEMPLATE_DIR, filename);
    
    let csvContent = 'ID,SKU,Name,Source,Category,Dealer Price,Suggested Retail Price,Images\n';
    for (const item of items) {
      const name = (item.name || '').replace(/\"/g, '\"\"');
      csvContent += ',,\"' + name + '\",\"' + source + '\",\"' + category + '\",' + item.price + ',' + calculateNewPrice(item.price) + ',\n';
    }
    fs.writeFileSync(path.join(UNMATCHED_TEMPLATE_DIR, filename), csvContent);
    console.log('Template: ' + filename + ' (' + items.length + ' products)');
  }
  
  // Master unmatched import
  let unmatchedCsv = 'ID,SKU,Name,Source,Category,Dealer Price,Suggested Retail Price,Images\n';
  for (const u of unmatched) {
    const name = (u.name || '').replace(/\"/g, '\"\"');
    unmatchedCsv += ',,\"' + name + '\",\"' + u.source + '\",\"' + u.category + '\",' + u.price + ',' + calculateNewPrice(u.price) + ',\n';
  }
  fs.writeFileSync(path.join(UNMATCHED_IMPORT_DIR, 'UNMATCHED_ALL_import.csv'), unmatchedCsv);
  console.log('Generated UNMATCHED_ALL_import.csv');
  
  console.log('\n=== DONE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
