// Main processing script - Version 3 with brand-aware matching
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const PDF_DIR = 'C:\\Users\\Aimal\\Documents\\GitHub\\Wordpress project\\products that need changes in their price and stuff';
const DB_DIR = 'C:\\Users\\Aimal\\Documents\\GitHub\\Wordpress project\\original products in db';
const OUTPUT_DIR = 'C:\\Users\\Aimal\\Documents\\GitHub\\Wordpress project\\the csv with the sku that I can just import into wordpress without ruining anything';

// ============================================================
// PARSE PDF EXTRACTED TEXT FILES
// ============================================================

function parseA4Tech(text) {
  const products = [];
  const normalized = text.replace(/\s+/g, ' ');
  
  // Pattern: number MODEL (color) Description PRICE
  const regex = /(\d+)\s+(\S+)\s+\(([^)]+)\)\s+(.+?)\s+([\d,]+)/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const num = match[1];
    const model = match[2];
    const color = match[3];
    const desc = match[4];
    const price = match[5];
    if (desc.includes('A4tech') || desc.includes('Bloody')) {
      products.push({
        brand: 'A4Tech',
        model: model.trim(),
        color: color.trim(),
        name: desc.trim(),
        price: parseInt(price.replace(/,/g, '')),
        section: 'A4TECH'
      });
    }
  }
  
  // Pattern without color
  const regex2 = /(\d+)\s+(\S+)\s+(A4tech|Bloody).+?\s+([\d,]+)(?=\s+\d+\s+\S|\s*$)/g;
  while ((match = regex2.exec(normalized)) !== null) {
    const num = match[1];
    const model = match[2];
    const desc = match[3];
    const price = match[4];
    products.push({
      brand: 'A4Tech',
      model: model.trim(),
      color: '',
      name: desc.trim(),
      price: parseInt(price.replace(/,/g, '')),
      section: 'A4TECH'
    });
  }
  
  return products;
}

function parseSingleLinePriceList(text, brand, modelPrefixes) {
  const products = [];
  const normalized = text.replace(/\s+/g, ' ');
  
  // Build regex from model prefixes
  const prefixPattern = modelPrefixes.join('|');
  const regex = new RegExp('(' + prefixPattern + '[\\s\\S]*?)\\s+([\\d,]+)(?=\\s+(?:' + prefixPattern + ')|\\s*$)', 'g');
  
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const model = match[1].trim().replace(/\s+/g, ' ');
    const price = parseInt(match[2].replace(/,/g, ''));
    if (price > 1000 && model.length > 4) {
      products.push({
        brand,
        model,
        name: model,
        price,
        section: brand.toUpperCase()
      });
    }
  }
  
  return products;
}

function parseASUS(text) {
  const prefixes = ['PRIME', 'TUF', 'ROG', 'PROART', 'DUAL', 'MB', 'VG', 'XG', 'PG', 'PA', 'XA', 'M6', 'M7', 'P3', 'P5', 'P7', 'FAN', 'LC', 'RYUO', 'RYUJIN', 'A21', 'GT', 'GX', 'NUC', 'RT'];
  return parseSingleLinePriceList(text, 'ASUS', prefixes);
}

function parseMSI(text) {
  const prefixes = ['MSI', 'MAG', 'MPG', 'VENTUS', 'SHADOW', 'GAMING', 'PRO', 'MP', 'OPTIX', 'FORGE', 'CLUTCH', 'VIGOR', 'FORCE', 'CORELIQUID', 'A850', 'A1000', 'A1250', 'Ai', 'PANO', 'GUNGNIR'];
  return parseSingleLinePriceList(text, 'MSI', prefixes);
}

