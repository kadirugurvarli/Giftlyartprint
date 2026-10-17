#!/usr/bin/env python3
"""Generates the 8 review pages from shared components. Run: python3 -I tools/build.py"""
import sys, os, html, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from images import IMAGES
from products_data import PRODUCTS
from recent_work import WORKS
PBY = {p['slug']: p for p in PRODUCTS}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USED = set()
WA = "https://wa.me/447445250359"
MAIL = "giftlyartprint@gmail.com"
e = html.escape

def wa_href(service):
    t = ("Hello Giftly Art Print,\nI'd like a quote for: %s\nSize: \nQuantity: \nNeeded by: \n"
         "I'll send my image/file in this chat." % service)
    return WA + "?text=" + urllib.parse.quote(t)
def mail_href(service):
    b = "Hello Giftly Art Print,\nI'd like a quote for: %s\nSize: \nQuantity: \nNeeded by: \nMy image/file is attached." % service
    return "mailto:%s?subject=%s&body=%s" % (MAIL, urllib.parse.quote("Quote request: " + service), urllib.parse.quote(b))
def wa_btn(service, label="Message us on WhatsApp"):
    return '<a class="btn btn-wa" href="%s" target="_blank" rel="noopener">%s</a>' % (wa_href(service), e(label))
def mail_btn(service, label="Email instead"):
    return '<a class="btn btn-mail" href="%s">%s</a>' % (mail_href(service), e(label))
def actions(service, wal="Message us on WhatsApp", ml="Email instead"):
    return '<div class="actions">%s%s</div>' % (wa_btn(service, wal), mail_btn(service, ml))
def small_links(service):
    return ('<a href="%s" target="_blank" rel="noopener">Ask on WhatsApp</a> <a href="%s">Email</a>'
            % (wa_href(service), mail_href(service)))

def img(key, alt, eager=False, cap=None, cls=""):
    name, w, h, kind = IMAGES[key]; USED.add(key)
    fc = '<figcaption>Illustrative image, not a finished Giftly job.</figcaption>' 
    return ('<figure class="fig %s"><img src="assets/img/%s" width="%d" height="%d" alt="%s" %s decoding="async">%s</figure>'
            % (cls, name, w, h, e(alt), 'fetchpriority="high"' if eager else 'loading="lazy"', fc))
def ph(text, w=4, h=3):
    return ('<figure class="fig"><div class="ph" role="img" aria-label="%s" style="aspect-ratio:%d/%d">%s</div></figure>'
            % (e("Placeholder: " + text), w, h, e(text)))
TBC = '<span class="tbc">To be confirmed</span>'
def facts(problem, solution, who, incl, extra, nxt):
    rows = [("The problem", problem), ("What we offer", solution), ("Who it suits", who),
            ("Included", incl), ("Extra cost", extra), ("What to do now", nxt)]
    return '<dl class="facts">' + "".join("<div><dt>%s</dt><dd>%s</dd></div>" % r for r in rows) + "</dl>"
def table(caption, heads, rows, note=None):
    th = "".join("<th scope='col'>%s</th>" % h for h in heads)
    tr = "".join("<tr>%s</tr>" % "".join(("<td class='price'>%s</td>" if i == len(heads)-1 and heads[-1].lower().startswith("price") else "<td>%s</td>") % c for i, c in enumerate(r)) for r in rows)
    n = '<p class="note">%s</p>' % note if note else ""
    return '<div class="tbl" tabindex="0" role="region" aria-label="%s"><table><caption>%s</caption><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>%s' % (e(caption), e(caption), th, tr, n)
PRICE_NOTE = ("Review draft: prices are copied from the current Shopify listing and must be confirmed by Giftly before launch. "
              "Prices are not discounts; final quote depends on your file and requirements.")

def pu(slug): return "product-%s.html" % slug
def grp(heading, slugs): return (heading, [(PBY[x]["name"], pu(x)) for x in slugs])
TREE = [
 ("index.html", "Home", []),
 ("photo-fine-art-prints.html", "Prints", [("Prints", [("Photo &amp; Fine Art Prints overview", "photo-fine-art-prints.html"), ("Fit a print to your frame", "photo-fine-art-prints.html#existing-frame"), ("Photo or Fine Art paper?", "photo-fine-art-prints.html#compare")]), grp("Presented", ["framed-fine-art-print"])]),
 ("framing-display.html", "Framing", [grp("Economy", ["economy-framed-print", "removable-poster"]), grp("Hang without drilling", ["snappytack-magnetic-frame", "magnetic-poster-hanger"]),
    grp("Frameless", ["dibond-print", "foamex-board-print", "kapa-fix-foam-board"]), grp("Special presentation", ["framed-fine-art-print", "shirt-frame", "plate-and-object-frame", "l-floating-frame"])]),
 ("iris-photography.html", "Iris", [("Iris Photography", [("How a session works", "iris-photography.html"), ("Package prices", "iris-photography.html")]), grp("Gifts", ["iris-gift-vouchers"])]),
 ("business-printing.html", "Business", [grp("Print", ["flyers-and-leaflets", "business-cards", "menus-and-price-lists", "posters-and-a-boards"]), grp("Signs and boards", ["vinyl-printing", "foamex-board-print"])]),
 ("photo-restoration.html", "Restoration", []),
 ("personalised-gifts.html", "Gifts", [grp("Gifts", ["acrylic-photo-block", "photo-collage-prints", "iris-gift-vouchers"])]),
 ("contact-visit.html", "Contact", []),
]
SECTION_OF = {"Framing & Display": "framing-display.html", "Personalised Gifts": "personalised-gifts.html", "Iris Photography": "iris-photography.html", "Business Printing": "business-printing.html"}
NAV = [(f, l) for f, l, _ in TREE]
LONG = {"index.html": "Home", "photo-fine-art-prints.html": "Photo & Fine Art Prints", "framing-display.html": "Framing & Display", "iris-photography.html": "Iris Photography",
        "business-printing.html": "Business Printing", "photo-restoration.html": "Photo Restoration", "personalised-gifts.html": "Personalised Gifts", "contact-visit.html": "Contact / Visit"}
def nav_html(current, section):
    out = ""
    for f, label, cols in TREE:
        cur = ' aria-current="page"' if f == current else (' class="cur"' if f == section else "")
        if not cols:
            out += '<li><a href="%s"%s>%s</a></li>' % (f, cur, label); continue
        i = "mega-" + label.lower()
        colh = "".join('<div class="mcol"><p class="mh">%s</p><ul>%s</ul></div>' % (h, "".join('<li><a href="%s">%s</a></li>' % (u, l) for l, u in links)) for h, links in cols)
        out += ('<li class="has-sub"><a href="%s"%s>%s</a><button type="button" class="sub-toggle" aria-expanded="false" aria-controls="%s" aria-label="Show %s menu"></button>'
                '<div class="mega" id="%s"><div class="wrap mega-in">%s</div></div></li>') % (f, cur, label, i, label, i, colh)
    return out

def prodsec(slugs, title="Product pages", lede="Each product has its own page with the problem it solves, what is included and a price list."):
    cards = ""
    for x in slugs:
        p = PBY[x]
        cards += ('<article class="card"><a class="cimg" href="%s" tabindex="-1" aria-hidden="true">%s</a><div class="body"><h3><a href="%s">%s</a></h3><p>%s</p><div class="more"><a href="%s">View product page</a></div></div></article>'
                  % (pu(x), img(p["imgs"][0][0], p["imgs"][0][1]), pu(x), p["name"], p["lede"].split(". ")[0].rstrip(".") + ".", pu(x)))
    return '<section><div class="wrap"><h2>%s</h2><p class="lede">%s</p><div class="grid g3">%s</div></div></section>' % (title, lede, cards)

