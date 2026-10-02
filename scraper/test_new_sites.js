const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  const testSites = [
    { name: "czone.com.pk", url: "https://czone.com.pk/?s=RTX+3060&post_type=product" },
    { name: "zestrogaming.com", url: "https://zestrogaming.com/?s=RTX+3060&post_type=product" },
    { name: "techmatched.pk", url: "https://techmatched.pk/?s=RTX+3060&post_type=product" },
    { name: "mustafacomputers.pk", url: "https://mustafacomputers.pk/?s=RTX+3060&post_type=product" },
    { name: "megatech.pk", url: "https://megatech.pk/?s=RTX+3060&post_type=product" },
  ];

  for (const site of testSites) {
    try {
      const response = await page.goto(site.url, { waitUntil: "networkidle2", timeout: 30000 });
      console.log("\n" + site.name + ":");
      console.log("  URL:", page.url());
      console.log("  Status:", response.status());
      console.log("  Title:", await page.title());

      const content = await page.content();
      console.log("  Content length:", content.length);
      console.log("  Contains product:", content.toLowerCase().includes("product"));
      console.log("  Contains RTX:", content.includes("RTX"));
    } catch (e) {
      console.log("  Error:", e.message);
    }
    console.log("---");
  }

  await browser.close();
}

(async () => {
  const puppeteer = require("puppeteer-extra");
  puppeteer.use(require("puppeteer-extra-plugin-stealth")());
  try { await test(); } catch(e) { console.error(e); }
})();
