// Patch a clean-room profile manifest: add the plugin's dependency (only when a
// local directory is linked) and put the package name in dsh.profile.bundles —
// the same two effects `plugin_manager install_bundle` has.
//
//   node patch-clean-room-profile.mjs <profile dir> <package name> [link dir]
//
// A link dir is given for a local package install; for an npm spec the
// dependency is already written by `dsh plugin add`, so only the bundle entry
// is added.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [profileDir, packageName, linkDir] = process.argv.slice(2);
if (!profileDir || !packageName) {
  console.error('usage: node patch-clean-room-profile.mjs <profile dir> <package name> [link dir]');
  process.exit(2);
}

const manifestPath = path.join(profileDir, 'package.json');
const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));

pkg.dsh = pkg.dsh ?? {};
pkg.dsh.profile = pkg.dsh.profile ?? {};
pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];

if (linkDir) {
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies[packageName] = `link:${linkDir.replace(/\\/g, '/')}`;
}

if (!pkg.dsh.profile.bundles.includes(packageName)) pkg.dsh.profile.bundles.push(packageName);

writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`patched ${manifestPath} (bundles: ${pkg.dsh.profile.bundles.join(', ')})`);
