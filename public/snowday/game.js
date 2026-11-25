// Snow Day: shovel all the snow off the Christmas town square while your TikTok LIVE viewers pile it back on.
// It runs as its own desktop app (snowday/main.cjs, Electron) and Unbound sends it every gift.
//
// Unbound sends each gift's action over its game link (ws://127.0.0.1:<wsPort>) as
// {"type":"gift","action":"snow","amount":100,"from":"name","image":"..."}. Actions:
//   snow <amount>       a snowball falls from the sky and lands as that much snow
//   blizzard <seconds>  heavy snow falls all over the square
//   santa <amount>      Santa's sleigh flies over dropping that much snow
//   freeze <seconds>    the shovel freezes: it can't clear snow and you walk slower
//   melt <amount>       a warm spell melts that much snow (helps you)
//   avalanche           everything around you fills up again
// Anything else counts as snow with its amount.
//
// The models are made in Blender (snowday/blender/make_models.py) and loaded from models/.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = id => document.getElementById(id);
const PI = Math.PI, UP = new THREE.Vector3(0, 1, 0);
const QUERY = new URLSearchParams(location.search);
const TEST = QUERY.has('test');
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => Math.max(0, Math.round(n)).toLocaleString('en-US');
function seeded(seed) {
    // the same "random" town every time for a level
    let a = seed >>> 0;
    return (lo = 0, hi = 1) => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return lo + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (hi - lo);
    };
}

// ---------------------------------------------------------------- levels: a bigger town square each time
const CELL = 0.3;           // the snow is a grid of points this far apart (metres)
const UNIT_H = 0.012;       // 1 snow = 12 mm deep
const MAX_V = 300;          // deepest a point can get (3.6 m)
const CHUNK = 40;           // the snow is drawn in pieces of 40 x 40 points
const LEVELS = [
    { w: 72, d: 52, snow: 14 },
    { w: 92, d: 66, snow: 15 },
    { w: 114, d: 82, snow: 16 },
    { w: 138, d: 98, snow: 17 },
    { w: 164, d: 116, snow: 18 },
];

// ---------------------------------------------------------------- renderer, scene, camera
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
document.body.prepend(renderer.domElement);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const FOG = new THREE.Color().setRGB(0.13, 0.11, 0.22);
scene.fog = new THREE.FogExp2(FOG, 0.0032);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 3200);
camera.rotation.order = 'YXZ';
scene.add(camera);

// the shovel is drawn on top of the world (its own little scene), so it never sinks into deep snow
const viewScene = new THREE.Scene(), viewRig = new THREE.Group();
viewScene.add(viewRig, new THREE.HemisphereLight(0xaab8e8, 0x40364e, 1.15));
{
    const l = new THREE.DirectionalLight(0xc8d4f4, 1.6);
    l.position.set(-1, 3, 1.5);
    viewRig.add(l);
    const warm = new THREE.PointLight(0xffc580, 1.5, 6, 1.5);
    warm.position.set(1.5, 1.0, -1.0);
    viewRig.add(warm);
}
// drawn into a multisampled buffer: smooth edges with the glow pass too
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
{
    const p = new RenderPass(viewScene, camera);
    p.clear = false;
    p.clearDepth = true;
    composer.addPass(p);
}
// a soft glow on the lights only (not the snow)
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.45, 0.96);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- light and sky (a clear winter evening)
const hemi = new THREE.HemisphereLight(0x9fb0e0, 0x3a3248, 0.95);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xbfd0f6, 1.45);
moon.castShadow = true;
moon.shadow.mapSize.set(4096, 4096);
Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
moon.shadow.bias = -0.0003;
moon.shadow.normalBias = 0.035;
moon.shadow.radius = 3;
scene.add(moon, moon.target);
const SUN_DIR = new THREE.Vector3(-0.5, 0.75, 0.42).normalize();
function moonFollow(x, z) {
    // the shadows are worked out around you, wherever you are on the big square
    const s = 90 / 4096, sx = Math.round(x / s) * s, sz = Math.round(z / s) * s;
    moon.position.set(sx + SUN_DIR.x * 70, SUN_DIR.y * 70, sz + SUN_DIR.z * 70);
    moon.target.position.set(sx, 0, sz);
}

let stars, moonDisc, halo, aurora, clouds;
const skyU = { hor: { value: new THREE.Color().setRGB(0.30, 0.17, 0.30) }, mid: { value: new THREE.Color().setRGB(0.06, 0.06, 0.19) }, top: { value: new THREE.Color().setRGB(0.008, 0.012, 0.05) } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 hor; uniform vec3 mid; uniform vec3 top; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = mix(mix(hor, mid, smoothstep(0.0, 0.25, h)), top, smoothstep(0.25, 0.9, h));
      if (h < 0.0) c = hor * 0.7; gl_FragColor = vec4(c, 1.0); }`,
}));
scene.add(sky);
{
    // stars, the moon and its halo
    const n = 4000, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const a = rand(0, 2 * PI), y = Math.pow(rand(0.05, 1), 0.7), r = Math.sqrt(1 - y * y), b = rand(0.35, 1);
        p.set([Math.cos(a) * r * 2400, y * 2400, Math.sin(a) * r * 2400], i * 3);
        c.set([b, b, b * rand(0.9, 1.1)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, fog: false, vertexColors: true, transparent: true, opacity: 0.9 }));
    scene.add(stars);
    const m = moonDisc = new THREE.Mesh(new THREE.SphereGeometry(34, 32, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.6, 1.55, 1.4), fog: false }));
    scene.add(m);
    halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(200,210,255,0.35)'), fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(520);
    scene.add(halo);
}
// the northern lights: slow green and violet curtains over the mountains in the north
const auroraU = { time: { value: 0 } };
{
    const geo = new THREE.CylinderGeometry(1900, 1900, 700, 96, 1, true, -PI * 0.95, PI * 0.9);
    const mat = new THREE.ShaderMaterial({
        uniforms: auroraU, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float time; varying vec2 vUv;
          float n(float x){ return sin(x) * 0.5 + 0.5; }
          void main(){
            float x = vUv.x * 40.0;
            float wave = n(x * 0.7 + time * 0.25 + sin(x * 0.31 + time * 0.1) * 3.0) * n(x * 0.23 - time * 0.13);
            float edge = 0.12 + 0.18 * n(x * 0.5 + time * 0.2);
            float band = smoothstep(edge, edge + 0.08, vUv.y) * (1.0 - smoothstep(0.35, 0.95, vUv.y));
            float rays = 0.65 + 0.35 * n(x * 9.0 + time * 0.6);
            vec3 col = mix(vec3(0.15, 0.95, 0.55), vec3(0.55, 0.3, 0.95), smoothstep(0.3, 0.85, vUv.y));
            float a = wave * band * rays * 0.32 * smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));
            gl_FragColor = vec4(col * a, a);
          }`,
    });
    aurora = new THREE.Mesh(geo, mat);
    aurora.position.y = 620;
    scene.add(aurora);
}

// soft clouds for the daytime sky
{
    const cloudTex = (() => {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 256;
        const g = c.getContext('2d'), r = seeded(77);
        for (let i = 0; i < 26; i++) {
            const x = r(90, 420), y = r(110, 160) - Math.sin((x - 90) / 330 * PI) * 50, rad = r(35, 85);
            const gr = g.createRadialGradient(x, y, 0, x, y, rad);
            gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 2 * PI); g.fill();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    })();
    clouds = new THREE.Group();
    const r = seeded(5);
    for (let i = 0; i < 18; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, depthWrite: false, opacity: r(0.5, 0.85) }));
        const a = r(0, 2 * PI), d = r(1200, 2100);
        sp.position.set(Math.cos(a) * d, r(280, 650), Math.sin(a) * d);
        sp.scale.set(r(500, 900), r(160, 280), 1);
        clouds.add(sp);
    }
    scene.add(clouds);
}

// sunny winter afternoon (like the streams) or a Christmas night: N switches
const TIMES = {
    day: {
        hor: [0.62, 0.82, 0.93], mid: [0.25, 0.55, 0.86], top: [0.06, 0.28, 0.72], fog: [0.72, 0.82, 0.92], fogDensity: 0.0026,
        hemiSky: 0x9cc8f0, hemiGround: 0xf4efe6, hemi: 1.05, sun: 0xfff3e0, sunI: 2.6, exposure: 1.0, bloom: 0.22, lamps: 0, disc: [5, 4.8, 4.4], discR: 1.2,
        haloColour: 'rgba(255,250,235,0.55)', night: false,
    },
    night: {
        hor: [0.30, 0.17, 0.30], mid: [0.06, 0.06, 0.19], top: [0.008, 0.012, 0.05], fog: [0.13, 0.11, 0.22], fogDensity: 0.0032,
        hemiSky: 0x9fb0e0, hemiGround: 0x3a3248, hemi: 0.95, sun: 0xbfd0f6, sunI: 1.45, exposure: 0.92, bloom: 0.32, lamps: 1, disc: [1.6, 1.55, 1.4], discR: 1,
        haloColour: 'rgba(200,210,255,0.35)', night: true,
    },
};
let timeOfDay = localStorage.getItem('snowday.time') === 'night' ? 'night' : 'day', baseFog = TIMES.day.fogDensity;
function setTimeOfDay(name) {
    const t = TIMES[timeOfDay = name];
    localStorage.setItem('snowday.time', name);
    skyU.hor.value.setRGB(...t.hor); skyU.mid.value.setRGB(...t.mid); skyU.top.value.setRGB(...t.top);
    scene.fog.color.setRGB(...t.fog);
    baseFog = t.fogDensity;
    hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround); hemi.intensity = t.hemi;
    moon.color.set(t.sun); moon.intensity = t.sunI;
    renderer.toneMappingExposure = t.exposure;
    bloom.strength = t.bloom;
    stars.visible = aurora.visible = t.night;
    clouds.visible = !t.night;
    moonDisc.material.color.setRGB(...t.disc);
    moonDisc.scale.setScalar(t.discR);
    moonDisc.position.copy(SUN_DIR).multiplyScalar(2200);
    halo.position.copy(moonDisc.position);
    halo.material.map = radialTex(t.haloColour);
    halo.material.needsUpdate = true;
    for (const l of lights) l.visible = !!t.lamps;
    lastLights = -1;
}

