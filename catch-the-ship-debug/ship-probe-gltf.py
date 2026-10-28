import bpy

print('VERSION', bpy.app.version_string)
props = bpy.ops.export_scene.gltf.get_rna_type().properties
for p in props:
    if 'color' in p.identifier.lower() or 'vertex' in p.identifier.lower():
        items = [i.identifier for i in p.enum_items] if p.type == 'ENUM' else ''
        print('EXPORT', p.identifier, p.type, getattr(p, 'default', None), items)
bake = bpy.ops.object.bake.get_rna_type().properties
for p in bake:
    items = [i.identifier for i in p.enum_items] if p.type == 'ENUM' else ''
    print('BAKE', p.identifier, p.type, items)
prefs = bpy.context.preferences.addons['cycles'].preferences
print('DEVTYPES', [i.identifier for i in prefs.bl_rna.properties['compute_device_type'].enum_items])
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    print('DEVICES', [(d.name, d.type) for d in prefs.devices])
except Exception as e:
    print('METAL ERR', e)
w = bpy.data.worlds.new('w')
print('WORLD LS', [p.identifier for p in w.light_settings.bl_rna.properties])
