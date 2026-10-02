const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Download image from URL and save to local file system
 */
async function downloadImage(imageUrl, savePath) {
  return new Promise((resolve, reject) => {
    try {
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const protocol = imageUrl.startsWith('https') ? https : http;
      const request = protocol.get(imageUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error('HTTP ' + response.statusCode));
          return;
        }

        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          fs.writeFileSync(savePath, buffer);
          resolve(savePath);
        });
        response.on('error', reject);
      });
      request.on('error', reject);
      request.setTimeout(30000, () => reject(new Error('Timeout')));
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Download multiple images with concurrency control
 */
async function downloadImages(imageUrls, baseDir, concurrency = 3) {
  const paths = [];
  
  // Process in batches
  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);
    const promises = batch.map(async (url, idx) => {
      try {
        // FIX: was `imageUrls[i + batch.indexOf(url)]` — indexOf finds the
        // FIRST occurrence of a URL in the batch, so two identical image
        // URLs in the same batch would both resolve to the same index and
        // the second one would silently overwrite/duplicate the first.
        // `idx`, the index map() already gives you, doesn't have that problem.
        const filename = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + getImageExtension(url);
        // FIX: was hardcoding path.join(__dirname, '../../data/images', ...)
        // and ignoring the `baseDir` parameter entirely.
        const savePath = path.join(baseDir, filename);

        const result = await downloadImage(url, savePath);
        return result;
      } catch (error) {
        console.error('Failed to download ' + url + ': ' + error.message);
        return null;
      }
    });
    
    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        paths.push(path.basename(result.value));
      }
    }
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }
  
  return paths;
}

function getImageExtension(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.(jpg|jpeg|png|webp|gif|avif)(?:\?.*)?$/i);
    return match ? match[0].split('?')[0] : '.jpg';
  } catch {
    return '.jpg';
  }
}

/**
 * Generate organized filename for product image
 */
function generateImageFilename(productName, index, url) {
  const ext = getImageExtension(url);
  const safeName = productName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50);
  return safeName + '_' + Date.now() + '_' + index + getImageExtension(url);
}

module.exports = { downloadImage, downloadImages, getImageExtension, generateImageFilename };
