# Snow Day: builds every 3D model of the game in Blender and saves them as .glb files.
#
#   blender -b --python snowday/blender/make_models.py -- public/snowday/models
#
# Everything is built from shapes with rounded (bevelled) edges and rough, hand-made outlines.
# Blender is Z-up; the .glb files come out Y-up (three.js). A model's front is Blender -Y,
# which is +Z in the game.

import bpy, bmesh, math, os, sys, random

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'public/snowday/models'
os.makedirs(OUT, exist_ok=True)
PI = math.pi


def lin(c):
    """sRGB 0-255 hex -> linear RGB (what Blender's colours are)"""
    c = c.lstrip('#')
    return tuple(((int(c[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(7)


def mat(name, color, emit=0.0, rough=0.85, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    col = lin(color)
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*col, 1)
        b.inputs['Emission Strength'].default_value = emit
    m.diffuse_color = (*col, 1)
    return m


def _finish(m, scale=None, smooth=False):
    o = bpy.context.active_object
    if scale:
        o.scale = scale
    o.data.materials.clear()
    o.data.materials.append(m)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


def bevel(o, width, segments=2):
    """rounds the edges a little so they catch the light (applied straight away, so joining keeps it)"""
    if width <= 0.002:
        return o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = o.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.harden_normals = False
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def box(m, loc, size, rot=(0, 0, 0), round_=True):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = _finish(m, size)
    if round_:
        bevel(o, min(0.035, min(size) * 0.18))
    return o


def cyl(m, loc, r, depth, verts=20, rot=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = _finish(m, smooth=smooth)
    if smooth:
        bevel(o, min(0.02, r * 0.15, depth * 0.15), 2)
    return o


def cone(m, loc, r1, depth, r2=0.0, verts=20, rot=(0, 0, 0), smooth=False):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    return _finish(m, smooth=smooth)


def ball(m, loc, r, scale=None, seg=24, rings=14, smooth=True):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    return _finish(m, scale, smooth)


def jitter(o, amount, seed=0, keep_tip=True):
    """roughens a cone's outline so trees don't look machine-made"""
    rnd = random.Random(seed)
    me = o.data
    zs = [v.co.z for v in me.vertices]
    top = max(zs)
    for v in me.vertices:
        if keep_tip and abs(v.co.z - top) < 1e-4:
            continue
        k = 1 + rnd.uniform(-amount, amount)
        v.co.x *= k
        v.co.y *= k
        v.co.z += rnd.uniform(-amount, amount) * 0.25
    me.update()
    return o


def ring(m, loc, major, minor, rot=(0, 0, 0), seg=24, mseg=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg, minor_segments=mseg,
                                     location=loc, rotation=rot)
    return _finish(m, smooth=True)


def mesh(m, verts, faces, name='part'):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(m)
    return o


def prism(m, w, d, h, z0, x=0.0, y=0.0):
    """a gable roof: ridge along X, slopes to the front (-Y) and back (+Y)"""
    v = [(x - w / 2, y - d / 2, z0), (x + w / 2, y - d / 2, z0), (x + w / 2, y + d / 2, z0), (x - w / 2, y + d / 2, z0),
         (x - w / 2, y, z0 + h), (x + w / 2, y, z0 + h)]
    return mesh(m, v, [(0, 1, 5, 4), (2, 3, 4, 5), (3, 0, 4), (1, 2, 5), (0, 3, 2, 1)], 'roof')


def star(m, loc, r_out, r_in, depth):
    """a puffy 5-point star facing the front (-Y)"""
    x0, y0, z0 = loc
    v = []
    for i in range(10):
        a = PI / 2 + i * PI / 5
        r = r_out if i % 2 == 0 else r_in
        v.append((x0 + r * math.cos(a), y0, z0 + r * math.sin(a)))
    v.append((x0, y0 - depth, z0))
    v.append((x0, y0 + depth, z0))
    f = []
    for i in range(10):
        j = (i + 1) % 10
        f.append((10, i, j))
        f.append((11, j, i))
    return mesh(m, v, f, 'star')


def join_all(name):
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def join(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    return bpy.context.active_object


def save(name):
    join_all(name)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
    print('MODEL', name, os.path.getsize(path), 'bytes')


SNOW = '#f4f8ff'
LIGHT_COLOURS = ['#ff3b3b', '#3bff6a', '#3b8bff', '#ffd23b', '#ff7bff', '#fff2c8']


def snow():
    return mat('snow', SNOW, rough=0.95)


def bulbs():
    return [mat('bulb%d' % i, c, emit=2.0) for i, c in enumerate(LIGHT_COLOURS)]


# ---------------------------------------------------------------- houses
def house(name, w, d, h, wall, roof, trim, roof_h, floors=1):
    reset()
    W, R, T, S = mat('wall', wall), mat('roof', roof), mat('trim', trim), snow()
    stone = mat('stone', '#6b6f78')
    brick = mat('brick', '#8a3b2e')
    glass = mat('window', '#ffc27a', emit=1.3)
    door = mat('door', '#5a3420')
    green = mat('wreath', '#1f6b35')
    red = mat('bow', '#d81f2a')
    gold = mat('gold', '#e8b84a', rough=0.35, metal=0.8)
    B = bulbs()

    box(W, (0, 0, h / 2), (w, d, h))
    box(stone, (0, 0, 0.18), (w + 0.12, d + 0.12, 0.36))
    prism(R, w + 0.6, d + 0.8, roof_h, h)
    prism(S, w + 0.7, d + 0.62, roof_h, h + 0.12)
    # chimney with a snow cap
    box(brick, (w * 0.28, d * 0.18, h + roof_h * 0.62), (0.7, 0.7, roof_h * 1.1))
    box(S, (w * 0.28, d * 0.18, h + roof_h * 1.18), (0.82, 0.82, 0.14))
    # door, wreath, step
    box(door, (0, -d / 2 - 0.04, 1.05), (1.1, 0.1, 2.1))
    box(T, (0, -d / 2 - 0.06, 2.18), (1.35, 0.12, 0.16))
    box(gold, (0.38, -d / 2 - 0.12, 1.05), (0.08, 0.08, 0.08))
    ring(green, (0, -d / 2 - 0.14, 1.55), 0.26, 0.08, rot=(PI / 2, 0, 0), mseg=8)
    ball(red, (0, -d / 2 - 0.2, 1.3), 0.08)
    box(stone, (0, -d / 2 - 0.4, 0.08), (1.6, 0.8, 0.16))

    def window(x, y, z, facing):
        # facing: 'y' = on the front/back wall, 'x' = on a side wall
        if facing == 'y':
            box(glass, (x, y, z), (0.95, 0.07, 0.95))
            box(T, (x, y - 0.02 * (1 if y < 0 else -1), z), (1.1, 0.06, 0.08))
            box(T, (x, y - 0.02 * (1 if y < 0 else -1), z), (0.08, 0.06, 1.1))
            box(T, (x, y, z - 0.55), (1.2, 0.16, 0.08))
            box(S, (x, y, z - 0.5), (1.15, 0.2, 0.06))
        else:
            box(glass, (x, y, z), (0.07, 0.95, 0.95))
            box(T, (x, y, z), (0.1, 1.1, 0.08))
            box(T, (x, y, z), (0.1, 0.08, 1.1))
            box(S, (x, y, z - 0.5), (0.2, 1.15, 0.06))

    rows = [h * 0.42] if floors == 1 else [h * 0.25, h * 0.68]
    for z in rows:
        for x in (-w * 0.3, w * 0.3):
            window(x, -d / 2 - 0.02, z + (0.25 if floors == 1 else 0), 'y')
            window(x, d / 2 + 0.02, z + (0.25 if floors == 1 else 0), 'y')
        for y in (-d * 0.2, d * 0.2):
            window(-w / 2 - 0.02, y, z + 0.25, 'x')
            window(w / 2 + 0.02, y, z + 0.25, 'x')
    if floors > 1:
        window(0, -d / 2 - 0.02, h * 0.68, 'y')

    # corner boards and a band between the floors
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(T, (sx * (w / 2 + 0.01), sy * (d / 2 + 0.01), h / 2 + 0.18), (0.16, 0.16, h - 0.36))
    if floors > 1:
        for sy in (-1, 1):
            box(T, (0, sy * (d / 2 + 0.03), h * 0.47), (w + 0.06, 0.08, 0.14))
    # shutters beside the front windows
    shutter = mat('shutter', '#24453a' if wall != '#2f5e46' else '#5b2a24')
    for z in rows:
        zz = z + (0.25 if floors == 1 else 0)
        for x in (-w * 0.3, w * 0.3):
            for s in (-1, 1):
                box(shutter, (x + s * 0.68, -d / 2 - 0.05, zz), (0.36, 0.05, 1.05))
                for k in range(4):
                    box(shutter, (x + s * 0.68, -d / 2 - 0.085, zz - 0.36 + k * 0.24), (0.3, 0.02, 0.04), round_=False)
    # gutters and downpipes under both eaves
    metal = mat('gutter', '#d9dde2', rough=0.4, metal=0.5)
    for sy in (-1, 1):
        cyl(metal, (0, sy * ((d + 0.8) / 2 + 0.05), h - 0.04), 0.07, w + 0.6, verts=12, rot=(0, PI / 2, 0))
        cyl(metal, (w / 2 + 0.22, sy * ((d + 0.8) / 2 + 0.05) * 0.95, h / 2), 0.045, h, verts=10)
    # a little porch roof over the door, on two posts, with a lantern
    porch_y = -d / 2 - 0.75
    for x in (-0.85, 0.85):
        cyl(T, (x, porch_y - 0.3, 1.25), 0.07, 2.5, verts=12)
    box(R, (0, porch_y + 0.1, 2.55), (2.3, 1.6, 0.12), rot=(-0.22, 0, 0))
    box(S, (0, porch_y + 0.12, 2.65), (2.25, 1.5, 0.08), rot=(-0.22, 0, 0))
    box(mat('lantern', '#ffd890', emit=1.4), (0.75, -d / 2 - 0.12, 1.75), (0.16, 0.16, 0.26))
    # garland along the front eave under the lights
    leaf = mat('garland', '#1d5a34', rough=0.9)
    eave_y = (d + 0.8) / 2 + 0.02
    n = int((w + 0.6) / 0.16)
    for i in range(n + 1):
        t = i / n
        x = -(w + 0.6) / 2 + t * (w + 0.6)
        sag = 0.16 * abs(math.sin(t * PI * 5))
        ball(leaf, (x, -eave_y - 0.02, h - 0.12 - sag), 0.085, seg=8, rings=6, smooth=False)
        if i % 10 == 5:
            ball(red, (x, -eave_y - 0.1, h - 0.2 - sag), 0.07, seg=10, rings=8)

    # string lights along both long eaves, sagging between hooks
    n = int((w + 0.6) / 0.28)
    for side in (-1, 1):
        for i in range(n + 1):
            t = i / n
            x = -(w + 0.6) / 2 + t * (w + 0.6)
            sag = 0.12 * abs(math.sin(t * PI * 5))
            ball(B[i % len(B)], (x, side * eave_y, h - 0.06 - sag), 0.06, seg=10, rings=8)
    save(name)


# ---------------------------------------------------------------- trees
def tier_radius(tiers, z):
    best = 0
    for r, zb, hh in tiers:
        if zb <= z <= zb + hh:
            best = max(best, r * (1 - (z - zb) / hh))
    return best


def big_tree():
    reset()
    bark, leaf, S = mat('bark', '#5b3a22'), mat('leaf', '#165c36', rough=0.9), snow()
    B = bulbs()
    ornaments = [mat('orn_red', '#d4202c', rough=0.25, metal=0.6), mat('orn_gold', '#f0c040', rough=0.25, metal=0.8),
                 mat('orn_blue', '#2c6fe0', rough=0.25, metal=0.6), mat('orn_silver', '#d8dde6', rough=0.2, metal=0.9)]
    gold_star = mat('star', '#ffd75e', emit=2.2, rough=0.3, metal=0.5)
    cyl(bark, (0, 0, 0.6), 0.45, 1.2, verts=10)
    tiers = [(3.3, 0.9, 3.0), (2.7, 2.5, 2.8), (2.1, 4.0, 2.6), (1.5, 5.4, 2.2), (0.9, 6.6, 1.9)]
    for r, zb, hh in tiers:
        jitter(cone(leaf, (0, 0, zb + hh / 2), r, hh, verts=32), 0.1, int(zb * 10))
        jitter(cone(S, (0, 0, zb + hh * 0.66 + 0.02), r * 0.36, hh * 0.68 * 0.5, verts=24), 0.08, int(zb * 10) + 1)
        k = max(6, int(r * 5))
        for i in range(k):
            a = i / k * 2 * PI + zb
            rr = r * 0.93
            ball(ornaments[(i + int(zb)) % 4], (rr * math.cos(a), rr * math.sin(a), zb + 0.12), 0.15, seg=10, rings=8)
            ring(ornaments[1], (rr * math.cos(a), rr * math.sin(a), zb + 0.29), 0.035, 0.012, seg=8, mseg=4)
    # a spiral of lights
    n = 170
    for i in range(n):
        t = i / n
        z = 1.0 + t * 7.4
        r = tier_radius(tiers, z) + 0.04
        a = t * 2 * PI * 7
        ball(B[i % len(B)], (r * math.cos(a), r * math.sin(a), z), 0.075, seg=8, rings=6)
    star(gold_star, (0, 0, 9.0), 0.75, 0.32, 0.2)
    save('tree_big')


def pine(name='pine', seed=3, tall=1.0):
    """a snowy fir: six ragged tiers, each with a snow skirt on top"""
    reset()
    bark, leaf, S = mat('bark', '#4e3320'), mat('leaf', '#1b4f37', rough=0.9), snow()
    leaf2 = mat('leaf_dark', '#143d2b', rough=0.9)
    cyl(bark, (0, 0, 0.45), 0.2, 0.9, verts=12)
    tiers = [(1.9, 0.55, 1.6), (1.6, 1.35, 1.5), (1.3, 2.1, 1.4), (1.0, 2.85, 1.3), (0.7, 3.55, 1.15), (0.42, 4.2, 1.0)]
    for k, (r, zb, hh) in enumerate(tiers):
        zb, hh = zb * tall, hh * tall
        jitter(cone(leaf if k % 2 == 0 else leaf2, (0, 0, zb + hh / 2), r, hh, verts=16), 0.16, seed * 31 + k)
        jitter(cone(S, (0, 0, zb + hh * 0.42 + hh * 0.6 / 2), r * 0.72, hh * 0.6, verts=16), 0.14, seed * 31 + k + 9)
    save(name)


# ---------------------------------------------------------------- decorations
def snowman():
    reset()
    S = mat('snowman', '#fbfdff', rough=0.9)
    coal, carrot = mat('coal', '#1b1b1f'), mat('carrot', '#f07a1a')
    red, green, stick = mat('scarf', '#d42330'), mat('scarf2', '#1f7a3e'), mat('stick', '#5b3a22')
    ball(S, (0, 0, 0.55), 0.62, smooth=True)
    ball(S, (0, 0, 1.4), 0.46)
    ball(S, (0, 0, 2.05), 0.33)
    for z in (1.25, 1.45, 1.65):
        ball(coal, (0, -0.44 + (z - 1.45) ** 2, z), 0.05, seg=8, rings=6)
    for x in (-0.11, 0.11):
        ball(coal, (x, -0.29, 2.13), 0.045, seg=8, rings=6)
    for i in range(5):
        a = PI * (0.25 + i * 0.125)
        ball(coal, (0.17 * math.cos(a), -0.28 + 0.02 * abs(i - 2), 2.0 - 0.1 * math.sin(a)), 0.025, seg=6, rings=4)
    cone(carrot, (0, -0.48, 2.06), 0.06, 0.38, rot=(PI / 2, 0, 0), verts=10)
    # hat
    cyl(coal, (0, 0, 2.33), 0.38, 0.05, verts=16)
    cyl(coal, (0, 0, 2.58), 0.24, 0.48, verts=16)
    cyl(red, (0, 0, 2.42), 0.245, 0.1, verts=16)
    # scarf
    ring(red, (0, 0, 1.78), 0.32, 0.09, seg=18)
    box(red, (0.18, -0.32, 1.5), (0.16, 0.06, 0.5), rot=(0, 0.15, 0))
    box(green, (0.18, -0.33, 1.38), (0.17, 0.065, 0.07), rot=(0, 0.15, 0))
    # stick arms
    for side in (-1, 1):
        cyl(stick, (side * 0.75, 0, 1.6), 0.03, 0.85, verts=6, rot=(0, side * 1.0, 0))
        cyl(stick, (side * 1.05, 0, 1.92), 0.02, 0.3, verts=6, rot=(0, side * 0.2, 0))
    save('snowman')


def lamppost():
    reset()
    iron, S = mat('iron', '#1f2a2a', rough=0.5, metal=0.6), snow()
    glow = mat('lamp', '#ffd890', emit=2.6)
    green, red = mat('wreath', '#1f6b35'), mat('bow', '#d81f2a')
    cyl(iron, (0, 0, 0.15), 0.22, 0.3, verts=10)
    cyl(iron, (0, 0, 1.8), 0.07, 3.3, verts=10)
    cyl(iron, (0, 0, 3.45), 0.16, 0.08, verts=10)
    box(glow, (0, 0, 3.75), (0.36, 0.36, 0.5))
    for x in (-0.19, 0.19):
        for y in (-0.19, 0.19):
            box(iron, (x, y, 3.75), (0.04, 0.04, 0.54))
    cone(iron, (0, 0, 4.15), 0.36, 0.3, verts=4, rot=(0, 0, PI / 4))
    cone(S, (0, 0, 4.2), 0.3, 0.24, verts=4, rot=(0, 0, PI / 4))
    ring(green, (0, -0.08, 2.6), 0.26, 0.08, rot=(PI / 2, 0, 0), mseg=8)
    ball(red, (0, -0.16, 2.36), 0.09)
    box(red, (0.06, -0.15, 2.18), (0.05, 0.03, 0.3), rot=(0, 0.3, 0))
    box(red, (-0.06, -0.15, 2.18), (0.05, 0.03, 0.3), rot=(0, -0.3, 0))
    save('lamppost')


def presents():
    reset()
    colours = [('#d4202c', '#f2c94c'), ('#1f8a4c', '#e83b3b'), ('#2f6de0', '#e9eef7'), ('#f0b43a', '#c81f3a'), ('#8a3fd1', '#f2c94c')]
    layout = [(0.8, (0, 0, 0.4), 0.2), (0.6, (0.78, 0.2, 0.3), -0.3), (0.5, (0.05, 0.72, 0.25), 0.5),
              (0.45, (0.02, 0.0, 1.025), 0.7), (0.55, (-0.72, 0.1, 0.275), -0.1)]
    for i, (s, pos, rz) in enumerate(layout):
        c, rc = colours[i]
        body, rib = mat('paper%d' % i, c, rough=0.6), mat('ribbon%d' % i, rc, rough=0.35, metal=0.3)
        parts = [box(body, (0, 0, 0), (s, s, s)),
                 box(rib, (0, 0, 0), (s + 0.02, s * 0.16, s + 0.02)),
                 box(rib, (0, 0, 0), (s * 0.16, s + 0.02, s + 0.02)),
                 ring(rib, (s * 0.12, 0, s / 2 + 0.06), 0.09 * s / 0.6, 0.025, rot=(PI / 2, 0, 0.6), seg=10, mseg=4),
                 ring(rib, (-s * 0.12, 0, s / 2 + 0.06), 0.09 * s / 0.6, 0.025, rot=(PI / 2, 0, -0.6), seg=10, mseg=4)]
        o = join(parts)
        o.location = pos
        o.rotation_euler = (0, 0, rz)
    save('presents')


def candy_cane():
    reset()
    red, white = mat('cane_red', '#e0202e', rough=0.3), mat('cane_white', '#fbfbfb', rough=0.3)
    r, seg, top, hook = 0.07, 0.13, 2.2, 0.3
    i, z = 0, seg / 2
    while z < top:
        cyl(red if i % 2 else white, (0, 0, z), r, seg, verts=10)
        z += seg
        i += 1
    n = 14
    for k in range(n):
        t = (k + 0.5) / n * PI
        x = hook - hook * math.cos(t)
        zz = top + hook * math.sin(t)
        cyl(red if (i + k) % 2 else white, (x, 0, zz), r, PI * hook / n + 0.01, verts=10, rot=(0, math.atan2(math.sin(t), math.cos(t)), 0))
    ball(red, (2 * hook, 0, top - 0.02), r, seg=10, rings=6)
    save('candy_cane')


def fence():
    reset()
    wood, S = mat('wood', '#7a4f2d'), snow()
    red = mat('ribbon', '#d81f2a')
    box(wood, (-1, 0, 0.55), (0.16, 0.16, 1.1))
    box(S, (-1, 0, 1.14), (0.2, 0.2, 0.09))
    cone(wood, (-1, 0, 1.2), 0.11, 0.0001, verts=4)
    for z in (0.42, 0.85):
        box(wood, (0, 0, z), (2.0, 0.07, 0.14))
        box(S, (0, 0, z + 0.09), (2.0, 0.11, 0.05))
    ball(red, (-1, -0.1, 0.95), 0.07)
    save('fence')


def cyl_between(m, a, b, r, verts=12):
    """a cylinder from point a to point b"""
    from mathutils import Vector
    a, b = Vector(a), Vector(b)
    d = b - a
    o = cyl(m, tuple((a + b) / 2), r, d.length, verts=verts)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def shovel():
    """a snow pusher: wide curved red blade on the ground, thin metal pole back to a black D-grip.
    The blade's bottom edge is the origin; it pushes forward (+Y); the grip is back, up and to the right."""
    reset()
    red = mat('blade', '#e0161e', rough=0.38, metal=0.05)
    steel = mat('steel', '#c9d0d8', rough=0.25, metal=0.95)
    black = mat('grip', '#141414', rough=0.55)
    W, R, T, TH = 1.05, 0.6, 0.02, 0.42   # blade width, curve radius, thickness, half the arc (radians)
    # the curved sheet, about half a metre tall: an arc in the YZ plane swept along X, hollow side
    # to the front (it scoops the snow), round back towards you
    n = 14
    prof, outs = [], []
    for i in range(n + 1):
        a = -TH + i / n * 2 * TH
        prof.append((R - R * math.cos(a), R * math.sin(a) + R * math.sin(TH)))
        outs.append((-math.cos(a), math.sin(a)))
    v, f = [], []
    for (y, z) in prof:
        for x in (-W / 2, W / 2):
            v.append((x, y, z))
    # the back surface: the same arc pushed back by the thickness
    k = len(v)
    for (y, z), (oy, oz) in zip(prof, outs):
        for x in (-W / 2, W / 2):
            v.append((x, y + oy * T, z + oz * T))
    for i in range(n):
        a0, a1 = i * 2, (i + 1) * 2
        f.append((a0, a0 + 1, a1 + 1, a1))                       # front face
        f.append((k + a1, k + a1 + 1, k + a0 + 1, k + a0))       # back face
        f.append((a0, a1, k + a1, k + a0))                       # left edge
        f.append((a0 + 1, k + a0 + 1, k + a1 + 1, a1 + 1))       # right edge
    f.append((0, k, k + 1, 1))                                   # bottom edge
    f.append((n * 2, n * 2 + 1, k + n * 2 + 1, k + n * 2))       # top edge
    blade = mesh(red, v, f, 'blade')
    for p in blade.data.polygons:
        p.use_smooth = True
    H = prof[-1][1]
    # rolled top lip, side plates and a darker red rib across the back
    cyl(red, (0, prof[-1][0], H), 0.022, W + 0.01, verts=10, rot=(0, PI / 2, 0), smooth=True)
    for x in (-W / 2, W / 2):
        box(red, (x, 0.03, H / 2), (0.022, 0.1, H))
    rib = mat('rib', '#a50e14', rough=0.5)
    box(rib, (0, -0.025, H * 0.55), (W - 0.04, 0.03, 0.05))
    # steel wear strip along the bottom edge
    box(steel, (0, 0.05, 0.015), (W, 0.03, 0.03))
    # a brace on the back where the pole meets the blade
    box(rib, (0, -0.05, H * 0.5), (0.2, 0.07, 0.3))
    cyl(steel, (0, -0.09, H * 0.55), 0.03, 0.1, verts=12, rot=(1.1, 0, 0), smooth=True)
    # the pole and the D-grip
    base, top = (0.0, -0.1, H * 0.58), (0.30, -1.50, 0.66)
    cyl_between(steel, base, top, 0.016)
    cyl_between(black, (0.272, -1.37, 0.625), top, 0.022)
    from mathutils import Vector
    d = (Vector(top) - Vector(base)).normalized()
    g0 = Vector(top)
    side = d.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(d).normalized()
    # the D: two arms out from the pole end and a crossbar handle
    a1 = g0 + side * 0.07 + d * 0.05
    a2 = g0 - side * 0.07 + d * 0.05
    tip1 = g0 + side * 0.07 + d * 0.17
    tip2 = g0 - side * 0.07 + d * 0.17
    cyl_between(black, tuple(g0), tuple(a1), 0.014)
    cyl_between(black, tuple(g0), tuple(a2), 0.014)
    cyl_between(black, tuple(a1), tuple(tip1), 0.014)
    cyl_between(black, tuple(a2), tuple(tip2), 0.014)
    cyl_between(black, tuple(tip1 + side * 0.01), tuple(tip2 - side * 0.01), 0.02)
    save('shovel')


def sleigh():
    reset()
    red, gold = mat('sleigh_red', '#c4161f', rough=0.45), mat('sleigh_gold', '#e8b84a', rough=0.3, metal=0.8)
    seat = mat('seat', '#2b5d34')
    suit, fur, skin = mat('suit', '#d01c24'), mat('fur', '#fbfbfb', rough=0.95), mat('skin', '#f2c4a4')
    belt, sack = mat('belt', '#151515'), mat('sack', '#8a5a2b')
    deer, antler, dark = mat('deer', '#7a4a26'), mat('antler', '#d7b98a'), mat('hoof', '#2a1a10')
    nose = mat('nose', '#ff2020', emit=2.5)
    bell = mat('bell', '#ffd34a', rough=0.25, metal=0.9)
    B = bulbs()

    # sleigh body (faces +Y)
    box(red, (0, 0, 0.95), (1.5, 2.3, 0.7))
    box(red, (0, -0.95, 1.4), (1.5, 0.45, 1.4))
    box(seat, (0, -0.35, 1.32), (1.3, 0.9, 0.14))
    cyl(red, (0, 1.15, 1.05), 0.42, 1.5, verts=16, rot=(0, PI / 2, 0))
    for x in (-0.76, 0.76):
        box(gold, (x, 0, 1.28), (0.05, 2.3, 0.08))
        box(gold, (x, -0.95, 2.08), (0.05, 0.47, 0.08))
    box(gold, (0, -1.2, 2.08), (1.55, 0.06, 0.08))
    for x in (-0.62, 0.62):
        box(gold, (x, -0.05, 0.08), (0.08, 2.9, 0.08))
        ring(gold, (x, 1.42, 0.42), 0.34, 0.045, rot=(0, PI / 2, 0), seg=18)
        for y in (-0.8, 0.0, 0.8):
            box(gold, (x, y, 0.36), (0.06, 0.06, 0.55))
    for i, y in enumerate([-0.9 + k * 0.22 for k in range(10)]):
        ball(B[i % len(B)], (0.79, y, 1.36), 0.05, seg=8, rings=6)
        ball(B[(i + 3) % len(B)], (-0.79, y, 1.36), 0.05, seg=8, rings=6)

    # Santa
    ball(suit, (0, -0.4, 1.85), 0.5, scale=(0.95, 0.85, 1.0))
    ring(belt, (0, -0.4, 1.78), 0.47, 0.06, seg=20)
    box(bell, (0, -0.86, 1.78), (0.14, 0.04, 0.12))
    ball(skin, (0, -0.4, 2.52), 0.24)
    ball(fur, (0, -0.58, 2.38), 0.22, scale=(1.0, 0.6, 1.1))
    ball(fur, (0, -0.6, 2.53), 0.1, scale=(1.6, 0.6, 0.5))
    ball(nose, (0, -0.63, 2.55), 0.04)
    cone(suit, (0, -0.33, 2.9), 0.25, 0.5, verts=14, rot=(-0.35, 0, 0))
    ring(fur, (0, -0.4, 2.7), 0.24, 0.06, seg=16)
    ball(fur, (0, -0.18, 3.1), 0.08)
    for side in (-1, 1):
        cyl(suit, (side * 0.38, -0.65, 1.95), 0.11, 0.6, verts=10, rot=(PI / 2.6, 0, 0))
        ball(belt, (side * 0.38, -0.92, 1.82), 0.1)
    # the sack of presents
    ball(sack, (0, -1.05, 2.0), 0.62, scale=(1.1, 0.8, 1.0))
    box(mat('p1', '#2f6de0'), (0.25, -1.0, 2.55), (0.35, 0.35, 0.35), rot=(0.2, 0.3, 0.4))
    box(mat('p2', '#1f8a4c'), (-0.2, -1.1, 2.6), (0.3, 0.3, 0.3), rot=(-0.3, 0.2, 0.1))

    # reins
    for x in (-0.38, 0.38):
        cyl(belt, (x * 0.8, 1.45, 1.75), 0.015, 2.9, verts=6, rot=(PI / 2 - 0.12, 0, 0))

    # reindeer: two side by side, then Rudolph in front
    def reindeer(x, y, lead=False):
        ball(deer, (x, y, 1.15), 0.4, scale=(0.75, 1.7, 0.85))
        for dx in (-0.17, 0.17):
            for dy in (-0.45, 0.45):
                cyl(deer, (x + dx, y + dy, 0.55), 0.06, 0.85, verts=8)
                cyl(dark, (x + dx, y + dy, 0.12), 0.07, 0.1, verts=8)
        cyl(deer, (x, y + 0.6, 1.5), 0.12, 0.6, verts=8, rot=(-0.6, 0, 0))
        ball(deer, (x, y + 0.85, 1.8), 0.2, scale=(0.9, 1.4, 0.95))
        ball(nose if lead else dark, (x, y + 1.13, 1.76), 0.07 if lead else 0.05)
        for side in (-1, 1):
            cyl(antler, (x + side * 0.12, y + 0.78, 2.1), 0.025, 0.4, verts=6, rot=(0, side * 0.4, 0))
            cyl(antler, (x + side * 0.22, y + 0.85, 2.2), 0.02, 0.22, verts=6, rot=(0.7, side * 0.6, 0))
            cone(deer, (x + side * 0.15, y + 0.72, 1.95), 0.06, 0.16, verts=6, rot=(0, side * 1.1, 0))
        ball(fur, (x, y - 0.68, 1.25), 0.08)
        ring(red, (x, y + 0.45, 1.3), 0.33, 0.04, rot=(PI / 2, 0, 0), seg=16)
        ball(bell, (x, y + 0.45, 0.96), 0.06, seg=8, rings=6)

    reindeer(-0.55, 2.9)
    reindeer(0.55, 2.9)
    reindeer(0, 4.6, lead=True)
    save('sleigh')


def car(name, paint):
    """a parked car with a Christmas tree tied on the roof; front is -Y (+Z in the game)"""
    reset()
    body, S = mat('paint', paint, rough=0.35, metal=0.4), snow()
    glass = mat('glass', '#1c2633', rough=0.15, metal=0.3)
    tyre, hub = mat('tyre', '#121212', rough=0.8), mat('hub', '#b8bec6', rough=0.3, metal=0.9)
    head, tail = mat('headlight', '#fff3cf', emit=1.5), mat('taillight', '#ff2a2a', emit=1.2)
    leaf, bark, rope = mat('leaf', '#1d5a3c'), mat('bark', '#5b3a22'), mat('rope', '#c9a46a')
    box(body, (0, 0, 0.62), (1.85, 4.3, 0.7))
    box(body, (0, 0.25, 1.22), (1.65, 2.3, 0.6))
    box(glass, (0, -0.93, 1.22), (1.55, 0.06, 0.5), rot=(-0.5, 0, 0))
    box(glass, (0, 1.42, 1.22), (1.55, 0.06, 0.5), rot=(0.5, 0, 0))
    for x in (-0.83, 0.83):
        box(glass, (x, 0.25, 1.24), (0.04, 2.0, 0.46))
    for x in (-0.82, 0.82):
        for y in (-1.35, 1.35):
            cyl(tyre, (x, y, 0.36), 0.36, 0.26, verts=14, rot=(0, PI / 2, 0))
            cyl(hub, (x * 1.02, y, 0.36), 0.2, 0.24, verts=10, rot=(0, PI / 2, 0))
    for x in (-0.65, 0.65):
        box(head, (x, -2.16, 0.7), (0.38, 0.04, 0.16))
        box(tail, (x, 2.16, 0.72), (0.38, 0.04, 0.14))
    box(mat('grille', '#202428', rough=0.4, metal=0.6), (0, -2.16, 0.5), (0.9, 0.04, 0.18))
    box(S, (0, 0.25, 1.56), (1.6, 2.2, 0.1))
    box(S, (0, -1.55, 1.0), (1.7, 1.1, 0.07))
    box(S, (0, 1.85, 1.0), (1.7, 0.55, 0.07))
    # the tree on the roof, lying down, tied with rope
    cyl(bark, (0, 1.25, 1.75), 0.06, 0.5, verts=8, rot=(PI / 2, 0, 0))
    cone(leaf, (0, -0.1, 1.82), 0.38, 2.3, verts=10, rot=(-PI / 2, 0, 0))
    for y in (-0.4, 0.5):
        ring(rope, (0, y, 1.62), 0.42, 0.015, rot=(PI / 2, 0, 0), seg=14, mseg=4)
    save(name)


def bench():
    reset()
    wood, iron, S = mat('wood', '#8a5a33'), mat('iron', '#1f2a2a', rough=0.5, metal=0.6), snow()
    for y in (-0.15, 0.0, 0.15):
        box(wood, (0, y, 0.48), (1.8, 0.12, 0.05))
    for z in (0.7, 0.86):
        box(wood, (0, 0.27, z), (1.8, 0.04, 0.11))
    for x in (-0.8, 0.8):
        box(iron, (x, 0, 0.24), (0.06, 0.45, 0.48))
        box(iron, (x, 0.27, 0.6), (0.06, 0.05, 0.6))
    box(S, (0, 0, 0.53), (1.8, 0.42, 0.06))
    save('bench')


def bare_tree(name='tree_bare', seed=5):
    """a leafless winter tree: a trunk that forks into branches, snow along the tops"""
    from mathutils import Vector
    reset()
    bark, S = mat('bark', '#4a3627', rough=0.95), snow()
    rnd = random.Random(seed)

    def branch(p, d, length, r, depth):
        end = p + d * length
        cyl_between(bark, tuple(p), tuple(end), r, verts=8)
        if d.z < 0.85 and r > 0.04:
            cyl_between(S, tuple(p + Vector((0, 0, r * 0.8))), tuple(end + Vector((0, 0, r * 0.6))), r * 0.55, verts=6)
        if depth == 0:
            return
        for _ in range(2 if depth > 2 else 3):
            nd = (d + Vector((rnd.uniform(-0.9, 0.9), rnd.uniform(-0.9, 0.9), rnd.uniform(0.0, 0.5)))).normalized()
            branch(end, nd, length * rnd.uniform(0.6, 0.78), r * 0.62, depth - 1)

    branch(Vector((0, 0, 0)), Vector((0, 0, 1)), 2.6, 0.22, 4)
    save(name)


def church():
    """the village church on the hill: stone nave, a tall tower and spire, glowing windows"""
    reset()
    stone, roof, S = mat('stone', '#8d8a86'), mat('roof', '#3c3f4a'), snow()
    glass = mat('stained', '#ffb85c', emit=1.2)
    wood = mat('door', '#4a2c1a')
    gold = mat('gold', '#e8b84a', rough=0.35, metal=0.8)
    box(stone, (0, 0, 3.5), (8, 16, 7))
    prism(roof, 8.8, 16.6, 4.2, 7).rotation_euler = (0, 0, PI / 2)
    box(stone, (0, -9.5, 6.5), (5, 5, 13))
    box(S, (0, -9.5, 13.1), (5.3, 5.3, 0.25))
    jitter(cone(roof, (0, -9.5, 17.5), 3.0, 9, verts=8), 0.0, 1)
    cyl(gold, (0, -9.5, 22.6), 0.08, 1.4, verts=8)
    cyl(gold, (0, -9.5, 22.7), 0.08, 0.8, verts=8, rot=(0, PI / 2, 0))
    for y in (-4, 0, 4):
        for x in (-4.05, 4.05):
            box(glass, (x, y, 3.8), (0.1, 1.2, 2.6))
    box(glass, (0, -12.05, 9.5), (1.4, 0.1, 2.2))
    box(wood, (0, -12.05, 1.5), (1.8, 0.15, 3))
    box(glass, (0, -12.08, 6), (1.2, 0.1, 1.2))
    save('church')


house('house_red', 6.0, 5.0, 3.6, '#9b2d2a', '#3b3f4a', '#f3efe6', 2.4)
house('house_cream', 7.0, 5.5, 5.6, '#efe2c2', '#a42a2a', '#4d3527', 2.8, floors=2)
house('house_blue', 5.5, 5.0, 3.4, '#3d5f8f', '#5a3b2a', '#f5f1e8', 2.2)
house('house_green', 6.5, 5.0, 5.2, '#2f5e46', '#3b2f2f', '#f2e7cf', 2.6, floors=2)
big_tree()
pine('pine', 3, 1.0)
pine('pine_tall', 8, 1.35)
snowman()
lamppost()
presents()
candy_cane()
fence()
shovel()
sleigh()
car('car_red', '#b3121b')
car('car_green', '#1d5a3c')
car('car_silver', '#aab2bd')
bench()
bare_tree('tree_bare', 5)
bare_tree('tree_bare2', 11)
church()
print('ALL MODELS DONE')
