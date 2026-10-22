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

A product marked `NO_MATCH` is remembered in `output/enriched_products.json` and is skipped by future normal `npm run enrich` runs. It will not repeatedly hit the same retailers.

To revisit previously unresolved products, use the dedicated command below. It reads `output/search_audit.csv` and searches only currently configured retailers that have **never been checked for that product**:

```powershell
$env:ENRICH_LIMIT="10"
npm run retry:unfound
Remove-Item Env:ENRICH_LIMIT
```

This command only retries products already marked `NO_MATCH`. It deliberately does not use Google/Bing as a fallback because those could rediscover the same exhausted retailers. If no new retailers have been added since the last search, it reports that no new sources remain and does not repeat those searches. Add a genuinely new source to the source list first, then run `npm run retry:unfound` again. Keep `output/enriched_products.json` and `output/search_audit.csv` between runs; they are the persistent checkpoint and tried-site ledger.

To deliberately retry specific products that were already marked MATCHED (for example, if their downloaded photos are broken), use normalized exact product names separated by `|`:

```powershell
$env:ENRICH_LIMIT="2"
$env:ENRICH_FORCE_NAMES="Logitech M331 Silent Plus Wireless Mouse|Logitech M240 Silent Wireless Mouse"
npm run enrich
Remove-Item Env:ENRICH_FORCE_NAMES
```

The retry still obeys the original-export rule: products with any populated `Images` field are excluded. Check the generated image files before using them. The downloader preserves retailer image URLs instead of rewriting thumbnail URLs, and the extractor prioritizes WooCommerce/product-gallery images to reduce 404s and site-icon contamination.

## Manual completion folder

Put any images for products you have already handled in `scraper/data/images/done/`. The scraper recursively checks this folder and matches image filenames against product IDs, SKUs, or full product-name slugs. Matching products are excluded from normal enrichment and the audit retry queue, and show as `DONE_FOLDER` / `SKIPPED` in generated inventory/status reports.

To deliberately re-scrape only products marked in that folder:

```powershell
npm run enrich -- --retry-done --limit=10
```

To let normal/audit runs consider done-folder products again, pass `--include-done`. Explicit `ENRICH_FORCE_NAMES` remains available for specific named products. The original export's populated-Images safety rule still applies to every mode. Do not commit the contents of `data/images/done/`.

The source of truth for the eligibility rule and project constraints is the repository-root `AGENTS.md`. Read it before changing scraper behavior.

**Active retailer sources:** Czone, PCLab, Tech.com.pk, ZAH Computers, TechMatched, Zestro Gaming, and MHK Tech Zone. Techlad.pk has been removed while it is down. MHK Tech Zone uses WooCommerce-style product URLs; validate its selectors with a small batch before relying on it at scale.

## Recommended workflow

1. Run a small enrichment batch with `ENRICH_LIMIT` set.
2. Inspect `output/product_enrichment_status.csv`, `output/enriched_products.csv`, and the downloaded images.
3. Run `npm run audit` to audit exact duplicate local image files and product quality.
4. For TechMatched-specific image issues, run `npm run audit:techmatched-images`; inspect `output/techmatched_image_audit.csv` before any refresh.
5. If TechMatched images are poor, run `npm run rescrape:techmatched-images -- --limit=5` first. It refreshes only products whose saved match source is TechMatched and which are still eligible under the original export's empty-Images rule. Old files and previous image references are retained in the JSON backup field.
6. Inspect `output/product_quality_audit.csv`, `output/image_audit.csv`, `output/techmatched_image_audit.csv`, and `output/rescrape_queue.csv`.
7. If a general retry is warranted, set a small limit and run `npm run rescrape:audit`.
8. Re-run the audits after any retry to refresh reports.

## Commands