// ---------------------------------------------------------------- textures (made here, sharp and tiled)
function radialTex(inner) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
}
function tex(canvas, srgb = true) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = MAX_ANISO;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
function makeCanvas(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    return c;
}
// a normal map from a greyscale height canvas (lit bumps: stones, grass, snow grains)
function normalMap(height, strength = 2) {
    const s = height.width, src = height.getContext('2d').getImageData(0, 0, s, s).data;
    const out = document.createElement('canvas');
    out.width = out.height = s;
    const og = out.getContext('2d'), img = og.createImageData(s, s), d = img.data;
    const h = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const dx = (h(x - 1, y) - h(x + 1, y)) * strength, dy = (h(x, y - 1) - h(x, y + 1)) * strength;
        const l = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
        d[i] = (dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    return tex(out, false);
}
// smooth noise painted into a canvas (for heights and greys)
function noiseCanvas(size, scales, seed = 1) {
    return makeCanvas(size, (g, s) => {
        const img = g.createImageData(s, s), d = img.data;
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            let v = 0, tot = 0;
            for (const [f, w] of scales) {
                // tileable: sample the noise on a torus
                const a = x / s * 2 * PI, b = y / s * 2 * PI, r = f / (2 * PI);
                v += w * noise2(Math.cos(a) * r + Math.sin(b) * r * 0.37 + seed, Math.sin(a) * r + Math.cos(b) * r + seed * 2.1);
                tot += w;
            }
            const c = v / tot * 255, i = (y * s + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
    });
}

// cobbles: irregular rounded stones in mortar, with a matching height map for the normals
function cobbleSet(tint) {
    const S = 1024, r = seeded(17 + tint * 5), col = makeCanvas(S, () => { }), hgt = makeCanvas(S, () => { });
    const g = col.getContext('2d'), h = hgt.getContext('2d');
    g.fillStyle = tint ? '#2a2a30' : '#39353a'; g.fillRect(0, 0, S, S);
    h.fillStyle = '#000'; h.fillRect(0, 0, S, S);
    const rows = 11, rh = S / rows;
    for (let row = 0; row < rows; row++) {
        let x = r(-rh, 0);
        while (x < S) {
            const w = rh * r(0.85, 1.5), cx = x + w / 2, cy = row * rh + rh / 2 + r(-3, 3);
            const l = r(28, 50) - tint * 10, hue = r(15, 45), sat = r(4, 12);
            for (const off of [-S, 0, S]) {
                const ox = cx + off;
                const grad = g.createRadialGradient(ox - w * 0.15, cy - rh * 0.2, 2, ox, cy, w * 0.6);
                grad.addColorStop(0, `hsl(${hue} ${sat}% ${l + 10}%)`); grad.addColorStop(1, `hsl(${hue} ${sat}% ${l - 6}%)`);
                g.fillStyle = grad;
                g.beginPath(); g.roundRect(ox - w / 2 + 4, cy - rh / 2 + 4, w - 8, rh - 8, rh * 0.32); g.fill();
                const hg = h.createRadialGradient(ox, cy, 2, ox, cy, w * 0.55);
                hg.addColorStop(0, '#fff'); hg.addColorStop(1, '#555');
                h.fillStyle = hg;
                h.beginPath(); h.roundRect(ox - w / 2 + 4, cy - rh / 2 + 4, w - 8, rh - 8, rh * 0.32); h.fill();
            }
            x += w;
        }
    }
    // grit and wear
    for (let i = 0; i < 60000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r(0.02, 0.07)})`; g.fillRect(r(0, S), r(0, S), r(1, 3), r(1, 3)); }
    // a dusting of snow left in the joints
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(200,210,230,${r(0.03, 0.1)})`; g.beginPath(); g.arc(r(0, S), r(0, S), r(2, 9), 0, 2 * PI); g.fill(); }
    return { map: tex(col), normalMap: normalMap(hgt, 3) };
}
function grassSet() {
    const S = 1024, r = seeded(33), col = makeCanvas(S, () => { }), hgt = makeCanvas(S, () => { });
    const g = col.getContext('2d'), h = hgt.getContext('2d');
    g.fillStyle = '#3a8f2c'; g.fillRect(0, 0, S, S);
    h.fillStyle = '#777'; h.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { g.fillStyle = `hsla(${r(85, 112)}, ${r(40, 60)}%, ${r(24, 40)}%, ${r(0.15, 0.4)})`; g.beginPath(); g.ellipse(r(0, S), r(0, S), r(10, 60), r(8, 40), r(0, 3), 0, 2 * PI); g.fill(); }
    // blades: thousands of short strokes, darker at the root
    for (let i = 0; i < 70000; i++) {
        const x = r(0, S), y = r(0, S), len = r(4, 13), a = r(-0.6, 0.6) - PI / 2, l = r(26, 52);
        g.strokeStyle = `hsl(${r(82, 115)}, ${r(45, 70)}%, ${l}%)`; g.lineWidth = r(0.8, 1.8);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
        h.strokeStyle = `rgba(255,255,255,${r(0.1, 0.35)})`; h.lineWidth = 1.2;
        h.beginPath(); h.moveTo(x, y); h.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); h.stroke();
    }
    // frost
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(225,235,255,${r(0.05, 0.25)})`; g.fillRect(r(0, S), r(0, S), r(1, 2.5), r(1, 2.5)); }
    return { map: tex(col), normalMap: normalMap(hgt, 2) };
}
const COBBLE = cobbleSet(0), STREET_TEX = cobbleSet(1), GRASS = grassSet();
// snow grains: a fine bumpy normal map, and a little sparkle in the colour
const SNOW_NORMAL = normalMap(noiseCanvas(512, [[24, 1], [70, 0.6], [180, 0.35]], 4), 1.4);
const flakeTex = tex(makeCanvas(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
}));

// greyscale detail patterns for the models' surfaces (wood siding, shingles, brick, bark...), laid on
// in world space so they're crisp and the right size on every model
const DETAIL = (() => {
    const S = 512, r = seeded(9);
    const grain = (g, base) => { for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r(0.02, base)})`; g.fillRect(r(0, S), r(0, S), r(1, 3), r(1, 3)); } };
    const fill = (g, v) => { g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, 0, S, S); };
    return {
        siding: tex(makeCanvas(S, g => { fill(g, 128); for (let y = 0; y < S; y += S / 8) { g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, y, S, S / 8 - 6); g.fillStyle = 'rgb(70,70,70)'; g.fillRect(0, y + S / 8 - 6, S, 6); } grain(g, 0.08); }), false),
        shingle: tex(makeCanvas(S, g => { fill(g, 90); const rows = 10, h = S / rows; for (let y = 0; y < rows; y++) for (let x = -(y % 2) * h * 0.6; x < S; x += h * 1.2) { g.fillStyle = `rgb(${r(110, 160)},${r(110, 160)},${r(110, 160)})`; g.fillRect(x + 2, y * h + 2, h * 1.2 - 4, h - 5); } grain(g, 0.1); }), false),
        brick: tex(makeCanvas(S, g => { fill(g, 175); const rows = 16, h = S / rows; for (let y = 0; y < rows; y++) for (let x = -(y % 2) * h; x < S; x += h * 2) { const v = r(95, 140); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x + 3, y * h + 3, h * 2 - 6, h - 6); } grain(g, 0.1); }), false),
        stone: tex(makeCanvas(S, g => { fill(g, 150); for (let i = 0; i < 70; i++) { const v = r(100, 160); g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.roundRect(r(0, S), r(0, S), r(40, 110), r(30, 70), 14); g.fill(); } grain(g, 0.12); }), false),
        wood: tex(makeCanvas(S, g => { fill(g, 128); for (let y = 0; y < S; y += r(3, 9)) { g.fillStyle = `rgba(${r() < 0.5 ? '40,40,40' : '200,200,200'},${r(0.15, 0.4)})`; g.fillRect(0, y, S, r(1, 3)); } grain(g, 0.06); }), false),
        bark: tex(makeCanvas(S, g => { fill(g, 128); for (let x = 0; x < S; x += r(4, 12)) { g.fillStyle = `rgba(${r() < 0.6 ? '30,30,30' : '210,210,210'},${r(0.2, 0.5)})`; g.fillRect(x, 0, r(2, 5), S); } grain(g, 0.1); }), false),
        needles: tex(noiseCanvas(256, [[30, 1], [90, 0.8]], 7), false),
        fine: tex(noiseCanvas(256, [[20, 1], [60, 0.5]], 3), false),
    };
})();
// lays a detail pattern on a material in world space (works on instanced copies too)
function addDetail(material, map, scale, strength) {
    material.onBeforeCompile = sh => {
        sh.uniforms.detailMap = { value: map };
        sh.uniforms.detailScale = { value: scale };
        sh.uniforms.detailStrength = { value: strength };
        sh.vertexShader = 'varying vec3 vDW;\nvarying vec3 vDN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            vec4 dW = vec4(transformed, 1.0);
            vec3 dN = objectNormal;
            #ifdef USE_INSTANCING
              dW = instanceMatrix * dW;
              dN = mat3(instanceMatrix) * dN;
            #endif
            dW = modelMatrix * dW;
            vDW = dW.xyz;
            vDN = normalize(mat3(modelMatrix) * dN);`);
        sh.fragmentShader = 'uniform sampler2D detailMap;\nuniform float detailScale;\nuniform float detailStrength;\nvarying vec3 vDW;\nvarying vec3 vDN;\n' +
            sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            {
              vec3 bw = pow(abs(normalize(vDN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
              float d = texture2D(detailMap, vDW.zy * detailScale).r * bw.x + texture2D(detailMap, vDW.xz * detailScale).r * bw.y + texture2D(detailMap, vDW.xy * detailScale).r * bw.z;
              diffuseColor.rgb *= mix(1.0, d * 2.0, detailStrength);
            }`);
    };
    material.customProgramCacheKey = () => `detail-${scale}-${strength}`;
    material.needsUpdate = true;
}
const DETAIL_FOR = {
    wall: ['siding', 2.2, 0.35], roof: ['shingle', 1.6, 0.45], brick: ['brick', 1.4, 0.5], stone: ['stone', 0.8, 0.4], shutter: ['wood', 1.5, 0.3],
    wood: ['wood', 1.3, 0.45], door: ['wood', 1.5, 0.4], bench: ['wood', 1.3, 0.45], bark: ['bark', 1.6, 0.6], leaf: ['needles', 1.1, 0.55],
    leaf_dark: ['needles', 1.1, 0.55], garland: ['needles', 3, 0.5], wreath: ['needles', 3, 0.5], trim: ['fine', 1, 0.15], snow: ['fine', 0.6, 0.12],
    snowman: ['fine', 0.8, 0.12], paper0: ['fine', 2, 0.15], sack: ['fine', 2, 0.3], seat: ['fine', 2, 0.2], iron: ['fine', 2, 0.25],
};
function detailModels() {
    const seen = new Set();
    for (const name in models) models[name].traverse(o => {
        if (!o.isMesh || seen.has(o.material)) return;
        seen.add(o.material);
        const d = DETAIL_FOR[o.material.name] || (o.material.emissiveIntensity > 0 && o.material.emissive.getHex() ? null : ['fine', 1.5, 0.12]);
        if (d) addDetail(o.material, DETAIL[d[0]], d[1], d[2]);
        if (o.material.map) o.material.map.anisotropy = MAX_ANISO;
    });
}

