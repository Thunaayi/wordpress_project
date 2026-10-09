# AGENTS.md

## Techistics scraper workflow

The repository contains a WordPress/WooCommerce catalogue and a competitor enrichment scraper under scraper/.

### Product enrichment goal

The inventory may contain thousands of products. The enrichment job MUST ONLY scrape products whose WooCommerce Images field is empty or contains an explicit no-image placeholder. Any populated image field—including a Techistics WordPress media URL or multiple image URLs—means the product already has an image and MUST be excluded from scraping, even if its specifications or description are missing. There is no all-products override. Products without images are the new-product enrichment queue; collect competitor product images, specifications, and description for those products. The missing-specification check must inspect WooCommerce attribute name/value pairs AND structured specifications embedded in product descriptions or short descriptions (tables, definition lists, labelled spec bullets, and technical feature lists).

The scraper must not silently drop products that cannot be matched.

### Status tracking

Enrichment status reports should contain only products without existing images. Separately create a full inventory classification so the user can distinguish image-present from image-missing products without scraping the image-present group. Never add an image-present product to the enrichment queue.

Statuses:
- MATCHED — sufficiently confident competitor match.
- PARTIAL — product page found, but requested fields are missing or need review.
- MULTIPLE_MATCHES — reserved for multiple plausible retailer matches requiring review.
- NO_MATCH — no sufficiently confident competitor match.
- ERROR — processing failed unexpectedly.
- PENDING — selected for enrichment but not processed in the current run.
- SKIPPED — intentionally not processed, normally because the product is already complete.

The status CSV should support filtering by category, retailer, match score, image count, and specification count. Image presence is the hard eligibility gate: no product with an existing image may be selected.

Progress must persist across runs. A previously enriched product with status MATCHED or SKIPPED must not be reprocessed on the next run. PARTIAL, NO_MATCH, and ERROR products remain retryable. Batch limits and interruptions must not lose completed results.

### Output files

- output/product_image_inventory.csv — classification of the full inventory into HAS_IMAGE and MISSING_IMAGE, including current image URL, specs presence, and description presence.
- output/image_present.csv — image-present products; classification only, never scraped.
- output/image_missing.csv — image-missing products eligible for enrichment.
- output/product_image_inventory.json — machine-readable full inventory classification.
- output/product_enrichment_status.csv — master tracking report for image-missing products only.
- output/product_enrichment_status.json — machine-readable master report.
- output/matched.csv, partial.csv, multiple_matches.csv, no_match.csv, error.csv, pending.csv, skipped.csv — review buckets.
- output/enriched_products.csv — detailed enrichment data.
- output/enriched_products.json — detailed JSON results.
- output/enriched_products_woocommerce.csv — matched products formatted for later WooCommerce import.
- data/images/ — downloaded product images. Image files should use descriptive, filesystem-safe product-name slugs (plus a stable product ID when available), not opaque names such as product_12313.jpg. Multiple images for one product should use a deterministic suffix such as -1, -2, etc.

Do not overwrite the original Techistics catalogue as part of enrichment.

### Specification extraction

Specifications are a required enrichment field. Do not assume specifications use one WooCommerce selector. Support HTML tables, definition lists (dt/dd), WooCommerce attribute rows, generic label/value rows, specification list items, accordion/tab content, specification sections following headings such as Specifications, Technical Details, Product Details, and Features, and JSON-LD when available.

A matched product with zero extracted specifications should normally be classified as PARTIAL, not treated as a fully successful enrichment.

### Matching

Never accept a weak match merely because a search result exists. Validate the candidate product page title/name against the Techistics product name and reject obvious capacity, RAM, or model mismatches.

Prefer model numbers, capacities, RAM sizes, GPU/CPU identifiers, and other product-specific tokens over generic words such as computer, graphics, memory, or gaming.

### Running

From scraper/:

    npm install
    npm run enrich

For a small test:

    $env:ENRICH_LIMIT="20"; npm run enrich

For a later batch:

    $env:ENRICH_START="20"; $env:ENRICH_LIMIT="20"; npm run enrich

Do not start a full image-missing queue run until a small test confirms the target count equals the number of rows with no image URL, and confirms that no product with a Techistics WordPress image URL is scraped.

### Important

The dedicated enrichment runner is the preferred workflow for the new Techistics inventory enrichment task. Do not reintroduce the older fragile generic scraper logic merely to solve enrichment.
