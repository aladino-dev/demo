// Euros à l'écran, centimes en base : « 12,90 » et « 12.90 » sont acceptés.
export const fromCents = (c) => (c / 100).toFixed(2).replace('.', ',');
export function toCents(v) {
  const n = parseFloat(String(v).trim().replace(',', '.').replace(/\s|€/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/** Règle d'une liste d'options en langage simple : « Obligatoire · 1 à 2 choix ». */
export function ruleText(g) {
  const min = Math.max(g.min_select || 0, g.required ? 1 : 0);
  const max = g.max_select;
  const lead = min ? 'Obligatoire' : 'Facultatif';
  if (max == null) return min ? `${lead} · ${min} minimum` : `${lead} · sans limite`;
  if (min === max) return `${lead} · ${max} choix`;
  return min ? `${lead} · ${min} à ${max} choix` : `${lead} · jusqu'à ${max} choix`;
}

/** Phrase générée à partir de la règle : « Le client doit choisir de 1 à 2 options. » */
export function ruleSentence(g) {
  const min = Math.max(g.min_select || 0, g.required ? 1 : 0);
  const max = g.max_select;
  const n = (k) => `${k} option${k > 1 ? 's' : ''}`;
  if (max == null) return min ? `Le client doit choisir au moins ${n(min)}.` : 'Le client peut choisir autant d\'options qu\'il veut (facultatif).';
  if (min && min === max) return `Le client doit choisir exactement ${n(max)}.`;
  if (min) return `Le client doit choisir de ${min} à ${max} options.`;
  return `Le client peut choisir jusqu'à ${n(max)} (facultatif).`;
}

export const byOrder = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name));
