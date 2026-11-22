'use client';
import { eur, photoUrl } from '../lib/api';

// « Produit du mois » dans la bannière : un tap ouvre la fiche du produit (le menu écoute cet évènement).
export default function FeaturedProduct({ product }) {
  const url = photoUrl(product.photo);
  return (
    <button type="button" className="featured" onClick={() => window.dispatchEvent(new CustomEvent('onyx:open-product', { detail: product.id }))}>
      {url && <span className="featured-ph" style={{ backgroundImage: `url("${url}")` }} role="img" aria-label={product.name} />}
      <span className="featured-txt">
        <span className="featured-label">Produit du mois</span>
        <span className="featured-name">{product.name}</span>
        <span className="featured-price">{eur(product.price_cents)}</span>
      </span>
      <span className="featured-go" aria-hidden="true">Voir</span>
    </button>
  );
}
