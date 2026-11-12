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

  // Texte d'introduction de la section contact (facultatif)
  pricing: '',

  // ---- Tarifs (hypothèses de départ, à valider auprès des premiers restaurateurs) ----
  taxNote: 'Prix hors taxes',
  plans: [
    {
      name: 'Essentiel', price: '29', setup: '190',
      tagline: 'Pour démarrer vite, en autonomie',
      features: [
        'Site de commande, écran cuisine et back-office',
        'Mise en ligne incluse, avec configuration de votre nom de domaine',
        'Hébergement et e-mails clients',
        'Sauvegardes quotidiennes de vos données',
        'Export de vos commandes à tout moment',
        'Vous saisissez votre carte et vos photos',
        'Guide de prise en main',
        'Support par e-mail',
      ],
    },
    {
      name: 'Confort', price: '49', setup: '290', featured: true,
      tagline: 'On s\'occupe de la mise en route',
      features: [
        'Tout l\'Essentiel',
        'Restauration de vos données en priorité en cas de problème',
        'Nous saisissons votre carte et vos photos',
        'Formation d\'1 heure en visio',
        'Point de suivi après 1 mois',
        'Support par e-mail et par téléphone',
      ],
    },
    {
      // formule sur devis : plusieurs établissements, besoins particuliers (affichée sans prix)
      name: 'Sur mesure', quote: true,
      tagline: 'Plusieurs établissements ou besoins particuliers',
      features: [
        'Tout le Confort',
        'Plusieurs restaurants ou commerces',
        'Adaptations à votre activité',
        'Support prioritaire',
      ],
    },
  ],
  // Phrases sous la grille (laisser vide pour les masquer)
  headline: 'Des tarifs affichés, sans devis à demander. Aucune commission pour le restaurant.',
  annualNote: 'Paiement à l\'année : 2 mois offerts.',
  launchOffer: 'Offre de lancement : mise en service offerte pour les premiers restaurants partenaires.',
  // Frais de service payé par le CLIENT sur chaque commande en livraison (le restaurant ne paie aucune commission).
  // Non affiché publiquement : on en parle directement avec chaque restaurateur. Mettre true pour afficher l'encadré.
  showServiceFee: false,
  serviceFee: '0,70 €',
  options: [
    { name: 'Notifications SMS', text: 'Facturées à l\'usage' },
    { name: 'Paiement en ligne', text: 'Bientôt' },
    { name: 'CRM et fidélité', text: 'Bientôt' },
  ],

  // CRM : passer à une adresse quand il existe (sinon la carte reste « Bientôt »)
  crmUrl: '',
};
