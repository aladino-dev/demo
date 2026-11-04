import nodemailer from 'nodemailer';
import { q } from './db.js';
import { getOrder } from './orders.js';

const BACKOFF_MIN = [1, 5, 15, 60, 360]; // délai avant chaque nouvel essai ; au-delà, l'envoi est marqué « failed »
const MAX_AGE_MS = 24 * 3600e3;
const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Réglages SMTP (variables d'environnement de cette installation). null = pas configuré. */
export function smtpConfig(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT || 587);
  return {
    host: env.SMTP_HOST, port,
    secure: String(env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
    from: env.SMTP_FROM || env.SMTP_USER,
  };
}

export function makeTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.auth,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
}

export function siteUrl(env = process.env) {
  return (env.SITE_URL || String(env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).find((s) => s && !/:(5173|5174)$/.test(s)) || '').replace(/\/$/, '');
}

// ---------- Modèles d'e-mail ----------
function itemLines(order) {
  return order.items.map((i) => {
    const opts = i.options.map((o) => o.label).join(', ');
    const unit = i.unit_price_cents + i.options.reduce((a, o) => a + o.price_cents, 0);
    return { text: `${i.quantity} × ${i.name}${opts ? ` (${opts})` : ''} — ${eur(unit * i.quantity)}`, name: i.name, qty: i.quantity, opts, total: unit * i.quantity };
  });
}

