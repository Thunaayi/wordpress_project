const fs = require('fs');
const path = require('path');

const INPUT_FILE = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/the csv with the sku that I can just import into wordpress without ruining anything/UNMATCHED_ALL_not_in_db.csv';
const OUTPUT_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/unmatched_templates';

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/^\"|\"$/g, '').trim());
  
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let recordData = {};
    let currentField = '';
    let inQuotes = false;
    let fieldIndex = 0;
    let charIndex = 0;
    
    while (charIndex < line.length) {
      const char = line[charIndex];
      
      if (char === '\"') {
        if (inQuotes && charIndex + 1 < line.length && line[charIndex + 1] === '\"') {
          currentField += '\"';
          charIndex += 2;
          continue;
        }
        inQuotes = !inQuotes;
        charIndex++;
        continue;
      }
      
      if (char === ',' && !inQuotes) {
        const header = headers[fieldIndex] || 'field_' + fieldIndex;
        recordData[header] = currentField.trim();
        currentField = '';
        fieldIndex++;
        charIndex++;
        continue;
      }
      
      currentField += char;
      charIndex++;
    }
    
    const header = headers[fieldIndex] || 'field_' + fieldIndex;
    recordData[header] = currentField.trim();
    
    if (Object.keys(recordData).length > 1) {
      records.push({...recordData});
    }
  }
  
  return records;
}

const headers = ['Source', 'Category', 'Name', 'Dealer Price', 'Suggested Retail Price', 'Reason'];
const content = fs.readFileSync(INPUT_FILE, 'utf-8');
const records = parseCSV(content);

console.log('Parsed ' + records.length + ' records');

// Group by source and category
const groups = {};
for (const r of records) {
  const source = r.Source || 'Unknown';
  const category = r.Category || 'Uncategorized';
  const key = source + ' || ' + category;
  if (!groups[key]) groups[key] = [];
  groups[key].push(r);
}

console.log('Groups found: ' + Object.keys(groups).length);
let total = 0;
for (const [key, items] of Object.entries(groups)) {
  console.log('  ' + key + ': ' + items.length + ' products');
  total += items.length;
}
console.log('\nTotal: ' + total);

// Write templates
for (const [key, items] of Object.entries(groups)) {
  const [source, category] = key.split(' || ');
  const safeSource = source.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const safeCategory = category.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const filename = safeSource + '_' + safeCategory + '_images_template.csv';
  const filepath = path.join(OUTPUT_DIR, filename);
  
  let csvContent = 'ID,SKU,Name,Source,Category,Dealer Price,Suggested Retail Price,Images\n';
  
  for (const item of items) {
    const name = (item.Name || '').replace(/\"/g, '\"\"');
    csvContent += ',,\"' + name + '\",\"' + source + '\",\"' + category + '\",' + 
      (item['Dealer Price'] || '') + ',' + (item['Suggested Retail Price'] || '') + ',\n';
  }
  
  fs.writeFileSync(filepath, csvContent);
  console.log('Created: ' + filename + ' (' + items.length + ' products)');
}

console.log('\nDone! Templates saved to: ' + OUTPUT_DIR);
