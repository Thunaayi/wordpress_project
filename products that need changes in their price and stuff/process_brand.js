// Brand-by-brand price update processor
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const MASTER_CSV = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/claude\u0027s findings/all_products_MASTER_combined.csv';
const DB_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/original products in db';
const OUTPUT_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/the csv with the sku that I can just import into wordpress without ruining anything';

// ============================================================
// BRAND MAPPING: Master source brand -> DB brand name
// ============================================================
const BRAND_MAP = {
  'thermalright': ['thermalright', 'tr'],
  'asus': ['asus', 'rog', 'tuf', 'prime', 'proart'],
  'msi': ['msi', 'mag', 'mpg', 'ventus', 'shadow'],
  'logitech': ['logitech', 'g pro', 'mx master', 'mx keys', 'lightspeed'],
  'lian li': ['lian li', 'lianli', 'uni fan', 'galahad', 'lancool'],
  'cougar': ['cougar'],
  'gamemax': ['gamemax', 'game max'],
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
  'steelseries': ['steelseries'],
  'razer': ['razer'],
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
  'dahua': ['dahua'],
  'crucial': ['crucial'],
  'silicon power': ['silicon power'],
  'alpha': ['alpha'],
  'lexar': ['lexar'],
  'pny': ['pny', 'pnz'],
  'zotac': ['zotac'],
  'ramsta': ['ramsta'],
  'hiksemi': ['hiksemi'],
  'ugreen': ['ugreen'],
  'a4tech': ['a4tech', 'bloody'],
  'pxn': ['pxn'],
  'maxsun': ['maxsun'],
  'gamesir': ['gamesir', 'game sir'],
  'darkflash': ['darkflash'],
  'aigo': ['aigo'],
  'jonsbo': ['jonsbo'],
  'segotep': ['segotep'],
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
  'inno3d': ['inno3d'],
  'thermaltake': ['thermaltake'],
  'antec': ['antec'],
  'silverstone': ['silverstone'],
};

// Source name -> canonical brand mapping
const SOURCE_TO_BRAND = {
  'thermalright (sept 11)': 'thermalright',
  'thermalright (june 29, older - extra items not in sept list)': 'thermalright',
  'asus price list (aug 15)': 'asus',
  'msi price list (aug 18)': 'msi',
  'pxn price list (june 11)': 'pxn',
  'gm multi-brand dealer pdf (jul 27) - dealer price, not confirmed retail': 'gm',
  'whatsapp images (gpu/nvme/ssd/ram)': 'whatsapp',
  'a4tech/bloody price list (june 17)': 'a4tech',
  'ugreen price list (june 29)': 'ugreen',
  'maxsun dealer price list (sept 2026)': 'maxsun',
};

function normalizeBrand(brand) {
  const b = brand.toLowerCase().trim();
  for (const [canon, aliases] of Object.entries(BRAND_MAP)) {
    if (aliases.includes(b)) return canon;
  }
  return b;
}

function getCanonicalBrand(sourceName) {
  const lower = sourceName.toLowerCase().trim();
  if (SOURCE_TO_BRAND[lower]) return SOURCE_TO_BRAND[lower];
  
  // Try partial match
  for (const [src, canon] of Object.entries(SOURCE_TO_BRAND)) {
    if (lower.includes(src) || src.includes(lower)) return canon;
  }
  
  // Fallback: extract first word
  const firstWord = lower.split(/[\s\(\)]/)[0];
  return normalizeBrand(firstWord);
}

// ============================================================
// LOAD MASTER SOURCE PRODUCTS
// ============================================================
function loadMasterProducts() {
  const content = fs.readFileSync(MASTER_CSV, 'utf-8');
  const records = parse(content, { 
    columns: true, 
    skip_empty_lines: true,
    relax_column_count: true,
    relax_column_count_less: true,
    relax_column_count_more: true
  });
  
  const products = [];
  for (const r of records) {
    const source = r['\ufeffSource'] || r.Source || '';
    const price = parseFloat(r.Price);
    if (source && !isNaN(price)) {
      products.push({
        source: source.trim(),
        category: (r.Category || '').trim(),
        name: (r.Name || '').trim(),
        price: price,
        brand: getCanonicalBrand(source)
      });
    }
  }
  return products;
}

