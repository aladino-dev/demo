import { q } from './db.js';

/** Journal des modifications de la carte : qui, quoi, quand, avant / après. Ne bloque jamais l'action. */
export async function audit(req, entity, entityId, action, before = null, after = null) {
  try {
    await q(
      'INSERT INTO audit_log (restaurant_id, user_id, entity, entity_id, action, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [req.user.rid, req.user.uid, entity, entityId, action,
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  } catch (e) {
    console.error('[audit]', e.message);
  }
}