// ---------------------------------------------------------------- the land around the town: hills, then mountains
const FLAT_X = 140, FLAT_Z = 112;            // the town sits on flat ground this big (half sizes)
function fbm(x, z, oct = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += a * noise2(x * f, z * f, 3 + i); f *= 2.03; a *= 0.5; } return v; }
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function terrainH(x, z) {
    const dx = Math.max(0, Math.abs(x) - FLAT_X), dz = Math.max(0, Math.abs(z) - FLAT_Z), d = Math.hypot(dx, dz);
    if (d <= 0) return -0.04;
    const hills = (fbm(x / 110, z / 110) * 26 + 3) * smooth(0, 90, d);
    const r = Math.hypot(x, z), ridge = 1 - Math.abs(fbm(x / 260, z / 260, 5) * 2 - 1);
    const mountains = smooth(380, 700, r) * (ridge * ridge * 330 + fbm(x / 70, z / 70) * 40);
    return hills + mountains - 0.04;
}
{
    const size = 3400, seg = 340, geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        p.setY(i, terrainH(x, z));
        uv.setXY(i, x / 6, z / 6);
    }
    geo.computeVertexNormals();
    // bare rock where it's steep, snow everywhere else
    const n = geo.attributes.normal, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
        const steep = smooth(0.82, 0.62, n.getY(i)), y = p.getY(i), shade = 0.92 + noise2(p.getX(i) / 9, p.getZ(i) / 9, 8) * 0.08;
        const rock = [0.30, 0.32, 0.40];
        col.set([shade * (1 - steep) + rock[0] * steep, shade * (1 - steep) + rock[1] * steep, (shade + 0.02) * (1 - steep) + rock[2] * steep], i * 3);
        if (y > 260) col.set([shade, shade, shade + 0.02], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, normalMap: SNOW_NORMAL, normalScale: new THREE.Vector2(0.7, 0.7) }));
    ground.receiveShadow = true;
    scene.add(ground);
}

// ---------------------------------------------------------------- models
const loader = new GLTFLoader();
const MODEL_NAMES = ['house_red', 'house_cream', 'house_blue', 'house_green', 'tree_big', 'pine', 'pine_tall', 'snowman', 'lamppost', 'presents',
    'candy_cane', 'fence', 'shovel', 'sleigh', 'car_red', 'car_green', 'car_silver', 'bench', 'tree_bare', 'tree_bare2', 'church'];
const models = {};
const MODELS_VERSION = 4;          // bump when the Blender models change
const T = (x, y, z, ry = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(s, s, s));
// facing: a model's front is +Z; this turns it to face (dx, dz)
const face = (dx, dz) => Math.atan2(dx, dz);

// many copies of one model, drawn in one go per material
function instanced(model, transforms, { cast = true, receive = true } = {}) {
    const g = new THREE.Group();
    model.updateMatrixWorld(true);
    model.traverse(o => {
        if (!o.isMesh || !transforms.length) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, transforms.length);
        const m = new THREE.Matrix4();
        transforms.forEach((t, i) => { m.multiplyMatrices(t, o.matrixWorld); im.setMatrixAt(i, m); });
        im.castShadow = cast;
        im.receiveShadow = receive;
        im.computeBoundingSphere();
        g.add(im);
    });
    return g;
}

// ---------------------------------------------------------------- the town (rebuilt for each level's size)
// Inside the fence: a street all round the edge, a cross of paths and a plaza with the big tree in the
// middle; grass between them with pines, lampposts, benches, snowmen, presents and parked cars.
// Outside: houses along every side, then forest and mountains.
const STREET = 4, PATH = 1.9, PLAZA = 9, RING = 12.5;
function isPath(L, x, z) {
    const ex = L.w / 2 - Math.abs(x), ez = L.d / 2 - Math.abs(z), r = Math.hypot(x, z);
    return ex < STREET || ez < STREET || Math.abs(x) < PATH || Math.abs(z) < PATH || r < RING;
}

let town = null;            // { group, colliders: [{x, z, r}], lamps: [[x, z]] }
const lights = [];
for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight(0xffc580, 3.2, 12, 2);
    l.position.set(0, -50, 0);
    scene.add(l);
    lights.push(l);
}

// the ground you uncover: grass, the cobbled street round the edge, the paths and the plaza, each with
// its own sharp, tiled texture (laid out in metres, so it's the same crisp size on every level)
const GROUND_MATS = {
    grass: new THREE.MeshStandardMaterial({ ...GRASS, roughness: 0.95, normalScale: new THREE.Vector2(0.8, 0.8) }),
    street: new THREE.MeshStandardMaterial({ ...STREET_TEX, roughness: 0.85, normalScale: new THREE.Vector2(1.2, 1.2) }),
    path: new THREE.MeshStandardMaterial({ ...COBBLE, roughness: 0.8, normalScale: new THREE.Vector2(1.2, 1.2) }),
    kerb: new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.8 }),
};
function flat(shapeOrGeo, mat, y, tile) {
    const geo = shapeOrGeo instanceof THREE.Shape ? new THREE.ShapeGeometry(shapeOrGeo, 48) : shapeOrGeo;
    geo.rotateX(-PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.receiveShadow = true;
    m.userData.own = true;
    return m;
}
function groundMeshes(L, group) {
    const hw = L.w / 2, hd = L.d / 2, iw = hw - STREET, id = hd - STREET;
    group.add(flat(new THREE.PlaneGeometry(L.w, L.d), GROUND_MATS.grass, 0.008, 2.5));
    const street = new THREE.Shape([new THREE.Vector2(-hw, -hd), new THREE.Vector2(hw, -hd), new THREE.Vector2(hw, hd), new THREE.Vector2(-hw, hd)]);
    street.holes.push(new THREE.Path([new THREE.Vector2(-iw, -id), new THREE.Vector2(-iw, id), new THREE.Vector2(iw, id), new THREE.Vector2(iw, -id)]));
    group.add(flat(street, GROUND_MATS.street, 0.012, 3.2));
    for (const [w, d] of [[2 * PATH, 2 * id], [2 * iw, 2 * PATH]]) group.add(flat(new THREE.PlaneGeometry(w, d), GROUND_MATS.path, 0.016, 3));
    group.add(flat(new THREE.CircleGeometry(RING, 96), GROUND_MATS.path, 0.02, 3));
    // kerbstones round the street's inner edge and the plaza
    for (const [x, z, w, d] of [[0, -id, 2 * iw + 0.3, 0.3], [0, id, 2 * iw + 0.3, 0.3], [-iw, 0, 0.3, 2 * id], [iw, 0, 0.3, 2 * id]]) {
        const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), GROUND_MATS.kerb);
        k.position.set(x, 0.025, z); k.receiveShadow = true; k.castShadow = true; k.userData.own = true;
        group.add(k);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.12, 6, 120), GROUND_MATS.kerb);
    ring.rotation.x = PI / 2; ring.position.y = 0.03; ring.userData.own = true;
    group.add(ring);
}

function buildTown(L, li) {
    if (town) {
        scene.remove(town.group);
        town.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.userData.own) o.geometry.dispose(); });
    }
    const group = new THREE.Group(), colliders = [], lamps = [], r = seeded(1000 + li * 77);
    const put = {};          // model name -> transforms
    const add = (name, x, z, ry = 0, s = 1) => (put[name] ||= []).push(T(x, 0, z, ry, s));
    const hw = L.w / 2, hd = L.d / 2;
    const free = (x, z, rad) => !colliders.some(c => Math.hypot(c.x - x, c.z - z) < c.r + rad) && Math.hypot(x, z - hd + 2) > 6;

    // the ground you uncover
    groundMeshes(L, group);

    // the big tree in the middle, candy canes round it, presents underneath
    add('tree_big', 0, 0, 0, 1.3);
    colliders.push({ x: 0, z: 0, r: 4.6 });
    for (let k = 0; k < 10; k++) {
        const a = k / 10 * 2 * PI, x = Math.cos(a) * 6.6, z = Math.sin(a) * 6.6;
        add('candy_cane', x, z, -a, 1.2);
        colliders.push({ x, z, r: 0.35 });
    }
    for (let k = 0; k < 5; k++) { const a = k / 5 * 2 * PI + 0.3; add('presents', Math.cos(a) * 4.9, Math.sin(a) * 4.9, a * 2, 0.9); }
    // benches round the plaza, facing the tree
    for (let k = 0; k < 8; k++) {
        const a = (k + 0.5) / 8 * 2 * PI, x = Math.cos(a) * 10.6, z = Math.sin(a) * 10.6;
        add('bench', x, z, face(-x, -z) + PI);
        colliders.push({ x, z, r: 0.95 });
    }
    // lampposts along both sides of the paths, and round the plaza
    for (let d = RING + 5; d < Math.max(hw, hd) - STREET; d += 11) for (const s of [-1, 1]) {
        if (d < hw - STREET) { lamps.push([s * d, PATH + 0.7], [s * d, -PATH - 0.7]); }
        if (d < hd - STREET) { lamps.push([PATH + 0.7, s * d], [-PATH - 0.7, s * d]); }
    }
    for (let k = 0; k < 8; k++) { const a = k / 8 * 2 * PI + PI / 8; lamps.push([Math.cos(a) * (RING + 0.6), Math.sin(a) * (RING + 0.6)]); }
    for (let x = -hw + 8; x <= hw - 8; x += 14) lamps.push([x, -hd + 0.6], [x, hd - 0.6]);
    for (let z = -hd + 10; z <= hd - 10; z += 14) lamps.push([-hw + 0.6, z], [hw - 0.6, z]);
    for (const [x, z] of lamps) { add('lamppost', x, z, face(-x, -z)); colliders.push({ x, z, r: 0.3 }); }

    // parked cars along the street
    const cars = ['car_red', 'car_green', 'car_silver'];
    for (let x = -hw + 7; x < hw - 7; x += r(9, 16)) for (const s of [-1, 1]) {
        if (Math.abs(x) < 6 || r() < 0.45) continue;
        const z = s * (hd - 1.4), ry = r() < 0.5 ? PI / 2 : -PI / 2;
        if (!free(x, z, 2.4)) continue;
        add(cars[Math.floor(r(0, 3))], x, z, ry);
        for (const o of [-1.4, 0, 1.4]) colliders.push({ x: x + o, z, r: 1.0 });
    }
    for (let z = -hd + 9; z < hd - 9; z += r(10, 16)) for (const s of [-1, 1]) {
        if (r() < 0.5) continue;
        const x = s * (hw - 1.4);
        if (!free(x, z, 2.4)) continue;
        add(cars[Math.floor(r(0, 3))], x, z, r() < 0.5 ? 0 : PI);
        for (const o of [-1.4, 0, 1.4]) colliders.push({ x, z: z + o, r: 1.0 });
    }

    // pines, snowmen and presents on the grass
    const area = L.w * L.d;
    const scatter = (n, rad, fn) => {
        for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) {
            const x = r(-hw + STREET + rad, hw - STREET - rad), z = r(-hd + STREET + rad, hd - STREET - rad);
            if (isPath(L, x, z) || isPath(L, x + rad, z) || isPath(L, x - rad, z) || isPath(L, x, z + rad) || isPath(L, x, z - rad) || !free(x, z, rad + 1.2)) continue;
            fn(x, z);
            colliders.push({ x, z, r: rad });
            k++;
        }
    };
    scatter(Math.round(area / 240), 1.4, (x, z) => add('pine', x, z, r(0, 6), r(0.85, 1.35)));
    scatter(Math.round(area / 1100) + 2, 0.75, (x, z) => add('snowman', x, z, face(-x, -z) + r(-0.6, 0.6)));
    scatter(Math.round(area / 1500) + 1, 0.9, (x, z) => add('presents', x, z, r(0, 6), 0.9));

    // the fence round the edge
    const fx = hw + 0.3, fz = hd + 0.3;
    for (let x = -hw + 1; x < hw; x += 2) { add('fence', x, -fz, 0); add('fence', x, fz, PI); }
    for (let z = -hd + 1; z < hd; z += 2) { add('fence', -fx, z, PI / 2); add('fence', fx, z, -PI / 2); }

    // houses along every side, facing in, then the forest
    const houses = ['house_red', 'house_cream', 'house_blue', 'house_green'];
    let h = 0;
    for (let x = -hw + 6; x <= hw - 6; x += r(17, 24)) {
        if (r() > 0.25) add(houses[h++ % 4], x + r(-2, 2), -fz - 13, 0);
        if (r() > 0.25) add(houses[h++ % 4], x + r(-2, 2), fz + 13, PI);
    }
    for (let z = -hd + 10; z <= hd - 10; z += r(28, 40)) {
        if (r() > 0.5) add(houses[h++ % 4], -fx - 14, z + r(-2, 2), PI / 2);
        if (r() > 0.5) add(houses[h++ % 4], fx + 14, z + r(-2, 2), -PI / 2);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { add('snowman', sx * (fx + 4), sz * (fz + 4), face(-sx, -sz)); add('candy_cane', sx * (fx + 0.6), sz * (fz + 0.6), face(-sx, -sz) + PI / 2, 1.3); }
    const trees = ['pine', 'pine_tall', 'pine', 'tree_bare', 'tree_bare2'];
    for (let k = 0; k < 340; k++) {
        const a = r(0, 2 * PI), d = r(0, 1);
        const x = Math.cos(a) * (hw + 30 + d * 40), z = Math.sin(a) * (hd + 30 + d * 40);
        (put[trees[k % 5]] ||= []).push(T(x, terrainH(x, z), z, r(0, 6), r(0.9, 1.6)));
    }
    for (const name in put) group.add(instanced(models[name], put[name], { receive: !/^pine|^tree_bare/.test(name) }));
    scene.add(group);
    town = { group, colliders, lamps };
    lastLights = -1;
}

