// TeX defaults

export const FITNESS_TIGHT_THRESHOLD = 12; // if badness > 12 when shrinking -> tight_fit
export const FITNESS_NORMAL_THRESHOLD = 99; // if badness > 99 when stretching -> loose_fit

export const DEFAULT_TOLERANCE = 200;
export const DEFAULT_PRETOLERANCE = 100;
export const DEFAULT_EMERGENCY_STRETCH = 0;

// In TeX, interword spacing is defined by font parameters (fontdimen):
// - fontdimen 2: interword space
// - fontdimen 3: interword stretch
// - fontdimen 4: interword shrink
// - fontdimen 7: extra space (for sentence endings)
//
// For Computer Modern, stretch = 1/2 space, shrink = 1/3 space,
// which has become the default for OpenType fonts in modern
// TeX implementations

export const SPACE_STRETCH_RATIO = 0.5; // stretch = 50% of space width (fontdimen 3 / fontdimen 2)
export const SPACE_SHRINK_RATIO = 1 / 3; // shrink = 33% of space width (fontdimen 4 / fontdimen 2)
