import bpy, sys
print("BLENDER", bpy.app.version_string)
op = bpy.ops.export_scene.gltf
props = op.get_rna_type().properties
for p in props:
    if p.identifier in ('rna_type',): continue
    extra = ''
    if p.type == 'ENUM':
        extra = [i.identifier for i in p.enum_items]
    print(p.identifier, p.type, getattr(p, 'default', None), extra)
print("engines", [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items])
print("has set_sharp_from_angle", hasattr(bpy.types.Mesh, 'set_sharp_from_angle'))
