// Packages the Windows app into dist/Visual-win32-x64 (npm run pack).
import { packager } from '@electron/packager';

const [out] = await packager({
  dir: '.',
  name: 'Visual',
  platform: 'win32',
  arch: 'x64',
  out: 'dist',
  overwrite: true,
  icon: 'resources/icon.ico',
  asar: false,
  // Paths are relative to the project, starting with /.
  ignore: [/^\/dist(\/|$)/, /^\/scripts(\/|$)/, /^\/test(\/|$)/, /^\/docs(\/|$)/, /^\/\.git/, /^\/\.claude(\/|$)/]
});
console.log(`Wrote ${out}`);
