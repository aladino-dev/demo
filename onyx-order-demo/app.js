// Branche config.js sur la page : adresses des démos, comptes de test, contact, tarifs.
(() => {
  const c = window.ONYX_DEMO || {};
  const base = String(c.orderUrl || '').replace(/\/$/, '');
  const url = { order: base, kitchen: `${base}/cuisine`, backoffice: `${base}/admin` };

  document.querySelectorAll('[data-brand]').forEach((el) => { if (c.brand) el.textContent = c.brand; });
  document.querySelectorAll('[data-open]').forEach((a) => { a.href = url[a.dataset.open] || '#'; });
  const frame = document.getElementById('phone-demo');
  if (frame && base) frame.src = base;

  // comptes de test : affichés seulement s'ils sont renseignés
  document.querySelectorAll('[data-cred]').forEach((el) => {
    const acc = (c.accounts || {})[el.dataset.cred];
    if (acc && acc.email) {
      el.textContent = `Identifiant : ${acc.email}${acc.password ? ` · Mot de passe : ${acc.password}` : ''}`;
      el.hidden = false;
    }
  });

  // CRM : bouton seulement quand l'adresse existe
  if (c.crmUrl) {
    const l = document.getElementById('crm-link');
    l.href = c.crmUrl; l.hidden = false;
    document.getElementById('crm-note').hidden = true;
  }

  // tarifs : formules, frais de service payé par le client, options (tout vient de config.js)
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const plansEl = document.getElementById('plans');
  const plans = c.plans || [];
  if (!plans.length) {
    document.getElementById('tarifs').hidden = true;
    document.querySelectorAll('a[href="#tarifs"]').forEach((a) => { a.hidden = true; });
  } else {
    plansEl.innerHTML = plans.map((p) => `
      <article class="plan ${p.featured ? 'featured' : ''}">
        ${p.featured ? '<span class="ribbon">Le plus choisi</span>' : ''}
        <h3>${esc(p.name)}</h3>
        <p class="tagline">${esc(p.tagline || '')}</p>
        ${p.quote
          ? '<p class="price"><span class="amount quote">Sur devis</span></p><p class="setup">Étude gratuite de votre besoin</p>'
          : `<p class="price"><span class="amount">${esc(p.price)} €</span><span class="per">/mois</span></p><p class="setup">+ ${esc(p.setup)} € de mise en service</p>`}
        <ul>${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <a class="btn ${p.featured ? 'primary' : 'ghost-dark'}" href="#contact">${p.quote ? 'Demander un devis' : `Choisir ${esc(p.name)}`}</a>
      </article>`).join('');
    if (c.headline) document.getElementById('plans-sub').textContent = c.headline;
    const setNote = (id, text) => { const el = document.getElementById(id); el.textContent = text || ''; el.hidden = !text; };
    setNote('annual-note', c.annualNote);
    setNote('launch-offer', c.launchOffer);
    document.getElementById('tax-note').textContent = c.taxNote || '';
    document.getElementById('fee-amount').textContent = c.serviceFee || '';
    document.getElementById('fee-box').hidden = !(c.showServiceFee && c.serviceFee);
    document.getElementById('options').innerHTML = (c.options || []).map((o) => `<li><strong>${esc(o.name)}</strong><span>${esc(o.text)}</span></li>`).join('');
  }

  // tarifs et contact
  document.getElementById('pricing-text').textContent = c.pricing || 'Une question ? Une démonstration pour votre restaurant ? Contactez-nous.';
  const ct = c.contact || {};
  let any = false;
  const show = (id, href) => { const el = document.getElementById(id); el.href = href; el.hidden = false; any = true; };
  if (ct.email) show('c-mail', `mailto:${ct.email}?subject=${encodeURIComponent('Démo Onyx Order')}`);
  if (ct.phone) { show('c-phone', `tel:${ct.phone.replace(/[^\d+]/g, '')}`); document.getElementById('c-phone').textContent = `Appeler le ${ct.phone.replace(/(\d{2})(?=\d)/g, '$1 ').trim()}`; }
  if (ct.booking) show('c-book', ct.booking);
  // aucun moyen de contact renseigné : on masque la section et les boutons qui y mènent plutôt que d'afficher « à compléter » au public
  if (!any) {
    document.getElementById('contact').hidden = true;
    document.querySelectorAll('a[href="#contact"]').forEach((a) => { a.hidden = true; });
  }
})();
