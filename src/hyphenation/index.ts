// Patterns are loaded dynamically to reduce bundle size

export interface HyphenationTrieNode {
  patterns: number[] | null; // Liang algorithm values: odd = break, even = no-break
  children: { [char: string]: HyphenationTrieNode };
}

export { loadPattern } from './HyphenationPatternLoader';
