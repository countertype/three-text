/**
 * @license
 *
 * Hyphenation patterns for Hungarian (hu)
 *
 * URL: http://www.hyphenation.org/tex
 * Source: hyph-utf8 project
 *
 * Copyright (C) 2003 Bence Nagy
 *
 * name: MPL version: 1.1 initial_developer: Bence Nagy contributors: - Bence Nagy url: https://www.mozilla.org/en-US/MPL/1.1/ name: GPL version: 2.0 url: http://www.gnu.org/licenses/old-licenses/gpl-2.0.html name: LGPL version: 2.1 url: http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
 *
 */

export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [char: string]: HyphenationTrieNode };
}

declare const hu_patterns: HyphenationTrieNode;
export default hu_patterns;