// the world beyond the town (built once): a forest over the hills, two little villages with lit windows,
// the church on the hill, and the mountains behind
function buildScenery() {
    const r = seeded(2024), put = {};
    const add = (name, x, z, ry = 0, s = 1) => (put[name] ||= []).push(T(x, terrainH(x, z), z, ry, s));
    const outside = (x, z, m) => Math.abs(x) > FLAT_X - 30 + m || Math.abs(z) > FLAT_Z - 30 + m;
    // villages on the hillsides, each round a little square
    const villages = [[230, -150, 0.6], [-260, 120, 3.6], [40, 300, 1.7]];
    const houses = ['house_red', 'house_cream', 'house_blue', 'house_green'];
    const taken = [];
    for (const [vx, vz] of villages) {
        for (let k = 0; k < 14; k++) {
            const a = k / 14 * 2 * PI + r(-0.15, 0.15), d = r(16, 42), x = vx + Math.cos(a) * d, z = vz + Math.sin(a) * d;
            add(houses[k % 4], x, z, face(vx - x, vz - z), r(0.9, 1.15));
            taken.push([x, z, 7]);
        }
        add('tree_big', vx, vz, r(0, 6), 0.9);
        taken.push([vx, vz, 8]);
    }
    add('church', villages[0][0] + 55, villages[0][1] - 20, -2.2, 1.2);
    taken.push([villages[0][0] + 55, villages[0][1] - 20, 22]);
    // the forest: thick on the hills, thinning out up the mountains
    const trees = ['pine', 'pine_tall', 'pine', 'pine_tall', 'tree_bare', 'tree_bare2'];
    for (let k = 0, tries = 0; k < 2600 && tries < 20000; tries++) {
        const a = r(0, 2 * PI), d = Math.pow(r(0, 1), 0.7) * 620 + 60, x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!outside(x, z, 0)) continue;
        const h = terrainH(x, z);
        if (h > 150 + r(0, 80) || taken.some(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) < tr)) continue;
        // clumps: skip some open glades
        if (noise2(x / 40, z / 40, 12) < 0.38) continue;
        const name = h > 60 ? (k % 2 ? 'pine' : 'pine_tall') : trees[k % trees.length];
        add(name, x, z, r(0, 6), r(1.0, 2.2));
        k++;
    }
    for (const name in put) scene.add(instanced(models[name], put[name], { cast: false, receive: false }));
}

// the few real lights go to the lampposts nearest you (and one always on the tree)
let lastLights = -1;
function placeLights(t) {
    if (t - lastLights < 0.4 && lastLights >= 0) return;
    lastLights = t;
    lights[0].position.set(0, 5, 0);
    lights[0].intensity = 26; lights[0].distance = 24; lights[0].color.set(0xffc27a);
    const near = town.lamps.map(([x, z]) => [x, z, (x - player.x) ** 2 + (z - player.z) ** 2]).sort((a, b) => a[2] - b[2]);
    for (let i = 1; i < lights.length; i++) {
        const l = near[i - 1];
        if (l) lights[i].position.set(l[0], 3.7, l[1]); else lights[i].position.set(0, -50, 0);
    }
}

// ---------------------------------------------------------------- the snow
function noise2(x, z, seed) {
    // smooth value noise
    const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}

const snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, alphaTest: 0.5, normalMap: SNOW_NORMAL, normalScale: new THREE.Vector2(0.9, 0.9) });
let F = null;   // the field: { L, nx, nz, w, d, v, bump, mask, chunks, dirty, total, start }

function startSnow(L, li, x, z, edge) {
    return L.snow * (1 + 0.5 * Math.max(0, 1 - edge / 1.8)) * (0.72 + 0.42 * noise2(x / 3.4, z / 3.4, li * 13.7 + 1) + 0.14 * noise2(x / 0.9, z / 0.9, li * 13.7 + 6));
}

function buildField(li, saved) {
    const L = LEVELS[li];
    if (F) for (const c of F.chunks) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    buildTown(L, li);
    const nx = Math.round(L.w / CELL), nz = Math.round(L.d / CELL), n = (nx + 1) * (nz + 1);
    const w = nx * CELL, d = nz * CELL;
    const v = new Float32Array(n), bump = new Float32Array(n), mask = new Uint8Array(n);
    // no snow under the tree, posts, cars...
    for (const c of town.colliders) {
        const rr = c.r * 0.85;
        for (let iz = Math.max(0, Math.floor((c.z - rr + d / 2) / CELL)); iz <= Math.min(nz, Math.ceil((c.z + rr + d / 2) / CELL)); iz++)
            for (let ix = Math.max(0, Math.floor((c.x - rr + w / 2) / CELL)); ix <= Math.min(nx, Math.ceil((c.x + rr + w / 2) / CELL)); ix++)
                if (Math.hypot(-w / 2 + ix * CELL - c.x, -d / 2 + iz * CELL - c.z) <= rr) mask[iz * (nx + 1) + ix] = 1;
    }
    let start = 0;
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
        const i = iz * (nx + 1) + ix, x = ix * CELL, z = iz * CELL;
        bump[i] = Math.random();
        if (mask[i]) continue;
        v[i] = startSnow(L, li, x, z, Math.min(x, w - x, z, d - z));
        start += v[i];
    }
    if (saved && saved.length === n) for (let i = 0; i < n; i++) v[i] = mask[i] ? 0 : saved[i];
    F = { L, nx, nz, w, d, v, bump, mask, chunks: [], dirty: new Set(), total: 0, start };
    // the snow drawn in chunks, so a change only redraws the pieces it touched
    for (let cz = 0; cz * CHUNK < nz; cz++) for (let cx = 0; cx * CHUNK < nx; cx++) {
        const x0 = cx * CHUNK, x1 = Math.min(nx, x0 + CHUNK), z0 = cz * CHUNK, z1 = Math.min(nz, z0 + CHUNK);
        const cw = x1 - x0 + 1, ch = z1 - z0 + 1;
        const pos = new Float32Array(cw * ch * 3), idx = [];
        for (let iz = 0; iz < ch; iz++) for (let ix = 0; ix < cw; ix++) {
            const k = iz * cw + ix;
            pos[k * 3] = -w / 2 + (x0 + ix) * CELL;
            pos[k * 3 + 2] = -d / 2 + (z0 + iz) * CELL;
            if (ix < cw - 1 && iz < ch - 1) { const a = k, b = k + cw; idx.push(a, b, a + 1, a + 1, b, b + 1); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cw * ch * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cw * ch * 4), 4));
        const uvs = new Float32Array(cw * ch * 2);
        for (let k = 0; k < cw * ch; k++) { uvs[k * 2] = pos[k * 3] / 1.8; uvs[k * 2 + 1] = pos[k * 3 + 2] / 1.8; }
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geo.setIndex(idx);
        const cxm = -w / 2 + (x0 + x1) / 2 * CELL, czm = -d / 2 + (z0 + z1) / 2 * CELL;
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cxm, 1.5, czm), Math.hypot(cw * CELL / 2, ch * CELL / 2, 3));
        const mesh = new THREE.Mesh(geo, snowMat);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        scene.add(mesh);
        F.chunks.push({ mesh, x0, x1, z0, z1, cw, ch });
        F.dirty.add(F.chunks.length - 1);
    }
    F.chunksX = Math.ceil(nx / CHUNK);
    F.total = sumSnow();
    F.start = Math.max(F.total, start);
}
function sumSnow() { let t = 0; for (let i = 0; i < F.v.length; i++) t += F.v[i]; return t; }

