#!/usr/bin/env python3
"""Generates the Shopify (Dawn-compatible) package into ../shopify:
  sections/gap-page.liquid         flexible block-based page builder
  sections/gap-recent-work.liquid  recent work carousel / grid (data: metaobject recent_work)
  templates/page.gap-*.json        one page template per product page (from tools/products_data.py)
Run: python3 -I tools/make_shopify.py"""
import json, os, sys, re, html
sys.path.insert(0, os.path.dirname(__file__))
from products_data import PRODUCTS
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "shopify")
OUT = os.path.abspath(OUT)

def sel(id, label, opts, default, info=None):
    d = {"type": "select", "id": id, "label": label, "options": [{"value": v, "label": l} for v, l in opts], "default": default}
    if info: d["info"] = info
    return d
def rng(id, label, mn, mx, st, default, unit="px"):
    return {"type": "range", "id": id, "label": label, "min": mn, "max": mx, "step": st, "unit": unit, "default": default}
def txt(id, label, default=None, kind="text", info=None):
    d = {"type": kind, "id": id, "label": label}
    if default is not None: d["default"] = default
    if info: d["info"] = info
    return d
def col(id, label, default=None, info=None):
    d = {"type": "color", "id": id, "label": label}
    if default: d["default"] = default
    if info: d["info"] = info
    return d
def hdr(c): return {"type": "header", "content": c}
WIDTH = sel("layout_width", "Page width", [("contained", "Standard (centred)"), ("fullwidth", "Full width")], "contained")
HSIZE = sel("heading_size", "Heading size", [("sm", "Small"), ("md", "Medium"), ("lg", "Large"), ("xl", "Extra large")], "lg")
ALIGN = sel("text_align", "Text alignment", [("left", "Left"), ("center", "Centre"), ("right", "Right")], "left")
BODYSIZE = sel("text_size", "Body text size", [("sm", "Small"), ("md", "Medium"), ("lg", "Large")], "md")
RATIOS = [("3/2", "3:2 landscape"), ("4/3", "4:3 landscape"), ("16/9", "16:9 wide"), ("21/9", "21:9 panorama"), ("1/1", "1:1 square"), ("4/5", "4:5 portrait"), ("3/4", "3:4 portrait"), ("auto", "Original (no crop)")]
def colours(bg=True):
    r = [hdr("Colours")]
    if bg: r.append(col("background_color", "Background"))
    r += [col("heading_color", "Heading colour"), col("text_color", "Text colour"), col("accent_color", "Accent colour (labels, links)")]
    return r
PAD = [hdr("Spacing"), rng("padding_top", "Top padding", 0, 160, 4, 56), rng("padding_bottom", "Bottom padding", 0, 160, 4, 56)]
def image_set(prefix="", ratio="3/2", with_radius=True):
    r = [hdr("Image"), {"type": "image_picker", "id": prefix + "image", "label": "Image"}, txt(prefix + "image_alt", "Image alt text", None, "text", "Describe the picture for search engines and screen readers."),
         sel(prefix + "aspect_ratio", "Image aspect ratio", RATIOS, ratio), sel(prefix + "image_fit", "Image fit", [("cover", "Fill and crop"), ("contain", "Show whole image")], "cover")]
    if with_radius: r.append(rng(prefix + "image_radius", "Image corner radius", 0, 48, 2, 18))
    return r
BTN = [hdr("Buttons"), txt("btn_label", "Button 1 label"), txt("btn_link", "Button 1 link", None, "url"), sel("btn_style", "Button 1 style", [("whatsapp", "WhatsApp green"), ("primary", "Blue"), ("dark", "Dark"), ("outline", "Outline"), ("light", "Light")], "whatsapp"),
       txt("btn2_label", "Button 2 label"), txt("btn2_link", "Button 2 link", None, "url"), sel("btn2_style", "Button 2 style", [("outline", "Outline"), ("primary", "Blue"), ("dark", "Dark"), ("light", "Light"), ("whatsapp", "WhatsApp green")], "outline"),
       sel("btn_size", "Button size", [("sm", "Small"), ("md", "Medium"), ("lg", "Large")], "md")]
EYE = [txt("eyebrow", "Small label above heading"), txt("heading", "Heading")]

def btn_liquid(b="block"):
    return """
        {%- if __B__.settings.btn_label != blank or __B__.settings.btn2_label != blank -%}
          <div class="gap-actions gap-justify--{{ al }}">
            {%- if __B__.settings.btn_label != blank -%}<a class="gap-btn gap-btn--{{ __B__.settings.btn_style | default: 'whatsapp' }} gap-btn--{{ __B__.settings.btn_size | default: 'md' }}" href="{{ __B__.settings.btn_link | default: '#' }}"{% if __B__.settings.btn_link contains 'wa.me' %} target="_blank" rel="noopener"{% endif %}>{{ __B__.settings.btn_label }}</a>{%- endif -%}
            {%- if __B__.settings.btn2_label != blank -%}<a class="gap-btn gap-btn--{{ __B__.settings.btn2_style | default: 'outline' }} gap-btn--{{ __B__.settings.btn_size | default: 'md' }}" href="{{ __B__.settings.btn2_link | default: '#' }}">{{ __B__.settings.btn2_label }}</a>{%- endif -%}
          </div>
        {%- endif -%}""".replace("__B__", b)
def img_liquid(prefix="", b="block", eager=False, sizes="(min-width: 1000px) 50vw, 100vw", wide=False):
    load = "loading: 'eager', fetchpriority: 'high'" if eager else "loading: 'lazy'"
    return """
        {%- if __B__.settings.__P__image != blank -%}
          {%- liquid
            assign ar = __B__.settings.__P__aspect_ratio | default: '3/2'
            assign fit = __B__.settings.__P__image_fit | default: 'cover'
            assign rad = __B__.settings.__P__image_radius | default: 18
            assign alt = __B__.settings.__P__image_alt | default: __B__.settings.heading
            assign img_class = 'gap-img gap-fit--' | append: fit
          -%}
          <div class="gap-media{% if ar == 'auto' %} gap-media--auto{% endif %}" style="{% unless ar == 'auto' %}aspect-ratio:{{ ar }};{% endunless %}border-radius:{{ rad }}px">
            {{ __B__.settings.__P__image | image_url: width: 1800 | image_tag: __LOAD__, sizes: '__SIZES__', widths: '400, 700, 1000, 1400, 1800', alt: alt, class: img_class }}
          </div>
        {%- elsif request.design_mode -%}
          <div class="gap-media gap-media--empty" style="aspect-ratio:{{ __B__.settings.__P__aspect_ratio | default: '3/2' }}">Add an image</div>
        {%- endif -%}""".replace("__B__", b).replace("__P__", prefix).replace("__LOAD__", load).replace("__SIZES__", sizes)

