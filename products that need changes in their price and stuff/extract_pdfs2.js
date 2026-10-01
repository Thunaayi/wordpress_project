const fs = require('fs');
const path = require('path');
const PDFParser = require('pdf2json');

const pdfDir = __dirname;
const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));

function extractPdf(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataError', err => reject(err.parserError));
    pdfParser.on('pdfParser_dataReady', pdfData => {
      const text = pdfData.Pages.map(page => 
        page.Texts.map(t => {
          try {
            return decodeURIComponent(t.R[0].T);
          } catch (e) {
            return t.R[0].T;
          }
        }).join(' ')
      ).join('\n');
      resolve(text);
    });
    pdfParser.loadPDF(filePath);
  });
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