function parseGM(text) {
  const products = [];
  const normalized = text.replace(/\s+/g, ' ');
  
  // Logitech part numbers: 910-xxxxx, 920-xxxxx, 981-xxxxx, 950-xxxxx, 939-xxxxx, 943-xxxxx
  const regex = /(\d{3}-\d{5,6})\s+(.+?)\s+([\d,]+)(?=\s+\d{3}-\d{5,6}|\s+[A-Z]{3,}\s|\s*$)/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const partNo = match[1].trim();
    const desc = match[2].trim();
    const price = parseInt(match[3].replace(/,/g, ''));
    if (price > 100 && desc.length > 3) {
      products.push({
        brand: 'Logitech',
        model: partNo,
        name: desc,
        price,
        section: 'LOGITECH'
      });
    }
  }
  
  // LIAN LI
  const lianliRegex = /(G99\.\w+)\s+(.+?)\s+([\d,]+)(?=\s+G99\.|\s+[A-Z]{3,}\s|\s*$)/g;
  while ((match = lianliRegex.exec(normalized)) !== null) {
    const partNo = match[1].trim();
    const desc = match[2].trim();
    const price = parseInt(match[3].replace(/,/g, ''));
    if (price > 100 && desc.length > 3) {
      products.push({
        brand: 'Lian Li',
        model: partNo,
        name: desc,
        price,
        section: 'LIAN_LI'
      });
    }
  }
  
  // COUGAR
  const cougarRegex = /(3\d{2}[A-Z]{2}\d{4}\.\d+|3M[A-Z]{2,}\w*)\s+(.+?)\s+([\d,]+)(?=\s+3\d{2}|\s+[A-Z]{3,}\s|\s*$)/g;
  while ((match = cougarRegex.exec(normalized)) !== null) {
    const partNo = match[1].trim();
    const desc = match[2].trim();
    const price = parseInt(match[3].replace(/,/g, ''));
    if (price > 100 && desc.length > 3) {
      products.push({
        brand: 'COUGAR',
        model: partNo,
        name: desc,
        price,
        section: 'COUGAR'
      });
    }
  }
  
  // Generic brand patterns
  const brandPatterns = ['JABRA', 'HYPERX', 'PLANTRONICS', 'AULA', 'ATTACK SHARK', 'BENQ', 'ZOWIE', 'ZIDLI', 'ARM', 'SP', 'ZG', 'GAME MAX', 'EVOLVE', 'DAHUA', 'CRUCIAL', 'SILICON POWER', 'ALPHA', 'LEXAR', 'GLORIOUS', 'STEELSERIES', 'RAZER', 'XPG', 'COOLER MASTER', 'CORSAIR', 'G.SKILL', 'KINGSTON', 'WD', 'SEAGATE', 'SAMSUNG', 'INTEL', 'AMD', 'NVIDIA'];
  for (const bp of brandPatterns) {
    const bpRegex = new RegExp('(' + bp.replace(/\s+/g, '\\s+') + '[\\s\\S]*?)\\s+([\\d,]+)(?=\\s+[A-Z]{3,}\\s|\\s*$)', 'gi');
    while ((match = bpRegex.exec(normalized)) !== null) {
      const model = match[1].trim().replace(/\s+/g, ' ');
      const price = parseInt(match[2].replace(/,/g, ''));
      if (price > 100 && model.length > 4) {
        products.push({
          brand: bp,
          model,
          name: model,
          price,
          section: bp
        });
      }
    }
  }
  
  return products;
}

function parsePXN(text) {
  const products = [];
  const normalized = text.replace(/\s+/g, ' ');
  
  const regex = /(\d+)\s+(PXN-\w+)\s+(.+?)\s+([\d,]+)(?=\s+\d+\s+PXN|\s*$)/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const num = match[1];
    const partNo = match[2];
    const desc = match[3];
    const price = parseInt(match[4].replace(/,/g, ''));
    products.push({
      brand: 'PXN',
      model: partNo,
      name: desc.trim(),
      price,
      section: 'PXN'
    });
  }
  return products;
}

function parseThermalRight(text) {
  const products = [];
  const normalized = text.replace(/\s+/g, ' ');
  
  // ThermalRight specific patterns
  const patterns = [
    /(TR\s+\d+\s+[A-Z\s]+\d*\.?\d*\s*(?:ARGB|VISION|LCD|UB|TURBO|ELITE|FROZEN|INFINITY|MAGIC|QUBE|PEERLESS|TROFEO|GRAND|WONDER|CORE|MATRIX|AQUA)\s*(?:BLACK|WHITE)?)\s+([\d,]+)/gi,
    /(TL\s+[A-Z0-9\-\s]+\s*(?:ARGB|CASE|FAN|VISION|LCD|WITH|PACK|WHITE|BLACK|UB|M12|E12|M10|A70|C12|M12Q|M12QR|UB24|UB36)?)\s+([\d,]+)/gi,
    /(SG\s+\d+\s+[A-Z\s]+)\s+([\d,]+)/gi,
    /(SP\s+\d+\s+[A-Z\s]+)\s+([\d,]+)/gi,
    /(TP\s+\d+\s+[A-Z\s]+)\s+([\d,]+)/gi,
    /(AT\s+\d+\s+[A-Z\s]+)\s+([\d,]+)/gi,
    /(HUB\s+[A-Z0-9\s]+)\s+([\d,]+)/gi,
    /(TFX\s+[A-Z0-9\s]+)\s+([\d,]+)/gi,
    /(AM5\s+[A-Z0-9\s]+)\s+([\d,]+)/gi,
    /(LGA\s+\d+[A-Z0-9\s]+)\s+([\d,]+)/gi,
    /(TR\s+A70\s+[A-Z0-9\s]+)\s+([\d,]+)/gi,
    /(TR\s+TROFEO\s+VISION\s+[A-Z0-9\s]+)\s+([\d,]+)/gi
  ];
  
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      const model = match[1].trim().replace(/\s+/g, ' ');
      const price = parseInt(match[2].replace(/,/g, ''));
      if (price > 100 && model.length > 3) {
        products.push({
          brand: 'ThermalRight',
          model,
          name: model,
          price,
          section: 'THERMALRIGHT'
        });
      }
    }
  }
  
  return products;
}

