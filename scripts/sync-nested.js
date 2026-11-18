/* The repository root is the single source of truth for the app.
   The nested folder "LIFE_AI_v6_2_QNET_LIVE_FIXED (3)/life_ai_v6_2" is only a generated copy, kept because the
   Netlify site may still publish from it. Never edit the copy by hand.

   node scripts/sync-nested.js          copy everything from the root into the nested folder
   node scripts/sync-nested.js --check  exit 1 (and list the files) if the copy is out of date */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const nested = path.join(root, 'LIFE_AI_v6_2_QNET_LIVE_FIXED (3)', 'life_ai_v6_2');

const FILES = ['index.html', 'logic.js', 'sw.js', 'manifest.json', 'netlify.toml', 'README.txt'];
const DIRS = ['icons', 'netlify/functions'];

function sharedFiles() {
  const list = FILES.filter(f => fs.existsSync(path.join(root, f)));
  for (const dir of DIRS) {
    // Includes files in sub-folders (for example netlify/functions/lib/xml.js).
    const walk = rel => {
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) return;
      for (const name of fs.readdirSync(full)) {
        const child = rel + '/' + name;
        const stat = fs.statSync(path.join(root, child));
        if (stat.isDirectory()) walk(child);
        else if (stat.isFile()) list.push(child);
      }
    };
    walk(dir);
  }
  return list;
}

const sameBytes = (a, b) => fs.existsSync(b) && Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;

// Files in the copy that no longer exist in the root (for example a deleted function).
function staleFiles() {
  const keep = new Set(sharedFiles());
  const stale = [];
  const scan = rel => {
    const full = path.join(nested, rel);
    if (!fs.existsSync(full)) return;
    for (const name of fs.readdirSync(full)) {
      const child = rel ? rel + '/' + name : name;
      if (fs.statSync(path.join(nested, child)).isDirectory()) { scan(child); continue; }
      if ([...DIRS, ...FILES].some(entry => child === entry || child.startsWith(entry + '/')) && !keep.has(child)) stale.push(child);
    }
  };
  scan('');
  return stale;
}

function check() {
  const problems = [];
  for (const rel of sharedFiles()) {
    if (!sameBytes(path.join(root, rel), path.join(nested, rel))) problems.push(rel);
  }
  for (const rel of staleFiles()) problems.push(rel + ' (removed from root)');
  return problems;
}

function sync() {
  for (const rel of sharedFiles()) {
    const target = path.join(nested, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, rel), target);
  }
  for (const rel of staleFiles()) fs.rmSync(path.join(nested, rel));
}

module.exports = { check, sync, sharedFiles, nested };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const problems = check();
    if (problems.length) {
      console.error('Nested copy is out of date. Run: node scripts/sync-nested.js\n - ' + problems.join('\n - '));
      process.exit(1);
    }
    console.log('Nested copy is in sync (' + sharedFiles().length + ' files).');
  } else {
    sync();
    console.log('Synced ' + sharedFiles().length + ' files into the nested folder.');
  }
}
