# Product Image Saver (Chrome / Edge)

A minimal extension for collecting images from product pages and other websites. It does not try to extract prices, descriptions, or specifications.

## Install / update

1. Pull the latest `main` branch, or download this folder.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Click **Reload** on this extension. If it was installed using **Load unpacked**, select this directory again if needed.
4. Open a webpage and click the extension, then **Find images on this page**.

## Use

1. Scroll the webpage first so lazy-loaded gallery images appear.
2. Click **Find images on this page**.
3. Enter a filename/folder prefix, such as `Corsair-4000D`.
4. Uncheck unrelated images.
5. Click **Download selected images**.

Images are requested as separate downloads under `Techistics-Images/<prefix>/<prefix>-01.jpg`, `-02.webp`, etc. The file extension is inferred from the image URL. Chrome may add a suffix if a filename already exists.

## Notes

- Scans regular image elements, picture sources, links around images, social preview metadata, and CSS background images.
- Designed to work across websites without retailer-specific selectors. Image ordering follows the page's DOM order; it cannot guarantee that every image is a product photo, so review the checkboxes.
- It uses Chrome's download manager for direct image URLs instead of fetching image bytes inside the extension. Some websites still block direct downloads, require cookies, or use temporary URLs.
- For galleries that load only after scrolling or clicking thumbnails, scroll/click the gallery first and run the scan again.
- It does not download the entire webpage, extract product specs, or modify WooCommerce inventory.
