"""Builds the Catch the Booster GLB models (booster, ship, tower, props) with bpy.

Run headless from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python blender/build_models.py -- --out <dir> [--render <dir>] [--blend <file.blend>]

Writes <dir>/booster.glb, ship.glb, tower.glb and props.glb uncompressed; blender/build.sh compresses them
into public/models/. Geometry is written in three.js axes (meters, +Y up, +Z toward the default camera) and
rotated into Blender's Z-up on the way in; the glTF exporter rotates it back, so every number here matches
src/three/*.js. Each mesh is named after the game material it takes (custom property `role`, exported as
glTF extras); the GLBs carry no materials. Cycles bakes ambient occlusion into a vertex color attribute
(glTF COLOR_0) on every mesh except the engine throats, which the game tints at runtime.
"""

import argparse
import bisect
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

TAU = math.tau
IDENT = Matrix.Identity(4)


# ---------------------------------------------------------------- geometry kit (three.js axes)


class Geo:
    """Vertex/face soup for one material role. Smoothing groups follow connectivity: a primitive that
    should have hard edges gets separate vertices per face or per strip."""

    def __init__(self, uv=False):
        self.verts = []
        self.faces = []
        self.smooth = []
        self.uvs = [] if uv else None

    def add(self, pts, faces, smooth=False, uvs=None):
        base = len(self.verts)
        self.verts.extend(pts)
        for i, f in enumerate(faces):
            self.faces.append(tuple(base + j for j in f))
            self.smooth.append(smooth)
            if self.uvs is not None:
                self.uvs.append(uvs[i] if uvs else [(0.0, 0.0)] * len(f))

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def RY(a):
    """Rotation about +Y; like three.js, RY(a) maps +X to (cos a, 0, -sin a)."""
    return Matrix.Rotation(a, 4, 'Y')


def RX(a):
    return Matrix.Rotation(a, 4, 'X')


def RZ(a):
    return Matrix.Rotation(a, 4, 'Z')


def rad(d):
    return math.radians(d)


def game_theta(a_deg):
    """Lathe angle (r sin t, y, r cos t) that points the way the game places parts at angle a: (cos a, 0, -sin a)."""
    return rad(a_deg) + math.pi / 2


def xf(m, pts):
    if m is IDENT:
        return list(pts)
    out = []
    for p in pts:
        q = m @ Vector(p)
        out.append((q.x, q.y, q.z))
    return out


def newell(pts, f):
    n = Vector((0.0, 0.0, 0.0))
    k = len(f)
    for i in range(k):
        a = pts[f[i]]
        b = pts[f[(i + 1) % k]]
        n.x += (a[1] - b[1]) * (a[2] + b[2])
        n.y += (a[2] - b[2]) * (a[0] + b[0])
        n.z += (a[0] - b[0]) * (a[1] + b[1])
    return n


def orient_to(pts, f, n_exp):
    f = list(f)
    return f if newell(pts, f).dot(Vector(n_exp)) >= 0 else f[::-1]


def centroid(pts, f):
    c = Vector((0.0, 0.0, 0.0))
    for i in f:
        c += Vector(pts[i])
    return c / len(f)


# Ambient occlusion is baked per vertex, so long faces need vertices where the shading changes: close to the
# ends of a member, where it meets the next one, and at a modest spacing along it.
AO_MIN_LEN = 2.5  # members at least this long get cuts
AO_END = (0.45,)  # cut positions measured from each end
AO_MID = 6.0  # longest remaining segment


def member_cuts(length):
    """Cut positions in (0, length) for a long member."""
    if length < AO_MIN_LEN:
        return []
    ends = [e for e in AO_END if e < length / 2 - 0.2]
    lo = max(ends, default=0.0)
    n = max(1, math.ceil((length - 2 * lo) / AO_MID))
    mid = [lo + (length - 2 * lo) * i / n for i in range(1, n)]
    return sorted(ends + mid + [length - e for e in ends])


def box(g, size, m=IDENT, c=0.0, smooth=False, cuts=None):
    """Box centred on the origin (full sizes), every edge chamfered by c, then transformed by m. Long sides are
    cut for the AO bake (member_cuts); cuts={axis: [box-local positions]} replaces the cuts of an axis."""
    h = [s / 2 for s in size]
    c = min(c, 0.45 * min(h)) if c > 0 else 0.0
    P = []
    for a in range(3):
        e = h[a] - c
        if cuts and a in cuts:
            inner = sorted(p for p in cuts[a] if -e + 0.05 < p < e - 0.05)
        else:
            inner = [-e + x for x in member_cuts(2 * e)] if 2 * h[a] >= AO_MIN_LEN else []
        P.append([-e] + inner + [e])
    pts, index, faces = [], {}, []

    def vid(p):
        key = (round(p[0], 6), round(p[1], 6), round(p[2], 6))
        if key not in index:
            index[key] = len(pts)
            pts.append(tuple(p))
        return index[key]

    def at(k, vk, j, vj, l, vl):
        p = [0.0, 0.0, 0.0]
        p[k], p[j], p[l] = vk, vj, vl
        return vid(p)

    for k in range(3):
        j, l = [a for a in range(3) if a != k]
        for sk in (-1, 1):
            for a in range(len(P[j]) - 1):
                for b in range(len(P[l]) - 1):
                    faces.append([at(k, sk * h[k], j, P[j][ja], l, P[l][lb])
                                  for ja, lb in ((a, b), (a + 1, b), (a + 1, b + 1), (a, b + 1))])
    if c > 0:
        # Chamfer strips run along axis l between the faces normal to k and j.
        for l in range(3):
            k, j = [a for a in range(3) if a != l]
            for sk in (-1, 1):
                for sj in (-1, 1):
                    for i in range(len(P[l]) - 1):
                        faces.append([at(k, sk * h[k], j, sj * (h[j] - c), l, P[l][i]),
                                      at(k, sk * h[k], j, sj * (h[j] - c), l, P[l][i + 1]),
                                      at(k, sk * (h[k] - c), j, sj * h[j], l, P[l][i + 1]),
                                      at(k, sk * (h[k] - c), j, sj * h[j], l, P[l][i])])
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    s = (sx, sy, sz)
                    tri = []
                    for k in range(3):
                        p = [s[a] * (h[a] - c) for a in range(3)]
                        p[k] = s[k] * h[k]
                        tri.append(vid(p))
                    faces.append(tri)
    faces = [orient_to(pts, f, centroid(pts, f)) for f in faces]
    g.add(xf(m, pts), faces, smooth)


def box_at(g, lo, hi, m=IDENT, c=0.0, cuts=None):
    """Box spanning corner lo to corner hi (local coordinates of m); cuts={axis: [positions in those coordinates]}."""
    size = [hi[i] - lo[i] for i in range(3)]
    mid = [(hi[i] + lo[i]) / 2 for i in range(3)]
    local = {a: [p - mid[a] for p in v] for a, v in cuts.items()} if cuts else None
    box(g, size, m @ T(*mid), c, cuts=local)


def prism(g, poly, y0, y1, m=IDENT, caps=True, smooth=False):
    """Extrudes polygon [(x, z), ...] along local Y from y0 to y1, cut along its length for the AO bake."""
    n = len(poly)
    dirn = 1.0 if y1 > y0 else -1.0
    levels = [y0] + [y0 + dirn * x for x in member_cuts(abs(y1 - y0))] + [y1]
    pts = [(x, y, z) for y in levels for x, z in poly]
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sgn = 1.0 if area > 0 else -1.0
    faces = []
    for r in range(len(levels) - 1):
        b0, b1 = r * n, (r + 1) * n
        for i in range(n):
            i1 = (i + 1) % n
            dx = poly[i1][0] - poly[i][0]
            dz = poly[i1][1] - poly[i][1]
            faces.append(orient_to(pts, (b0 + i, b0 + i1, b1 + i1, b1 + i), (sgn * dz, 0.0, -sgn * dx)))
    if caps:
        last = (len(levels) - 1) * n
        faces.append(orient_to(pts, range(n), (0.0, -dirn, 0.0)))
        faces.append(orient_to(pts, range(last, last + n), (0.0, dirn, 0.0)))
    g.add(xf(m, pts), faces, smooth)


def basis(a, b, up=(0.0, 1.0, 0.0)):
    """Frame with local +Y from a to b, local Z as close to `up` as possible. Returns (matrix at midpoint, length)."""
    a = Vector(a)
    b = Vector(b)
    d = b - a
    length = d.length
    y = d / length
    u = Vector(up)
    if abs(y.dot(u.normalized())) > 0.98:
        u = Vector((1.0, 0.0, 0.0)) if abs(y.x) < 0.9 else Vector((0.0, 0.0, 1.0))
    x = y.cross(u).normalized()
    z = x.cross(y)
    mid = (a + b) / 2
    return Matrix(((x.x, y.x, z.x, mid.x), (x.y, y.y, z.y, mid.y), (x.z, y.z, z.z, mid.z), (0, 0, 0, 1))), length


def beam(g, a, b, w, h=None, c=0.0, up=(0.0, 1.0, 0.0), ext=0.0):
    """Box beam from a to b: w across (perpendicular to `up`), h along `up`."""
    m, length = basis(a, b, up)
    box(g, (w, length + 2 * ext, w if h is None else h), m, c)


def ibeam(g, a, b, depth, width, tw=None, tf=None, up=(0.0, 1.0, 0.0), ext=0.0):
    """I-section from a to b; the web lies along `up` (depth), the flanges across it (width)."""
    m, length = basis(a, b, up)
    tw = tw or depth * 0.18
    tf = tf or depth * 0.16
    W, D = width / 2, depth / 2
    poly = [(-W, -D), (W, -D), (W, -D + tf), (tw / 2, -D + tf), (tw / 2, D - tf), (W, D - tf),
            (W, D), (-W, D), (-W, D - tf), (-tw / 2, D - tf), (-tw / 2, -D + tf), (-W, -D + tf)]
    prism(g, poly, -length / 2 - ext, length / 2 + ext, m)


def refine_strip(strip, max_len):
    """Inserts points so no straight segment of a profile strip is longer than max_len (for the AO bake)."""
    out = [strip[0]]
    for a, b in zip(strip, strip[1:]):
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / max_len - 1e-9))
        out.extend(tuple(a[q] + (b[q] - a[q]) * i / n for q in range(len(a))) for i in range(1, n + 1))
    return out


