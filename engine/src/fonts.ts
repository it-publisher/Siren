import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

const SUBSETS = ["latin", "cyrillic"] as const;
const WEIGHTS = ["400", "700"] as const;

// Шрифты подгружаются при рендере, чтобы их файлы не попадали в git.
export const headingFont = loadInter("normal", {
  weights: [...WEIGHTS],
  subsets: [...SUBSETS],
}).fontFamily;

export const codeFont = loadJetBrainsMono("normal", {
  weights: [...WEIGHTS],
  subsets: [...SUBSETS],
}).fontFamily;
