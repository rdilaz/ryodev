import { chmod, copyFile, lstat, mkdir, rm, utimes } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { publicFiles } from './static-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const dist = path.join(root, 'dist');

export async function build() {
  for (const file of publicFiles.keys()) {
    let source = root;
    for (const part of file.split('/')) {
      source = path.join(source, part);
      const info = await lstat(source);
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) {
        throw new Error(`Public files must be regular files, never links: ${file}`);
      }
    }
    if (!(await lstat(source)).isFile()) throw new Error(`Public file required: ${file}`);
  }
  // Only this fixed output directory is cleaned. Inputs are never rewritten.
  await rm(dist, { recursive: true, force: true });
  const directories = new Set([dist]);
  for (const file of publicFiles.keys()) {
    const output = path.join(dist, file);
    const directory = path.dirname(output);
    directories.add(directory);
    await mkdir(directory, { recursive: true });
    await copyFile(path.join(root, file), output);
    await chmod(output, 0o644);
    await utimes(output, 0, 0);
  }
  for (const directory of directories) {
    await chmod(directory, 0o755);
    await utimes(directory, 0, 0);
  }
  return dist;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  console.log(`Staged ${publicFiles.size} allowlisted static demo files in dist/`);
}
