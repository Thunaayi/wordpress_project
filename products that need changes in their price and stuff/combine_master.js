const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const INPUT_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/the csv with the sku that I can just import into wordpress without ruining anything';
const OUTPUT_FILE = path.join(INPUT_DIR, 'MASTER_UPLOAD_all_matched.csv');

const files = fs.readdirSync(INPUT_DIR).filter(f => 
  f.endsWith('_price_update.csv') && 
  !f.startsWith('UNMATCHED') && 
  !f.startsWith('MASTER')
);

console.log('Combining files (deduplicating by ID):');
const seenIds = new Set();
let allRows = ['ID,SKU,Name,Regular price,In stock?,Images'];
let total = 0;

for (const file of files) {
  const content = fs.readFileSync(path.join(INPUT_DIR, file), 'utf-8');
  const records = parse(content, { 
    columns: true, 
    skip_empty_lines: true,
    relax_column_count: true
  });
  
  for (const row of records) {
    const id = row.ID;
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      const name = row.Name.replace(/\"/g, '\"\"');
      const images = row.Images.replace(/\"/g, '\"\"');
      allRows.push(id + ',' + row.SKU + ',\"' + name + '\",' + row['Regular price'] + ',' + row['In stock?'] + ',\"' + images + '\"');
      total++;
    }
  }
  console.log('  ' + file + ': ' + records.length + ' rows');
}

fs.writeFileSync(OUTPUT_FILE, allRows.join('\n') + '\n');
console.log('\nTotal unique products: ' + total);

const stats = fs.statSync(OUTPUT_FILE);
console.log('File size: ' + (stats.size / 1024).toFixed(1) + ' KB');
