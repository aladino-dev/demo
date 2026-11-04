// Réglages de la page de démo : tout ce qui change se complète ICI, sans toucher au reste.
// Rien n'est inventé : les champs vides affichent « à compléter » dans la page pour ne pas être oubliés.
window.ONYX_DEMO = {
  // Marque affichée
  brand: 'Onyx Order',

  // Adresse de la démo de commande (le restaurant de démonstration). /cuisine et /admin sont ajoutés automatiquement.
  orderUrl: 'https://commande.byonyx.fr',

  // Comptes de test affichés pour entrer en un clic (laisser vide tant que non décidé).
  // Exemple : { email: 'demo-cuisine@…', password: '…' }
  // Comptes PUBLICS de la démo : ils n'ouvrent que les données fictives du restaurant de démonstration (remises à zéro chaque nuit).
  accounts: {
    kitchen: { email: 'demo-cuisine@onyx.demo', password: 'demo1234' },
    backoffice: { email: 'demo-admin@onyx.demo', password: 'demo1234' },
  },

  // Contact commercial
  contact: {
    email: 'aladin2003@gmail.com',
    phone: '0660706774',
    // lien de prise de rendez-vous éventuel (Calendly, etc.)
    booking: '',
  },

  // Texte sur les tarifs (à compléter : ex. « Sur devis », « À partir de … »). Vide = « à compléter ».
  pricing: '',

  // CRM : passer à une adresse quand il existe (sinon la carte reste « Bientôt »)
  crmUrl: '',
};