const heightAt = i => { const s = F.v[i]; return s > 0.5 ? 0.03 + s * UNIT_H + F.bump[i] * 0.035 * Math.min(1, s / 12) : -0.12; };
function refreshChunk(c) {
    const g = c.mesh.geometry, pos = g.attributes.position.array, nor = g.attributes.normal.array, col = g.attributes.color.array;
    const nx1 = F.nx + 1, v = F.v;
    for (let iz = 0; iz < c.ch; iz++) for (let ix = 0; ix < c.cw; ix++) {
        const gx = c.x0 + ix, gz = c.z0 + iz, i = gz * nx1 + gx, k = iz * c.cw + ix;
        const h = heightAt(i);
        pos[k * 3 + 1] = h;
        const hl = heightAt(gz * nx1 + Math.max(0, gx - 1)), hr = heightAt(gz * nx1 + Math.min(F.nx, gx + 1));
        const hu = heightAt(Math.max(0, gz - 1) * nx1 + gx), hd = heightAt(Math.min(F.nz, gz + 1) * nx1 + gx);
        let nxv = hl - hr, nyv = 2 * CELL, nzv = hu - hd;
        const len = Math.hypot(nxv, nyv, nzv);
        nor[k * 3] = nxv / len; nor[k * 3 + 1] = nyv / len; nor[k * 3 + 2] = nzv / len;
        if (v[i] > 0.5) {
            // white on top, icy blue on the cut walls and slopes
            const b = 0.93 + F.bump[i] * 0.07, wall = Math.min(1, (1 - nyv / len) * 4) * 0.55;
            col[k * 4] = b * (1 - wall) + 0.70 * wall; col[k * 4 + 1] = b * (1 - wall) + 0.82 * wall; col[k * 4 + 2] = b * (1 - wall) + 0.97 * wall; col[k * 4 + 3] = 1;
        } else col[k * 4 + 3] = 0;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
}
function refreshSnow() {
    for (const k of F.dirty) refreshChunk(F.chunks[k]);
    F.dirty.clear();
}
// marks the chunks a change touched (one point wider, for the shading at the edges)
function touched(ix0, iz0, ix1, iz1) {
    const a = Math.floor(Math.max(0, ix0 - 2) / CHUNK), b = Math.floor(Math.min(F.nx - 1, ix1 + 2) / CHUNK);
    const c = Math.floor(Math.max(0, iz0 - 2) / CHUNK), d = Math.floor(Math.min(F.nz - 1, iz1 + 2) / CHUNK);
    for (let cz = c; cz <= d; cz++) for (let cx = a; cx <= b; cx++) F.dirty.add(cz * F.chunksX + cx);
}

const cellX = ix => -F.w / 2 + ix * CELL, cellZ = iz => -F.d / 2 + iz * CELL;
function depthAt(x, z) {
    const ix = Math.round((x + F.w / 2) / CELL), iz = Math.round((z + F.d / 2) / CELL);
    if (ix < 0 || iz < 0 || ix > F.nx || iz > F.nz) return 0;
    return F.v[iz * (F.nx + 1) + ix];
}
function range(x, z, r) {
    return [Math.max(0, Math.floor((x - r + F.w / 2) / CELL)), Math.max(0, Math.floor((z - r + F.d / 2) / CELL)),
        Math.min(F.nx, Math.ceil((x + r + F.w / 2) / CELL)), Math.min(F.nz, Math.ceil((z + r + F.d / 2) / CELL))];
}

// adds a mound of snow (Gaussian, spread sigma metres); returns how much was really added
function addSnow(x, z, amount, sigma) {
    const [ix0, iz0, ix1, iz1] = range(x, z, sigma * 2.2);
    const k = -1 / (2 * sigma * sigma);
    let wsum = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        if (F.mask[iz * (F.nx + 1) + ix]) continue;
        const dx = cellX(ix) - x, dz = cellZ(iz) - z;
        wsum += Math.exp((dx * dx + dz * dz) * k);
    }
    if (!wsum) return 0;
    let added = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * (F.nx + 1) + ix;
        if (F.mask[i]) continue;
        const dx = cellX(ix) - x, dz = cellZ(iz) - z;
        const nv = Math.min(MAX_V, F.v[i] + amount * Math.exp((dx * dx + dz * dz) * k) / wsum);
        added += nv - F.v[i];
        F.v[i] = nv;
    }
    F.total += added;
    touched(ix0, iz0, ix1, iz1);
    return added;
}
const sigmaFor = amount => Math.max(0.5, CELL * Math.sqrt(amount / (2 * PI * 34)));

// clears a strip as wide as the blade; returns how much snow it took
function clearRect(cx, cz, rx, rz, fx, fz, halfW, halfL) {
    const [ix0, iz0, ix1, iz1] = range(cx, cz, Math.max(halfW, halfL) + CELL);
    let got = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const dx = cellX(ix) - cx, dz = cellZ(iz) - cz;
        if (Math.abs(dx * rx + dz * rz) > halfW || Math.abs(dx * fx + dz * fz) > halfL) continue;
        const i = iz * (F.nx + 1) + ix;
        if (F.v[i] > 0) { got += F.v[i]; F.v[i] = 0; }
    }
    if (got) { F.total -= got; touched(ix0, iz0, ix1, iz1); }
    return got;
}

// a warm spell: thins the snow everywhere by that much
function melt(amount) {
    if (F.total <= 0) return 0;
    const keep = Math.max(0, 1 - amount / F.total);
    let left = 0;
    for (let i = 0; i < F.v.length; i++) { let s = F.v[i] * keep; if (s < 0.6) s = 0; F.v[i] = s; left += s; }
    const melted = F.total - left;
    F.total = left;
    for (let k = 0; k < F.chunks.length; k++) F.dirty.add(k);
    return melted;
}
// an avalanche: everything within 28 m of you fills back up
function avalanche(px, pz) {
    const before = F.total, R = 28;
    const [ix0, iz0, ix1, iz1] = range(px, pz, R);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * (F.nx + 1) + ix, dist = Math.hypot(cellX(ix) - px, cellZ(iz) - pz);
        if (F.mask[i] || dist > R) continue;
        const fill = F.L.snow * 1.3 * (0.8 + 0.4 * noise2(ix * CELL / 2.5, iz * CELL / 2.5, 99)) * Math.min(1, (R - dist) / 4);
        F.v[i] = Math.max(F.v[i], fill);
    }
    F.total = sumSnow();
    touched(ix0, iz0, ix1, iz1);
    return F.total - before;
}

// ---------------------------------------------------------------- particles (snow spray, puffs, fireworks)
class Particles {
    constructor(max, { size, additive = false, gravity = -9 } = {}) {
        this.max = max; this.i = 0; this.gravity = gravity;
        this.p = new Float32Array(max * 3).fill(-1000);
        this.c = new Float32Array(max * 3).fill(1);
        this.vel = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.drag = new Float32Array(max);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
        g.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
        this.points = new THREE.Points(g, new THREE.PointsMaterial({
            size, map: flakeTex, vertexColors: true, transparent: true, depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        }));
        this.points.frustumCulled = false;
        scene.add(this.points);
    }
    spawn(x, y, z, vx, vy, vz, life, color = null, drag = 0) {
        const i = this.i = (this.i + 1) % this.max;
        this.p.set([x, y, z], i * 3);
        this.vel.set([vx, vy, vz], i * 3);
        if (color) this.c.set([color.r, color.g, color.b], i * 3); else this.c.set([1, 1, 1], i * 3);
        this.life[i] = life;
        this.drag[i] = drag;
    }
    update(dt) {
        for (let i = 0; i < this.max; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] -= dt;
            if (this.life[i] <= 0) { this.p[i * 3 + 1] = -1000; continue; }
            const d = 1 - this.drag[i] * dt;
            this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
            this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.gravity * dt;
            this.p[i * 3] += this.vel[i * 3] * dt;
            this.p[i * 3 + 1] = Math.max(0.02, this.p[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
            this.p[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        }
        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.color.needsUpdate = true;
    }
}
const spray = new Particles(2500, { size: 0.09 });
const fireworks = new Particles(3000, { size: 0.9, additive: true, gravity: -4 });

function puff(x, z, n, spread) {
    for (let i = 0; i < n; i++) {
        const a = rand(0, 2 * PI), s = rand(0.5, 1) * spread;
        spray.spawn(x, rand(0.1, 0.6), z, Math.cos(a) * s, rand(1, 4) * Math.min(2, spread / 2), Math.sin(a) * s, rand(0.6, 1.4), null, 1.2);
    }
}
const FW_COLOURS = [0xff3b3b, 0x3bff6a, 0x5ab0ff, 0xffd23b, 0xff7bff, 0xffffff].map(c => new THREE.Color(c).multiplyScalar(1.8));
function firework() {
    const x = rand(-F.w / 2, F.w / 2), z = rand(-F.d / 2 - 12, -F.d / 2 - 4), y = rand(16, 26), c = FW_COLOURS[Math.floor(rand(0, FW_COLOURS.length))];
    for (let i = 0; i < 140; i++) {
        const u = rand(-1, 1), a = rand(0, 2 * PI), r = Math.sqrt(1 - u * u), s = rand(7, 10);
        fireworks.spawn(x, y, z, Math.cos(a) * r * s, u * s, Math.sin(a) * r * s, rand(1.2, 2), c, 1.4);
    }
    sfx.boom();
}

// falling snow all around you
const FLAKES = 6000;
const flakes = (() => {
    const p = new Float32Array(FLAKES * 3), sp = new Float32Array(FLAKES);
    for (let i = 0; i < FLAKES; i++) { p.set([rand(-45, 45), rand(0, 35), rand(-45, 45)], i * 3); sp[i] = rand(0.6, 1.4); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.13, map: flakeTex, transparent: true, depthWrite: false, opacity: 0.9 }));
    pts.frustumCulled = false;
    scene.add(pts);
    return { p, sp, g, pts };
})();
function updateFlakes(dt, t, heavy) {
    const n = heavy ? FLAKES : 1800, fall = heavy ? 6 : 1.3, wind = heavy ? 7 : 0.6;
    flakes.g.setDrawRange(0, n);
    const cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < n; i++) {
        const k = i * 3, s = flakes.sp[i];
        flakes.p[k] += (wind + Math.sin(t * 0.7 + i) * 0.4) * s * dt;
        flakes.p[k + 1] -= fall * s * dt;
        flakes.p[k + 2] += Math.cos(t * 0.5 + i * 1.3) * 0.4 * s * dt;
        if (flakes.p[k + 1] < 0) flakes.p[k + 1] += 35;
        if (flakes.p[k] - cx > 45) flakes.p[k] -= 90; else if (flakes.p[k] - cx < -45) flakes.p[k] += 90;
        if (flakes.p[k + 2] - cz > 45) flakes.p[k + 2] -= 90; else if (flakes.p[k + 2] - cz < -45) flakes.p[k + 2] += 90;
    }
    flakes.g.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- sound (made in the browser, nothing to download)