def quote_block(service, options, title="Start your enquiry"):
    options = list(options) + ([service] if service not in options else [])
    opts = "".join('<option%s>%s</option>' % (" selected" if o == service else "", e(o)) for o in options)
    return '''<section class="dark" id="quote"><div class="wrap"><div class="quote">
<h2>%s</h2>
<p>For a clear quote, please send your image and requirements by WhatsApp or email. Fill in what you know; nothing is sent until you press send in WhatsApp or your email app.</p>
<form class="quote-form" onsubmit="return false">
<label>What is it for?<select name="service">%s</select></label>
<label>Size<input name="size" placeholder="e.g. A3, or 30x40cm"></label>
<label>Quantity<input name="qty" inputmode="numeric" placeholder="e.g. 1"></label>
<label>Needed by<input name="date" placeholder="e.g. 20 December"></label>
<label>Budget (optional)<input name="budget" placeholder="e.g. around £40"></label>
<label class="full">Anything else?<textarea name="notes" rows="2" placeholder="Existing frame size, wall type, file questions..."></textarea></label>
<div class="actions"><a id="q-wa" class="btn btn-wa" href="%s" target="_blank" rel="noopener">Open WhatsApp with this message</a><a id="q-mail" class="btn btn-mail" href="%s">Email this instead</a></div>
<p class="send-note">WhatsApp opens with the message ready; you attach your image and press send yourself. Please do not send payment details.</p>
</form></div></div></section>''' % (e(title), opts, wa_href(service), mail_href(service))

SERVICES = ["Photo or fine art print", "Print for my existing frame", "Economy framed print or poster", "No-drill magnetic frame",
            "Dibond / Foamex board print", "Special presentation framing", "Iris photography", "Business printing",
            "Photo restoration", "Personalised gift", "Something else"]

import datetime
def fdate(d):
    return datetime.date.fromisoformat(d).strftime("%-d %B %Y")
def work_card(w):
    return ('<article class="rw-item"><figure class="fig">%s</figure><div class="rw-body"><p class="rw-meta"><span class="tag">%s</span> <time datetime="%s">%s</time> <span class="tag warn">Sample entry</span></p><h3>%s</h3><p>%s</p></div></article>'
            % (img(w["img"], w["alt"]).split("</figure>")[0].split(">", 1)[1], e(w["cat"]), w["date"], fdate(w["date"]), e(w["title"]), e(w["text"])))
def recent_work_section(n=4):
    items = "".join("<li>%s</li>" % work_card(w) for w in WORKS[:n])
    return ('<section class="rw alt" aria-labelledby="rw-h"><div class="wrap"><div class="rw-head"><div><p class="eyebrow">Recent work</p><h2 id="rw-h">Our latest jobs</h2>'
            '<p class="lede">The newest job is always first. Slide to see the last few, or open the full list.</p></div>'
            '<div class="rw-ctl"><button type="button" class="rw-btn" data-dir="-1" aria-label="Previous jobs">&lsaquo;</button><button type="button" class="rw-btn" data-dir="1" aria-label="Next jobs">&rsaquo;</button></div></div>'
            '<ul class="rw-track" tabindex="0" role="region" aria-label="Recent jobs, scrollable">%s</ul>'
            '<p class="rw-all"><a href="recent-work.html">See all recent work</a></p></div></section>' % items)
def page(fname, title, desc, h1_html, body, service, current, section=None):
    if current != "recent-work.html":
        body += recent_work_section()
    nav = nav_html(current, section)
    return '''<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s | Giftly Art Print, Maidstone</title>
<meta name="description" content="%s">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1f3d2f">
<link rel="stylesheet" href="assets/css/site.css">
</head><body>
<a class="skip" href="#main">Skip to content</a>
<div class="review-banner">Review prototype, not the live site. Prices and some details are still to be confirmed.</div>
<header class="site-header"><div class="wrap bar">
<a class="brand" href="index.html">Giftly Art Print<small>Maidstone, Kent</small></a>
<button class="nav-toggle" aria-expanded="false" aria-controls="site-nav">Menu</button>
<nav class="nav" id="site-nav" aria-label="Main"><ul>%s</ul></nav>
</div></header>
<main id="main">
%s
</main>
<footer><div class="wrap"><div class="fcols">
<div><h2>Giftly Art Print</h2><p>A one-person printing, photography and framing studio serving Maidstone and Kent.</p></div>
<div><h2>Get in touch</h2><ul><li><a href="%s" target="_blank" rel="noopener">WhatsApp: 07445 250359</a></li><li><a href="mailto:%s">%s</a></li></ul>
<p>For a clear quote, please send your image and requirements by WhatsApp or email.</p></div>
<div><h2>Visit</h2><p>Units 24&ndash;25, Royal Star Arcade, Maidstone, Kent.<br>Opening hours: to be confirmed. Please message before you travel.</p></div>
<div><h2>Pages</h2><ul>%s</ul></div>
</div><p class="note" style="color:#aaa;margin-top:20px">Review prototype. Not indexed by search engines.</p></div></footer>
<a class="btn btn-wa sticky-wa" href="%s" target="_blank" rel="noopener">WhatsApp</a>
<script src="assets/js/site.js" defer></script>
</body></html>''' % (e(title), e(desc), nav, body.replace("{{H1}}", h1_html), WA + "?text=" + urllib.parse.quote("Hello Giftly Art Print, I'd like a quote for: " + service),
                     MAIL, MAIL, "".join('<li><a href="%s">%s</a></li>' % (f, LONG[f]) for f, l in NAV) + '<li><a href="recent-work.html">Recent work</a></li>', wa_href(service))

def hero(eyebrow, h1, lede, svc, figure, extra=""):
    return '''<section class="hero"><div class="wrap hero-in"><p class="eyebrow">%s</p><h1>%s</h1><p class="lede">%s</p>%s%s</div><div class="wrap">%s</div></section>''' % (
        e(eyebrow), e(h1), lede, actions(svc), extra, figure)

pages = {}

# ---------------- HOME ----------------
def card(imgh, h, p, link, svc, linklabel):
    return '<article class="card">%s<div class="body"><h3>%s</h3><p>%s</p><div class="more"><a href="%s">%s</a>%s</div></div></article>' % (imgh, h, p, link, linklabel, small_links(svc))
def ncard(h, p, link, svc, label):
    return '<article class="card"><div class="body"><h3>%s</h3><p>%s</p><div class="more"><a href="%s">%s</a>%s</div></div></article>' % (h, p, link, label, small_links(svc))

home = hero("Maidstone & Kent printing and framing studio",
    "Practical print and frame solutions that fit your budget",
    "Tell us what you want to do and what you already have, and we will suggest the simplest option that does the job. Straightforward prices, one person looking after your order.",
    "Something else", img("hero", "Oak-framed landscape print on a pale wall above an oak sideboard", eager=True))
