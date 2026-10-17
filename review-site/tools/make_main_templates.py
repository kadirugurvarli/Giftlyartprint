#!/usr/bin/env python3
"""Build the eight editable Shopify page templates from the review-site copy."""
import json
import os
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "shopify", "templates")
EMAIL = "giftlyartprint@gmail.com"
WA = "https://wa.me/447445250359"


def wa(service):
    message = (
        "Hello Giftly Art Print,\n"
        f"I'd like a quote for: {service}\n"
        "Size: \nQuantity: \nNeeded by: \n"
        "I'll send my image/file in this chat."
    )
    return WA + "?text=" + urllib.parse.quote(message)


def rich(text):
    return "<p>" + text + "</p>"


def template(page):
    blocks = {}
    order = []

    def add(kind, settings):
        key = f"b{len(order) + 1:02d}"
        blocks[key] = {"type": kind, "settings": settings}
        order.append(key)

    service = page["service"]
    add("hero", {
        "eyebrow": page["eyebrow"], "heading": page["heading"],
        "subheading": page["subheading"], "heading_tag": "h1",
        "layout_width": "contained", "heading_size": "xl", "text_align": "center",
        "image_alt": page["image_alt"], "aspect_ratio": "3/2", "image_fit": "cover",
        "btn_label": "Message us on WhatsApp", "btn_link": wa(service), "btn_style": "whatsapp",
        "btn2_label": "Email instead", "btn2_link": f"mailto:{EMAIL}?subject=" + urllib.parse.quote(f"Quote request: {service}"),
        "btn2_style": "outline", "btn_size": "md", "background_color": "#ffffff",
        "padding_top": 48, "padding_bottom": 40
    })

    if page.get("notice"):
        add("text_block", {
            "eyebrow": "Review note", "heading": page["notice_heading"],
            "intro": page["notice"], "text": rich(page["notice_detail"]),
            "text_size": "md", "max_width": "normal", "layout_width": "contained",
            "heading_size": "md", "text_align": "left", "background_color": "#fff4e5",
            "accent_color": "#8a3b00", "padding_top": 32, "padding_bottom": 32
        })

    for section in page["sections"]:
        kind = section["kind"]
        ident = section["id"]
        if kind == "grid":
            add("grid_section", {
                "eyebrow": section.get("eyebrow", ""), "heading": section["heading"],
                "intro": section.get("intro", ""), "block_id": ident,
                "columns": section.get("columns", "3"), "layout_width": "contained",
                "heading_size": "lg", "text_align": "left", "card_background": "#ffffff",
                "card_radius": 18, "background_color": section.get("background", "#f5f5f7"),
                "padding_top": 56, "padding_bottom": 56
            })
            for title, text, label, link in section["items"]:
                add("grid_item", {
                    "parent_id": ident, "title": title, "text": rich(text),
                    "link_label": label, "link": link, "aspect_ratio": "4/3", "image_fit": "cover"
                })
        elif kind == "steps":
            add("steps_section", {
                "heading": section["heading"], "block_id": ident, "layout_width": "contained",
                "heading_size": "lg", "text_align": "center", "card_background": "#ffffff",
                "card_radius": 18, "background_color": section.get("background", "#f5f5f7"),
                "padding_top": 56, "padding_bottom": 56
            })
            for title, text in section["items"]:
                add("step", {"parent_id": ident, "title": title, "text": text})
        elif kind == "facts":
            add("facts_section", {
                "eyebrow": section.get("eyebrow", ""), "heading": section["heading"],
                "block_id": ident, "layout_width": "contained", "heading_size": "lg",
                "text_align": "left", "card_background": "#ffffff", "card_radius": 18,
                "background_color": section.get("background", "#ffffff"),
                "padding_top": 56, "padding_bottom": 56
            })
            for label, text in section["items"]:
                add("fact", {"parent_id": ident, "label": label, "text": text})
        elif kind == "text":
            add("text_block", {
                "eyebrow": section.get("eyebrow", ""), "heading": section["heading"],
                "intro": section.get("intro", ""), "text": rich(section["text"]),
                "text_size": "md", "max_width": "wide", "layout_width": "contained",
                "heading_size": "lg", "text_align": "left",
                "background_color": section.get("background", "#ffffff"),
                "padding_top": 56, "padding_bottom": 56,
                "btn_label": section.get("btn_label", ""), "btn_link": section.get("btn_link", ""),
                "btn_style": "outline", "btn_size": "md"
            })

    add("cta", {
        "eyebrow": "Next step", "heading": "Ready to start?",
        "text": "For a clear quote, please send your image and requirements by WhatsApp or email.",
        "overlay": 40, "layout_width": "contained", "heading_size": "lg", "text_align": "center",
        "aspect_ratio": "21/9", "image_fit": "cover",
        "btn_label": "Message us on WhatsApp", "btn_link": wa(service), "btn_style": "whatsapp",
        "btn2_label": "Email instead", "btn2_link": f"mailto:{EMAIL}", "btn2_style": "light",
        "btn_size": "md", "background_color": "#1d1d1f", "heading_color": "#ffffff",
        "text_color": "#f5f5f7", "padding_top": 56, "padding_bottom": 56
    })
    add("enquiry", {
        "eyebrow": "Contact", "heading": "Start your enquiry",
        "intro": "Fill in what you know. Nothing is sent until you press send in WhatsApp or your email app.",
        "service": service,
        "services": "Photo or fine art print\nPrint for my existing frame\nEconomy framed print or poster\nNo-drill magnetic frame\nDibond / Foamex board print\nSpecial presentation framing\nIris photography\nBusiness printing\nPhoto restoration\nPersonalised gift\nSomething else",
        "wa_number": "447445250359", "email": EMAIL, "layout_width": "contained",
        "heading_size": "lg", "text_align": "center", "card_background": "#ffffff",
        "background_color": "#1d1d1f", "heading_color": "#ffffff", "text_color": "#f5f5f7",
        "padding_top": 56, "padding_bottom": 56
    })

    return {
        "sections": {
            "main": {
                "type": "gap-page", "blocks": blocks, "block_order": order,
                "settings": {"font": "apple", "max_width": 1024}
            },
            "recent_work": {
                "type": "gap-recent-work",
                "settings": {
                    "eyebrow": "Recent work", "heading": "Our latest jobs",
                    "intro": "Real completed work will appear here once approved entries are added.",
                    "layout": "carousel", "layout_width": "contained", "items_shown": 4,
                    "columns": "3", "show_arrows": True, "all_label": "See all recent work",
                    "all_link": "/pages/recent-work", "order": "date", "show_date": True,
                    "show_category": True, "aspect_ratio": "4/3", "image_fit": "cover",
                    "heading_size": "lg", "text_align": "left", "background_color": "#f5f5f7",
                    "card_background": "#ffffff", "heading_color": "#1d1d1f",
                    "text_color": "#1d1d1f", "accent_color": "#b64400", "card_radius": 18,
                    "padding_top": 64, "padding_bottom": 64, "max_width": 1024
                }
            }
        },
        "order": ["main", "recent_work"]
    }