# ------------------------------------------------------------------ gap-page.liquid
CSS = r"""
.gap-pg{--gap-ink:#1d1d1f;--gap-muted:#6e6e73;--gap-accent:#b64400;--gap-link:#0066cc;--gap-bg:#fff;--gap-soft:#f5f5f7;--gap-line:#d2d2d7;--gap-max:1024px;color:var(--gap-ink);background:var(--gap-bg);letter-spacing:-.02em;line-height:1.47;-webkit-font-smoothing:antialiased}
.gap-pg *{box-sizing:border-box}
.gap-pg img{max-width:100%;height:auto;display:block}
.gap-outer--contained{max-width:var(--gap-max);margin:0 auto;padding-left:22px;padding-right:22px}
.gap-outer--fullwidth{max-width:100%;padding-left:0;padding-right:0}
.gap-blk{background:var(--gap-b,transparent);color:var(--gap-t,var(--gap-ink))}
.gap-blk .gap-pad{padding-top:var(--gap-pt,56px);padding-bottom:var(--gap-pb,56px)}
.gap-outer--fullwidth .gap-inner{padding-left:22px;padding-right:22px}
.gap-left{text-align:left}.gap-center{text-align:center}.gap-right{text-align:right}
.gap-center .gap-lede,.gap-center .gap-rich{margin-left:auto;margin-right:auto}
.gap-eyebrow{display:block;font-size:1.05rem;font-weight:600;color:var(--gap-a,var(--gap-accent));margin:0 0 .5rem}
.gap-h{font-weight:700;color:var(--gap-h,var(--gap-ink));margin:0 0 .4em;letter-spacing:-.03em;line-height:1.08}
.gap-h--sm{font-size:clamp(1.25rem,2.4vw,1.6rem)}.gap-h--md{font-size:clamp(1.5rem,3.4vw,2.1rem)}.gap-h--lg{font-size:clamp(1.8rem,4.6vw,2.8rem)}.gap-h--xl{font-size:clamp(2.3rem,7vw,4rem)}
.gap-sub{font-size:1.2rem;font-weight:600;margin:0 0 .4rem;color:var(--gap-h,var(--gap-ink))}
.gap-lede{color:var(--gap-muted);font-size:clamp(1.05rem,2.2vw,1.3rem);max-width:44em;margin:0 0 1rem}
.gap-rich{max-width:46em}.gap-rich p{margin:0 0 1em}.gap-rich--sm{font-size:.92rem}.gap-rich--md{font-size:1.05rem}.gap-rich--lg{font-size:1.25rem}
.gap-rich a{color:var(--gap-link)}
.gap-w--narrow{max-width:36em}.gap-w--normal{max-width:46em}.gap-w--wide{max-width:none}
.gap-media{width:100%;overflow:hidden;background:var(--gap-soft);position:relative}
.gap-media--auto{aspect-ratio:auto}
.gap-media .gap-img{width:100%;height:100%}.gap-media--auto .gap-img{height:auto}
.gap-fit--cover{object-fit:cover}.gap-fit--contain{object-fit:contain}
.gap-media--empty{display:flex;align-items:center;justify-content:center;border:2px dashed var(--gap-line);color:var(--gap-muted)}
.gap-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:1.4rem}
.gap-justify--center{justify-content:center}.gap-justify--right{justify-content:flex-end}
.gap-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:980px;border:1px solid transparent;text-decoration:none;font-weight:400;min-height:44px;padding:.6rem 1.4rem;font-size:1.05rem}
.gap-btn--sm{min-height:36px;padding:.4rem 1rem;font-size:.92rem}.gap-btn--lg{min-height:52px;padding:.8rem 1.8rem;font-size:1.15rem}
.gap-btn--whatsapp{background:#1d9a56;color:#fff}.gap-btn--primary{background:#0071e3;color:#fff}.gap-btn--dark{background:#1d1d1f;color:#fff}.gap-btn--light{background:#fff;color:#1d1d1f}
.gap-btn--outline{background:transparent;color:var(--gap-link);border-color:currentColor}
.gap-btn:hover{opacity:.88}
.gap-split{display:grid;gap:36px;align-items:center}
@media(min-width:820px){.gap-split{grid-template-columns:var(--gap-cols,1fr 1fr)}.gap-split--left>.gap-split__media{order:-1}}
.gap-valign--start{align-items:start}.gap-valign--end{align-items:end}
.gap-grid{display:grid;gap:20px;margin-top:1.6rem}
.gap-grid--1{grid-template-columns:1fr}.gap-grid--2{grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}.gap-grid--3{grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}.gap-grid--4{grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))}
.gap-card{background:var(--gap-card,var(--gap-soft));border-radius:var(--gap-radius,18px);overflow:hidden;display:flex;flex-direction:column}
.gap-card .gap-media{border-radius:0!important}
.gap-card__body{padding:22px 24px 26px}
.gap-card__body h3{margin:0 0 .4rem;font-size:1.2rem;line-height:1.2;color:var(--gap-h,var(--gap-ink))}
.gap-card__body p{margin:0 0 .5rem;color:var(--gap-muted)}.gap-card__body a{color:var(--gap-link)}
.gap-steps{list-style:none;padding:0;margin:1.6rem 0 0;display:grid;gap:20px;counter-reset:s;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))}
.gap-steps li{counter-increment:s;background:var(--gap-card,var(--gap-soft));border-radius:var(--gap-radius,18px);padding:24px;text-align:left}
.gap-steps li::before{content:counter(s);display:flex;width:32px;height:32px;border-radius:50%;background:var(--gap-ink);color:#fff;align-items:center;justify-content:center;font-weight:600;font-size:.9rem;margin-bottom:.8rem}
.gap-steps h3{margin:0 0 .3rem;font-size:1.15rem}.gap-steps p{margin:0;color:var(--gap-muted)}
.gap-facts{margin:1.4rem 0 0;border-radius:var(--gap-radius,18px);background:var(--gap-card,var(--gap-soft));overflow:hidden;text-align:left}
.gap-facts div{padding:.9rem 1.3rem;border-top:1px solid rgba(0,0,0,.08)}.gap-facts div:first-child{border-top:0}
.gap-facts dt{font-size:.75rem;font-weight:600;color:var(--gap-muted);text-transform:uppercase;letter-spacing:.04em;margin:0 0 .15rem}.gap-facts dd{margin:0}
@media(min-width:760px){.gap-facts div{display:grid;grid-template-columns:170px 1fr;gap:16px}.gap-facts dt{margin:.25rem 0 0}}
.gap-tbl{overflow-x:auto;margin:1.4rem 0;border-radius:var(--gap-radius,18px);border:1px solid var(--gap-line);background:#fff;text-align:left}
.gap-tbl table{border-collapse:collapse;width:100%;min-width:660px;font-size:.92rem}
.gap-tbl caption{text-align:left;font-size:1.1rem;font-weight:600;padding:1rem 1.2rem .4rem}
.gap-tbl th,.gap-tbl td{text-align:left;padding:.7rem 1.2rem;border-top:1px solid #e8e8ed;vertical-align:top}
.gap-tbl thead th{background:var(--gap-soft);font-size:.75rem;font-weight:600;color:var(--gap-muted);text-transform:uppercase;letter-spacing:.04em}
.gap-tbl td:last-child{font-weight:600;white-space:nowrap}
.gap-note{font-size:.85rem;color:var(--gap-muted)}
.gap-faq details{background:var(--gap-card,var(--gap-soft));border-radius:14px;padding:1rem 1.3rem;margin:.7rem 0;text-align:left}
.gap-faq summary{cursor:pointer;font-weight:600}.gap-faq details p{margin:.6rem 0 0;color:var(--gap-muted)}
.gap-cta{position:relative;overflow:hidden}
.gap-cta__bg{position:absolute;inset:0}.gap-cta__bg .gap-media{height:100%;border-radius:0!important;aspect-ratio:auto!important}
.gap-cta__bg::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,var(--gap-overlay,.45))}
.gap-cta .gap-pad{position:relative}
.gap-form{background:#fff;color:#1d1d1f;border-radius:var(--gap-radius,18px);padding:28px;max-width:820px;margin:1.4rem auto 0;text-align:left;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))}
.gap-form label{display:grid;gap:6px;font-weight:600;font-size:.85rem}
.gap-form input,.gap-form select,.gap-form textarea{font:inherit;font-weight:400;padding:.7rem .85rem;border:1px solid var(--gap-line);border-radius:12px;min-height:44px;width:100%;background:#fff;color:#1d1d1f}
.gap-form .gap-full{grid-column:1/-1}
.gap-pg a:focus-visible,.gap-pg button:focus-visible,.gap-pg input:focus-visible,.gap-pg select:focus-visible,.gap-pg textarea:focus-visible,.gap-pg summary:focus-visible,.gap-tbl:focus-visible{outline:4px solid rgba(0,113,227,.55);outline-offset:2px}
"""
HEAD = """
          {%- if s.eyebrow != blank -%}<span class="gap-eyebrow">{{ s.eyebrow }}</span>{%- endif -%}
          {%- if s.heading != blank -%}<__T__ class="gap-h gap-h--{{ hs }}">{{ s.heading }}</__T__>{%- endif -%}"""
