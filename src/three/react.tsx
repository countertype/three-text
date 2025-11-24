import { Text as TextComponent } from './ThreeText';
import { Text as ThreeTextCore } from './index';

export type { ThreeTextProps } from './ThreeText';

// Attach static methods from ThreeText to the React component
export const Text = Object.assign(TextComponent, {
  setHarfBuzzPath: ThreeTextCore.setHarfBuzzPath,
  setHarfBuzzBuffer: ThreeTextCore.setHarfBuzzBuffer,
  init: ThreeTextCore.init,
  registerPattern: ThreeTextCore.registerPattern,
  preloadPatterns: ThreeTextCore.preloadPatterns,
  create: ThreeTextCore.create
});

