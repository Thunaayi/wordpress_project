# Techistics Product Scraper

The primary workflow enriches **only products with no image in the original WooCommerce export**. It does not upload or modify products on Techistics.

## Install

Run in this directory:

```powershell
npm install
npm test
```

Set a small batch limit before any scrape:

```powershell
$env:ENRICH_LIMIT="10"
npm run enrich
```

The source of truth for the eligibility rule and project constraints is the repository-root `AGENTS.md`. Read it before changing scraper behavior.

## Recommended workflow

1. Run a small enrichment batch with `ENRICH_LIMIT` set.
2. Inspect `output/product_enrichment_status.csv`, `output/enriched_products.csv`, and the downloaded images.
3. Run `npm run audit` to audit exact duplicate local image files and product quality.
4. Inspect `output/product_quality_audit.csv`, `output/image_audit.csv`, and `output/rescrape_queue.csv`.
5. If a retry is warranted, set a small limit and run `npm run rescrape:audit`.
6. Re-run `npm run audit` after the retry to refresh reports.

## Commands

| Command | Behavior |
| --- | --- |
| `npm run enrich` | Search competitor retailers and enrich eligible products missing images in the original export. Requires `ENRICH_LIMIT`, `--limit=N`, or the explicitly configured unlimited mode. |
| `npm run enrich:fields` | Retry missing description/spec fields from a saved matched source URL. |
| `npm run audit` | Run both local image audit and product quality audit; no network scraping or file cleanup. |
| `npm run audit:images` | Hash local images and report exact byte-for-byte duplicates. |
| `npm run audit:products` | Audit source-name match, images, description, and specs for original image-missing products. |
| `npm run rescrape:audit` | Re-run the matcher for rows in `output/rescrape_queue.csv`; original inventory eligibility is rechecked. |
| `npm run cleanup:images` | Preview an exact-duplicate cleanup plan. Preview-only by default. |
| `npm test` | Run syntax checks across scraper modules. |

For audit-triggered retries, generate the queue first:

```powershell
npm run audit
$env:ENRICH_LIMIT="10"
npm run rescrape:audit
```

The retry runner will not scrape a product if the original export has any populated Images field, even if that product appears in another output file.

## Important output files

- `output/search_audit.csv`: actual retailer/search-engine checks, query, candidate names/URLs/scores, close-match rejections, navigation errors, and final product-page title validation.
- `output/product_quality_audit.csv`: quality check results for image-missing products.
- `output/rescrape_queue.csv`: retry candidates and reasons.
- `output/image_audit.csv`: local exact duplicate groups and hashes.
- `output/image_cleanup_plan.csv/json`: preview plan for duplicate quarantine.
- `output/enriched_products.json`: checkpointed enrichment results.
- `output/product_enrichment_status.csv`: filterable status summary.

The search trace is append-only across runs. Filter by product ID and timestamp to inspect what was checked for one product.

## Cleanup warning

Do not apply image cleanup until the plan is reviewed. Applying requires both `--apply` and `--confirm=YES`; redundant files are moved to quarantine, not permanently deleted. Cleanup only touches local files and local output references.

Never commit the original product export, generated product reports, or downloaded product images unless explicitly requested.
