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

/** Clé de comparaison d'un nom : sans accents, minuscules, sans extension de fichier, sans « s » final (ketchup.jpg = Ketchup, sauces = sauce). */
export function nameKey(s, { file = false } = {}) {
  let t = String(s ?? '');
  if (file) t = t.replace(/\.[a-z0-9]{2,5}$/i, '');
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)).join(' ');
}

/** Associe chaque fichier photo aux options de même nom (toutes listes confondues). */
export function matchPhotos(files, groups) {
  const all = groups.flatMap((g) => g.options.map((o) => ({ id: o.id, label: o.label, group: g.internal_name || g.title, hasPhoto: !!o.photo, key: nameKey(o.label) })));
  return files.map((file) => {
    const key = nameKey(file.name, { file: true });
    return { file, key, options: all.filter((o) => key && o.key === key) };
  });
}

export const byOrder = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name));

/** Comme toCents, mais accepte un montant négatif (réduction d'une option, ex. « sans boisson » : -1). */
export function toSignedCents(v) {
  const n = parseFloat(String(v).trim().replace(',', '.').replace(/\s|€/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
