# Giftly Art Print: review prototype (8 pages)

A static, noindex review site. It does not touch the live Shopify theme, domain or any configurator.

## Open it
Open `index.html` in a browser. No build step. Folders: `assets/css/site.css`, `assets/js/site.js`, `assets/img/`.
Pages: `index`, `photo-fine-art-prints`, `framing-display`, `iris-photography`, `business-printing`, `photo-restoration`, `personalised-gifts`, `contact-visit`.
The pages are generated from `tools/build.py` (content) and `tools/images.py` (image list). Run `python3 -I tools/build.py` after editing.

## Images are NOT included yet
The working environment could not reach `cdn.shopify.com`, so the image files could not be downloaded. Pages reference the correct local filenames with width, height and alt text, so layout space is reserved, but the pictures show as empty boxes until you run:

```
./fetch-assets.sh
```
That downloads each image from the current Giftly shop into `assets/img/`. Sources and types are in `assets/img/SOURCES.md`. Alt text was written from product titles, not by viewing the images; check each one once the files are in.

## Source access: what was and was not read
- **Live site and the prototype link:** neither could be opened from this environment (network blocked). Their page text and the prototype were **not read**.
- **Used instead:** the connected Shopify admin (read-only): product titles, variant prices, image URLs, collections and page handles. Page body text and product descriptions were not read, so technical claims in them were not reviewed.

## Still needed or awaiting approval
- All prices: copied from Shopify listings and marked as such; anything without a source says "To be confirmed" (removable poster, business printing, special presentation, Iris deposit/balance, anniversary and family prints).
- Opening hours, postcode, parking and access (not stated anywhere, so not written).
- Real photos: Iris examples (single, couple, family), restoration before and after, business printing examples, removable poster, shirt/plate/object framing, L / floating frame, studio front. These are dashed placeholder boxes.
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
- Headless Chromium at 360px and 1280px wide: no horizontal overflow on any page (images missing at the time).
- Mobile menu opens (button state and visibility), and the WhatsApp/email enquiry link updates from the form fields.

## Not tested
- Real images (layout with real photos, loading behaviour, alt-text accuracy).
- Real devices, Safari, Firefox, screen reader, full keyboard walk-through (focus styles and skip link are in place; not tested by hand).
- WhatsApp and mailto links on a phone (URLs are well-formed; sending was not attempted).
- Page weight and speed; spelling and British English read-through by the owner.
- No schema/structured data, reviews, ratings, certificates or discounts were created.
