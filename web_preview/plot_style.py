# Shared matplotlib styling for the EM / Shear / Manual analysis figures.
#
# All figures are saved as SVG (vector), so they're already resolution-
# independent. These settings raise the *visual* quality: crisp real text
# (svg.fonttype="none" keeps labels as selectable <text>, not outlined paths),
# clean typography, higher baseline DPI, anti-aliased lines, and full data
# fidelity (no path simplification that would drop points on dense curves).
import matplotlib as mpl

_HIGH_QUALITY = {
    # baseline resolution / output
    "figure.dpi": 150,
    "savefig.dpi": 220,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.05,
    "savefig.facecolor": "white",
    "figure.facecolor": "white",
    "figure.autolayout": False,

    # crisp, selectable text in the SVG instead of outlined glyph paths
    "svg.fonttype": "none",

    # typography
    "font.family": "sans-serif",
    "font.sans-serif": ["DejaVu Sans", "Arial", "Helvetica"],
    "font.size": 11,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "axes.labelweight": "medium",
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "legend.fontsize": 9,
    "legend.framealpha": 0.9,

    # axes / grid styling
    "axes.linewidth": 1.0,
    "axes.edgecolor": "#3a3f46",
    "axes.facecolor": "white",
    "axes.grid": True,
    "axes.axisbelow": True,
    "grid.color": "#b8c0cc",
    "grid.alpha": 0.35,
    "grid.linewidth": 0.6,

    # lines / markers: smooth, full fidelity
    "lines.linewidth": 1.9,
    "lines.markersize": 3.5,
    "lines.antialiased": True,
    "lines.solid_capstyle": "round",
    "lines.solid_joinstyle": "round",
    "path.simplify": False,        # keep every data point on dense curves
    "agg.path.chunksize": 20000,
}


def apply_plot_style():
    """Apply the high-quality analysis-plot styling to matplotlib's rcParams."""
    mpl.rcParams.update(_HIGH_QUALITY)


def rasterize_dense_lines(fig, threshold=2000):
    """
    Rasterize only the dense data lines in a figure (those with many points) so an
    SVG stays small while keeping all data points and crisp vector text/axes.
    Without this, a curve with tens of thousands of points balloons the SVG to
    tens of MB. The rasterized layer renders at savefig.dpi (high quality).
    """
    for ax in fig.get_axes():
        for line in ax.get_lines():
            xdata = line.get_xdata()
            if xdata is not None and len(xdata) > threshold:
                line.set_rasterized(True)
