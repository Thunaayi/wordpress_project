const { URL } = require("url");

class ProductExtractor {
  static async extract(page) {
    return page.evaluate(() => {
      const clean = v => (v || "").replace(/\s+/g, " ").trim();
      const abs = v => { try { return new URL(v, location.href).href; } catch { return ""; } };
      const first = selectors => {
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) {
            const v = clean(el.getAttribute("content") || el.textContent);
            if (v) return v;
          }
        }
        return "";
      };
      const attr = (el, names) => {
        for (const n of names) { const v = el.getAttribute(n); if (v) return v; }
        return "";
      };

      const jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
          const x = JSON.parse(s.textContent);
          const add = v => {
            if (!v) return;
            if (Array.isArray(v)) v.forEach(add);
            else if (v["@graph"]) v["@graph"].forEach(add);
            else jsonLd.push(v);
          };
          add(x);
        } catch {}
      });
      const product = jsonLd.find(x => {
        const t = x["@type"];
        return Array.isArray(t) ? t.some(v => String(v).toLowerCase() === "product") : String(t || "").toLowerCase() === "product";
      }) || {};
      const offers = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
      const images = [];

      const addImage = v => {
        if (!v) return;
        const u = abs(v);
        if (u) images.push(u);
      };
      const ldImages = Array.isArray(product.image) ? product.image : [product.image];
      ldImages.forEach(addImage);

      document.querySelectorAll("img").forEach(img => {
        ["data-large_image","data-large-image","data-full","data-zoom-image","data-src","data-lazy-src","data-original","src"].forEach(n => addImage(img.getAttribute(n)));
        const srcset = attr(img, ["data-srcset","srcset"]);
        if (srcset) srcset.split(",").forEach(x => addImage(x.trim().split(/\s+/)[0]));
      });
      document.querySelectorAll("a").forEach(a => {
        const href = attr(a, ["data-large_image","data-full","data-zoom-image","href"]);
        if (href && /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(href)) addImage(href);
      });

      const bad = /(?:logo|icon|avatar|payment|sprite|placeholder|loader|spinner|favicon|gravatar)/i;
      const uniqueImages = [...new Set(images)]
        .filter(u => !bad.test(u))
        .filter(u => !/[?&](?:resize|w|width)=?(?:64|32|48)(?:[&]|$)/i.test(u))
        .slice(0, 30);

      const specs = {};
      const put = (k,v) => {
        k = clean(k).replace(/[:：]+$/,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
        v = clean(v);
        if (k && v && !specs[k]) specs[k] = v;
      };
      document.querySelectorAll("table tr").forEach(row => {
        const cells = [...row.querySelectorAll("th,td")].map(x=>clean(x.textContent)).filter(Boolean);
        if (cells.length >= 2) put(cells[0], cells.slice(1).join(" | "));
      });
      document.querySelectorAll("dl").forEach(dl => {
        [...dl.querySelectorAll(":scope > dt")].forEach(dt => {
          let v = "", n = dt.nextElementSibling;
          while (n && n.tagName !== "DT") { if (n.tagName === "DD") v = clean(n.textContent); n = n.nextElementSibling; }
          put(dt.textContent, v);
        });
      });
      document.querySelectorAll(".woocommerce-product-attributes-item,.product-attribute,.attribute-row,.spec-row,.spec-item,.specification-row,.product-specification,.product-info-row,.detail-row").forEach(row => {
        const cells = [...row.querySelectorAll("th,td,.label,.name,.title,.key,.attribute-label,.spec-label,.value,.attribute-value,.spec-value")]
          .map(x=>clean(x.textContent)).filter(Boolean);
        if (cells.length >= 2) put(cells[0], cells.slice(1).join(" | "));
      });

      const meta = p => first(['meta[property="'+p+'"]','meta[name="'+p+'"]']);
      const name = clean(product.name) || meta("og:title") || first(["h1",".product_title",".product-title",".product-name"]);
      const description = clean(product.description) || meta("og:description") || first([".woocommerce-product-details__short-description",".product-description",".description"]);
      const price = clean(offers.price) || meta("product:price:amount") || first([".price ins .amount",".price .amount",".price",".product-price",".special-price"]);
      const brand = clean(product.brand && (product.brand.name || product.brand)) || first([".brand",".brand-name",".product-brand",".manufacturer","[itemprop='brand']"]);
      const sku = clean(product.sku) || first([".sku",".product-sku",".product-code","[itemprop='sku']"]);
      const availability = clean(offers.availability).split("/").pop() || first([".stock",".availability",".stock-status",".in-stock",".out-of-stock"]);
      const breadcrumbs = first([".breadcrumbs",".breadcrumb",".product-breadcrumb","[aria-label='breadcrumb']"]);

      return { name, description, price, currency: clean(offers.priceCurrency) || meta("product:price:currency"), brand, sku, availability, breadcrumbs, specs, images: uniqueImages };
    });
  }
}
module.exports = ProductExtractor;
