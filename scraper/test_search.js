const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  const testUrls = [
    "https://pclab.pk/?s=PRO+H610M-S+D4&post_type=product",
    "https://pclab.pk/?s=RTX+3060&post_type=product",
    "https://pclab.pk/search?q=PRO+H610M-S+D4",
    "https://pclab.pk/search?q=RTX+3060",
  ];

  for (const url of testUrls) {
    try {
      const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      console.log("\nURL:", url);
      console.log("Status:", response.status());
      console.log("Final URL:", page.url());
      
      const content = await page.content();
      console.log("Content length:", content.length);
      console.log("Contains 'product':", content.toLowerCase().includes("product"));
      console.log("Contains 'RTX':", content.includes("RTX"));
      console.log("Contains 'H610':", content.includes("H610"));
      
      const products = await page.$$eval(".product, .product-item, .product-card, .product-box, [class*=\"product\"]", els => 
        els.map(el => ({ class: el.className, text: el.textContent.trim().substring(0, 100) }))
      );
      console.log("Product elements found:", products.length);
      products.slice(0, 5).forEach(p => console.log("  ", p.class.substring(0, 60), "|", p.text.substring(0, 80)));
      
      console.log("---");
    } catch (e) {
      console.log("Error:", e.message);
    }
  }
  
  await browser.close();
}

const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

(async () => {
  try { await test(); } catch(e) { console.error(e); }
})();
