import { HyphenationTrieNode } from './types';

declare const __UMD__: boolean;

export async function loadPattern(
  language: string,
  patternsPath?: string
): Promise<HyphenationTrieNode> {
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