| Command | Behavior |
| --- | --- |
| `npm run enrich` | Search competitor retailers and enrich eligible products missing images in the original export, skipping products identified by `data/images/done/`. Requires `ENRICH_LIMIT`, `--limit=N`, or the explicitly configured unlimited mode. |
| `npm run enrich -- --retry-done --limit=10` | Explicitly re-scrape products identified by image files in `data/images/done/`. |
| `npm run enrich -- --include-done --limit=10` | Allow done-folder products into the normal eligibility flow; previous status rules still apply. |
| `npm run enrich:fields` | Retry missing description/spec fields from a saved matched source URL. |
| `npm run audit` | Run both local image audit and product quality audit; no network scraping or file cleanup. |
| `npm run audit:images` | Hash local images and report exact byte-for-byte duplicates. |
| `npm run audit:products` | Audit source-name match, images, description, and specs for original image-missing products. |
| `npm run audit:techmatched-images` | Read-only audit of saved TechMatched image references, missing files, dimensions, and exact duplicate hashes. |
| `npm run rescrape:techmatched-images -- --limit=5` | Targeted TechMatched-only image refresh from saved source URLs. Original inventory eligibility is enforced; previous files are retained. Rejects explicit single-color conflicts and exact image bytes already assigned to another TechMatched product. Rejects explicit single-color conflicts and exact image bytes already assigned to another TechMatched product. |
| `npm run rescrape:audit` | Re-run the matcher for rows in `output/rescrape_queue.csv`; original inventory eligibility is rechecked. |
| `npm run retry:unfound` | Retry saved `NO_MATCH` products only on configured retailers not previously checked for that product. |
| `npm run cleanup:images` | Preview an exact-duplicate cleanup plan. Preview-only by default. |
| `npm test` | Run syntax checks across scraper modules. |

For audit-triggered retries, generate the queue first:

```powershell
npm run audit
$env:ENRICH_LIMIT="10"
npm run rescrape:audit
```

The retry runner will not scrape a product if the original export has any populated Images field, even if that product appears in another output file. The TechMatched image rescraper also enforces this eligibility gate, compares new image hashes against active TechMatched product references (not backup quarantine), and records newly accepted hashes during the run so newly refreshed products cannot reuse the same exact image bytes. Explicit color checks are conservative: they reject only a clear single-color mismatch when the candidate's alt text or URL names a different single color. These checks cannot detect every visually wrong image, so review the refreshed audit.

## Important output files

- `output/search_audit.csv`: actual retailer/search-engine checks, query, candidate names/URLs/scores, close-match rejections, navigation errors, and final product-page title validation. The active source list excludes Techlad.pk while it is unavailable and includes MHK Tech Zone.
- `output/product_quality_audit.csv`: quality check results for image-missing products.
- `output/rescrape_queue.csv`: retry candidates and reasons.
- `output/image_audit.csv`: local exact duplicate groups and hashes.\n- `output/techmatched_image_audit.csv`: TechMatched-only image inventory, dimensions, missing files, exact duplicate hashes, and visually similar/resized-image candidates.
- `output/image_cleanup_plan.csv/json`: preview plan for duplicate quarantine.
- `output/enriched_products.json`: checkpointed enrichment results.
- `output/product_enrichment_status.csv`: filterable status summary.

The search trace is append-only across runs. Filter by product ID and timestamp to inspect what was checked for one product.

## Cleanup warning

Do not apply image cleanup until the plan is reviewed. Applying requires both `--apply` and `--confirm=YES`; redundant files are moved to quarantine, not permanently deleted. Cleanup only touches local files and local output references.

Never commit the original product export, generated product reports, or downloaded product images unless explicitly requested.


### TechMatched duplicate-image safeguards

The targeted rescraper compares each downloaded image's SHA-256 against active TechMatched product image references and against images accepted earlier in the same run. It rejects exact-byte reuse across different products and conservatively rejects a clear single-color mismatch when the candidate alt text or URL names a different single color. The `.duplicate-quarantine` directory is backup-only and is not treated as active ownership or cleaned by this rescraper. These checks cannot identify every visually incorrect image; review `output/techmatched_image_audit.csv` after a small test batch.


## Manual product-image review and repair

Run `npm run images:review` to create `output/image_review_queue.csv`. Open it in a spreadsheet and inspect each product's images. Set `Action` to `COVER` for the one correct primary image, `REMOVE` for a wrong/duplicate reference, or `KEEP` for other valid images. Save the CSV, then run `npm run images:review -- --apply`. The tool backs up `enriched_products.json`, changes only image references/order, and never renames or deletes files. A removed image is unlinked from that product only. Rebuild derived WooCommerce CSVs from the updated JSON before import.

The review queue flags exact-byte duplicates, missing local files, likely detail/port images, and filenames suggesting background/color concerns. Filename heuristics cannot determine the actual pictured color or reliably distinguish white-background from transparent-background images; inspect thumbnails manually. The TechMatched rescraper ranks obvious port/rear-I/O details below likely cover candidates, but ambiguous candidates still need review. Always inspect the first few products after rescraping.
