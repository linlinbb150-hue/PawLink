import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const sceneEl = document.querySelector('#scene');
const captureTest = new URLSearchParams(location.search).has('captureTest');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, .1, 100); camera.position.set(0, 1.2, 7.4);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Filmic tone mapping keeps the highlights of glossy textures from clipping to
// white, which is what made the characters look like cheap plastic toys.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.34;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneEl.append(renderer.domElement);
function resizeRenderer() { const { width, height } = sceneEl.getBoundingClientRect(); if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); // updateStyle must stay on: without a CSS size the canvas is laid out at its device-pixel size, which at devicePixelRatio > 1 draws the pet oversized, clipped and off-centre.
  renderer.setSize(width, height); }
new ResizeObserver(resizeRenderer).observe(sceneEl); resizeRenderer();
// A procedural studio environment gives every preset a soft, directional
// ambient term, so shapes read as volumes instead of flat shaded areas.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
scene.environmentIntensity = 1;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xffffff, 0x7c8f78, 1.5));
const keyLight = new THREE.DirectionalLight(0xfff3e2, 2.4);
keyLight.position.set(2.6, 5, 5.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.radius = 4;
keyLight.shadow.bias = -.0012;
keyLight.shadow.normalBias = .025;
Object.assign(keyLight.shadow.camera, { left: -2.4, right: 2.4, top: 2.8, bottom: -2.8, near: .5, far: 14 });
keyLight.shadow.camera.updateProjectionMatrix();
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xdce7ff, .9);
fillLight.position.set(-3.4, 2.2, -2.4);
scene.add(fillLight);
// Straight-on fill so the face and the front of the outfit never fall into a
// silhouette; the key light alone leaves the chest area in shadow.
const frontFill = new THREE.DirectionalLight(0xfffaf0, 1.7);
frontFill.position.set(.4, 2.2, 6.5);
scene.add(frontFill);
// Soft contact shadow so the pet reads as standing on a surface instead of
// floating in an empty window.
const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ color: 0x1d2a1c, opacity: .3 }));
contactShadow.receiveShadow = true;
contactShadow.rotation.x = -Math.PI / 2;
scene.add(contactShadow);
const root = new THREE.Group(); scene.add(root); let avatar; let mixer; let activeAction; let actions = {}; let name = '团子'; let userYaw = 0; let autoYaw = 0; let jumpUntil = 0; let avatarTargetHeight = 3; let avatarScaleFactor = 1; let avatarFloorFraction = .04;
function fallbackCat() { const cat = new THREE.Group(); const fur = new THREE.MeshStandardMaterial({ color: 0xaeb9bd, roughness: .9 }); const pale = new THREE.MeshStandardMaterial({ color: 0xe9e8df, roughness: 1 }); const dark = new THREE.MeshStandardMaterial({ color: 0x30483b });
  const add = (geometry, material, x, y, z, s=1) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.scale.setScalar(s); cat.add(mesh); return mesh; };
  add(new THREE.SphereGeometry(1.16,32,24),fur,0,-.25,0); add(new THREE.SphereGeometry(.96,32,24),fur,0,1.05,.1); add(new THREE.SphereGeometry(.56,26,20),pale,0,.78,.85); add(new THREE.ConeGeometry(.5,.9,3),fur,-.57,1.8,.1,.8).rotation.z=-.22; add(new THREE.ConeGeometry(.5,.9,3),fur,.57,1.8,.1,.8).rotation.z=.22;
  add(new THREE.SphereGeometry(.12,16,12),dark,-.33,1.18,.88); add(new THREE.SphereGeometry(.12,16,12),dark,.33,1.18,.88); add(new THREE.SphereGeometry(.1,16,12),new THREE.MeshStandardMaterial({color:0x916b70}),0,.93,1.03); const tail=add(new THREE.TorusGeometry(.66,.13,12,30,Math.PI*1.25),fur,1.08,-.18,-.1);tail.rotation.z=-.55; return cat; }
