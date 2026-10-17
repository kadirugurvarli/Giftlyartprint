(function () {
  var t = document.querySelector('.nav-toggle'), n = document.getElementById('site-nav');
  if (t && n) {
    t.addEventListener('click', function () {
      var o = n.classList.toggle('open'); t.setAttribute('aria-expanded', o);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && n.classList.contains('open')) { n.classList.remove('open'); t.setAttribute('aria-expanded', 'false'); t.focus(); }
    });
  }
  var f = document.querySelector('form.quote-form');
  if (!f) return;
  var wa = document.getElementById('q-wa'), em = document.getElementById('q-mail');
  function val(n) { var e = f.elements[n]; return e && e.value.trim() ? e.value.trim() : '(to confirm)'; }
  function build() {
    var lines = ['Hello Giftly Art Print,', "I'd like a quote for: " + val('service'),
      'Size: ' + val('size'), 'Quantity: ' + val('qty'), 'Needed by: ' + val('date'),
      'Budget: ' + val('budget'), 'Notes: ' + val('notes'), "I'll send my image/file in this chat."];
    var body = lines.join('\n');
    wa.href = 'https://wa.me/447445250359?text=' + encodeURIComponent(body);
    em.href = 'mailto:giftlyartprint@gmail.com?subject=' + encodeURIComponent('Quote request: ' + val('service')) +
      '&body=' + encodeURIComponent(body.replace("in this chat", "by email"));
  }
  f.addEventListener('input', build); f.addEventListener('change', build); build();
})();
