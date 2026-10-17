# Giftly Art Print: review prototype (8 pages)

A static, noindex review site. It does not touch the live Shopify theme, domain or any configurator.

## Open it
Open `index.html` in a browser. No build step. Folders: `assets/css/site.css`, `assets/js/site.js`, `assets/img/`.
Pages: 8 main pages (`index`, `photo-fine-art-prints`, `framing-display`, `iris-photography`, `business-printing`, `photo-restoration`, `personalised-gifts`, `contact-visit`) plus 19 product landing pages named `product-*.html`.
The pages are generated from `tools/build.py` (content) and `tools/images.py` (image list). Run `python3 -I tools/build.py` after editing.

## Menu and product pages
The global menu has drop-down panels (hover or keyboard focus on desktop, accordion on mobile; Esc closes) listing every product page under Prints, Framing, Iris, Business and Gifts. Each product page follows the same order: the questions customers ask, the problem and our answer, what is included and extra, how it works, a price list, common questions, related products and the enquiry form. Product content lives in `tools/products_data.py`; the template is in `tools/build.py`.

## Recent work
Every page ends with a "Recent work" row (newest job first, arrows, last 4 shown) and links to `recent-work.html` (full list). Entries come from `tools/recent_work.py`. **All six entries are samples** with a visible "Sample entry" tag; replace them with real jobs.

## Shopify
The editable Shopify version (sections, 19 page templates, install steps) is in `../shopify/`. See `../shopify/README.md`.

## Design and images
The look follows the Apple website style: SF system font stack, white and light grey, one blue accent, pill buttons, a slim translucent dark global menu and a full-screen mobile menu.

The 30 images in `assets/img/` are **illustrative images generated for this draft** (OpenAI gpt-image-2, prompts in `tools/gen_images.py`). Each carries the caption "Illustrative image, not a finished Giftly job". They are not Giftly products or customer work. `assets/img/SOURCES.md` lists them. Replace them with real Giftly photographs before launch. Real Iris examples and restoration before/after pictures are still dashed placeholders on purpose, because those must be genuine work.

## Source access: what was and was not read
- **Live site and the prototype link:** neither could be opened from this environment (network blocked). Their page text and the prototype were **not read**.
- **Used instead:** the connected Shopify admin (read-only): product titles, variant prices, image URLs, collections and page handles. Page body text and product descriptions were not read, so technical claims in them were not reviewed.

## Still needed or awaiting approval
- All prices: copied from Shopify listings and marked as such; anything without a source says "To be confirmed" (removable poster, business printing, special presentation, Iris deposit/balance, anniversary and family prints).
- Opening hours, postcode, parking and access (not stated anywhere, so not written).
- Real photos to replace the illustrative images, plus Iris examples (single, couple, family), restoration before and after and the studio front, which are still dashed placeholder boxes.
- Whether framed-print prices include glass (the page assumes no glass, per the brief).
- Paper descriptions, Iris package contents (inferred from voucher options) and voucher contents.
- Order links: none used. Every button goes to WhatsApp or email, because the live shop links could not be tested.

## Contradictions found in the source data
1. Two live Dibond listings with different prices (&pound;45&ndash;175 and &pound;79.99&ndash;164.90) plus an archived third.
2. Magnetic wooden frame: oak is &pound;49 at every size, black rises to &pound;74.
3. Restoration listing: one fixed price per format, but inspection-first is the policy; same digital price for A4 to A2; title claims "Hahnemühle Certified Studio", not repeated here.
4. Permajet paper named "Platinum Gloss Metallic" and "Titanium Gloss" in different places.
5. Product "Black Horse in Winter Forest" is priced &pound;0; several titles are truncated ("arn Owl", "ed Kite", "ingfisher"); SnappyTack products sit in the Giftly store.
6. No Foamex listing and no business printing products exist.

## URL mapping
See `url-map.md`.

## Checked
- 8 pages build; every local link and anchor resolves; one `<h1>` per page; `noindex, nofollow` on all; every `<img>` has alt, width and height.
- Headless Chromium at 360px and 1280px wide: no horizontal overflow on any page .
- Mobile menu opens (button state and visibility), and the WhatsApp/email enquiry link updates from the form fields.

## Not tested
- Layout with real Giftly photographs (the current images are generated); alt text was written for the generated images.
- Real devices, Safari, Firefox, screen reader, full keyboard walk-through (focus styles and skip link are in place; not tested by hand).
- WhatsApp and mailto links on a phone (URLs are well-formed; sending was not attempted).
- Page weight and speed; spelling and British English read-through by the owner.
- No schema/structured data, reviews, ratings, certificates or discounts were created.
