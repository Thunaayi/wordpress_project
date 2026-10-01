const fs = require('fs');
const path = require('path');

const NAME_BASED_CATEGORY = {
  // BenQ products
  'BenQ': 'Mouse',
  'Zowie': 'Mouse',
  // Zidli
  'Zidli': 'Headset',
  // Logitech
  'Logitech': 'Mouse',
  // BenQ Zowie
  'BenQ Zowie': 'Mouse',
};

const CATEGORY_MAP = {
  'Misc Accessories': 'Uncategorized',
  'BenQ': 'Mouse',
  'Zidli': 'Headset',
  'Logitech': 'Mouse',
  'BenQ Zowie': 'Mouse',
};

const CREATE_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/the csv with the sku that I can just import into wordpress without ruining anything/CREATE_CSVs';

const files = fs.readdirSync(CREATE_DIR).filter(f => f.endsWith('_CREATE.csv'));

for (const file of files) {
  const filePath = path.join(CREATE_DIR, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length < 2) continue;

  const header = lines[0];
  const newLines = [header];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) { newLines.push(lines[i]); continue; }

    const parts = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '\"') {
        if (inQuotes && j + 1 < lines[i].length && lines[i][j + 1] === '\"') {
          current += '\"';
          j++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        parts.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    parts.push(current);

    // Check Categories column (index 26) and Name column (index 3)
    if (parts.length > 26) {
      let cat = parts[26].replace(/^\"/, '').replace(/\"$/, '');
      let name = parts.length > 3 ? parts[3].replace(/^\"/, '').replace(/\"$/, '') : '';
      
      // Determine category: check name for brand, then fallback to category
      let mapped = cat;
      for (const [brand, category] of Object.entries(NAME_BASED_CATEGORY)) {
        if (name.includes(brand)) {
          mapped = category;
          break;
        }
      }
      if (mapped === cat) {
        mapped = CATEGORY_MAP[cat] || cat;
      }
      
      parts[26] = '\"' + mapped.replace(/\"/g, '\"\"') + '\"';
    }

    newLines.push(parts.join(','));
  }

  fs.writeFileSync(filePath, newLines.join('\n'));
  console.log('Fixed: ' + file);
}

console.log('Done!');
