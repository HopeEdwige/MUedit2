/**
 * Decomposition parameter shape. Extracted from the container so the
 * domain owns the wire format — the container only reads DOM inputs and
 * passes raw values through.
 */
export function buildDecomposeParams(raw) {
  return {
    niter: raw.niter,
    nwindows: raw.nwindows,
    nbextchan: 1000,
    duplicatesthresh: raw.duplicatesthresh,
    sil_thr: raw.silVal,
    sil_filter: raw.silOn ? 1 : 0,
    cov_thr: raw.covVal,
    covfilter: raw.covOn ? 1 : 0,
    contrast_func: "skew",
    initialization: 0,
    peel_off_enabled: raw.peelOn ? 1 : 0,
    peel_off_win: raw.peelWindow / 1000,
    use_adaptive: raw.adaptiveOn ? 1 : 0,
    full_trace: raw.fullTraceOn ? 1 : 0,
  };
}