function dressForStage(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.filter(Boolean).forEach((material) => {
      if (!material.isMeshStandardMaterial) return;
      material.envMapIntensity = .75;
      // Stylised characters look better with a matte finish; the baked
      // textures already carry the highlights, so a glossy surface doubles up.
      if (Number.isFinite(material.roughness)) material.roughness = Math.max(material.roughness, .62);
    });
  });
}
// Skinned models are only measured correctly once their bind pose matches the
// pose on screen, which is what every bundled asset now guarantees.  A bone
// based fallback was tried before and had to go: rigs such as the maliao one
// carry IK target bones that stick far outside the body and would blow the
// bounding box up by a factor of two.
function measureAvatar(object) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}
function frameAvatar() {
  if (!avatar) return;
  // Measure from a clean transform every time, so the function can be re-run
  // after an idle clip has posed the model.
  avatar.scale.setScalar(1);
  avatar.position.set(0, 0, 0);
  avatar.rotation.set(0, 0, 0);
  const size = measureAvatar(avatar).getSize(new THREE.Vector3());
  const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  // Height drives the fit so every preset has a similar presence, with a width
  // cap for the wide ones (arms out, ears, tails).
  const fit = THREE.MathUtils.clamp(Math.min(avatarTargetHeight / size.y, (viewHeight * camera.aspect * .62) / size.x) * avatarScaleFactor, .0001, 40);
  avatar.scale.setScalar(fit);
  const scaled = measureAvatar(avatar);
  const center = scaled.getCenter(new THREE.Vector3());
  // Anchor the feet to a fixed floor line instead of the body centre, so tall
  // and short presets all stand on the same ground.
  const floorY = camera.position.y - viewHeight / 2 + viewHeight * avatarFloorFraction;
  avatar.position.set(-center.x, floorY - scaled.min.y, -center.z);
  contactShadow.position.set(0, floorY - .005, 0);
}
function setAvatar(object) {
  root.clear(); avatar = object;
  dressForStage(avatar);
  root.add(avatar);
  frameAvatar();
}
setAvatar(fallbackCat());
function playAction(name) { const next = actions[name] || actions.idle; if (!next) return; if (next !== activeAction) activeAction?.fadeOut(.18); next.reset().setEffectiveTimeScale(1).fadeIn(.18).play(); activeAction = next; }
function makeMaliaoActions(object) {
  const normaliseBoneName = (value) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const findBone = (name) => {
    let match;
    object.traverse((node) => { if (!match && node.isBone && normaliseBoneName(node.name) === normaliseBoneName(name)) match = node; });
    return match;
  };
  const boneNames = ['ArmR1.L', 'ArmR2.L', 'Hand.L', 'ArmR1.R', 'ArmR2.R', 'Hand.R', 'Spine2', 'Head', 'LegR1.L', 'LegR1.R'];
  const bones = Object.fromEntries(boneNames.map((name) => [name, findBone(name)]));
  const neutral = [0, 0, 0];
  const makeAction = (name, times, poses) => {
    const tracks = Object.entries(poses).flatMap(([boneName, rotations]) => {
      const bone = bones[boneName];
      if (!bone) return [];
      const base = bone.quaternion.clone();
      const values = [];
      rotations.forEach(([x, y, z]) => {
        const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
        const posed = base.clone().multiply(delta).normalize();
        values.push(posed.x, posed.y, posed.z, posed.w);
      });
      // Names such as ArmR1.R contain dots, so bind by UUID instead.
      return [new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, values)];
    });
    const action = mixer.clipAction(new THREE.AnimationClip(name, times.at(-1), tracks));
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    return action;
  };
  const short = [0, .2, .42, .62, .82, 1.04, 1.3];
  const long = [0, .25, .5, .75, 1, 1.25, 1.5, 1.75];
  return {
    interaction: makeAction('maliao-interaction', short, {
      // Shoulder-height wave. The arm stays outside the head silhouette to avoid clipping.
      'ArmR1.R': [neutral, [-.08, .04, 1.25], [-.1, .05, 1.72], [-.1, .05, 1.72], [-.1, .05, 1.72], [-.06, .03, .8], neutral],
      'ArmR2.R': [neutral, [0, -.08, -.45], [0, -.1, -.68], [0, -.1, -.68], [0, -.1, -.68], [0, -.04, -.3], neutral],
      'Hand.R': [neutral, neutral, [0, 0, -.35], [0, 0, .35], [0, 0, -.35], neutral, neutral],
      Spine2: [neutral, [0, 0, -.03], [0, 0, -.05], [0, 0, -.03], [0, 0, -.05], neutral, neutral]
    }),
    dance: makeAction('maliao-dance', long, {
      'ArmR1.L': [neutral, [0, 0, -.35], [0, 0, -.72], [0, 0, -.25], [0, 0, -.72], [0, 0, -.25], [0, 0, -.45], neutral],
      'ArmR1.R': [neutral, [0, 0, .35], [0, 0, .25], [0, 0, .72], [0, 0, .25], [0, 0, .72], [0, 0, .45], neutral],
      Spine2: [neutral, [0, 0, .12], [0, 0, .2], [0, 0, -.2], [0, 0, .2], [0, 0, -.2], [0, 0, -.1], neutral],
      'LegR1.L': [neutral, [0, 0, -.08], [0, 0, -.14], neutral, [0, 0, -.14], neutral, [0, 0, -.08], neutral],
      'LegR1.R': [neutral, [0, 0, .08], neutral, [0, 0, .14], neutral, [0, 0, .14], [0, 0, .08], neutral]
    }),
    sing: makeAction('maliao-sing', long, {
      // One hand near the chest, with head and torso moving to the beat.
      'ArmR1.R': [neutral, [0, -.08, .38], [0, -.1, .58], [0, -.1, .58], [0, -.1, .58], [0, -.1, .58], [0, -.05, .3], neutral],
      'ArmR2.R': [neutral, [0, -.15, -.65], [0, -.2, -.95], [0, -.2, -.95], [0, -.2, -.95], [0, -.2, -.95], [0, -.08, -.42], neutral],
      Head: [neutral, [0, .08, 0], [0, -.12, 0], [0, .12, 0], [0, -.12, 0], [0, .12, 0], [0, -.06, 0], neutral],
      Spine2: [neutral, [.03, 0, 0], [-.03, 0, 0], [.04, 0, 0], [-.03, 0, 0], [.04, 0, 0], neutral, neutral]
    })
  };
}
function makeProtagonistActions(object, idleClip) {
  const names = ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'Spine', 'Neck', 'Head'];
  const bones = Object.fromEntries(names.map((name) => [name, object.getObjectByName(name)]));
  const neutral = [0, 0, 0];
  const makeAction = (name, times, poses) => {
    const animatedBones = Object.keys(poses).map((boneName) => bones[boneName]).filter(Boolean);
    const tracks = (idleClip?.tracks || []).filter((track) => !animatedBones.some((bone) => track.name.startsWith(`${bone.name}.`))).map((track) => track.clone());
    tracks.push(...Object.entries(poses).flatMap(([boneName, rotations]) => {
      const bone = bones[boneName];
      if (!bone) return [];
      const base = bone.quaternion.clone();
      const values = [];
      rotations.forEach(([x, y, z]) => {
        const posed = base.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))).normalize();
        values.push(posed.x, posed.y, posed.z, posed.w);
      });
      return [new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, values)];
    }));
    const action = mixer.clipAction(new THREE.AnimationClip(name, times.at(-1), tracks));
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    return action;
  };
  const times = [0, .25, .5, .75, 1, 1.25, 1.5];
  return {
    interaction: makeAction('protagonist-interaction', times, {
      RightArm: [neutral, [0, 0, -.38], [0, 0, -.62], [0, 0, -.62], [0, 0, -.62], [0, 0, -.3], neutral],
      RightForeArm: [neutral, [0, .2, -.32], [0, .25, -.52], [0, .25, -.52], [0, .25, -.52], [0, .12, -.24], neutral],
      RightHand: [neutral, neutral, [0, 0, -.35], [0, 0, .35], [0, 0, -.35], neutral, neutral]
    }),
    dance: makeAction('protagonist-dance', times, {
      RightArm: [neutral, [0, 0, -.45], [0, 0, -.85], [0, 0, -.25], [0, 0, -.85], [0, 0, -.4], neutral],
      LeftArm: [neutral, [0, 0, .45], [0, 0, .25], [0, 0, .85], [0, 0, .25], [0, 0, .4], neutral],
      Spine: [neutral, [0, 0, .12], [0, 0, .22], [0, 0, -.22], [0, 0, .22], [0, 0, -.12], neutral]
    }),
    sing: makeAction('protagonist-sing', times, {
      RightArm: [neutral, [0, 0, -.25], [0, 0, -.48], [0, 0, -.48], [0, 0, -.48], [0, 0, -.25], neutral],
      RightForeArm: [neutral, [0, .25, -.75], [0, .3, -1.1], [0, .3, -1.1], [0, .3, -1.1], [0, .15, -.55], neutral],
      Head: [neutral, [0, .1, 0], [0, -.14, 0], [0, .14, 0], [0, -.14, 0], [0, .08, 0], neutral],
      Spine: [neutral, [.03, 0, 0], [-.03, 0, 0], [.04, 0, 0], [-.03, 0, 0], neutral, neutral]
    })
  };
}
function loadFbxModel(url) {
  const loader = new FBXLoader();
  loader.load(url, (model) => {
    setAvatar(model); mixer = new THREE.AnimationMixer(model); actions = {};
    const animationDir = new URL('../Animations/', url);
    Promise.all(['idle', 'run', 'jump'].map((name) => new Promise((resolve) => loader.load(
      new URL(`${name}.fbx`, animationDir).href,
      (animation) => resolve([name, animation.animations[0]]), undefined,
      () => resolve([name, null])
    )))).then((loaded) => {
      loaded.forEach(([name, clip]) => { if (clip) { clip.name = name; actions[name] = mixer.clipAction(clip); } });
      actions['gesture-positive'] ||= actions.idle; actions.dance ||= actions.idle;
      playAction('idle'); say('我有新形象啦！', '开心地待命');
    });
  }, undefined, () => say('人物模型加载失败，暂时使用默认形象。', '稍后再试'));
}
// Every bundled model is authored Y-up and stands on its own feet, so no
// per-model orientation fix is needed here.  kenney-body-maliao.glb used to be
// a Z-up T-pose that had to be rotated and re-posed at runtime; tools/polish_maliao.py
// now bakes a sane rest pose into the asset instead.
function loadModel(url) { if (url?.toLowerCase().endsWith('.fbx')) { loadFbxModel(url); return; } new GLTFLoader().load(url, (gltf) => { const isMaliaoOriginal = url.includes('maliao-original-animated.glb'); const isMaliaoLegacy = url.includes('kenney-body-maliao.glb'); const isMaliao = isMaliaoOriginal || isMaliaoLegacy; const isProtagonist = url.includes('kenney-protagonist.glb'); mixer = gltf.animations.length || isMaliao || isProtagonist ? new THREE.AnimationMixer(gltf.scene) : null; actions = {}; gltf.animations.forEach((clip) => { actions[clip.name] = mixer.clipAction(clip); }); if (isMaliaoOriginal) { const originalClip = gltf.animations.find((clip) => clip.name.includes('FINAL_BOWSER_RAISE_HAND')); if (originalClip) { const rootPositionTracks = new Set(['nw4f_root.position', 'AllRoot.position', 'JointRoot.position', 'Hip.position']); const anchoredClip = new THREE.AnimationClip('interaction', originalClip.duration, originalClip.tracks.filter((track) => !rootPositionTracks.has(track.name)).map((track) => track.clone())); actions.interaction = mixer.clipAction(anchoredClip); actions.interaction.setLoop(THREE.LoopOnce, 1); actions.interaction.clampWhenFinished = false; const standingFrame = 70; actions.idle = mixer.clipAction(THREE.AnimationUtils.subclip(anchoredClip, 'idle', standingFrame, standingFrame + 1, 30)); } } if (isProtagonist && actions.idle) { actions.idle.play(); mixer.update(.001); } if (isMaliaoLegacy) Object.assign(actions, makeMaliaoActions(gltf.scene)); if (isProtagonist) Object.assign(actions, makeProtagonistActions(gltf.scene, gltf.animations.find((clip) => clip.name === 'idle'))); actions.idle?.stop(); actions.interaction ||= actions['gesture-positive'] || actions.idle; actions.dance ||= actions.idle; actions.sing ||= actions.dance || actions.idle; avatarTargetHeight = isProtagonist ? 2.25 : isMaliaoOriginal ? 2.45 : 3; avatarScaleFactor = 1; avatarFloorFraction = isMaliaoOriginal ? .14 : .04; setAvatar(gltf.scene); if (mixer) mixer.addEventListener('finished', (event) => { if (event.action !== actions.idle) playAction('idle'); }); if (actions.idle) { actions.idle.reset().setEffectiveWeight(1).play(); activeAction = actions.idle; } mixer?.update(.001); frameAvatar(); say('我有新形象啦！', '开心地待命'); }, undefined, () => say('3D 模型加载失败，暂时使用默认形象。', '稍后再试')); }
function say(message, mood='开心地看着你') { const bubble=document.querySelector('#bubble'); bubble.textContent=message; bubble.classList.add('show'); document.querySelector('#pet-mood').textContent=mood; setTimeout(()=>bubble.classList.remove('show'), 3600); }
let then=performance.now(); function tick(now) { const delta=(now-then)/1000; then=now; if (!captureTest) autoYaw += delta * .32; root.rotation.y=userYaw+autoYaw; const jump = now < jumpUntil ? Math.abs(Math.sin((jumpUntil-now)*.016))* .48 : 0; root.position.y=Math.sin(now/700)*.05+jump; mixer?.update(delta); renderer.render(scene,camera); requestAnimationFrame(tick); } requestAnimationFrame(tick);
window.pawlink.getProfile().then((profile)=>{name=profile.name;document.querySelector('#pet-name').textContent=name;}); window.pawlink.getModelUrl().then((url)=>url&&loadModel(url));
window.pawlink.onProfile((profile)=>{name=profile.name;document.querySelector('#pet-name').textContent=name;say(`我是${name}，请多关照！`);}); window.pawlink.onModel(loadModel); window.pawlink.onClickThrough((enabled)=>say(enabled?'现在不会挡住你的操作。':'鼠标互动已恢复。',enabled?'已开启鼠标穿透':'可以摸摸我了'));
// The native drag region in pet.css moves the entire BrowserWindow.  Do not
// move the window from pointer events here: relative web coordinates change
// while a transparent window moves, which separates the UI from the render.
document.querySelector('#pet-button').onclick=(event)=>{event.stopPropagation();playAction('interaction');say('嗨，很高兴见到你！','挥手互动中');}; document.querySelector('#jump-button').onclick=(event)=>{event.stopPropagation();playAction('dance');say('为你跳一支舞！','跳舞中');}; document.querySelector('#dance-button').onclick=(event)=>{event.stopPropagation();playAction('sing');say('啦啦啦，一起唱吧！','唱歌中');}; document.querySelector('#settings-button').onclick=(event)=>{event.stopPropagation();window.pawlink.openSettings();}; document.querySelector('#pass-button').onclick=(event)=>{event.stopPropagation();window.pawlink.toggleClickThrough();};
const chatPanel = document.querySelector('#chat-panel');
const chatInput = document.querySelector('#chat-input');
const chatButton = document.querySelector('#chat-button');
chatButton.onclick = (event) => {
  event.stopPropagation();
  chatPanel.classList.toggle('open');
  if (chatPanel.classList.contains('open')) setTimeout(() => chatInput.focus(), 0);
};
chatPanel.addEventListener('click', (event) => event.stopPropagation());
chatPanel.onsubmit = async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || chatPanel.classList.contains('busy')) return;
  chatPanel.classList.add('busy');
  chatInput.disabled = true;
  say('我想想…', '正在思考');
  try {
    const result = await window.pawlink.askPet(message);
    chatInput.value = '';
    const moods = { happy: '开心地看着你', calm: '安静地陪着你', sad: '有点担心你', curious: '好奇地听着' };
    say(result.reply, moods[result.emotion] || '陪着你');
    playAction(result.action);
  } catch (error) {
    const messageText = String(error?.message || error).replace(/^Error invoking remote method 'ask-pet': Error: /, '');
    say(messageText, '本地模型暂时不可用');
  } finally {
    chatPanel.classList.remove('busy');
    chatInput.disabled = false;
    chatInput.focus();
  }
};
