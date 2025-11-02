/**
 * @license
 *
 * Hyphenation patterns for Slovak (sk)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1992 Jana Chlebíková
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const sk_patterns: HyphenationTrieNode;
export default sk_patterns;