// ============================================================
// LOAD DB PRODUCTS
// ============================================================
function loadDBProducts() {
  const files = fs.readdirSync(DB_DIR).filter(f => 
    f.endsWith('.csv') && 
    !f.startsWith('wc-') && 
    !f.startsWith('thermalright') && 
    !f.startsWith('motherboards_')
  );
  
  const allProducts = [];
  
  for (const file of files) {
    const filePath = path.join(DB_DIR, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const records = parse(content, { 
        columns: true, 
        skip_empty_lines: true,
        relax_column_count: true,
        relax_column_count_less: true,
        relax_column_count_more: true
      });
      
      const dbCategory = file.replace('.csv', '');
      
      for (const row of records) {
        const id = row.ID || row['\ufeffID'] || '';
        const sku = row.SKU || '';
        const name = row.Name || '';
        const price = row['Regular price'] || '';
        const images = row.Images || '';
        const inStock = row['In stock?'] || '1';
        const brands = row.Brands || '';
        const categories = row.Categories || '';
        
        if (name) {
          const extractedBrand = extractBrandFromName(name);
          allProducts.push({
            id: id.toString(),
            sku: sku.toString(),
            name: name.trim(),
            price: price ? parseInt(price.toString().replace(/,/g, '')) : 0,
            images: images.toString(),
            inStock: inStock.toString() === '1' ? '1' : '0',
            brand: extractedBrand,
            dbCategory: (categories || dbCategory).toString(),
            sourceFile: file
          });
        }
      }
    } catch (e) {
      console.error('Error parsing ' + file + ': ' + e.message);
    }
  }
  
  return allProducts;
}

function extractBrandFromName(name) {
  const upperName = name.toUpperCase();
  const knownBrands = Object.keys(BRAND_MAP).flatMap(k => BRAND_MAP[k]);
  
  for (const brand of knownBrands) {
    const regex = new RegExp('\\b' + brand.replace(/\./g, '\\.').replace(/\s+/g, '\\s+') + '\\b', 'i');
    if (regex.test(upperName)) {
      return normalizeBrand(brand);
    }
  }
  
  const firstWord = name.trim().split(/\s+/)[0];
  if (firstWord && firstWord.length > 2) {
    return normalizeBrand(firstWord);
  }
  return '';
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
  
  return Math.max(jaccard * 0.7 + wordJaccard * 0.3, jaccard);
}

// ============================================================
// CALCULATE NEW PRICE WITH MARGIN
// ============================================================
function calculateNewPrice(dealerPrice) {
  let margin;
  if (dealerPrice < 5000) {
    margin = Math.min(500, Math.round(dealerPrice * 0.15));
  } else if (dealerPrice < 20000) {
    margin = Math.min(1500, Math.round(dealerPrice * 0.10));
  } else if (dealerPrice < 50000) {
    margin = Math.min(2000, Math.round(dealerPrice * 0.07));
  } else if (dealerPrice < 100000) {
    margin = Math.min(2500, Math.round(dealerPrice * 0.05));
  } else {
    margin = Math.min(2500, Math.round(dealerPrice * 0.03));
  }
  
  const newPrice = dealerPrice + margin;
  
  if (newPrice < 10000) {
    return Math.round(newPrice / 100) * 100;
  } else if (newPrice < 50000) {
    return Math.round(newPrice / 500) * 500;
  } else if (newPrice < 100000) {
    return Math.round(newPrice / 1000) * 1000;
  } else {
    return Math.round(newPrice / 5000) * 5000;
  }
}

// ============================================================
// PROCESS SINGLE BRAND
// ============================================================
function processBrand(sourceBrandName, masterProducts, dbProducts) {
  console.log('\n=== Processing: ' + sourceBrandName + ' ===');
  
  const sourceProducts = masterProducts.filter(p => p.brand === sourceBrandName);
  console.log('Source products: ' + sourceProducts.length);
  
  const dbBrandProducts = dbProducts.filter(p => p.brand === sourceBrandName);
  console.log('DB products: ' + dbBrandProducts.length);
  
  if (dbBrandProducts.length === 0) {
    console.log('No DB products for this brand - all will be unmatched');
    return { matches: [], unmatched: sourceProducts };
  }
  
  const matches = [];
  const unmatched = [];
  const usedDBIds = new Set();
  
  sourceProducts.sort((a, b) => b.price - a.price);
  
  for (const src of sourceProducts) {
    let bestMatch = null;
    let bestScore = 0;
    
    for (const db of dbBrandProducts) {
      if (usedDBIds.has(db.id)) continue;
      
      const score = calculateSimilarity(src.name, db.name);
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = db;
      }
    }
    
    if (bestMatch) {
      usedDBIds.add(bestMatch.id);
      const newPrice = calculateNewPrice(src.price);
      const margin = newPrice - src.price;
      
      matches.push({
        source: src,
        db: bestMatch,
        score: bestScore,
        newPrice,
        margin,
        dealerPrice: src.price,
        currentPrice: bestMatch.price
      });
      
      console.log('  MATCH (' + bestScore.toFixed(2) + '): ' + src.name);
      console.log('    Dealer: ' + src.price + ' | Current: ' + bestMatch.price + ' | New: ' + newPrice + ' (+' + margin + ')');
    } else {
      unmatched.push(src);
      console.log('  NO MATCH: ' + src.name + ' (' + src.price + ')');
    }
  }
  
  console.log('Total matches: ' + matches.length + ', Unmatched: ' + unmatched.length);
  return { matches, unmatched };
}

