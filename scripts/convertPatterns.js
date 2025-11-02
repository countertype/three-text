#!/usr/bin/env node

// Hyphenation pattern converter
//
// This script converts TeX hyphenation pattern files into JavaScript modules containing
// trie structures for efficient pattern matching and hyphenation using the Liang algorithm.
//
// It creates:
// - ESM format (*.js)
// - UMD format for browser script tags (*.umd.js)
// - TypeScript declarations (*.d.ts)
// - Minified versions of each (*.min.js, *.umd.min.js)
//
// Usage:
//    node convertPatterns.js
//    node convertPatterns.js --languages en-us,fr

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as terser from 'terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(path.join(__dirname, '..'));
const PATTERNS_DIR = path.join(
  PROJECT_ROOT,
  'tex-hyphen/hyph-utf8/tex/generic/hyph-utf8/patterns/txt'
);
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'src/hyphenation');
const DIST_OUTPUT_DIR = path.join(PROJECT_ROOT, 'dist/patterns');
const TEX_PATTERNS_DIR = path.join(
  PROJECT_ROOT,
  'tex-hyphen/hyph-utf8/tex/generic/hyph-utf8/patterns/tex'
);
const SUBMODULE_DIR = path.join(PROJECT_ROOT, 'tex-hyphen');

// The tex-hyphen project is included as a git submodule
// This approach ensures that we can reliably access the pattern source files
// during the build process without requiring developers to manually clone the repo.

// Exclude ancient/liturgical languages and obsolete orthographies
const EXCLUSION_LIST = new Set([
  'de-1901',
  'de-ch-1901',
  'la-x-classic',
  'la-x-liturgic',
  'cop',
  'cu',
  'grc',
  'grc-x-ibycus',
  'pi',
  'fi-x-school'
]);

function extractLicenseFromTexFile(languageCode) {
  const texFile = path.join(TEX_PATTERNS_DIR, `hyph-${languageCode}.tex`);

  if (!fs.existsSync(texFile)) {
    // Some patterns lack .tex metadata files
    return {
      copyright: 'Various authors',
      license: 'Permissive license - see tex-hyphen project'
    };
  }

  try {
    const content = fs.readFileSync(texFile, 'utf8');
    const lines = content.split('\n').slice(0, 50); // Check first 50 lines

    let copyright = '';
    let license = '';
    let inLicenseBlock = false;

    for (const line of lines) {
      if (line.startsWith('% copyright:')) {
        copyright = line.replace('% copyright:', '').trim();
      } else if (
        line.startsWith('% licence:') ||
        line.startsWith('% license:')
      ) {
        inLicenseBlock = true;
      } else if (inLicenseBlock && line.startsWith('%     text: >')) {
        continue;
      } else if (inLicenseBlock && line.startsWith('%         ')) {
        // License text uses deeper indentation
        const licenseText = line.replace(/%\s+/, '').trim();
        if (licenseText) {
          license += licenseText + ' ';
        }
      } else if (
        inLicenseBlock &&
        line.startsWith('% ') &&
        !line.startsWith('%     ')
      ) {
        // License block ended
        inLicenseBlock = false;
      } else if (inLicenseBlock && !line.includes('%')) {
        inLicenseBlock = false;
      }
    }

    return {
      copyright: copyright || 'Various authors',
      license: license.trim() || 'Permissive license - see tex-hyphen project'
    };
  } catch (e) {
    return {
      copyright: 'Various authors',
      license: 'Permissive license - see tex-hyphen project'
    };
  }
}

function getLicenseHeader(languageCode, languageName) {
  const licenseInfo = extractLicenseFromTexFile(languageCode);

  return `/**
 * @license
 *
 * Hyphenation patterns for ${languageName} (${languageCode})
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * ${licenseInfo.copyright}
 *
 * ${licenseInfo.license}
 *
 */
`;
}

