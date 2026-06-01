#!/usr/bin/env python3
"""
Render an ETA-trace as an HTML/SVG line graph so the (un)smoothness of the
displayed countdown is visible at a glance.

Reads a progress-trace.jsonl (written by `/htsw eta trace on`) and plots the
per-second `tick` samples:

  - displayed ETA   — what the user actually sees (etaSec), the smoothed value
  - raw candidate   — remaining x msPerUnit, the unsmoothed staircase
  - ideal 1s/s      — a straight line from the first displayed value sloping
                      down at one second per second (a perfect countdown)

Usage:
  python graphEtaTrace.py [path/to/progress-trace.jsonl] [-o out.html]

Defaults the input to ./htsw/progress-trace.jsonl and writes the HTML next to
the trace, then prints the output path.
"""

import json
import sys
import os


def load_ticks(path):
    ticks = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("kind") != "tick":
                continue
            t_ms = row.get("tMs")
            eta = row.get("etaSec")
            if t_ms is None or eta is None:
                continue
            remaining = row.get("remaining", 0) or 0
            ms_per_unit = row.get("msPerUnit", 0) or 0
            ticks.append({
                "t": t_ms / 1000.0,
                "eta": float(eta),
                "candidate": remaining * ms_per_unit / 1000.0,
            })
    return ticks


def build_series(ticks):
    if not ticks:
        return None
    t0 = ticks[0]["t"]
    displayed = [(tk["t"] - t0, tk["eta"]) for tk in ticks]
    candidate = [(tk["t"] - t0, tk["candidate"]) for tk in ticks]
    end_t = displayed[-1][0]
    # Anchor the ideal line to the REAL initial estimate, not ticks[0]: the
    # first sample is the placeholder ~0 captured before the estimate snaps
    # in. The estimate only decreases, so the peak displayed value is the
    # real starting estimate; anchor a perfect 1s/s descent there.
    peak_t, peak_eta = max(displayed, key=lambda p: p[1])
    ideal = [(peak_t, peak_eta)]
    zero_t = peak_t + peak_eta
    if zero_t <= end_t:
        ideal.append((zero_t, 0.0))
        ideal.append((end_t, 0.0))
    else:
        ideal.append((end_t, peak_eta - (end_t - peak_t)))
    return {"displayed": displayed, "candidate": candidate, "ideal": ideal}


def polyline(points, x_scale, y_scale, x0, y0):
    return " ".join(
        f"{x0 + px * x_scale:.1f},{y0 - py * y_scale:.1f}" for px, py in points
    )


def render_html(series):
    W, H = 1100, 560
    ML, MR, MT, MB = 60, 200, 30, 50
    plot_w = W - ML - MR
    plot_h = H - MT - MB
    x0, y0 = ML, H - MB

    all_pts = series["displayed"] + series["candidate"] + series["ideal"]
    max_x = max(px for px, _ in all_pts) or 1
    max_y = max(py for _, py in all_pts) or 1
    x_scale = plot_w / max_x
    y_scale = plot_h / max_y

    def grid_and_axes():
        parts = []
        # horizontal gridlines + y labels (seconds)
        steps = 8
        for i in range(steps + 1):
            yv = max_y * i / steps
            y = y0 - yv * y_scale
            parts.append(f'<line x1="{x0}" y1="{y:.1f}" x2="{x0 + plot_w}" y2="{y:.1f}" stroke="#222" />')
            parts.append(f'<text x="{x0 - 8}" y="{y + 4:.1f}" fill="#888" font-size="11" text-anchor="end">{yv:.0f}s</text>')
        # vertical gridlines + x labels (seconds elapsed)
        xsteps = 10
        for i in range(xsteps + 1):
            xv = max_x * i / xsteps
            x = x0 + xv * x_scale
            parts.append(f'<line x1="{x:.1f}" y1="{MT}" x2="{x:.1f}" y2="{y0}" stroke="#1a1a1a" />')
            parts.append(f'<text x="{x:.1f}" y="{y0 + 16}" fill="#888" font-size="11" text-anchor="middle">{xv:.0f}s</text>')
        return "\n".join(parts)

    def line(points, color, dash=""):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        return f'<polyline fill="none" stroke="{color}" stroke-width="2"{d} points="{polyline(points, x_scale, y_scale, x0, y0)}" />'

    legend_items = [
        ("displayed ETA (what you see)", "#4da3ff"),
        ("raw candidate (remaining x ms/u)", "#ff6b6b"),
        ("ideal 1s/s countdown", "#5cd65c"),
    ]
    legend = []
    for i, (label, color) in enumerate(legend_items):
        ly = MT + 20 + i * 22
        lx = x0 + plot_w + 20
        legend.append(f'<line x1="{lx}" y1="{ly}" x2="{lx + 24}" y2="{ly}" stroke="{color}" stroke-width="3" />')
        legend.append(f'<text x="{lx + 30}" y="{ly + 4}" fill="#ccc" font-size="12">{label}</text>')

    svg = f"""<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="{W}" height="{H}" fill="#0d0d0d" />
  {grid_and_axes()}
  {line(series['ideal'], '#5cd65c', dash='6 4')}
  {line(series['candidate'], '#ff6b6b')}
  {line(series['displayed'], '#4da3ff')}
  {''.join(legend)}
  <text x="{x0}" y="20" fill="#eee" font-size="14">ETA over time</text>
</svg>"""

    return f"""<!doctype html><html><head><meta charset="utf-8"><title>ETA trace</title>
<style>body{{background:#0d0d0d;margin:0;font-family:monospace}}</style></head>
<body>{svg}</body></html>"""


def main():
    args = [a for a in sys.argv[1:]]
    out = None
    if "-o" in args:
        i = args.index("-o")
        out = args[i + 1]
        del args[i:i + 2]
    trace = args[0] if args else os.path.join(".", "htsw", "progress-trace.jsonl")

    if not os.path.exists(trace):
        print(f"trace not found: {trace}")
        sys.exit(1)

    ticks = load_ticks(trace)
    series = build_series(ticks)
    if series is None:
        print("no tick rows in trace (run `/htsw eta trace on`, import, then off)")
        sys.exit(1)

    html = render_html(series)
    if out is None:
        out = os.path.join(os.path.dirname(os.path.abspath(trace)), "eta-graph.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{len(ticks)} ticks -> {out}")


if __name__ == "__main__":
    main()