home += '''<section class="alt"><div class="wrap"><h2>Easy to start</h2>
<p class="lede">You do not need to know sizes or paper types. Just send us the basics.</p>
<ol class="steps"><li><h3>Message us</h3><p>Send your image and a few words on WhatsApp, or by email if you prefer.</p></li>
<li><h3>We check and advise</h3><p>We look at your file, suggest a size and an option that suits your budget, and give you a clear quote.</p></li>
<li><h3>You decide</h3><p>Only when you are happy with the quote do we go ahead. Collect from the studio or ask about delivery.</p></li></ol>
%s</div></section>''' % actions("Something else")
home += '''<section><div class="wrap"><h2>What would you like to do?</h2>
<p class="lede">Start with the job, not the product list. Pick the one closest to yours.</p><div class="grid g3">%s</div></div></section>''' % "".join([
 ncard("I want to print my photo", "Send the picture and tell us where it will go. We check the file and suggest a size.", "photo-fine-art-prints.html", "Photo or fine art print", "Photo & Fine Art Prints"),
 ncard("I want to use my existing frame", "Tell us the frame&rsquo;s opening size. We size the print to fit, with cropping or borders only if you approve.", "photo-fine-art-prints.html#existing-frame", "Print for my existing frame", "How we fit your frame"),
 ncard("I want an economical display", "Wood frame without glass, a removable poster or a lightweight board. Simple and tidy.", "framing-display.html#economy", "Economy framed print or poster", "Economy options"),
 ncard("I want to hang it without drilling", "Magnetic frames designed for no-drill hanging, with honest notes on which walls suit them.", "framing-display.html#no-drill", "No-drill magnetic frame", "No-drill options"),
 ncard("I want my old photo renewed", "Send the photo and we assess fading, scratches and damage before giving you a price.", "photo-restoration.html", "Photo restoration", "Photo Restoration"),
 ncard("I need a few prints for my business", "Flyers, cards, menus, posters and boards in the small quantities local businesses actually need.", "business-printing.html", "Business printing", "Business Printing")])
home += '''</div></section>
<section class="alt"><div class="wrap"><h2>Economical print and display examples</h2>
<p class="lede">Prices below are listing prices, still to be confirmed.</p><div class="grid g3">%s</div></div></section>''' % "".join([
 card(img("kapa-board", "Foam board mounted print leaning on a wall"), "Print on Kapa-fix foam board", "Lightweight board with a paper surface. Good for temporary or budget display. From &pound;20 (listing, to be confirmed).", "framing-display.html#frameless", "Kapa-fix print on foam board", "Frameless options"),
 card(img("framed-black", "Black wood framed print", ), "Framed print, black or oak wood", "Ready to hang, no glass. 20x30cm from &pound;35 (listing, to be confirmed).", "framing-display.html#economy", "Economy framed print", "Economy framing"),
 card(img("removable-poster", "Hand repositioning a removable poster on a painted wall"), "Removable poster", "A low-cost poster option for walls where a frame is not wanted. Price to be confirmed.", "framing-display.html#economy", "Removable poster", "About removable posters")])
home += '''</div></section>
<section><div class="wrap split"><div><p class="eyebrow">For local businesses</p><h2>Business Printing</h2>
<p>Small runs without minimum-order hassle: flyers, business cards, menus, price lists, posters, A-board panels, vinyl and rigid boards. We quote on product, quantity, size, file and date.</p>
<p><a href="business-printing.html">See what we can print</a></p>%s</div>%s</div></section>''' % (actions("Business printing", "WhatsApp about business printing"), img("business-print", "Flyers, business cards and a folded menu on an oak table"))
home += '''<section class="alt"><div class="wrap split rev"><div><p class="eyebrow">Photography</p><h2>Iris Photography</h2>
<p>A close-up portrait of the iris, printed and presented as a keepsake. Available for one person, a couple or a family, with gift vouchers if you want to give the session as a present.</p>
<p><a href="iris-photography.html">How it works and what is included</a></p></div>%s</div></section>''' % img("iris", "Close-up of an iris print in a slim frame")
home += '''<section><div class="wrap"><h2>Small personalised gifts</h2>
<p class="lede">A short, chosen range rather than a catalogue.</p><div class="grid g3">%s</div><p><a href="personalised-gifts.html">See the full gift collection</a></p></div></section>''' % "".join([
 card(img("acrylic-block", "Clear acrylic photo block on a wooden desk"), "Acrylic photo block", "A clear desk-top block for a favourite photo. From &pound;17 (listing, to be confirmed).", "personalised-gifts.html#acrylic", "Acrylic photo block", "Acrylic blocks"),
 card(img("wedding-collage", "Personalised wedding photo collage print"), "Wedding and anniversary collage", "Your photos arranged in a ready-made layout. From &pound;45 (listing, to be confirmed).", "personalised-gifts.html#collages", "Wedding collage print", "Collages"),
 card(img("newborn-collage", "Personalised newborn baby photo collage print"), "New baby collage", "A keepsake for the first weeks. From &pound;45 (listing, to be confirmed).", "personalised-gifts.html#collages", "New baby collage print", "Collages")])
home += '''</div></div></section>
<section class="alt"><div class="wrap split"><div><p class="eyebrow">Photo restoration</p><h2>Old, faded or damaged photos</h2>
<p>We look first, then quote. Restoration, optional colourising, printing and framing are separate choices, so you only pay for what you want. Results depend on the original and we do not promise the same outcome for every photo.</p>
<p><a href="photo-restoration.html">How restoration works</a></p></div>%s</div></section>''' % img("restoration", "Old faded photograph on a desk with a soft brush and cotton gloves")
home += '''<section><div class="wrap split rev"><div><p class="eyebrow">When you want the very best</p><h2>Fine art prints and special presentation</h2>
<p>For work that deserves it: Hahnemühle fine art papers, mounts, glazed frames, and framing for shirts, plates and objects. Most customers do not need this, and we will say so. If you do, it is here.</p>
<p><a href="photo-fine-art-prints.html#compare">Photo or Fine Art paper?</a> &middot; <a href="framing-display.html#special">Special presentation</a></p></div>%s</div></section>''' % img("gallery-frame", "Black framed fine art print in a modern living room")
home += '''<section class="alt"><div class="wrap"><h2>Local, personal, easy to reach</h2>
<div class="grid g3"><div><h3>One person, your order</h3><p>Giftly Art Print is a one-person studio. You deal with the same person from enquiry to collection.</p></div>
<div><h3>Visit the studio</h3><p>Units 24&ndash;25, Royal Star Arcade, Maidstone, Kent. Opening hours to be confirmed, so please message first.</p></div>
<div><h3>Honest advice</h3><p>If a cheaper option will do the job, we will tell you. If your file is too small for the size you want, we will say so before you pay.</p></div></div></div></section>'''
home += quote_block("Something else", SERVICES)
pages["index.html"] = page("index.html", "Printing, Framing & Photography in Maidstone", "Practical, budget-friendly printing, framing, restoration and Iris photography from a one-person studio in Maidstone, Kent.", "", home, "Something else", "index.html")

# ---------------- PHOTO & FINE ART ----------------
p = hero("Photo & Fine Art Prints", "Print your photo at the right size, on the right paper",
    "Not sure your file is good enough, what size to choose or which paper you need? Send it over and we will tell you plainly what will work.",
    "Photo or fine art print", img("paper-tube", "Rolled photo prints in a postal tube beside rolled fine art paper", eager=True))
p += '''<section class="alt"><div class="wrap"><h2>Tell us first, then we choose the paper</h2>
<p class="lede">What would you like to do? What do you already have? How can we help? Those three answers matter more than the paper name.</p>
<ol class="steps"><li><h3>Send your image</h3><p>By WhatsApp or email, with where it will hang or be given.</p></li>
<li><h3>We check the file</h3><p>We tell you the largest size that should look good, and any improvement that is possible.</p></li>
<li><h3>You get a clear quote</h3><p>Size, paper, any mount or frame, and the total, before anything is printed.</p></li></ol></div></section>
<section><div class="wrap"><h2>Common worries, answered</h2>
%s</div></section>''' % facts(
 "You are not sure your photo is sharp enough, or what size to print.", "We look at the file and recommend a print size, with a light clean-up where it helps. Some files will not suit large sizes, and we will tell you before you pay.",
 "Phone photos, downloaded images, scans, family pictures.", "Checking your file and advising on size.", "Detailed retouching or repair is quoted separately (see Photo Restoration).", "Send the image and your preferred size, or just where it will go.")
