from pathlib import Path
import numpy as np
import pandas as pd
from scipy import interpolate
from scipy.interpolate import PchipInterpolator
import copy
import matplotlib.pyplot as plt

from scipy.signal import find_peaks
from scipy.ndimage import uniform_filter1d
import pickle
from scipy.signal import savgol_filter


class EMAnalysis():
    def __init__(self, path, sensor_id, sensor_type, smoother='MA_100'):
        """
        Initialize EB Analysis with parameters

        Parameters:
            path: Path to data directory
            sensor_id: Sensor ID number
            sensor_type: Standard or Inverted
            smoother: Smoothing method for the data
        """
        self.smoother = smoother
        self.sensor_id = sensor_id
        input_path = Path(path)
        if input_path.name.upper() == 'FUT':
            self.path = input_path.parent
        elif (input_path / 'CAP').is_dir() and (input_path / 'FUT').is_dir():
            self.path = input_path
        elif (input_path.parent / 'CAP').is_dir() and (input_path.parent / 'FUT').is_dir():
            self.path = input_path.parent
        else:
            self.path = input_path.parent
        self.sensor_type = sensor_type

        # Initialize channel order based on sensor type
        if sensor_type == "Standard":
            self.ch_order = np.arange(1, 9)
        elif sensor_type == "Inverted":
            self.ch_order = np.array([1, 2, 3, 4, 8, 7, 6, 5])
        else:
            raise ValueError(f"Invalid sensor_type: {sensor_type}")

        # Define paths and get file lists
        self.cap_path = self.path / "CAP"
        self.fut_path = self.path / "FUT"

        csv_files  = sorted(self.cap_path.glob("*.csv"))
        xlsx_files = sorted(self.fut_path.glob("*.xlsx"))
        if not csv_files or not xlsx_files:
            raise FileNotFoundError(
                f"Expected CAP CSV and FUT XLSX data under {self.path}. "
                f"Found {len(csv_files)} CAP file(s) and {len(xlsx_files)} FUT file(s)."
            )
        self.cap_size = len(csv_files)
        if len(csv_files) != len(xlsx_files):
            raise ValueError(
                f"CAP/FUT file counts must match under {self.path}: "
                f"{len(csv_files)} CAP file(s), {len(xlsx_files)} FUT file(s)."
            )

        # Load data
        self.cap, self.fut = self._create_data(csv_files, xlsx_files)

        # Pressure / sensor parameters
        self.start_force = 0    # kPa
        self.end_force   = 45   # kPa
        self.ch = 8
        self.v  = 5             # PCB board version offset
        self.SA = 325e-6        # surface area (m²)

        # Sampling
        self.fs = 200           # Hz
        self.dt = 1.0 / self.fs

        # ── Peak-detection parameters (mirrors MATLAB) ──────────────────────
        self.peak_det_smooth    = int(self.fs * 0.5)   # 100-sample window (0.5 s)
        self.min_peak_prominence = 0.08
        self.min_peak_width      = 300
        self.min_search_kPa      = 0.5
        self.max_search_kPa      = 20.0
        self.min_search_samples  = 10
        self.max_allowed_deriv   = 1.0
        self.min_allowed_deriv   = 0.0
        self.deriv_smooth_window = 5

        # Increment pressures (5, 10, …, 45 kPa)
        self.increment_pressures = np.arange(5, 50, 5)   # 5:5:45

        # Correct channel order
        self.cap = self._correct_ch_order(self.cap)

        # ── Storage ──────────────────────────────────────────────────────────
        self.run  = []
        self.t_c  = []
        self.t_f  = []
        self.test = []
        self.c    = np.zeros((self.cap_size, self.ch))

        # Shorted channels tracked per run (list of arrays)
        self.shorted_ch_by_run = []

        self.zaber_x       = []
        self.zaber_y       = []
        self.fir_dev       = []
        self.valz          = []
        self.locz          = []
        self.max_ps        = []
        self.max_kPa       = []
        self.inf_CAP       = []
        self.cap_inc       = []
        self.dcap_dt       = []
        self.dpressure_dt  = []

        self.max_ps_numeric  = np.zeros((self.cap_size, self.ch))
        self.max_kPa_numeric = np.zeros((self.cap_size, self.ch))
        self.inf_CAP_numeric = np.zeros((self.cap_size, self.ch))

        # ── Pipeline ─────────────────────────────────────────────────────────
        self._interp_cap()
        self._synch_and_plot()
        self._derive_and_plot()
        self._plot_all_chs_across_runs()
        self._plot_all_runs_across_chs()

    # =========================================================================
    # Smoothing helpers
    # =========================================================================

    def _smooth(self, y: np.ndarray) -> np.ndarray:
        """
        User-selected smoother (set at construction time).
        Used for display / storage of PS curves.
        """
        if self.smoother == 'MA_100':
            return pd.Series(y).rolling(100, min_periods=1).mean().to_numpy()

        elif self.smoother == 'MA_200':
            return pd.Series(y).rolling(200, min_periods=1).mean().to_numpy()

        elif self.smoother == 'SavGol':
            return savgol_filter(y, window_length=101, polyorder=2)

        elif self.smoother == 'CubicSpline':
            from scipy.interpolate import UnivariateSpline
            idx = np.arange(len(y))
            noise_std = np.std(np.diff(y))
            s = len(y) * (noise_std ** 2) * 5
            try:
                spl = UnivariateSpline(idx, y, s=s, k=3)
                return spl(idx)
            except Exception as e:
                print(f'CubicSpline failed ({e}), falling back to MA_100.')
                return pd.Series(y).rolling(100, min_periods=1).mean().to_numpy()

        else:
            raise ValueError(
                f"Unknown smoother: {self.smoother!r}. "
                f"Choose from {['MA_100', 'MA_200', 'SavGol', 'CubicSpline']}"
            )

    def _smooth_for_detection(self, y: np.ndarray) -> np.ndarray:
        """
        Fixed 0.5-second moving-mean window used *only* for peak detection.
        Mirrors MATLAB's:  smoothdata(x, "movmean", fs*0.5)
        """
        return (pd.Series(y)
                  .rolling(self.peak_det_smooth, min_periods=1, center=True)
                  .mean()
                  .to_numpy())

    # =========================================================================
    # Benchmark helper
    # =========================================================================

    @classmethod
    def run_smoother_benchmark(
        cls,
        output_path: str,
        n_curves: int = 10,
        n_reps: int = 3,
        noise_fraction: float = 0.15,
        weight_phase: float = 1.0,
        weight_attenuation: float = 1.0,
        weight_repro: float = 1.0,
    ) -> str:
        from smoothing_benchmark import PSCurveBenchmark
        bench = PSCurveBenchmark(
            path=output_path,
            n_curves=n_curves,
            n_reps=n_reps,
            noise_fraction=noise_fraction,
        )
        return bench.best_smoother(weight_phase, weight_attenuation, weight_repro)

    # =========================================================================
    # Data loading
    # =========================================================================

    def _create_data(self, csv_files, xlsx_files):
        cap, fut = [], []
        for f in csv_files:
            cap.append(pd.read_csv(f, usecols=range(16)))
        for f in xlsx_files:
            fut.append(pd.read_excel(f))
        return cap, fut

    def _correct_ch_order(self, cap):
        reordered_cap = []
        cols = (
            list(range(0, 5)) +
            list(self.ch_order + self.v - 1) +
            list(range(13, 16))
        )
        for df in cap:
            reordered_cap.append(df.iloc[:, cols])
        return reordered_cap

    # =========================================================================
    # Interpolation  (Python guards kept: NaN masking + datetime branching)
    # =========================================================================

    def _interp_cap(self):
        """Interpolate CAP and FUT data to 200 Hz."""
        for i in range(self.cap_size):

            # ── FUT elapsed time ──────────────────────────────────────────────
            time_col = self.fut[i].iloc[:, 2]

            if pd.api.types.is_datetime64_any_dtype(time_col):
                # datetime branch (Python guard – not in MATLAB)
                elapsed = (time_col.diff()
                                   .fillna(pd.Timedelta(0))
                                   .cumsum()
                                   .dt.total_seconds()
                                   .to_numpy())
            else:
                elapsed = np.concatenate([[0], np.cumsum(np.diff(time_col.to_numpy()))])

            # ── CAP time: mask NaNs before interpolation ──────────────────────
            # (Python guard – not present in MATLAB)
            cap_time      = self.cap[i].iloc[:, 0].values
            valid_mask    = ~np.isnan(cap_time)
            cap_time_clean = cap_time[valid_mask]

            # Common 200-Hz grids
            t_c_i = np.arange(0, cap_time_clean[-1] + self.dt, self.dt)
            t_f_i = np.arange(0, elapsed[-1]         + self.dt, self.dt)

            self.t_c.append(t_c_i)
            self.t_f.append(t_f_i)

            # Interpolate each CAP channel
            cap_interp = np.zeros((len(t_c_i), self.ch))
            for j in range(self.ch):
                col_idx        = j + self.v
                cap_data_clean = self.cap[i].iloc[:, col_idx].values[valid_mask]
                cap_data_clean = cap_data_clean - cap_data_clean[0]   # baseline subtract
                cap_interp[:, j] = np.interp(t_c_i, cap_time_clean, cap_data_clean)

            # Interpolate FUT force
            fut_interp = np.interp(t_f_i, elapsed, self.fut[i].iloc[:, 1].values)

            self.run.append([cap_interp, fut_interp])

    # =========================================================================
    # Synchronisation + trimming  (Python trimming logic kept)
    # =========================================================================

    def _synch_and_plot(self):
        """Sync CAP and FUT by aligning peaks; keep Python trimming logic."""
        temp_run = copy.deepcopy(self.run)

        for i in range(self.cap_size):

            # Detect shorted channels (per-run bookkeeping – mirrors MATLAB)
            temp_max_cap = np.max(temp_run[i][0], axis=0)
            shorted_ch_i = np.where(temp_max_cap > 10)[0]
            self.shorted_ch_by_run.append(shorted_ch_i)

            # Zero-out shorted channels for sync-channel selection
            cap_for_sync = temp_run[i][0].copy()
            cap_for_sync[:, shorted_ch_i] = 0

            max_per_channel = np.max(cap_for_sync, axis=0)
            chan = np.argmax(max_per_channel)

            # Peak locations
            loc_c = np.argmax(self.run[i][0], axis=0)
            loc_f = np.nanargmax(self.run[i][1])

            # Sample offset
            offset = int(round(
                (self.t_c[i][loc_c[chan]] - self.t_f[i][loc_f]) * self.fs
            ))

            if offset > 0:
                timec = self.t_c[i][offset:] - offset * self.dt
                caps  = self.run[i][0][offset:, :]
                timef = self.t_f[i][:]
                futs  = self.run[i][1][:]
            else:
                offset = abs(offset)
                timec = self.t_c[i][:]
                caps  = self.run[i][0][:, :]
                timef = self.t_f[i][offset:] - offset * self.dt
                futs  = self.run[i][1][offset:]

            # Align lengths to loc_f
            test_cap = np.column_stack([timec[:loc_f], caps[:loc_f, :]])
            test_fut = np.column_stack([
                timef[:loc_f],
                futs[:loc_f] / self.SA / 1000
            ])

            self.c[i, :] = np.max(caps, axis=0)

            # ── Python trimming logic (kept as-is) ────────────────────────────
            # 1. Cut everything after the force peak index
            # 2. Drop the last 500 samples from that peak-trimmed segment
            force    = test_fut[:, 1]
            peak_idx = np.argmax(force)

            test_cap = test_cap[:peak_idx, :]
            test_fut = test_fut[:peak_idx, :]

            if len(test_cap) > 500:
                test_cap = test_cap[:-500, :]
                test_fut = test_fut[:-500, :]

            self.test.append([test_cap, test_fut])

            # ── Raw-signal plots ──────────────────────────────────────────────
            for j in range(self.ch):
                fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(10, 12))

                ax1.plot(self.test[i][0][:, 0], self.test[i][0][:, j + 1])
                ax1.set_ylabel('Cap (pF)', fontsize=12)
                ax1.set_xlabel('Time (s)', fontsize=12)
                ax1.set_title(f'Raw Signal - Run #{i+1} - CH{j+1}',
                              fontsize=14, fontweight='bold')
                ax1.grid(True, alpha=0.3)

                ax2.plot(self.test[i][1][:, 0], self.test[i][1][:, 1])
                ax2.set_ylabel('Pressure (kPa)', fontsize=12)
                ax2.set_xlabel('Time (s)', fontsize=12)
                ax2.grid(True, alpha=0.3)

                ax3.plot(self.test[i][1][:, 1], self.test[i][0][:, j + 1])
                ax3.set_xlabel('Pressure (kPa)', fontsize=12)
                ax3.set_ylabel('Cap (pF)', fontsize=12)
                ax3.grid(True, alpha=0.3)

                ax1.sharex(ax2)
                plt.tight_layout()

                filename = self.path / f'Raw Signal_Run #{i+1}_CH{j+1}.png'
                plt.savefig(filename, dpi=300, bbox_inches='tight')
                plt.close(fig)

    def _build_transient_mask(
        self,
        x: np.ndarray,
        smooth_window: int = 20,
        stable_frac:   float = 0.15,
        min_skip:      int   = 50,
    ) -> np.ndarray:
        """
        Return a boolean mask of length len(x)-1, aligned with diff(x).

        True  = stable region  → include in derivative and peak search
        False = transient spike → set to NaN before any peak detection

        Why this works for multiple spikes
        -----------------------------------
        Every artifactual spike in dCAP/dPressure is caused by a region
        where dx (the pressure step between adjacent samples) is abnormally
        small — pressure is barely moving but capacitance still is, so the
        ratio blows up.  This happens at:

            • The initial ramp-up from zero       (spike 1)
            • Any secondary rapid pressure change  (spike 2, 3 …)
            • Noise-driven micro-plateaus          (any position)

        By thresholding |diff(x)| directly, all such regions are caught in
        one pass regardless of how many there are or where they occur.

        The mask is intentionally in diff-space (length = len(x)-1) so it
        can be applied directly to fd without index arithmetic.

        Parameters
        ----------
        x             : 1-D pressure array (ROI-trimmed, NaN-free,
                        optionally smoothed before calling)
        smooth_window : rolling-mean window on |diff(x)| before thresholding;
                        prevents single noisy samples from masking good data
        stable_frac   : regions where smoothed |dp| > stable_frac * max(|dp|)
                        are flagged as transient
        min_skip      : first min_skip diff-samples are always masked,
                        regardless of their |dp| value (hard leading guard)

        Returns
        -------
        np.ndarray of bool, shape (len(x)-1,)
        """
        if len(x) < 2:
            return np.ones(max(len(x) - 1, 0), dtype=bool)

        dp       = np.abs(np.diff(x))                     # len = len(x)-1
        dp_smooth = (
            pd.Series(dp)
            .rolling(smooth_window, min_periods=1, center=True)
            .mean()
            .to_numpy()
        )

        peak_dp = np.nanmax(dp_smooth)
        if peak_dp == 0:
            # Pressure is flat — nothing to mask except the hard skip
            mask = np.ones(len(dp), dtype=bool)
            mask[:min_skip] = False
            return mask

        threshold = stable_frac * peak_dp
        mask      = dp_smooth >= threshold          # True = stable

        # Hard leading guard: always exclude first min_skip samples
        mask[:min_skip] = False

        return mask
    
    # =========================================================================
    # Derivative + PS-curve analysis  (MATLAB algorithmic improvements)
    # =========================================================================

    def _derive_and_plot(self):
        """
        Compute 1st derivative and inflection points on each PS curve.

        Algorithmic improvements
        ─────────────────────────
        • Raw x_plot / y_plot kept for plotting and zaber storage.
        A separate detection-smoothed copy (0.5 s moving mean) is used
        only for peak-finding — mirrors MATLAB's x_det / y_det split.
        • Unique x values enforced before finite-difference derivative.
        • NaN-based clipping (not zero-based) for out-of-range derivative.
        • _build_transient_mask applied to fd before peak search —
        NaNs out ALL transient spike regions (initial ramp + any
        secondary spikes) without trimming the pressure axis.
        • Secondary moving-mean smoothing (window=5) on the derivative.
        • Peak search restricted to [min_search_kPa, max_search_kPa].
        • Fallback peak logic: argmax inside search window if find_peaks
        returns nothing.
        • Incremental CAP extracted via interp1 on unique x_plot values.
        """
        for i in range(self.cap_size):

            fig         = plt.figure(figsize=(20, 10))
            fig_dcap_dt = plt.figure(figsize=(20, 12))
            ax_dpres    = fig_dcap_dt.add_subplot(3, 3, 9)

            # Per-run accumulators
            zaber_x_i      = None
            zaber_y_i      = []
            fir_dev_i      = []
            valz_i         = []
            locz_i         = []
            max_ps_i       = []
            max_kPa_i      = []
            inf_CAP_i      = []
            cap_inc_i      = []
            dcap_dt_i      = []
            dpressure_dt_i = None

            # Shared time / pressure arrays — set on the first valid channel
            t_cap_used    = None
            x_smooth_last = None

            for j in range(self.ch):

                # ── Region of interest ─────────────────────────────────────────
                pressure_full = self.test[i][1][:, 1]
                cap_full      = self.test[i][0][:, j + 1]
                time_full     = self.test[i][0][:, 0]

                idx_start_arr = np.where(pressure_full >= self.start_force)[0]
                idx_end_arr   = np.where(pressure_full >= self.end_force)[0]

                idx_start = idx_start_arr[0] if len(idx_start_arr) else 0
                idx_end   = idx_end_arr[0]   if len(idx_end_arr)   else len(pressure_full)

                pressure_roi = pressure_full[idx_start:idx_end]
                cap_roi      = cap_full[idx_start:idx_end]
                time_roi     = time_full[idx_start:idx_end]

                # ── Remove NaNs from ROI ───────────────────────────────────────
                valid  = ~(np.isnan(pressure_roi) | np.isnan(cap_roi))
                x_plot = pressure_roi[valid]
                y_plot = cap_roi[valid]
                t_roi  = time_roi[valid]

                if len(x_plot) < 4:
                    max_ps_i.append(np.nan)
                    max_kPa_i.append(np.nan)
                    inf_CAP_i.append(np.nan)
                    self.max_ps_numeric[i, j]  = np.nan
                    self.max_kPa_numeric[i, j] = np.nan
                    self.inf_CAP_numeric[i, j] = np.nan
                    cap_inc_i.append([np.nan] * len(self.increment_pressures))
                    zaber_y_i.append(y_plot)
                    fir_dev_i.append(np.array([]))
                    dcap_dt_i.append(np.array([]))
                    valz_i.append(None)
                    locz_i.append(None)
                    continue

                # ── Detection-smoothed copies (0.5 s moving mean) ─────────────
                # Used ONLY for derivative computation and peak detection.
                # x_plot / y_plot stay untouched for PS curve and zaber storage.
                x_det = self._smooth_for_detection(x_plot)
                y_det = self._smooth_for_detection(y_plot)

                # ── Store raw data for plotting and zaber storage ──────────────
                if zaber_x_i is None:
                    zaber_x_i = x_plot
                zaber_y_i.append(y_plot)

                if t_cap_used is None:
                    t_cap_used    = t_roi
                    x_smooth_last = x_det   # used as pressure column in xlsx

                # ── Enforce unique x for derivative stability ──────────────────
                x_det_u, ia = np.unique(x_det, return_index=True)
                y_det_u     = y_det[ia]

                # ── 1st derivative dCAP/dPressure ──────────────────────────────
                dx = np.diff(x_det_u)
                dy = np.diff(y_det_u)

                fd       = np.full(len(dy), np.nan)
                nz       = dx != 0
                fd[nz]   = dy[nz] / dx[nz]

                # NaN-based clipping for out-of-range values (mirrors MATLAB)
                fd[~np.isfinite(fd)] = np.nan
                fd[
                    (fd > self.max_allowed_deriv) |
                    (fd < self.min_allowed_deriv)
                ] = np.nan

                # ── Mask ALL transient spike regions ───────────────────────────
                # _build_transient_mask checks |diff(x)| across the entire
                # unique-pressure grid, so it catches the initial ramp-up AND
                # any secondary spikes caused by rapid pressure transitions.
                # Masked samples are set to NaN rather than trimmed, so the
                # pressure axis length stays intact for plotting.
                transient_mask = self._build_transient_mask(x_det_u)
                fd[~transient_mask[:len(fd)]] = np.nan

                # ── Secondary smoothing on derivative (window = 5) ─────────────
                fd = (
                    pd.Series(fd)
                    .rolling(self.deriv_smooth_window, min_periods=1, center=True)
                    .mean()
                    .to_numpy()
                )

                pressure_axis_fd = x_det_u[:-1]   # x-axis for all derivative plots

                # ── dCAP/dt and dPressure/dt ───────────────────────────────────
                # Computed on the original (non-unique) detection-smoothed grid
                # so the array length is consistent across channels.
                dcap_dt_ij      = np.diff(y_det)
                dpressure_dt_ij = np.diff(x_det)

                dcap_dt_i.append(dcap_dt_ij)
                if j == 0:
                    dpressure_dt_i = dpressure_dt_ij

                # ── Restrict peak-search region ────────────────────────────────
                # Combined with the transient mask, any sample that is either
                # a transient spike or outside [min_search_kPa, max_search_kPa]
                # is NaN and therefore invisible to find_peaks.
                search_mask = (
                    (pressure_axis_fd >= self.min_search_kPa) &
                    (pressure_axis_fd <= self.max_search_kPa)
                )
                first_valid = np.where(search_mask)[0]
                if len(first_valid) >= self.min_search_samples:
                    search_mask[first_valid[:self.min_search_samples]] = False

                fd_search               = fd.copy()
                fd_search[~search_mask] = np.nan

                # Replace NaN with -inf so find_peaks can operate numerically
                fd_for_peaks                          = fd_search.copy()
                fd_for_peaks[np.isnan(fd_for_peaks)]  = -np.inf

                # ── Primary peak detection ─────────────────────────────────────
                peaks, _ = find_peaks(
                    fd_for_peaks,
                    prominence=self.min_peak_prominence,
                    width=self.min_peak_width,
                )

                # ── Fallback: argmax inside search window ──────────────────────
                # If find_peaks finds nothing (e.g. wide/flat derivative),
                # take the single highest finite point inside the search window.
                if len(peaks) == 0:
                    candidate_idx = np.where(search_mask & np.isfinite(fd))[0]
                    if len(candidate_idx) > 0:
                        rel      = np.argmax(fd[candidate_idx])
                        best_val = fd[candidate_idx[rel]]
                        if np.isfinite(best_val) and best_val > 0:
                            peaks = np.array([candidate_idx[rel]])

                # ── Select best peak ───────────────────────────────────────────
                if len(peaks) > 0:
                    peak_vals = fd[peaks]
                    idx_best  = np.argmax(peak_vals)
                    loc_peak  = peaks[idx_best]
                    val_peak  = peak_vals[idx_best]

                    if len(peaks) > 1:
                        print(
                            f"Multiple peaks – Run {i+1}, CH {j+1}. "
                            f"Selected index {loc_peak}, value {val_peak:.3f}"
                        )

                    # Map detected pressure back to the raw x_plot grid so
                    # stored kPa / CAP values are unaffected by smoothing or
                    # unique-x resampling.
                    peak_kPa = pressure_axis_fd[loc_peak]
                    idx_orig = np.argmin(np.abs(x_plot - peak_kPa))

                    locz_ij = loc_peak
                    valz_ij = val_peak

                    max_ps_i.append(valz_ij)
                    max_kPa_i.append(x_plot[idx_orig])
                    inf_CAP_i.append(y_plot[idx_orig])
                    self.max_ps_numeric[i, j]  = valz_ij
                    self.max_kPa_numeric[i, j] = x_plot[idx_orig]
                    self.inf_CAP_numeric[i, j] = y_plot[idx_orig]

                else:
                    locz_ij  = None
                    valz_ij  = None
                    idx_orig = None
                    max_ps_i.append(np.nan)
                    max_kPa_i.append(np.nan)
                    inf_CAP_i.append(np.nan)
                    self.max_ps_numeric[i, j]  = np.nan
                    self.max_kPa_numeric[i, j] = np.nan
                    self.inf_CAP_numeric[i, j] = np.nan

                fir_dev_i.append(fd)
                valz_i.append(valz_ij)
                locz_i.append(locz_ij)

                # ── Incremental CAP via safe interp1 (mirrors MATLAB) ─────────
                x_unique_inc, ia_inc = np.unique(x_plot, return_index=True)
                y_unique_inc         = y_plot[ia_inc]

                if len(x_unique_inc) >= 2:
                    cap_inc_ij = np.interp(
                        self.increment_pressures,
                        x_unique_inc,
                        y_unique_inc,
                        left=np.nan,
                        right=np.nan,
                    ).tolist()
                    # Explicitly NaN any increment pressure outside the data range
                    for pi, pv in enumerate(self.increment_pressures):
                        if pv < x_unique_inc[0] or pv > x_unique_inc[-1]:
                            cap_inc_ij[pi] = np.nan
                else:
                    cap_inc_ij = [np.nan] * len(self.increment_pressures)

                cap_inc_i.append(cap_inc_ij)

                # ── PS-curve subplot ───────────────────────────────────────────
                ax = fig.add_subplot(2, 4, j + 1)
                ax.set_title(f'Run# {i+1} - CH {j+1}',
                            fontsize=12, fontweight='bold')

                # Left y-axis: raw CAP signal
                ax.plot(x_plot, y_plot, '-o', markersize=2,
                        linewidth=1.5, color='tab:blue', label='CAP')
                if locz_ij is not None and idx_orig is not None:
                    ax.plot(x_plot[idx_orig], y_plot[idx_orig], 'or',
                            markersize=10, linewidth=2, label='Inflection')
                ax.set_xlabel('Pressure (kPa)', fontsize=10)
                ax.set_ylabel('Cap (pF)', fontsize=10, color='tab:blue')
                ax.tick_params(axis='y', labelcolor='tab:blue')

                # Right y-axis: 1st derivative (NaN gaps appear as breaks,
                # making masked transient regions visually obvious)
                ax2 = ax.twinx()
                ax2.plot(pressure_axis_fd, fd,
                        color='tab:orange', linewidth=1.5, label='1st Derivative')
                if locz_ij is not None:
                    ax2.plot(pressure_axis_fd[locz_ij], fd[locz_ij],
                            'ok', markersize=8, linewidth=2)
                ax2.set_ylabel('dCAP/dPressure (pF/kPa)', fontsize=10,
                            color='tab:orange')
                ax2.tick_params(axis='y', labelcolor='tab:orange')
                ax.grid(True, alpha=0.3)

                # ── dCAP/dt subplot ────────────────────────────────────────────
                ax_dcap = fig_dcap_dt.add_subplot(3, 3, j + 1)
                ax_dcap.plot(x_det[:-1], dcap_dt_ij,
                            color='tab:blue', linewidth=1.2)
                ax_dcap.set_title(f'Run# {i+1} - CH {j+1}',
                                fontsize=12, fontweight='bold')
                ax_dcap.set_xlabel('Pressure (kPa)', fontsize=10)
                ax_dcap.set_ylabel('dCAP/dt (pF/s)', fontsize=10, color='tab:blue')
                ax_dcap.tick_params(axis='y', labelcolor='tab:blue')
                ax_dcap.grid(True, alpha=0.3)

                ax_dcap2 = ax_dcap.twinx()
                ax_dcap2.plot(pressure_axis_fd, fd,
                            color='tab:orange', linewidth=1.2,
                            linestyle=':', alpha=0.6)
                ax_dcap2.set_ylabel('dCAP/dPressure (pF/kPa)', fontsize=10,
                                    color='tab:orange')
                ax_dcap2.tick_params(axis='y', labelcolor='tab:orange')

                if j == 0:
                    ax_dpres.plot(x_det[:-1], dpressure_dt_ij,
                                color='tab:green', linewidth=1.2)
                    ax_dpres.set_title('dPressure/dt', fontsize=12,
                                    fontweight='bold')
                    ax_dpres.set_xlabel('Pressure (kPa)', fontsize=10)
                    ax_dpres.set_ylabel('dPressure/dt (kPa/s)', fontsize=10,
                                        color='tab:green')
                    ax_dpres.tick_params(axis='y', labelcolor='tab:green')
                    ax_dpres.grid(True, alpha=0.3)

            # ── Store run results ──────────────────────────────────────────────
            self.zaber_x.append(zaber_x_i)
            self.zaber_y.append(zaber_y_i)
            self.fir_dev.append(fir_dev_i)
            self.valz.append(valz_i)
            self.locz.append(locz_i)
            self.max_ps.append(max_ps_i)
            self.max_kPa.append(max_kPa_i)
            self.inf_CAP.append(inf_CAP_i)
            self.cap_inc.append(cap_inc_i)
            self.dcap_dt.append(dcap_dt_i)
            self.dpressure_dt.append(dpressure_dt_i)

            fig.tight_layout()
            filename = self.path / f'PS curve all CHs number #{i+1}.png'
            fig.savefig(filename, dpi=300, bbox_inches='tight')
            plt.close(fig)

            fig_dcap_dt.suptitle(
                f'dCAP/dt (and dPressure/dt) vs Time - Run #{i+1}',
                fontsize=16, fontweight='bold')
            fig_dcap_dt.tight_layout()
            filename = self.path / f'dCAP_dt all CHs number #{i+1}.png'
            fig_dcap_dt.savefig(filename, dpi=300, bbox_inches='tight')
            plt.close(fig_dcap_dt)

            # ── Excel export ───────────────────────────────────────────────────
            ref_len = (len(t_cap_used) - 1) if t_cap_used is not None else 0

            def _pad(arr: np.ndarray, length: int) -> np.ndarray:
                """Trim or NaN-pad 1-D array to `length`."""
                arr = np.asarray(arr, dtype=float)
                if len(arr) >= length:
                    return arr[:length]
                return np.concatenate([arr, np.full(length - len(arr), np.nan)])

            if ref_len > 0 and t_cap_used is not None and x_smooth_last is not None:
                xlsx_data = {
                    'Time':      t_cap_used[:ref_len],
                    'Pressure':  x_smooth_last[:ref_len],
                    'dPressure': _pad(dpressure_dt_i, ref_len),
                }
                for ch_idx in range(self.ch):
                    if ch_idx < len(dcap_dt_i):
                        xlsx_data[f'dCap_CH{ch_idx+1}'] = (
                            _pad(dcap_dt_i[ch_idx], ref_len)
                        )
                        xlsx_data[f'dCap_dPressure_CH{ch_idx+1}'] = (
                            _pad(fir_dev_i[ch_idx], ref_len)
                        )
                    else:
                        xlsx_data[f'dCap_CH{ch_idx+1}']           = np.full(ref_len, np.nan)
                        xlsx_data[f'dCap_dPressure_CH{ch_idx+1}'] = np.full(ref_len, np.nan)

                xlsx_df      = pd.DataFrame(xlsx_data)
                xlsx_filename = self.path / f'dCap_dPressure_Run#{i+1}.xlsx'
                xlsx_df.to_excel(xlsx_filename, sheet_name=f'Run{i+1}', index=False)

    # =========================================================================
    # Summary plots
    # =========================================================================

    def _plot_all_chs_across_runs(self):
        """Plot PS curves of all channels across runs (uses stored zaber data)."""
        fig, axes = plt.subplots(1, self.cap_size,
                                 figsize=(8 * self.cap_size, 6))
        if self.cap_size == 1:
            axes = [axes]
        fig.suptitle('P.S Curves of All CHs Across Runs',
                     fontsize=16, fontweight='bold')

        for i in range(self.cap_size):
            for j in range(self.ch):
                if self.zaber_x[i] is not None and j < len(self.zaber_y[i]):
                    axes[i].plot(self.zaber_x[i], self.zaber_y[i][j],
                                 '-', linewidth=2, label=f'Ch. #: {j+1}')
            axes[i].set_title(f'Run {i+1}', fontsize=14, fontweight='bold')
            axes[i].set_xlabel('Pressure (kPa)', fontsize=12)
            axes[i].set_ylabel('Cap (pF)', fontsize=12)
            axes[i].grid(True, alpha=0.3)
            axes[i].legend(loc='lower right', fontsize=10)

        plt.tight_layout()
        filename = self.path / 'PS curves all ch per run.png'
        plt.savefig(filename, dpi=300, bbox_inches='tight')
        plt.close(fig)

    def _plot_all_runs_across_chs(self):
        """Plot PS curves of all runs across channels."""
        fig, axes = plt.subplots(2, 4, figsize=(20, 10))
        fig.suptitle('P.S Curves of All Runs Across Channels',
                     fontsize=18, fontweight='bold')
        axes = axes.flatten()

        colors = plt.cm.tab10(np.linspace(0, 1, len(self.test)))

        for i in range(len(self.test)):
            for j in range(self.ch):
                if (self.zaber_x[i] is not None and
                        j < len(self.zaber_y[i]) and
                        len(self.zaber_y[i][j]) > 0):
                    axes[j].plot(self.zaber_x[i], self.zaber_y[i][j],
                                 '-', linewidth=2.5, color=colors[i],
                                 label=f'Run {i+1}', alpha=0.8)
                axes[j].set_title(f'CH {j+1}', fontsize=14, fontweight='bold')
                axes[j].set_xlabel('Pressure (kPa)', fontsize=11)
                axes[j].set_ylabel('Cap (pF)', fontsize=11)
                axes[j].grid(True, alpha=0.3)

        for j in range(self.ch):
            axes[j].legend(loc='lower right', fontsize=10, framealpha=0.9)
        for j in range(self.ch, 8):
            axes[j].axis('off')

        plt.tight_layout()
        filename = self.path / 'PS curves all run per CH.png'
        plt.savefig(filename, dpi=300, bbox_inches='tight')
        plt.close(fig)

    # =========================================================================
    # Save / export
    # =========================================================================

    def save_data(self):
        """Calculate and save analysis results (pickle + xlsx)."""
        print("Saving data to dict …")
        result = {}

        # ── Inflection-point metrics ──────────────────────────────────────────
        result['max_ps']       = self.max_ps_numeric
        result['mean_max_ps']  = np.nanmean(result['max_ps'], axis=0)
        result['std_max_ps']   = np.nanstd(result['max_ps'],  axis=0, ddof=1)
        result['cov_max_ps']   = result['std_max_ps'] / result['mean_max_ps']

        result['max_kpa']      = self.max_kPa_numeric
        result['mean_max_kpa'] = np.nanmean(result['max_kpa'], axis=0)
        result['std_max_kpa']  = np.nanstd(result['max_kpa'], axis=0, ddof=1)
        result['cov_max_kpa']  = result['std_max_kpa'] / result['mean_max_kpa']

        # ── Max CAP ───────────────────────────────────────────────────────────
        result['max_cap']      = self.c
        result['mean_max_cap'] = np.nanmean(result['max_cap'], axis=0)
        result['std_max_cap']  = np.nanstd(result['max_cap'], axis=0, ddof=1)
        result['max_cap_cov']  = result['std_max_cap'] / result['mean_max_cap']

        # ── CAP at inflection ─────────────────────────────────────────────────
        result['inf_cap']      = self.inf_CAP_numeric
        result['mean_inf_cap'] = np.nanmean(result['inf_cap'], axis=0)
        result['std_inf_cap']  = np.nanstd(result['inf_cap'], axis=0, ddof=1)
        result['cov_inf_cap']  = result['std_inf_cap'] / result['mean_inf_cap']

        # ── Channel variability ───────────────────────────────────────────────
        n_runs      = len(self.cap_inc)
        n_channels  = len(self.cap_inc[0]) if n_runs > 0 else 0
        n_inc       = len(self.increment_pressures)

        inc_arr = []
        ch_var_center4_mean = np.zeros((n_runs, n_inc))
        ch_var_center4_std  = np.zeros((n_runs, n_inc))
        ch_var_outer4_mean  = np.zeros((n_runs, n_inc))
        ch_var_outer4_std   = np.zeros((n_runs, n_inc))
        ch_var_allch_mean   = np.zeros((n_runs, n_inc))
        ch_var_allch_std    = np.zeros((n_runs, n_inc))

        for a in range(n_runs):
            # Build (n_inc × n_channels) array for run a
            run_matrix = np.column_stack(
                [self.cap_inc[a][b] for b in range(n_channels)]
            )
            inc_arr.append(run_matrix)

            for inc in range(n_inc):
                row = run_matrix[inc, :]

                # Center 4 channels (indices 2–5, i.e. CH 3–6)
                c4 = row[2:6]
                ch_var_center4_mean[a, inc] = np.nanmean(c4)
                ch_var_center4_std[a, inc]  = np.nanstd(c4, ddof=1)

                # Outer 4 channels (indices 0, 1, 6, 7)
                o4 = row[[0, 1, 6, 7]]
                ch_var_outer4_mean[a, inc] = np.nanmean(o4)
                ch_var_outer4_std[a, inc]  = np.nanstd(o4, ddof=1)

                # All channels
                ch_var_allch_mean[a, inc] = np.nanmean(row)
                ch_var_allch_std[a, inc]  = np.nanstd(row, ddof=1)

        result['inc_arr'] = inc_arr

        result['ch_var_center4_mean']     = ch_var_center4_mean
        result['ch_var_center4_std']      = ch_var_center4_std
        result['ch_var_center4_cov']      = ch_var_center4_std / ch_var_center4_mean
        result['avg_ch_var_center4_mean'] = np.nanmean(ch_var_center4_mean, axis=0)
        result['avg_ch_var_center4_cov']  = np.nanmean(result['ch_var_center4_cov'], axis=0)

        result['ch_var_outer4_mean']      = ch_var_outer4_mean
        result['ch_var_outer4_std']       = ch_var_outer4_std
        result['ch_var_outer4_cov']       = ch_var_outer4_std / ch_var_outer4_mean
        result['avg_ch_var_outer4_mean']  = np.nanmean(ch_var_outer4_mean, axis=0)
        result['avg_ch_var_outer4_cov']   = np.nanmean(result['ch_var_outer4_cov'], axis=0)

        result['ch_var_allch_mean']       = ch_var_allch_mean
        result['ch_var_allch_std']        = ch_var_allch_std
        result['ch_var_allch_cov']        = ch_var_allch_std / ch_var_allch_mean
        result['avg_ch_var_allch_mean']   = np.nanmean(ch_var_allch_mean, axis=0)
        result['avg_ch_var_allch_cov']    = np.nanmean(result['ch_var_allch_cov'], axis=0)

        # ── Per-run shorted channel list ──────────────────────────────────────
        result['shorted_ch_by_run'] = self.shorted_ch_by_run

        # ── Raw / synced data ─────────────────────────────────────────────────
        result['test']    = self.test
        result['zaber_x'] = self.zaber_x
        result['zaber_y'] = self.zaber_y

        # ── Pickle ────────────────────────────────────────────────────────────
        print("Saving data to pickle …")
        pkl_path  = self.path / 'eb_analysis_results.pkl'
        xlsx_path = self.path / 'EB_Analysis_Results.xlsx'

        with open(pkl_path, 'wb') as f:
            pickle.dump(result, f)

        # ── Pickle → Excel ────────────────────────────────────────────────────
        def pickle_to_excel(pkl_path, xlsx_path):
            with open(pkl_path, 'rb') as f:
                data = pickle.load(f)

            with pd.ExcelWriter(xlsx_path) as writer:
                for key, val in data.items():
                    sheet_base = str(key)[:31]
                    try:
                        if isinstance(val, np.ndarray):
                            pd.DataFrame(val).to_excel(
                                writer, sheet_name=sheet_base, index=False)
                        elif isinstance(val, list):
                            try:
                                pd.DataFrame(val).to_excel(
                                    writer, sheet_name=sheet_base, index=False)
                            except Exception:
                                for idx, elem in enumerate(val):
                                    sheet = f"{sheet_base}_run{idx+1}"[:31]
                                    try:
                                        pd.DataFrame(elem).to_excel(
                                            writer, sheet_name=sheet, index=False)
                                    except Exception:
                                        pd.DataFrame([repr(elem)]).to_excel(
                                            writer, sheet_name=sheet, index=False)
                        else:
                            pd.DataFrame([repr(val)]).to_excel(
                                writer, sheet_name=sheet_base, index=False)
                    except Exception:
                        pd.DataFrame([repr(val)]).to_excel(
                            writer, sheet_name=sheet_base, index=False)

        print("Saving pickle to Excel …")
        pickle_to_excel(pkl_path, xlsx_path)

        return result