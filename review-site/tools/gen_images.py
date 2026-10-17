#!/usr/bin/env python3
"""Generates the illustrative images with the OpenAI Images API (key injected by the sandbox proxy).
Usage: python3 -I tools/gen_images.py [key ...]"""
import base64, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
S = ("Professional editorial product photography, soft natural window light, clean off-white and light grey minimal interior, "
     "calm and uncluttered, shallow depth of field, high-end catalogue look. No text, no letters, no logos, no watermark, no faces.")
ART = "a quiet misty green hills landscape photograph"
P = {
 "hero": "A large oak-framed print of "+ART+" hanging on a pale warm-white wall above a simple oak sideboard with a small green plant, wide composition with empty wall space on the left.",
 "framed-oak": "A single oak wood framed print of "+ART+" leaning on a light shelf, close three-quarter view.",
 "framed-black": "A slim black wood framed print of a black and white city skyline photograph hanging on a pale wall, straight-on view.",
 "framed-white": "A white wood framed square print of a calm coastal seascape on a pale grey wall with soft shadow.",
 "gallery-frame": "A mounted and glazed black frame with wide white mount board holding "+ART+", hanging in a bright modern living room.",
 "acrylic-block": "A clear acrylic photo block standing on a light wooden desk, showing a warm sunset landscape photo, small ceramic mug blurred behind.",
 "kapa-board": "A lightweight foam board mounted photo print of "+ART+" leaning against a white wall on a wooden floor, thin clean edges visible.",
 "magnetic-frame": "A slim oak magnetic framed print hanging on a pale painted wall with no screws or nails visible, rental flat feeling, soft daylight.",
 "magnetic-poster": "A poster held between two slim wooden magnetic hanger bars on a pale wall, poster shows an abstract botanical illustration.",
 "removable-poster": "A poster being gently peeled and repositioned on a pale painted wall by a hand, poster shows a simple abstract landscape.",
 "dibond": "A frameless aluminium composite board print of "+ART+" mounted on a white wall, crisp thin edge and slight float from the wall.",
 "foamex": "A rigid white PVC foamex board display print standing on an easel in a small shop window area, bright clean graphic of colours but no readable text.",
 "business-print": "A tidy flat lay of small-run business printing: a stack of flyers, a fan of business cards, a folded menu and a price list on a light oak table, all with blank abstract layouts and no readable text.",
 "vinyl": "A shop window with a printed vinyl graphic applied, soft reflections, high street shopfront, graphic shows abstract green and terracotta shapes with no text.",
 "restoration": "An old faded vintage family photograph with soft creases lying on a desk beside a soft brush and cotton gloves, scene only, subjects in the photo are small and blurred.",
 "iris": "An extreme macro photograph of a human iris with rich green and amber fibres, elegant, printed look, centred, dark surround, no face visible.",
 "iris-gift": "An elegant cream gift voucher card with a blank embossed panel resting on a small green ribbon and tissue paper, no text.",
 "wedding-collage": "A framed photo collage print with a neat grid layout of several blurred warm wedding-style photos in a white mount on a pale wall, no readable text.",
 "newborn-collage": "A framed photo collage print with a soft neutral grid layout of blurred pastel baby-themed photos in an oak frame on a pale wall, no readable text.",
 "photo-gifts": "A small group of personalised photo gifts arranged on a light desk: an acrylic block, a small wood frame and a collage print, tidy arrangement.",
 "paper-tube": "Rolled photo prints in a kraft postal tube with rolled fine art paper beside it on a light table, tidy and premium.",
 "existing-frame": "Hands carefully sliding a printed photograph into an empty oak picture frame on a work table, tape measure and pencil beside it, close view, hands only.",
 "shirt-frame": "A football shirt neatly mounted in a deep black box frame on a pale wall, shirt is plain with no logo and no text.",
 "plate-frame": "A decorative china plate displayed in a deep oak box frame on a dark green mount, pale wall, no text.",
 "flyers": "A neat stack of A5 flyers fanned on a light oak counter in a small independent cafe, blank abstract layout in green and terracotta shapes, no readable text.",
 "business-cards": "A fan of plain business cards with a simple abstract geometric design on a pale stone surface next to a small plant, no readable text.",
 "menu-print": "A folded restaurant menu and a single price list sheet on a cafe table with a coffee cup, layouts shown as abstract blocks, no readable text.",
 "a-board": "A wooden A-board pavement sign outside a small independent shop on a high street, with a printed poster panel showing abstract colour shapes, no readable text.",
 "poster-print": "A large printed poster of abstract colour shapes being unrolled on a clean worktable beside a metal ruler, tidy print studio feel.",
 "l-frame": "A stretched artist's canvas of an abstract painting in a slim oak floating L frame with a small gap around the canvas edge, hanging on a pale wall.",
}
def gen(k):
    out = os.path.join(os.path.dirname(__file__), "..", "assets", "img", k + ".jpg")
    if os.path.exists(out): return k, "exists"
    body = json.dumps({"model": "gpt-image-2", "prompt": P[k] + " " + S, "size": "1536x1024", "quality": "medium", "output_format": "jpeg", "n": 1}).encode()
    req = urllib.request.Request("https://api.openai.com/v1/images/generations", body, {"Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=300))
        open(out, "wb").write(base64.b64decode(d["data"][0]["b64_json"])); return k, "ok"
    except Exception as e:
        return k, "FAIL %s %s" % (e, getattr(e, "read", lambda: b"")()[:300])
keys = sys.argv[1:] or list(P)
with ThreadPoolExecutor(6) as ex:
    for k, r in ex.map(gen, keys): print(k, r, flush=True)
