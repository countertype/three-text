export interface HyphenationTrieNode {
  patterns: number[] | null;
  children: { [key: string]: HyphenationTrieNode };
}
