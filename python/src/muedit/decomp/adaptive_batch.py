
"""Adaptive post-processing helpers for online-style decomposition batches."""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Literal

import numpy as np

from muedit.adapt_decomp.config import Config
from muedit.signal.decomp_primitives import (
    POSTPROC_MIN_ISI_SEC,
    extend_signal,
    find_refractory_peaks,
    signed_square,
    split_by_amplitude,
)

# Single source of truth for the adaptive hyperparameter defaults: the public
# ``adaptive_batch_process`` signature reads these so the defaults stay in sync
# with :class:`muedit.adapt_decomp.config.Config` instead of being re-typed.
_DEFAULT_CONFIG = Config()


def _compute_calibration_stats(
    w_sig: np.ndarray,
    mu_filters: np.ndarray,
    fsamp: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Project the whitened calibration signal through MU filters and derive spike centroids."""
    n_mu = mu_filters.shape[1]
    ipts_calib = (w_sig.T @ mu_filters).astype(np.float32)
    ipts_sq    = signed_square(ipts_calib)

    base_centr   = np.zeros(n_mu, dtype=np.float32)
    spikes_centr = np.ones(n_mu, dtype=np.float32)

    for j in range(n_mu):
        pt = ipts_sq[:, j]
        peaks = find_refractory_peaks(pt, fsamp, min_isi_sec=POSTPROC_MIN_ISI_SEC)
        if len(peaks) > 1:
            _, centroids, _ = split_by_amplitude(pt, peaks)
            hi = int(np.argmax(centroids))
            spikes_centr[j] = float(centroids[hi])
            base_centr[j]   = float(centroids[1 - hi])
        elif len(peaks) == 1:
            spikes_centr[j] = float(pt[peaks[0]])

    return base_centr, spikes_centr


def _run_one_pass(
    emg_seg: np.ndarray,
    emg_calib: np.ndarray,
    whiten_mat: np.ndarray,
    mu_filters: np.ndarray,
    base_centr: np.ndarray,
    spikes_centr: np.ndarray,
    ex_factor: int,
    config: Config,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Run adaptive decomposition on a single EMG segment and return ipts, spikes, and losses.

    ``ex_factor`` varies per pass (the backward pass uses 1 because its input is
    already extended), so it overrides ``config.ex_factor`` via :func:`dataclasses.replace`.
    """
    from muedit.adapt_decomp.adaptation import run_adaptive_decomposition

    cfg = replace(config, ex_factor=ex_factor)
    ipts, spikes, losses = run_adaptive_decomposition(
        emg=emg_seg.astype(np.float32),
        whitening=whiten_mat.astype(np.float32),
        sep_vectors=mu_filters.T.astype(np.float32),
        base_centr=base_centr.copy(),
        spikes_centr=spikes_centr.copy(),
        emg_calib=emg_calib.astype(np.float32),
        config=cfg,
    )
    return ipts.astype(np.float64), spikes, losses


def _run_adapt_decomp_bidirectional(
    grid_data_g: np.ndarray,
    win_data_g: np.ndarray,
    whiten_mat: np.ndarray,
    mu_filters: np.ndarray,
    w_sig: np.ndarray,
    calib_start: int,
    config: Config,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Run adaptive decomposition forward from calib_start and, if needed, backward over the pre-calibration segment."""
    base_centr, spikes_centr = _compute_calibration_stats(
        w_sig, mu_filters, config.fsamp
    )

    ex_factor = w_sig.shape[0] // win_data_g.shape[0]
    bs = config.batch_size

    emg_calib_raw = win_data_g.T.astype(np.float32)
    n_calib = win_data_g.shape[1]
    emg_calib_ext = extend_signal(win_data_g, ex_factor).T[:n_calib].astype(np.float32)

    fwd_start = max(0, calib_start - bs)
    emg_fwd = np.ascontiguousarray(grid_data_g[:, fwd_start:].T.astype(np.float32))
    ipts_fwd_full, spikes_fwd_full, losses_fwd = _run_one_pass(
        emg_seg=emg_fwd,
        emg_calib=emg_calib_raw,
        whiten_mat=whiten_mat,
        mu_filters=mu_filters,
        base_centr=base_centr,
        spikes_centr=spikes_centr,
        ex_factor=ex_factor,
        config=config,
    )
    ipts_fwd   = ipts_fwd_full[calib_start - fwd_start:]
    spikes_fwd = spikes_fwd_full[calib_start - fwd_start:]

    if calib_start == 0:
        return ipts_fwd, spikes_fwd, losses_fwd

    # `extend_signal` adds (ex_factor - 1) trailing padded samples; keep only
    # the original pre-calibration duration to avoid forward/backward offset.
    e_pre = extend_signal(grid_data_g[:, :calib_start], ex_factor).T[:calib_start]

    split_pts = list(range(bs, calib_start, bs))
    blocks = np.split(e_pre, split_pts, axis=0)
    emg_bwd = np.ascontiguousarray(np.concatenate(blocks[::-1], axis=0).astype(np.float32))

    ipts_bwd_rev, spikes_bwd_rev, losses_bwd_rev = _run_one_pass(
        emg_seg=emg_bwd,
        emg_calib=emg_calib_ext,
        whiten_mat=whiten_mat,
        mu_filters=mu_filters,
        base_centr=base_centr,
        spikes_centr=spikes_centr,
        ex_factor=1,
        config=config,
    )

    # Re-split at the reversed block boundaries: when calib_start % bs != 0 the
    # last block is smaller, so the reversed concatenation has different split
    # points than the original. Splitting at the original split_pts would
    # scramble the time order.
    rev_split_pts = list(np.cumsum([b.shape[0] for b in reversed(blocks)]))[:-1]
    out_ipts   = np.split(ipts_bwd_rev,   rev_split_pts, axis=0)
    out_spikes = np.split(spikes_bwd_rev, rev_split_pts, axis=0)
    ipts_bwd   = np.concatenate(out_ipts[::-1],   axis=0)
    spikes_bwd = np.concatenate(out_spikes[::-1], axis=0)

    losses: dict[str, Any] = {}
    if config.compute_loss and losses_fwd:
        # Backward losses are indexed by fixed-stride batches in the reversed
        # segment. A plain reversal restores original-time order only when
        # blocks align with batch strides (calib_start % bs == 0); otherwise
        # the batches span non-contiguous original-time spans and no
        # permutation is valid. The trailing remainder also gets no loss
        # entry (n_batches = n_samples // bs), so n_bwd may be short by one.
        bwd = losses_bwd_rev
        if calib_start % bs == 0:
            n_bwd = bwd.get("wh_loss", np.array([])).shape[0]
            bwd_idx = list(range(n_bwd - 1, -1, -1))
            bwd = {
                "wh_loss": bwd["wh_loss"][bwd_idx],
                "sv_loss": bwd["sv_loss"][bwd_idx],
                "total_loss": bwd["total_loss"][bwd_idx],
            }
        else:
            # Misaligned: no permutation restores original-time order, so emit
            # NaNs rather than a plausible-but-wrong reversed-batch ordering.
            n_bwd = bwd["wh_loss"].shape[0]
            n_mu = bwd["sv_loss"].shape[1]
            bwd = {
                "wh_loss": np.full(n_bwd, np.nan, dtype=bwd["wh_loss"].dtype),
                "sv_loss": np.full((n_bwd, n_mu), np.nan, dtype=bwd["sv_loss"].dtype),
                "total_loss": np.full(n_bwd, np.nan, dtype=bwd["total_loss"].dtype),
            }
        losses = {
            "wh_loss": np.concatenate([
                bwd["wh_loss"],
                losses_fwd["wh_loss"],
            ]),
            "sv_loss": np.concatenate([
                bwd["sv_loss"],
                losses_fwd["sv_loss"],
            ], axis=0),
            "total_loss": np.concatenate([
                bwd["total_loss"],
                losses_fwd["total_loss"],
            ]),
        }

    return (
        np.concatenate([ipts_bwd, ipts_fwd], axis=0),
        np.concatenate([spikes_bwd, spikes_fwd], axis=0),
        losses,
    )


def adaptive_batch_process(
    mu_filters_by_window: dict[int, np.ndarray],
    w_sig_by_window: dict[int, np.ndarray],
    win_data: dict[int, np.ndarray],
    whiten_mats: dict[int, np.ndarray],
    grid_data: dict[int, np.ndarray],
    coordinates: list[int],
    ltime: int,
    fsamp: float,
    nwindows_per_grid: int,
    batch_ms: int = _DEFAULT_CONFIG.batch_ms,
    adapt_wh: bool = _DEFAULT_CONFIG.adapt_wh,
    adapt_sv: bool = _DEFAULT_CONFIG.adapt_sv,
    adapt_sd: bool = _DEFAULT_CONFIG.adapt_sd,
    wh_learning_rate: float = _DEFAULT_CONFIG.wh_learning_rate,
    sv_learning_rate: float = _DEFAULT_CONFIG.sv_learning_rate,
    cov_alpha: float = _DEFAULT_CONFIG.cov_alpha,
    spike_prev_weight: int = _DEFAULT_CONFIG.spike_prev_weight,
    contrast_func: Literal["logcosh", "cube"] = _DEFAULT_CONFIG.contrast_func,
    compute_loss: bool = _DEFAULT_CONFIG.compute_loss,
) -> tuple[np.ndarray, list[np.ndarray], dict[str, Any]]:
    """Apply adaptive post-processing across all decomposition windows and grids.

    The adaptive hyperparameter defaults are sourced from
    :class:`muedit.adapt_decomp.config.Config` (via ``_DEFAULT_CONFIG``) so they
    stay in sync with the standalone adaptive path. They are folded into a
    single :class:`Config` here and threaded through the inner helpers, rather
    than re-declared at each call level.
    """
    from muedit.signal.filters import demean

    config = Config(
        fsamp=int(fsamp),
        batch_ms=batch_ms,
        adapt_wh=adapt_wh,
        adapt_sv=adapt_sv,
        adapt_sd=adapt_sd,
        wh_learning_rate=wh_learning_rate,
        sv_learning_rate=sv_learning_rate,
        cov_alpha=cov_alpha,
        spike_prev_weight=spike_prev_weight,
        contrast_func=contrast_func,
        compute_loss=compute_loss,
    )

    total_mus = sum(f.shape[1] for f in mu_filters_by_window.values() if f.size > 0)
    if total_mus == 0:
        return np.array([]), [], {}

    pulse_t = np.zeros((total_mus, ltime), dtype=np.float64)
    distime: list[np.ndarray] = []
    mu_nb = 0
    all_losses: dict[int, dict[str, Any]] = {}

    grid_data_demeaned = {i: demean(g) for i, g in grid_data.items()}

    for nwin in sorted(mu_filters_by_window.keys()):
        filters = mu_filters_by_window[nwin]
        if filters.size == 0:
            continue

        grid_idx    = nwin // max(1, nwindows_per_grid)
        calib_start = coordinates[nwin * 2]

        ipts_out, spikes_out, win_losses = _run_adapt_decomp_bidirectional(
            grid_data_g=grid_data_demeaned[grid_idx],
            win_data_g=demean(win_data[nwin]),
            whiten_mat=whiten_mats[nwin],
            mu_filters=filters,
            w_sig=w_sig_by_window[nwin],
            calib_start=calib_start,
            config=config,
        )

        if compute_loss and win_losses:
            all_losses[nwin] = win_losses

        for j in range(filters.shape[1]):
            pt = signed_square(ipts_out[:, j])
            pulse_t[mu_nb, :] = pt[:ltime]
            distime.append(np.where(spikes_out[:ltime, j] > 0)[0].astype(int))
            mu_nb += 1

    return pulse_t, distime, all_losses