def head(tag="h2"): return HEAD.replace("__T__", tag)
INTRO = """{%- if s.intro != blank -%}<p class="gap-lede">{{ s.intro }}</p>{%- endif -%}"""

# ---- block definitions: type -> (name, settings, liquid)
BLOCKS = {}
def add(t, name, settings, body): BLOCKS[t] = (name, settings, body)

add("hero", "Hero", EYE + [sel("heading_tag", "Heading tag", [("h1", "H1 (use once per page)"), ("h2", "H2")], "h1"), txt("subheading", "Intro text", None, "textarea")] + [WIDTH, HSIZE, ALIGN] + image_set("", "3/2") + BTN + colours() + PAD,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + """
          {%- if s.eyebrow != blank -%}<span class="gap-eyebrow">{{ s.eyebrow }}</span>{%- endif -%}
          {%- if s.heading != blank -%}<{{ s.heading_tag | default: 'h1' }} class="gap-h gap-h--{{ hs }}">{{ s.heading }}</{{ s.heading_tag | default: 'h1' }}>{%- endif -%}
          {%- if s.subheading != blank -%}<p class="gap-lede">{{ s.subheading }}</p>{%- endif -%}""" + btn_liquid("block") + """</div>
        </div>""" + """
        <div class="gap-inner gap-hero-media">""" + img_liquid("", "block", eager=True, sizes="100vw") + """</div>""")
add("image_text", "Image + text", EYE + [txt("text", "Text", None, "richtext"), BODYSIZE, sel("image_position", "Image position", [("left", "Left"), ("right", "Right")], "right"), sel("image_share", "Image width share", [("1fr 1fr", "50 / 50"), ("1.2fr 1fr", "Image larger"), ("1fr 1.2fr", "Text larger"), ("1fr 2fr", "Image wide")], "1fr 1fr"), sel("valign", "Vertical alignment", [("center", "Centre"), ("start", "Top"), ("end", "Bottom")], "center"), WIDTH, HSIZE, ALIGN] + image_set("", "4/3") + BTN + colours() + PAD,
 """<div class="gap-pad"><div class="gap-inner gap-split gap-split--{{ s.image_position | default: 'right' }} gap-valign--{{ s.valign | default: 'center' }}" style="--gap-cols:{% if s.image_position == 'left' %}{{ s.image_share | default: '1fr 1fr' }}{% else %}{{ s.image_share | default: '1fr 1fr' | split: ' ' | reverse | join: ' ' }}{% endif %}">
          <div class="gap-split__text gap-{{ al }}">""" + head("h2") + """
            {%- if s.text != blank -%}<div class="gap-rich gap-rich--{{ ts }}">{{ s.text }}</div>{%- endif -%}""" + btn_liquid("block") + """
          </div>
          <div class="gap-split__media">""" + img_liquid("", "block") + """</div>
        </div></div>""")
add("text_block", "Text", EYE + [txt("intro", "Intro (large grey text)", None, "textarea"), txt("text", "Text", None, "richtext"), BODYSIZE, sel("max_width", "Text width", [("narrow", "Narrow"), ("normal", "Normal"), ("wide", "Full")], "normal"), WIDTH, HSIZE, ALIGN] + BTN + colours() + PAD,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + head("h2") + INTRO + """
          {%- if s.text != blank -%}<div class="gap-rich gap-rich--{{ ts }} gap-w--{{ s.max_width | default: 'normal' }}">{{ s.text }}</div>{%- endif -%}""" + btn_liquid("block") + """
        </div></div>""")
add("grid_section", "Cards: container", EYE + [txt("intro", "Intro", None, "textarea"), txt("block_id", "Block ID", "cards-1", "text", "Child 'Card' blocks use this ID as their Parent ID."), sel("columns", "Columns", [("1", "1"), ("2", "2"), ("3", "3"), ("4", "4")], "3"), WIDTH, HSIZE, ALIGN, col("card_background", "Card background"), rng("card_radius", "Card corner radius", 0, 40, 2, 18)] + colours() + PAD,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + head("h2") + INTRO + """
          <div class="gap-grid gap-grid--{{ s.columns | default: '3' }}" style="{% if s.card_background != blank %}--gap-card:{{ s.card_background }};{% endif %}--gap-radius:{{ s.card_radius | default: 18 }}px">
            {%- for c in section.blocks -%}{%- if c.type == 'grid_item' and c.settings.parent_id == s.block_id -%}
              <article class="gap-card" {{ c.shopify_attributes }}>
                __CARDIMG__
                <div class="gap-card__body"><h3>{{ c.settings.title }}</h3>{%- if c.settings.text != blank -%}<div class="gap-rich gap-rich--md">{{ c.settings.text }}</div>{%- endif -%}
                  {%- if c.settings.link_label != blank -%}<a href="{{ c.settings.link | default: '#' }}">{{ c.settings.link_label }}</a>{%- endif -%}</div>
              </article>
            {%- endif -%}{%- endfor -%}
          </div>
        </div></div>""")
