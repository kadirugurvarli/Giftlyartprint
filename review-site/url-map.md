# Current URL to new page map (migration planning only)

The site now has 8 main pages plus 19 product landing pages (`product-*.html`). Product pages are listed at the end of this file.

Built from the handles listed in the Shopify admin (read-only). No redirects have been set up and the live theme is untouched. Existing paths are shown without the domain `https://www.giftlyartprint.co.uk`.

| Current URL(s) | New page | Notes |
|---|---|---|
| `/` , `/pages/home` | `index.html` | |
| `/pages/turn-your-photo-into-a-fine-art-print`, `/pages/upload-your-photo`, `/pages/custom-print-order`, `/pages/prints`, `/collections/prints`, `/collections/prints-1`, `/products/permajet-platinum-gloss-metallic-paper-300gsm`, `/pages/art-gallery`, `/pages/art-gallery-1` | `photo-fine-art-prints.html` | Art gallery pages: decision needed (see below) |
| `/pages/framed-prints`, `/pages/frames`, `/pages/photo-mounting`, `/pages/desk-frame`, `/collections/framed-prints`, `/collections/framed-prints-1`, `/collections/framed-prints-2`, `/collections/unframed-wall-art`, `/collections/frameless*`, `/collections/framed-magnetic-prints`, `/collections/magnetic-photo-sets`, `/collections/wall-display-gifts`, `/products/framed-fine-art-print-*`, `/products/framed-fine-art-print-oak-wood-frame`, `/products/hahnemuhle-fine-art-print-copy-1`, `/products/magnetic-wooden-framed-print`, `/products/magnetic-poster-hanger`, `/products/magnetic-dibond-print`, `/products/print-on-kapa-fix-foam-board`, `/products/dibond-print-3mm-aluminium-composite-wall-art-uk`, `/products/dibond-print-fine-art-wall-print-snappytack`, `/products/print-on-dibond` (archived), `/pages/professional-printing-framing-for-artists-and-creators` | `framing-display.html` | Two live Dibond listings and one archived: keep one |
| `/pages/book-an-appointment`, `/products/iris-photography-gift-voucher`, `/products/iris-*-gift-voucher`, `/products/mini-framed-iris-gift-voucher`, `/products/digital-art-hd-gift-voucher` | `iris-photography.html` | Voucher products stay as shop products until order links are checked |
| (none found) | `business-printing.html` | New content, no source page or product |
| `/products/photo-restoration-order` | `photo-restoration.html` | |
| `/pages/gift`, `/pages/gifts`, `/pages/gift-guide`, `/pages/gift-packaging`, `/pages/add-a-message`, `/pages/desk-decor-page-template`, `/collections/gifts`, `/collections/personalised-gifts`, `/collections/personalised-photo-gifts`, `/collections/desk-decor*`, `/collections/desk-display-gifts`, `/collections/collage-prints`, `/collections/templates`, `/products/magnetic-acrylic-block`, `/products/personalised-wedding-collage-print-1`, `/products/personalised-newborn-collage-print-custom-baby-photo-artwork` | `personalised-gifts.html` | |
| `/pages/contact`, `/pages/contact-1`, `/pages/contact-giftly-art-print`, `/pages/about-me`, `/pages/about-giftly-art-print`, `/pages/faq` | `contact-visit.html` | About and FAQ content has no home yet: decision needed |
| `/pages/shipping-policy`, `/pages/returns-refund-policy`, `/pages/return-terms-and-conditions`, `/pages/privacy-policy` | stay on Shopify | Policies are not part of the eight pages |

## Decisions needed (no page in the new plan)

- **Gallery and art print products** (London, Istanbul, wildlife, horses, coastal: about 100 items at &pound;10 listing, including `/collections/london-bw`, `/collections/istanbul-wall-art`, `/collections/botanical`, `/collections/horses`, `/collections/coastal`, `/collections/birds`, `/collections/british-wildlife-landscapes`): keep as a shop section, retire or noindex.
- **Personalised portraits** (watercolour, pencil, line art, floral, map art): outside the curated gifts range. Keep, move or retire.
- **Canvas print** (`/products/canvas-print`, active; the stretched 20mm version is archived): not in the brief.
- **ID & passport photos**, `/pages/art-gallery*`, `/collections/apparel`: not covered by the eight pages.
- **Duplicate-looking handles:** `.../upload-your-photo-copy`, `/products/hahnemuhle-fine-art-print-copy-1` and similar `-copy` handles should be renamed when URLs move.

## Product landing pages

| New page | Current Shopify source | Notes |
|---|---|---|
| `product-economy-framed-print.html` | `/products/framed-fine-art-print-black-wood-frame-upload-your-photo`, `...-copy` (white), `/products/framed-fine-art-print-oak-wood-frame` | Three listings become one page |
| `product-removable-poster.html` | none | No product or price yet |
| `product-snappytack-magnetic-frame.html` | `/products/magnetic-wooden-framed-print` | |
| `product-magnetic-poster-hanger.html` | `/products/magnetic-poster-hanger` | |
| `product-dibond-print.html` | `/products/dibond-print-3mm-aluminium-composite-wall-art-uk`, `/products/dibond-print-fine-art-wall-print-snappytack`, `/products/magnetic-dibond-print`, `/products/print-on-dibond` (archived) | Keep one Dibond listing |
| `product-foamex-board-print.html` | none | No product or price yet |
| `product-kapa-fix-foam-board.html` | `/products/print-on-kapa-fix-foam-board` | |
| `product-framed-fine-art-print.html` | `/products/hahnemuhle-fine-art-print-copy-1` | |
| `product-shirt-frame.html`, `product-plate-and-object-frame.html`, `product-l-floating-frame.html` | none | Quoted jobs |
| `product-acrylic-photo-block.html` | `/products/magnetic-acrylic-block` | |
| `product-photo-collage-prints.html` | `/products/personalised-wedding-collage-print-1`, `/products/personalised-newborn-collage-print-custom-baby-photo-artwork` | |
| `product-iris-gift-vouchers.html` | `/products/iris-photography-gift-voucher` and the other `iris-*` and `digital-art-hd` vouchers | |
| `product-flyers-and-leaflets.html`, `product-business-cards.html`, `product-menus-and-price-lists.html`, `product-posters-and-a-boards.html`, `product-vinyl-printing.html` | none | New services, all prices to be confirmed |
