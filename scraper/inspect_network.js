const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function inspect() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // Monitor network requests
  page.on("response", response => {
    const url = response.url();
    if (url.includes("search") || url.includes("product") || url.includes("ajax") || url.includes("api") || url.includes("json")) {
      console.log("RESPONSE:", response.url(), response.status(), response.headers()["content-type"]);
    }
  });

  await page.goto("https://pclab.pk/search?q=PRO+H610M-S+D4", { waitUntil: "networkidle2", timeout: 30000 });
  console.log("=== PCLabs Search Page ===");
  console.log("URL:", page.url());
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Check if there are AJAX requests after page load
  await new Promise(r => setTimeout(r, 5000));
  
  await browser.close();
}

(async () => {
  const puppeteer = require("puppeteer-extra");
  puppeteer.use(require("puppeteer-extra-plugin-stealth")());
  try { await inspect(); } catch(e) { console.error(e); }
})();
