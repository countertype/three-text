import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyHarfbuzzFiles() {
  try {
    const harfbuzzPackageJsonPath = require.resolve('harfbuzzjs/package.json');
    const harfbuzzSrc = path.dirname(harfbuzzPackageJsonPath);

    const harfbuzzDest = path.resolve(__dirname, '..', 'public', 'hb');

    if (!fs.existsSync(harfbuzzDest)) {
      fs.mkdirSync(harfbuzzDest, { recursive: true });
    }

    // Only copy WASM file - JS files are now bundled with three-text
    const filesToCopy = ['hb.wasm'];
    filesToCopy.forEach((file) => {
      const srcFile = path.join(harfbuzzSrc, file);
      const destFile = path.join(harfbuzzDest, file);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
        console.log(`Copied ${file} to ${harfbuzzDest}`);
      } else {
        console.warn(`Warning: ${file} not found in harfbuzzjs package.`);
      }
    });

    console.log(
      'HarfBuzz WASM file copied successfully. (JS files are bundled with three-text)'
    );
  } catch (error) {
    console.error('Error copying HarfBuzz files:', error);
    if (error.code === 'MODULE_NOT_FOUND') {
      console.error(
        'Could not find harfbuzzjs package. Please ensure it is listed as a dependency and installed.'
      );
    }
    process.exit(1);
  }
}

copyHarfbuzzFiles();