function createTrieNode() {
  return {
    patterns: null, // Array of hyphenation points when this is a terminal node
    children: {} // Map of character -> child node
  };
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Created output directory: ${OUTPUT_DIR}`);
}

if (!fs.existsSync(DIST_OUTPUT_DIR)) {
  fs.mkdirSync(DIST_OUTPUT_DIR, { recursive: true });
  console.log(`Created dist output directory: ${DIST_OUTPUT_DIR}`);
}

// Check if the submodule has been initialized.
if (
  !fs.existsSync(SUBMODULE_DIR) ||
  fs.readdirSync(SUBMODULE_DIR).length === 0
) {
  console.error(`
ERROR: The tex-hyphen submodule is not initialized.

This is only required for contributors who need to rebuild patterns.
Please run the following command to initialize the submodule:

  git submodule update --init --recursive

Then, you can run the pattern build script again.
`);
  process.exit(1);
}

const args = process.argv.slice(2);
let selectedLanguages = null;
const langIndex = args.indexOf('--languages');
if (langIndex !== -1 && args[langIndex + 1]) {
  selectedLanguages = new Set(args[langIndex + 1].split(','));
  console.log(
    `Building patterns for selected languages: ${[...selectedLanguages].join(
      ', '
    )}`
  );
}

console.log(`Scanning patterns directory: ${PATTERNS_DIR}`);
let patternFiles = fs
  .readdirSync(PATTERNS_DIR)
  .filter((file) => file.endsWith('.pat.txt'))
  .filter(
    (file) =>
      !EXCLUSION_LIST.has(file.replace(/^hyph-/, '').replace(/\.pat\.txt$/, ''))
  )
  .sort(); // Sort to process them in alphabetical order

if (selectedLanguages) {
  patternFiles = patternFiles.filter((file) => {
    const lang = file.replace(/^hyph-/, '').replace(/\.pat\.txt$/, '');
    return selectedLanguages.has(lang);
  });

  if (patternFiles.length === 0) {
    console.warn(`No pattern files found for the selected languages.`);
    process.exit(0);
  }
}

console.log(`Found ${patternFiles.length} pattern files to process.`);

const processedLanguages = [];

for (const patternFile of patternFiles) {
  const sourcePath = path.join(PATTERNS_DIR, patternFile);

  const language = patternFile.replace(/^hyph-/, '').replace(/\.pat\.txt$/, '');

  const safeLangName = language.replace(/-/g, '_');

  const languageDetails = {
    source: patternFile,
    tsOutput: `${language}.ts`, // TypeScript file (for the source directory)
    language: language,
    safeName: safeLangName,
    name: getLanguageName(language)
  };

  const tsSrcPath = path.join(OUTPUT_DIR, languageDetails.tsOutput);

  console.log(`Converting ${languageDetails.name} (${language}) patterns...`);

  try {
    const patterns = fs
      .readFileSync(sourcePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.trim());

    console.log(
      `Found ${patterns.length} patterns for ${languageDetails.name}`
    );

    const trie = createTrieNode();

    patterns.forEach((pattern) => {
      const chars = [];
      const points = [0]; // Start with 0 for the beginning of the word

      for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char >= '0' && char <= '9') {
          points[chars.length] = parseInt(char, 10);
        } else {
          chars.push(char);

          if (points.length <= chars.length) {
            points.push(0);
          }
        }
      }

      let current = trie;

      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];

        if (!current.children[char]) {
          current.children[char] = createTrieNode();
        }

        current = current.children[char];

        if (i === chars.length - 1) {
          current.patterns = points;
        }
      }
    });

    const jsonTrie = JSON.stringify(trie);

    const fileLicenseHeader = getLicenseHeader(language, languageDetails.name);

    const tsOutput = `${fileLicenseHeader}
// Avoid circular dependencies
type HyphenationTrieNode = import('./index').HyphenationTrieNode;

export const ${safeLangName}_patterns: HyphenationTrieNode = ${jsonTrie};

export default ${safeLangName}_patterns;
`;

    const esmOutput = `${fileLicenseHeader}
const ${safeLangName}_patterns = ${jsonTrie};

export default ${safeLangName}_patterns;
`;

    const umdOutput = `${fileLicenseHeader}
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, 
   (function() {
     var pattern = factory();
     global.ThreeTextPatterns_${safeLangName} = pattern;
     // Auto-register if ThreeText is already loaded
     if (global.ThreeText && global.ThreeText.Text && global.ThreeText.Text.registerPattern) {
       global.ThreeText.Text.registerPattern('${language}', pattern);
     }
     return pattern;
   })());
})(this, (function () {
  'use strict';
  
  return ${jsonTrie};
}));
`;

    const cjsOutput = `${fileLicenseHeader}
