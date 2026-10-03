const { URL } = require("url");

/**
 * Site-agnostic product extraction.
 *
 * Priority:
 * 1. JSON-LD Product data
 * 2. OpenGraph/meta data
 * 3. visible HTML selectors
 * 4. generic spec tables / definition lists / key-value rows
 *
 * The goal is to survive WooCommerce themes and custom ecommerce layouts
 * without depending on one site's CSS class names.
 */
class ProductExtractor {
  static async extract(page) {
    return page.evaluate(() => {
      const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const first = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const value = clean(el.getAttribute("content") || el.textContent);
            if (value) return value;
          }
        }
        return "";
      };
      const attr = (el, names) => {
        for (const name of names) {
          const value = el.getAttribute(name);
          if (value) return value;
        }
        return "";
      };
      const absolute = (value) => {
        if (!value) return "";
        try { return new URL(value, location.href).href; } catch { return ""; }
      };
      const normalizeKey = (key) => clean(key)
        .toLowerCase()
        .replace(/[:：]+$/, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

      const jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
        try {
          const parsed = JSON.parse(script.textContent);
          const add = (item) => {
            if (!item) return;
            if (Array.isArray(item)) item.forEach(add);
            else if (item["@graph"]) item["@graph"].forEach(add);
            else jsonLd.push(item);
          };
          add(parsed);
        } catch {}
      });

      const productLd = jsonLd.find((x) =>
        String(x["@type"] || "").toLowerCase() === "product"
      ) || {};

      const offers = Array.isArray(productLd.offers) ? productLd.offers[0] : (productLd.offers || {});
      const imageLd = Array.isArray(productLd.image) ? productLd.image : [productLd.image];

      const meta = (property) => first([
        'meta[property="' + property + '"]',
        'meta[name="' + property + '"]'
      ]);

      const name = clean(productLd.name) ||
        meta("og:title") ||
        first(["h1", ".product_title", ".product-title", ".product-name"]);

      const description = clean(productLd.description) ||
        meta("og:description") ||
        first([".woocommerce-product-details__short-description", ".product-description", ".description", ".product-details"]);

      const price = clean(offers.price) ||
        meta("product:price:amount") ||
        first([".price ins .amount", ".price .amount", ".price", ".product-price", ".special-price"]);

      const currency = clean(offers.priceCurrency) || meta("product:price:currency");

      const images = [];
      imageLd.forEach((image) => {
        if (typeof image === "string") images.push(absolute(image));
      });
      document.querySelectorAll("img").forEach((img) => {
        const value = attr(img, [
          "data-large_image", "data-large-image", "data-full", "data-zoom-image",
          "data-src", "data-lazy-src", "data-original", "src"
        ]);
        if (value) images.push(absolute(value));
        const srcset = attr(img, ["data-srcset", "srcset"]);
        if (srcset) {
          srcset.split(",").forEach((part) => images.push(absolute(part.trim().split(/\\s+/)[0])));
        }
      });

      const badImage = (url) => /(?:logo|icon|avatar|payment|sprite|placeholder|loader|spinner|favicon)/i.test(url);
      const uniqueImages = [...new Set(images.filter(Boolean))]
        .filter((url) => !badImage(url))
        .slice(0, 20);

      const specs = {};
      const put = (key, value) => {
        key = normalizeKey(key);
        value = clean(value);
        if (!key || !value || key.length > 80) return;
        if (!specs[key]) specs[key] = value;
      };

      document.querySelectorAll("table").forEach((table) => {
        table.querySelectorAll("tr").forEach((row) => {
          const cells = [...row.querySelectorAll("th,td")].map((x) => clean(x.textContent)).filter(Boolean);
          if (cells.length >= 2) put(cells[0], cells.slice(1).join(" | "));
        });
      });

      document.querySelectorAll("dl").forEach((dl) => {
        const dts = [...dl.querySelectorAll(":scope > dt")];
        dts.forEach((dt) => {
          let value = "";
          let node = dt.nextElementSibling;
          while (node && node.tagName !== "DT") {
            if (node.tagName === "DD") value = clean(node.textContent);
            node = node.nextElementSibling;
          }
          put(dt.textContent, value);
        });
      });

      const rowSelectors = [
        ".woocommerce-product-attributes-item",
        ".product-attribute", ".attribute-row", ".spec-row", ".spec-item",
        ".specification-row", ".product-specification", ".product-info-row",
        ".attribute", ".detail-row"
      ];
      document.querySelectorAll(rowSelectors.join(",")).forEach((row) => {
        const parts = [...row.querySelectorAll("th,td,.label,.name,.title,.key,.attribute-label,.spec-label,.value,.attribute-value,.spec-value")]
          .map((x) => clean(x.textContent)).filter(Boolean);
        if (parts.length >= 2) put(parts[0], parts.slice(1).join(" | "));
      });

      const brand = clean(productLd.brand && (productLd.brand.name || productLd.brand)) ||
        first([".brand", ".brand-name", ".product-brand", ".manufacturer", "[itemprop='brand']"]);
      const sku = clean(productLd.sku) ||
        first([".sku", ".product-sku", ".product-code", "[itemprop='sku']"]);
      const availability = clean(offers.availability).split("/").pop() ||
        first([".stock", ".availability", ".stock-status", ".in-stock", ".out-of-stock"]);
      const breadcrumbs = first([".breadcrumbs", ".breadcrumb", ".product-breadcrumb", "[aria-label='breadcrumb']"]);

      return {
        name,
        description,
        price,
        currency,
        brand,
        sku,
        availability,
        breadcrumbs,
        specs,
        images: uniqueImages
      };
    });
  }
}

module.exports = ProductExtractor;
