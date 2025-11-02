/**
 * @license
 *
 * Hyphenation patterns for Galician (gl)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2006, 2007, 2008, 2010 Javier A. Múgica
 *
 * Permissive license - see tex-hyphen project
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const gl_patterns: HyphenationTrieNode;
export default gl_patterns;