'use strict';

const ${safeLangName}_patterns = ${jsonTrie};

module.exports = ${safeLangName}_patterns;
`;

    const dtsOutput = `${fileLicenseHeader}
export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const ${safeLangName}_patterns: HyphenationTrieNode;
export default ${safeLangName}_patterns;
`;

    fs.writeFileSync(tsSrcPath, tsOutput, 'utf8');
    console.log(`Written TypeScript source file to ${tsSrcPath}`);

    // Only keep minified versions in git

    const dtsPath = path.join(DIST_OUTPUT_DIR, `${language}.d.ts`);
    fs.writeFileSync(dtsPath, dtsOutput, 'utf8');
    console.log(`Written TypeScript declaration to ${dtsPath}`);

    terser
      .minify({ 'file.js': esmOutput }, { format: { comments: /^!/ } })
      .then((result) => {
        const minPath = path.join(DIST_OUTPUT_DIR, `${language}.js`);
        const banner = fileLicenseHeader.replace(/\n$/, '');
        fs.writeFileSync(minPath, `${banner}\n${result.code}`, 'utf8');
        console.log(`Written ESM module to ${minPath}`);
      })
      .catch((err) => {
        console.error(`Error minifying ESM for ${language}:`, err);
      });

    terser
      .minify({ 'file.js': umdOutput }, { format: { comments: /^!/ } })
      .then((result) => {
        const minPath = path.join(DIST_OUTPUT_DIR, `${language}.umd.js`);
        const banner = fileLicenseHeader.replace(/\n$/, '');
        fs.writeFileSync(minPath, `${banner}\n${result.code}`, 'utf8');
        console.log(`Written UMD module to ${minPath}`);
      })
      .catch((err) => {
        console.error(`Error minifying UMD for ${language}:`, err);
      });

    terser
      .minify({ 'file.js': cjsOutput }, { format: { comments: /^!/ } })
      .then((result) => {
        const minPath = path.join(DIST_OUTPUT_DIR, `${language}.cjs`);
        const banner = fileLicenseHeader.replace(/\n$/, '');
        fs.writeFileSync(minPath, `${banner}\n${result.code}`, 'utf8');
        console.log(`Written CJS module to ${minPath}`);
      })
      .catch((err) => {
        console.error(`Error minifying CJS for ${language}:`, err);
      });

    processedLanguages.push({ ...languageDetails, jsonSize: jsonTrie.length });
  } catch (error) {
    console.error(
      `Error processing ${languageDetails.name} patterns:`,
      error.message
    );
  }
}

// index.ts manually maintained to avoid importing all patterns
console.log(
  `Skipping index.ts generation - manually maintained for dynamic loading`
);

const distIndexContent = `/**
 * All patterns are distributed under their original license.
 * See the header of each individual pattern file for license details.
 */

