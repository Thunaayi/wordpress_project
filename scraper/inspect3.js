const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function inspect() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // Inspect pclab.pk search results - wait for content to load
  await page.goto("https://pclab.pk/search?q=PRO+H610M-S+D4", { waitUntil: "networkidle2", timeout: 30000 });
  console.log("=== PCLabs Search Page ===");
  console.log("URL:", page.url());
  
  // Wait a bit more for potential AJAX content
  await new Promise(r => setTimeout(r, 3000));
  
  // Check page content
  const content = await page.content();
  console.log("Page content length:", content.length);
  console.log("Contains 'product':", content.toLowerCase().includes("product"));
  console.log("Contains 'H610':", content.includes("H610"));
  console.log("Contains 'PRO':", content.includes("PRO"));
  
  // Check for product grid
  const productGrid = await page.$(".products-grid, .products-grid, .product-grid, .product-listing, .search-results");
  console.log("Product grid element:", productGrid ? "FOUND" : "NOT FOUND");
  
  // Check for product elements
  const productElements = await page.$$eval("[class*=\"product\"]", els => 
    els.map(el => ({ tag: el.tagName, class: el.className, id: el.id, text: el.textContent.trim().substring(0,100) }))
  );
  console.log("Elements with 'product' in class:", productElements.length);
  productElements.slice(0,20).forEach(e => console.log("  ", e.tag, "| class:", e.class.substring(0,80), "| text:", e.text.substring(0,80)));
  
  // Try searching with a simpler query
  await page.goto("https://pclab.pk/search?q=RTX+3060", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  console.log("\n=== Second search: RTX 3060 ===");
  console.log("URL:", page.url());
  const content2 = await page.content();
  console.log("Contains 'RTX':", content2.includes("RTX"));
  console.log("Contains '3060':", content2.includes("3060"));
  
  await browser.close();
}

const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

(async () => {
  try { await inspect(); } catch(e) { console.error(e); }
})();
