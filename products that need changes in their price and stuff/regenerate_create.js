const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ============================================================
// CATEGORY MAPPING: specific -> general (existing in DB)
// ============================================================
const CATEGORY_MAP = {
  'A4Tech Webcam': 'Webcam',
  'A4Tech Mouse': 'Mouse',
  'A4Tech Keyboard': 'Keyboard',
  'A4Tech Headphones': 'Headphones',
  'A4Tech Combo': 'Keyboard, Mouse',
  'A4Tech Accessories': 'Uncategorized',
  'Bloody Gaming Headphone': 'Headphones',
  'Bloody Gaming Keyboard': 'Keyboard',
  'Bloody Gaming Mouse': 'Mouse',
  'Bloody Accessories': 'Uncategorized',
  'Bloody Gaming Headphone': 'Headset',
  'A4Tech Mousepad': 'Mousepad',
  'A4Tech Headset': 'Headset',
  'A4Tech': 'Uncategorized',
  'Bloody': 'Uncategorized',
  'Liquid Cooler': 'Cooling Solutions',
  'CPU Cooler': 'Cooling Solutions',
  'Case Fan': 'Cooling Solutions',
  'Casing': 'Casing',
  'Power Supply': 'Power Supply (PSU)',
  'Power Supply (PSU)': 'Power Supply (PSU)',
  'Thermal Paste': 'Thermal Paste',
  'LCD Screen/Hub': 'Uncategorized',
  'Bending Corrector Frame': 'Uncategorized',
  'Cooler/PSU/Paste': 'Cooling Solutions',
  'Graphics Card': 'Graphics Cards (GPU)',
  'Monitor': 'Monitors',
  'Motherboard': 'Motherboard',
  'Power Supply': 'Power Supply (PSU)',
  'Casing': 'Casing',
  'Cooler': 'Cooling Solutions',
  'Gaming Keyboard': 'Keyboard',
  'Gaming Mouse': 'Mouse',
  'Gamepad': 'Controllers',
  'Casing, Chassis Accessories, Controllers, Cooling Solutions': 'Casing',
  'Gaming Laptop': 'Gaming Laptops',
  'Gaming Laptops > ROG': 'Gaming Laptops > ROG',
  'Gaming Laptops > TUF gaming': 'Gaming Laptops > TUF gaming',
  'Cooler/Fan': 'Cooling Solutions',
  'Gaming Chair': 'Gaming Chair',
  'Gaming Desk': 'Gaming Desk',
  'Webcam/Mic': 'Webcam',
  'Headset': 'Headset',
  'Headphones': 'Headphones',
  'Keyboard': 'Keyboard',
  'Mouse': 'Mouse',
  'Mousepad': 'Mousepad',
  'Speaker': 'Speakers',
  'Microphone': 'Microphone',
  'Cooler': 'Cooling Solutions',
  'Fan': 'Cooling Solutions',
  'Router': 'Routers',
  'Gaming Chair/Stand': 'Gaming Chair',
  'Storage/Enclosure': 'Storage',
  'Mini PC': 'Mini PC (NUC)',
  'Webcam': 'Webcam',
  'Cables/Adapters': 'Uncategorized',
  'Hubs': 'Uncategorized',
  'Cables': 'Uncategorized',
  'Adapters': 'Uncategorized',
  'Docks': 'Uncategorized',
  'Enclosures': 'Storage',
  'Stand': 'Uncategorized',
  'Microphone': 'Microphone',
  'Speaker': 'Speakers',
  'Headphones': 'Headphones',
  'Mouse': 'Mouse',
  'Keyboard': 'Keyboard',
  'Webcam/Mic': 'Webcam',
  'Racing/Controller': 'Controllers',
  'Racing Wheel': 'Controllers',
  'Controller': 'Controllers',
  'Graphics Card': 'Graphics Cards (GPU)',
  'NVMe SSD': 'Storage',
  '2.5 SSD': 'Storage',
  'RAM': 'Memory (RAM)',
  'Graphics Cards (GPU)': 'Graphics Cards (GPU)',
  'AMD Motherboard': 'Motherboard',
  'Intel Motherboard': 'Motherboard',
  'Gaming Chair': 'Gaming Chair',
  'Gaming Desk': 'Gaming Desk',
  'Lian Li': 'Casing',
  'Cougar': 'Casing',
  'GameSir': 'Controllers',
  'Mouse': 'Mouse',
  'Keyboard': 'Keyboard',
  'Headset': 'Headset',
  'Headphones': 'Headphones',
  'Speaker': 'Speakers',
  'Microphone': 'Microphone',
  'Webcam': 'Webcam',
  'Mousepad': 'Mousepad',
  'Presenter': 'Presenters',
  'RAM/Storage': 'Memory (RAM)',
  'Plantronics': 'Headset',
  'Jabra': 'Headset',
  'HyperX': 'Headset',
  'SteelSeries': 'Headset',
  'Glorious': 'Mouse',
  'Attack Shark': 'Mouse',
  'Aula': 'Keyboard',
  'GameMax': 'Casing',
  'Logitech China Variant': 'Mouse',
  'Plantronics': 'Headset',
  'Jabra': 'Headset',
  'HyperX': 'Headset',
  'SteelSeries': 'Headset',
  'Glorious': 'Mouse',
  'Attack Shark': 'Mouse',
  'Aula': 'Keyboard',
  'GameMax': 'Casing',
  'Evolve': 'Headset',
  'GameOn': 'Gaming Chair',
  'Zidli': 'Headset',
  'Glorious': 'Mouse',
  'SteelSeries': 'Headset',
  'HyperX': 'Headset',
  'Jabra': 'Headset',
  'JBL': 'Speakers',
  'Plantronics': 'Headset',
  'Logitech China Variant': 'Mouse',
  'Logitech': 'Mouse',
  'Razer': 'Mouse',
  'SteelSeries': 'Headset',
  'HyperX': 'Headset',
  'Jabra': 'Headset',
  'JBL': 'Speakers',
  'Plantronics': 'Headset',
  'Logitech': 'Mouse',
  'Razer': 'Mouse',
  'SteelSeries': 'Headset',
  'HyperX': 'Headset',
  'Jabra': 'Headset',
  'JBL': 'Speakers',
  'Plantronics': 'Headset',
  '2.5 SSD': 'Storage',
  'NVMe SSD': 'Storage',
  'RAM': 'Memory (RAM)',
  'Graphics Card': 'Graphics Cards (GPU)',
  'Storage/Enclosure': 'Storage',
  'A4Tech Mouse': 'Mouse',
  'A4Tech Keyboard': 'Keyboard',
  'A4Tech Headphones': 'Headphones',
  'A4Tech Combo': 'Keyboard, Mouse',
  'A4Tech Accessories': 'Uncategorized',
  'A4Tech Webcam': 'Webcam',
  'Bloody Gaming Headphone': 'Headphones',
  'Bloody Gaming Keyboard': 'Keyboard',
  'Bloody Gaming Mouse': 'Mouse',
  'Bloody Accessories': 'Uncategorized',
  'Bloody Gaming Headphone': 'Headset',
  'A4Tech Mousepad': 'Mousepad',
  'A4Tech Headset': 'Headset',
  'Bloody Gaming Headphone': 'Headset',
  'Bloody Gaming Keyboard': 'Keyboard',
  'Bloody Gaming Mouse': 'Mouse',
  'Bloody Accessories': 'Uncategorized',
  'Cooler/PSU/Paste': 'Cooling Solutions',
  'Cooling Solutions': 'Cooling Solutions',
  'Uncategorized': 'Uncategorized',
  '': 'Uncategorized',
};

// ============================================================
// PROCESS CREATE CSVs
// ============================================================

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

    // Categories column is at index 26
    if (parts.length > 26) {
      let cat = parts[26].replace(/^\"/, '').replace(/\"$/, '');
      const mapped = CATEGORY_MAP[cat] || cat;
      parts[26] = '\"' + mapped.replace(/\"/g, '\"\"') + '\"';
    }

    newLines.push(parts.join(','));
  }

  fs.writeFileSync(filePath, newLines.join('\n'));
  console.log('Fixed categories in: ' + file);
}

console.log('Done!');
