// Main processing script
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const PDF_DIR = 'C:\\Users\\Aimal\\Documents\\GitHub\\Wordpress project\\products that need changes in their price and stuff';
const DB_DIR = 'C:\\Users\\Aimal\\Documents\\GitHub\\Wordpress project\\original products in db';
const OUTPUT_DIR = 'C:\\Users\\Aimal\\Documents\\GitHub\\Wordpress project\\the csv with the sku that I can just import into wordpress without ruining anything';

// ============================================================
// STEP 1: Parse PDF extracted text files
// ============================================================

function parseA4Tech(text) {
  const products = [];
  const lines = text.split('\n');
  let currentSection = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Detect sections
    if (trimmed.includes('MOUSE') || trimmed.includes('KEYBOARD') || trimmed.includes('COMBO') || 
        trimmed.includes('HEADPHONE') || trimmed.includes('HEADSET') || trimmed.includes('WEBCAM') ||
        trimmed.includes('ACCESSORIES') || trimmed.includes('GAMING KEYBOARD') || trimmed.includes('GAMING MOUSE')) {
      currentSection = trimmed;
      continue;
    }
    
    // Parse product lines - format: number MODEL (color) Description PRICE
    const match = trimmed.match(/^(\d+)\s+(\S+)\s+\(([^)]+)\)\s+(.+?)\s+([\d,]+)$/);
    if (match) {
      const num = match[1];
      const model = match[2];
      const color = match[3];
      const desc = match[4];
      const price = match[5];
      products.push({
        brand: 'A4Tech',
        model: model.trim(),
        color: color.trim(),
        name: desc.trim(),
        price: parseInt(price.replace(/,/g, '')),
        section: currentSection
      });
      continue;
    }
    
    // Alternative format without color
    const match2 = trimmed.match(/^(\d+)\s+(\S+)\s+(.+?)\s+([\d,]+)$/);
    if (match2) {
      const num = match2[1];
      const model = match2[2];
      const desc = match2[3];
      const price = match2[4];
      // Skip if it looks like a header
      if (desc.includes('A4tech') || desc.includes('Bloody')) {
        products.push({
          brand: 'A4Tech',
          model: model.trim(),
          color: '',
          name: desc.trim(),
          price: parseInt(price.replace(/,/g, '')),
          section: currentSection
        });
      }
    }
  }
  return products;
}

function parseASUS(text) {
  const products = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // ASUS format: MODEL PRICE
    const match = trimmed.match(/^(.+?)\s+([\d,]+)$/);
    if (match) {
      const model = match[1];
      const price = match[2];
      const cleanModel = model.trim();
      const cleanPrice = parseInt(price.replace(/,/g, ''));
      
      if (cleanPrice > 1000 && cleanModel.length > 3) {
        products.push({
          brand: 'ASUS',
          model: cleanModel,
          name: cleanModel,
          price: cleanPrice,
          section: 'MOTHERBOARD/GPU/MONITOR'
        });
      }
    }
  }
  return products;
}

function parseGM(text) {
  const products = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // GM format: PART_NO Description PRICE
    const match = trimmed.match(/^(\d{3}-\d{6}|\d{3}-\d{5})\s+(.+?)\s+([\d,]+)$/);
    if (match) {
      const partNo = match[1];
      const desc = match[2];
      const price = match[3];
      products.push({
        brand: 'Logitech',
        model: partNo.trim(),
        name: desc.trim(),
        price: parseInt(price.replace(/,/g, '')),
        section: 'LOGITECH'
      });
    }
  }
  return products;
}

function parseMSI(text) {
  const products = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // MSI format: MODEL PRICE
    const match = trimmed.match(/^(.+?)\s+([\d,]+)$/);
    if (match) {
      const model = match[1];
      const price = match[2];
      const cleanModel = model.trim();
      const cleanPrice = parseInt(price.replace(/,/g, ''));
      
      if (cleanPrice > 1000 && cleanModel.length > 3) {
        products.push({
          brand: 'MSI',
          model: cleanModel,
          name: cleanModel,
          price: cleanPrice,
          section: 'MSI'
        });
      }
    }
  }
  return products;
}