add("grid_item", "Cards: card", [txt("parent_id", "Parent ID", "cards-1", "text", "Must match the container's Block ID."), txt("title", "Title"), txt("text", "Text", None, "richtext"), txt("link_label", "Link label"), txt("link", "Link", None, "url")] + image_set("", "3/2", False), "")
add("steps_section", "Steps: container", EYE + [txt("block_id", "Block ID", "steps-1", "text", "Child 'Step' blocks use this ID as their Parent ID."), WIDTH, HSIZE, ALIGN, col("card_background", "Step background"), rng("card_radius", "Corner radius", 0, 40, 2, 18)] + colours() + PAD,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + head("h2") + """
          <ol class="gap-steps" style="{% if s.card_background != blank %}--gap-card:{{ s.card_background }};{% endif %}--gap-radius:{{ s.card_radius | default: 18 }}px">
            {%- for c in section.blocks -%}{%- if c.type == 'step' and c.settings.parent_id == s.block_id -%}<li {{ c.shopify_attributes }}><h3>{{ c.settings.title }}</h3><p>{{ c.settings.text }}</p></li>{%- endif -%}{%- endfor -%}
          </ol>
        </div></div>""")
add("step", "Steps: step", [txt("parent_id", "Parent ID", "steps-1"), txt("title", "Title"), txt("text", "Text", None, "textarea")], "")
add("facts_section", "Facts list: container", EYE + [txt("block_id", "Block ID", "facts-1"), WIDTH, HSIZE, ALIGN, col("card_background", "Background"), rng("card_radius", "Corner radius", 0, 40, 2, 18)] + colours() + PAD,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + head("h2") + """
          <dl class="gap-facts" style="{% if s.card_background != blank %}--gap-card:{{ s.card_background }};{% endif %}--gap-radius:{{ s.card_radius | default: 18 }}px">
            {%- for c in section.blocks -%}{%- if c.type == 'fact' and c.settings.parent_id == s.block_id -%}<div {{ c.shopify_attributes }}><dt>{{ c.settings.label }}</dt><dd>{{ c.settings.text }}</dd></div>{%- endif -%}{%- endfor -%}
          </dl>
        </div></div>""")
add("fact", "Facts list: row", [txt("parent_id", "Parent ID", "facts-1"), txt("label", "Label (e.g. The problem)"), txt("text", "Text", None, "textarea")], "")
add("price_table", "Price table: container", [txt("block_id", "Block ID", "prices-1"), txt("caption", "Table title"), txt("note", "Note under table", None, "textarea"), txt("col1", "Column 1", "Size / quantity"), txt("col2", "Column 2", "Material"), txt("col3", "Column 3", "Included"), txt("col4", "Column 4", "Not included"), txt("col5", "Column 5", "Price"), WIDTH, HSIZE, ALIGN] + colours() + PAD + BTN,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">
          <div class="gap-tbl" tabindex="0" role="region" aria-label="{{ s.caption | escape }}"><table>
            {%- if s.caption != blank -%}<caption>{{ s.caption }}</caption>{%- endif -%}
            <thead><tr><th scope="col">{{ s.col1 }}</th><th scope="col">{{ s.col2 }}</th><th scope="col">{{ s.col3 }}</th><th scope="col">{{ s.col4 }}</th><th scope="col">{{ s.col5 }}</th></tr></thead>
            <tbody>{%- for c in section.blocks -%}{%- if c.type == 'price_row' and c.settings.parent_id == s.block_id -%}<tr {{ c.shopify_attributes }}><td>{{ c.settings.c1 }}</td><td>{{ c.settings.c2 }}</td><td>{{ c.settings.c3 }}</td><td>{{ c.settings.c4 }}</td><td>{{ c.settings.c5 }}</td></tr>{%- endif -%}{%- endfor -%}</tbody>
          </table></div>
          {%- if s.note != blank -%}<p class="gap-note">{{ s.note }}</p>{%- endif -%}""" + btn_liquid("block") + """
        </div></div>""")
add("price_row", "Price table: row", [txt("parent_id", "Parent ID", "prices-1"), txt("c1", "Size / quantity"), txt("c2", "Material"), txt("c3", "Included"), txt("c4", "Not included"), txt("c5", "Price", None, "text", "Write 'To be confirmed' if the price is not confirmed. Do not invent prices.")], "")
add("faq_section", "FAQ: container", EYE + [txt("block_id", "Block ID", "faq-1"), WIDTH, HSIZE, ALIGN, col("card_background", "Question background")] + colours() + PAD,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + head("h2") + """
          <div class="gap-faq" style="{% if s.card_background != blank %}--gap-card:{{ s.card_background }};{% endif %}">
            {%- for c in section.blocks -%}{%- if c.type == 'faq_item' and c.settings.parent_id == s.block_id -%}<details {{ c.shopify_attributes }}><summary>{{ c.settings.question }}</summary><div class="gap-rich gap-rich--md">{{ c.settings.answer }}</div></details>{%- endif -%}{%- endfor -%}
          </div>
        </div></div>""")
add("faq_item", "FAQ: question", [txt("parent_id", "Parent ID", "faq-1"), txt("question", "Question"), txt("answer", "Answer", None, "richtext")], "")
add("cta", "Call to action", EYE + [txt("text", "Text", None, "textarea"), rng("overlay", "Image overlay darkness", 0, 90, 5, 45, "%"), WIDTH, HSIZE, ALIGN] + image_set("", "21/9", False) + BTN + colours() + PAD,
 """<div class="gap-cta" style="--gap-overlay:{{ s.overlay | default: 45 | divided_by: 100.0 }}">
          {%- if s.image != blank -%}<div class="gap-cta__bg">""" + img_liquid("", "block", sizes="100vw") + """</div>{%- endif -%}
          <div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + head("h2") + """
            {%- if s.text != blank -%}<p class="gap-lede" style="color:inherit">{{ s.text }}</p>{%- endif -%}""" + btn_liquid("block") + """
          </div></div></div>""")