p += '''<section class="alt" id="existing-frame"><div class="wrap split"><div><h2>Already have a frame?</h2>
<p>Tell us the frame&rsquo;s inside (opening) size, and whether it has a mount. We size the print to fit.</p>
<ul class="checks"><li><strong>Exact fit:</strong> if your photo&rsquo;s shape matches, we print to size.</li>
<li><strong>Approved crop:</strong> if the shapes differ, we show you the crop and only print once you agree.</li>
<li><strong>Added border:</strong> or we add a white border instead of cropping into the picture.</li></ul>
<p class="note">Please do not trim anything yourself. Measure the opening, not the outside of the frame.</p>%s</div>%s</div></section>''' % (actions("Print for my existing frame", "Send frame size on WhatsApp"), img("existing-frame", "Hands sliding a print into an oak frame beside a tape measure"))
p += '''<section id="compare"><div class="wrap"><h2>Photo paper or Fine Art paper?</h2>
<p class="lede">Both are printed in the studio. The difference is mainly the look and feel. Descriptions below are in plain terms; ask us for advice on your image.</p>
<div class="compare"><div><h3>Photo prints</h3><p>The familiar photo look: smoother, with a lustre or gloss surface and strong colour.</p>
<ul class="checks"><li>Suit family photos, holidays and everyday prints.</li><li>Usually the more economical choice.</li><li>Papers listed in the shop include Hahnemühle Photo Luster 260gsm, Photo Glossy 260gsm and Matt Fibre 200gsm, and a Permajet gloss metallic 300gsm.</li></ul></div>
<div><h3>Fine Art prints</h3><p>Heavier artist-style papers with a softer, matt or textured finish.</p>
<ul class="checks"><li>Suit black and white, portraits, artwork and anything you want to feel more like a gallery piece.</li><li>Cost a little more.</li><li>Papers listed in the shop include Hahnemühle Photo Rag 308gsm, German Etching 310gsm, Bamboo, Matt Baryta and Photo Rag Metallic 340gsm.</li></ul></div></div>
<p class="note">Paper descriptions are for review. Giftly to check the wording before launch.</p></div></section>
<section class="alt"><div class="wrap"><h2>Print border or mount? They are different things</h2>
<div class="compare"><div><h3>Print border (margin)</h3><p>A strip of blank paper around the picture, <em>printed on the same sheet</em>. It is part of the print, so the image prints smaller than the paper.</p></div>
<div><h3>Mount (passe-partout)</h3><p>A separate card with a window cut in it, placed between print and frame. It is an extra item, and it sits behind glass in a framed piece.</p></div></div></div></section>
<section><div class="wrap"><h2>Print prices</h2>'''
p += table("Unframed photo prints (shop listing, to be confirmed)", ["Size", "Material", "Included", "Not included", "Price (listing)"], [
 ["20x30cm", "Permajet gloss metallic 300gsm", "Print only", "Frame, mount, delivery", "&pound;8"],
 ["30x45cm", "Permajet gloss metallic 300gsm", "Print only", "Frame, mount, delivery", "&pound;15"],
 ["40x60cm", "Permajet gloss metallic 300gsm", "Print only", "Frame, mount, delivery", "&pound;25"],
 ["50x75cm", "Permajet gloss metallic 300gsm", "Print only", "Frame, mount, delivery", "&pound;35"],
 ["60x90cm", "Permajet gloss metallic 300gsm", "Print only", "Frame, mount, delivery", "&pound;47"],
 ["Other sizes and Fine Art papers", "Hahnemühle range", "Print only", "Frame, mount, delivery", TBC]], PRICE_NOTE + " The shop names this paper both &ldquo;Platinum Gloss Metallic&rdquo; and &ldquo;Titanium Gloss&rdquo;: to be checked.")
p += '''<h3>Mounted on board instead of framed</h3>'''
p += table("Prints on Kapa-fix foam board (shop listing, to be confirmed)", ["Size", "Material", "Included", "Not included", "Price (listing)"], [
 ["20x30cm", "Photo paper on Kapa-fix foam board", "Print mounted on board", "Frame, glass, hanging fittings", "&pound;20 (Photo Rag-type papers &pound;22)"],
 ["30x45cm", "Photo paper on Kapa-fix foam board", "Print mounted on board", "Frame, glass, hanging fittings", "&pound;35 (&pound;40)"],
 ["40x60cm", "Photo paper on Kapa-fix foam board", "Print mounted on board", "Frame, glass, hanging fittings", "&pound;50 (&pound;58)"],
 ["50x75cm", "Photo paper on Kapa-fix foam board", "Print mounted on board", "Frame, glass, hanging fittings", "&pound;70 (&pound;80)"],
 ["60x90cm", "Photo paper on Kapa-fix foam board", "Print mounted on board", "Frame, glass, hanging fittings", "&pound;80 (&pound;95)"]],
 "Kapa-fix is a paper-faced foam board. It is not the same as Foamex (PVC) board; see Framing &amp; Display. Brackets show the price for the heavier fine art papers.")
p += '''<p>We do not promise a perfect print at every size from every file. We promise to tell you honestly what we expect before you commit.</p>%s</div></section>''' % actions("Photo or fine art print")
p += prodsec(["framed-fine-art-print","kapa-fix-foam-board","dibond-print"], "Presenting your print")
p += quote_block("Photo or fine art print", SERVICES)
pages["photo-fine-art-prints.html"] = page("", "Photo & Fine Art Prints in Maidstone", "Send your photo and we will check the file, advise on size and paper, and fit prints to your existing frame. Maidstone, Kent.", "", p, "Photo or fine art print", "photo-fine-art-prints.html")

# ---------------- FRAMING & DISPLAY ----------------
f = hero("Framing & Display", "Choose how it hangs: frame, board, magnet or something special",
    "Four ways to display a print, from simple and economical to bespoke. Tell us your wall, your budget and what you have, and we will point you to the right one.",
    "Economy framed print or poster", img("framed-white", "White wood framed print on a wall", eager=True))
f += '''<section class="alt"><div class="wrap"><h2>Four groups</h2><div class="grid g2">
<a class="card" href="#economy"><div class="body"><h3>1. Economy</h3><p>Wood frame without glass, or a removable poster.</p></div></a>
<a class="card" href="#no-drill"><div class="body"><h3>2. Hang without drilling</h3><p>SnappyTack magnetic frames.</p></div></a>
<a class="card" href="#frameless"><div class="body"><h3>3. Frameless</h3><p>Dibond and Foamex / PVC board.</p></div></a>
<a class="card" href="#special"><div class="body"><h3>4. Special presentation</h3><p>Mounted and glazed frames, shirts, plates, objects and artists&rsquo; canvases.</p></div></a></div></div></section>
<section id="economy"><div class="wrap"><h2>1. Economy: wood frame and removable poster</h2>
<div class="split"><div>%s</div><div>%s%s</div></div>''' % (facts(
 "You want something tidy on the wall without paying for glass and mounts.", "A ready-to-hang wood frame without glass, or a poster that can be removed later.",
 "Bedrooms, offices, rentals, quick refreshes.", "Print, wood frame (black, white or oak) and backing.", "Glass, mount, delivery and hanging fittings unless quoted.", "Send your image and size."),
 img("framed-black", "Black wood framed print"), img("framed-oak", "Oak wood framed print leaning on a shelf"))