const sfx = (() => {
    let ac = null, master, musicGain, scrapeGain, noise, musicOn = localStorage.getItem('snowday.music') !== 'off', nextNote = 0, step = 0;
    function init() {
        if (ac) return;
        ac = new AudioContext();
        master = ac.createGain(); master.gain.value = 0.7; master.connect(ac.destination);
        musicGain = ac.createGain(); musicGain.gain.value = musicOn ? 0.16 : 0; musicGain.connect(master);
        const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        noise = buf;
        const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7;
        scrapeGain = ac.createGain(); scrapeGain.gain.value = 0;
        src.connect(bp).connect(scrapeGain).connect(master); src.start();
        setInterval(schedule, 80);
    }
    const tone = (freq, at, dur, { type = 'triangle', vol = 0.3, out = master, slide = 0 } = {}) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, at);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + dur);
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
        o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.05);
    };
    const hiss = (at, dur, { freq = 800, vol = 0.4, type = 'lowpass', out = master } = {}) => {
        const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        s.buffer = noise; f.type = type; f.frequency.value = freq;
        g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
        s.connect(f).connect(g).connect(out); s.start(at, rand(0, 1)); s.stop(at + dur + 0.05);
    };
    // Jingle Bells (James Lord Pierpont, 1857: public domain), chorus, with a bass line and sleigh bells
    const N = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, C3: 130.81, D3: 146.83, F3: 174.61, G3: 196.0 };
    const A = [['E5', 1], ['E5', 1], ['E5', 2], ['E5', 1], ['E5', 1], ['E5', 2], ['E5', 1], ['G5', 1], ['C5', 1.5], ['D5', 0.5], ['E5', 4],
        ['F5', 1], ['F5', 1], ['F5', 1.5], ['F5', 0.5], ['F5', 1], ['E5', 1], ['E5', 1], ['E5', 0.5], ['E5', 0.5]];
    const MELODY = [...A, ['E5', 1], ['D5', 1], ['D5', 1], ['E5', 1], ['D5', 2], ['G5', 2], ...A, ['G5', 1], ['G5', 1], ['F5', 1], ['D5', 1], ['C5', 4]];
    const BASS = ['C3', 'C3', 'C3', 'C3', 'F3', 'C3', 'D3', 'G3', 'C3', 'C3', 'C3', 'C3', 'F3', 'C3', 'G3', 'C3'];
    const BEAT = 0.3;
    let bar = 0, barAt = 0, beatAt = 0;
    function schedule() {
        if (!ac || !musicOn) return;
        if (nextNote < ac.currentTime) { nextNote = ac.currentTime + 0.1; barAt = nextNote; beatAt = nextNote; step = 0; bar = 0; }
        while (nextNote < ac.currentTime + 0.4) {
            const [n, b] = MELODY[step];
            tone(N[n], nextNote, b * BEAT * 0.95, { vol: 0.32, out: musicGain });
            tone(N[n] * 2, nextNote, b * BEAT * 0.5, { type: 'sine', vol: 0.06, out: musicGain });
            nextNote += b * BEAT;
            step = (step + 1) % MELODY.length;
        }
        while (barAt < ac.currentTime + 0.4) {
            tone(N[BASS[bar % BASS.length]], barAt, BEAT * 1.8, { type: 'sine', vol: 0.4, out: musicGain });
            tone(N[BASS[bar % BASS.length]] * 1.5, barAt + BEAT * 2, BEAT * 1.6, { type: 'sine', vol: 0.25, out: musicGain });
            barAt += BEAT * 4; bar++;
        }
        while (beatAt < ac.currentTime + 0.4) { hiss(beatAt, 0.08, { freq: 7000, type: 'highpass', vol: 0.18, out: musicGain }); beatAt += BEAT; }
    }
    return {
        init,
        get on() { return !!ac; },
        toggleMusic() {
            musicOn = !musicOn; localStorage.setItem('snowday.music', musicOn ? 'on' : 'off');
            if (ac) musicGain.gain.setTargetAtTime(musicOn ? 0.16 : 0, ac.currentTime, 0.1);
            return musicOn;
        },
        scrape(level) { if (ac) scrapeGain.gain.setTargetAtTime(clamp(level, 0, 0.35), ac.currentTime, 0.04); },
        thump(size) {
            if (!ac) return;
            const t = ac.currentTime;
            tone(110, t, 0.35, { type: 'sine', vol: clamp(0.25 + size * 0.1, 0.25, 0.9), slide: 40 });
            hiss(t, 0.3 + size * 0.1, { freq: 700, vol: clamp(0.2 + size * 0.08, 0.2, 0.7) });
        },
        bells(seconds = 2) {
            if (!ac) return;
            const t = ac.currentTime;
            for (let k = 0; k < seconds * 12; k++) { const at = t + k / 12 + rand(0, 0.03); tone(rand(2400, 3400), at, 0.18, { type: 'sine', vol: 0.08 }); tone(rand(4200, 5200), at, 0.1, { type: 'sine', vol: 0.04 }); }
        },
        chime(good = true) {
            if (!ac) return;
            const t = ac.currentTime, notes = good ? [523, 659, 784, 1047] : [784, 622, 523];
            notes.forEach((f, i) => tone(f, t + i * 0.09, 0.4, { vol: 0.25 }));
        },
        whoosh() { if (ac) hiss(ac.currentTime, 1.2, { freq: 500, vol: 0.5, type: 'bandpass' }); },
        rumble() { if (!ac) return; const t = ac.currentTime; hiss(t, 2.5, { freq: 220, vol: 0.9 }); tone(55, t, 2.2, { type: 'sawtooth', vol: 0.2, slide: 30 }); },
        boom() { if (!ac) return; const t = ac.currentTime; hiss(t, 0.7, { freq: 1500, vol: 0.35 }); tone(80, t, 0.5, { type: 'sine', vol: 0.3, slide: 35 }); },
        freeze() { if (!ac) return; const t = ac.currentTime; for (let k = 0; k < 8; k++) tone(rand(1800, 3000), t + k * 0.05, 0.4, { type: 'sine', vol: 0.08 }); },
        win() {
            if (!ac) return;
            const t = ac.currentTime;
            [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.7], [1047, 0.85]].forEach(([f, d]) => tone(f, t + d, 0.5, { vol: 0.3 }));
        },
    };
})();


// ---------------------------------------------------------------- the player and the shovel
// The shovel sits still in front of you like you're holding it steady: a wide red pusher on the
// ground, the pole running down to your hands at the bottom right. It only leans a little when you
// turn, shivers when it's frozen, and the snow you push piles up in front of the blade.
const EYE = 1.95;
const player = { x: 0, z: 0, yaw: 0, pitch: -0.42, y: EYE, load: 0, turn: 0, lastYaw: 0, vib: 0 };
const keys = new Set();
let locked = false;
const BLADE_AHEAD = 2.0;                 // metres in front of you where the blade clears
const HOLD = new THREE.Vector3(0, -0.6, -2.55), TILT = 0.36;

const shovelPivot = new THREE.Group();
viewRig.add(shovelPivot);
let shovel = null, bladeMat = null, pile = null;

function pileGeometry() {
    // a lumpy heap of snow
    const g = new THREE.SphereGeometry(0.5, 22, 12, 0, 2 * PI, 0, PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.18 * Math.sin(x * 17 + z * 11) * Math.cos(z * 13 - x * 5) + rand(-0.05, 0.05);
        p.setXYZ(i, x * n, y * n, z * n);
    }
    g.computeVertexNormals();
    return g;
}
function setupShovel() {
    shovel = models.shovel.clone(true);
    shovel.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = false;
        o.material = o.material.clone();
        o.material.side = THREE.DoubleSide;           // the curved blade is one sheet: seen from behind too
        if (o.material.name === 'blade') bladeMat = o.material;
        if (o.material.name === 'steel') { o.material.metalness = 0.35; o.material.roughness = 0.3; o.material.color.set(0xd6dde6); }
    });
    shovelPivot.add(shovel);
    pile = new THREE.Mesh(pileGeometry(), new THREE.MeshStandardMaterial({ color: 0xf6f9ff, emissive: 0x2a3040, roughness: 0.9, normalMap: SNOW_NORMAL }));
    pile.position.set(0, 0.24, -0.62);
    shovel.add(pile);
}
function placeShovel(dt, t, pushing, frozen) {
    // turning makes it lag behind and lean a little; pushing snow makes it judder
    const yawVel = (player.yaw - player.lastYaw) / Math.max(dt, 1e-3);
    player.lastYaw = player.yaw;
    player.turn += (clamp(yawVel, -4, 4) - player.turn) * Math.min(1, dt * 8);
    player.vib = pushing ? Math.sin(t * 55) * 0.004 * clamp(player.load / 30, 0.3, 1) : 0;
    const shiver = frozen ? Math.sin(t * 70) * 0.006 : 0;
    shovelPivot.position.set(HOLD.x - player.turn * 0.035 + shiver, HOLD.y + player.vib, HOLD.z);
    shovelPivot.rotation.set(TILT, -player.turn * 0.025, -player.turn * 0.03);
    const s = clamp(player.load / 45, 0, 1);
    pile.visible = s > 0.03 && !frozen;
    pile.scale.set(0.5 + s * 0.55, 0.15 + s * 0.65, 0.3 + s * 0.4);
}

const fwd = () => new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
const right = () => new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
let lastBlade = null;

function resetPlayer() {
    player.x = 0; player.z = F.d / 2 - 2; player.yaw = 0; player.pitch = -0.42; player.load = 0; player.lastYaw = 0; player.turn = 0;
    lastBlade = null;
}

