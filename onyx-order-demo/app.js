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
