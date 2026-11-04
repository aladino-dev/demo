// Copie les photos des produits depuis la sauvegarde WordPress (fichier « -uploads.zip » d'UpdraftPlus)
// et les convertit en WebP (800 px de large) dans web/public/photos/<restaurant>/.
// Usage : npm run photos -- "C:\chemin\vers\backup_…-uploads.zip"
import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.PHOTOS_DIR || path.join(ROOT, 'photos');
const zipPath = process.argv[2];
if (!zipPath || !fs.existsSync(zipPath)) {
  console.error('Indiquez le chemin du fichier …-uploads.zip de la sauvegarde.');
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed-food-station.json'), 'utf8'));
const wanted = new Map(); // "2026/10/x.png" -> "x.webp"
for (const p of seed.products) {
  if (p.photo_source) wanted.set(p.photo_source, path.basename(p.photo_source).replace(/\.[a-z0-9]+$/i, '') + '.webp');
}
const outDir = path.join(OUT, seed.restaurant.slug);
fs.mkdirSync(outDir, { recursive: true });

let done = 0;
yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
  if (err) throw err;
  zip.readEntry();
  zip.on('entry', (e) => {
    const rel = e.fileName.replace(/^.*?uploads\//, '');
    const target = wanted.get(rel);
    if (!target) return zip.readEntry();
    zip.openReadStream(e, (err2, stream) => {
      if (err2) throw err2;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', async () => {
        try {
          await sharp(Buffer.concat(chunks)).rotate().resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 80 }).toFile(path.join(outDir, target));
          done++;
          wanted.delete(rel);
        } catch (e3) {
          console.warn('Photo ignorée :', rel, e3.message);
        }
        zip.readEntry();
      });
    });
  });
  zip.on('end', () => {
    console.log(`${done} photos converties dans ${path.relative(ROOT, outDir)}`);
    if (wanted.size) console.log(`${wanted.size} photo(s) introuvable(s) dans la sauvegarde :`, [...wanted.keys()].join(', '));
  });
});
