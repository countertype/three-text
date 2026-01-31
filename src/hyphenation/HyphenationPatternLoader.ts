import { HyphenationTrieNode } from './types';

declare const __UMD__: boolean;

const SAFE_LANGUAGE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,16})*$/i;

// Built-in patterns shipped with three-text (matches files in src/hyphenation/*)
// Note: GPL-licensed patterns (cs, id, mk, sr-cyrl) are excluded for MIT compatibility
const BUILTIN_PATTERN_LANGUAGES = new Set<string>([
  'af',
  'as',
  'be',
  'bg',
  'bn',
  'ca',
  'cy',
  'da',
  'de-1996',
  'el-monoton',
  'el-polyton',
  'en-gb',
  'en-us',
  'eo',
  'es',
  'et',
  'eu',
  'fi',
  'fr',
  'fur',
  'ga',
  'gl',
  'gu',
  'hi',
  'hr',
  'hsb',
  'hu',
  'hy',
  'ia',
  'is',
  'it',
  'ka',
  'kmr',
  'kn',
  'la',
  'lt',
  'lv',
  'ml',
  'mn-cyrl',
  'mr',
  'mul-ethi',
  'nb',
  'nl',
  'nn',
  'oc',
  'or',
  'pa',
  'pl',
  'pms',
  'pt',
  'rm',
  'ro',
  'ru',
  'sa',
  'sh-cyrl',
  'sh-latn',
  'sk',
  'sl',
  'sq',
  'sv',
  'ta',
  'te',
  'th',
  'tk',
  'tr',
  'uk',
  'zh-latn-pinyin'
]);

export async function loadPattern(
  language: string,
  patternsPath?: string
): Promise<HyphenationTrieNode> {
  if (!SAFE_LANGUAGE_RE.test(language)) {
    throw new Error(
      `Invalid hyphenation language code "${language}". Expected e.g. "en-us".`
    );
  }

  // When no patternsPath is provided, we only allow the built-in set shipped with
  // three-text to avoid accidental arbitrary imports / path traversal
  if (!patternsPath && !BUILTIN_PATTERN_LANGUAGES.has(language)) {
    throw new Error(
      `Unsupported hyphenation language "${language}". ` +
        `Use a built-in language (e.g. "en-us") or register patterns via Text.registerPattern("${language}", pattern).`
    );
  }

  if (__UMD__) {
    const safeLangName = language.replace(/-/g, '_');
    const globalName = `ThreeTextPatterns_${safeLangName}`;

    // Check if pattern is already loaded as a global
    if ((window as any)[globalName]) {
      return (window as any)[globalName];
    }

    // Use provided path or default
    const patternBasePath = patternsPath || '/patterns/';

    // Dynamically load pattern via script tag
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${patternBasePath}${language}.umd.js`;
      script.async = true;

      script.onload = () => {
        if ((window as any)[globalName]) {
          resolve((window as any)[globalName]);
        } else {
          reject(
            new Error(
              `Pattern script loaded, but global ${globalName} not found.`
            )
          );
        }
      };

      script.onerror = () => {
        reject(
          new Error(
            `Failed to load hyphenation pattern from ${script.src}. Did you copy the pattern files to your public directory?`
          )
        );
      };

      document.head.appendChild(script);
    });
  } else {
    // In ESM build, use dynamic imports
    try {
      if (patternsPath) {
        const module = await import(
          /* @vite-ignore */ `${patternsPath}${language}.js`
        );
        return module.default;
      } else if (typeof import.meta?.url === 'string') {
        // Use import.meta.url to resolve relative to this module's location
        const baseUrl = new URL('.', import.meta.url).href;
        const patternUrl = new URL(`./patterns/${language}.js`, baseUrl).href;
        const module = await import(/* @vite-ignore */ patternUrl);
        return module.default;
      } else {
        // Fallback for environments without import.meta.url
        const module = await import(
          /* @vite-ignore */ `./patterns/${language}.js`
        );
        return module.default;
      }
    } catch (error) {
      throw new Error(
        `Failed to load hyphenation patterns for ${language}. Consider using static imports: import pattern from 'three-text/patterns/${language}'; Text.registerPattern('${language}', pattern);`
      );
    }
  }
}
