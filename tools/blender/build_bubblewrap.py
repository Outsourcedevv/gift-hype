# Builds Bubble Wrap's 3D models in Blender and exports them as .glb into public/models.
#   blender -b --python tools/blender/build_bubblewrap.py -- public/models
# Blender is Z-up with the models facing +Y; the glTF export turns that into the game's Y-up, facing -Z.
# Sizes are in metres (a bubble is 0.5 m apart on the sheet; the sheet is 500 m across).
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'public/models'
os.makedirs(OUT, exist_ok=True)
random.seed(7)


# ---------------------------------------------------------------- helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name, hexc, rough=0.5, metal=0.0, emit=None, strength=3.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    h = hexc.lstrip('#')
    rgb = [lin(int(h[i:i + 2], 16)) for i in (0, 2, 4)]
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        e = emit.lstrip('#')
        b.inputs['Emission Color'].default_value = (*[lin(int(e[i:i + 2], 16)) for i in (0, 2, 4)], 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def finish(o, m=None, bevel=0.0, segs=2, smooth=True, angle=40):
    if m:
        o.data.materials.clear()
        o.data.materials.append(m)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = 'ANGLE'
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
        if hasattr(o.data, 'use_auto_smooth'):
            o.data.use_auto_smooth = True
            o.data.auto_smooth_angle = math.radians(angle)
    return o


def apply_mods(o):
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def box(name, size, loc, m=None, bevel=0.02, segs=2, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, m, bevel, segs)


def cyl(name, r, depth, loc, m=None, rot=(0, 0, 0), verts=24, bevel=0.0, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    return finish(o, m, bevel, angle=35)


def sphere(name, r, loc, m=None, segs=16, rings=8, scale=(1, 1, 1), ico=0):
    if ico:
        bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=loc, subdivisions=ico)
    else:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segs, ring_count=rings)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, m)


def torus(name, R, r, loc, m=None, rot=(0, 0, 0), maj=32, mi=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=maj, minor_segments=mi)
    o = bpy.context.active_object
    o.name = name
    return finish(o, m)


def text(name, s, loc, size, m, depth=0.05, rot=(math.pi / 2, 0, 0), align='CENTER'):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = s
    cu.size = size
    cu.extrude = depth
    cu.align_x = align
    cu.align_y = 'CENTER'
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    o.data.materials.clear()
    o.data.materials.append(m)
    return o