PAGES = {
    "home": {
        "eyebrow": "Maidstone & Kent printing and framing studio",
        "heading": "Practical print and frame solutions that fit your budget",
        "subheading": "Tell us what you want to do and what you already have, and we will suggest the simplest option that does the job. Straightforward prices, one person looking after your order.",
        "image_alt": "Oak-framed landscape print on a pale wall above an oak sideboard",
        "service": "Something else",
        "notice_heading": "Content and images are still under review",
        "notice": "This template is not ready for the live theme.",
        "notice_detail": "Product prices marked as listing prices still need confirmation. Theme-editor images must be replaced with approved Giftly work; do not present illustrative or sample images as completed customer jobs.",
        "sections": [
            {"kind": "steps", "id": "start", "heading": "Easy to start", "items": [
                ("Message us", "Send your image and a few words on WhatsApp, or by email if you prefer."),
                ("We check and advise", "We look at your file, suggest a size and an option that suits your budget, and give you a clear quote."),
                ("You decide", "Only when you are happy with the quote do we go ahead. Collect from the studio or ask about delivery.")
            ]},
            {"kind": "grid", "id": "needs", "heading": "What would you like to do?", "intro": "Start with the job, not the product list. Pick the one closest to yours.", "items": [
                ("I want to print my photo", "Send the picture and tell us where it will go. We check the file and suggest a size.", "Photo & Fine Art Prints", "/pages/photo-fine-art-prints"),
                ("I want to use my existing frame", "Tell us the frame's opening size. We size the print to fit, with cropping or borders only if you approve.", "How we fit your frame", "/pages/photo-fine-art-prints#existing-frame"),
                ("I want an economical display", "Wood frame without glass, a removable poster or a lightweight board. Simple and tidy.", "Economy options", "/pages/framing-display#economy"),
                ("I want to hang it without drilling", "Magnetic frames designed for no-drill hanging, with honest notes on which walls suit them.", "No-drill options", "/pages/framing-display#no-drill"),
                ("I want my old photo renewed", "Send the photo and we assess fading, scratches and damage before giving you a price.", "Photo Restoration", "/pages/photo-restoration"),
                ("I need a few prints for my business", "Flyers, cards, menus, posters and boards in the small quantities local businesses actually need.", "Business Printing", "/pages/business-printing")
            ]},
            {"kind": "facts", "id": "local", "heading": "Local, personal, easy to reach", "items": [
                ("One person, your order", "Giftly Art Print is a one-person studio. You deal with the same person from enquiry to collection."),
                ("Visit the studio", "Units 24–25, Royal Star Arcade, Maidstone, Kent. Opening hours to be confirmed, so please message first."),
                ("Honest advice", "If a cheaper option will do the job, we will tell you. If your file is too small for the size you want, we will say so before you pay.")
            ]}
        ]
    },
    "photo-fine-art-prints": {
        "eyebrow": "Photo & Fine Art Prints", "heading": "Print your photo at the right size, on the right paper",
        "subheading": "Not sure your file is good enough, what size to choose or which paper you need? Send it over and we will tell you plainly what will work.",
        "image_alt": "Rolled photo prints in a postal tube beside rolled fine art paper", "service": "Photo or fine art print",
        "notice_heading": "Paper names and listing prices need final confirmation", "notice": "Review before launch.",
        "notice_detail": "The shop uses more than one name for the Permajet metallic paper. Fine Art paper prices and wording remain to be confirmed.",
        "sections": [
            {"kind": "steps", "id": "print_steps", "heading": "Tell us first, then we choose the paper", "items": [
                ("Send your image", "Send it by WhatsApp or email, with where it will hang or be given."),
                ("We check the file", "We tell you the largest size that should look good, and any improvement that is possible."),
                ("You get a clear quote", "Size, paper, any mount or frame, and the total, before anything is printed.")
            ]},
            {"kind": "facts", "id": "print_facts", "heading": "Common worries, answered", "items": [
                ("The problem", "You are not sure your photo is sharp enough, or what size to print."),
                ("What we offer", "We look at the file and recommend a print size. Some files will not suit large sizes, and we will tell you before you pay."),
                ("Included", "Checking your file and advising on size."),
                ("Extra cost", "Detailed retouching or repair is quoted separately; see Photo Restoration.")
            ]},
            {"kind": "text", "id": "existing-frame", "heading": "Already have a frame?", "text": "Tell us the frame's inside opening size, and whether it has a mount. We can use an exact fit, show you an approved crop, or add a white border instead of cropping. Please measure the opening, not the outside of the frame.", "btn_label": "Send frame size on WhatsApp", "btn_link": wa("Print for my existing frame")},
            {"kind": "grid", "id": "paper_compare", "heading": "Photo paper or Fine Art paper?", "columns": "2", "items": [
                ("Photo prints", "The familiar photo look: smoother, with a lustre or gloss surface and strong colour. Usually the more economical choice.", "Ask for advice", wa("Photo print")),
                ("Fine Art prints", "Heavier artist-style papers with a softer, matt or textured finish. They suit artwork and gallery-style presentation.", "Ask for advice", wa("Fine art print"))
            ]},
            {"kind": "text", "id": "price_note", "heading": "Print prices", "intro": "Listing prices are still to be confirmed.", "text": "Current review examples range from £8 for a 20x30cm unframed metallic photo print to £47 for 60x90cm. Other sizes and Fine Art papers: price to be confirmed. We do not promise a perfect print at every size from every file; we tell you what we expect before you commit."}
        ]
    },
    "framing-display": {
        "eyebrow": "Framing & Display", "heading": "Choose how it hangs: frame, board, magnet or something special",
        "subheading": "Four ways to display a print, from simple and economical to bespoke. Tell us your wall, your budget and what you have, and we will point you to the right one.",
        "image_alt": "White wood framed print on a wall", "service": "Economy framed print or poster",
        "notice_heading": "Product details and prices need confirmation", "notice": "Review before launch.",
        "notice_detail": "Glass inclusion, removable-poster material, magnetic-frame surface limits, Foamex prices and all special framing prices are not yet confirmed.",
        "sections": [
            {"kind": "grid", "id": "display_groups", "heading": "Four groups", "columns": "2", "items": [
                ("1. Economy", "Wood frame without glass, or a removable poster.", "See economy options", "/pages/framing-display#economy"),
                ("2. Hang without drilling", "SnappyTack magnetic frames. Wall suitability must be checked before purchase.", "See no-drill options", "/pages/framing-display#no-drill"),
                ("3. Frameless", "Dibond and Foamex / PVC board.", "See frameless options", "/pages/framing-display#frameless"),
                ("4. Special presentation", "Mounted and glazed frames, shirts, plates, objects and artists' canvases.", "See special framing", "/pages/framing-display#special")
            ]},
            {"kind": "facts", "id": "economy", "heading": "Economy: wood frame and removable poster", "items": [
                ("Who it suits", "Bedrooms, offices, rentals and quick refreshes."),
                ("Included", "Print, wood frame in black, white or oak, and backing, subject to final product confirmation."),
                ("Not included", "Glass, mount, delivery and hanging fittings unless quoted."),
                ("Important", "Without glass the print surface is exposed. Removable poster suitability varies by wall; test a hidden area first.")
            ]},
            {"kind": "facts", "id": "no-drill", "heading": "Hang without drilling", "background": "#f5f5f7", "items": [
                ("The option", "A magnetic frame system designed for changing pictures quickly."),
                ("Surface warning", "No-drill hanging depends on wall surface, paint, weight and fitting. Damage-free removal cannot be promised for every wall."),
                ("Pricing", "Current shop listing prices and colour differences are to be confirmed before launch.")
            ]},
            {"kind": "facts", "id": "frameless", "heading": "Frameless boards", "items": [
                ("Dibond", "Rigid aluminium-composite board for a clean, modern look."),
                ("Foamex", "PVC board; prices and suitability are to be confirmed."),
                ("Kapa-fix", "Lightweight paper-faced foam board for temporary or budget display.")
            ]},
            {"kind": "text", "id": "special", "heading": "Special presentation", "text": "Mounted and glazed frames, shirt framing, plate and object framing, and L / floating frames are quoted after we see photos, sizes and the item. All special presentation prices are to be confirmed."}
        ]
    },
    "iris-photography": {
        "eyebrow": "Iris Photography", "heading": "A close-up portrait of the iris, made into something to keep",
        "subheading": "For one person, a couple or a family. Photographed, printed and presented, with gift vouchers if you would like to give it as a present.",
        "image_alt": "Close-up of an iris print in a slim frame", "service": "Iris photography",
        "notice_heading": "Real examples and package details are still required", "notice": "Review before launch.",
        "notice_detail": "Single, couple and family examples must be approved real work. Session length, digital-file inclusion, deposits, balances and some package contents are to be confirmed.",
        "sections": [
            {"kind": "grid", "id": "iris_examples", "heading": "Real examples", "intro": "Real work only. These slots are reserved for photographs from past sessions, with the client's permission.", "items": [
                ("Single-person example", "Approved image to be supplied.", "Ask about a session", wa("One-person Iris photography")),
                ("Couple example", "Approved image to be supplied.", "Ask about a session", wa("Couple Iris photography")),
                ("Family example", "Approved image to be supplied.", "Ask about a session", wa("Family Iris photography"))
            ]},
            {"kind": "steps", "id": "iris_steps", "heading": "How a session works", "items": [
                ("Message us", "Tell us who the session is for, how many people and what you would like to end up with."),
                ("Choose a package", "Packages are based on how many irises are photographed, then print size and finish."),
                ("The session", "Session length, place and preparation are confirmed when you enquire."),
                ("Choose pictures and products", "Digital files and physical products are separate choices unless the confirmed package says otherwise.")
            ]},
            {"kind": "facts", "id": "iris_facts", "heading": "At a glance", "items": [
                ("Who it suits", "Individuals, couples, families and gift givers."),
                ("Included", "The session and the package you choose. Exact inclusions are to be confirmed by Giftly."),
                ("Extra cost", "Extra irises, bigger sizes, other finishes and digital files if not included in the package."),
                ("Prices", "Current voucher listing examples run from £129 to £479; package contents and prices must be confirmed before launch.")
            ]},
            {"kind": "text", "id": "iris_payment", "heading": "Deposit and balance", "intro": "To be confirmed.", "text": "The deposit amount, remaining balance and payment timing have not yet been supplied. Do not publish booking-payment claims until these are confirmed."}
        ]
    },
    "business-printing": {
        "eyebrow": "Business Printing", "heading": "Small-run printing for Maidstone and Kent businesses",
        "subheading": "Need 50 flyers, a set of menus or one big poster? We quote small quantities properly, with no pressure to order thousands.",
        "image_alt": "Flyers, business cards and a folded menu on an oak table", "service": "Business printing",
        "notice_heading": "No confirmed business-printing price list is available", "notice": "Every business-printing price is to be confirmed.",
        "notice_detail": "Paper stocks, design fees, file-fixing costs, delivery, installation and vinyl application must be agreed in the quote. Illustrative business images are not finished Giftly jobs.",
        "sections": [
            {"kind": "grid", "id": "business_products", "heading": "What we can print", "items": [
                ("Flyers and leaflets", "Promotions, events and information in small runs.", "Ask for a quote", wa("Flyers and leaflets")),
                ("Business cards", "Simple cards for new or growing businesses.", "Ask for a quote", wa("Business cards")),
                ("Menus and price lists", "Easy to reprint when prices change.", "Ask for a quote", wa("Menus and price lists")),
                ("Posters and A-board panels", "Window posters and replacement inserts or panels.", "Ask for a quote", wa("Posters and A-board panels")),
                ("Vinyl printing", "Printed vinyl for windows, walls and signs. Application is separate unless agreed.", "Ask for a quote", wa("Vinyl printing")),
                ("Foamex and Dibond", "Rigid boards for signs and displays.", "Ask for a quote", wa("Foamex and Dibond board printing"))
            ]},
            {"kind": "facts", "id": "business_quote", "heading": "What we need for a quote", "items": [
                ("Product", "Tell us what you need and how many."), ("Size", "Give finished size or where it needs to fit."),
                ("Artwork", "Send your print-ready file or logo, or say if you need design help."),
                ("Timing", "Tell us the date needed and whether you will collect or need delivery in Kent.")
            ]},
            {"kind": "facts", "id": "business_scope", "heading": "Included and quoted separately", "background": "#f5f5f7", "items": [
                ("Printing and trimming", "Included when printing from a suitable print-ready file."),
                ("Design or file repair", "Not included unless agreed; quoted separately."),
                ("Stands, holders and installation", "Not included unless specifically quoted."),
                ("Delivery", "Quoted separately; collection and delivery arrangements are to be confirmed.")
            ]}
        ]
    },
    "photo-restoration": {
        "eyebrow": "Photo Restoration", "heading": "Bring an old photograph back, without over-promising",
        "subheading": "Fading, scratches, creases and stains can often be improved. We look at your photo first and then give you a price.",
        "image_alt": "Old faded photograph on a desk with a soft brush and cotton gloves", "service": "Photo restoration",
        "notice_heading": "Approved before-and-after examples are still required", "notice": "Use real client work only, with permission.",
        "notice_detail": "The fixed shop prices are review starting points. The final quote follows assessment, and results depend on the condition of the original.",
        "sections": [
            {"kind": "grid", "id": "restoration_examples", "heading": "Real before and after examples", "columns": "2", "items": [
                ("Before", "Approved real client image to be supplied.", "Send a photo for assessment", wa("Photo restoration")),
                ("After", "Matching approved result image to be supplied.", "Send a photo for assessment", wa("Photo restoration"))
            ]},
            {"kind": "steps", "id": "restoration_steps", "heading": "How it works", "items": [
                ("Send the photo", "Send a clear scan or a photo of the original by WhatsApp or email."),
                ("We assess", "We look at fading, scratches and damage and tell you what can be improved."),
                ("You get a price", "Only after we have seen the photo. Results vary and the same outcome cannot be promised for every photo."),
                ("Choose your extras", "Colourising, printing and framing are optional.")
            ]},
            {"kind": "facts", "id": "restoration_facts", "heading": "At a glance", "items": [
                ("The problem", "Old family photos may be faded, scratched, torn or stained."),
                ("What we offer", "Digital restoration, with optional colourising, printing and framing as separate choices."),
                ("Included", "Assessment and the restoration option you choose."),
                ("Extra cost", "Colourising, print, frame and complex repair.")
            ]},
            {"kind": "text", "id": "restoration_prices", "heading": "Prices", "intro": "Shop listing prices, to be confirmed.", "text": "Review starting points are £20 for digital restoration only, £25 with colourising, and higher for fine art prints or framed prints. Heavily damaged photos are quoted individually. The unverified certification claim from the shop copy is intentionally not repeated."}
        ]
    },
    "personalised-gifts": {
        "eyebrow": "Personalised Gifts", "heading": "A short list of gifts we do well",
        "subheading": "Photo blocks, collages and Iris vouchers. A small, chosen range, personalised with your pictures.",
        "image_alt": "Acrylic block, small wood frame and collage print arranged on a desk", "service": "Personalised gift",
        "notice_heading": "Gift prices and inclusions need final confirmation", "notice": "Review before launch.",
        "notice_detail": "Acrylic and collage figures are current shop listing prices. Frame inclusion for some collage products and anniversary or family-product details are to be confirmed.",
        "sections": [
            {"kind": "grid", "id": "design_choice", "heading": "Ready-made design or fully custom?", "columns": "2", "items": [
                ("Ready-made design, your details", "Choose a layout and we add your photos and wording. Quicker and more affordable; listed prices refer to this.", "Ask about a design", wa("Ready-made personalised gift")),
                ("Custom design", "If you want something drawn up from scratch, design work is quoted separately before starting.", "Send your idea", wa("Custom personalised gift"))
            ]},
            {"kind": "facts", "id": "acrylic", "heading": "Acrylic photo blocks", "items": [
                ("Who it suits", "Birthdays, Mother's Day, Valentine's Day and new homes."),
                ("Included", "Acrylic block and your printed photo."),
                ("Not included", "Delivery and gift wrapping unless confirmed."),
                ("Listing prices", "10x10cm £17, 10x15cm £20 and 13x18cm £25; all to be confirmed before launch.")
            ]},
            {"kind": "facts", "id": "collages", "heading": "Collage prints", "background": "#f5f5f7", "items": [
                ("Wedding collage", "Current listing examples: 30x40cm £45 and 40x50cm £60; to be confirmed."),
                ("New baby collage", "Current listing examples: 30x40cm £45 and 40x50cm £65; frame inclusion is to be confirmed."),
                ("Anniversary and family prints", "Material, inclusions and price are to be confirmed."),
                ("Custom design", "Quoted separately from ready-made layouts.")
            ]},
            {"kind": "text", "id": "iris_vouchers", "heading": "Iris gift vouchers", "text": "Give an Iris Photography session. Choose a voucher and the recipient redeems it with us. Package contents and prices must be checked on the Iris Photography page before launch.", "btn_label": "See Iris Photography", "btn_link": "/pages/iris-photography"}
        ]
    },
    "contact-visit": {
        "eyebrow": "Contact / Visit", "heading": "Message us first, then visit if you like",
        "subheading": "WhatsApp is the quickest way to start. Email works well too. Send your image and details and we will reply with a clear quote.",
        "image_alt": "Studio or shop front photo to be supplied", "service": "Something else",
        "notice_heading": "Visit details are incomplete", "notice": "Please message before travelling.",
        "notice_detail": "Opening hours, postcode, parking and access details are to be confirmed. An approved studio or shop-front photograph is still to be supplied.",
        "sections": [
            {"kind": "facts", "id": "send", "heading": "What to send", "items": [
                ("Image", "The photo or file."), ("Size", "The size you want, or where it will go."),
                ("Quantity and budget", "Tell us the quantity and budget if you have one."),
                ("Date", "Tell us when you need it.")
            ]},
            {"kind": "grid", "id": "channels", "heading": "Choose how to contact us", "columns": "2", "items": [
                ("1. WhatsApp (best)", "07445 250359", "Open WhatsApp", wa("Something else")),
                ("2. Email", EMAIL, "Write an email", f"mailto:{EMAIL}")
            ]},
            {"kind": "facts", "id": "visit", "heading": "Visit the studio", "background": "#f5f5f7", "items": [
                ("Address", "Giftly Art Print, Units 24–25, Royal Star Arcade, Maidstone, Kent."),
                ("Opening hours", "To be confirmed. Please message before travelling."),
                ("Postcode, parking and access", "To be confirmed."),
                ("Collections and deliveries", "The visit address is not necessarily the dispatch or return address; order-specific details are supplied when you order.")
            ]},
            {"kind": "text", "id": "online", "heading": "Ordering online", "text": "During review, no order is placed through the prototype. Quotes and orders go through WhatsApp or email. Individual shop order links will be added only after each link and product has been checked."}
        ]
    }
}


os.makedirs(OUT, exist_ok=True)
for slug, page in PAGES.items():
    path = os.path.join(OUT, f"page.gap-{slug}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(template(page), handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(os.path.basename(path))
