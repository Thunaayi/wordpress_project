const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function inspect() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // Inspect pclab.pk search results
  await page.goto("https://pclab.pk/search?q=PRO+H610M-S+D4", { waitUntil: "networkidle2", timeout: 30000 });
  console.log("=== PCLabs Search Page ===");
  console.log("URL:", page.url());
  
  // Get all links on page
  const allLinks = await page.$$eval("a", els => els.map(el => ({ href: el.href, text: el.textContent.trim(), class: el.className, parentClass: el.parentElement?.className })));
  const productLinks = allLinks.filter(l => l.href.includes("/product/"));
  console.log("Product links found:", productLinks.length);
  productLinks.slice(0,10).forEach(l => console.log("  " + l.text.substring(0,60) + " -> " + l.href + " | class: " + l.class + " | parent: " + l.parentClass));
  
  // Also check for common product containers
  const containers = await page.$$eval("div[class*=\"product\"], li[class*=\"product\"], article[class*=\"product\"]", els => 
    els.map(el => ({ class: el.className, children: el.children.length, text: el.textContent.trim().substring(0,100) }))
  );
  console.log("Product containers found:", containers.length);
  containers.slice(0,5).forEach(c => console.log("  class:", c.class, "| children:", c.children, "| text:", c.text));
  
  await browser.close();
}

(async () => {
  const puppeteer = require("puppeteer-extra");
  puppeteer.use(require("puppeteer-extra-plugin-stealth")());
  try { await inspect(); } catch(e) { console.error(e); }
})();
