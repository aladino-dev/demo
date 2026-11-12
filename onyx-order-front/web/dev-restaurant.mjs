// Lance le site client pour UN restaurant, sans toucher au code : npm run dev:restaurant -- <slug> [port]
// Chaque restaurant a son dossier de build (.next-<slug>) : plusieurs sites peuvent tourner côte à côte (3000 = défaut, 3001…).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const [slug, port = '3001'] = process.argv.slice(2);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '')) {
  console.error('Usage : npm run dev:restaurant -- <slug> [port]   ex. npm run dev:restaurant -- nsgrill 3001');
  process.exit(1);
}
console.log(`Site de « ${slug} » : http://localhost:${port}`);
const child = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'dev', '-p', port], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_RESTAURANT: slug, NEXT_DIST_DIR: `.next-${slug}` },
});
child.on('exit', (code) => process.exit(code ?? 0));
