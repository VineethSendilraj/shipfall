# Imports a raw GLB and prints the mean baked AO (COLOR_0) of each mesh in height bands (game Y).
# blender -b --factory-startup --python ship-ao-bands.py -- <file.glb> [band_m]
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
path = argv[0]
band = float(argv[1]) if len(argv) > 1 else 5.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
for o in bpy.data.objects:
    if o.type != 'MESH' or not o.data.color_attributes:
        continue
    me = o.data
    attr = me.color_attributes[0]
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    mw = np.array(o.matrix_world)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    col = np.empty(len(attr.data) * 4, dtype=np.float32)
    attr.data.foreach_get('color', col)
    ao = col[0::4]
    if attr.domain == 'CORNER':
        vi = np.empty(len(me.loops), dtype=np.int32)
        me.loops.foreach_get('vertex_index', vi)
        y = co[vi, 2]
    else:
        y = co[:, 2]
    lo, hi = np.floor(y.min() / band) * band, y.max()
    rows = []
    b = lo
    while b < hi:
        m = (y >= b) & (y < b + band)
        if m.any():
            rows.append(f'{b:+.0f}:{ao[m].mean():.2f}')
        b += band
    print(f'{o.name} ({attr.domain}, mean {ao.mean():.3f}):', ' '.join(rows))