add("spacer", "Spacer", [rng("height", "Height", 0, 200, 4, 40), col("background_color", "Background")], """<div style="height:{{ s.height | default: 40 }}px"></div>""")
add("enquiry", "WhatsApp / email enquiry form", EYE + [txt("intro", "Intro", "For a clear quote, please send your image and requirements by WhatsApp or email.", "textarea"), txt("service", "Default 'what is it for'", "Something else"), txt("services", "Options (one per line)", "Photo or fine art print\nEconomy framed print or poster\nNo-drill magnetic frame\nDibond / Foamex board print\nSpecial presentation framing\nIris photography\nBusiness printing\nPhoto restoration\nPersonalised gift\nSomething else", "textarea"),
   txt("wa_number", "WhatsApp number (digits, with country code)", "447445250359"), txt("email", "Email address", "giftlyartprint@gmail.com"), WIDTH, HSIZE, ALIGN, col("card_background", "Form background", "#ffffff")] + colours() + PAD,
 """<div class="gap-pad gap-{{ al }}"><div class="gap-inner">""" + head("h2") + INTRO + """
          {%- assign fid = 'gapq-' | append: block.id -%}
          <form class="gap-form" id="{{ fid }}" onsubmit="return false" style="background:{{ s.card_background | default: '#ffffff' }}" data-wa="{{ s.wa_number | default: '447445250359' }}" data-mail="{{ s.email | default: 'giftlyartprint@gmail.com' }}">
            <label>What is it for?<select name="service">{%- assign opts = s.services | split: '
' -%}{%- for o in opts -%}{%- assign ot = o | strip -%}{%- if ot != blank -%}<option{% if ot == s.service %} selected{% endif %}>{{ ot }}</option>{%- endif -%}{%- endfor -%}</select></label>
            <label>Size<input name="size" placeholder="e.g. A3, or 30x40cm"></label>
            <label>Quantity<input name="qty" inputmode="numeric" placeholder="e.g. 1"></label>
            <label>Needed by<input name="date" placeholder="e.g. 20 December"></label>
            <label>Budget (optional)<input name="budget" placeholder="e.g. around £40"></label>
            <label class="gap-full">Anything else?<textarea name="notes" rows="2"></textarea></label>
            <div class="gap-actions gap-full"><a class="gap-btn gap-btn--whatsapp" data-role="wa" href="https://wa.me/{{ s.wa_number | default: '447445250359' }}" target="_blank" rel="noopener">Open WhatsApp with this message</a><a class="gap-btn gap-btn--outline" data-role="mail" href="mailto:{{ s.email | default: 'giftlyartprint@gmail.com' }}">Email this instead</a></div>
            <p class="gap-note gap-full" style="margin:0">Nothing is sent until you press send in WhatsApp or your email app. Please do not send payment details.</p>
          </form>
          <script>
            (function(){var f=document.getElementById({{ fid | json }});if(!f)return;var wa=f.querySelector('[data-role=wa]'),ml=f.querySelector('[data-role=mail]');
            function v(n){var e=f.elements[n];return e&&e.value.trim()?e.value.trim():'(to confirm)';}
            function b(){var t=['Hello Giftly Art Print,',"I'd like a quote for: "+v('service'),'Size: '+v('size'),'Quantity: '+v('qty'),'Needed by: '+v('date'),'Budget: '+v('budget'),'Notes: '+v('notes'),"I'll send my image/file in this chat."].join('\\n');
            wa.href='https://wa.me/'+f.dataset.wa+'?text='+encodeURIComponent(t);ml.href='mailto:'+f.dataset.mail+'?subject='+encodeURIComponent('Quote request: '+v('service'))+'&body='+encodeURIComponent(t.replace('in this chat','by email'));}
            f.addEventListener('input',b);f.addEventListener('change',b);b();})();
          </script>
        </div></div>""")

# card image inside grid_section: inline using the child 'c' as block
CARDIMG = img_liquid("", "c", sizes="(min-width: 1000px) 33vw, 100vw").replace("c.settings.heading", "c.settings.title")
def build_page_liquid():
    types_child = {"grid_item", "step", "fact", "price_row", "faq_item"}
    out = ["{%- comment -%} gap-page.liquid: flexible block-based page builder (Giftly Art Print). Child blocks (cards, steps, rows, questions) attach to a container through Block ID / Parent ID. {%- endcomment -%}", "<style>", CSS.strip(), "</style>"]
    out.append("""{%- liquid
  assign font = section.settings.font | default: 'apple'
  assign font_css = '-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif'
  if font == 'theme'
    assign font_css = 'inherit'
  elsif font == 'serif'
    assign font_css = 'Georgia,"Times New Roman",serif'
  endif
  assign sv = ''
  if section.settings.ink != blank
    assign sv = sv | append: '--gap-ink:' | append: section.settings.ink | append: ';'
  endif
  if section.settings.muted != blank
    assign sv = sv | append: '--gap-muted:' | append: section.settings.muted | append: ';'
  endif
  if section.settings.accent != blank
    assign sv = sv | append: '--gap-accent:' | append: section.settings.accent | append: ';'
  endif
  if section.settings.link != blank
    assign sv = sv | append: '--gap-link:' | append: section.settings.link | append: ';'
  endif
  if section.settings.background != blank
    assign sv = sv | append: '--gap-bg:' | append: section.settings.background | append: ';'
  endif
  if section.settings.soft != blank
    assign sv = sv | append: '--gap-soft:' | append: section.settings.soft | append: ';'
  endif
  assign mw = section.settings.max_width | default: 1024
  assign sv = sv | append: '--gap-max:' | append: mw | append: 'px;'
-%}""")
    out.append('<div class="gap-pg" id="gap-{{ section.id }}" style="{{ sv }}font-family:{{ font_css }}">')
    out.append("{%- for block in section.blocks -%}")
    out.append("""  {%- if block.type == 'grid_item' or block.type == 'step' or block.type == 'fact' or block.type == 'price_row' or block.type == 'faq_item' -%}{%- continue -%}{%- endif -%}
  {%- liquid
    assign s = block.settings
    assign w = s.layout_width | default: 'contained'
    assign al = s.text_align | default: 'left'
    assign hs = s.heading_size | default: 'lg'
    assign ts = s.text_size | default: 'md'
    assign pt = s.padding_top | default: 56
    assign pb = s.padding_bottom | default: 56
    assign st = '--gap-pt:' | append: pt | append: 'px;--gap-pb:' | append: pb | append: 'px;'
    if s.background_color != blank
      assign st = st | append: '--gap-b:' | append: s.background_color | append: ';'
    endif
    if s.heading_color != blank
      assign st = st | append: '--gap-h:' | append: s.heading_color | append: ';'
    endif
    if s.text_color != blank
      assign st = st | append: '--gap-t:' | append: s.text_color | append: ';'
    endif
    if s.accent_color != blank
      assign st = st | append: '--gap-a:' | append: s.accent_color | append: ';'
    endif
  -%}
  <div class="gap-blk gap-blk--{{ block.type }}" style="{{ st }}" {{ block.shopify_attributes }}>
    <div class="gap-outer gap-outer--{{ w }}">""")
    first = True
    for t, (name, settings, body) in BLOCKS.items():
        if t in types_child: continue
        b = body.replace("__CARDIMG__", CARDIMG)
        out.append("      {%- " + ("if" if first else "elsif") + " block.type == '" + t + "' -%}\n        " + b)
        first = False
    out.append("      {%- endif -%}\n    </div>\n  </div>\n{%- endfor -%}\n</div>")
    schema_blocks = [{"type": t, "name": n, "settings": s} for t, (n, s, _) in BLOCKS.items()]
    sec_settings = [hdr("Page style"), sel("font", "Font", [("apple", "Apple system font"), ("theme", "Theme font"), ("serif", "Serif")], "apple"), rng("max_width", "Standard content width", 720, 1400, 8, 1024),
                    col("background", "Page background"), col("soft", "Soft background (cards, tables)"), col("ink", "Main text colour"), col("muted", "Secondary text colour"), col("accent", "Label colour"), col("link", "Link colour")]
    schema = {"name": "GAP Page", "tag": "section", "class": "gap-section", "settings": sec_settings, "blocks": schema_blocks,
              "presets": [{"name": "GAP Page", "blocks": [{"type": "hero"}, {"type": "text_block"}]}]}
    out.append("{% schema %}\n" + json.dumps(schema, indent=2, ensure_ascii=False) + "\n{% endschema %}")
    return "\n".join(out)