function parsePXN(text) {
  const products = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // PXN format: number PART_NO Description PRICE
    const match = trimmed.match(/^(\d+)\s+(\S+)\s+(.+?)\s+([\d,]+)$/);
    if (match) {
      const num = match[1];
      const partNo = match[2];
      const desc = match[3];
      const price = match[4];
      products.push({
        brand: 'PXN',
        model: partNo.trim(),
        name: desc.trim(),
        price: parseInt(price.replace(/,/g, '')),
        section: 'PXN'
      });
    }
  }
  return products;
}

function parseThermalRight(text) {
  const products = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // ThermalRight format: MODEL PRICE
    const match = trimmed.match(/^(.+?)\s+([\d,]+)$/);
    if (match) {
      const model = match[1];
      const price = match[2];
      const cleanModel = model.trim();
      const cleanPrice = parseInt(price.replace(/,/g, ''));
      
      if (cleanPrice > 100 && cleanModel.length > 3) {
        products.push({
          brand: 'ThermalRight',
          model: cleanModel,
          name: cleanModel,
          price: cleanPrice,
          section: 'THERMALRIGHT'
        });
      }
    }
  }
  return products;
}

function parseUGREEN(text) {
  const products = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // UGREEN format: number CODE Description PRICE
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+?)\s+([\d,]+)$/);
    if (match) {
      const num = match[1];
      const code = match[2];
      const desc = match[3];
      const price = match[4];
      products.push({
        brand: 'UGREEN',
        model: code.trim(),
        name: desc.trim(),
        price: parseInt(price.replace(/,/g, '')),
        section: 'UGREEN'
      });
    }
  }
  return products;
}

// ============================================================
// STEP 2: Parse database CSV files
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
            brand,
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
// STEP 3: Fuzzy matching
// ============================================================

function normalizeName(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateSimilarity(str1, str2) {
  const a = normalizeName(str1);
  const b = normalizeName(str2);
  
  // Check for exact substring match
  if (a.includes(b) || b.includes(a)) return 0.9;
  
  // Token-based similarity
  const tokensA = new Set(a.split(' ').filter(t => t.length > 2));
  const tokensB = new Set(b.split(' ').filter(t => t.length > 2));
  
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function findBestMatch(pdfProduct, dbProducts) {
  let bestMatch = null;
  let bestScore = 0;
  
  for (const dbProduct of dbProducts) {
    const score = calculateSimilarity(pdfProduct.name, dbProduct.name);
    if (score > bestScore && score > 0.3) {
      bestScore = score;
      bestMatch = dbProduct;
    }
  }
  
  return { match: bestMatch, score: bestScore };
}

// ============================================================
// STEP 4: Calculate new prices with margin
// ============================================================

function calculateNewPrice(dealerPrice, currentPrice) {
  // Add margin up to 2500 Rs based on product price
  let margin;
  if (dealerPrice < 5000) {
    margin = Math.min(500, dealerPrice * 0.15);
  } else if (dealerPrice < 20000) {
    margin = Math.min(1500, dealerPrice * 0.1);
  } else if (dealerPrice < 50000) {
    margin = Math.min(2000, dealerPrice * 0.07);
  } else {
    margin = Math.min(2500, dealerPrice * 0.05);
  }
  
  const newPrice = dealerPrice + Math.round(margin);
  
  // Round to nearest 100 or 500 for cleaner prices
  if (newPrice < 10000) {
    return Math.round(newPrice / 100) * 100;
  } else if (newPrice < 50000) {
    return Math.round(newPrice / 500) * 500;
  } else {
    return Math.round(newPrice / 1000) * 1000;
  }
}

// ============================================================
// STEP 5: Generate output CSVs
// ============================================================

function generateOutputCSVs(matches) {
  // Group by category
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
  
  // Write CSV files
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
  
  // Also generate a master file
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
  
  console.log('\n=== STEP 3: Matching products ===');
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