def lathe(g, strips, segs, m=IDENT, a0=0.0, a1=TAU, uv_v=None, smooth=True, refine=None, uv_u=None):
    """Revolves profile strips [[(r, y), ...], ...] about +Y with angle t at (r sin t, y, r cos t), like three.js
    CylinderGeometry. A strip listed top to bottom faces outward. Strips share no vertices (hard edges between).
    A point may carry its own UV v as (r, y, v); uv_u(t, r) replaces the default u = column / segs."""
    full = abs((a1 - a0) - TAU) < 1e-6
    has_v = uv_v is not None or any(len(p) > 2 for s in strips for p in s)
    cols = segs if (full and not has_v and uv_u is None) else segs + 1
    for strip in strips:
        if refine:
            strip = refine_strip(strip, refine)
        pts, rows, vuv = [], [], []
        for p in strip:
            r, y = p[0], p[1]
            v = p[2] if len(p) > 2 else (uv_v(y) if uv_v else 0.0)
            if r < 1e-7:
                rows.append([len(pts)] * cols)
                pts.append((0.0, y, 0.0))
                vuv.append((uv_u((a0 + a1) / 2, 0.0) if uv_u else 0.5, v))
                continue
            row = []
            for j in range(cols):
                t = a0 + (a1 - a0) * j / segs
                row.append(len(pts))
                pts.append((r * math.sin(t), y, r * math.cos(t)))
                vuv.append((uv_u(t, r) if uv_u else j / segs, v))
            rows.append(row)
        faces, uvs = [], []
        for i in range(len(strip) - 1):
            dr = strip[i + 1][0] - strip[i][0]
            dy = strip[i + 1][1] - strip[i][1]
            if abs(dr) < 1e-9 and abs(dy) < 1e-9:
                continue
            for j in range(segs):
                jn = j + 1 if cols > segs else (j + 1) % segs
                tm = a0 + (a1 - a0) * (j + 0.5) / segs
                f = []
                for v in (rows[i][j], rows[i + 1][j], rows[i + 1][jn], rows[i][jn]):
                    if v not in f:
                        f.append(v)
                if len(f) < 3:
                    continue
                f = orient_to(pts, f, (-dy * math.sin(tm), dr, -dy * math.cos(tm)))
                faces.append(f)
                uvs.append([vuv[v] for v in f])
        g.add(xf(m, pts), faces, smooth, uvs if g.uvs is not None else None)


def disc(g, r, segs, y=0.0, m=IDENT, up=False, r_in=0.0, rings=1):
    """Flat disc (or annulus when r_in > 0) facing down, or up when up=True; rings > 1 adds concentric rings of
    vertices for the AO bake."""
    n_exp = (0.0, 1.0 if up else -1.0, 0.0)
    if r_in > 0 or rings > 1:
        strip = [(r - (r - r_in) * i / rings, y) for i in range(rings + 1)]
        lathe(g, [strip[::-1] if up else strip], segs, m, smooth=False)
        return
    pts = [(r * math.sin(TAU * j / segs), y, r * math.cos(TAU * j / segs)) for j in range(segs)]
    g.add(xf(m, pts), [orient_to(pts, range(segs), n_exp)], False)


def cyl(g, r, y0, y1, segs, m=IDENT, top=True, bottom=True, r_top=None, refine=2.0):
    """Vertical cylinder (optionally tapered) from y0 to y1 with flat caps."""
    rt = r if r_top is None else r_top
    lathe(g, [[(rt, y1), (r, y0)]], segs, m, refine=refine)
    if top:
        disc(g, rt, segs, y1, m, up=True)
    if bottom:
        disc(g, r, segs, y0, m)


def ring_solid(g, r_in, r_out, y0, y1, segs, c=0.0, m=IDENT, refine=None):
    """Solid annulus with optional chamfer on the two outer edges; each face is its own smoothing strip."""
    if c > 0:
        strips = [[(r_out - c, y1), (r_out, y1 - c)], [(r_out, y1 - c), (r_out, y0 + c)], [(r_out, y0 + c), (r_out - c, y0)],
                  [(r_out - c, y0), (r_in, y0)], [(r_in, y0), (r_in, y1)], [(r_in, y1), (r_out - c, y1)]]
    else:
        strips = [[(r_out, y1), (r_out, y0)], [(r_out, y0), (r_in, y0)], [(r_in, y0), (r_in, y1)], [(r_in, y1), (r_out, y1)]]
    lathe(g, strips, segs, m, refine=refine)


def curved_panel(g, r0, r1, y0, y1, t0, t1, segs, m=IDENT):
    """Solid annular sector between lathe angles t0..t1 (radians)."""
    lathe(g, [[(r1, y1), (r1, y0)], [(r1, y0), (r0, y0)], [(r0, y0), (r0, y1)], [(r0, y1), (r1, y1)]], segs, m, t0, t1)
    for t, s in ((t0, -1.0), (t1, 1.0)):
        st, ct = math.sin(t), math.cos(t)
        pts = [(r1 * st, y1, r1 * ct), (r1 * st, y0, r1 * ct), (r0 * st, y0, r0 * ct), (r0 * st, y1, r0 * ct)]
        g.add(xf(m, pts), [orient_to(pts, range(4), (s * ct, 0.0, -s * st))], False)


def clip_segment(px, pz, vx, vz, x0, x1, z0, z1):
    """Clips the infinite line p + t v to the rectangle; returns the end points or None."""
    t0, t1 = -1e9, 1e9
    for p, q in ((-vx, px - x0), (vx, x1 - px), (-vz, pz - z0), (vz, z1 - pz)):
        if abs(p) < 1e-12:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            t0 = max(t0, r)
        else:
            t1 = min(t1, r)
    if t1 <= t0:
        return None
    return (px + vx * t0, pz + vz * t0), (px + vx * t1, pz + vz * t1)


def roles(*names, uv=()):
    return {n: Geo(uv=n in uv) for n in names}


# ---------------------------------------------------------------- booster (src/three/booster.js contract)

R = 4.5
BODY_TOP = 8.0
BODY_BOTTOM = -63.0
ENGINE_Y = -67.6
RING_H = (BODY_TOP - BODY_BOTTOM) * 52 / 2048  # boosterSkin() ring plates, so weld seams meet the texture's
SHIELD_Y = -64.6


def engine_layout():
    out = []
    for i in range(3):
        out.append((0.95, i / 3 * TAU + 0.3))
    for i in range(10):
        out.append((2.35, i / 10 * TAU))
    for i in range(20):
        out.append((3.72, i / 20 * TAU + 0.08))
    return [(math.cos(a) * r, math.sin(a) * r) for r, a in out]