def revolve(name, profile, m, axis='X', loc=(0, 0, 0), steps=40):
    """A lathe: profile = [(along, radius), ...] turned round the axis."""
    bm = bmesh.new()
    rings = []
    for k in range(steps):
        a = k / steps * math.pi * 2
        ring = []
        for (u, r) in profile:
            if axis == 'X':
                ring.append(bm.verts.new((u, math.cos(a) * r, math.sin(a) * r)))
            else:
                ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, u)))
        rings.append(ring)
    for k in range(steps):
        r0, r1 = rings[k], rings[(k + 1) % steps]
        for i in range(len(profile) - 1):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
    # caps
    for idx in (0, len(profile) - 1):
        if profile[idx][1] > 0.0001:
            f = [rings[k][idx] for k in range(steps)]
            bm.faces.new(f if idx == len(profile) - 1 else list(reversed(f)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    return finish(o, m, angle=50)


def join(name, objs):
    objs = [o for o in objs if o]
    for o in objs:
        apply_mods(o)
    with bpy.context.temp_override(active_object=objs[0], selected_objects=objs, selected_editable_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    o = objs[0]
    o.name = name
    return o


def origin_at(o, point):
    """Moves an object's origin to point (world), keeping the mesh where it is."""
    off = Vector(point) - o.location
    o.data.transform(Matrix.Translation(-off))
    o.location = Vector(point)


def export(fname):
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format='GLB', use_selection=False,
                              export_apply=True, export_yup=True, export_materials='EXPORT', export_cameras=False, export_lights=False)
    print('exported', fname)


# ---------------------------------------------------------------- materials (shared names)
def M():
    return dict(
        yellow=mat('Yellow', '#ffc21a', 0.35), dark=mat('Dark', '#262a31', 0.6), steel=mat('Steel', '#9aa3ad', 0.25, 0.85),
        darksteel=mat('DarkSteel', '#5a626b', 0.35, 0.8), rubber=mat('Rubber', '#141518', 0.9), black=mat('Black', '#0e0f12', 0.5),
        glass=mat('Glass', '#a9e4ff', 0.05, 0.1), light=mat('Lamp', '#fff6d8', 0.2, emit='#fff1c4', strength=6),
        orange=mat('Beacon', '#ff8a1a', 0.3, emit='#ff7a00', strength=8), red=mat('RedLight', '#ff2a2a', 0.3, emit='#ff1a1a', strength=5),
        seat=mat('Seat', '#1f2328', 0.8), chrome=mat('Chrome', '#e6ebf0', 0.08, 1.0),
    )


# ---------------------------------------------------------------- the bubbles
def build_bubbles():
    reset()
    m = mat('Bubble', '#a8d4f7', 0.05)
    # a full bubble: a dome with a soft shoulder, sitting on a little flat collar
    prof = []
    for k in range(9):
        a = k / 8 * math.pi / 2
        prof.append((math.sin(a) * 0.205 * (0.62 + 0.38 * (1 - k / 8) ** 4 * 0), math.cos(a) * 0.205))
    bm = bmesh.new()
    seg, rings = 12, 4
    top = bm.verts.new((0, 0, 0.128))
    ringsv = []
    for i in range(1, rings + 1):
        t = i / rings
        a = t * math.pi / 2
        r = math.sin(a) * 0.2
        z = math.cos(a) * 0.128 + 0.004
        ringsv.append([bm.verts.new((math.cos(s / seg * math.tau) * r, math.sin(s / seg * math.tau) * r, z)) for s in range(seg)])
    collar = [bm.verts.new((math.cos(s / seg * math.tau) * 0.228, math.sin(s / seg * math.tau) * 0.228, 0.0)) for s in range(seg)]
    ringsv.append(collar)
    for s in range(seg):
        bm.faces.new((top, ringsv[0][s], ringsv[0][(s + 1) % seg]))
    for i in range(len(ringsv) - 1):
        for s in range(seg):
            bm.faces.new((ringsv[i][s], ringsv[i + 1][s], ringsv[i + 1][(s + 1) % seg], ringsv[i][(s + 1) % seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('Bubble'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Bubble', me); bpy.context.collection.objects.link(o); finish(o, m, angle=80)
    # a popped one: flat, crumpled, with creases
    bm = bmesh.new()
    pts = [bm.verts.new((0, 0, 0.012))]
    rings2 = []
    for i, rr in enumerate((0.07, 0.14, 0.2)):
        ring = []
        for s in range(14):
            a = s / 14 * math.tau + i * 0.2
            r = rr * (0.85 + random.random() * 0.3)
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0.003 + random.random() * (0.016 - i * 0.004))))
        rings2.append(ring)
    for s in range(14):
        bm.faces.new((pts[0], rings2[0][s], rings2[0][(s + 1) % 14]))
    for i in range(2):
        for s in range(14):
            bm.faces.new((rings2[i][s], rings2[i + 1][s], rings2[i + 1][(s + 1) % 14], rings2[i][(s + 1) % 14]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('Popped'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Popped', me); bpy.context.collection.objects.link(o); finish(o, mat('Popped', '#c2ccd5', 0.85), smooth=False)
    export('bubbles.glb')


# ---------------------------------------------------------------- your hand (first person)
def build_hand():
    reset()
    skin, sleeve, cuff, nail = mat('Skin', '#f0c09c', 0.55), mat('Sleeve', '#7c5cff', 0.7), mat('Cuff', '#5a3fe0', 0.8), mat('Nail', '#f7d9cc', 0.3)
    parts = []
    palm = box('Palm', (0.085, 0.095, 0.03), (0, 0, 0), skin, bevel=0.012, segs=3)
    parts.append(palm)
    # four fingers, each three bones, curling slightly
    for k, (x, ln) in enumerate([(-0.031, 0.075), (-0.010, 0.085), (0.011, 0.08), (0.031, 0.062)]):
        y, z, ang = 0.048, 0, 0
        for b, seg in enumerate((0.42, 0.33, 0.25)):
            L = ln * seg
            ang += 0.18
            cy = y + math.cos(ang) * L / 2
            cz = z - math.sin(ang) * L / 2
            c = cyl(f'F{k}{b}', 0.0105 - b * 0.0012, L, (x, cy, cz), skin, rot=(math.pi / 2 - ang, 0, 0), verts=12)
            parts.append(c)
            parts.append(sphere(f'K{k}{b}', 0.0108 - b * 0.0012, (x, y, z), skin, segs=10, rings=6))
            y += math.cos(ang) * L
            z -= math.sin(ang) * L
        parts.append(sphere(f'Tip{k}', 0.0095, (x, y, z), skin, segs=10, rings=6))
        parts.append(box(f'Nail{k}', (0.012, 0.012, 0.003), (x, y - 0.004, z + 0.008), nail, bevel=0.002))
    # thumb
    parts.append(cyl('Thumb1', 0.013, 0.04, (-0.052, 0.005, -0.004), skin, rot=(math.pi / 2, 0, 0.8), verts=12))
    parts.append(cyl('Thumb2', 0.0115, 0.032, (-0.068, 0.03, -0.006), skin, rot=(math.pi / 2, 0, 0.35), verts=12))
    parts.append(sphere('ThumbTip', 0.0115, (-0.074, 0.046, -0.006), skin, segs=10, rings=6))
    hand = join('Hand', parts)
    # the arm: sleeve and cuff
    arm = cyl('Sleeve', 0.05, 0.36, (0, -0.24, 0), sleeve, rot=(math.pi / 2, 0, 0), verts=20, r2=0.042)
    c = cyl('Cuff', 0.047, 0.04, (0, -0.07, 0), cuff, rot=(math.pi / 2, 0, 0), verts=20)
    wrist = cyl('Wrist', 0.034, 0.05, (0, -0.045, 0), skin, rot=(math.pi / 2, 0, 0), verts=16)
    for o in (arm, c, wrist):
        apply_mods(o)
    export('hand.glb')


# ---------------------------------------------------------------- boots
def build_boots():
    reset()
    pink, white, lace, dark = mat('BootPink', '#ff4f8b', 0.55), mat('BootWhite', '#f4f4f6', 0.6), mat('Lace', '#ffffff', 0.7), mat('BootDark', '#3a1222', 0.6)
    for side, nm in ((-1, 'BootL'), (1, 'BootR')):
        x = side * 0.13
        parts = []
        sole = box('Sole', (0.13, 0.32, 0.035), (x, 0.06, 0.018), white, bevel=0.016, segs=3)
        parts.append(sole)
        tread = box('Tread', (0.12, 0.30, 0.008), (x, 0.06, 0.003), dark, bevel=0.004)
        parts.append(tread)
        upper = box('Upper', (0.118, 0.24, 0.085), (x, 0.03, 0.075), pink, bevel=0.035, segs=4)
        parts.append(upper)
        toe = sphere('Toe', 0.06, (x, 0.165, 0.055), pink, segs=16, rings=8, scale=(1.0, 0.9, 0.62))
        parts.append(toe)
        cap = sphere('ToeCap', 0.061, (x, 0.172, 0.045), white, segs=16, rings=8, scale=(1.0, 0.85, 0.45))
        parts.append(cap)
        ankle = cyl('Ankle', 0.058, 0.13, (x, -0.04, 0.17), pink, verts=20, bevel=0.01)
        parts.append(ankle)
        collar = torus('Collar', 0.056, 0.012, (x, -0.04, 0.235), white, maj=20, mi=8)
        parts.append(collar)
        tongue = box('Tongue', (0.06, 0.03, 0.12), (x, 0.03, 0.17), white, bevel=0.012, rot=(-0.35, 0, 0))
        parts.append(tongue)
        for k in range(4):
            parts.append(box(f'Lace{k}', (0.075, 0.008, 0.006), (x, 0.09 - k * 0.032, 0.122 + k * 0.012), lace, bevel=0.002, rot=(-0.3, 0, 0)))
        stripe = box('Stripe', (0.122, 0.12, 0.012), (x, 0.0, 0.09), white, bevel=0.005, rot=(0, 0, 0))
        parts.append(stripe)
        b = join(nm, parts)
        origin_at(b, (x, 0, 0))
    export('boots.glb')


# ---------------------------------------------------------------- rolling pin
def build_pin():
    reset()
    wood, dark = mat('Wood', '#e2ad72', 0.45), mat('WoodDark', '#9a5a2a', 0.5)
    prof = [(-0.7, 0.0), (-0.7, 0.085), (-0.69, 0.097), (-0.66, 0.1), (0.66, 0.1), (0.69, 0.097), (0.7, 0.085), (0.7, 0.0)]
    body = revolve('Drum', prof, wood, 'X', (0, 0.9, 0.1))
    rings = []
    for u in (-0.5, 0.5):
        rings.append(revolve(f'Band{u}', [(u - 0.02, 0.1005), (u + 0.02, 0.1005)], dark, 'X', (0, 0.9, 0.1)))
    body = join('Drum', [body] + rings)
    for s in (-1, 1):
        h = revolve(f'Handle{s}', [(0, 0.0), (0, 0.03), (0.04, 0.034), (0.2, 0.034), (0.26, 0.042), (0.29, 0.03), (0.3, 0.0)], dark, 'X', (s * 0.7, 0.9, 0.1))
        if s < 0:
            h.scale = (-1, 1, 1)
            bpy.context.view_layer.objects.active = h
            with bpy.context.temp_override(object=h, active_object=h, selected_objects=[h], selected_editable_objects=[h]):
                bpy.ops.object.transform_apply(scale=True)
    export('pin.glb')


# ---------------------------------------------------------------- lawn roller
def build_roller():
    reset()
    m = M()
    green, greenD = mat('RollerGreen', '#3cc46a', 0.35), mat('RollerGreenDark', '#1f7a3e', 0.45)
    cy, cz = 1.7, 0.33
    prof = [(-1.26, 0.0), (-1.26, 0.25), (-1.25, 0.31), (-1.22, 0.33), (1.22, 0.33), (1.25, 0.31), (1.26, 0.25), (1.26, 0.0)]
    drum = revolve('Drum', prof, green, 'X', (0, cy, cz))
    bands = [revolve(f'B{k}', [(-1.0 + k * 0.5 - 0.03, 0.332), (-1.0 + k * 0.5 + 0.03, 0.332)], greenD, 'X', (0, cy, cz)) for k in range(5)]
    caps = [cyl(f'Cap{s}', 0.12, 0.04, (s * 1.28, cy, cz), m['darksteel'], rot=(0, math.pi / 2, 0), verts=20) for s in (-1, 1)]
    drum = join('Drum', [drum] + bands + caps)
    # the frame: side plates, arms back to a crossbar, the handle up to your hands
    parts = []
    for s in (-1, 1):
        parts.append(box(f'Plate{s}', (0.03, 0.22, 0.22), (s * 1.33, cy, cz), m['darksteel'], bevel=0.01))
        a = Vector((s * 1.33, cy - 0.08, cz + 0.05)); b = Vector((s * 0.25, cy - 0.6, cz + 0.12))
        d = b - a
        parts.append(cyl(f'Arm{s}', 0.022, d.length, (a + b) / 2, m['darksteel'], rot=Vector((0, 0, 1)).rotation_difference(d).to_euler(), verts=10))
    parts.append(cyl('Cross', 0.025, 0.55, (0, cy - 0.6, cz + 0.12), m['darksteel'], rot=(0, math.pi / 2, 0), verts=10))
    a = Vector((0, cy - 0.6, cz + 0.12)); b = Vector((0, 0.42, 1.0))
    d = b - a
    parts.append(cyl('Handle', 0.022, d.length, (a + b) / 2, m['darksteel'], rot=Vector((0, 0, 1)).rotation_difference(d).to_euler(), verts=10))
    parts.append(cyl('Grip', 0.03, 0.55, (0, 0.42, 1.0), m['rubber'], rot=(0, math.pi / 2, 0), verts=14, bevel=0.01))
    parts.append(box('Scraper', (2.5, 0.03, 0.05), (0, cy + 0.36, cz - 0.15), m['darksteel'], bevel=0.008))
    join('Frame', parts)
    export('roller.glb')


# ---------------------------------------------------------------- the steamroller
def build_steamroller():
    reset()
    m = M()
    Y, D, S = m['yellow'], m['dark'], m['steel']
    stripeY, stripeB = mat('StripeY', '#ffd21a', 0.4), mat('StripeB', '#111111', 0.5)
    body = []
    # chassis and articulation joint
    body.append(box('Chassis', (1.5, 4.8, 0.45), (0, -0.4, 0.85), D, bevel=0.04))
    body.append(cyl('Joint', 0.28, 0.7, (0, 0.55, 1.05), m['darksteel'], verts=20, bevel=0.02))
    # front: hood with grille, headlights and vents
    # (low, so from the cab you see the drum and the bubbles right in front of it)
    body.append(box('Hood', (2.2, 1.9, 0.7), (0, 1.3, 1.2), Y, bevel=0.09, segs=3))
    body.append(box('HoodTop', (1.9, 1.6, 0.06), (0, 1.25, 1.57), Y, bevel=0.03))
    body.append(box('Grille', (1.7, 0.06, 0.36), (0, 2.27, 1.16), D, bevel=0.02))
    for k in range(6):
        body.append(box(f'Slat{k}', (1.6, 0.04, 0.025), (0, 2.31, 1.02 + k * 0.055), m['darksteel'], bevel=0.005))
    for s in (-1, 1):
        body.append(cyl(f'Headlight{s}', 0.1, 0.08, (s * 0.85, 2.27, 1.42), D, rot=(math.pi / 2, 0, 0), verts=20))
        body.append(cyl(f'Lens{s}', 0.08, 0.02, (s * 0.85, 2.32, 1.42), m['light'], rot=(math.pi / 2, 0, 0), verts=20))
        for k in range(4):
            body.append(box(f'Vent{s}{k}', (0.02, 0.5, 0.04), (s * 1.11, 1.2, 1.05 + k * 0.1), D, bevel=0.005))
    # the frame over the drum, with hazard stripes
    for s in (-1, 1):
        body.append(box(f'YokeArm{s}', (0.28, 2.0, 0.34), (s * 2.95, 2.75, 1.05), Y, bevel=0.05))
        body.append(box(f'YokeDrop{s}', (0.28, 0.4, 0.9), (s * 2.95, 3.6, 1.0), Y, bevel=0.05))
        body.append(box(f'Bearing{s}', (0.32, 0.32, 0.32), (s * 2.95, 3.6, 0.95), m['darksteel'], bevel=0.03))
    # hazard stripes down the frame's arms, and a low bar in front of the drum
    for s in (-1, 1):
        for k in range(5):
            body.append(box(f'Haz{s}{k}', (0.02, 0.36, 0.3), (s * 3.1, 2.0 + k * 0.38, 1.05), stripeB if k % 2 else stripeY, bevel=0.0))
    body.append(box('FrontBar', (6.0, 0.18, 0.18), (0, 4.75, 0.7), Y, bevel=0.03))
    for s in (-1, 1):
        body.append(box(f'FrontBarArm{s}', (0.18, 1.0, 0.18), (s * 2.95, 4.3, 0.8), Y, bevel=0.03))
    body.append(box('Scraper', (5.5, 0.06, 0.12), (0, 4.62, 0.35), m['darksteel'], bevel=0.01))
    # cab: floor, roll cage posts, roof with a beacon, seat, steering, dashboard, mirrors
    body.append(box('CabFloor', (2.6, 2.4, 0.2), (0, -0.6, 1.95), D, bevel=0.03))
    body.append(box('CabStep', (0.5, 0.3, 0.06), (-1.45, -0.3, 1.2), m['darksteel'], bevel=0.01))
    body.append(box('CabStep2', (0.5, 0.3, 0.06), (-1.45, -0.3, 0.75), m['darksteel'], bevel=0.01))
    for (x, y) in ((-1.2, 0.5), (1.2, 0.5), (-1.2, -1.75), (1.2, -1.75)):
        body.append(box(f'Post{x}{y}', (0.11, 0.11, 1.75), (x, y, 2.92), D, bevel=0.02))
    body.append(box('Roof', (2.85, 2.65, 0.14), (0, -0.62, 3.83), Y, bevel=0.06, segs=3))
    body.append(box('RoofLip', (2.6, 2.4, 0.08), (0, -0.62, 3.73), D, bevel=0.02))
    body.append(cyl('BeaconBase', 0.12, 0.06, (0.9, -1.4, 3.93), D, verts=16))
    body.append(cyl('Beacon', 0.1, 0.16, (0.9, -1.4, 4.04), m['orange'], verts=16, bevel=0.02))
    body.append(box('SeatBase', (0.62, 0.55, 0.18), (0, -0.85, 2.2), m['seat'], bevel=0.05, segs=3))
    body.append(box('SeatBack', (0.62, 0.14, 0.62), (0, -1.12, 2.55), m['seat'], bevel=0.05, segs=3))
    body.append(box('Console', (0.8, 0.3, 0.32), (0, 0.15, 2.2), D, bevel=0.04))
    body.append(box('Dash', (0.75, 0.06, 0.18), (0, 0.28, 2.4), m['black'], bevel=0.02, rot=(-0.6, 0, 0)))
    for k, c in enumerate(('#5cf08a', '#ffd84a', '#ff5a5a')):
        body.append(cyl(f'Gauge{k}', 0.03, 0.02, (-0.2 + k * 0.2, 0.31, 2.42), mat(f'Gauge{k}', c, 0.3, emit=c, strength=3), rot=(math.pi / 2 - 0.6, 0, 0), verts=16))
    body.append(cyl('Column', 0.03, 0.4, (0, 0.1, 2.45), m['black'], rot=(-0.6, 0, 0), verts=12))
    body.append(torus('Wheel', 0.18, 0.022, (0, 0.0, 2.62), m['black'], rot=(-0.6, 0, 0), maj=28, mi=8))
    body.append(cyl('Lever', 0.015, 0.25, (0.45, -0.55, 2.42), m['chrome'], verts=8))
    body.append(sphere('Knob', 0.035, (0.45, -0.55, 2.56), mat('KnobRed', '#ee3333', 0.4), segs=10, rings=6))
    for s in (-1, 1):
        body.append(cyl(f'MirArm{s}', 0.015, 0.5, (s * 1.45, 0.5, 3.1), m['black'], rot=(0, math.pi / 2, 0), verts=8))
        body.append(box(f'Mirror{s}', (0.04, 0.18, 0.26), (s * 1.7, 0.5, 3.1), m['black'], bevel=0.02))
        body.append(box(f'MirGlass{s}', (0.01, 0.15, 0.22), (s * 1.68 - s * 0.02, 0.5, 3.1), m['chrome'], bevel=0.0))
    # rear: engine with vents and exhaust, lights, the name on the side
    body.append(box('Engine', (2.5, 2.0, 1.5), (0, -2.75, 1.3), Y, bevel=0.1, segs=3))
    body.append(box('EngineTop', (1.9, 1.4, 0.05), (0, -2.75, 2.07), D, bevel=0.01))
    for k in range(8):
        body.append(box(f'TopSlat{k}', (1.8, 0.05, 0.03), (0, -3.35 + k * 0.17, 2.1), m['darksteel'], bevel=0.005))
    for s in (-1, 1):
        body.append(box(f'Tail{s}', (0.3, 0.05, 0.14), (s * 0.95, -3.77, 1.65), m['red'], bevel=0.01))
    body.append(cyl('Exhaust', 0.075, 1.1, (-0.9, -2.3, 2.6), m['darksteel'], verts=14))
    body.append(cyl('ExhaustCap', 0.09, 0.08, (-0.9, -2.3, 3.18), m['black'], verts=14, rot=(0.3, 0, 0)))
    for s in (-1, 1):
        t = text(f'Name{s}', 'UNBOUND', (s * 1.26, -2.75, 1.35), 0.32, m['black'], depth=0.02, rot=(math.pi / 2, 0, s * math.pi / 2))
        body.append(t)
    join('Body', body)
    # the big drum (spins): rim edges, end plates, bolts
    prof = [(-2.8, 0.0), (-2.8, 0.8), (-2.79, 0.93), (-2.76, 0.95), (2.76, 0.95), (2.79, 0.93), (2.8, 0.8), (2.8, 0.0)]
    drum = revolve('Drum', prof, S, 'X', (0, 3.6, 0.95), steps=56)
    plates = []
    for s in (-1, 1):
        plates.append(cyl(f'Plate{s}', 0.62, 0.05, (s * 2.81, 3.6, 0.95), m['darksteel'], rot=(0, math.pi / 2, 0), verts=32))
        plates.append(cyl(f'Hub{s}', 0.22, 0.12, (s * 2.84, 3.6, 0.95), m['dark'], rot=(0, math.pi / 2, 0), verts=20))
        for k in range(8):
            a = k / 8 * math.tau
            plates.append(cyl(f'Bolt{s}{k}', 0.04, 0.05, (s * 2.84, 3.6 + math.cos(a) * 0.45, 0.95 + math.sin(a) * 0.45), m['chrome'], rot=(0, math.pi / 2, 0), verts=8))
    for k in range(10):
        a = k / 10 * math.tau
        plates.append(box(f'Weld{k}', (5.5, 0.04, 0.03), (0, 3.6 + math.cos(a) * 0.952, 0.95 + math.sin(a) * 0.952), m['darksteel'], bevel=0.0, rot=(a, 0, 0)))
    drum = join('Drum', [drum] + plates)
    origin_at(drum, (0, 3.6, 0.95))
    # back wheels (spin): tyres with tread blocks, yellow rims, wheel nuts
    for s, nm in ((-1, 'WheelL'), (1, 'WheelR')):
        x = s * 1.38
        tyre = revolve(nm, [(-0.28, 0.0), (-0.28, 0.5), (-0.26, 0.7), (-0.2, 0.76), (0.2, 0.76), (0.26, 0.7), (0.28, 0.5), (0.28, 0.0)], m['rubber'], 'X', (x, -2.6, 0.76), steps=40)
        parts = [tyre]
        for k in range(22):
            a = k / 22 * math.tau
            parts.append(box(f'Lug{k}', (0.5, 0.12, 0.05), (x, -2.6 + math.cos(a) * 0.775, 0.76 + math.sin(a) * 0.775), m['rubber'], bevel=0.01, rot=(a + math.pi / 2, 0, 0.35 * s * (1 if k % 2 else -1))))
        parts.append(cyl('Rim', 0.42, 0.58, (x, -2.6, 0.76), Y, rot=(0, math.pi / 2, 0), verts=28))
        parts.append(cyl('Cap', 0.16, 0.6, (x, -2.6, 0.76), m['darksteel'], rot=(0, math.pi / 2, 0), verts=16))
        for k in range(6):
            a = k / 6 * math.tau
            parts.append(cyl(f'Nut{k}', 0.03, 0.62, (x, -2.6 + math.cos(a) * 0.25, 0.76 + math.sin(a) * 0.25), m['chrome'], rot=(0, math.pi / 2, 0), verts=6))
        w = join(nm, parts)
        origin_at(w, (x, -2.6, 0.76))
    export('steamroller.glb')


# ---------------------------------------------------------------- the map round the sheet
def build_map():
    reset()
    m = M()
    H = 250  # half the sheet
    white, wood, grey, gravel = mat('FenceWhite', '#f2f2ee', 0.6), mat('FenceWood', '#d9c7a3', 0.7), mat('Rim', '#d6dde3', 0.6), mat('Gravel', '#9a958c', 1.0)
    # a raised rim round the sheet, a gravel path, then a white fence
    rim = []
    for (x, y, sx, sy) in ((0, H + 0.3, 2 * H + 1.2, 0.6), (0, -H - 0.3, 2 * H + 1.2, 0.6), (H + 0.3, 0, 0.6, 2 * H), (-H - 0.3, 0, 0.6, 2 * H)):
        rim.append(box('RimPart', (sx, sy, 0.25), (x, y, 0.1), grey, bevel=0.06))
    join('Rim', rim)
    path = []
    for (x, y, sx, sy) in ((0, H + 4.5, 2 * H + 18, 7), (0, -H - 4.5, 2 * H + 18, 7), (H + 4.5, 0, 7, 2 * H), (-H - 4.5, 0, 7, 2 * H)):
        path.append(box('PathPart', (sx, sy, 0.04), (x, y, 0.0), gravel, bevel=0.0))
    join('Path', path)
    fence = []
    F = H + 9
    for side in range(4):
        for k in range(-int(F // 5), int(F // 5) + 1):
            t = k * 5
            x, y = [(t, F), (F, t), (t, -F), (-F, t)][side]
            fence.append(box('Post', (0.16, 0.16, 1.3), (x, y, 0.65), white, bevel=0.0))
        for z in (0.55, 1.05):
            (x, y, sx, sy) = [(0, F, 2 * F, 0.08), (F, 0, 0.08, 2 * F), (0, -F, 2 * F, 0.08), (-F, 0, 0.08, 2 * F)][side]
            fence.append(box('Rail', (sx, sy, 0.12), (x, y, z), white, bevel=0.0))
    join('Fence', fence)

    # the Bubble Wrap Co. factory, at the far end
    brick, roofm, win, door = mat('Brick', '#b8543c', 0.85), mat('FactoryRoof', '#56606b', 0.6, 0.3), mat('Window', '#ffe6a8', 0.2, emit='#ffd98a', strength=2.5), mat('Door', '#3c444d', 0.6, 0.4)
    fy = F + 70
    fac = []
    fac.append(box('Hall', (150, 46, 20), (0, fy + 23, 10), brick, bevel=0.3))
    for k in range(10):                                   # sawtooth roof
        x0 = -75 + k * 15 + 7.5
        bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=8.6, depth=46, location=(x0, fy + 23, 20 + 4.3), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.active_object; finish(o, roofm, smooth=False); fac.append(o)
    for row in range(2):
        for k in range(18):
            fac.append(box('Win', (5, 0.3, 3), (-68 + k * 8, fy - 0.1, 5 + row * 7), win, bevel=0.05))
    for k in range(4):
        fac.append(box('Dock', (9, 0.4, 7), (-45 + k * 30, fy - 0.15, 3.5), door, bevel=0.1))
        for z in range(7):
            fac.append(box('DockLine', (9, 0.45, 0.06), (-45 + k * 30, fy - 0.2, 0.6 + z * 0.95), m['darksteel'], bevel=0.0))
    for x in (-55, 55):                                    # chimneys with stripes
        fac.append(cyl('Chimney', 2.4, 36, (x, fy + 38, 18), mat('ChimneyGrey', '#d8d8d8', 0.6), verts=24))
        for z in (30, 33):
            fac.append(cyl('ChimneyBand', 2.45, 1.4, (x, fy + 38, z), mat('ChimneyRed', '#d93b3b', 0.5), verts=24))
    sign = box('SignBoard', (70, 1, 9), (0, fy - 1, 24), mat('SignBlue', '#1f4fd1', 0.4), bevel=0.2)
    fac.append(sign)
    fac.append(text('SignText', 'BUBBLE WRAP CO.', (0, fy - 1.6, 24), 6.2, mat('SignWhite', '#ffffff', 0.3, emit='#ffffff', strength=1.5), depth=0.3))
    join('Factory', fac)
    # a box truck at the dock
    truck = []
    truck.append(box('Trailer', (3.2, 12, 4), (-15, fy - 10, 2.6), mat('TruckWhite', '#f5f5f5', 0.5), bevel=0.1))
    truck.append(box('TruckCab', (3.0, 3.2, 3.2), (-15, fy - 18, 2.0), mat('TruckRed', '#e23b3b', 0.35), bevel=0.25, segs=3))
    truck.append(box('Windshield', (2.6, 0.1, 1.2), (-15, fy - 19.62, 2.7), m['glass'], bevel=0.05))
    truck.append(text('TruckText', 'BUBBLE WRAP', (-13.35, fy - 10, 3.0), 1.2, mat('TruckBlue', '#1f4fd1', 0.4), depth=0.05, rot=(math.pi / 2, 0, math.pi / 2)))
    for (y) in (fy - 17.5, fy - 7, fy - 4.5):
        for s in (-1, 1):
            truck.append(cyl('TruckWheel', 0.55, 0.45, (-15 + s * 1.5, y, 0.55), m['rubber'], rot=(0, math.pi / 2, 0), verts=18))
    join('Truck', truck)

    # giant rolls of bubble wrap, and stacks of cardboard boxes
    rollm, rollEnd, card, tape = mat('RollWrap', '#bfe2ff', 0.15), mat('RollCore', '#b48a5a', 0.7), mat('Cardboard', '#c69a63', 0.85), mat('Tape', '#e9d8a6', 0.4)
    rolls = []
    def roll(x, y, z, rot):
        rolls.append(cyl('Roll', 2.6, 7, (x, y, z), rollm, rot=rot, verts=36, bevel=0.15))
        for s in (-1, 1):
            d = Vector((0, 0, 3.52 * s)); d.rotate(Matrix.Rotation(rot[0], 3, 'X') @ Matrix.Rotation(rot[1], 3, 'Y'))
            for rr in (2.2, 1.6, 1.0):
                rolls.append(torus('RollRing', rr, 0.06, (x + d.x, y + d.y, z + d.z), mat('RollRingM', '#93c7f0', 0.2), rot=rot, maj=36, mi=6))
            rolls.append(cyl('RollCore', 0.5, 0.1, (x + d.x, y + d.y, z + d.z), rollEnd, rot=rot, verts=20))
    for (x, y) in ((-95, fy - 22), (-82, fy - 22), (95, fy - 22)):
        roll(x, y, 2.6, (0, math.pi / 2, 0)); roll(x + 6.5 * 0, y, 7.6, (0, math.pi / 2, 0)) if x != 95 else None
    for (x, y, a) in ((F + 22, 80, 0.3), (F + 22, 95, 0.1), (-F - 22, -60, -0.2), (-F - 24, 120, 0.5), (60, -F - 24, 1.2), (-120, -F - 22, 1.5)):
        roll(x, y, 2.6, (math.pi / 2, 0, 0)) if False else roll(x, y, 2.6, (0, math.pi / 2, a))
    join('Rolls', rolls)
    boxes = []
    def stack(x, y, n):
        for k in range(n):
            w, d, h = random.uniform(1.4, 2.2), random.uniform(1.4, 2.2), random.uniform(1.0, 1.6)
            z = 0
            for j in range(random.randint(1, 4)):
                bx, by = x + random.uniform(-0.2, 0.2) + (k % 3) * 2.4, y + random.uniform(-0.2, 0.2) + (k // 3) * 2.4
                rot = (0, 0, random.uniform(-0.15, 0.15))
                boxes.append(box('Box', (w, d, h), (bx, by, z + h / 2), card, bevel=0.03, segs=1, rot=rot))
                boxes.append(box('Tape', (w + 0.01, 0.18, h + 0.01), (bx, by, z + h / 2), tape, bevel=0.0, rot=rot))
                z += h
    for (x, y, n) in ((-60, fy - 25, 6), (40, fy - 25, 6), (F + 16, -40, 5), (-F - 18, 30, 6), (130, -F - 18, 5), (-40, -F - 16, 4), (F + 15, F - 30, 5)):
        stack(x, y, n)
    join('Boxes', boxes)

    # floodlight towers at the corners
    towers = []
    for (x, y) in ((F + 8, F + 8), (-F - 8, F + 8), (F + 8, -F - 8), (-F - 8, -F - 8)):
        for (dx, dy) in ((-0.8, -0.8), (0.8, -0.8), (-0.8, 0.8), (0.8, 0.8)):
            towers.append(cyl('Leg', 0.12, 30, (x + dx, y + dy, 15), mat('Mast', '#c9ced4', 0.4, 0.7), verts=6))
        for z in range(2, 30, 3):
            towers.append(box('Brace', (1.7, 0.08, 0.08), (x, y - 0.8, z), mat('Mast', '#c9ced4', 0.4, 0.7), bevel=0.0, rot=(0, 0.6 if z % 2 else -0.6, 0)))
            towers.append(box('Brace', (0.08, 1.7, 0.08), (x - 0.8, y, z), mat('Mast', '#c9ced4', 0.4, 0.7), bevel=0.0, rot=(0.6 if z % 2 else -0.6, 0, 0)))
        ang = math.atan2(-y, -x)
        panel = box('LampPanel', (5, 0.5, 3), (x, y, 31), m['dark'], bevel=0.1, rot=(0.5, 0, ang - math.pi / 2))
        towers.append(panel)
        for i in range(4):
            for j in range(2):
                ox, oy = math.cos(ang - math.pi / 2) * (-1.8 + i * 1.2), math.sin(ang - math.pi / 2) * (-1.8 + i * 1.2)
                towers.append(cyl('Lamp', 0.45, 0.2, (x + ox + math.cos(ang) * 0.3, y + oy + math.sin(ang) * 0.3, 30.4 + j * 1.2), m['light'], rot=(0.5 + math.pi / 2, 0, ang - math.pi / 2), verts=16))
    join('Towers', towers)

    # a billboard: POP 1,000,000
    bb = []
    by = -F - 40
    for x in (-14, 14):
        bb.append(box('BBLeg', (0.6, 0.6, 12), (x, by, 6), m['darksteel'], bevel=0.05))
    bb.append(box('BBBoard', (36, 1, 12), (0, by, 16), mat('BBPink', '#ff4f8b', 0.4), bevel=0.3))
    bb.append(box('BBFrame', (37, 0.8, 12.8), (0, by + 0.2, 16), mat('BBDark', '#1b2a6b', 0.5), bevel=0.2))
    bb.append(text('BBText', 'POP 1,000,000', (0, by - 0.65, 17), 5.5, mat('BBWhite', '#ffffff', 0.3, emit='#ffffff', strength=1.2), depth=0.2, rot=(math.pi / 2, 0, math.pi)))
    bb.append(text('BBSub', 'BUBBLES', (0, by - 0.65, 12.3), 2.6, mat('BBYellow', '#ffd84a', 0.3), depth=0.15, rot=(math.pi / 2, 0, math.pi)))
    join('Billboard', bb)

    # trees round about (one mesh per colour), and hills on the horizon
    trunkm = mat('Trunk', '#6b4a2e', 0.9)
    leaves = [mat('Leaf1', '#3f8f3a', 0.8), mat('Leaf2', '#4ea544', 0.8), mat('Leaf3', '#2f7a36', 0.8)]
    trunks, crowns = [], {0: [], 1: [], 2: []}
    placed = 0
    while placed < 340:
        a = random.uniform(0, math.tau); r = random.uniform(F + 40, 620)
        x, y = math.cos(a) * r, math.sin(a) * r
        if abs(x) < 110 and y > F + 20 and y < fy + 70:      # not in the factory
            continue
        if abs(x) < 25 and y < -F - 20 and y > -F - 60:       # not in front of the billboard
            continue
        s = random.uniform(0.8, 1.6)
        trunks.append(cyl('Trunk', 0.25 * s, 3 * s, (x, y, 1.5 * s), trunkm, verts=7))
        kind = random.random()
        c = random.randint(0, 2)
        if kind < 0.5:   # round tree
            for j in range(3):
                crowns[c].append(sphere('Crown', (1.6 - j * 0.3) * s, (x + random.uniform(-.6, .6) * s, y + random.uniform(-.6, .6) * s, (3.4 + j * 1.0) * s), leaves[c], ico=1))
        else:            # pine
            for j in range(3):
                crowns[c].append(cyl('Pine', (2.0 - j * 0.5) * s, 2.4 * s, (x, y, (3.2 + j * 1.4) * s), leaves[c], verts=8, r2=0.05))
        placed += 1
    join('Trunks', trunks)
    for c, objs in crowns.items():
        if objs:
            o = join(f'Trees{c}', objs)
            for p in o.data.polygons:
                p.use_smooth = False
    # hills: a ring of low bumps far away
    bm = bmesh.new()
    rings, segs = 6, 96
    vs = []
    for i in range(rings + 1):
        r = 700 + i * 90
        row = []
        for k in range(segs):
            a = k / segs * math.tau
            h = 0 if i in (0,) else (math.sin(a * 5 + i) * 0.5 + 0.5) * (25 + 35 * math.sin(a * 3) ** 2) * min(1, i / 2) + random.uniform(0, 8)
            row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, h - 0.05)))
        vs.append(row)
    for i in range(rings):
        for k in range(segs):
            bm.faces.new((vs[i][k], vs[i][(k + 1) % segs], vs[i + 1][(k + 1) % segs], vs[i + 1][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('Hills'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Hills', me); bpy.context.collection.objects.link(o)
    finish(o, mat('HillGreen', '#5e9c4c', 1.0), smooth=True, angle=60)
    export('map.glb')


for f in (build_bubbles, build_hand, build_boots, build_pin, build_roller, build_steamroller, build_map):
    f()
print('done')