open(os.path.join(OUT, "sections", "gap-page.liquid"), "w", encoding="utf-8").write(build_page_liquid())
print("gap-page.liquid written")

# ------------------------------------------------------------------ gap-recent-work.liquid
RW_CSS = r"""
.gap-rw{--gap-ink:#1d1d1f;--gap-muted:#6e6e73;--gap-link:#0066cc;letter-spacing:-.02em;line-height:1.47;color:var(--rw-text);background:var(--rw-bg)}
.gap-rw *{box-sizing:border-box}.gap-rw img{max-width:100%;height:auto;display:block}
.gap-rw .gap-outer--contained{max-width:var(--rw-max,1024px);margin:0 auto;padding:0 22px}
.gap-rw .gap-outer--fullwidth{padding:0 22px}
.gap-rw__pad{padding-top:var(--rw-pt);padding-bottom:var(--rw-pb)}
.gap-rw__head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.gap-rw__eyebrow{display:block;font-size:1.05rem;font-weight:600;color:var(--rw-accent);margin:0 0 .5rem}
.gap-rw__h{margin:0 0 .4em;font-weight:700;color:var(--rw-heading);letter-spacing:-.03em;line-height:1.1}
.gap-rw__h--sm{font-size:clamp(1.25rem,2.4vw,1.6rem)}.gap-rw__h--md{font-size:clamp(1.5rem,3.4vw,2.1rem)}.gap-rw__h--lg{font-size:clamp(1.8rem,4.6vw,2.8rem)}.gap-rw__h--xl{font-size:clamp(2.3rem,7vw,4rem)}
.gap-rw__intro{color:var(--gap-muted);font-size:1.15rem;max-width:44em;margin:0}
.gap-rw__align--center{text-align:center}.gap-rw__align--center .gap-rw__head{justify-content:center}.gap-rw__align--center .gap-rw__intro{margin:0 auto}
.gap-rw__arrows{display:flex;gap:8px}
.gap-rw__arrow{width:44px;height:44px;border-radius:50%;border:0;background:#fff;color:#1d1d1f;font-size:1.6rem;line-height:1;cursor:pointer;box-shadow:0 0 0 1px #d2d2d7}
.gap-rw__arrow:hover{background:#1d1d1f;color:#fff}
.gap-rw__list{list-style:none;margin:24px 0 0;padding:0}
.gap-rw--carousel .gap-rw__list{display:flex;gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:12px;-webkit-overflow-scrolling:touch}
.gap-rw--carousel .gap-rw__list>li{flex:0 0 min(82%,340px);scroll-snap-align:start}
@media(min-width:900px){.gap-rw--carousel .gap-rw__list>li{flex-basis:calc((100% - (var(--rw-cols) - 1) * 20px) / var(--rw-cols))}}
.gap-rw--grid .gap-rw__list{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))}
@media(min-width:900px){.gap-rw--grid .gap-rw__list{grid-template-columns:repeat(var(--rw-cols),1fr)}}
.gap-rw__card{background:var(--rw-card);border-radius:var(--rw-radius);overflow:hidden;height:100%}
.gap-rw__media{aspect-ratio:var(--rw-ratio);overflow:hidden;background:#e8e8ed}
.gap-rw__media img{width:100%;height:100%;object-fit:var(--rw-fit)}
.gap-rw__body{padding:18px 20px 22px}
.gap-rw__meta{font-size:.78rem;color:var(--gap-muted);margin:0 0 .3rem}
.gap-rw__tag{display:inline-block;background:#f5f5f7;border-radius:980px;padding:.1rem .55rem;margin-right:.4rem;font-weight:600}
.gap-rw__body h3{margin:.2rem 0 .4rem;font-size:1.1rem;line-height:1.2;color:var(--rw-heading)}
.gap-rw__body p{margin:0;color:var(--gap-muted);font-size:.95rem}
.gap-rw__more{margin:18px 0 0}.gap-rw__more a{color:var(--gap-link)}
.gap-rw__btn{font:inherit;display:inline-flex;min-height:44px;align-items:center;padding:.6rem 1.4rem;border-radius:980px;border:1px solid currentColor;background:transparent;color:var(--gap-link);cursor:pointer}
.gap-rw a:focus-visible,.gap-rw button:focus-visible,.gap-rw__list:focus-visible{outline:4px solid rgba(0,113,227,.55);outline-offset:2px}
"""
RW_LIQUID = r"""{%- comment -%}
  gap-recent-work.liquid: latest jobs, newest first. Data lives in the metaobject definition "recent_work"
  (fields: title, date, category, description, image, image_alt, link). One list feeds every page and the archive page.
  Layout "carousel" = sliding row for any page (put it in the footer section group to show on every page).
  Layout "grid"     = full list for the archive page, with a "Show more" button.
{%- endcomment -%}
<style>__CSS__</style>
{%- liquid
  assign s = section.settings
  assign list = shop.metaobjects.recent_work.values
  if s.order == 'date'
    assign list = list | sort: 'date' | reverse
  elsif s.order == 'admin_reverse'
    assign list = list | reverse
  endif
  assign cat = s.category | strip
  assign layout = s.layout | default: 'carousel'
  assign first_n = s.items_shown | default: 4
  assign col_n = s.columns | default: '3'
  assign ratio = s.aspect_ratio | default: '4/3'
  assign hs = s.heading_size | default: 'lg'
  assign al = s.text_align | default: 'left'
  assign w = s.layout_width | default: 'contained'
  assign shown = 0
  assign total = 0
-%}
<section class="gap-rw gap-rw--{{ layout }} gap-rw__align--{{ al }}" id="gap-rw-{{ section.id }}" aria-labelledby="gap-rw-h-{{ section.id }}"
  style="--rw-bg:{{ s.background_color | default: '#f5f5f7' }};--rw-text:{{ s.text_color | default: '#1d1d1f' }};--rw-heading:{{ s.heading_color | default: '#1d1d1f' }};--rw-accent:{{ s.accent_color | default: '#b64400' }};--rw-card:{{ s.card_background | default: '#ffffff' }};--rw-radius:{{ s.card_radius | default: 18 }}px;--rw-ratio:{{ ratio }};--rw-fit:{{ s.image_fit | default: 'cover' }};--rw-cols:{{ col_n }};--rw-pt:{{ s.padding_top | default: 64 }}px;--rw-pb:{{ s.padding_bottom | default: 64 }}px;--rw-max:{{ s.max_width | default: 1024 }}px">
  <div class="gap-outer gap-outer--{{ w }}"><div class="gap-rw__pad">
    <div class="gap-rw__head">
      <div>
        {%- if s.eyebrow != blank -%}<span class="gap-rw__eyebrow">{{ s.eyebrow }}</span>{%- endif -%}
        <h2 class="gap-rw__h gap-rw__h--{{ hs }}" id="gap-rw-h-{{ section.id }}">{{ s.heading }}</h2>
        {%- if s.intro != blank -%}<p class="gap-rw__intro">{{ s.intro }}</p>{%- endif -%}
      </div>
      {%- if layout == 'carousel' and s.show_arrows -%}
        <div class="gap-rw__arrows"><button type="button" class="gap-rw__arrow" data-dir="-1" aria-label="Previous jobs">&lsaquo;</button><button type="button" class="gap-rw__arrow" data-dir="1" aria-label="Next jobs">&rsaquo;</button></div>
      {%- endif -%}
    </div>
    {%- if list.size == 0 -%}
      {%- if request.design_mode -%}<p class="gap-rw__intro" style="margin-top:24px">No recent work yet. Add entries under Content &gt; Metaobjects &gt; Recent work.</p>{%- endif -%}
    {%- else -%}
      <ul class="gap-rw__list" {% if layout == 'carousel' %}tabindex="0" role="region" aria-label="Recent jobs, scrollable"{% endif %}>
        {%- for w_item in list -%}
          {%- if cat != blank and w_item.category.value != cat -%}{%- continue -%}{%- endif -%}
          {%- assign total = total | plus: 1 -%}
          {%- if layout == 'carousel' and shown >= first_n -%}{%- continue -%}{%- endif -%}
          {%- assign hidden = false -%}
          {%- if layout == 'grid' and shown >= first_n %}{% assign hidden = true %}{% endif -%}
          {%- assign shown = shown | plus: 1 -%}
          {%- assign ttl = w_item.title.value -%}
          <li{% if hidden %} hidden data-rw-extra{% endif %}>
            <article class="gap-rw__card">
              {%- if w_item.image.value != blank -%}
                <div class="gap-rw__media">{{ w_item.image.value | image_url: width: 900 | image_tag: loading: 'lazy', widths: '300, 500, 700, 900', sizes: '(min-width: 900px) 33vw, 82vw', alt: w_item.image_alt.value | default: ttl }}</div>
              {%- endif -%}
              <div class="gap-rw__body">
                <p class="gap-rw__meta">{%- if s.show_category and w_item.category.value != blank -%}<span class="gap-rw__tag">{{ w_item.category.value }}</span>{%- endif -%}{%- if s.show_date and w_item.date.value != blank -%}<time datetime="{{ w_item.date.value | date: '%Y-%m-%d' }}">{{ w_item.date.value | date: '%-d %B %Y' }}</time>{%- endif -%}</p>
                <h3>{%- if w_item.link.value != blank -%}<a href="{{ w_item.link.value }}">{{ ttl }}</a>{%- else -%}{{ ttl }}{%- endif -%}</h3>
                <p>{{ w_item.description.value | escape }}</p>
              </div>
            </article>
          </li>
        {%- endfor -%}
      </ul>
      {%- if layout == 'grid' and total > first_n -%}
        <p class="gap-rw__more"><button type="button" class="gap-rw__btn" data-rw-more data-step="{{ first_n }}">{{ s.more_label | default: 'Show more' }}</button></p>
      {%- elsif layout == 'carousel' and s.all_link != blank and total > 0 -%}
        <p class="gap-rw__more"><a href="{{ s.all_link }}">{{ s.all_label | default: 'See all recent work' }}</a></p>
      {%- endif -%}
    {%- endif -%}
  </div></div>
  <script>
    (function () {
      var r = document.getElementById('gap-rw-{{ section.id }}'); if (!r) return;
      var list = r.querySelector('.gap-rw__list');
      r.querySelectorAll('.gap-rw__arrow').forEach(function (b) {
        b.addEventListener('click', function () { list.scrollBy({ left: (list.firstElementChild.offsetWidth + 20) * Number(b.dataset.dir), behavior: 'smooth' }); });
      });
      var m = r.querySelector('[data-rw-more]');
      if (m) m.addEventListener('click', function () {
        var hid = r.querySelectorAll('[data-rw-extra][hidden]'), n = Number(m.dataset.step) || 6;
        for (var i = 0; i < hid.length && i < n; i++) hid[i].hidden = false;
        if (r.querySelectorAll('[data-rw-extra][hidden]').length === 0) m.parentNode.hidden = true;
      });
    })();
  </script>
</section>
{% schema %}
__SCHEMA__
{% endschema %}"""
rw_settings = [hdr("Content"), txt("eyebrow", "Small label", "Recent work"), txt("heading", "Heading", "Our latest jobs"), txt("intro", "Intro text", "The newest job is always first.", "textarea"),
 hdr("Layout"), sel("layout", "Layout", [("carousel", "Sliding row (for every page)"), ("grid", "Full list (for the archive page)")], "carousel"), WIDTH,
 rng("items_shown", "Jobs shown (carousel) / shown first (grid)", 2, 50, 1, 4, ""), sel("columns", "Jobs visible at once on desktop", [("2", "2"), ("3", "3"), ("4", "4")], "3"), {"type": "checkbox", "id": "show_arrows", "label": "Show arrows (carousel)", "default": True},
 txt("all_label", "'See all' link label", "See all recent work"), txt("all_link", "'See all' link (archive page)", None, "url"), txt("more_label", "'Show more' button label (grid)", "Show more"),
 hdr("Data"), sel("order", "Order", [("date", "By date, newest first (recommended)"), ("admin_reverse", "Reverse admin order"), ("admin", "Admin order")], "date", "If date sorting does not work in your theme, switch to an admin order."), txt("category", "Only show this category (optional)", None, "text", "Leave empty to show all jobs."),
 {"type": "checkbox", "id": "show_date", "label": "Show date", "default": True}, {"type": "checkbox", "id": "show_category", "label": "Show category", "default": True},
 hdr("Image"), sel("aspect_ratio", "Image aspect ratio", RATIOS[:-1], "4/3"), sel("image_fit", "Image fit", [("cover", "Fill and crop"), ("contain", "Show whole image")], "cover"),
 hdr("Text"), HSIZE, sel("text_align", "Heading alignment", [("left", "Left"), ("center", "Centre")], "left"),
 hdr("Colours"), col("background_color", "Section background", "#f5f5f7"), col("card_background", "Card background", "#ffffff"), col("heading_color", "Heading colour", "#1d1d1f"), col("text_color", "Text colour", "#1d1d1f"), col("accent_color", "Label colour", "#b64400"), rng("card_radius", "Card corner radius", 0, 40, 2, 18),
 hdr("Spacing"), rng("padding_top", "Top padding", 0, 160, 4, 64), rng("padding_bottom", "Bottom padding", 0, 160, 4, 64), rng("max_width", "Standard content width", 720, 1400, 8, 1024)]
