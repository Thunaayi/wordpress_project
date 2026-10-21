# Techistics Product Capture (Chrome / Edge)

A small Manifest V3 extension for manually collecting computer-hardware product pages into one ZIP per product.

## Install

1. Open the repository folder `tools/techistics-product-capture` locally, or download this directory from GitHub.
2. In Chrome open `chrome://extensions` (Edge: `edge://extensions`).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this directory (the one containing `manifest.json`).
5. Open a retailer product page and click the extension.

## Workflow

1. Click **Scan current page**.
2. Review and correct name, brand, SKU/model, price, currency, description, and specs.
3. Uncheck unrelated images from the listed product gallery candidates.
4. Click **Save product ZIP** and choose where Chrome should save it.

The ZIP contains a product-specific folder with `product.json`, `product.txt`, `capture-log.json`, and an `images/` folder. Chrome downloads one ZIP per product to avoid creating a flat pile of HTML and image files.

## Extraction rules and limitations

- Tries Product JSON-LD first for name, SKU, brand, offers, description, and additionalProperty specs.
- Supports common WooCommerce price selectors and product attribute/specification tables.
- Searches for images inside a product gallery or primary product detail container, not the whole page. Recommended/related/upsell sections are excluded.
- Extraction varies by retailer. A site can render specifications in custom components or omit them from the page source. Missing price/specs are surfaced; if either is missing, the extension asks before saving.
- Image URLs can be blocked from cross-origin downloads, expire, or require cookies. Failures are recorded in `capture-log.json`.
- Image candidates are heuristically selected; manually inspect them. This extension does not reliably identify the pictured product's color or distinguish every front/hero photo from connector-detail photos.
- This extension does not upload to WooCommerce, modify Techistics inventory, or auto-mark products as complete.

## Permissions

- `activeTab` and `scripting`: inspect the active page only after the user clicks scan.
- `downloads`: download the user-requested ZIP.
- `<all_urls>` host permission: retrieve selected product image URLs from retailer/CDN hosts. It does not send product data to a server.

## Troubleshooting

- If no images appear, reload the retailer page and scan again. If that retailer does not expose a gallery in recognizable markup, a site-specific extractor is needed.
- If price/specifications are blank, do not assume capture is complete. Fill them in manually or ask for that retailer to be supported specifically.
- If an image download fails, check `capture-log.json`; the ZIP is still useful for the captured metadata and successful images.