function updatePlayer(dt, t) {
    const frozen = state.frozenUntil > t;
    let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyA')) mx -= 1;
    if (keys.has('KeyD')) mx += 1;
    if (keys.has('ArrowLeft')) player.yaw += 2.2 * dt;
    if (keys.has('ArrowRight')) player.yaw -= 2.2 * dt;
    const f = fwd(), r = right(), moving = !!(mx || mz);
    const b0 = new THREE.Vector3(player.x, 0, player.z).addScaledVector(f, BLADE_AHEAD);
    // deep snow in front of the blade slows you down
    let speed = (keys.has("ShiftLeft") || keys.has("ShiftRight")) ? 9.5 : 5.8;
    speed *= clamp(1 - depthAt(b0.x, b0.z) / 200, 0.45, 1);
    if (frozen) speed *= 0.55;
    if (moving) {
        const len = Math.hypot(mx, mz);
        player.x += (f.x * mz + r.x * mx) / len * speed * dt;
        player.z += (f.z * mz + r.z * mx) / len * speed * dt;
    }
    // bump into the tree, posts, cars, benches...
    for (const c of town.colliders) {
        const dx = player.x - c.x, dz = player.z - c.z, dist = Math.hypot(dx, dz), min = c.r + 0.45;
        if (dist < min && dist > 1e-4) { player.x = c.x + dx / dist * min; player.z = c.z + dz / dist * min; }
    }
    player.x = clamp(player.x, -F.w / 2 + 0.4, F.w / 2 - 0.4);
    player.z = clamp(player.z, -F.d / 2 + 0.4, F.d / 2 - 0.4);

    // the blade clears everything it passes over (in small steps so running doesn't skip any)
    const b = new THREE.Vector3(player.x, 0, player.z).addScaledVector(f, BLADE_AHEAD);
    let got = 0;
    if (!frozen && !state.finishing) {
        const from = lastBlade || b, dist = from.distanceTo(b), steps = Math.max(1, Math.ceil(dist / (CELL * 0.7)));
        for (let k = 1; k <= steps; k++) {
            const p = from.clone().lerp(b, k / steps);
            got += clearRect(p.x, p.z, r.x, r.z, f.x, f.z, 0.56, CELL * 0.8);
        }
        if (got > 0) {
            const n = Math.min(16, 2 + got / 10);
            for (let k = 0; k < n; k++) {
                const side = rand(-0.6, 0.6), up = rand(1.2, 3.4);
                spray.spawn(b.x + r.x * side + f.x * 0.3, rand(0.15, 0.5), b.z + r.z * side + f.z * 0.3,
                    f.x * rand(1.5, 3.5) + r.x * side * 2.5, up, f.z * rand(1.5, 3.5) + r.z * side * 2.5, rand(0.5, 1.1), null, 1.6);
            }
        }
    }
    lastBlade = b;
    player.load = player.load * Math.exp(-dt * (moving ? 1.2 : 3)) + got * 0.35;
    sfx.scrape(moving && !frozen ? 0.04 + clamp(got / 25, 0, 0.3) : 0);

    // you stand on top of the snow
    player.y += (EYE + depthAt(player.x, player.z) * UNIT_H - player.y) * Math.min(1, dt * 8);
    const shake = state.shakeUntil > t ? (state.shakeUntil - t) * state.shakePower : 0;
    camera.position.set(player.x + rand(-1, 1) * shake, player.y + rand(-1, 1) * shake, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    // the shovel stays down on the ground: looking up or down only moves it a little on screen
    viewRig.position.copy(camera.position);
    viewRig.rotation.set(-0.42 + (player.pitch + 0.42) * 0.3, player.yaw, 0, 'YXZ');
    placeShovel(dt, t, moving && got > 0, frozen);
    moonFollow(player.x, player.z);
    placeLights(t);
}

addEventListener('keydown', e => {
    keys.add(e.code);
    if (e.code === 'KeyM') toast(sfx.toggleMusic() ? 'Music on' : 'Music off');
    if (e.code === 'KeyN') { setTimeOfDay(timeOfDay === 'day' ? 'night' : 'day'); toast(timeOfDay === 'day' ? 'Sunny day' : 'Christmas night'); }
    if (e.code === 'KeyR' && $('start').classList.contains('hidden')) restartLevel();
    if (e.code === 'F11' && window.snowdayApp) { e.preventDefault(); window.snowdayApp.fullscreen(); }
    if (TEST) {
        const tests = { Digit1: ['snow', 100], Digit2: ['snow', 1000], Digit3: ['santa', 20000], Digit4: ['blizzard', 12], Digit5: ['freeze', 8], Digit6: ['melt', 50000], Digit7: ['avalanche', 1], Digit8: ['snow', 25000] };
        if (tests[e.code]) gift({ action: tests[e.code][0], amount: tests[e.code][1], from: 'Tester' });
        if (e.code === 'BracketRight') startLevel(Math.min(LEVELS.length - 1, state.level + 1));
        if (e.code === 'BracketLeft') startLevel(Math.max(0, state.level - 1));
        if (e.code === 'KeyK') melt(F.total);
    }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// look with the mouse: captured (pointer lock), or by dragging where it can't be captured
addEventListener('mousemove', e => {
    if (!locked && !(e.buttons & 1 && $('start').classList.contains('hidden'))) return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch = clamp(player.pitch - e.movementY * 0.0016, -0.95, 0.2);
});
function capture() {
    try { const p = renderer.domElement.requestPointerLock(); if (p?.catch) p.catch(() => { }); } catch { }
}
$('start').addEventListener('click', () => { sfx.init(); $('start').classList.add('hidden'); capture(); });
renderer.domElement.addEventListener('click', () => { if (!locked) capture(); });
document.addEventListener('pointerlockchange', () => {
    const was = locked;
    locked = document.pointerLockElement === renderer.domElement;
    if (was && !locked) { $('start').classList.remove('hidden'); $('start').querySelector('.go').textContent = 'CLICK TO KEEP SHOVELLING'; }
});

// ---------------------------------------------------------------- the game: levels and gifts
const state = { level: 0, finishing: false, startedAt: 0, frozenUntil: 0, blizzardUntil: 0, shakeUntil: 0, shakePower: 0, pending: [],
    adders: new Map(), removers: new Map() };   // this level's biggest snow adders and melters, for the end screen
function credit(board, who, n) { if (n > 0 && who) board.set(who, (board.get(who) || 0) + n); }
function showBoard(seconds) {
    const list = (board, cls, title, none) => {
        const top = [...board].sort((a, b) => b[1] - a[1]).slice(0, 5);
        const rows = top.map(([who, n], i) => `<li><span><b>${i + 1}</b>${esc(who)}</span><span>${fmt(n)}</span></li>`).join('');
        return `<div class="col ${cls}"><h3 class="chunky" style="-webkit-text-stroke-width:4px">${title}</h3>${rows ? `<ol>${rows}</ol>` : `<div class="none">${none}</div>`}</div>`;
    };
    $('board').innerHTML = list(state.adders, 'add', 'BIGGEST SNOW ADDERS', 'Nobody added snow this level') + list(state.removers, 'melt', 'BIGGEST MELTERS', 'Nobody melted snow this level');
    $('board').classList.add('show');
    setTimeout(() => $('board').classList.remove('show'), seconds * 1000);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const balls = [];
let sleighs = [];
const ballMat = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.85 });

function startLevel(i, saved = null) {
    state.level = i;
    state.finishing = false;
    state.startedAt = performance.now() / 1000;
    buildField(i, saved);
    resetPlayer();
    $('level').textContent = `LEVEL ${i + 1} / ${LEVELS.length}`;
    state.adders.clear();
    state.removers.clear();
    shownCount = F.total;
    save();
    const queued = state.pending.splice(0);
    for (const g of queued) gift(g);
}
function restartLevel() { startLevel(state.level); toast('Level restarted'); }

function levelCleared() {
    state.finishing = true;
    melt(F.total);
    sfx.win();
    const last = state.level === LEVELS.length - 1;
    banner(last ? 'YOU BEAT SNOW DAY!' : `LEVEL ${state.level + 1} CLEARED!`, last ? 'Merry Christmas! Back to level 1 in 12 seconds' : `Get ready for level ${state.level + 2}: an even bigger town`, last ? 11 : 5);
    showBoard(last ? 11 : 5.5);
    const until = performance.now() / 1000 + (last ? 11 : 5);
    const fw = setInterval(() => { if (performance.now() / 1000 > until) return clearInterval(fw); firework(); }, last ? 280 : 450);
    setTimeout(() => startLevel(last ? 0 : state.level + 1), last ? 12000 : 6000);
}

// where a gift's snow lands: mostly in front of you, so you see it coming and have to deal with it
function landingSpot(sigma) {
    const m = Math.min(sigma, 3) + 0.5;
    let x, z;
    if (Math.random() < 0.7) {
        const f = fwd(), r = right(), ahead = rand(4, 14), side = rand(-6, 6);
        x = player.x + f.x * ahead + r.x * side; z = player.z + f.z * ahead + r.z * side;
    } else { x = player.x + rand(-30, 30); z = player.z + rand(-30, 30); }
    return [clamp(x, -F.w / 2 + m, F.w / 2 - m), clamp(z, -F.d / 2 + m, F.d / 2 - m)];
}
function dropBall(amount, x, z, y = 34) {
    const sigma = sigmaFor(amount);
    if (x === undefined) [x, z] = landingSpot(sigma);
    const r = clamp(sigma * 0.75, 0.35, 4.5);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), ballMat);
    m.castShadow = true;
    m.position.set(x, y, z);
    scene.add(m);
    balls.push({ m, amount, sigma, r, vy: -10 });
}
function updateBalls(dt) {
    for (let k = balls.length - 1; k >= 0; k--) {
        const b = balls[k];
        b.vy -= 30 * dt;
        b.m.position.y += b.vy * dt;
        b.m.rotation.x += dt * 3;
        if (b.m.position.y > b.r * 0.5) continue;
        scene.remove(b.m);
        b.m.geometry.dispose();
        balls.splice(k, 1);
        if (state.finishing) { state.pending.push({ action: 'snow', amount: b.amount, silent: true }); continue; }
        addSnow(b.m.position.x, b.m.position.z, b.amount, b.sigma);
        puff(b.m.position.x, b.m.position.z, Math.min(160, 20 + b.amount / 40), 2 + b.sigma * 2);
        const near = Math.hypot(b.m.position.x - player.x, b.m.position.z - player.z);
        const size = Math.log10(Math.max(10, b.amount)) - 1;
        if (near < 10 + b.sigma * 3) shake(0.35, 0.03 + size * 0.04);
        sfx.thump(size);
    }
}
function shake(seconds, power) {
    const t = performance.now() / 1000;
    state.shakeUntil = Math.max(state.shakeUntil, t + seconds);
    state.shakePower = Math.max(power / seconds, state.shakeUntil > t ? state.shakePower : 0);
}