export const availablePatterns = [
${processedLanguages.map((lang) => `  '${lang.language}'`).join(',\n')}
];
`;

fs.writeFileSync(
  path.join(DIST_OUTPUT_DIR, 'index.js'),
  distIndexContent,
  'utf8'
);
console.log(
  `Generated dist pattern index file at ${path.join(
    DIST_OUTPUT_DIR,
    'index.js'
  )}`
);

const distIndexDts = `export const availablePatterns: string[];
`;

fs.writeFileSync(
  path.join(DIST_OUTPUT_DIR, 'index.d.ts'),
  distIndexDts,
  'utf8'
);
console.log(
  `Generated dist pattern index declarations at ${path.join(
    DIST_OUTPUT_DIR,
    'index.d.ts'
  )}`
);

console.log('Pattern conversion complete!');
console.log(
  `Successfully processed ${processedLanguages.length} pattern files`
);

processedLanguages.sort((a, b) => b.jsonSize - a.jsonSize);
console.log('\nPattern file sizes:');
processedLanguages.forEach((lang) => {
  console.log(
    `${lang.language.padEnd(15)} ${lang.name.padEnd(25)} ${(
      lang.jsonSize / 1024
    ).toFixed(1)}KB`
  );
});

function getLanguageName(langCode) {
  const languageNames = {
    af: 'Afrikaans',
    ar: 'Arabic',
    as: 'Assamese',
    be: 'Belarusian',
    bg: 'Bulgarian',
    bn: 'Bengali',
    ca: 'Catalan',
    cop: 'Coptic',
    cs: 'Czech',
    cu: 'Church Slavic',
    cy: 'Welsh',
    da: 'Danish',
    'de-1996': 'German',
    el: 'Greek',
    'el-monoton': 'Greek (Monotonic)',
    'el-polyton': 'Greek (Polytonic)',
    'en-gb': 'British English',
    'en-us': 'US English',
    eo: 'Esperanto',
    es: 'Spanish',
    et: 'Estonian',
    eu: 'Basque',
    fi: 'Finnish',
    fr: 'French',
    fur: 'Friulian',
    ga: 'Irish',
    gl: 'Galician',
    gu: 'Gujarati',
    hi: 'Hindi',
    hr: 'Croatian',
    hsb: 'Upper Sorbian',
    hu: 'Hungarian',
    hy: 'Armenian',
    ia: 'Interlingua',
    id: 'Indonesian',
    is: 'Icelandic',
    it: 'Italian',
    ka: 'Georgian',
    kmr: 'Kurmanji Kurdish',
    kn: 'Kannada',
    la: 'Latin',
    lt: 'Lithuanian',
    lv: 'Latvian',
    mk: 'Macedonian',
    ml: 'Malayalam',
    'mn-cyrl': 'Mongolian',
    mr: 'Marathi',
    'mul-ethi': 'Ethiopic',
    nb: 'Norwegian Bokmål',
    nl: 'Dutch',
    nn: 'Norwegian Nynorsk',
    oc: 'Occitan',
    or: 'Oriya',
    pa: 'Punjabi',
    pi: 'Pali',
    pl: 'Polish',
    pms: 'Piedmontese',
    pt: 'Portuguese',
    rm: 'Romansh',
    ro: 'Romanian',
    ru: 'Russian',
    sa: 'Sanskrit',
    'sh-cyrl': 'Serbo-Croatian (Cyrillic)',
    'sh-latn': 'Serbo-Croatian (Latin)',
    sk: 'Slovak',
    sl: 'Slovenian',
    sq: 'Albanian',
    'sr-cyrl': 'Serbian (Cyrillic)',
    sv: 'Swedish',
    ta: 'Tamil',
    te: 'Telugu',
    th: 'Thai',
    tk: 'Turkmen',
    tr: 'Turkish',
    uk: 'Ukrainian',
    'zh-latn-pinyin': 'Chinese Pinyin'
  };

  if (languageNames[langCode]) {
    return languageNames[langCode];
  }

  const mainLanguage = langCode.split('-')[0];
  if (languageNames[mainLanguage]) {
    return languageNames[mainLanguage];
  }

  return langCode
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
