/**
 * @license
 *
 * Hyphenation patterns for Georgian (ka)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2013 Levan Shoshiashvili
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const ka_patterns: HyphenationTrieNode;
export default ka_patterns;
