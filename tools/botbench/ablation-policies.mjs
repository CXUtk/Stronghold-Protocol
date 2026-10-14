// Four crossed switches, not a sequence of selectively retained improvements.
// B: measured build scoring; L: extra terrain/route layouts; S: carry score;
// C: disable PR 445's combo placement. Zero keeps the corresponding PR 445 behavior.
const FACTORIAL_POLICIES = Object.freeze(Object.fromEntries(
  Array.from({ length: 16 }, (_, bits) => {
    const [b, l, s, c] = [3, 2, 1, 0].map((shift) => (bits >> shift) & 1);
    return [`ablate-v14-b${b}-l${l}-s${s}-c${c}`, Object.freeze({
      rehearsal: l ? 11 : 4, partnerBand: 'band_amedic', personas: true,
      alignPersonas: true, playerParity: true, projectPrepEnd: true,
      ...(b ? { build: 'tanks' } : {}),
      ...(l ? { atlas: true, tactical: 'dual', routeVariants: true, keepLayout: true, dualRoutes: true }
        : s ? { tactical: 'carry' } : {}),
      ...(s ? {} : { rehearsalScore: 'pr445' }),
      skipCombos: !!c, traceEconomy: true,
      factors: { build: b, layouts: l, carryScore: s, disableCombos: c },
    })];
  }),
));

// Post-factorial diagnostics: distinguish anchor scoring from its teammate's shared-stock feedback.
export const ABLATION_POLICIES = Object.freeze({
  ...FACTORIAL_POLICIES,
  'ablate-v14-build-anchor-only': Object.freeze({ ...FACTORIAL_POLICIES['ablate-v14-b1-l0-s0-c0'],
    buildBands: ['band_amiya', 'band_ioleta'] }),
  'ablate-v14-build-touch-only': Object.freeze({ ...FACTORIAL_POLICIES['ablate-v14-b1-l0-s0-c0'],
    buildBands: ['band_amedic'] }),
});
