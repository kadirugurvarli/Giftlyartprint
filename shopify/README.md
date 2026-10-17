# Giftly Art Print: Shopify sections (draft, not installed)

Nothing here has been uploaded to the live theme. These are theme files for a **Dawn-compatible** theme (tested as far as described under "Checked").

## What you get
| File | Purpose |
|---|---|
| `sections/gap-page.liquid` | Flexible page builder. Every page is a stack of blocks you add, remove, reorder and edit in the theme editor. |
| `sections/gap-recent-work.liquid` | "Recent work": the newest job first, a sliding row of the last few, and a full list with "Show more". |
| `templates/page.gap-<product>.json` | 19 ready-filled page templates, one per product page of the review site (text, questions, steps, price tables). |
| `templates/page.gap-recent-work.json` | The archive page ("all recent work"). |
| `metaobject-recent-work.graphql` | Definition for the Recent work list (not run). |

## What can be edited in the theme editor (no code)
- **Text:** every heading, label, paragraph, button, question, step and price row.
- **Sizes:** heading size (4 steps), body text size, button size, padding top and bottom, standard content width in px.
- **Colours:** page background, soft background, text, heading, label and link colours for the whole section, plus a background, heading, text and label colour **per block**; card background and corner radius.
- **Width:** each block is **Full width** or **Standard (centred)**.
- **Images:** swap any image from the media library; set **aspect ratio** (3:2, 4:3, 16:9, 21:9, 1:1, 4:5, 3:4 or original), **fit** (fill and crop, or show whole image) and corner radius; alt text field on every image.
- **Layout:** image left or right, image/text width share, vertical alignment, 1 to 4 card columns, text alignment.
- **Fonts:** Apple system font, theme font or serif.
- **Block types in gap-page:** Hero, Image + text, Text, Cards (container + card), Steps (container + step), Facts list (container + row), Price table (container + row), FAQ (container + question), Call to action, Spacer, WhatsApp/email enquiry form.
- Child blocks attach to their container by **Block ID / Parent ID** (the same method as the other GAP builders). A section holds up to 50 blocks, so a long page simply uses several "GAP Page" sections.

## Recent work: how it behaves
- **Kept permanently and server-rendered**, so the text and photos are in the page HTML that search engines read. No structured data is added.
- The newest job is always first (sorted by the `date` field). The sliding row shows the last 3 to 8 jobs (you choose), with arrows on desktop and swipe on mobile. A "See all recent work" link opens the archive page, which shows a grid with a **Show more** button.
- **One list feeds every page.** Jobs are stored once as **Content > Metaobjects > Recent work** (title, date, category, what was done, photo, alt text, optional link). Add a new job there and it appears everywhere.
- To show it on every page, add the "GAP Recent work" section (layout: sliding row) to the **footer section group** once, above the footer.

## Install steps (when you are ready)
1. Duplicate the live theme first, and work on the copy.
2. Create the metaobject: run `metaobject-recent-work.graphql` in the Shopify GraphQL app (or ask me to run it), then add your first real jobs.
3. Upload `sections/*.liquid` and `templates/*.json` to the copy theme (Edit code, or `shopify theme push`).
4. Create a Page for each product in Shopify admin and choose the matching template (e.g. `page.gap-dibond-print`).
5. In the theme editor, upload the photos into the image slots (they are empty: image files are not in the templates).
6. Add "GAP Recent work" to the footer group. Create the page "Recent work" with template `page.gap-recent-work`, and put its URL in the "See all" link.
7. Preview, then publish the copy.

## Checked
- Both sections parse as Liquid (python-liquid) and their `{% schema %}` JSON is valid.
- All 19 templates only use setting IDs and select values that exist in the schema; none exceeds 50 blocks.
- Rendered both sections with sample data in a headless browser and looked at the result.

## Not checked (be aware)
- **Not run inside a real Shopify theme or the theme editor.** Shopify's own Liquid and theme-check have not been run (no Shopify CLI access here).
- Sorting metaobjects by `date` with `sort: 'date'` is the part most likely to need a tweak. The section has an **Order** setting (admin order) as a fallback.
- `image_picker` values are empty in the templates, so pages show "Add an image" until you upload photos.
- The 8 main pages (home, Photo &amp; Fine Art Prints, Framing &amp; Display, Iris, Business, Restoration, Gifts, Contact) and the Recent work page are **not yet converted** to templates; the 19 product pages are. The same blocks can build them.
- Prices in the templates are the same "listing, to be confirmed" figures as the review site, or "To be confirmed". Nothing was invented.
- Recent work entries in the review site are **samples**, not real jobs.