function parseUGREEN(text) {
  const products = [];
  const normalized = text.replace(/\s+/g, ' ');
  
  const regex = /(\d+)\s+(\d{5})\s+(.+?)\s+([\d,]+)(?=\s+\d+\s+\d{5}|\s*$)/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const num = match[1];
    const code = match[2];
    const desc = match[3];
    const price = parseInt(match[4].replace(/,/g, ''));
    products.push({
      brand: 'UGREEN',
      model: code,
      name: desc.trim(),
      price,
      section: 'UGREEN'
    });
  }
  return products;
}

// ============================================================
// PARSE DATABASE CSV FILES
// ============================================================

function parseDBFiles() {
  const files = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.csv') && !f.startsWith('wc-') && !f.startsWith('thermalright') && !f.startsWith('motherboards_'));
  const allProducts = [];
  
  for (const file of files) {
    const category = file.replace('.csv', '');
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
      
      for (const row of records) {
        const id = row.ID || row['\ufeffID'] || '';
        const sku = row.SKU || '';
        const name = row.Name || '';
        const price = row['Regular price'] || '';
        const brand = row.Brands || '';
        const categories = row.Categories || '';
        
        if (name) {
          allProducts.push({
            id,
            sku,
            name,
            price: price ? parseInt(price.replace(/,/g, '')) : 0,
            brand: brand.toLowerCase(),
            category: categories || category,
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

// ============================================================
// BRAND-AWARE FUZZY MATCHING
// ============================================================

const BRAND_ALIASES = {
  'asus': ['asus', 'rog', 'tuf', 'prime', 'proart'],
  'msi': ['msi', 'mag', 'mpg', 'ventus', 'shadow'],
  'logitech': ['logitech'],
  'thermalright': ['thermalright', 'tr'],
  'lian li': ['lian li', 'lianli'],
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
};

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
  // Extract alphanumeric tokens that could be model numbers
  const tokens = name.match(/[a-z0-9]{3,}/gi) || [];
  return new Set(tokens.map(t => t.toLowerCase()));
}

function calculateSimilarity(str1, str2) {
  const a = normalizeName(str1);
  const b = normalizeName(str2);
  
  // Exact substring match
  if (a.includes(b) || b.includes(a)) return 0.95;
  
  // Token-based similarity with emphasis on model numbers
  const tokensA = extractModelTokens(a);
  const tokensB = extractModelTokens(b);
  
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  
  const union = tokensA.size + tokensB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  
  // Also check word overlap for descriptive terms
  const wordsA = new Set(a.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 3));
  let wordIntersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) wordIntersection++;
  }
  const wordUnion = wordsA.size + wordsB.size - wordIntersection;
  const wordJaccard = wordUnion > 0 ? wordIntersection / wordUnion : 0;
  
  // Weighted combination
  return Math.max(jaccard * 0.7 + wordJaccard * 0.3, jaccard);
}

function findBestMatch(pdfProduct, dbProducts) {
  const pdfBrand = normalizeBrand(pdfProduct.brand);
  
  // Filter DB products by brand first
  const brandFiltered = dbProducts.filter(db => {
    const dbBrand = normalizeBrand(db.brand);
    return dbBrand === pdfBrand || pdfBrand === dbBrand;
  });
  
  // If no brand match, don't match at all
  if (brandFiltered.length === 0) {
    return { match: null, score: 0 };
  }
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const dbProduct of brandFiltered) {
    const score = calculateSimilarity(pdfProduct.name, dbProduct.name);
    if (score > bestScore && score > 0.5) {  // Higher threshold
      bestScore = score;
      bestMatch = dbProduct;
    }
  }
  
  return { match: bestMatch, score: bestScore };
}

// ============================================================
// CALCULATE NEW PRICES WITH MARGIN
// ============================================================

function calculateNewPrice(dealerPrice, currentPrice) {
  let margin;
  if (dealerPrice < 5000) {
    margin = Math.min(500, dealerPrice * 0.15);
  } else if (dealerPrice < 20000) {
    margin = Math.min(1500, dealerPrice * 0.1);
  } else if (dealerPrice < 50000) {
    margin = Math.min(2000, dealerPrice * 0.07);
  } else if (dealerPrice < 100000) {
    margin = Math.min(2500, dealerPrice * 0.05);
  } else {
    margin = Math.min(2500, dealerPrice * 0.03);
  }
  
  const newPrice = dealerPrice + Math.round(margin);
  
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
// GENERATE OUTPUT CSVs
// ============================================================

function generateOutputCSVs(matches) {
  const byCategory = {};
  
  for (const match of matches) {
    if (!match.dbProduct) continue;
    
    const cat = match.dbProduct.category || 'Uncategorized';
    if (!byCategory[cat]) {
      byCategory[cat] = [];
    }
    
    byCategory[cat].push({
      ID: match.dbProduct.id,
      SKU: match.dbProduct.sku,
      Name: match.dbProduct.name,
      'Regular price': match.newPrice
    });
  }
  
  for (const cat of Object.keys(byCategory)) {
    const products = byCategory[cat];
    if (products.length === 0) continue;
    
    let csvContent = 'ID,SKU,Name,Regular price\n';
    for (const p of products) {
      csvContent += p.ID + ',' + p.SKU + ',"' + p.Name + '",' + p['Regular price'] + '\n';
    }
    
    const safeCategory = cat.replace(/[^a-zA-Z0-9]/g, '_');
    const outputPath = path.join(OUTPUT_DIR, safeCategory + '_price_update.csv');
    fs.writeFileSync(outputPath, csvContent);
    console.log('Generated ' + outputPath + ' with ' + products.length + ' products');
  }
  
  // Master file
  const allProducts = matches.filter(m => m.dbProduct).map(m => ({
    ID: m.dbProduct.id,
    SKU: m.dbProduct.sku,
    Name: m.dbProduct.name,
    'Regular price': m.newPrice,
    Category: m.dbProduct.category,
    PDF_Brand: m.pdfProduct.brand,
    PDF_Model: m.pdfProduct.model,
    PDF_Price: m.pdfProduct.price,
    Match_Score: m.score
  }));
  
  let masterContent = 'ID,SKU,Name,Regular price,Category,PDF_Brand,PDF_Model,PDF_Price,Match_Score\n';
  for (const p of allProducts) {
    masterContent += p.ID + ',' + p.SKU + ',"' + p.Name + '",' + p['Regular price'] + ',' + p.Category + ',' + p.PDF_Brand + ',' + p.PDF_Model + ',' + p.PDF_Price + ',' + p.Match_Score + '\n';
  }
  
  fs.writeFileSync(path.join(OUTPUT_DIR, 'MASTER_price_update.csv'), masterContent);
  console.log('Generated MASTER_price_update.csv with ' + allProducts.length + ' products');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('=== STEP 1: Parsing PDF files ===');
  
  const pdfFiles = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('_extracted.txt'));
  const allPdfProducts = [];
  
  for (const file of pdfFiles) {
    const text = fs.readFileSync(path.join(PDF_DIR, file), 'utf-8');
    let products = [];
    
    if (file.includes('A4Tech')) {
      products = parseA4Tech(text);
    } else if (file.includes('ASUS')) {
      products = parseASUS(text);
    } else if (file.includes('GM Pricelist')) {
      products = parseGM(text);
    } else if (file.includes('MSI')) {
      products = parseMSI(text);
    } else if (file.includes('PXN')) {
      products = parsePXN(text);
    } else if (file.includes('ThermalRight') && file.includes('11-09')) {
      products = parseThermalRight(text);
    } else if (file.includes('ThermalRight')) {
      continue;
    } else if (file.includes('UGREEN')) {
      products = parseUGREEN(text);
    }
    
    console.log(file + ': ' + products.length + ' products parsed');
    allPdfProducts.push(...products);
  }
  
  console.log('Total PDF products: ' + allPdfProducts.length);
  
  console.log('\n=== STEP 2: Parsing database files ===');
  const dbProducts = parseDBFiles();
  console.log('Total DB products: ' + dbProducts.length);
  
  console.log('\n=== STEP 3: Matching products (brand-aware) ===');
  const matches = [];
  
  for (const pdfProduct of allPdfProducts) {
    const result = findBestMatch(pdfProduct, dbProducts);
    if (result.match) {
      const newPrice = calculateNewPrice(pdfProduct.price, result.match.price);
      matches.push({
        pdfProduct,
        dbProduct: result.match,
        score: result.score,
        newPrice
      });
      console.log('MATCH (' + result.score.toFixed(2) + '): ' + pdfProduct.brand + ' ' + pdfProduct.model + ' (' + pdfProduct.price + ') -> ' + result.match.name + ' (' + result.match.price + ') -> NEW: ' + newPrice);
    } else {
      console.log('NO MATCH: ' + pdfProduct.brand + ' ' + pdfProduct.model + ' (' + pdfProduct.price + ')');
    }
  }
  
  console.log('\nTotal matches: ' + matches.filter(m => m.dbProduct).length);
  
  console.log('\n=== STEP 4 & 5: Generating output CSVs ===');
  generateOutputCSVs(matches);
  
  console.log('\n=== DONE ===');
}

main().catch(console.error);
