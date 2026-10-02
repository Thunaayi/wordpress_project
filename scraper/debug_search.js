const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // Test search on tech.com.pk
  try {
    await page.goto("https://tech.com.pk/?s=TR+240+Aqua+Elite+V6+ARGB+Black&post_type=product", { waitUntil: "networkidle2", timeout: 30000 });
    console.log("URL:", page.url());
    console.log("Title:", await page.title());
    
    const content = await page.content();
    console.log("Content length:", content.length);
    console.log("Contains product:", content.toLowerCase().includes("product"));
    console.log("Contains TR:", content.includes("TR"));
    console.log("Contains 240:", content.includes("240"));
    
    const products = await page.$$eval(".product, .product-item, .product-card, .product-box, [class*=\"product\"]", els => 
      els.map(el => ({ class: el.className, text: el.textContent.trim().substring(0, 100) }))
    );
    console.log("Product elements found:", products.length);
    products.slice(0, 5).forEach(p => console.log("  ", p.class.substring(0, 60), "|", p.text.substring(0, 80)));
  } catch (e) {
    console.log("Error:", e.message);
  }
  
  await browser.close();
}

test().catch(console.error);
