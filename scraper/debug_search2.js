const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  try {
    await page.goto("https://tech.com.pk/?s=TR+240+Aqua+Elite+V6+ARGB+Black&post_type=product", { waitUntil: "networkidle2", timeout: 60000 });
    console.log("URL:", page.url());
    console.log("Title:", await page.title());
    
    await new Promise(r => setTimeout(r, 3000));
    
    // Check for product grid
    const productGrid = await page.$(".products-grid, .products-grid, .product-grid, .product-listing, .search-results, .product-listing, .product-loop, .woocommerce-product-loop");
    console.log("Product grid element:", productGrid ? "FOUND" : "NOT FOUND");
    
    // Check all elements with class containing product
    const productElements = await page.$$eval("[class*=\"product\"]", els => 
      els.map(el => ({ tag: el.tagName, class: el.className, id: el.id, text: el.textContent.trim().substring(0,100) }))
    );
    console.log("Elements with 'product' in class:", productElements.length);
    productElements.slice(0,20).forEach(e => console.log("  ", e.tag, "| class:", e.class.substring(0,80), "| text:", e.text.substring(0,80)));
    
    // Check for WooCommerce product elements
    const wcProducts = await page.$$eval(".product, .product-item, .product-card, .product-box, .type-product, .woocommerce-product", els => 
      els.map(el => ({ tag: el.tagName, class: el.className, id: el.id, text: el.textContent.trim().substring(0,100) }))
    );
    console.log("\nWooCommerce product elements:", wcProducts.length);
    wcProducts.slice(0,10).forEach(e => console.log("  ", e.tag, "| class:", e.class.substring(0,80), "| text:", e.text.substring(0,80)));
    
    // Check for product links
    const productLinks = await page.$$eval("a[href*=\"/product/\"]", els => 
      els.map(el => ({ href: el.href, text: el.textContent.trim().substring(0,100), class: el.className }))
    );
    console.log("\nProduct links found:", productLinks.length);
    productLinks.slice(0,10).forEach(l => console.log("  ", l.text.substring(0,60), "->", l.href));
    
    // Check page content for product data
    const content = await page.content();
    console.log("\nPage contains 'TR 240':", content.includes("TR 240"));
    console.log("Page contains 'Aqua Elite':", content.includes("Aqua Elite"));
    console.log("Page contains '360':", content.includes("360"));
    
    // Check for specific product container classes
    const containers = await page.$$eval("[class*=\"product\"], [class*=\"item\"], [class*=\"card\"]", els => 
      els.map(el => ({ tag: el.tagName, class: el.className, id: el.id, text: el.textContent.trim().substring(0,100) }))
    );
    console.log("\nAll containers with product/item/card:", containers.length);
    containers.slice(0,30).forEach(c => console.log("  ", c.tag, "| class:", c.class.substring(0,80), "| text:", c.text.substring(0,80)));
  } catch (e) {
    console.log("Error:", e.message);
  }
  
  await browser.close();
}

(async () => {
  const puppeteer = require("puppeteer-extra");
  puppeteer.use(require("puppeteer-extra-plugin-stealth")());
  try { await test(); } catch(e) { console.error(e); }
})();
