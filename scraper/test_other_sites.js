const puppeteer = require("puppeteer-extra");
puppeteer.use(require("puppeteer-extra-plugin-stealth")());

async function test() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // Test techlad.pk
  try {
    await page.goto("https://techlad.pk/?s=ROG+STRIX&post_type=product", { waitUntil: "networkidle2", timeout: 30000 });
    console.log("techlad URL:", page.url());
    console.log("Title:", await page.title());

    const content = await page.content();
    console.log("Content length:", content.length);
    console.log("Contains product:", content.toLowerCase().includes("product"));
    console.log("Contains ROG:", content.includes("ROG"));
    console.log("Contains STRIX:", content.includes("STRIX"));
  } catch (e) {
    console.log("techlad Error:", e.message);
  }

  // Test zahcomputers.pk
  try {
    await page.goto("https://zahcomputers.pk/?s=TR+360&post_type=product", { waitUntil: "networkidle2", timeout: 30000 });
    console.log("zahcomputers URL:", page.url());
    console.log("Title:", await page.title());

    const content = await page.content();
    console.log("Content length:", content.length);
    console.log("Contains product:", content.toLowerCase().includes("product"));
    console.log("Contains TR:", content.includes("TR"));
    console.log("Contains 360:", content.includes("360"));
  } catch (e) {
    console.log("zahcomputers Error:", e.message);
  }

  await browser.close();
}

(async () => {
  const puppeteer = require("puppeteer-extra");
  puppeteer.use(require("puppeteer-extra-plugin-stealth")());
  try { await test(); } catch(e) { console.error(e); }
})();