def build_booster():
    G = roles('steel', 'darkSteel', 'soot', 'fin', 'pin', 'dome', 'inner', 'bell', 'throat', uv=('steel',))

    # Body: rolled rings with a raised weld seam at every ring joint of the skin texture. UV like three.js
    # CylinderGeometry (u around from +Z toward +X; v = 1 at the top once the exporter flips V).
    # Each ring panel and each seam is its own smoothing strip, so a seam doesn't bend the panel normals.
    strips = []
    top = BODY_TOP
    k = 1
    while BODY_TOP - k * RING_H > BODY_BOTTOM + 0.2:
        y = BODY_TOP - k * RING_H
        strips.append([(R, top), (R, y + 0.05)])
        strips.append([(R, y + 0.05), (R + 0.018, y), (R, y - 0.05)])
        top = y - 0.05
        k += 1
    strips.append([(R, top), (R, BODY_BOTTOM)])
    lathe(G['steel'], strips, 128, uv_v=lambda y: (BODY_TOP - y) / (BODY_TOP - BODY_BOTTOM))

    # Girth bands at the aft dome and the common dome.
    for y in (BODY_BOTTOM + 7.6, -24.0):
        ring_solid(G['dome'], R - 0.05, R + 0.06, y - 0.28, y + 0.28, 128, c=0.025)

    # Vented hot-stage ring: solid bands, a row of vent posts in front of a dark interior, a bright top flange,
    # and the protective dome sitting inside it.
    ring_solid(G['dome'], 4.05, R + 0.035, BODY_TOP - 0.02, BODY_TOP + 0.55, 128, c=0.025)
    ring_solid(G['dome'], 4.05, R + 0.035, BODY_TOP + 3.3, BODY_TOP + 3.85, 128, c=0.025)
    ring_solid(G['pin'], 4.15, R + 0.07, BODY_TOP + 3.85, BODY_TOP + 4.0, 128, c=0.04)
    posts = 36
    for i in range(posts):
        a = i / posts * TAU
        box(G['darkSteel'], (0.3, 2.75, 0.34), RY(a) @ T(R - 0.13, BODY_TOP + 1.925, 0), c=0.045)
    # Horizontal lintel ring half way up the vents.
    ring_solid(G['darkSteel'], 4.2, R - 0.02, BODY_TOP + 1.85, BODY_TOP + 2.0, 128)
    inner_y0, inner_y1 = BODY_TOP + 0.4, BODY_TOP + 3.95
    lathe(G['inner'], [[(4.08, inner_y1), (4.08, inner_y0)]], 64)
    lathe(G['inner'], [[(4.06, inner_y0), (4.06, inner_y1)]], 64)
    a_base, h_dome = 4.06, 1.75
    rs = (a_base * a_base + h_dome * h_dome) / (2 * h_dome)
    y_apex = BODY_TOP + 0.55 + h_dome
    dome_prof = []
    for i in range(9):
        phi = math.asin(a_base / rs) * i / 8
        dome_prof.append((rs * math.sin(phi), y_apex - rs * (1 - math.cos(phi))))
    lathe(G['dome'], [dome_prof], 64)

    # Grid fins at 45/135/225/315 deg: lattice panels that stick straight out with their cells along the
    # booster's axis, each turned 12 deg about its torque tube as when steering, on an actuator housing.
    fin_x0, fin_x1, fin_hw = 4.88, 8.9, 1.75
    fy0, fy1 = 3.6 - 0.45, 3.6 + 0.45
    fr = 0.08
    for deg in (45, 135, 225, 315):
        mh = RY(rad(deg))
        m = mh @ T(0, 3.6, 0) @ RX(rad(12)) @ T(0, -3.6, 0)
        g = G['fin']
        box_at(g, (fin_x0, fy0, -fin_hw), (fin_x0 + fr, fy1, fin_hw), m, c=0.02)
        box_at(g, (fin_x1 - fr, fy0, -fin_hw), (fin_x1, fy1, fin_hw), m, c=0.02)
        box_at(g, (fin_x0 + fr, fy0, -fin_hw), (fin_x1 - fr, fy1, -fin_hw + fr), m, c=0.02)
        box_at(g, (fin_x0 + fr, fy0, fin_hw - fr), (fin_x1 - fr, fy1, fin_hw), m, c=0.02)
        ix0, ix1, iz0, iz1 = fin_x0 + fr, fin_x1 - fr, -fin_hw + fr, fin_hw - fr
        cx, cz = (ix0 + ix1) / 2, 0.0
        spacing = 0.52
        for vx, vz in ((1.0, 1.0), (1.0, -1.0)):
            n = Vector((vz, -vx)).normalized()
            d = Vector((vx, vz)).normalized()
            for kk in range(-20, 21):
                p = Vector((cx, cz)) + n * (kk * spacing)
                seg = clip_segment(p.x, p.y, d.x, d.y, ix0, ix1, iz0, iz1)
                if not seg:
                    continue
                (ax, az), (bx, bz) = seg
                if math.hypot(bx - ax, bz - az) < 0.12:
                    continue
                mm, length = basis((ax, 3.6, az), (bx, 3.6, bz), up=(0.0, 1.0, 0.0))
                box(g, (0.07, length + 0.04, fy1 - fy0 - 0.05), m @ mm)
        # Torque tube from the housing into the fin's root frame.
        lathe(g, [[(0.3, fin_x0 + 0.02), (0.3, R + 0.2)]], 16, mh @ T(0, 3.6, 0) @ RZ(rad(-90)))
        # Actuator housing on the skin (doubler plate, rounded motor box, actuator cap below it).
        curved_panel(G['dome'], R - 0.02, R + 0.035, 1.9, 5.3, game_theta(deg) - 0.23, game_theta(deg) + 0.23, 8)
        box_at(G['dome'], (R - 0.3, 2.3, -0.8), (R + 0.34, 4.9, 0.8), mh, c=0.16)
        box_at(G['darkSteel'], (R - 0.1, 1.6, -0.45), (R + 0.28, 2.32, 0.45), mh, c=0.05)

    # Catch pins (hardpoints) at 90/270 deg: the flat underside at y = 0 is the catch point the arms meet.
    for deg in (90, 270):
        m = RY(rad(deg))
        box_at(G['pin'], (R - 0.2, 0.0, -0.65), (R + 1.3, 0.9, 0.65), m, c=0.07)
        # Sloped fairing above the load block.
        fair = [(R - 0.15, 0.9), (R + 1.2, 0.9), (R - 0.15, 2.5)]
        pts3 = [(x, y, -0.5) for x, y in fair] + [(x, y, 0.5) for x, y in fair]
        faces = [orient_to(pts3, (0, 1, 2), (0, 0, -1)), orient_to(pts3, (3, 4, 5), (0, 0, 1)),
                 orient_to(pts3, (0, 1, 4, 3), (0, -1, 0)), orient_to(pts3, (1, 2, 5, 4), (1.6, 1.35, 0)),
                 orient_to(pts3, (2, 0, 3, 5), (-1, 0, 0))]
        G['pin'].add(xf(m, pts3), faces)
        curved_panel(G['dome'], R - 0.02, R + 0.04, -0.7, 2.75, game_theta(deg) - 0.22, game_theta(deg) + 0.22, 10)

    # Raceway at 200 deg with straps, and two conduits.
    m = RY(rad(200))
    prism(G['darkSteel'], [(R - 0.05, -0.42), (R + 0.36, -0.3), (R + 0.36, 0.3), (R - 0.05, 0.42)], -60.0, 6.0, m)
    for i in range(22):
        y = -58.0 + i * 3.0
        box_at(G['darkSteel'], (R - 0.04, y - 0.16, -0.52), (R + 0.44, y + 0.16, 0.52), m, c=0.04)
    for deg in (20, 330):
        m = RY(rad(deg))
        cyl(G['darkSteel'], 0.14, -60.0, 0.0, 10, m @ T(R + 0.17, 0, 0), top=True, bottom=True)
        for i in range(15):
            y = -58.0 + i * 4.0
            box_at(G['darkSteel'], (R - 0.03, y - 0.1, -0.24), (R + 0.36, y + 0.1, 0.24), m, c=0.03)

    # Aft stringers above the skirt; the profile is (radial, height), tapering into the skin at the top.
    rib = [(R - 0.03, BODY_BOTTOM), (R + 0.15, BODY_BOTTOM), (R + 0.15, -56.5), (R - 0.03, -55.6)]
    for i in range(64):
        a = i / 64 * TAU
        prism(G['darkSteel'], [(x, -y) for x, y in rib], -0.09, 0.09, RY(a) @ RX(rad(90)))

    # Aft skirt, heat shield and engine boots.
    lathe(G['soot'], [[(R + 0.01, BODY_BOTTOM + 0.05), (R + 0.06, SHIELD_Y + 0.15)],
                      [(R + 0.06, SHIELD_Y + 0.15), (R + 0.1, SHIELD_Y + 0.1), (R + 0.1, SHIELD_Y)]], 128)
    disc(G['soot'], R + 0.1, 96, SHIELD_Y, rings=16)
    for ex, ez in engine_layout():
        lathe(G['soot'], [[(0.43, SHIELD_Y), (0.43, SHIELD_Y - 0.22)], [(0.43, SHIELD_Y - 0.22), (0.31, SHIELD_Y - 0.22)]],
              16, T(ex, 0, ez))

    # 33 engines: chamber, throat and bell (exit plane at ENGINE_Y), a stiffening ring at the lip, and the
    # throat disc the game tints with thrust.
    bell = [(0.3, SHIELD_Y - 0.15), (0.3, -65.15), (0.24, -65.42), (0.2, -65.6)]
    for i in range(1, 9):
        t = i / 8
        bell.append((0.2 + 0.35 * t ** 0.62, -65.6 + (ENGINE_Y + 65.6) * t))
    for ex, ez in engine_layout():
        mm = T(ex, 0, ez)
        lathe(G['bell'], [bell], 20, mm)
        ring_solid(G['bell'], 0.53, 0.57, ENGINE_Y, ENGINE_Y + 0.11, 20, m=mm)
        disc(G['throat'], 0.5, 18, ENGINE_Y + 0.04, mm)
    return G


# ---------------------------------------------------------------- ship (src/three/ship.js contract)

SHIP_TIP = 15.5  # nose tip; the catch pins' undersides are at y = 0 like the booster's
SHIP_NOSE_BASE = 1.9  # where the ogive meets the barrel
SHIP_SKIRT = -32.9  # aft end of the barrel, the heat shield plane
SHIP_ENGINE_Y = -35.0  # exit plane of all six bells (SHIP_ENGINE_Y in src/three/ship.js)
SKIN_UV_M = BODY_TOP - BODY_BOTTOM  # meters per V of the booster skin texture, which the ship's steel shares
TILE_UV_M = 64.0  # meters per UV unit on the heat-shield tiles (TILE_UV_M in src/three/ship.js)
TILE_T = 0.04  # tile thickness above the steel
# Lathe angle of the front flap hinges (the rear ones are opposite). Set off the camera axis so the flaps stand out
# to both sides from the game's cameras; the catch pins stay on the +-Z arms regardless.
SHIP_HINGE = rad(-72)
SHIP_WIND = SHIP_HINGE + math.pi / 2  # windward centreline, the middle of the tiled side
TILE_A0, TILE_A1 = SHIP_HINGE + rad(3), SHIP_HINGE + math.pi - rad(3)  # tiles stop just short of the hinges
NOSE_CAP_S = 2.4  # the nose tip is tiled all around for this arc length


