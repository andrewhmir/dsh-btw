// Point a mirror profile at the workspace dsh-btw package, exactly as
// plugin_manager install_bundle would after a local install: add the `link:`
// dependency and append the bundle name to dsh.profile.bundles.
//
//   node patch-mirror-profile.mjs <profile dir> <plugin dir>

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [profileDir, pluginDir] = process.argv.slice(2);
if (!profileDir || !pluginDir) {
  console.error('usage: node patch-mirror-profile.mjs <profile dir> <plugin dir>');
  process.exit(2);
}

const manifestPath = path.join(profileDir, 'package.json');
const pluginManifestPath = path.join(pluginDir, 'package.json');
const pluginName = JSON.parse(readFileSync(pluginManifestPath, 'utf8')).name;
if (typeof pluginName !== 'string' || pluginName.length === 0) {
  console.error(`the plugin package has no name: ${pluginManifestPath}`);
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
pkg.dependencies = pkg.dependencies ?? {};
pkg.dependencies[pluginName] = `link:${pluginDir.replace(/\\/g, '/')}`;
pkg.dsh = pkg.dsh ?? {};
pkg.dsh.profile = pkg.dsh.profile ?? {};
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles ?? [];
if (!pkg.dsh.profile.bundles.includes(pluginName)) pkg.dsh.profile.bundles.push(pluginName);
writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`patched ${manifestPath}`);
