/**
 * @license
 *
 * Hyphenation patterns for Ukrainian (uk)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 1998-2001 Maksym Polyakov
 *
 * name: MIT url: https://opensource.org/licenses/MIT name: LPPL url: https://latex-project.org/lppl/
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const uk_patterns: HyphenationTrieNode;
export default uk_patterns;