class Profile:
    """Meridian polyline [(r, y)] from the apex down, sampled by arc length s with interpolated outward normals."""

    def __init__(self, pts):
        self.pts = pts
        self.s = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.s.append(self.s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        self.length = self.s[-1]
        seg_n = []
        for a, b in zip(pts, pts[1:]):
            d = math.hypot(b[0] - a[0], b[1] - a[1])
            seg_n.append((-(b[1] - a[1]) / d, (b[0] - a[0]) / d))
        self.n = [seg_n[0]] + [_unit2((p[0] + q[0], p[1] + q[1])) for p, q in zip(seg_n, seg_n[1:])] + [seg_n[-1]]

    def at(self, s, off=0.0):
        """(r, y) at arc length s, pushed off the surface along its normal by off."""
        s = min(max(s, 0.0), self.length)
        i = min(bisect.bisect_right(self.s, s) - 1, len(self.pts) - 2)
        t = (s - self.s[i]) / max(1e-9, self.s[i + 1] - self.s[i])
        a, b = self.pts[i], self.pts[i + 1]
        nr, ny = self.normal(s)
        return a[0] + (b[0] - a[0]) * t + nr * off, a[1] + (b[1] - a[1]) * t + ny * off

    def normal(self, s):
        """Outward unit normal (nr, ny) at arc length s."""
        s = min(max(s, 0.0), self.length)
        i = min(bisect.bisect_right(self.s, s) - 1, len(self.pts) - 2)
        t = (s - self.s[i]) / max(1e-9, self.s[i + 1] - self.s[i])
        na, nb = self.n[i], self.n[i + 1]
        return _unit2((na[0] + (nb[0] - na[0]) * t, na[1] + (nb[1] - na[1]) * t))

    def s_at_y(self, y):
        """Arc length where the profile reaches height y (the profile descends monotonically)."""
        for i in range(len(self.pts) - 1):
            a, b = self.pts[i], self.pts[i + 1]
            if b[1] <= y <= a[1]:
                return self.s[i] + (self.s[i + 1] - self.s[i]) * (a[1] - y) / max(1e-9, a[1] - b[1])
        return self.length


def _unit2(v):
    d = math.hypot(v[0], v[1])
    return (v[0] / d, v[1] / d)


def ship_profile():
    """Spherically blunted tangent ogive nose on a straight barrel, apex to heat shield."""
    nose_len, rn = SHIP_TIP - SHIP_NOSE_BASE, 0.9

    def blunted(L):
        rho = (R * R + L * L) / (2 * R)
        return math.sqrt((rho - rn) ** 2 - (rho - R) ** 2) + rn

    lo, hi = nose_len, 3 * nose_len
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if blunted(mid) < nose_len else (lo, mid)
    L = (lo + hi) / 2
    rho = (R * R + L * L) / (2 * R)
    x0 = L - math.sqrt((rho - rn) ** 2 - (rho - R) ** 2)
    yt = rn * (rho - R) / (rho - rn)
    xt = x0 - math.sqrt(rn * rn - yt * yt)
    xa = x0 - rn
    pts = []
    for i in range(40):  # spherical cap, by angle from the apex
        phi = math.acos((x0 - xt) / rn) * i / 40
        x = x0 - rn * math.cos(phi)
        pts.append((rn * math.sin(phi), SHIP_NOSE_BASE + L - x))
    for i in range(161):  # ogive
        x = xt + (L - xt) * i / 160
        pts.append((math.sqrt(max(0.0, rho * rho - (L - x) ** 2)) + R - rho, SHIP_NOSE_BASE + L - x))
    pts[-1] = (R, SHIP_NOSE_BASE)
    assert abs(SHIP_NOSE_BASE + L - xa - SHIP_TIP) < 1e-6
    pts.append((R, SHIP_SKIRT))
    return Profile(pts)


def ship_rows(prof, s0, s1, nose_step=0.45, barrel_step=1.0):
    """Arc-length rows from s0 to s1: dense where the nose curves, sparser on the barrel."""
    s_barrel = prof.s_at_y(SHIP_NOSE_BASE)
    rows, s = [s0], s0
    while True:
        step = 0.15 if s < 1.6 else nose_step if s < s_barrel - 0.05 else barrel_step
        nxt = s + step
        if s < s_barrel - 0.05 < nxt:
            nxt = s_barrel
        if nxt >= s1 - 0.5 * step:
            break
        rows.append(nxt)
        s = nxt
    rows.append(s1)
    return rows


def ship_engine_layout():
    """(x, z, exit radius, kind) of the three sea-level engines at the center and the three vacuum engines."""
    out = []
    for i in range(3):
        a = rad(30 + 120 * i)
        out.append((math.cos(a) * 1.15, math.sin(a) * 1.15, 0.64, 'sl'))
    for i in range(3):
        a = rad(90 + 120 * i)
        out.append((math.cos(a) * 2.95, math.sin(a) * 2.95, 1.2, 'vac'))
    return out


def surface_point(prof, s, t, off=0.0):
    r, y = prof.at(s, off)
    return Vector((r * math.sin(t), y, r * math.cos(t)))


def meridian_fairing(g, prof, t, s0, s1, half_w, height):
    """Raised strip that follows the hull along the meridian at lathe angle t, e.g. a flap hinge cover."""
    rows = ship_rows(prof, s0, s1)
    e = Vector((math.cos(t), 0.0, -math.sin(t)))
    pts, faces = [], []
    for s in rows:
        base = surface_point(prof, s, t, -0.03)
        top = surface_point(prof, s, t, height)
        for p in (base - e * half_w, top - e * half_w * 0.6, top + e * half_w * 0.6, base + e * half_w):
            pts.append(tuple(p))
    for i in range(len(rows) - 1):
        below = surface_point(prof, (rows[i] + rows[i + 1]) / 2, t, -0.5)
        for j in range(3):
            f = (4 * i + j, 4 * i + j + 1, 4 * i + j + 5, 4 * i + j + 4)
            faces.append(orient_to(pts, f, centroid(pts, f) - below))
    for k, sgn in ((0, -1.0), (len(rows) - 1, 1.0)):
        r0, y0 = prof.at(rows[k])
        r1, y1 = prof.at(rows[k] + 0.01 * sgn)
        tang = Vector(((r1 - r0) * math.sin(t), y1 - y0, (r1 - r0) * math.cos(t)))
        faces.append(orient_to(pts, range(4 * k, 4 * k + 4), tang))
    g.add(pts, faces)


def flap(G, prof, t, s_lo, s_hi, span, tip_lo, tip_hi, th_root, th_tip, deflect, cover):
    """Flat, tapered control flap hinged along the meridian at lathe angle t between arc lengths s_lo..s_hi
    (s_lo the upper end), swung toward the windward side by `deflect` (negative: back toward leeward). Its
    windward face is tiled, the rest is steel. On the curved nose the straight hinge dips under the skin; the
    plate comes out of it."""
    a = surface_point(prof, s_lo, t, 0.12)
    b = surface_point(prof, s_hi, t, 0.12)
    u = (b - a).normalized()
    radial = Vector((math.sin(t), 0.0, math.cos(t)))
    wind = Vector((math.sin(SHIP_WIND), 0.0, math.cos(SHIP_WIND)))
    w0 = (radial - u * radial.dot(u)).normalized()
    side = (wind - u * wind.dot(u) - w0 * wind.dot(w0)).normalized()
    w = (w0 * math.cos(deflect) + side * math.sin(deflect)).normalized()
    n = u.cross(w)
    if n.dot(wind) < 0:
        n = -n
    root = (b - a).length
    P, Q = 10, 7
    top, bot, uv = [], [], []
    for qi in range(Q + 1):
        q = qi / Q
        lo, hi = tip_lo * q, root + (tip_hi - root) * q
        wq = -0.15 + (span + 0.15) * q
        th = (th_root + (th_tip - th_root) * q) * math.sqrt(max(0.0, 1 - q ** 6))
        for pi_ in range(P + 1):
            p = pi_ / P
            uu = lo + (hi - lo) * p
            half = 0.5 * th * math.sqrt(max(0.0, 1 - abs(2 * p - 1) ** 3))
            c = a + u * uu + w * wq
            top.append(tuple(c + n * half))
            bot.append(tuple(c - n * half))
            uv.append((0.2 + max(0.0, wq) / TILE_UV_M, 0.2 + uu / TILE_UV_M))
    quads = [(qi * (P + 1) + pi_, qi * (P + 1) + pi_ + 1, (qi + 1) * (P + 1) + pi_ + 1, (qi + 1) * (P + 1) + pi_)
             for qi in range(Q) for pi_ in range(P)]
    G['tiles'].add(top, [orient_to(top, f, n) for f in quads], True, [[uv[i] for i in orient_to(top, f, n)] for f in quads])
    G['dome'].add(bot, [orient_to(bot, f, -n) for f in quads], True)
    # Root edge, inside the hinge cover.
    edge = [top[i] for i in range(P + 1)] + [bot[i] for i in range(P + 1)]
    G['dome'].add(edge, [orient_to(edge, (i, i + 1, P + 2 + i, P + 1 + i), -w) for i in range(P)])
    meridian_fairing(G['dome'], prof, t, s_lo - 0.3, s_hi + 0.3, cover[0] / 2, cover[1])


def build_ship():
    G = roles('steel', 'tiles', 'darkSteel', 'soot', 'pin', 'dome', 'bell', 'throat', uv=('steel', 'tiles'))
    prof = ship_profile()
    s_end = prof.length
    s_base = prof.s_at_y(SHIP_NOSE_BASE)

    # Steel skin on the leeward side, in rolled rings with raised weld seams spaced like the booster's skin
    # texture rows (v = arc length from the tip / SKIN_UV_M, so the seams meet the texture's ring joints).
    # It runs a little under both tile edges.
    sa0, sa1 = TILE_A1 - rad(2), TILE_A0 + TAU + rad(2)
    steel_u = lambda t, r: (t - sa0) / TAU

    def pt(s, off=0.0, uv_m=SKIN_UV_M):
        r, y = prof.at(s, off)
        return (0.0 if s <= 1e-9 else r, y, s / uv_m)

    strips = []
    k = 1
    top = NOSE_CAP_S - 0.05
    while (k * RING_H) < s_end - 0.4:
        sk = k * RING_H
        k += 1
        if sk < top + 0.4:
            continue
        strips.append([pt(s) for s in ship_rows(prof, top, sk - 0.05)])
        strips.append([pt(sk - 0.05), pt(sk, 0.018), pt(sk + 0.05)])
        top = sk + 0.05
    strips.append([pt(s) for s in ship_rows(prof, top, s_end)])
    lathe(G['steel'], strips, 72, a0=sa0, a1=sa1, uv_u=steel_u)

    # Heat-shield tiles: the windward half of the body, and the nose tip all the way round. UV in meters /
    # TILE_UV_M around the windward centreline, so the hex texture keeps its size up the tapering nose.
    tile_u = lambda t, r: 0.5 + (t - SHIP_WIND) * r / TILE_UV_M

    def tpt(s):
        return pt(s, TILE_T, TILE_UV_M)

    lathe(G['tiles'], [[tpt(s) for s in ship_rows(prof, 0.0, NOSE_CAP_S, 0.3)]], 48,
          a0=SHIP_WIND - math.pi, a1=SHIP_WIND + math.pi, uv_u=tile_u)
    lathe(G['tiles'], [[tpt(s) for s in ship_rows(prof, NOSE_CAP_S, s_end, 0.45, 0.8)]], 56, a0=TILE_A0, a1=TILE_A1, uv_u=tile_u)
    # Tile edges down to the steel: below the nose cap on the leeward side, along both sides, and at the base.
    lathe(G['tiles'], [[tpt(NOSE_CAP_S), pt(NOSE_CAP_S, 0.0, TILE_UV_M)]], 72, a0=sa0, a1=sa1, uv_u=tile_u)
    lathe(G['tiles'], [[tpt(s_end), pt(s_end, 0.0, TILE_UV_M)]], 56, a0=TILE_A0, a1=TILE_A1, uv_u=tile_u)
    for t, side in ((TILE_A0, -1.0), (TILE_A1, 1.0)):
        rows = ship_rows(prof, NOSE_CAP_S, s_end, 0.45, 0.8)
        et = (math.cos(t) * side, 0.0, -math.sin(t) * side)
        pts, uvs = [], []
        for s in rows:
            for off in (TILE_T, 0.0):
                r, y = prof.at(s, off)
                pts.append((r * math.sin(t), y, r * math.cos(t)))
                uvs.append((tile_u(t, r), s / TILE_UV_M))
        faces = [orient_to(pts, (2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2), et) for i in range(len(rows) - 1)]
        G['tiles'].add(pts, faces, False, [[uvs[j] for j in f] for f in faces])

    # Catch pins at 90/270 deg (toward -Z / +Z, onto the arms) below the forward flaps, each with a sloped
    # fairing and a doubler plate that stands proud of the tiles on the windward one.
    for deg in (90, 270):
        m = RY(rad(deg))
        box_at(G['pin'], (R - 0.2, 0.0, -0.65), (R + 1.3, 0.9, 0.65), m, c=0.07)
        fair = [(R - 0.15, 0.9), (R + 1.2, 0.9), (R - 0.15, 1.75)]
        pts3 = [(x, y, -0.5) for x, y in fair] + [(x, y, 0.5) for x, y in fair]
        faces = [orient_to(pts3, (0, 1, 2), (0, 0, -1)), orient_to(pts3, (3, 4, 5), (0, 0, 1)),
                 orient_to(pts3, (0, 1, 4, 3), (0, -1, 0)), orient_to(pts3, (1, 2, 5, 4), (0.85, 1.35, 0)),
                 orient_to(pts3, (2, 0, 3, 5), (-1, 0, 0))]
        G['pin'].add(xf(m, pts3), faces)
        curved_panel(G['dome'], R - 0.02, R + 0.075, -0.7, 1.85, game_theta(deg) - 0.16, game_theta(deg) + 0.16, 8)

    # Forward flaps on the nose and larger aft flaps on the barrel, at the edges of the tiles, swung a little
    # back toward the leeward side.
    for t in (SHIP_HINGE, SHIP_HINGE + math.pi):
        flap(G, prof, t, prof.s_at_y(10.8), prof.s_at_y(2.9), 3.2, 3.3, 6.9, 0.5, 0.26, rad(-5), (0.75, 0.45))
        flap(G, prof, t, prof.s_at_y(-20.6), prof.s_at_y(-31.9), 4.5, 2.6, 9.3, 0.6, 0.3, rad(-5), (0.95, 0.55))

    # Leeward raceway with straps, and RCS pods on the nose and the aft skirt.
    m = RY(rad(145))
    prism(G['darkSteel'], [(R - 0.05, -0.36), (R + 0.3, -0.26), (R + 0.3, 0.26), (R - 0.05, 0.36)], -31.2, -0.8, m)
    for i in range(11):
        y = -30.0 + i * 2.9
        box_at(G['darkSteel'], (R - 0.04, y - 0.14, -0.45), (R + 0.37, y + 0.14, 0.45), m, c=0.04)
    for y in (4.2, -30.4):
        r = prof.at(prof.s_at_y(y))[0]
        for dz in (-1.1, 1.1):
            box_at(G['darkSteel'], (r - 0.15, y - 0.35, dz - 0.4), (r + 0.32, y + 0.35, dz + 0.4), RY(rad(180)), c=0.08)

    # Aft end: a soot lip, the heat shield with engine boots, and six bells. Three sea-level bells at the center
    # (exit radius 0.64) and three vacuum bells on the outer ring (exit radius 1.2) all end at SHIP_ENGINE_Y; the
    # sea-level bells carry the throat discs the game lights during the landing burn.
    ring_solid(G['soot'], R - 0.1, R + TILE_T + 0.03, SHIP_SKIRT, SHIP_SKIRT + 0.3, 112, c=0.02)
    disc(G['soot'], R - 0.1, 96, SHIP_SKIRT, rings=14)
    for ex, ez, re, kind in ship_engine_layout():
        mm = T(ex, 0, ez)
        if kind == 'sl':
            lathe(G['soot'], [[(0.44, SHIP_SKIRT), (0.44, SHIP_SKIRT - 0.2)], [(0.44, SHIP_SKIRT - 0.2), (0.33, SHIP_SKIRT - 0.2)]], 16, mm)
            bell = [(0.32, SHIP_SKIRT - 0.1), (0.32, SHIP_SKIRT - 0.45), (0.26, SHIP_SKIRT - 0.62), (0.21, SHIP_SKIRT - 0.75)]
            y0 = SHIP_SKIRT - 0.75
            bell += [(0.21 + (re - 0.21) * (i / 8) ** 0.62, y0 + (SHIP_ENGINE_Y - y0) * i / 8) for i in range(1, 9)]
            lathe(G['bell'], [bell], 20, mm)
            ring_solid(G['bell'], re - 0.02, re + 0.03, SHIP_ENGINE_Y, SHIP_ENGINE_Y + 0.1, 20, m=mm)
            disc(G['throat'], re - 0.06, 18, SHIP_ENGINE_Y + 0.04, mm)
        else:
            y0 = SHIP_SKIRT + 0.3
            bell = [(0.62 + (re - 0.62) * (i / 10) ** 0.75, y0 + (SHIP_ENGINE_Y - y0) * i / 10) for i in range(11)]
            lathe(G['bell'], [bell], 28, mm)
            ring_solid(G['bell'], re - 0.02, re + 0.05, SHIP_ENGINE_Y, SHIP_ENGINE_Y + 0.14, 28, m=mm)
            ym = SHIP_SKIRT - 0.9
            rm = 0.62 + (re - 0.62) * ((ym - y0) / (SHIP_ENGINE_Y - y0)) ** 0.75
            ring_solid(G['bell'], rm - 0.02, rm + 0.05, ym - 0.08, ym + 0.08, 28, m=mm)
    return G


# ---------------------------------------------------------------- tower (src/three/tower.js contract)

TOWER_H = 148.5
HM = 7.0
BAYS = 20
BAY = TOWER_H / BAYS
ARM_LEN = 31.0
ARM_W = 2.2
ARM_Z = 6.1
PIVOT_X = -(HM + 1.4)  # side = -1 build: arms reach toward -X; the game mirrors it for side = +1


def build_tower():
    S = roles('lattice', 'carriage', 'concrete')
    corners = [(-HM, -HM), (HM, -HM), (HM, HM), (-HM, HM)]
    face_normals = [(0, 0, -1), (1, 0, 0), (0, 0, 1), (-1, 0, 0)]

    # Foundation.
    box_at(S['concrete'], (-10, -0.8, -10), (10, 1.6, 10), c=0.18)
    box_at(S['concrete'], (-8.8, 1.6, -8.8), (8.8, 3.2, 8.8), c=0.15)
    for x, z in corners:
        box_at(S['concrete'], (x - 1.35, 3.2, z - 1.35), (x + 1.35, 4.0, z + 1.35), c=0.1)

    lat = S['lattice']
    y_base = 4.0
    levels = [y_base] + [(i + 1) * BAY for i in range(BAYS)]
    # Column vertices at each girt and a metre either side of it, for the AO bake.
    col_cuts = [y + d for y in levels for d in (-1.0, 0.0, 1.0)]
    for x, z in corners:
        box_at(lat, (x - 0.75, y_base, z - 0.75), (x + 0.75, TOWER_H, z + 0.75), c=0.2, cuts={1: col_cuts})
        # Bolted splice plates on every column face, half way between girts.
        for k in range(1, BAYS // 2):
            y = k * 2 * BAY + BAY / 2
            for nx, nz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                cx, cz = x + nx * 0.78, z + nz * 0.78
                w = (0.06, 0.9, 1.15) if nx else (1.15, 0.9, 0.06)
                box(lat, w, T(cx, y, cz))
    for li in range(len(levels) - 1):
        y = levels[li]
        for c in range(4):
            (xa, za), (xb, zb) = corners[c], corners[(c + 1) % 4]
            n = face_normals[c]
            ux, uz = (xb - xa) / (2 * HM), (zb - za) / (2 * HM)
            a = (xa + ux * 0.75, y, za + uz * 0.75)
            b = (xb - ux * 0.75, y, zb - uz * 0.75)
            ibeam(lat, a, b, 0.8, 0.55, up=(0, 1, 0))
            # Gusset plates on the outer flange where the girt meets each column.
            for (px, pz), s in (((xa, za), 1), ((xb, zb), -1)):
                cxp = px + ux * s * 1.3 + n[0] * 0.3
                czp = pz + uz * s * 1.3 + n[2] * 0.3
                size = (1.1 if ux else 0.05, 1.4, 1.1 if uz else 0.05)
                box(lat, size, T(cxp, y, czp))
    for i in range(BAYS):
        ya = levels[i] + 0.45
        yb = levels[i + 1] - 0.45
        for c in range(4):
            (xa, za), (xb, zb) = corners[c], corners[(c + 1) % 4]
            n = face_normals[c]
            ux, uz = (xb - xa) / (2 * HM), (zb - za) / (2 * HM)
            pa = (xa + ux * 0.8, ya, za + uz * 0.8)
            pb = (xb - ux * 0.8, yb, zb - uz * 0.8)
            pc = (xb - ux * 0.8, ya, zb - uz * 0.8)
            pd = (xa + ux * 0.8, yb, za + uz * 0.8)
            beam(lat, pa, pb, 0.42, 0.3, c=0.05, up=n)
            beam(lat, pc, pd, 0.42, 0.3, c=0.05, up=n)
        if i % 4 == 1:
            y = levels[i + 1]
            beam(lat, (-HM + 0.6, y - 0.1, -HM + 0.6), (HM - 0.6, y - 0.1, HM - 0.6), 0.35, 0.35, c=0.04)
            beam(lat, (HM - 0.6, y - 0.1, -HM + 0.6), (-HM + 0.6, y - 0.1, HM - 0.6), 0.35, 0.35, c=0.04)

    # Stair and elevator core inside the lattice, behind the arm face.
    sx0, sx1, sz0, sz1 = 1.2, 4.6, -1.6, 1.8
    for x in (sx0, sx1):
        for z in (sz0, sz1):
            box_at(lat, (x - 0.13, y_base, z - 0.13), (x + 0.13, TOWER_H - 1, z + 0.13))
    for i in range(BAYS):
        y = levels[i + 1] - 1.6
        for (xa, za), (xb, zb) in (((sx0, sz0), (sx1, sz0)), ((sx1, sz0), (sx1, sz1)), ((sx1, sz1), (sx0, sz1)), ((sx0, sz1), (sx0, sz0))):
            beam(lat, (xa, y, za), (xb, y, zb), 0.16, 0.22)
        box_at(S['carriage'], (sx0, y + 0.11, sz0), (sx1, y + 0.22, sz1))
        ys = levels[i] + 0.5
        beam(lat, (sx0 + 0.2, ys, sz1 - 0.6), (sx1 - 0.2, levels[i + 1] - 1.7, sz1 - 0.6), 0.12, 0.9, up=(0, 0, 1))

    # Pipes up the inside of the back face.
    for z in (-3.4, -2.5):
        cyl(S['carriage'], 0.34, y_base, 118.0, 12, T(5.7, 0, z), bottom=False)
        for i in range(1, 16):
            box_at(S['carriage'], (5.0, levels[i] - 0.15, z - 0.45), (6.95, levels[i] + 0.15, z + 0.45))

    # Carriage rails on the arm face, bolted to every girt.
    car = S['carriage']
    for z in (-4.2, 4.2):
        ibeam(car, (-7.5, 12.0, z), (-7.5, TOWER_H - 6.0, z), 0.9, 0.9, tw=0.22, tf=0.18, up=(1, 0, 0))
        for li in range(2, len(levels) - 1):
            box_at(car, (-7.35, levels[li] - 0.25, z - 0.55), (-6.6, levels[li] + 0.25, z + 0.55))

    # Top deck: perimeter box girders, deck plate, handrails, hoist house and the cable sheaves.
    yt = TOWER_H
    for (xa, za), (xb, zb) in (((-8.5, -8.1), (8.5, -8.1)), ((-8.5, 8.1), (8.5, 8.1)), ((-8.1, -8.5), (-8.1, 8.5)), ((8.1, -8.5), (8.1, 8.5))):
        beam(car, (xa, yt + 0.7, za), (xb, yt + 0.7, zb), 0.8, 1.4, c=0.06)
    box_at(car, (-8.3, yt + 1.2, -8.3), (8.3, yt + 1.4, 8.3))
    for x in (-3.0, 3.0):
        beam(car, (x, yt + 0.7, -8.0), (x, yt + 0.7, 8.0), 0.5, 1.0)
    rail_y = yt + 1.4
    for (xa, za), (xb, zb) in (((-8.4, -8.4), (8.4, -8.4)), ((8.4, -8.4), (8.4, 8.4)), ((8.4, 8.4), (-8.4, 8.4)), ((-8.4, 8.4), (-8.4, -8.4))):
        beam(lat, (xa, rail_y + 1.1, za), (xb, rail_y + 1.1, zb), 0.08)
        beam(lat, (xa, rail_y + 0.55, za), (xb, rail_y + 0.55, zb), 0.06)
        for k in range(9):
            t = k / 8
            px, pz = xa + (xb - xa) * t, za + (zb - za) * t
            box_at(lat, (px - 0.05, rail_y, pz - 0.05), (px + 0.05, rail_y + 1.1, pz + 0.05))
    box_at(car, (1.0, rail_y, -3.6), (7.0, rail_y + 3.0, 3.6), c=0.12)
    box_at(car, (0.6, rail_y + 3.0, -3.9), (7.4, rail_y + 3.25, 3.9), c=0.05)
    for z in (-4.2, 4.2):
        lathe(car, [[(1.15, 0.2), (1.15, -0.2)], [(1.15, -0.2), (0.0, -0.2)], [(0.0, 0.2), (1.15, 0.2)]], 24,
              T(-6.6, rail_y + 1.35, z) @ RX(rad(90)))
        box_at(car, (-7.6, rail_y, z - 0.6), (-5.6, rail_y + 1.3, z - 0.3))
        box_at(car, (-7.6, rail_y, z + 0.3), (-5.6, rail_y + 1.3, z + 0.6))
        box_at(car, (-6.3, rail_y + 1.0, z - 0.5), (1.0, rail_y + 1.7, z + 0.5), c=0.05)

    # Lightning mast (side * 3, ..., 3) and the jib at the top (-side * 6, ..., -3).
    mx, mz = -3.0, 3.0
    lathe(lat, [[(0.35, yt + 23.5), (0.6, rail_y)]], 12, T(mx, 0, mz))
    for y in (rail_y + 6, rail_y + 12, rail_y + 18):
        ring_solid(lat, 0.3, 0.62, y - 0.2, y + 0.2, 12, m=T(mx, 0, mz))
    cyl(lat, 0.06, yt + 23.5, yt + 26.5, 6, T(mx, 0, mz), bottom=False)
    for k in range(4):
        a = k / 4 * TAU + 0.4
        beam(lat, (mx + math.cos(a) * 0.5, rail_y + 3.0, mz + math.sin(a) * 0.5), (mx + math.cos(a) * 1.8, rail_y, mz + math.sin(a) * 1.8), 0.14)

    jib = T(6.0, yt + 6.0, -3.0) @ RZ(-0.18)
    chords = [(0.6, 0.0), (-0.45, -0.55), (-0.45, 0.55)]
    for cy, cz in chords:
        beam(lat, tuple(jib @ Vector((-12.0, cy, cz))), tuple(jib @ Vector((12.0, cy, cz))), 0.24, 0.24, c=0.03)
    nb = 16
    for k in range(nb):
        xa, xb = -12 + 24 * k / nb, -12 + 24 * (k + 1) / nb
        for (ya, za), (yb, zb) in ((chords[0], chords[1]), (chords[1], chords[2]), (chords[2], chords[0])):
            if k % 2:
                ya, za, yb, zb = yb, zb, ya, za
            beam(lat, tuple(jib @ Vector((xa, ya, za))), tuple(jib @ Vector((xb, yb, zb))), 0.1)
    box(lat, (1.2, 1.6, 1.6), jib @ T(12.2, 0.0, 0.0), c=0.1)
    # A-frame that carries the jib off the deck, and a back stay to the hoist house.
    for zz in (-0.55, 0.55):
        for xl in (-6.0, 0.0):
            top = jib @ Vector((xl, -0.45, zz))
            beam(lat, (top.x, rail_y, -3.0 + zz * 2.6), tuple(top), 0.3, c=0.04)
    beam(lat, tuple(jib @ Vector((-11.5, 0.6, 0.0))), (1.0, rail_y + 3.2, -3.0), 0.26)

    # ------------------------------------------------ carriage (moves with the arms; local y = 0 is the arm top)
    C = roles('carriage')
    cg = C['carriage']
    h = HM + 1.4
    for x in (-h, h):
        for z in (-h, h):
            box_at(cg, (x - 0.55, -8.0, z - 0.55), (x + 0.55, 2.0, z + 0.55), c=0.1)
    for y in (1.6, -7.6):
        for (xa, za), (xb, zb) in (((-h, -h), (h, -h)), ((-h, h), (h, h)), ((h, -h), (h, h))):
            ibeam(cg, (xa, y, za), (xb, y, zb), 0.9, 0.8, up=(0, 1, 0), ext=-0.5)
        ibeam(cg, (-h, y, -h), (-h, y, h), 0.9, 0.8, up=(0, 1, 0), ext=-0.5)
    # X bracing on the three faces that wrap the tower.
    for (xa, za), (xb, zb), n in (((-h, -h), (h, -h), (0, 0, -1)), ((-h, h), (h, h), (0, 0, 1)), ((h, -h), (h, h), (1, 0, 0))):
        xm, zm = (xa + xb) / 2, (za + zb) / 2
        box_at(cg, (xm - 0.3, -7.2, zm - 0.3), (xm + 0.3, 1.2, zm + 0.3))
        for (x0, z0), (x1, z1) in (((xa, za), (xm, zm)), ((xm, zm), (xb, zb))):
            beam(cg, (x0, 1.1, z0), (x1, -7.1, z1), 0.32, 0.3, c=0.04, up=n)
            beam(cg, (x1, 1.1, z1), (x0, -7.1, z0), 0.32, 0.3, c=0.04, up=n)
    # Front girder on the arm face with stiffeners, roller trucks on the rails and the hinge knuckles.
    box_at(cg, (-h - 0.35, -7.2, -7.4), (-h + 0.35, 1.2, 7.4), c=0.1)
    for y in (-5.0, -2.6, -0.2):
        box_at(cg, (-h - 0.52, y - 0.12, -7.2), (-h - 0.3, y + 0.12, 7.2))
    for z in (-3.0, 0.0, 3.0):
        box_at(cg, (-h - 0.52, -7.0, z - 0.12), (-h - 0.3, 1.0, z + 0.12))
    for z in (-4.2, 4.2):
        for y in (0.4, -6.2):
            box_at(cg, (-h + 0.3, y - 0.8, z - 0.72), (-7.3, y + 0.8, z + 0.72), c=0.08)
            for yy in (y - 0.45, y + 0.45):
                for zz in (z - 0.8, z + 0.8):
                    cyl(cg, 0.28, -0.08, 0.08, 12, T(-7.6, yy, zz) @ RX(rad(90)))
    for z in (-ARM_Z, ARM_Z):
        for y0, y1 in ((0.85, 1.5), (-4.3, -3.65)):
            box_at(cg, (-h - 1.55, y0, z - 1.05), (-h + 0.3, y1, z + 1.05), c=0.12)
        cyl(cg, 0.38, -4.6, 1.85, 16, T(PIVOT_X, 0, z))
    for z in (-3.0, 3.0):
        box_at(cg, (-h - 0.9, 2.25, z - 0.12), (-h + 0.2, 2.55, z + 0.12))

    # ------------------------------------------------ arm (pivot space: hinge at the origin, reaching +X)
    A = roles('arm', 'carriage', 'pad')
    ag = A['arm']
    lathe(A['carriage'], [[(0.78, 0.8), (0.78, -3.6)]], 20)
    box_at(ag, (0.25, -3.6, -1.43), (2.6, 0.8, 1.43), c=0.15)
    box_at(ag, (0.0, -0.7, -ARM_W / 2), (ARM_LEN, 0.0, ARM_W / 2), c=0.07)
    for z in (-0.72, 0.72):
        box_at(A['carriage'], (2.6, 0.0, z - 0.11), (29.6, 0.12, z + 0.11), c=0.02)
    for z in (-0.82, 0.82):
        box_at(ag, (0.4, -3.2, z - 0.23), (29.7, -2.7, z + 0.23), c=0.05)
    xs = [2.6 + 2.6 * k for k in range(11)]
    for zs in (-0.92, 0.92):
        for x in xs:
            box_at(ag, (x - 0.16, -2.75, zs - 0.14), (x + 0.16, -0.65, zs + 0.14), c=0.04)
        for k in range(len(xs) - 1):
            ya, yb = (-2.7, -0.7) if k % 2 == 0 else (-0.7, -2.7)
            beam(ag, (xs[k], ya, zs), (xs[k + 1], yb, zs), 0.22, 0.22, c=0.03, up=(0, 0, 1))
    for k in range(len(xs) - 1):
        za, zb = (-0.82, 0.82) if k % 2 == 0 else (0.82, -0.82)
        beam(ag, (xs[k], -2.95, za), (xs[k + 1], -2.95, zb), 0.16, 0.16, up=(0, 1, 0))
    box_at(ag, (29.6, -3.2, -1.21), (ARM_LEN, 0.0, 1.21), c=0.12)
    box_at(A['pad'], (ARM_LEN - 0.05, -2.6, -0.9), (ARM_LEN + 0.15, -0.6, 0.9), c=0.04)
    # Stay from a short post above the hinge down to the arm.
    box_at(A['carriage'], (-0.3, 0.8, -0.38), (0.45, 5.9, 0.38), c=0.06)
    beam(A['carriage'], (0.0, 5.5, 0.0), (11.0, -0.3, 0.0), 0.45, 0.45, c=0.05, up=(0, 0, 1))
    # Catch cart where the booster's pins land.
    reach = 26.0 - (HM + 1.4)
    box_at(A['pad'], (reach - 3.5, -0.05, -0.99), (reach + 3.5, 0.2, 0.99), c=0.05)
    for x in (reach - 3.3, reach + 3.3):
        box_at(A['pad'], (x - 0.35, 0.2, -0.8), (x + 0.35, 0.42, 0.8), c=0.04)
    return S, C, A


# ---------------------------------------------------------------- props (src/three/world.js siteDressing layout)


def mulberry32(seed):
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & 0xFFFFFFFF

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(a ^ (a >> 15), 1 | a)
        t = (((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def build_props():
    P = roles('tankSteel', 'band', 'insulated', 'concrete', 'mountSteel', 'dark')
    nxt = mulberry32(4242)

    def rng(lo, hi):
        return lo + (hi - lo) * nxt()

    # Vertical GSE tanks: same seeded radius, height and spot as the procedural farm.
    for i in range(9):
        r = rng(3.2, 5.2)
        hgt = rng(16, 30)
        x = -220 + i * 12.5 + rng(-1.5, 1.5)
        z = -262 + rng(-6, 6)
        m = T(x, 0, z)
        y0, y1 = 1.5, 1.5 + hgt
        head = []
        for k in range(7):
            phi = (math.pi / 2) * k / 6
            head.append((r * math.cos(phi), y1 + 0.35 * r * math.sin(phi)))
        head = head[::-1]
        lathe(P['tankSteel'], [head + [(r, y0 + 0.5), (r, y0)]], 40, m, refine=2.5)
        disc(P['tankSteel'], r, 40, y0, m)
        nb = max(2, int(hgt / 5.5))
        for k in range(1, nb + 1):
            y = y0 + hgt * k / (nb + 1)
            ring_solid(P['band'], r - 0.05, r + 0.09, y - 0.22, y + 0.22, 40, m=m)
        ring_solid(P['band'], r - 0.05, r + 0.12, y1 - 0.5, y1 - 0.05, 40, m=m)
        lathe(P['concrete'], [[(r * 0.97, y0), (r * 1.02, 0.0)]], 40, m)
        # Plinth top as rings (the part under the tank is hidden) so the bake can shade the foot of the tank.
        lathe(P['concrete'], [[(r * 0.9, 0.12), (r * 1.02, 0.12), (r * 1.1, 0.12), (r * 1.25, 0.12)]], 40, m, smooth=False)
        lathe(P['concrete'], [[(r * 1.25, 0.12), (r * 1.25, -0.2)]], 24, m)
        # Caged ladder up the side facing the site.
        a = rad(80)
        lx, lz = math.cos(a) * (r + 0.45), math.sin(a) * (r + 0.45)
        tx, tz = -math.sin(a), math.cos(a)
        for s in (-0.3, 0.3):
            beam(P['band'], (x + lx + tx * s, 0.5, z + lz + tz * s), (x + lx + tx * s, y1 + 0.6, z + lz + tz * s), 0.07)
        for k in range(int(hgt / 2.4)):
            y = 3.0 + k * 2.4
            beam(P['band'], (x + math.cos(a) * r, y, z + math.sin(a) * r), (x + lx, y, z + lz), 0.06)

    # Pipe rack along the farm (two pipes on H frames).
    for k in range(21):
        xk = -225 + k * 7.5
        for zz in (-251.6, -248.4):
            box_at(P['band'], (xk - 0.18, 0.0, zz - 0.18), (xk + 0.18, 9.2, zz + 0.18))
        for yy in (6.4, 8.9):
            box_at(P['band'], (xk - 0.16, yy - 0.16, -251.8), (xk + 0.16, yy + 0.16, -248.2))
    for yy, zz, rr in ((7.0, -250.7, 0.35), (7.0, -249.3, 0.35), (9.5, -250.0, 0.45)):
        cyl(P['tankSteel'], rr, -75.0, 75.0, 12, T(-150, yy, zz) @ RZ(rad(90)), refine=3.75)

    # Insulated spheres on eight legs with an equator girder and cross bracing.
    for i in range(3):
        cx, cy, cz = -90 + i * 24, 11.5, -300
        prof = []
        for k in range(17):
            phi = math.pi / 2 - math.pi * k / 16
            prof.append((9 * math.cos(phi), cy + 9 * math.sin(phi)))
        prof[0] = (0.0, cy + 9)
        prof[-1] = (0.0, cy - 9)
        lathe(P['insulated'], [prof], 40, T(cx, 0, cz))
        ring_solid(P['band'], 8.95, 9.25, cy - 0.35, cy + 0.35, 40, m=T(cx, 0, cz))
        legs = []
        for k in range(8):
            a = k / 8 * TAU + 0.2
            lx, lz = cx + math.cos(a) * 9.15, cz + math.sin(a) * 9.15
            legs.append((lx, lz))
            box_at(P['band'], (lx - 0.32, 0.0, lz - 0.32), (lx + 0.32, cy, lz + 0.32), c=0.05)
            box_at(P['concrete'], (lx - 0.8, 0.0, lz - 0.8), (lx + 0.8, 0.5, lz + 0.8), c=0.06)
        for k in range(8):
            (xa, za), (xb, zb) = legs[k], legs[(k + 1) % 8]
            beam(P['band'], (xa, 1.2, za), (xb, cy - 2.5, zb), 0.16)
            beam(P['band'], (xb, 1.2, zb), (xa, cy - 2.5, za), 0.16)

    # Launch mount behind the right lane: six tapered legs, the ring table with its bore, clamps and the
    # water-cooled steel plate on the ground.
    om = T(-30.0, 0.0, -70.0)
    for i in range(6):
        a = i / 6 * TAU
        mm = om @ T(math.cos(a) * 11, 0, math.sin(a) * 11) @ RY(-a)
        box_at(P['concrete'], (-1.6, 0.0, -1.6), (1.6, 1.0, 1.6), mm, c=0.1)
        prism(P['concrete'], [(-1.3, -1.3), (1.3, -1.3), (1.3, 1.3), (-1.3, 1.3)], 1.0, 16.6, mm)
        box_at(P['concrete'], (-1.75, 16.6, -1.75), (1.75, 17.75, 1.75), mm, c=0.12)
    ring_solid(P['mountSteel'], 5.2, 14.0, 17.75, 22.25, 64, c=0.25, m=om, refine=1.0)
    ring_solid(P['mountSteel'], 13.6, 14.25, 19.6, 20.4, 64, m=om)
    lathe(P['dark'], [[(5.18, 17.8), (5.18, 22.2)]], 32, om)
    for i in range(20):
        a = i / 20 * TAU
        box(P['mountSteel'], (1.2, 2.2, 2.0), om @ T(math.cos(a) * 6.2, 23.35, math.sin(a) * 6.2) @ RY(-a), c=0.12)
    disc(P['dark'], 8.5, 48, 0.14, om, up=True, rings=8)
    ring_solid(P['mountSteel'], 8.5, 9.2, 0.0, 0.55, 48, c=0.08, m=om)
    return P


# ---------------------------------------------------------------- Blender scene, AO bake, export, previews

PREVIEW = {
    'steel': ((0.62, 0.63, 0.65), 1.0, 0.3), 'darkSteel': ((0.05, 0.05, 0.055), 0.85, 0.55),
    'soot': ((0.012, 0.011, 0.01), 0.6, 0.85), 'fin': ((0.26, 0.27, 0.29), 0.9, 0.42),
    'pin': ((0.5, 0.51, 0.54), 0.9, 0.35), 'dome': ((0.26, 0.28, 0.31), 0.85, 0.6),
    'inner': ((0.007, 0.007, 0.008), 0.4, 0.9), 'bell': ((0.025, 0.024, 0.023), 0.9, 0.45),
    'throat': ((0.0, 0.0, 0.0), 0.0, 1.0), 'lattice': ((0.11, 0.12, 0.13), 0.75, 0.5),
    'arm': ((0.34, 0.36, 0.39), 0.6, 0.42), 'carriage': ((0.16, 0.17, 0.19), 0.7, 0.45),
    'concrete': ((0.18, 0.17, 0.16), 0.0, 0.9), 'pad': ((0.012, 0.012, 0.013), 0.1, 0.7),
    'tankSteel': ((0.46, 0.48, 0.51), 1.0, 0.34), 'band': ((0.1, 0.11, 0.12), 0.9, 0.5),
    'insulated': ((0.26, 0.25, 0.24), 0.0, 0.82), 'mountSteel': ((0.27, 0.29, 0.31), 0.6, 0.5),
    'dark': ((0.004, 0.004, 0.004), 0.0, 1.0), 'tiles': ((0.025, 0.025, 0.027), 0.0, 0.7),
}
NO_AO = {'throat'}  # the game tints the throat discs every frame, so they keep a plain material
AO = 'AO'
_mats = {}


def preview_material(role):
    """Preview-render material for a role; its base color is multiplied by the baked AO."""
    if role in _mats:
        return _mats[role]
    color, metal, rough = PREVIEW[role]
    mat = bpy.data.materials.new(role)
    try:
        mat.use_nodes = True
    except AttributeError:
        pass
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if role == 'throat':
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.45, 0.12, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 3.0
    else:
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = AO
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        mul.inputs['A'].default_value = (*color, 1.0)
        nt.links.new(attr.outputs['Color'], mul.inputs['B'])
        nt.links.new(mul.outputs['Result'], bsdf.inputs['Base Color'])
    if role in ('bell',):
        mat.use_backface_culling = False
    _mats[role] = mat
    return mat


def to_blender_coords(p):
    return (p[0], -p[2], p[1])


def make_object(name, role, geo, coll, parent):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender_coords(p) for p in geo.verts], [], geo.faces)
    mesh.polygons.foreach_set('use_smooth', geo.smooth)
    if geo.uvs is not None:
        layer = mesh.uv_layers.new(name='UVMap')
        flat = [c for face in geo.uvs for uv in face for c in uv]
        layer.data.foreach_set('uv', flat)
    if role not in NO_AO:
        mesh.color_attributes.active_color = mesh.color_attributes.new(AO, 'FLOAT_COLOR', 'POINT')
    mesh.update()
    mesh.materials.append(preview_material(role))
    obj = bpy.data.objects.new(name, mesh)
    obj['role'] = role
    coll.objects.link(obj)
    obj.parent = parent
    return obj


def make_group(coll_name, groups):
    """groups: [(empty_name, {role: Geo})]. Returns the collection."""
    coll = bpy.data.collections.new(coll_name)
    bpy.context.scene.collection.children.link(coll)
    for empty_name, geos in groups:
        empty = bpy.data.objects.new(empty_name, None)
        coll.objects.link(empty)
        for role, geo in geos.items():
            if geo.faces:
                make_object(f'{empty_name}_{role}', role, geo, coll, empty)
    return coll


def meshes_of(empty_name):
    return [o for o in bpy.data.objects[empty_name].children if o.type == 'MESH' and o['role'] not in NO_AO]


def profile_normals(obj, prof):
    """Gives every vertex of the ship's steel the normal of the hull profile under it, so the raised weld seams
    show in the silhouette and the AO without banding the reflections."""
    me = obj.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    normals = []
    for bx, by, bz in co.reshape(-1, 3):
        x, y, z = bx, bz, -by  # Blender (x, -z, y) back to three.js axes
        nr, ny = prof.normal(prof.s_at_y(y)) if y > SHIP_NOSE_BASE else (1.0, 0.0)
        t = math.atan2(x, z)
        normals.append(to_blender_coords((nr * math.sin(t), ny, nr * math.cos(t))))
    me.normals_split_custom_set_from_vertices(normals)


def occluder(name, lo, hi):
    """Temporary box (three.js axes) that shades a bake and is never exported."""
    g = Geo()
    box_at(g, lo, hi, cuts={0: [], 1: [], 2: []})
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender_coords(p) for p in g.verts], [], g.faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bake_ao(objs, distance, occluders=(), samples=512, strength=0.85, white=0.92):
    """Bakes Cycles ambient occlusion into the AO color attribute of objs with only objs and occluders in the
    render, then maps it to ao' = 1 - strength * (1 - min(1, ao / white)): open surfaces, whose vertices still
    see a few percent of occlusion from weld seams and bevels, come out white. Removes the occluders afterwards."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = False
    if not scene.world:
        scene.world = bpy.data.worlds.new('bake')
    scene.world.light_settings.distance = distance
    visible = set(objs) | set(occluders)
    for o in scene.objects:
        o.hide_render = o.type == 'MESH' and o not in visible
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    for o in objs:
        attr = o.data.color_attributes[AO]
        buf = np.empty(len(attr.data) * 4, dtype=np.float32)
        attr.data.foreach_get('color', buf)
        v = 1.0 - strength * (1.0 - np.clip(buf[0::4] / white, 0.0, 1.0))
        buf[0::4] = v
        buf[1::4] = v
        buf[2::4] = v
        buf[3::4] = 1.0
        attr.data.foreach_set('color', buf)
        print(f'  AO {o.name}: mean {v.mean():.3f}, min {v.min():.3f}')
    for o in occluders:
        bpy.data.objects.remove(o)
    for o in scene.objects:
        o.hide_render = False


def bake_all():
    ground = lambda: occluder('ground', (-600, -2.0, -600), (600, 0.0, 600))
    bake_ao(meshes_of('booster'), 2.5)
    bake_ao(meshes_of('ship'), 2.5)
    bake_ao(meshes_of('towerStatic'), 4.0, [ground()])
    # The carriage rides up and down the tower, so only the continuous columns and rails shade it.
    cols = [occluder(f'col{i}', (x - 0.75, -60, z - 0.75), (x + 0.75, 60, z + 0.75))
            for i, (x, z) in enumerate(((-HM, -HM), (HM, -HM), (HM, HM), (-HM, HM)))]
    rails = [occluder(f'rail{z}', (-7.95, -60, z - 0.45), (-7.05, 60, z + 0.45)) for z in (-4.2, 4.2)]
    bake_ao(meshes_of('carriage'), 3.0, cols + rails)
    # The arm truss is open: a short reach keeps it to contact shadows at the joints.
    bake_ao(meshes_of('arm'), 1.5, strength=0.75)
    bake_ao(meshes_of('props'), 5.0, [ground()])


def export_collection(coll, path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in coll.all_objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_extras=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_animations=False, export_cameras=False, export_lights=False,
    )


def report(name, groups):
    total = 0
    for empty_name, geos in groups:
        for role, geo in geos.items():
            if geo.faces:
                print(f'  {name}/{empty_name}/{role}: {geo.tris():,} tris, {len(geo.verts):,} verts')
                total += geo.tris()
    print(f'{name}: {total:,} triangles')


def look_at_camera(name, pos3, target3, lens=50.0):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.clip_start = 0.5
    cam_data.clip_end = 5000
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    p = Vector(to_blender_coords(pos3))
    t = Vector(to_blender_coords(target3))
    cam.location = p
    cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
    return cam


def setup_preview_scene():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = 'AgX'
    except TypeError:
        pass
    scene.eevee.taa_render_samples = 24
    world = bpy.data.worlds.new('preview') if not scene.world else scene.world
    scene.world = world
    try:
        world.use_nodes = True
    except AttributeError:
        pass
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (0.16, 0.11, 0.08, 1)
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (0.012, 0.016, 0.03, 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    for name, d, e, col in (('moon', (-0.42, 0.36, -0.83), 2.2, (0.8, 0.85, 1.0)), ('flood', (0.55, 0.35, 0.75), 3.5, (1.0, 0.8, 0.6))):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = e
        ld.color = col
        ld.angle = rad(1.0)
        lo = bpy.data.objects.new(name, ld)
        scene.collection.objects.link(lo)
        dv = Vector(to_blender_coords(d)).normalized()
        lo.rotation_euler = (-dv).to_track_quat('-Z', 'Y').to_euler()


def render_views(collections, views, out_dir):
    scene = bpy.context.scene
    for name, coll_name, pos, target, lens in views:
        for c in bpy.data.collections:
            c.hide_render = c.name != coll_name
        cam = look_at_camera('cam_' + name, pos, target, lens)
        scene.camera = cam
        scene.render.filepath = f'{out_dir}/{name}.png'
        bpy.ops.render.render(write_still=True)
        print('rendered', scene.render.filepath)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--render', default=None)
    ap.add_argument('--views', default='all')
    ap.add_argument('--blend', default=None)
    ap.add_argument('--no-bake', action='store_true', help='skip the AO bake (fast geometry iterations)')
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)

    booster = [('booster', build_booster())]
    ship = [('ship', build_ship())]
    s, c, a = build_tower()
    tower = [('towerStatic', s), ('carriage', c), ('arm', a)]
    props = [('props', build_props())]
    models = (('booster', booster), ('ship', ship), ('tower', tower), ('props', props))
    for name, groups in models:
        report(name, groups)

    colls = {name: make_group(name, groups) for name, groups in models}
    profile_normals(bpy.data.objects['ship_steel'], ship_profile())
    if not args.no_bake:
        bake_all()
    for name in colls:
        export_collection(colls[name], f'{args.out}/{name}.glb')

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)

    if args.render:
        setup_preview_scene()
        # Preview placement: carriage at a catch height and one arm closed on the near side, like the game.
        car_obj = bpy.data.objects['carriage']
        car_obj.location = to_blender_coords((0, 92.0, 0))
        arm_obj = bpy.data.objects['arm']
        arm_obj.location = to_blender_coords((PIVOT_X, 92.0, ARM_Z))
        arm_obj.rotation_euler = (0, 0, math.pi)
        views = [
            ('booster_side', 'booster', (0, -20, 150), (0, -27, 0), 35),
            ('booster_top', 'booster', (16, 9, 20), (0, 5, 0), 50),
            ('booster_fins_below', 'booster', (10, -12, 14), (0, 3, 0), 40),
            ('booster_engines', 'booster', (9, -78, 12), (0, -66, 0), 40),
            ('ship_side', 'ship', (-30, -6, 110), (0, -10, 0), 35),
            ('ship_windward', 'ship', (110, -6, 30), (0, -10, 0), 35),
            ('ship_nose', 'ship', (16, 12, 24), (0, 7, 0), 40),
            ('ship_aft', 'ship', (22, -30, 26), (0, -27, 0), 40),
            ('ship_engines', 'ship', (8, -45, 10), (0, -34, 0), 40),
            ('tower_full', 'tower', (60, 70, 330), (0, 80, 0), 35),
            ('tower_carriage', 'tower', (-30, 86, 34), (-14, 90, 0), 40),
            ('tower_top', 'tower', (30, 160, 40), (0, 150, 0), 35),
            ('tower_base', 'tower', (-30, 12, 40), (0, 8, 0), 40),
            ('props_farm', 'props', (-140, 30, -150), (-160, 10, -270), 30),
            ('props_mount', 'props', (0, 18, -20), (-30, 14, -70), 35),
        ]
        if args.views != 'all':
            keep = set(args.views.split(','))
            views = [v for v in views if v[0] in keep]
        render_views(colls, views, args.render)


main()


