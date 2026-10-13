# AGENTS.md — Techistics scraper source of truth

This file is the durable project contract. Read it before changing scraper behavior. The user has explicitly asked to keep the repository consolidated: **do not create more branches**. Work on the repository's existing default branch, `main` (the GitHub repo currently calls it `main`, not `master`). Do not open new PRs or create alternate implementations unless the user explicitly asks. Preserve previous work and inspect existing code before replacing anything.

## Goal and scope

Enrich the Techistics WooCommerce export with competitor product images, descriptions, and technical specifications. The export may contain around 3,000 products, but only the subset whose **original WooCommerce Images field is empty or an explicit no-image placeholder** is eligible for the main scraping queue. Do not scrape all products by default. The active source list excludes techlad.pk while it is down and includes MHK Tech Zone (`mhktechzone.com`) as a replacement source.

A populated original `Images` field — including Techistics-hosted WordPress media URLs or multiple URLs — is a hard exclusion from both normal enrichment and audit-triggered re-scraping. Do not bypass this rule just because a product is missing specs or a description. The original export is authoritative for eligibility; locally downloaded competitor images do not change it.

Never write scraped data back into the original catalogue automatically. Outputs are review artifacts for later import.

## Required fields and quality rules

For each eligible image-missing product, attempt to collect:
- A valid matching competitor product page and source URL.
- Product images (up to the configured cap), deduplicated by normalized URL and exact file hash.
- A product description and a separate short description when available.
- Technical specifications. Specs are a required field, not optional metadata.

Extract specs from JSON-LD, product attributes, HTML tables, definition lists, labelled rows, lists, accordion/tab content, and sections labelled Specifications, Technical Details, Product Details, or Features. Also recognize specs embedded in WooCommerce description and short-description fields when auditing the original export. A result with zero extracted specs must not be called fully successful: mark it `PARTIAL` and queue it for review/retry.

Preserve useful existing values. Do not replace a populated description with a worse/shorter one without a clear quality reason.

## Matching and rejection policy

Current primary retailer sources include czone.com.pk, pclab.pk, tech.com.pk, zahcomputers.pk, techmatched.pk, zestrogaming.com, and mhktechzone.com. Do not re-add techlad.pk unless the user confirms it is back online and it has been checked in a small test.

MHK Tech Zone was verified through indexed live pages to use WooCommerce-style `/product/` and `/product-category/` URLs. The scraper uses its `/?s=...&post_type=product` search endpoint. Its selectors still require a small live scrape validation before large batches.

Never accept a result simply because a search returned a URL. Validate the actual product-page title/name against the Techistics product name. Reject generic category/shop pages and mismatches in model number, capacity, RAM size, GPU/CPU identifiers, or other critical model tokens. Generic words such as “computer”, “gaming”, “memory”, “graphics”, and color names should not dominate matching.

Do not silently swallow site failures or silently discard candidate products. The search audit must record:
- Each retailer/search engine actually checked and the query used.
- Search URL and timestamp.
- Candidate title/name, URL, and score for plausible results.
- Whether a candidate was accepted, rejected, or considered a close match, plus the reason.
- Navigation/search errors.
- The final product-page title validation decision.

Do not claim a site was checked if the scraper did not actually request it. Early stopping is acceptable only when the existing confidence policy allows it; the report should show exactly what was checked before stopping.

## Auditing and retry workflow

From `scraper/`:

- `npm run audit` — runs both local exact-image duplicate/missing-file audit and product-quality audit. Read-only; it does not contact retailer sites, delete images, or alter enrichment results.
- `npm run audit:images` — hashes local image files and reports exact duplicate groups in `output/image_audit.csv`.
- `npm run audit:products` — checks only products missing images in the original export. It audits source product-name similarity, specs, description, image references, missing local image files, duplicate references, and non-descriptive legacy image filenames. It writes `output/product_quality_audit.csv` and `output/rescrape_queue.csv`.
- `npm run enrich:fields` — retries missing description/specification fields from saved matched source URLs; supports `--retry-description`, `--retry-specs`, and `--retry-all`.
- `npm run rescrape:audit` — re-runs the normal matcher for products in `output/rescrape_queue.csv`. It still rechecks the original export and cannot select a product with a populated original Images field.