rw_schema = {"name": "GAP Recent work", "tag": "section", "class": "gap-section", "settings": rw_settings, "presets": [{"name": "GAP Recent work"}]}
open(os.path.join(OUT, "sections", "gap-recent-work.liquid"), "w", encoding="utf-8").write(
    RW_LIQUID.replace("__CSS__", RW_CSS.strip()).replace("__SCHEMA__", json.dumps(rw_schema, indent=2, ensure_ascii=False)))
print("gap-recent-work.liquid written")

# ------------------------------------------------------------------ page templates (from product data)
import urllib.parse
WA = "https://wa.me/447445250359"
def wa(service):
    t = "Hello Giftly Art Print,\nI'd like a quote for: %s\nSize: \nQuantity: \nNeeded by: \nI'll send my image/file in this chat." % service
    return WA + "?text=" + urllib.parse.quote(t)
def plain(s): return html.unescape(re.sub(r"<[^>]+>", "", s))
SERV = ["Photo or fine art print", "Print for my existing frame", "Economy framed print or poster", "No-drill magnetic frame", "Dibond / Foamex board print", "Special presentation framing", "Iris photography", "Business printing", "Photo restoration", "Personalised gift", "Something else"]
def template_for(pr):
    blocks, order = {}, []
    n = [0]
    def add_b(t, settings):
        n[0] += 1; k = "b%02d" % n[0]; blocks[k] = {"type": t, "settings": settings}; order.append(k)
    sub = pr["group"] + " · " + pr["sub"]
    add_b("hero", {"eyebrow": sub, "heading": pr["name"], "subheading": plain(pr["lede"]), "heading_tag": "h1", "text_align": "center", "heading_size": "xl", "image_alt": plain(pr["imgs"][0][1]), "aspect_ratio": "3/2",
                   "btn_label": "Message us on WhatsApp", "btn_link": wa(pr["name"]), "btn_style": "whatsapp", "btn2_label": "Email instead", "btn2_link": "mailto:giftlyartprint@gmail.com?subject=" + urllib.parse.quote("Quote request: " + pr["name"]), "btn2_style": "outline", "padding_top": 48, "padding_bottom": 40, "background_color": "#ffffff"})
    add_b("grid_section", {"heading": "Does this sound like you?", "block_id": "qa", "columns": "2", "background_color": "#f5f5f7", "card_background": "#ffffff", "heading_size": "lg", "text_align": "left", "layout_width": "contained"})
    for q, a in pr["qa"]: add_b("grid_item", {"parent_id": "qa", "title": plain(q), "text": "<p>%s</p>" % plain(a)})
    add_b("image_text", {"heading": "The problem, and our answer", "text": "<p><strong>The problem.</strong> %s</p><p><strong>What we offer.</strong> %s</p>" % (plain(pr["problem"]), plain(pr["solution"])), "image_position": "right", "image_alt": plain(pr["imgs"][1][1]), "aspect_ratio": "4/3", "background_color": "#ffffff"})
    add_b("facts_section", {"heading": "At a glance", "block_id": "facts", "background_color": "#ffffff", "padding_top": 0})
    for lab, txt_ in [("Who it suits", pr["who"]), ("Included", pr["included"]), ("Extra cost", pr["extra"]), ("What to do now", "Send the details by WhatsApp or email. For a clear quote, please send your image and requirements.")]:
        add_b("fact", {"parent_id": "facts", "label": lab, "text": plain(txt_)})
    add_b("steps_section", {"heading": "How it works", "block_id": "steps", "text_align": "center", "background_color": "#f5f5f7", "card_background": "#ffffff"})
    for t_, x in [("Send the details", "Business: product, quantity, size, file, date. Others: your image or item, size and where it will go."), ("We check and quote", "You get a clear quote with what is included and what is extra."), ("You decide", "We only go ahead when you are happy with the quote.")]:
        add_b("step", {"parent_id": "steps", "title": t_, "text": x})
    t = pr["table"]
    add_b("price_table", {"block_id": "prices", "caption": plain(t["caption"]), "note": plain(t["note"]), "col1": plain(t["heads"][0]), "col2": plain(t["heads"][1]), "col3": plain(t["heads"][2]), "col4": plain(t["heads"][3]), "col5": plain(t["heads"][4]),
                           "btn_label": "Ask about this on WhatsApp", "btn_link": wa(pr["name"]), "btn_style": "whatsapp", "background_color": "#ffffff"})
    for r in t["rows"]: add_b("price_row", dict(parent_id="prices", **{"c%d" % (i + 1): plain(c) for i, c in enumerate(r)}))
    add_b("faq_section", {"heading": "Common questions", "block_id": "faq", "background_color": "#f5f5f7", "card_background": "#ffffff"})
    for q, a in pr["faq"]: add_b("faq_item", {"parent_id": "faq", "question": plain(q), "answer": "<p>%s</p>" % plain(a)})
    add_b("cta", {"heading": "Ready to start?", "text": "For a clear quote, please send your image and requirements by WhatsApp or email.", "image_alt": plain(pr["imgs"][2][1]), "text_align": "center", "heading_color": "#ffffff", "text_color": "#ffffff", "background_color": "#1d1d1f", "btn_label": "Message us on WhatsApp", "btn_link": wa(pr["name"]), "btn_style": "whatsapp", "btn2_label": "Email instead", "btn2_link": "mailto:giftlyartprint@gmail.com", "btn2_style": "light"})
    add_b("enquiry", {"heading": "Start your enquiry", "service": pr["name"], "services": "\n".join(SERV + [pr["name"]]), "background_color": "#1d1d1f", "heading_color": "#ffffff", "text_color": "#f5f5f7", "text_align": "center"})
    return {"sections": {"main": {"type": "gap-page", "blocks": blocks, "block_order": order, "settings": {"font": "apple", "max_width": 1024}}}, "order": ["main"]}
os.makedirs(os.path.join(OUT, "templates"), exist_ok=True)
for pr in PRODUCTS:
    json.dump(template_for(pr), open(os.path.join(OUT, "templates", "page.gap-%s.json" % pr["slug"]), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("templates:", len(PRODUCTS))
