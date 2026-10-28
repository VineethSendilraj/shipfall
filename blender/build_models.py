"""Builds the Catch the Booster GLB models (booster, tower, props) with bpy.

Run headless from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python blender/build_models.py -- --out <dir> [--render <dir>] [--blend <file.blend>]

Writes <dir>/booster.glb, tower.glb and props.glb uncompressed; blender/build.sh compresses them into
public/models/. Geometry is written in three.js axes (meters, +Y up, +Z toward the default camera) and
rotated into Blender's Z-up on the way in; the glTF exporter rotates it back, so every number here matches
src/three/*.js. Each mesh is named after the game material it takes (custom property `role`, exported as
glTF extras); the GLBs carry no materials.
"""

import argparse
import math
import sys

import bpy
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


def box(g, size, m=IDENT, c=0.0, smooth=False):
    """Box centred on the origin (full sizes), every edge chamfered by c, then transformed by m."""
    h = [s / 2 for s in size]
    faces = []
    if c > 0:
        c = min(c, 0.45 * min(h))
        pts = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    s = (sx, sy, sz)
                    for k in range(3):
                        p = [s[j] * (h[j] - c) for j in range(3)]
                        p[k] = s[k] * h[k]
                        pts.append(tuple(p))

        def vi(s, k):
            return (((s[0] > 0) * 2 + (s[1] > 0)) * 2 + (s[2] > 0)) * 3 + k

        for k in range(3):
            j, l = [a for a in range(3) if a != k]
            for sk in (-1, 1):
                quad = []
                for sj, sl in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    s = [0, 0, 0]
                    s[k], s[j], s[l] = sk, sj, sl
                    quad.append(vi(s, k))
                faces.append(quad)
            for sj in (-1, 1):
                for sl in (-1, 1):
                    s0 = [0, 0, 0]
                    s0[k], s0[j], s0[l] = -1, sj, sl
                    s1 = list(s0)
                    s1[k] = 1
                    faces.append([vi(s0, j), vi(s1, j), vi(s1, l), vi(s0, l)])
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    faces.append([vi((sx, sy, sz), k) for k in range(3)])
    else:
        pts = [(sx * h[0], sy * h[1], sz * h[2]) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]

        def vi(s):
            return ((s[0] > 0) * 2 + (s[1] > 0)) * 2 + (s[2] > 0)

        for k in range(3):
            j, l = [a for a in range(3) if a != k]
            for sk in (-1, 1):
                quad = []
                for sj, sl in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    s = [0, 0, 0]
                    s[k], s[j], s[l] = sk, sj, sl
                    quad.append(vi(s))
                faces.append(quad)
    faces = [orient_to(pts, f, centroid(pts, f)) for f in faces]
    g.add(xf(m, pts), faces, smooth)


def box_at(g, lo, hi, m=IDENT, c=0.0):
    """Box spanning corner lo to corner hi (local coordinates of m)."""
    size = [hi[i] - lo[i] for i in range(3)]
    mid = [(hi[i] + lo[i]) / 2 for i in range(3)]
    box(g, size, m @ T(*mid), c)


def prism(g, poly, y0, y1, m=IDENT, caps=True, smooth=False):
    """Extrudes polygon [(x, z), ...] along local Y from y0 to y1."""
    n = len(poly)
    pts = [(x, y0, z) for x, z in poly] + [(x, y1, z) for x, z in poly]
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sgn = 1.0 if area > 0 else -1.0
    faces = []
    for i in range(n):
        i1 = (i + 1) % n
        dx = poly[i1][0] - poly[i][0]
        dz = poly[i1][1] - poly[i][1]
        faces.append(orient_to(pts, (i, i1, i1 + n, i + n), (sgn * dz, 0.0, -sgn * dx)))
    if caps:
        dirn = 1.0 if y1 > y0 else -1.0
        faces.append(orient_to(pts, range(n), (0.0, -dirn, 0.0)))
        faces.append(orient_to(pts, range(n, 2 * n), (0.0, dirn, 0.0)))
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


def lathe(g, strips, segs, m=IDENT, a0=0.0, a1=TAU, uv_v=None, smooth=True):
    """Revolves profile strips [[(r, y), ...], ...] about +Y with angle t at (r sin t, y, r cos t), like three.js
    CylinderGeometry. A strip listed top to bottom faces outward. Strips share no vertices (hard edges between)."""
    full = abs((a1 - a0) - TAU) < 1e-6
    cols = segs if (full and uv_v is None) else segs + 1
    for strip in strips:
        pts, rows, vuv = [], [], []
        for r, y in strip:
            if r < 1e-7:
                rows.append([len(pts)] * cols)
                pts.append((0.0, y, 0.0))
                vuv.append((0.5, uv_v(y) if uv_v else 0.0))
                continue
            row = []
            for j in range(cols):
                t = a0 + (a1 - a0) * j / segs
                row.append(len(pts))
                pts.append((r * math.sin(t), y, r * math.cos(t)))
                vuv.append((j / segs, uv_v(y) if uv_v else 0.0))
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


def disc(g, r, segs, y=0.0, m=IDENT, up=False, r_in=0.0):
    """Flat disc (or annulus when r_in > 0) facing down, or up when up=True."""
    n_exp = (0.0, 1.0 if up else -1.0, 0.0)
    if r_in > 0:
        lathe(g, [[(r, y), (r_in, y)] if not up else [(r_in, y), (r, y)]], segs, m, smooth=False)
        return
    pts = [(r * math.sin(TAU * j / segs), y, r * math.cos(TAU * j / segs)) for j in range(segs)]
    g.add(xf(m, pts), [orient_to(pts, range(segs), n_exp)], False)