// Santa flies across just in front of you, dropping the snow in a line
function santa(amount) {
    const s = models.sleigh.clone();
    s.scale.setScalar(1.3);
    const dir = Math.random() < 0.5 ? 1 : -1, f = fwd();
    const z = clamp(player.z + f.z * 8, -F.d / 2 + 2, F.d / 2 - 2), x0 = clamp(player.x - 22, -F.w / 2 + 1, F.w / 2 - 1), x1 = clamp(player.x + 22, -F.w / 2 + 1, F.w / 2 - 1);
    s.position.set(dir > 0 ? x0 - 80 : x1 + 80, 12, z);
    s.rotation.y = face(dir, 0) + PI;
    scene.add(s);
    sleighs.push({ s, dir, z, x0, x1, amount, drops: 12, dropped: 0 });
    sfx.bells(4);
    sfx.whoosh();
}
function updateSleighs(dt) {
    for (const k of [...sleighs]) {
        k.s.position.x += k.dir * 26 * dt;
        k.s.position.y = 12 + Math.sin(k.s.position.x * 0.15) * 0.8;
        k.s.rotation.z = Math.sin(k.s.position.x * 0.15) * 0.05;
        const x = k.s.position.x, span = k.x1 - k.x0;
        const done = clamp(((k.dir > 0 ? x - k.x0 : k.x1 - x)) / span, 0, 1);
        while (k.dropped < Math.floor(done * k.drops)) {
            k.dropped++;
            dropBall(k.amount / k.drops, clamp(x, -F.w / 2 + 1, F.w / 2 - 1), clamp(k.z + rand(-2.5, 2.5), -F.d / 2 + 1, F.d / 2 - 1), k.s.position.y - 1);
        }
        if (done >= 1 && Math.abs(x - (k.dir > 0 ? k.x1 : k.x0)) > 90) {
            while (k.dropped < k.drops) { k.dropped++; dropBall(k.amount / k.drops); }
            scene.remove(k.s);
            sleighs = sleighs.filter(o => o !== k);
        }
    }
}

// one gift from Unbound
function gift(msg) {
    const action = String(msg.action || 'snow').toLowerCase().replace(/[^a-z]/g, '');
    const amount = Math.max(1, +msg.amount || 1), from = msg.from || 'someone', image = msg.image || null;
    const now = performance.now() / 1000;
    if (state.finishing && action !== 'freeze') {
        // the next level gets it
        state.pending.push(msg);
        if (!msg.silent) pop(action === 'melt' ? `-${fmt(amount)}` : action === 'blizzard' ? 'BLIZZARD' : action === 'avalanche' ? 'AVALANCHE' : `+${fmt(amount)}`, `${from} (next level)`, image, 'event');
        return;
    }
    switch (action) {
        case 'blizzard':
            state.blizzardUntil = Math.max(state.blizzardUntil, now) + Math.min(120, amount);
            credit(state.adders, from, Math.min(F.start * 0.006, 9000) * Math.min(120, amount));
            pop('BLIZZARD', `${from} · ${amount}s`, image, 'bad');
            sfx.whoosh();
            break;
        case 'santa':
            santa(amount);
            credit(state.adders, from, amount);
            pop(`+${fmt(amount)}`, `${from} sent Santa!`, image, 'bad');
            break;
        case 'freeze':
            state.frozenUntil = Math.max(state.frozenUntil, now) + Math.min(60, amount);
            pop('FROZEN', `${from} · ${amount}s`, image, 'event');
            sfx.freeze();
            break;
        case 'melt': {
            const got = melt(amount);
            credit(state.removers, from, got);
            pop(`-${fmt(got)}`, `${from} melted snow`, image, 'good');
            flash('#ffb347');
            sfx.chime(true);
            break;
        }
        case 'avalanche': {
            const got = avalanche(player.x, player.z);
            credit(state.adders, from, got);
            pop(`+${fmt(got)}`, `${from}: AVALANCHE!`, image, 'bad');
            shake(2.2, 0.12);
            flash('#ffffff');
            sfx.rumble();
            for (let k = 0; k < 40; k++) puff(player.x + rand(-25, 25), player.z + rand(-25, 25), 10, 4);
            break;
        }
        default:
            dropBall(amount);
            if (!msg.silent) { pop(`+${fmt(amount)}`, from, image, 'bad'); credit(state.adders, from, amount); }
    }
}

// ---------------------------------------------------------------- the HUD
let shownCount = 0, lastShown = -1;
function pop(amount, who, image, kind) {
    const el = document.createElement('div');
    el.className = `pop chunky ${kind}`;
    const pops = $('pops');
    el.style.top = `${10 + (pops.children.length % 4) * 58}px`;
    el.innerHTML = `<div class="amt"></div><div class="who">${image ? '<img alt="">' : ''}<span></span></div>`;
    el.querySelector('.amt').textContent = amount;
    el.querySelector('span').textContent = who;
    if (image) { const img = el.querySelector('img'); img.onerror = () => img.remove(); img.src = image; }
    pops.appendChild(el);
    setTimeout(() => el.remove(), 2300);
    if (kind !== 'good') sfx.chime(false);
}
let bannerTimer = null;
function banner(big, small, seconds) {
    $('bannerBig').textContent = big;
    $('bannerSmall').textContent = small;
    $('banner').classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => $('banner').classList.remove('show'), seconds * 1000);
}
function toast(text) { banner('', text, 1.2); }
function flash(color) {
    const f = $('flash');
    f.style.background = color;
    f.style.transition = 'none'; f.style.opacity = '0.7';
    requestAnimationFrame(() => { f.style.transition = 'opacity .8s'; f.style.opacity = '0'; });
}
function updateHud(dt, t) {
    const before = shownCount;
    shownCount += (F.total - shownCount) * Math.min(1, dt * 10);
    if (Math.abs(F.total - shownCount) < 1) shownCount = F.total;
    const n = Math.max(0, Math.ceil(shownCount));
    if (n !== lastShown) {
        $('count').textContent = fmt(n);
        $('count').classList.toggle('up', shownCount > before + 0.5);
        lastShown = n;
    }
    $('barFill').style.width = `${clamp(100 * (1 - F.total / F.start), 0, 100)}%`;
    const fx = [];
    if (state.blizzardUntil > t) fx.push(`<div class="fx">🌨️ Blizzard ${Math.ceil(state.blizzardUntil - t)}s</div>`);
    if (state.frozenUntil > t) fx.push(`<div class="fx">🧊 Shovel frozen ${Math.ceil(state.frozenUntil - t)}s</div>`);
    if (sleighs.length) fx.push('<div class="fx hot">🎅 Santa is flying over!</div>');
    const html = fx.join('');
    if ($('effects').innerHTML !== html) $('effects').innerHTML = html;
    $('frost').classList.toggle('on', state.frozenUntil > t);
    if (bladeMat) bladeMat.color.set(state.frozenUntil > t ? 0x9fe3ff : 0xe0161e);
}

// ---------------------------------------------------------------- the link to Unbound
async function connect() {
    let port = +QUERY.get('ws') || 0;
    if (!port) { try { port = (await (await fetch('/api/snowday')).json()).wsPort; } catch { } }
    port ||= 8765;
    let socket;
    try { socket = new WebSocket(`ws://127.0.0.1:${port}`); } catch { return setTimeout(connect, 3000); }
    socket.onopen = () => { $('link').classList.add('on'); $('linkText').textContent = 'TikTok gifts on'; };
    socket.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'gift') gift(m);
    };
    socket.onclose = () => { $('link').classList.remove('on'); $('linkText').textContent = 'Waiting for Unbound…'; setTimeout(connect, 2500); };
    socket.onerror = () => { };
}

// ---------------------------------------------------------------- keeping your progress
const SAVE_KEY = 'snowday.save.v2';
function save() {
    if (!F) return;
    const q = new Uint16Array(F.v.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.min(65535, Math.round(F.v[i] * 100));
    let s = '';
    const bytes = new Uint8Array(q.buffer);
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ level: state.level, snow: btoa(s) })); } catch { }
}
function load() {
    try {
        const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
        if (!d || !(d.level >= 0 && d.level < LEVELS.length)) return null;
        const bin = atob(d.snow), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const q = new Uint16Array(bytes.buffer), v = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) v[i] = q[i] / 100;
        return { level: d.level, v };
    } catch { return null; }
}
setInterval(() => { if (!state.finishing) save(); }, 5000);
addEventListener('beforeunload', save);

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let lastFix = 0;
function frame() {
    const dt = Math.min(0.05, clock.getDelta()), t = performance.now() / 1000;
    updatePlayer(dt, t);
    updateBalls(dt);
    updateSleighs(dt);
    const heavy = state.blizzardUntil > t;
    if (heavy && !state.finishing) {
        // the blizzard buries the area around you
        const rate = Math.min(F.start * 0.006, 9000);
        for (let k = 0; k < 6; k++) addSnow(clamp(player.x + rand(-30, 30), -F.w / 2, F.w / 2), clamp(player.z + rand(-30, 30), -F.d / 2, F.d / 2), rate * dt / 6, 0.7);
    }
    scene.fog.density += ((heavy ? 0.03 : baseFog) - scene.fog.density) * Math.min(1, dt * 2);
    auroraU.time.value = t;
    updateFlakes(dt, t, heavy);
    spray.update(dt);
    fireworks.update(dt);
    refreshSnow();
    if (t - lastFix > 1) { F.total = sumSnow(); lastFix = t; }
    if (!state.finishing && F.total <= Math.max(60, F.start * 0.002) && t - state.startedAt > 2) levelCleared();
    updateHud(dt, t);
    composer.render();
    requestAnimationFrame(frame);
}

// (test page only) renders the cover picture for Unbound's games screen: 800 x 1200 with the title
async function cover(gameId) {
    const W = 800, H = 1200;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    player.load = 40;
    placeShovel(0.016, 0, false, false);
    composer.render();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(renderer.domElement, 0, 0, W, H);
    const shade = g.createLinearGradient(0, 0, 0, 380);
    shade.addColorStop(0, 'rgba(8,10,40,.75)'); shade.addColorStop(1, 'rgba(8,10,40,0)');
    g.fillStyle = shade; g.fillRect(0, 0, W, 380);
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.font = '900 150px "Arial Black", "Segoe UI Black", sans-serif';
    g.lineWidth = 22; g.strokeStyle = '#b3121b'; g.strokeText('SNOW', W / 2, 190); g.fillStyle = '#ffffff'; g.fillText('SNOW', W / 2, 190);
    g.strokeStyle = '#0d5a24'; g.strokeText('DAY', W / 2, 330); g.fillStyle = '#4dff6a'; g.fillText('DAY', W / 2, 330);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
    const r = await fetch(`/api/games/cover?id=${encodeURIComponent(gameId)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    dispatchEvent(new Event('resize'));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    return r.status;
}

async function main() {
    await Promise.all(MODEL_NAMES.map(n => new Promise((ok, fail) => loader.load(`models/${n}.glb?v=${MODELS_VERSION}`, g => {
        g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        models[n] = g.scene;
        ok();
    }, undefined, fail))));
    detailModels();
    buildScenery();
    setTimeOfDay(timeOfDay);
    setupShovel();
    const saved = load();
    startLevel(saved ? saved.level : 0, saved ? saved.v : null);
    if (TEST) window.snowday = { player, state, gift, camera, get field() { return F; }, cover, startLevel };
    connect();
    frame();
}
main().catch(e => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:40px;left:20px;color:#f88">${String(e.stack || e)}</pre>`); });