// ============================================================
// GENERATE OUTPUT CSVs FOR BRAND
// ============================================================
function generateBrandOutputs(brandName, matches, unmatched) {
  const safeBrand = brandName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const byCategory = {};
  for (const m of matches) {
    const cat = m.db.dbCategory || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  }
  
  for (const [cat, catMatches] of Object.entries(byCategory)) {
    const safeCat = cat.replace(/[^a-zA-Z0-9]/g, '_');
    let csvContent = 'ID,SKU,Name,Regular price,In stock?,Images\n';
    
    for (const m of catMatches) {
      csvContent += m.db.id + ',' + 
        m.db.sku + ',"' + 
        m.db.name.replace(/"/g, '""') + '",' + 
        m.newPrice + ',' + 
        m.db.inStock + ',"' + 
        m.db.images.replace(/"/g, '""') + '"\n';
    }
    
    const filename = safeCat + '_' + safeBrand + '_price_update.csv';
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, csvContent);
    console.log('  Generated: ' + filename + ' (' + catMatches.length + ' products)');
  }
  
  if (unmatched.length > 0) {
    let unmatchedCsv = 'Source,Category,Name,Dealer Price,Suggested Retail Price,Reason\n';
    for (const u of unmatched) {
      const suggested = calculateNewPrice(u.price);
      unmatchedCsv += '"' + u.source + '","' + u.category + '","' + 
        u.name.replace(/"/g, '""') + '",' + u.price + ',' + suggested + ',"No matching DB product"\n';
    }
    const filename = 'UNMATCHED_' + safeBrand + '_not_in_db.csv';
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, unmatchedCsv);
    console.log('  Generated: ' + filename + ' (' + unmatched.length + ' products)');
  }
  
  return { byCategory, unmatchedCount: unmatched.length };
}

// ============================================================
// MAIN
// ============================================================
function main() {
  console.log('Loading master products...');
  const masterProducts = loadMasterProducts();
  console.log('Total master products: ' + masterProducts.length);
  
  console.log('Loading DB products...');
  const dbProducts = loadDBProducts();
  console.log('Total DB products: ' + dbProducts.length);
  
  // Get unique brands from master
  const masterBrands = [...new Set(masterProducts.map(p => p.brand))].filter(b => b);
  console.log('\nBrands in master:', masterBrands.join(', '));
  
  // Process each brand
  const allMatches = [];
  const allUnmatched = [];
  
  for (const brand of masterBrands) {
    const result = processBrand(brand, masterProducts, dbProducts);
    allMatches.push(...result.matches);
    allUnmatched.push(...result.unmatched);
    generateBrandOutputs(brand, result.matches, result.unmatched);
  }
  
  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('Total matched: ' + allMatches.length);
  console.log('Total unmatched: ' + allUnmatched.length);
  
  // Generate master audit
  let masterCsv = 'ID,SKU,Name,Regular price,In stock?,Images,Category,Source,Dealer Price,Current Price,Margin,Match Score\n';
  for (const m of allMatches) {
    masterCsv += m.db.id + ',' + m.db.sku + ',"' + m.db.name.replace(/"/g, '""') + '",' + 
      m.newPrice + ',' + m.db.inStock + ',"' + m.db.images.replace(/"/g, '""') + '",' + 
      m.db.dbCategory + ',"' + m.source.source + '",' + m.dealerPrice + ',' + 
      m.currentPrice + ',' + m.margin + ',' + m.score.toFixed(2) + '\n';
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'MASTER_price_update_AUDIT.csv'), masterCsv);
  console.log('Generated MASTER_price_update_AUDIT.csv');
  
  // Generate combined unmatched
  if (allUnmatched.length > 0) {
    let unmatchedCsv = 'Source,Category,Name,Dealer Price,Suggested Retail Price,Reason\n';
    for (const u of allUnmatched) {
      const suggested = calculateNewPrice(u.price);
      unmatchedCsv += '"' + u.source + '","' + u.category + '","' + 
        u.name.replace(/"/g, '""') + '",' + u.price + ',' + suggested + ',"No matching DB product"\n';
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_ALL_not_in_db.csv'), unmatchedCsv);
    console.log('Generated UNMATCHED_ALL_not_in_db.csv');
  }
  
  console.log('\n=== DONE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
