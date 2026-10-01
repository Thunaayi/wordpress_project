const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const MASTER_FILE = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/claude\u0027s findings/all_products_MASTER_combined.csv';
const DB_FILE = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/wc-product-export-latest.csv';
const OUTPUT_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/the csv with the sku that I can just import into wordpress without ruining anything/UPDATE_CSVs_v2';

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

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  const masterContent = fs.readFileSync(MASTER_FILE, 'utf-8');
  const masterRecords = parse(fs.readFileSync(MASTER_FILE, 'utf-8'), { 
    columns: true, 
    skip_empty_lines: true, 
    relax_column_count: true,
    relax_column_count_less: true,
    relax_column_count_more: true
  });
  
  const dbContent = fs.readFileSync(DB_FILE, 'utf-8');
  const dbRecords = parse(fs.readFileSync(DB_FILE, 'utf-8'), { 
    columns: true, 
    skip_empty_lines: true, 
    relax_column_count: true,
    relax_column_count_less: true,
    relax_column_count_more: true
  });
  
  const dbByName = new Map();
  for (const r of dbRecords) {
    const name = (r.Name || '').trim();
    if (name) dbByName.set(name.toLowerCase(), r);
  }
  
  console.log('Master products:', masterRecords.length);
  console.log('DB products:', dbRecords.length);
  console.log('DB lookup size:', dbByName.size);
  
  const matches = [];
  for (const m of masterRecords) {
    const dbProduct = dbByName.get((m.Name || '').trim().toLowerCase());
    if (dbProduct) {
      const dealerPrice = parseFloat(m.Price);
      const currentPrice = parseInt((dbProduct['Regular price'] || '0').toString().replace(/,/g, ''));
      const newPrice = calculateNewPrice(dealerPrice);
      
      if (newPrice !== currentPrice) {
        matches.push({ dbProduct, priceProduct: m, dealerPrice, currentPrice, newPrice });
      }
    }
  }
  
  console.log('Products needing price update:', matches.length);
  
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  const byCategory = {};
  for (const m of matches) {
    const cat = m.dbProduct.Categories || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  }
  
  for (const [cat, catMatches] of Object.entries(byCategory)) {
    if (catMatches.length === 0) continue;
    const safeCat = cat.replace(/[^a-zA-Z0-9]/g, '_');
    let csvContent = 'ID,SKU,Name,Regular price,In stock?,Images\n';
    for (const m of catMatches) {
      const name = (m.dbProduct.Name || '').replace(/\"/g, '\"\"');
      const sku = (m.dbProduct.SKU || '');
      const id = (m.dbProduct['\ufeffID'] || m.dbProduct.ID || '');
      const inStock = (m.dbProduct['In stock?'] || '1');
      const images = (m.dbProduct.Images || '').replace(/\"/g, '\"\"');
      csvContent += id + ',' + sku + ',\"' + name + '\",' + m.newPrice + ',' + inStock + ',\"' + images + '\"\n';
    }
    
    const filename = cat.replace(/[^a-zA-Z0-9]/g, '_') + '_price_update.csv';
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), csvContent);
    console.log('UPDATE: ' + filename + ' (' + catMatches.length + ' products)');
  }
  
  let masterCsv = 'ID,SKU,Name,Regular price,In stock?,Images,Category,Source,Dealer Price,Current Price,New Price,Margin\n';
  for (const m of matches) {
    const name = (m.dbProduct.Name || '').replace(/\"/g, '\"\"');
    const sku = (m.dbProduct.SKU || '');
    const images = (m.dbProduct.Images || '').replace(/\"/g, '\"\"');
    masterCsv += (m.dbProduct['\ufeffID'] || m.dbProduct.ID || '') + ',' + m.dbProduct.SKU + ',\"' + name + '\",' + 
      m.newPrice + ',' + m.dbProduct['In stock?'] + ',\"' + images + '\",' + 
      m.dbProduct.Categories + ',\"' + m.priceProduct.Source + '\",' + m.dealerPrice + ',' + 
      m.currentPrice + ',' + m.newPrice + ',' + (m.newPrice - m.dealerPrice) + '\n';
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'MASTER_price_update_AUDIT.csv'), masterCsv);
  console.log('Generated MASTER_price_update_AUDIT.csv');
  
  console.log('\n=== DONE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
