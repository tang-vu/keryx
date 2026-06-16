/**
 * Hidden SVG <defs> holding the guilloché engraving paths, mounted once at the
 * root. Components reference them with <use href="#eng-rose1"> etc. — banknote
 * rosette watermarks and the interference-wave divider.
 */

import { ROSE1, ROSE2, WAVE_A, WAVE_B, SEAL_RING } from "./mint-engravings-paths";

export function MintEngravings() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute" style={{ position: "absolute" }}>
      <defs>
        <path id="eng-rose1" fill="none" d={ROSE1} />
        <path id="eng-rose2" fill="none" d={ROSE2} />
        <path id="eng-waveA" fill="none" d={WAVE_A} />
        <path id="eng-waveB" fill="none" d={WAVE_B} />
        <path id="eng-sealring" d={SEAL_RING} />
      </defs>
    </svg>
  );
}
