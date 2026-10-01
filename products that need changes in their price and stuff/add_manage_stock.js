const fs = require('fs');
const path = require('path');

const CREATE_DIR = 'C:/Users/Aimal/Documents/GitHub/Wordpress project/the csv with the sku that I can just import into wordpress without ruining anything/CREATE_CSVs';

const files = fs.readdirSync(CREATE_DIR).filter(f => f.endsWith('_CREATE.csv'));

for (const file of files) {
  const filePath = path.join(CREATE_DIR, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length < 2) continue;

  const header = lines[0];
  // Insert 'Manage stock?' after 'In stock?' column
  const headerParts = header.split(',');
  const inStockIdx = headerParts.findIndex(h => h.trim() === 'In stock?');
  
  let newHeader;
  if (inStockIdx >= 0) {
    const newHeaderParts = [...headerParts];
    newHeaderParts.splice(inStockIdx + 1, 0, 'Manage stock?');
    newHeader = newHeaderParts.join(',');
  } else {
    newHeader = header;
  }
  
  const newLines = [newHeader];

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

    // Insert 'no' after 'In stock?' column
    if (inStockIdx >= 0 && parts.length > inStockIdx) {
      const newParts = [...parts];
      newParts.splice(inStockIdx + 1, 0, 'no');
      newLines.push(newParts.join(','));
    } else {
      newLines.push(lines[i]);
    }
  }

  fs.writeFileSync(filePath, newLines.join('\n'));
  console.log('Fixed: ' + file);
}

console.log('Done!');
