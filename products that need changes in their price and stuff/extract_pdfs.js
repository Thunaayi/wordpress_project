const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const pdfDir = __dirname;
const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));

async function extractPdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text;
}

async function main() {
  for (const file of pdfFiles) {
    console.log('\n=== ' + file + ' ===');
    try {
      const text = await extractPdf(path.join(pdfDir, file));
      console.log(text.substring(0, 5000));
      console.log('--- TRUNCATED ---');
      
      const outputFile = file.replace('.pdf', '_extracted.txt');
      fs.writeFileSync(path.join(pdfDir, outputFile), text);
      console.log('Saved full text to ' + outputFile);
    } catch (err) {
      console.error('Error extracting ' + file + ':', err.message);
    }
  }
}

main();