Use a small batch for any network scraping. PowerShell example:

```powershell
$env:ENRICH_LIMIT="10"
npm run enrich
```

After inspecting the quality report, retry only the queued eligible products:

```powershell
$env:ENRICH_LIMIT="10"
npm run rescrape:audit
```

If the queue is larger, repeat with appropriate batch sizes. The queue is generated by `npm run audit`; re-run audit after each retry batch to refresh it. Never run the entire queue without first checking the counts and results.

## Image handling and cleanup safety

- New image names should be descriptive, filesystem-safe product-name slugs, with a stable product ID where available and deterministic gallery suffixes.
- Preserve image URL paths and query parameters as provided by the retailer. Do not strip WordPress thumbnail suffixes such as `-300x300`; some stores expose only the derivative URL and rewriting it can cause HTTP 404.
- Prefer product-gallery images over page-wide image scans so retailer logos, favicons, and UI icons do not enter the product image list.
- Deduplicate exact file bytes safely; do not assume different image hashes mean images are visually different.
- `npm run cleanup:images` is preview-only and writes `output/image_cleanup_plan.csv` and `output/image_cleanup_plan.json`.
- Never apply cleanup until the preview is reviewed. Applying requires both `--apply` and `--confirm=YES`; it backs up changed output files and moves duplicates to `data/images/.duplicate-quarantine/` rather than permanently deleting them.
- Do not make live website changes. The scraper must not upload, edit, or delete products/images on Techistics.

## Outputs and reports

- `output/product_image_inventory.csv`, `image_present.csv`, `image_missing.csv`, and `product_image_inventory.json`: full inventory classification. Image-present rows are classification-only.
- `output/product_enrichment_status.csv` and `product_enrichment_status.json`: master status tracking for eligible image-missing products.
- `output/matched.csv`, `partial.csv`, `multiple_matches.csv`, `no_match.csv`, `error.csv`, `pending.csv`, `skipped.csv`: status buckets.
- `output/enriched_products.csv`, `enriched_products.json`, and `enriched_products_woocommerce.csv`: detailed and review/import-shaped outputs.
- `output/search_audit.csv`: timestamped search trace showing sites/engines, queries, candidate names/URLs, scores, rejected close matches, errors, and product-page title validation.
- `output/image_audit.csv`: local exact-duplicate report.
- `output/product_quality_audit.csv`: name/field/image quality audit for eligible products.
- `output/rescrape_queue.csv`: products needing another pass, still subject to the original missing-image eligibility gate.
- `output/field_enrichment_status.csv`: independent description/spec retry status.
- `output/image_cleanup_plan.csv/json`, `cleanup_backups/`, and `cleanup_manifest.json`: cleanup preview, backups, and quarantine record.

Do not commit generated reports, product exports, downloaded product images, or other user data unless explicitly requested.

## Reliability and test requirements

- Preserve checkpoints so interruptions do not lose completed products.
- Products with `PARTIAL`, `NO_MATCH`, or `ERROR` must remain retryable. `MATCHED` can be retried through the explicit audit queue or by setting `ENRICH_FORCE_NAMES` to exact product names separated by `|` when a manual quality review finds bad images. The original-export missing-image gate still applies.
- Do not mark a product as complete when specs, description, or images are missing.
- Run syntax checks for changed JavaScript and parse `package.json` before reporting success. Do not claim live scraping or local output audits were run unless they were actually executed against the user's local files.
- Before changing a file, fetch/read its current contents and preserve unrelated work. Never overwrite a whole script with a simplified replacement to fix one issue.
- Keep the primary implementation in `scraper/src/enrich_new_products.js`; avoid reintroducing the older generic `src/index.js` workflow as the solution for this dedicated enrichment task.
- Keep documentation in sync with actual scripts and command names. If a command's behavior changes, update this file in the same work.
