import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import creatorShapes from '../src/creator-shapes.json' with { type: 'json' };

const revision = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const source = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${revision}`;
const directory = fileURLToPath(new URL('../assets/characters/human/', import.meta.url));
const files = [
  ['LICENSE.ASSETS.md', 'LICENSE.md'],
  ['makehuman/data/3dobjs/base.obj', 'base.obj'],
  ['makehuman/data/rigs/default.mhskel', 'rig.json'],
  ['makehuman/data/rigs/default_weights.mhw', 'weights.json'],
];
const targets = [
  'macrodetails/asian-female-young', 'macrodetails/asian-male-young',
  ...['female', 'male'].flatMap(gender => ['maxweight', 'minweight'].map(weight => `macrodetails/universal-${gender}-young-averagemuscle-${weight}`)),
  'head/head-round', 'head/head-square', 'nose/nose-scale-horiz-incr', 'nose/nose-scale-depth-incr',
  'mouth/mouth-scale-horiz-incr', 'eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr',
  ...creatorShapes.flatMap(shape => [...shape.positive, ...shape.negative]),
];
files.push(...[...new Set(targets)].map(target => [`makehuman/data/targets/${target}.target`, `targets/${target.replaceAll('/', '_')}.target`]));
await mkdir(directory, { recursive: true });
const records = [];
for (const [path, filename] of files) {
  const destination = `${directory}/${filename}`;
  let content;
  try { content = await readFile(destination); }
  catch {
    content = execFileSync('curl.exe', ['--fail', '--silent', '--show-error', '--location', '--proxy',
      'http://127.0.0.1:2080', '--max-time', '120', `${source}/${path}`], { maxBuffer: 12 * 1024 * 1024 });
  }
  if (filename.endsWith('.json')) JSON.parse(content.toString('utf8'));
  if (filename.endsWith('.obj') && !content.toString('utf8').includes('\nv ')) throw new Error('Invalid body geometry');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
  records.push({ path, filename, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length });
}
let system;
try { ({ system } = JSON.parse(await readFile(`${directory}/source.json`, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (process.argv[2]) {
  const archive = await readFile(process.argv[2]);
  const selected = /(?:^|\/)(hair\/(?:short01|bob01|long01)|clothes\/(?:female_casualsuit01|female_casualsuit02|male_casualsuit01|male_casualsuit02|shoes01)|eyes\/(?:high-poly|materials)|eyebrows\/eyebrow001)\//;
  const entries = unzipSync(archive, { filter: entry => selected.test(entry.name) && !entry.name.endsWith('/') });
  if (Object.keys(entries).length < 10) throw new Error('System asset archive does not contain expected files');
  for (const [path, content] of Object.entries(entries)) {
    const relative = path.slice(path.search(/(?:hair|clothes|eyes|eyebrows)\//));
    if (relative.includes('..') || relative.includes('\\')) throw new Error('Invalid archive entry');
    const destination = `${directory}/system/${relative}`;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  system = { url: 'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip',
    license: 'CC0-1.0', sha256: createHash('sha256').update(archive).digest('hex'), files: Object.keys(entries) };
  console.log(`Extracted ${system.files.length} system asset files`);
}
await writeFile(`${directory}/source.json`, JSON.stringify({ repository: 'makehumancommunity/makehuman', revision, license: 'CC0-1.0', files: records, system }, null, 2));
console.log(JSON.stringify(records.map(({ filename, bytes }) => ({ filename, bytes }))));