f += '''<p><strong>No glass means the printed surface is exposed.</strong> It can mark if touched, so it suits dry, low-traffic rooms. If you want protection, ask about a glazed frame under Special presentation.</p>'''
f += table("Framed print, wood frame, no glass (shop listing, to be confirmed)", ["Size", "Material", "Included", "Not included", "Price (listing)"], [
 [s, "Print + wood frame (black, white or oak)", "Print, frame, backing", "Glass, mount, delivery", pr] for s, pr in
 [("20x30cm", "&pound;35"), ("30x30cm", "&pound;40"), ("30x40cm", "&pound;45"), ("40x60cm", "&pound;55"), ("50x50cm", "&pound;55"), ("50x75cm", "&pound;75"), ("60x90cm", "&pound;95")]],
 PRICE_NOTE + " The shop listing does not state whether glass is included; this page assumes no glass, to be confirmed.")
f += '''<h3>Removable poster</h3><div class="split"><div><p>A poster printed to be taken down again. Surface suitability and conditions of use are explained when you enquire, and we cannot promise it will come off every wall without a mark. Test a small hidden area first.</p></div>%s</div>''' % img("removable-poster", "Hand repositioning a removable poster on a painted wall")
f += table("Removable poster", ["Size", "Material", "Included", "Not included", "Price"], [["To be confirmed", "Removable poster material, to be confirmed", "Printed poster", "Frame", TBC]])
f += '</div></section>'
f += '''<section class="alt" id="no-drill"><div class="wrap"><h2>2. Hang without drilling: SnappyTack magnetic frames</h2>
<div class="split"><div>%s</div><div>%s</div></div>''' % (facts(
 "You rent, have plasterboard you do not want to drill, or like to swap pictures often.", "A magnetic frame system where the print is held by magnets, so changing pictures is quick.",
 "Renters, offices, anyone who changes displays.", "Magnetic wooden frame (black or oak) with your print.", "Wall fixings or adhesive if the system needs them, delivery.", "Tell us the wall type and the picture size."),
 img("magnetic-frame", "Oak magnetic frame on a wall with no visible fixings"))
f += '''<p><strong>Check your surface and conditions of use.</strong> No-drill hanging depends on the wall surface, paint, weight and how it is fitted. We explain suitable surfaces and limits before you buy. We do not promise damage-free removal from every wall.</p>'''
f += table("SnappyTack magnetic framed print (shop listing, to be confirmed)", ["Size", "Material", "Included", "Not included", "Price (listing)"], [
 ["30x30cm", "Magnetic wood frame, black or oak", "Frame, print", "Delivery", "&pound;49"],
 ["30x40cm", "Magnetic wood frame, black or oak", "Frame, print", "Delivery", "Black &pound;59, oak &pound;49"],
 ["40x50cm", "Magnetic wood frame, black or oak", "Frame, print", "Delivery", "Black &pound;74, oak &pound;49"]],
 PRICE_NOTE + " The oak price is the same at every size in the shop listing, which looks like an error: to be checked.")
f += '''<h3>Magnetic poster hanger</h3><div class="split"><div><p>Two wood-and-magnet bars to hang a poster you already have. A4 (21x30cm) from &pound;29, A3 (30x42cm) &pound;39 (listing, to be confirmed). Poster not included.</p></div>%s</div></div></section>''' % img("magnetic-poster", "Poster hanging between two wooden magnetic bars")
f += '''<section id="frameless"><div class="wrap"><h2>3. Frameless: Dibond and Foamex / PVC board</h2>
<div class="split"><div>%s</div>%s</div>
<div class="split" style="margin-top:28px"><div>%s</div><div><h3>Foamex / PVC board</h3><p>Rigid, lightweight PVC board for signs, shop displays and events. Quoted on request.</p></div></div><div class="compare" style="margin-top:20px"><div><h3>Dibond</h3><p>A rigid aluminium-faced board. The print is mounted on it. A firm, modern look with no frame.</p></div>
<div><h3>Foamex / PVC board</h3><p>A rigid, lightweight PVC board, popular for signs and displays.</p></div>
<div><h3>Kapa-fix / foamboard</h3><p>A different product: paper-faced foam board, lighter and more economical. Not the same as PVC board.</p></div></div>''' % (facts(
 "You want a clean, frameless look, or a rigid board for a shop or event.", "Your print mounted on rigid board, ready to display with hanging fittings if needed.",
 "Modern interiors, shops, exhibitions.", "Print mounted on board.", "Frame, stand, hanging fittings unless quoted, delivery.", "Send the image, size and where it will be used."),
 img("dibond", "Frameless board print on a white wall"), img("foamex", "Rigid printed board on an easel in a shop window area"))
f += table("Dibond print (shop listing, to be confirmed)", ["Size", "Material", "Included", "Not included", "Price (listing)"], [
 ["20x30cm", "Dibond 3mm with Hahnemühle or Permajet paper", "Print mounted on Dibond", "Frame, delivery", "&pound;45"],
 ["30x40cm", "Same", "Print mounted on Dibond", "Frame, delivery", "&pound;65"],
 ["40x60cm", "Same", "Print mounted on Dibond", "Frame, delivery", "&pound;110"],
 ["Up to 60x90cm", "Same", "Print mounted on Dibond", "Frame, delivery", "from &pound;45 up to &pound;175"],
 ["Foamex / PVC board", "Foamex", "Printed board", "Fittings, delivery", TBC]],
 PRICE_NOTE + " The shop has two live Dibond listings at different prices (&pound;45&ndash;&pound;175 and &pound;79.99&ndash;&pound;164.90): to be resolved.")
f += '</div></section>'
f += '''<section class="alt" id="special"><div class="wrap"><h2>4. Special presentation</h2>
<p class="lede">Made to order and quoted individually. We show real examples as they are added.</p><div class="grid g3">%s</div>%s</div></section>''' % ("".join([
 card(img("gallery-frame", "Black framed fine art print"), "Mounted and glazed frames", "Print, mount and glass in a wood frame. Protects the print and gives it room.", "contact-visit.html", "Mounted and glazed frame", "Ask about this"),
 card(img("shirt-frame", "Shirt displayed in a deep black box frame"), "Shirts (forma)", "Deep box frames for sports shirts. Each piece is quoted after we see or measure it.", "contact-visit.html", "Framing a shirt", "Ask about this"),
 card(img("plate-frame", "China plate displayed in a deep oak box frame"), "Plates and objects", "Deep box frames for plates and keepsakes, with a mount colour to suit.", "contact-visit.html", "Framing a plate or object", "Ask about this"),
 card(img("l-frame", "Stretched canvas in an oak floating L frame"), "L / floating frames for canvases", "For artists&rsquo; stretched canvases: a frame that leaves a small gap around the canvas edge.", "contact-visit.html", "L / floating frame for a stretched canvas", "Ask about this")]),
 table("Special presentation", ["Item", "Material", "Included", "Not included", "Price"], [
 ["Mounted and glazed frame", "Wood frame, mount board, glass", "Frame, mount, glass, assembly", "Print unless ordered", TBC],
 ["Shirt, plate or object", "Deep box frame, mount", "To be agreed after inspection", "Items you supply may be returned unframed if unsuitable", TBC],
 ["L / floating frame", "Wood L-profile", "Frame for your canvas", "Canvas", TBC]], "Each is a quoted job: send photos, sizes and what the piece is for."))
f += actions("Special presentation framing") + '</div></section>'
f += prodsec([x["slug"] for x in PRODUCTS if x["group"]=="Framing & Display"], "Every display option, with prices")
f += quote_block("Economy framed print or poster", SERVICES)
pages["framing-display.html"] = page("", "Framing & Display in Maidstone", "Economy frames, no-drill magnetic frames, Dibond and Foamex boards, and special presentation framing from a Maidstone studio.", "", f, "Economy framed print or poster", "framing-display.html")