function where(r, order) {
  if (order.mode === 'delivery') {
    return `Livraison à : ${[order.address, [order.postcode, order.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`;
  }
  const addr = [r.address, [r.postcode, r.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return addr ? `À retirer chez ${r.name} : ${addr}` : `À retirer chez ${r.name}`;
}

export function render(template, { restaurant: r, order, link }) {
  const n = order.number;
  const first = String(order.customer_name || '').trim().split(/\s+/)[0];
  const hello = first ? `Bonjour ${first},` : 'Bonjour,';
  const lines = itemLines(order);
  const contact = r.phone ? `Une question ? Appelez-nous au ${r.phone}.` : '';
  let subject; let intro; let showRecap = false;
  if (template === 'confirmation') {
    subject = `Commande n°${n} reçue – ${r.name}`;
    intro = `Merci ! Nous avons bien reçu votre commande n°${n} chez ${r.name}. Nous la préparons.`;
    showRecap = true;
  } else if (template === 'status_ready') {
    subject = `Commande n°${n} prête – ${r.name}`;
    intro = order.mode === 'delivery'
      ? `Votre commande n°${n} est prête et va partir en livraison.`
      : `Votre commande n°${n} est prête : vous pouvez venir la retirer chez ${r.name}.`;
  } else if (template === 'status_delivering') {
    subject = `Commande n°${n} en route – ${r.name}`;
    intro = `Votre commande n°${n} est en route. Bon appétit !`;
  } else if (template === 'status_done') {
    subject = `Commande n°${n} livrée – ${r.name}`;
    intro = `Votre commande n°${n} a été livrée. Bon appétit, et merci de votre confiance !`;
  } else {
    throw new Error(`Modèle d'e-mail inconnu : ${template}`);
  }
  const payment = showRecap && r.settings?.payment_note ? r.settings.payment_note : '';
  const total = [`Sous-total : ${eur(order.subtotal_cents)}`,
    order.discount_cents ? `Remise${order.promo_code ? ` (${order.promo_code})` : ''} : −${eur(order.discount_cents)}` : '',
    order.fee_cents ? `Livraison : ${eur(order.fee_cents)}` : '', `Total : ${eur(order.total_cents)}`].filter(Boolean);

  const text = [hello, '', intro, '',
    ...(showRecap ? [...lines.map((l) => l.text), '', ...total, '', where(r, order), `Heure : ${order.slot || 'Dès que possible'}`, ...(order.note ? [`Votre remarque : ${order.note}`] : []), ...(payment ? ['', payment] : []), ''] : []),
    link ? `Suivre ma commande : ${link}` : '', '', contact, `— ${r.name}`].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');

  const row = (l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee"><b>${l.qty} × ${esc(l.name)}</b>${l.opts ? `<br><span style="color:#777;font-size:13px">${esc(l.opts)}</span>` : ''}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${eur(l.total)}</td></tr>`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f5f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#141414">
<div style="max-width:560px;margin:0 auto;padding:16px">
<div style="background:#111;color:#fff;padding:18px 20px;border-radius:14px 14px 0 0;font-size:20px;font-weight:700">${esc(r.name)}</div>
<div style="background:#fff;padding:20px;border-radius:0 0 14px 14px">
<p style="margin:0 0 6px">${esc(hello)}</p><p style="margin:0 0 14px">${esc(intro)}</p>
${showRecap ? `<table style="width:100%;border-collapse:collapse;font-size:15px">${lines.map(row).join('')}</table>
<p style="text-align:right;margin:10px 0 0;line-height:1.6">${total.map((t, i) => (i === total.length - 1 ? `<b style="font-size:17px">${esc(t)}</b>` : esc(t))).join('<br>')}</p>
<p style="margin:14px 0 0"><b>${esc(where(r, order))}</b><br>Heure : ${esc(order.slot || 'Dès que possible')}</p>
${order.note ? `<p style="margin:10px 0 0;color:#555">Votre remarque : ${esc(order.note)}</p>` : ''}
${payment ? `<p style="margin:10px 0 0;color:#555;font-size:13px">${esc(payment)}</p>` : ''}` : ''}
${link ? `<p style="margin:20px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#e2531f;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px">Suivre ma commande</a></p>` : ''}
${contact ? `<p style="margin:18px 0 0;color:#777;font-size:13px">${esc(contact)}</p>` : ''}
</div></div></body></html>`;
  return { subject, text, html };
}

// ---------- File d'envoi ----------
/** Envoie les e-mails en attente. `transport` injectable pour les tests. Renvoie { sent, failed, retried }. */
export async function processQueue({ transport, cfg, link = siteUrl(), limit = 10 } = {}) {
  const config = cfg || smtpConfig();
  const mail = transport || (config && makeTransport(config));
  if (!mail) return { sent: 0, failed: 0, retried: 0, skipped: true };
  // on « réserve » les lignes 2 min en avançant next_attempt : si l'API s'arrête en plein envoi, elles repartent seules
  const { rows } = await q(
    `UPDATE email_queue SET next_attempt = now() + interval '2 minutes'
      WHERE id IN (SELECT id FROM email_queue WHERE status = 'pending' AND next_attempt <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [limit]);
  const res = { sent: 0, failed: 0, retried: 0 };
  for (const job of rows) {
    try {
      const { rows: [restaurant] } = await q('SELECT * FROM restaurants WHERE id = $1', [job.restaurant_id]);
      const order = job.order_id ? await getOrder(job.restaurant_id, job.order_id) : null;
      if (!restaurant || !order) throw Object.assign(new Error('Commande ou restaurant introuvable'), { permanent: true });
      // un vieil e-mail resté en attente (SMTP configuré tardivement, longue panne) ne doit pas partir d'un coup
      if (Date.now() - new Date(order.created_at).getTime() > MAX_AGE_MS) {
        throw Object.assign(new Error('Commande de plus de 24 h : e-mail non envoyé'), { permanent: true });
      }
      const msg = render(job.template, { restaurant, order, link: link ? `${link}/suivi/${order.token}` : '' });
      await mail.sendMail({ from: config?.from || `"${restaurant.name}" <no-reply@localhost>`, to: job.recipient, subject: msg.subject, text: msg.text, html: msg.html });
      await q("UPDATE email_queue SET status = 'sent', attempts = attempts + 1, last_error = NULL WHERE id = $1", [job.id]);
      res.sent++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const final = e.permanent || attempts >= BACKOFF_MIN.length;
      await q(
        `UPDATE email_queue SET attempts = $2, last_error = $3, status = $4, next_attempt = now() + make_interval(mins => $5) WHERE id = $1`,
        [job.id, attempts, String(e.message).slice(0, 300), final ? 'failed' : 'pending', BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)]]);
      res[final ? 'failed' : 'retried']++;
      console.error(`[mail] échec envoi #${job.id} (${job.template}) : ${e.message}${final ? ' — abandonné' : ' — nouvel essai plus tard'}`);
    }
  }
  return res;
}

/** Démarre l'envoi en tâche de fond (toutes les 15 s) si le SMTP est configuré. */
export function startMailer() {
  const cfg = smtpConfig();
  if (!cfg) {
    console.log('[mail] SMTP non configuré (SMTP_HOST vide dans .env) : les e-mails restent en attente et partiront dès la configuration.');
    return;
  }
  if (!cfg.from) console.warn('[mail] SMTP_FROM (ou SMTP_USER) manquant : l\'expéditeur est indispensable.');
  const transport = makeTransport(cfg);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await processQueue({ transport, cfg }); } catch (e) { console.error('[mail]', e.message); } finally { busy = false; }
  };
  setInterval(tick, 15000).unref?.();
  tick();
  console.log(`[mail] envoi actif via ${cfg.host}:${cfg.port} (expéditeur : ${cfg.from})`);
}

/** Envoie un e-mail de test (npm run email:test -- adresse). */
export async function sendTest(to) {
  const cfg = smtpConfig();
  if (!cfg) throw new Error('SMTP non configuré : renseignez SMTP_HOST, SMTP_USER, SMTP_PASS et SMTP_FROM dans onyx-order-api/.env');
  const transport = makeTransport(cfg);
  await transport.verify();
  await transport.sendMail({ from: cfg.from, to, subject: 'Test Onyx Order : l\'envoi d\'e-mails fonctionne', text: 'Si vous lisez ce message, la configuration SMTP est correcte.' });
}