def cyl(g, r, y0, y1, segs, m=IDENT, top=True, bottom=True, r_top=None):
    """Vertical cylinder (optionally tapered) from y0 to y1 with flat caps."""
    rt = r if r_top is None else r_top
    lathe(g, [[(rt, y1), (r, y0)]], segs, m)
    if top:
        disc(g, rt, segs, y1, m, up=True)
    if bottom:
        disc(g, r, segs, y0, m)


def ring_solid(g, r_in, r_out, y0, y1, segs, c=0.0, m=IDENT):
    """Solid annulus with optional chamfer on the two outer edges; each face is its own smoothing strip."""
    if c > 0:
        strips = [[(r_out - c, y1), (r_out, y1 - c)], [(r_out, y1 - c), (r_out, y0 + c)], [(r_out, y0 + c), (r_out - c, y0)],
                  [(r_out - c, y0), (r_in, y0)], [(r_in, y0), (r_in, y1)], [(r_in, y1), (r_out - c, y1)]]
    else:
        strips = [[(r_out, y1), (r_out, y0)], [(r_out, y0), (r_in, y0)], [(r_in, y0), (r_in, y1)], [(r_in, y1), (r_out, y1)]]
    lathe(g, strips, segs, m)


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
    disc(G['soot'], R + 0.1, 96, SHIELD_Y)
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
    for x, z in corners:
        box_at(lat, (x - 0.75, y_base, z - 0.75), (x + 0.75, TOWER_H, z + 0.75), c=0.2)
        # Bolted splice plates on every column face, half way between girts.
        for k in range(1, BAYS // 2):
            y = k * 2 * BAY + BAY / 2
            for nx, nz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                cx, cz = x + nx * 0.78, z + nz * 0.78
                w = (0.06, 0.9, 1.15) if nx else (1.15, 0.9, 0.06)
                box(lat, w, T(cx, y, cz))
    levels = [y_base] + [(i + 1) * BAY for i in range(BAYS)]
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


# ---------------------------------------------------------------- props (src/three/world.js setDressing layout)


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
        lathe(P['tankSteel'], [head + [(r, y0)]], 40, m)
        disc(P['tankSteel'], r, 40, y0, m)
        nb = max(2, int(hgt / 5.5))
        for k in range(1, nb + 1):
            y = y0 + hgt * k / (nb + 1)
            ring_solid(P['band'], r - 0.05, r + 0.09, y - 0.22, y + 0.22, 40, m=m)
        ring_solid(P['band'], r - 0.05, r + 0.12, y1 - 0.5, y1 - 0.05, 40, m=m)
        lathe(P['concrete'], [[(r * 0.97, y0), (r * 1.02, 0.0)]], 40, m)
        disc(P['concrete'], r * 1.25, 24, 0.12, m, up=True)
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
        cyl(P['tankSteel'], rr, -75.0, 75.0, 12, T(-150, yy, zz) @ RZ(rad(90)))

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
    ring_solid(P['mountSteel'], 5.2, 14.0, 17.75, 22.25, 64, c=0.25, m=om)
    ring_solid(P['mountSteel'], 13.6, 14.25, 19.6, 20.4, 64, m=om)
    lathe(P['dark'], [[(5.18, 17.8), (5.18, 22.2)]], 32, om)
    for i in range(20):
        a = i / 20 * TAU
        box(P['mountSteel'], (1.2, 2.2, 2.0), om @ T(math.cos(a) * 6.2, 23.35, math.sin(a) * 6.2) @ RY(-a), c=0.12)
    disc(P['dark'], 8.5, 48, 0.14, om, up=True)
    ring_solid(P['mountSteel'], 8.5, 9.2, 0.0, 0.55, 48, c=0.08, m=om)
    return P


# ---------------------------------------------------------------- Blender scene, export, previews

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
    'dark': ((0.004, 0.004, 0.004), 0.0, 1.0),
}
_mats = {}


def preview_material(role):
    if role in _mats:
        return _mats[role]
    color, metal, rough = PREVIEW[role]
    mat = bpy.data.materials.new(role)
    try:
        mat.use_nodes = True
    except AttributeError:
        pass
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if role == 'throat':
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.45, 0.12, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 3.0
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


def export_collection(coll, path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in coll.all_objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_extras=True,
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
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)

    booster = [('booster', build_booster())]
    s, c, a = build_tower()
    tower = [('towerStatic', s), ('carriage', c), ('arm', a)]
    props = [('props', build_props())]
    report('booster', booster)
    report('tower', tower)
    report('props', props)

    colls = {}
    for name, groups in (('booster', booster), ('tower', tower), ('props', props)):
        colls[name] = make_group(name, groups)
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
            ('tower_full', 'tower', (60, 70, 330), (0, 80, 0), 35),
            ('tower_carriage', 'tower', (-30, 86, 34), (-14, 90, 0), 40),
            ('tower_top', 'tower', (30, 160, 40), (0, 150, 0), 35),
            ('props_farm', 'props', (-140, 30, -150), (-160, 10, -270), 30),
            ('props_mount', 'props', (0, 18, -20), (-30, 14, -70), 35),
        ]
        if args.views != 'all':
            keep = set(args.views.split(','))
            views = [v for v in views if v[0] in keep]
        render_views(colls, views, args.render)


main()