# ---------------- IRIS ----------------
i = hero("Iris Photography", "A close-up portrait of the iris, made into something to keep",
    "For one person, a couple or a family. Photographed, printed and presented, with gift vouchers if you would like to give it as a present.",
    "Iris photography", img("iris", "Close-up of an iris print in a slim frame", eager=True))
i += '''<section class="alt"><div class="wrap"><h2>Real examples</h2><p class="lede">Real work only. These slots are reserved for photographs from past sessions, with the client&rsquo;s permission.</p>
<div class="grid g3">%s%s%s</div></div></section>''' % (ph("Single-person iris example to be supplied", 1, 1), ph("Couple iris example to be supplied", 1, 1), ph("Family iris example to be supplied", 1, 1))
i += '''<section><div class="wrap"><h2>How a session works</h2>
<ol class="steps"><li><h3>Message us</h3><p>Tell us who the session is for, how many people and what you would like to end up with.</p></li>
<li><h3>Choose a package</h3><p>Packages are based on how many irises are photographed, then print size and finish.</p></li>
<li><h3>The session</h3><p>Session length, place and preparation are confirmed when you enquire.</p></li>
<li><h3>Choose your pictures and products</h3><p>Digital files and physical products are separate choices. See the table below.</p></li></ol>
%s</div></section>''' % facts(
 "You want a personal, unusual portrait or gift that is not a standard photo.", "An iris photography session with a print or digital choice, for one person, a couple or a family.",
 "Individuals, couples, families, gift givers.", "Session and the package you choose. Exact inclusions are to be confirmed by Giftly.", "Extra irises, bigger sizes, other finishes, and digital files if not in your package.", "Message us with who it is for and a rough budget.")
i += '<section class="alt"><div class="wrap"><h2>Package prices</h2><p>Each package is priced by the number of irises (&ldquo;eyes&rdquo;), print size and finish. The shop sells these as gift voucher options.</p>'
i += table("Iris package examples (voucher listing, to be confirmed)", ["Package", "Size and finish", "Included", "Not included", "Price (listing)"], [
 ["1 eye", "30x30cm, gallery frame", "Session, one framed print", "Digital files, extra eyes", "&pound;129"],
 ["1 eye", "30x30cm, acrylic print", "Session, one acrylic print", "Digital files, frame", "&pound;149"],
 ["1 eye", "60x90cm, gallery frame", "Session, one framed print", "Digital files", "&pound;299"],
 ["2 eyes", "30x30cm, gallery frame", "Session, two irises", "Digital files", "&pound;159"],
 ["2 eyes", "60x90cm, acrylic print", "Session, two irises", "Digital files, frame", "&pound;379"],
 ["3 to 6 eyes", "Sizes from 30x45cm", "To be confirmed", "To be confirmed", "from &pound;214 (listing)"]],
 PRICE_NOTE + " What each package includes (session length, digital files) has not been supplied: to be confirmed.")
i += '''<h3>Deposit and balance</h3>''' + table("Payment structure", ["Item", "Amount"], [["Deposit to book", TBC], ["Balance due", TBC], ["When the balance is paid", TBC]], "Deposit and balance are shown separately once confirmed.")
i += '<h3>Other voucher and gift options (shop listing)</h3>' + table("Iris gift vouchers", ["Voucher", "Material", "Included", "Not included", "Price (listing)"], [
 ["Iris Photography Gift Voucher", "Gallery frame or acrylic print", "Session and print", "Digital files", "&pound;129 &ndash; &pound;479"],
 ["Mini Framed Iris", "Mini frame", "Session and mini framed print", "Other products", "&pound;69 &ndash; &pound;119"],
 ["Iris Acrylic Block", "Acrylic block", "Session and block", "Other products", "&pound;89 &ndash; &pound;119"],
 ["Iris Necklace", "Necklace", "Session and necklace", "Other products", "&pound;74"],
 ["Iris Round Photo Slate", "Slate", "Session and slate", "Other products", "&pound;74 &ndash; &pound;104"],
 ["Iris Aluminium Desk Plate", "Aluminium", "Session and plate", "Other products", "&pound;78 &ndash; &pound;108"],
 ["Digital Art HD voucher", "Digital", "Digital files", "Print", "&pound;49 &ndash; &pound;79"]], "Voucher contents are inferred from product names only: to be confirmed.")
i += '''<h3>Order again from a session you have already had</h3><p>If you have had an Iris session with us, message with the name and rough date and we will find your pictures and quote another print, gift or digital copy.</p>%s</div></section>''' % actions("Iris photography", "Ask about Iris on WhatsApp")
i += prodsec(["iris-gift-vouchers"], "Iris gift vouchers")
i += quote_block("Iris photography", SERVICES)
pages["iris-photography.html"] = page("", "Iris Photography in Maidstone", "Iris photography for one person, couples and families, with gift vouchers. Maidstone, Kent.", "", i, "Iris photography", "iris-photography.html")

# ---------------- BUSINESS ----------------
b = hero("Business Printing", "Small-run printing for Maidstone and Kent businesses",
    "Need 50 flyers, a set of menus or one big poster? We quote small quantities properly, with no pressure to order thousands.",
    "Business printing", img("business-print", "Flyers, business cards and a folded menu on an oak table", eager=True))
b += '''<section class="alt"><div class="wrap"><h2>What we can print</h2><div class="grid g3">%s</div></div></section>''' % "".join(
 ncard(h, t, "#quote", h, "Ask for a quote") for h, t in [
 ("Flyers and leaflets", "Promotions, events and information in small runs."), ("Business cards", "Simple cards for new or growing businesses."),
 ("Menus and price lists", "Easy to reprint when prices change."), ("Posters", "For windows, notice boards and events."),
 ("A-board posters and panels", "Replacement inserts and panels for your pavement sign."), ("Vinyl printing", "Printed vinyl for windows, walls and signs. Application is not included unless agreed."),
 ("Foamex and Dibond board prints", "Rigid boards for signs and displays."),])
b += '''<section><div class="wrap"><h2>What we need for a quote</h2><ul class="checks"><li>Product and quantity</li><li>Size</li><li>Your file or logo (or say you need help)</li><li>The date you need it</li><li>Collection from the studio or delivery in Kent</li></ul>
<p>For a clear quote, please send your image and requirements by WhatsApp or email.</p>%s
<h2 style="margin-top:32px">What is included and what is not</h2>''' % actions("Business printing")
b += table("Scope of a business printing job", ["Item", "Included in print price", "Quoted separately", "Notes"], [
 ["Printing and trimming", "Yes", "&mdash;", "From your print-ready file"],
 ["Design or layout", "Not unless agreed", "Yes", "Tell us if you need a design"],
 ["File preparation or fixing", "Not unless agreed", "Yes", "We tell you what needs fixing before we start"],
 ["Stands, holders, A-board frames", "No", "Yes", "Supplied only if quoted"],
 ["Installation or vinyl application", "No", "Yes", "To be confirmed whether offered"],
 ["Delivery", "No", "Yes", "Collection or delivery to be confirmed"]])
b += table("Business printing prices", ["Product and quantity", "Material", "Included", "Not included", "Price"], [
 ["Flyers and leaflets, small run", "Paper stock to be confirmed", "Printing", "Design, delivery", TBC], ["Business cards, small run", "Card stock to be confirmed", "Printing", "Design", TBC],
 ["Menus / price lists", "Paper to be confirmed", "Printing", "Design, laminating unless quoted", TBC], ["Posters", "Paper to be confirmed", "Printing", "Frame", TBC],
 ["A-board panel", "Poster paper or board", "Printing", "A-board itself", TBC], ["Vinyl", "Vinyl", "Printing", "Application", TBC], ["Foamex / Dibond", "Board", "Print on board", "Fittings, installation", TBC]],
 "No source prices exist yet for business printing. Every price here is to be confirmed by Giftly.")
