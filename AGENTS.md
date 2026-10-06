# AGENTS.md

## Techistics scraper workflow

The repository contains a WordPress/WooCommerce catalogue and a competitor enrichment scraper under scraper/.

### Product enrichment goal

The inventory may contain thousands of products (currently about 3,014). The enrichment job finds competitor product pages and collects descriptions, specifications, images, matched retailer/source URL, match confidence, and the existing Techistics category.

The scraper must not silently drop products that cannot be matched.

### Status tracking

Every inventory product must appear in scraper/output/product_enrichment_status.csv and scraper/output/product_enrichment_status.json.

Statuses:
- MATCHED — sufficiently confident competitor match.
- PARTIAL — product page found, but requested fields are missing or need review.
- MULTIPLE_MATCHES — reserved for multiple plausible retailer matches requiring review.
- NO_MATCH — no sufficiently confident competitor match.
- ERROR — processing failed unexpectedly.
- PENDING — inventory product not processed in the current run.
- SKIPPED — intentionally not processed, normally because the product is already complete.

The status CSV should support filtering by category, retailer, match score, image count, and specification count.

### Output files

- output/product_enrichment_status.csv — master tracking report for the whole inventory.
- output/product_enrichment_status.json — machine-readable master report.
- output/matched.csv, partial.csv, multiple_matches.csv, no_match.csv, error.csv, pending.csv, skipped.csv — review buckets.
- output/enriched_products.csv — detailed enrichment data.
- output/enriched_products.json — detailed JSON results.
- output/enriched_products_woocommerce.csv — matched products formatted for later WooCommerce import.
- data/images/ — downloaded product images.

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

Do not start a full 3,014-product run until a small test confirms matching, specification extraction, and image downloading are behaving correctly.

### Important

The dedicated enrichment runner is the preferred workflow for the new Techistics inventory enrichment task. Do not reintroduce the older fragile generic scraper logic merely to solve enrichment.