b += '<div class="split"><div><h3>Vinyl and window graphics</h3><p>Printed vinyl for windows and signs. Application is quoted separately.</p></div>%s</div>' % img("vinyl", "Printed vinyl graphic on a shop window")
b += '<div class="split" style="margin-top:28px"><div><h3>Rigid board prints</h3><p>Dibond is available now in the shop. Foamex and PVC board are quoted on request.</p></div>%s</div></div></section>' % img("dibond", "Frameless board print on a white wall")
b += prodsec(["flyers-and-leaflets","business-cards","menus-and-price-lists","posters-and-a-boards","vinyl-printing","foamex-board-print"], "Business printing products")
b += quote_block("Business printing", SERVICES)
pages["business-printing.html"] = page("", "Business Printing in Maidstone & Kent", "Small-run flyers, business cards, menus, posters, A-board panels, vinyl and board prints for Maidstone and Kent businesses.", "", b, "Business printing", "business-printing.html")

# ---------------- RESTORATION ----------------
r = hero("Photo Restoration", "Bring an old photograph back, without over-promising",
    "Fading, scratches, creases and stains can often be improved. We look at your photo first and then give you a price.",
    "Photo restoration", img("restoration", "Old faded photograph on a desk with a soft brush and cotton gloves", eager=True))
r += '''<section class="alt"><div class="wrap"><h2>Real before and after examples</h2><div class="grid g2">%s%s</div><p class="note">Real client work, with permission, is to be supplied. Please do not use stock examples here.</p></div></section>''' % (ph("Before image to be supplied", 4, 3), ph("After image to be supplied", 4, 3))
r += '''<section><div class="wrap"><h2>How it works</h2>
<ol class="steps"><li><h3>Send the photo</h3><p>A clear scan or a photo of the original, by WhatsApp or email.</p></li><li><h3>We assess</h3><p>We look at fading, scratches and damage and tell you what can be improved.</p></li>
<li><h3>You get a price</h3><p>Only after we have seen the photo. Results vary and we cannot promise the same outcome for every photo.</p></li><li><h3>Choose your extras</h3><p>Colourising, printing and framing are optional.</p></li></ol>
%s</div></section>''' % facts("Old family photos are faded, scratched, torn or stained.", "Digital restoration, with optional colourising, printing and framing as separate choices.",
 "Family photos, wedding pictures, anything with sentimental value.", "Assessment and the restoration option you choose.", "Colourising, print, frame, and complex repair.", "Send a scan or photo of the original.")
r += '<section class="alt"><div class="wrap"><h2>Prices</h2><p>The shop lists fixed prices by service, format and size. Because we assess first, treat these as starting points; the final price follows the inspection.</p>'
r += table("Photo restoration (shop listing, to be confirmed)", ["Format and size", "Restoration only", "Restoration and colourising", "Included", "Price (listing)"], [
 ["Digital file only (any size)", "&pound;20", "&pound;25", "Restored digital file", "from &pound;20"],
 ["Fine art print A4", "&pound;35", "&pound;45", "Restoration and print", "from &pound;35"],
 ["Fine art print A3", "&pound;50", "&pound;65", "Restoration and print", "from &pound;50"],
 ["Fine art print A2", "&pound;80", "&pound;95", "Restoration and print", "from &pound;80"],
 ["Framed print A4", "&pound;70", "&pound;80", "Restoration, print and frame", "from &pound;70"],
 ["Framed print A3", "&pound;100", "&pound;115", "Restoration, print and frame", "from &pound;100"],
 ["Framed print A2", "&pound;150", "&pound;165", "Restoration, print and frame", "from &pound;150"]],
 PRICE_NOTE + " The shop gives the same digital price for every size and calls the studio &ldquo;Hahnemühle Certified&rdquo;; this claim is not repeated here until verified. Heavily damaged photos are quoted individually.")
r += actions("Photo restoration") + '</div></section>'
r += quote_block("Photo restoration", SERVICES)
pages["photo-restoration.html"] = page("", "Photo Restoration in Maidstone", "Old, faded or damaged photo restoration with optional colourising, printing and framing. Assessment first, then price.", "", r, "Photo restoration", "photo-restoration.html")

# ---------------- GIFTS ----------------
g = hero("Personalised Gifts", "A short list of gifts we do well",
    "Photo blocks, collages and Iris vouchers. A small, chosen range, personalised with your pictures.",
    "Personalised gift", img("photo-gifts", "Acrylic block, small wood frame and collage print arranged on a desk", eager=True))
g += '''<section class="alt"><div class="wrap"><h2>Ready-made design or fully custom?</h2><div class="compare">
<div><h3>Ready-made design, your details</h3><p>You choose a layout and we add your photos and wording. Quicker and more affordable. Prices below are for this.</p></div>
<div><h3>Custom design</h3><p>If you want something drawn up from scratch, we quote the design work separately before starting. Send your idea.</p></div></div></div></section>
<section id="acrylic"><div class="wrap"><h2>Acrylic photo blocks</h2><div class="split"><div>%s</div>%s</div>''' % (facts(
 "You want a photo that sits on a desk or shelf without a frame.", "A clear acrylic block with your photo, with a magnetic version in the shop.", "Birthdays, Mother&rsquo;s Day, Valentine&rsquo;s Day, new homes.", "Block and your printed photo.", "Gift wrapping if offered, delivery.", "Send your photo and the size."),
 img("acrylic-block", "Clear acrylic photo block on a wooden desk"))
g += table("Acrylic photo block (shop listing, to be confirmed)", ["Size", "Material", "Included", "Not included", "Price (listing)"], [
 ["10x10cm", "Acrylic", "Block and print", "Delivery", "&pound;17"], ["10x15cm", "Acrylic", "Block and print", "Delivery", "&pound;20"], ["13x18cm", "Acrylic", "Block and print", "Delivery", "&pound;25"]], PRICE_NOTE)
g += '</div></section><section class="alt" id="collages"><div class="wrap"><h2>Wedding, anniversary, family and new baby prints; photo collages</h2><div class="grid g2">%s%s</div>' % (
 img("wedding-collage", "Personalised wedding photo collage print"), img("newborn-collage", "Personalised newborn baby photo collage print"))
g += table("Collage prints (shop listing, to be confirmed)", ["Product and size", "Material", "Included", "Not included", "Price (listing)"], [
 ["Wedding collage 30x40cm", "Print", "Ready-made layout, your photos", "Frame, custom design", "&pound;45"], ["Wedding collage 40x50cm", "Print", "Ready-made layout, your photos", "Frame, custom design", "&pound;60"],
 ["New baby collage 30x40cm", "Print, frame colour black, oak or white", "Ready-made layout, your photos", "Custom design", "&pound;45"], ["New baby collage 40x50cm", "Print, frame colour black, oak or white", "Ready-made layout, your photos", "Custom design", "&pound;65"],
 ["Anniversary and family prints", "To be confirmed", "To be confirmed", "To be confirmed", TBC]], PRICE_NOTE + " Whether the shop prices include the frame is not stated: to be confirmed.")
g += '</div></section><section><div class="wrap"><h2>Iris gift vouchers</h2><div class="split"><div><p>Give an Iris Photography session. Choose a voucher and the person redeems it with us. See the packages and prices on the Iris Photography page.</p><p><a href="iris-photography.html">Iris Photography and vouchers</a></p></div>%s</div></div></section>' % img("iris-gift", "Cream gift voucher card on tissue paper with a green ribbon")
g += '<section class="alt"><div class="wrap"><p>Send your photo, the occasion and the date you need the gift.</p>%s</div></section>' % actions("Personalised gift")
g += prodsec(["acrylic-photo-block","photo-collage-prints","iris-gift-vouchers"], "Gift product pages")
g += quote_block("Personalised gift", SERVICES)
pages["personalised-gifts.html"] = page("", "Personalised Gifts in Maidstone", "A small range of personalised photo gifts: acrylic blocks, wedding, anniversary, family and new baby prints, collages and Iris vouchers.", "", g, "Personalised gift", "personalised-gifts.html")

# ---------------- CONTACT ----------------
c = hero("Contact / Visit", "Message us first, then visit if you like",
    "WhatsApp is the quickest way to start. Email works well too. Send your image and details and we will reply with a clear quote.",
    "Something else", ph("Studio or shop front photo to be supplied", 16, 10))
c += '''<section class="alt"><div class="wrap"><h2>What to send</h2><ul class="checks"><li><strong>Image</strong> (the photo or file)</li><li><strong>Size</strong> you want, or where it will go</li><li><strong>Quantity</strong></li><li><strong>Budget</strong>, if you have one</li><li><strong>Date</strong> you need it by</li></ul>
<p>For a clear quote, please send your image and requirements by WhatsApp or email.</p><div class="grid g2">
<div class="card"><div class="body"><h3>1. WhatsApp (best)</h3><p>07445 250359</p>%s</div></div>
<div class="card"><div class="body"><h3>2. Email</h3><p>%s</p>%s</div></div></div></div></section>''' % (wa_btn("Something else", "Open WhatsApp"), MAIL, mail_btn("Something else", "Write an email"))
c += '''<section><div class="wrap"><h2>Visit the studio</h2><dl class="facts">
<div><dt>Address</dt><dd>Giftly Art Print, Units 24&ndash;25, Royal Star Arcade, Maidstone, Kent</dd></div>
<div><dt>Opening hours</dt><dd>To be confirmed. Please message before travelling.</dd></div>
<div><dt>Postcode, parking, access</dt><dd>To be confirmed.</dd></div>
<div><dt>Collections and deliveries</dt><dd>The address above is for visits. Dispatch and return details will be given when you order and are not the same as the visit address.</dd></div></dl>
<h2>Ordering online</h2><p>During this review nothing is ordered through this prototype. Quotes and orders go through WhatsApp or email. The existing online shop at <a href="https://www.giftlyartprint.co.uk/" rel="noopener">giftlyartprint.co.uk</a> is unchanged. Individual shop order links will be added only once each has been checked.</p></div></section>'''
c += quote_block("Something else", SERVICES)
pages["contact-visit.html"] = page("", "Contact & Visit Giftly Art Print, Maidstone", "Contact Giftly Art Print by WhatsApp or email, and find the studio in Royal Star Arcade, Maidstone.", "", c, "Something else", "contact-visit.html")


# ---------------- PRODUCT PAGES ----------------
CRUMB_HUB = {}
for pr in PRODUCTS:
    sec = SECTION_OF[pr["group"]]
    steps = ("<ol class='steps'><li><h3>Send the details</h3><p>%s</p></li><li><h3>We check and quote</h3><p>You get a clear quote with what is included and what is extra.</p></li><li><h3>You decide</h3><p>We only go ahead when you are happy with the quote.</p></li></ol>"
             % ("Product, quantity, size, your file, date needed and collection or delivery." if pr["group"] == "Business Printing" else "Your image or item, the size you have in mind and where it will go."))
    nextstep = "Send the details by WhatsApp or email. For a clear quote, please send your image and requirements."
    t = pr["table"]
    body = hero(pr["group"] + " · " + pr["sub"], pr["name"], pr["lede"], pr["name"], img(pr["imgs"][0][0], pr["imgs"][0][1], eager=True))
    body = body.replace('<section class="hero">', '<nav class="crumbs" aria-label="Breadcrumb"><div class="wrap"><a href="index.html">Home</a> / <a href="%s">%s</a> / <a href="%s">%s</a> / <span aria-current="page">%s</span></div></nav><section class="hero">' % (sec, e(LONG[sec]), pr["hub"], pr["sub"], e(pr["name"])), 1)
    body += '<section class="alt"><div class="wrap"><h2>Does this sound like you?</h2><div class="grid g2">%s</div></div></section>' % "".join(
        '<article class="qa"><h3>%s</h3><p>%s</p></article>' % (q, a) for q, a in pr["qa"])
    body += '<section><div class="wrap split"><div><h2>The problem, and our answer</h2>%s</div>%s</div></section>' % (
        facts(pr["problem"], pr["solution"], pr["who"], pr["included"], pr["extra"], nextstep), img(pr["imgs"][1][0], pr["imgs"][1][1]))
    body += '<section class="alt"><div class="wrap center"><h2>How it works</h2>%s</div></section>' % steps
    body += '<section><div class="wrap"><h2>Price list</h2>%s%s</div></section>' % (table(t["caption"], t["heads"], t["rows"], t["note"]), actions(pr["name"], "Ask about this on WhatsApp"))
    faq = "".join("<details><summary>%s</summary><p>%s</p></details>" % (q, a) for q, a in pr["faq"])
    body += '<section class="alt"><div class="wrap split rev"><div><h2>Common questions</h2>%s</div>%s</div></section>' % (faq, img(pr["imgs"][2][0], pr["imgs"][2][1]))
    body += prodsec(pr["related"], "You may also like", "Related options, each with its own price list.")
    body += quote_block(pr["name"], SERVICES)
    pages[pu(pr["slug"])] = page("", pr["name"] + " in Maidstone", pr["lede"].replace("&rsquo;", "'").replace("&amp;", "&"), "", body, pr["name"], pu(pr["slug"]), sec)


# ---------------- RECENT WORK ARCHIVE ----------------
ar = hero("Recent work", "Every job we have shared", "Newest first. Each entry shows what was asked for and what we did.", "Something else", img("hero", "Oak-framed print on a pale wall", eager=True))
ar += '<section><div class="wrap"><p class="note">Review draft: every entry below is a sample, not a real job. Replace with real photos, descriptions and dates.</p><ul class="rw-grid">%s</ul></div></section>' % "".join('<li>%s</li>' % work_card(w) for w in WORKS)
ar += quote_block("Something else", SERVICES)
pages["recent-work.html"] = page("", "Recent Work, Giftly Art Print Maidstone", "Recent printing, framing, restoration and gift jobs from Giftly Art Print in Maidstone.", "", ar, "Something else", "recent-work.html")

for fn, content in pages.items():
    with open(os.path.join(ROOT, fn), "w", encoding="utf-8") as fh:
        fh.write(content)
print("pages:", len(pages)); print("unused images:", [k for k in IMAGES if k not in USED])
with open(os.path.join(ROOT, "assets/img/SOURCES.md"), "w") as fh:
    fh.write("# Image sources\n\nEvery image here is an **illustrative image generated for this review draft** with the OpenAI Images API (model gpt-image-2) using the prompts in `tools/gen_images.py`. They are not photographs of Giftly products or customer work and must not be presented as such.\n\nReplace them with real Giftly photographs before launch. Real shop images exist on the current Shopify store (not downloaded: that host was blocked in the build environment).\n\n| File | Used for |\n|---|---|\n")
    for k in IMAGES:
        if k in USED: fh.write("| %s | illustrative |\n" % IMAGES[k][0])
