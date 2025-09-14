


import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { buildURDF,getMeshFiles } from './exporter.js';
import initInfoModule from './info.js';

const manifestPath = 'urdfs/parts.json';
const canvas = document.getElementById('glcanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1E1E1E);
scene.up.set(0, 0, 1);

const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.001, 2000);
camera.position.set(0.8, 0.6, 1.6);
camera.up.set(0, 0, 1);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.screenSpacePanning = true;

scene.add(new THREE.AxesHelper(0.3));
scene.add(new THREE.AmbientLight(0x888888));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(1, 2, 1);
scene.add(dirLight);

const stlLoader = new STLLoader();
const instances = {};
let instCounter = 0;
function generateId(prefix='inst'){ return prefix + '_' + (instCounter++); }
function deg(n){ return n * (180/Math.PI); }
function rad(n){ return n * (Math.PI/180); }

const transformControl = new TransformControls(camera, renderer.domElement);
transformControl.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
transformControl.addEventListener('mouseDown', () => { orbit.enabled = false; capturePrevWorldMatrices(); });
transformControl.addEventListener('mouseUp', () => {
  orbit.enabled = true;
  if (!suppressHistory) {
    const before = prevWorldMatrices || {};
    const after = getCurrentWorldMatrices();
    if (!matricesEqual(before, after)) {
      pushHistory({ type:'transform', before: cloneMatrixMap(before), after: cloneMatrixMap(after) });
    }
  }
  prevWorldMatrices = {};
});

transformControl.addEventListener('objectChange', () => { 
  if (selectedInstanceId) {
    onTransformChanged(selectedInstanceId);
    
    
    if (!transformControl._refreshTimeout) {
      transformControl._refreshTimeout = setTimeout(() => {
        refreshPropertiesPanel();
        transformControl._refreshTimeout = null;
      }, 16); 
    }
  }
});
scene.add(transformControl);

let selectedInstanceId = null;
let selectedAttach = null;
let prevWorldMatrices = {};
let postAttachRotationMode = false;
let jointEditMode = null;

let copyMode = false;
let copySourceId = null;
let ghostObject = null;

const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function computeBoundingSphereSafe(geometry){ try{ geometry.computeBoundingSphere(); } catch(e){} }
function disposeMeshHierarchy(root){ root.traverse(n => { if(n.isMesh){ if(n.geometry) n.geometry.dispose(); if(n.material){ if(Array.isArray(n.material)) n.material.forEach(m=>m.dispose()); else n.material.dispose(); }}}); }

const outlinerTree = document.getElementById('outliner-tree');
function enforceOutlinerStyles(){
  if (!outlinerTree) return;
  const s = outlinerTree.style;
  s.display = 'flex';
  s.flexDirection = 'column';
  s.alignItems = 'stretch';
  s.overflowY = 'auto';
  s.overflowX = 'hidden';
  s.whiteSpace = 'normal';
  s.boxSizing = 'border-box';
  s.width = '100%';
}
function outlinerRuntimeCheck(){
  if (!outlinerTree) return;
  if (outlinerTree.scrollWidth > outlinerTree.clientWidth + 2){
    outlinerTree.style.overflowX = 'hidden';
    console.warn('Outliner: horizontal overflow detected and hidden; names will wrap.');
  }
}

let selectedInstanceOutline = null;
const outlineMaterial = new THREE.LineBasicMaterial({ 
  color: 0xff3b3b, 
  transparent: true, 
  opacity: 0.7,
  linewidth: 3
});

function enterCopyMode(sourceId) {
  if (!instances[sourceId]) return;
  
  copyMode = true;
  copySourceId = sourceId;
  selectionEnabled = false;
  
  
  createGhostObject(sourceId);
  
  
  canvas.style.cursor = 'crosshair';
  
  console.log('Copy mode: Click to place copy, right-click or Escape to cancel');
}

function createGhostObject(sourceId) {
  const sourceInst = instances[sourceId];
  if (!sourceInst) return;
  
  ghostObject = sourceInst.rootGroup.clone();
  ghostObject.name = 'ghost_copy';
  ghostObject.traverse(child => {
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map(mat => {
          const ghostMat = mat.clone();
          ghostMat.transparent = true;
          ghostMat.opacity = 0.5;
          return ghostMat;
        });
      } else {
        const ghostMat = child.material.clone();
        ghostMat.transparent = true;
        ghostMat.opacity = 0.5;
        child.material = ghostMat;
      }
    }
  });
  
  scene.add(ghostObject);
}

function updateGhostPosition(event) {
  if (!ghostObject || !copyMode) return;
  
  
  const pos = getSpawnPositionFromEvent(event);
  ghostObject.position.set(pos.x, pos.y, pos.z);
}

function exitCopyMode() {
  copyMode = false;
  copySourceId = null;
  selectionEnabled = true;
  
  
  if (ghostObject) {
    scene.remove(ghostObject);
    ghostObject = null;
  }
  
  
  canvas.style.cursor = '';
}

async function createCopyAtPosition(pos) {
  if (!copySourceId || !instances[copySourceId]) return;
  
  const sourceInst = instances[copySourceId];
  try {
    
    const newInst = await instantiateURDFFromURL(sourceInst.sourceURL, pos);
    
    
    if (newInst && newInst.rootGroup) {
      newInst.rootGroup.scale.copy(sourceInst.rootGroup.scale);
      newInst.rootGroup.rotation.copy(sourceInst.rootGroup.rotation);
    }
    
    return newInst;
  } catch (err) {
    console.error('Failed to create copy:', err);
    alert('Failed to create copy: ' + err.message);
    return null;
  }
}

function addSelectionOutline(instanceId) {
  
  removeSelectionOutline(); 
  
  const inst = instances[instanceId];
  if (!inst) return;
  
  const outlineGroup = new THREE.Group();
  outlineGroup.name = 'selection_outline_' + instanceId;
  
  inst.rootGroup.traverse(child => {
    if (child.isMesh && child.geometry) {
      try {
        const edges = new THREE.EdgesGeometry(child.geometry);
        const outline = new THREE.LineSegments(edges, outlineMaterial.clone());
        
        
        outline.position.copy(child.position);
        outline.rotation.copy(child.rotation);
        outline.scale.copy(child.scale);
        
        outline.renderOrder = 999;
        outline.frustumCulled = false;
        outlineGroup.add(outline);
      } catch(e) {
        console.warn('Failed to create outline for mesh', e);
      }
    }
  });
  
  if (outlineGroup.children.length > 0) {
    
    inst.rootGroup.add(outlineGroup);
    selectedInstanceOutline = outlineGroup;
  }
}

function removeSelectionOutline() {
  
  if (selectedInstanceOutline) {
    
    
    if (selectedInstanceOutline.parent) {
      selectedInstanceOutline.parent.remove(selectedInstanceOutline);
    }
    
    
    scene.remove(selectedInstanceOutline);
    
    
    selectedInstanceOutline.visible = false;
    
    
    selectedInstanceOutline.traverse(child => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
      
      child.visible = false;
    });
    
    selectedInstanceOutline = null;
    
    
    renderer.render(scene, camera);
  }
}

let partsManifest = null;
let partElements = [];

fetch(manifestPath)
  .then(r => r.json())
  .then(data => { partsManifest = data; buildPartList(data); })
  .catch(err => { console.error('Failed to load parts.json', err); const el=document.getElementById('part-list'); if(el) el.innerText='Failed to load parts.json'; });

function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildPartList(manifest) {
  const list = document.getElementById('part-list');
  if (!list) return;
  list.innerHTML = '';
  partElements = [];

  manifest.forEach(entry => {
    const el = document.createElement('div');
    el.className = 'part-item';
    el.draggable = true;
    el.dataset.url = entry.url || '';

    const titleText = entry.title || entry.url || '';
    el.dataset.title = titleText;
    el.dataset.url = entry.url || '';

    
    const thumb = document.createElement('div');
    thumb.className = 'part-thumb';
    thumb.style.display = 'inline-flex';
    thumb.style.alignItems = 'center';
    thumb.style.justifyContent = 'center';
    thumb.style.overflow = 'hidden';
    thumb.style.position = 'relative';

    
    const initialsNode = document.createElement('span');
    initialsNode.className = 'part-initials';
    initialsNode.textContent = (titleText || 'P').slice(0, 2).toUpperCase();
    initialsNode.style.color = '#fff';
    initialsNode.style.fontWeight = '600';
    initialsNode.style.zIndex = '1';
    thumb.appendChild(initialsNode);

    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'part-title';
    titleDiv.textContent = titleText;

    
    const showInitialsFallback = () => {
      if (!thumb.contains(initialsNode)) thumb.appendChild(initialsNode);
      initialsNode.style.display = '';
    };

    
    const showImage = (img) => {
      initialsNode.style.display = 'none';
      img.style.visibility = 'visible';
    };

    if (entry.icon_url) {
      const img = document.createElement('img');
      img.alt = titleText;
      if (entry.desc) img.title = entry.desc; 
      img.loading = 'lazy';
      
      img.style.visibility = 'hidden';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      img.style.display = 'block';
      img.style.position = 'absolute';
      img.style.top = '0';
      img.style.left = '0';
      img.style.zIndex = '0';

      
      const basename = (entry.icon_url || '').split('/').pop();
      const candidates = [
        entry.icon_url,
        './' + entry.icon_url,
        (entry.icon_url.startsWith('/') ? entry.icon_url.slice(1) : entry.icon_url),
        'static/images/icons/' + basename,
        './static/images/icons/' + basename,
        '/static/images/icons/' + basename
      ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

      let tryIndex = 0;
      const tryNext = () => {
        if (tryIndex >= candidates.length) {
          console.warn('All icon candidates failed for', entry.title, 'tried:', candidates);
          img.remove();
          showInitialsFallback();
          return;
        }
        const src = candidates[tryIndex++];
        console.log('Icon load attempt for', entry.title + ':', src);
        img.src = src;
      };

      img.addEventListener('load', () => {
        console.log('Icon loaded for', entry.title, 'from', img.src);
        showImage(img);
      });

      img.addEventListener('error', (ev) => {
        console.warn('Icon load error for', entry.title, 'src=', img.src);
        
        tryNext();
      });

      
      tryNext();
      thumb.appendChild(img);
    } else {
      
      showInitialsFallback();
    }

    
    el.appendChild(thumb);
    el.appendChild(titleDiv);

    
    el.addEventListener('dragstart', ev => {
      try { ev.dataTransfer.effectAllowed = 'copyMove'; } catch (e) {}
      try { ev.dataTransfer.setData('text/uri-list', entry.url || ''); } catch (e) {}
      try { ev.dataTransfer.setData('text/plain', entry.url || ''); } catch (e) {}
      ev.stopPropagation();
    });

    el.addEventListener('dblclick', () => {
      if (typeof instantiateURDFFromURL === 'function') {
        instantiateURDFFromURL(entry.url, (typeof getSpawnPositionInFrontOfCamera === 'function') ? getSpawnPositionInFrontOfCamera() : undefined);
      } else {
        console.warn('instantiateURDFFromURL not available for', entry.url);
      }
    });

    list.appendChild(el);
    partElements.push({ el, title: titleText, url: entry.url });
  });
}

function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function findNearestMeshByScreenDistance(screenX, screenY, maxDistancePixels = 50) {
  let bestObject = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  
  const tempVector = new THREE.Vector3();
  
  for (const id in instances) {
    const inst = instances[id];
    inst.rootGroup.traverse(child => {
      if (child.isMesh && child.userData && child.userData.instanceId) {
        
        child.getWorldPosition(tempVector);
        tempVector.project(camera);
        
        
        const rect = canvas.getBoundingClientRect();
        const screenPixelX = (tempVector.x + 1) * rect.width / 2;
        const screenPixelY = (-tempVector.y + 1) * rect.height / 2;
        
        const pixelDistance = Math.sqrt(
          Math.pow(screenPixelX - screenX, 2) + 
          Math.pow(screenPixelY - screenY, 2)
        );
        
        if (pixelDistance < maxDistancePixels && pixelDistance < bestDistance) {
          bestDistance = pixelDistance;
          bestObject = child;
        }
      }
    });
  }
  
  return bestObject;
}

(function wireSearch(){
  const input = document.getElementById('search');
  const clearBtn = document.getElementById('search-clear');
  if (!input) return;
  input.addEventListener('input', ()=> {
    const q = (input.value || '').trim().toLowerCase();
    partElements.forEach(item => {
      const title = (item.title || '').toLowerCase();
      const url = (item.url || '').toLowerCase();
      const el = item.el;
      const titleEl = el.querySelector('.part-title');
      if (!q) {
        el.style.display = 'flex';
        titleEl.innerHTML = escapeHtml(item.title);
      } else {
        if (title.includes(q) || url.includes(q)){
          el.style.display = 'flex';
          const re = new RegExp(escapeRegExp(q), 'ig');
          titleEl.innerHTML = escapeHtml(item.title).replace(re, (m)=>`<span class="hl">${escapeHtml(m)}</span>`);
        } else {
          el.style.display = 'none';
        }
      }
    });
  });
  if (clearBtn){
    clearBtn.addEventListener('click', ()=> { input.value=''; input.dispatchEvent(new Event('input')); input.focus(); });
  }
})();

(function attachDropHandlersToCenterOnly(){
  const center = document.getElementById('center-column');
  if (!center) return;
  center.addEventListener('dragover', (e) => {
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch(e){}
  });
  center.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (url) {
      instantiateURDFFromURL(url, getSpawnPositionFromEvent(e));
    } else {
      console.warn('Drop event: no URL found in dataTransfer');
    }
  });
})();

function getSpawnPositionInFrontOfCamera(distance=0.6){
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const p = new THREE.Vector3(); p.copy(camera.position).add(d.multiplyScalar(distance));
  return { x:p.x, y:p.y, z:p.z };
}

function getSpawnPositionFromEvent(e, distance = 0.3){
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  
  
  const mouseVector = new THREE.Vector3(x, y, 0.5);
  mouseVector.unproject(camera);
  
  
  const direction = mouseVector.sub(camera.position).normalize();
  
  
  const position = camera.position.clone().add(direction.multiplyScalar(distance));
  
  return { x: position.x, y: position.y, z: position.z };
}

function parseURDF(text){
  const doc = new DOMParser().parseFromString(text,'application/xml');
  const robot = doc.querySelector('robot');
  const name = robot ? (robot.getAttribute('name') || 'robot') : 'robot';
  const links = [];
  doc.querySelectorAll('link').forEach(link => {
    const lname = link.getAttribute('name');
    const hasVisual = !!link.querySelector('visual');
    const hasCollision = !!link.querySelector('collision');
    let visualOrigin = { xyz:[0,0,0], rpy:[0,0,0] };
    const visual = link.querySelector('visual');
    if (visual){
      const vo = visual.querySelector('origin');
      if (vo){
        visualOrigin.xyz = (vo.getAttribute('xyz')||'0 0 0').trim().split(/\s+/).map(Number);
        visualOrigin.rpy = (vo.getAttribute('rpy')||'0 0 0').trim().split(/\s+/).map(Number);
      }
    }
    const meshes = [];
    link.querySelectorAll('visual geometry mesh, collision geometry mesh').forEach(m => {
      const fn = m.getAttribute('filename');
      const scaleAttr = m.getAttribute('scale');
      let scale = null;
      if (scaleAttr){ const s = scaleAttr.trim().split(/\s+/).map(Number); if(s && s.length>=1) scale = s; }
      if (fn) meshes.push({ filename: fn, scale });
    });
    links.push({ name: lname, hasVisual, hasCollision, visualOrigin, meshes });
  });

  const joints = [];
  doc.querySelectorAll('joint').forEach(j => {
    const jname = j.getAttribute('name');
    const jtype = j.getAttribute('type');
    const parent = j.querySelector('parent') ? j.querySelector('parent').getAttribute('link') : null;
    const child = j.querySelector('child') ? j.querySelector('child').getAttribute('link') : null;
    let origin = { xyz:[0,0,0], rpy:[0,0,0] };
    const o = j.querySelector('origin');
    if (o){
      origin.xyz = (o.getAttribute('xyz')||'0 0 0').trim().split(/\s+/).map(Number);
      origin.rpy = (o.getAttribute('rpy')||'0 0 0').trim().split(/\s+/).map(Number);
    }
    const axisNode = j.querySelector('axis');
    const axis = axisNode ? axisNode.getAttribute('xyz').split(/\s+/).map(Number) : [1,0,0];
    const limitNode = j.querySelector('limit');
    const limit = limitNode ? { lower: parseFloat(limitNode.getAttribute('lower')||'0'), upper: parseFloat(limitNode.getAttribute('upper')||'0') } : null;
    joints.push({ name:jname, type:jtype, parent, child, origin, axis, limit });
  });

  return { name, links, joints, raw: text };
}

async function instantiateURDFFromURL(url, pos={x:0,y:0,z:0}){
  try {
    const txt = await fetch(url).then(r => r.text());
    const parsed = parseURDF(txt);
    const inst = instantiateParsedURDF(parsed, url, pos);
    if (!suppressHistory) pushHistory({ type:'add', id: inst.id, parsed: parsed, sourceURL: url });
    return inst;
  } catch(err) {
    console.error('Failed to load URDF', url, err);
    alert('Failed to load URDF: ' + url);
  }
}

function instantiateParsedURDF(parsed, sourceURL, pos){
  const id = generateId('inst');
  const rootGroup = new THREE.Group(); rootGroup.name = parsed.name + '_' + id;
  rootGroup.position.set(pos.x, pos.y, pos.z);
  rootGroup.userData = { parsed, sourceURL, id };

  const linkObjects = {};
  parsed.links.forEach(link => {
    const container = new THREE.Group();
    container.name = link.name;
    container.userData = container.userData || {}; 
    container.userData.instanceId = id;
    container.userData.linkName = link.name;

    if (link.meshes && link.meshes.length > 0){
      const meshInfo = link.meshes[0];
      const meshFilename = meshInfo.filename.split('/').pop();
      const meshPath = 'urdfs/meshes/' + meshFilename;
      stlLoader.load(meshPath, geometry => {
        computeBoundingSphereSafe(geometry);
        const mat = new THREE.MeshStandardMaterial({ color: 0x9aa9b2, metalness:0.3, roughness:0.6 });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.name = link.name + '_mesh';
        if (meshInfo.scale && meshInfo.scale.length >= 1) mesh.scale.set(meshInfo.scale[0], meshInfo.scale[1]||meshInfo.scale[0], meshInfo.scale[2]||meshInfo.scale[0]);
        else mesh.scale.set(0.001, 0.001, 0.001);
        const vo = link.visualOrigin || { xyz:[0,0,0], rpy:[0,0,0] };
        mesh.position.set(vo.xyz[0], vo.xyz[1], vo.xyz[2]);
        mesh.setRotationFromEuler(new THREE.Euler(vo.rpy[0], vo.rpy[1], vo.rpy[2], 'XYZ'));
        mesh.userData = mesh.userData || {}; mesh.userData.instanceId = id;
        container.add(mesh);
      }, undefined, err => {
        if (link.hasVisual || link.hasCollision){
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.02,0.02), new THREE.MeshStandardMaterial({ color:0x666666 }));
          box.name = link.name + '_placeholder'; box.userData = box.userData || {}; box.userData.instanceId = id; container.add(box);
        }
      });
    } else {
      if (link.hasVisual || link.hasCollision){
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.02,0.02,0.02), new THREE.MeshStandardMaterial({ color:0x555555 }));
        box.name = link.name + '_placeholder'; box.userData = box.userData || {}; box.userData.instanceId = id; container.add(box);
      }
    }

    rootGroup.add(container);
    linkObjects[link.name] = container;
  });

  const pivotMap = {};
  const internalJoints = [];
  parsed.joints.forEach(j => {
    const parentObj = linkObjects[j.parent];
    const childObj = linkObjects[j.child];
    if (!parentObj || !childObj) return;
    const origin = j.origin || { xyz:[0,0,0], rpy:[0,0,0] };
    const pivot = new THREE.Group(); pivot.name = `pivot_${j.name || (j.parent + '_to_' + j.child)}`;
    pivot.position.set(origin.xyz[0], origin.xyz[1], origin.xyz[2]);
    pivot.setRotationFromEuler(new THREE.Euler(origin.rpy[0], origin.rpy[1], origin.rpy[2], 'XYZ'));
    parentObj.add(pivot);
    const mover = new THREE.Group(); mover.name = `mover_${j.name || (j.parent + '_to_' + j.child)}`;
    pivot.add(mover);
    mover.add(childObj);
    childObj.position.set(0,0,0);
    pivot.traverse(o => { o.userData = o.userData || {}; o.userData.instanceId = id; });
    pivotMap[j.child] = pivot;
    internalJoints.push({
      name: j.name,
      type: (j.type||'fixed').toLowerCase(),
      parent: j.parent,
      child: j.child,
      axis: (j.axis || [1,0,0]).map(Number),
      pivot, mover, moverInitialPos: mover.position.clone(), value: 0, limit: j.limit || null
    });
  });

  const attachSpheres = [];
  parsed.links.forEach(link => {
    if (!link.hasVisual && !link.hasCollision){
      const targetNode = pivotMap[link.name] || linkObjects[link.name] || rootGroup;
      const sphereSize = calculateAttachSphereSize(rootGroup);
      const sphereGeom = new THREE.SphereGeometry(sphereSize, 18, 12);
      const sphereMat = new THREE.MeshStandardMaterial({ color: 0xff4444 });
      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      sphere.name = 'AP:' + link.name;
      sphere.userData = { 
        isAttachSphere: true, 
        instanceId: id, 
        linkName: link.name, 
        targetUUID: targetNode.uuid,
        baseRadius : sphereSize
      };
      sphere.renderOrder = 999;
      sphere.frustumCulled = false;
      scene.add(sphere);
      attachSpheres.push({ sphere, linkName: link.name, targetNode });
    }
  });

  rootGroup.traverse(o => { o.userData = o.userData || {}; o.userData.instanceId = id; });

  scene.add(rootGroup);

  const inst = {
    id, rootGroup, name: parsed.name, sourceURL,
    parsed, linkObjects, internalJoints, pivotMap, attachSpheres,
    parentId: null, childrenIds: [], joints: [], rootLinkName: (parsed.links && parsed.links[0] && parsed.links[0].name) || (parsed.name + '_base_link')
  };
  instances[id] = inst;

  refreshOutliner();
  selectInstance(id);
  return inst;
}

function animate(){
  requestAnimationFrame(animate);

  for (const id in instances){
    const inst = instances[id];
    inst.attachSpheres.forEach(ap => {
      const t = ap.targetNode;
      if (!t) return;
      t.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3(); t.getWorldPosition(wp);
      ap.sphere.position.copy(wp);
      const worldScale = new THREE.Vector3();
      t.getWorldScale(worldScale);
      const avgScale = (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3 || 1;
      const baseRadius = ap.sphere.userData.baseRadius || 0.0005;
      ap.sphere.scale.setScalar(avgScale);
      
    });
  }

  orbit.update();
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
animate();

function findNearestAttachSphereByNDCDistance(ndcX, ndcY, maxDistNDC = 0.04){
  let best = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const id in instances){
    const inst = instances[id];
    for (const ap of inst.attachSpheres){
      const wp = new THREE.Vector3(); ap.sphere.getWorldPosition(wp);
      const proj = wp.clone().project(camera);
      const dx = proj.x - ndcX;
      const dy = proj.y - ndcY;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < maxDistNDC && d < bestD){
        bestD = d;
        best = ap.sphere;
      }
    }
  }
  return best;
}

canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

let selectionEnabled = true;
let visualizeMode = false;
let interactionHasFocus = false;
let suppressShortcutsOnModal = false;
let axisCycle = { mode: null, space: 'local' };

canvas.addEventListener('pointermove', function(e) {
  if (copyMode && ghostObject) {
    updateGhostPosition(e);
  }
});

canvas.addEventListener('pointerdown', function(e){
  interactionHasFocus = true;

  if (e.button === 1){
    return;
  }

  if (copyMode) {
    if (e.button === 0) { 
      const pos = getSpawnPositionFromEvent(e); 
      createCopyAtPosition(pos).then(() => {
        exitCopyMode();
      });
    } else if (e.button === 2) { 
      exitCopyMode();
    }
    e.preventDefault();
    return;
  }

  if (!selectionEnabled) {
    if (e.button === 2) { deselectInstance(); postAttachRotationMode = false; jointEditMode = null; }
    return;
  }

  if (e.button === 2) {
    e.preventDefault();
    deselectInstance();
    postAttachRotationMode = false;
    jointEditMode = null;
    return;
  }

  scene.updateMatrixWorld(true);

  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  
  mouse.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
  mouse.y = -((e.clientY - rect.top)/rect.height)*2 + 1;
  ray.setFromCamera(mouse, camera);

  const intersects = ray.intersectObjects(scene.children, true);

  
  let hit = intersects.length > 0 ? intersects[0].object : null;
  const sphereHit = intersects.find(i => i.object.userData && i.object.userData.isAttachSphere);
  if (sphereHit) hit = sphereHit.object;

  if (hit && !(hit.userData && hit.userData.isAttachSphere)){
    const fallbackSphere = findNearestAttachSphereByNDCDistance(mouse.x, mouse.y, 0.04);
    if (fallbackSphere) hit = fallbackSphere;
  }

  if (hit && hit.userData && hit.userData.isAttachSphere){
    handleSphereClick(hit, e);
    return;
  }

  
  let p = hit;
  while (p){
    if (p === transformControl) return;
    p = p.parent;
  }

  
  let targetObject = null;

  if (hit) {
    
    p = hit;
    while (p){
      
      if (p.name && p.name.includes('selection_outline')) {
        break;
      }
      
      if (p.userData && p.userData.instanceId){ 
        targetObject = p;
        break; 
      }
      p = p.parent;
    }
  }
  
  
  if (!targetObject) {
  const nearestMesh = findNearestMeshByScreenDistance(screenX, screenY, 50);
  if (nearestMesh) {
    targetObject = nearestMesh;
  } else {
  }
}

  if (targetObject && targetObject.userData && targetObject.userData.instanceId) {
    selectInstance(targetObject.userData.instanceId);
    postAttachRotationMode = false;
    jointEditMode = null;
  } else {
    deselectInstance();
    transformControl.visible = false; 
    postAttachRotationMode = false;
    jointEditMode = null;
    }
}, true);

function handleSphereClick(sphere, event){
  if (event && event.button !== 0) return;

  const clickedInstance = sphere.userData.instanceId;

  if (selectedAttach && selectedAttach.instanceId === selectedInstanceId && clickedInstance !== selectedInstanceId) {
    capturePrevWorldMatrices();
    performSnapBetween(selectedAttach, { instanceId: clickedInstance, sphere });
    if (!suppressHistory) {
      pushHistory({ type:'snap', parentId: clickedInstance, childId: selectedAttach.instanceId, before: cloneMatrixMap(prevWorldMatrices), after: cloneMatrixMap(getCurrentWorldMatrices()) });
    }
    return;
  }

  if (selectedInstanceId !== clickedInstance) {
    selectInstance(clickedInstance);
    return;
  }

  if (selectedAttach && selectedAttach.sphere === sphere) {
    sphere.material.color.set(0xff4444);
    selectedAttach = null;
    return;
  } else {
    if (selectedAttach && selectedAttach.sphere) selectedAttach.sphere.material.color.set(0xff4444);
    selectedAttach = { instanceId: clickedInstance, sphere };
    sphere.material.color.set(0x22ff22);
    return;
  }
}

function rotateChildAroundPivot(inst, pivotWorld, axisWorld, angleRad){
  inst.rootGroup.updateWorldMatrix(true, true);
  const childWorld = inst.rootGroup.matrixWorld.clone();

  const T = new THREE.Matrix4().makeTranslation(pivotWorld.x, pivotWorld.y, pivotWorld.z);
  const Tinv = new THREE.Matrix4().makeTranslation(-pivotWorld.x, -pivotWorld.y, -pivotWorld.z);
  const R = new THREE.Matrix4().makeRotationAxis(axisWorld.clone().normalize(), angleRad);

  const newWorld = new THREE.Matrix4().multiplyMatrices(T, new THREE.Matrix4().multiplyMatrices(R, new THREE.Matrix4().multiplyMatrices(Tinv, childWorld)));

  applyWorldMatrixToObject(inst.rootGroup, newWorld);
}

function performSnapBetween(aObj, bObj){
  const instA = instances[aObj.instanceId];
  const instB = instances[bObj.instanceId];
  const sphereA = aObj.sphere;
  const sphereB = bObj.sphere;

  if (!instA || !instB || !sphereA || !sphereB) {
    if (aObj.sphere) aObj.sphere.material.color.set(0xff4444);
    if (bObj.sphere) bObj.sphere.material.color.set(0xff4444);
    selectedAttach = null;
    return;
  }

  const worldApos = new THREE.Vector3(); sphereA.getWorldPosition(worldApos);
  const worldAquat = new THREE.Quaternion(); sphereA.getWorldQuaternion(worldAquat);
  const worldBpos = new THREE.Vector3(); sphereB.getWorldPosition(worldBpos);
  const worldBquat = new THREE.Quaternion(); sphereB.getWorldQuaternion(worldBquat);

  const qDelta = worldBquat.clone().multiply(worldAquat.clone().invert());
  const instAworldPos = new THREE.Vector3(); instA.rootGroup.getWorldPosition(instAworldPos);
  const instAworldQuat = new THREE.Quaternion(); instA.rootGroup.getWorldQuaternion(instAworldQuat);
  const instAworldScale = new THREE.Vector3(); instA.rootGroup.getWorldScale(instAworldScale);

  const deltaPos = new THREE.Vector3().subVectors(worldBpos, worldApos);
  const newWorldPos = instAworldPos.clone().add(deltaPos);
  const newWorldQuat = qDelta.clone().multiply(instAworldQuat);

  instA.rootGroup.position.copy(newWorldPos);
  instA.rootGroup.quaternion.copy(newWorldQuat);
  instA.rootGroup.scale.copy(instAworldScale);

  const parentTargetUUID = sphereB.userData.targetUUID || instB.rootGroup.uuid;
  const parentTargetNode = scene.getObjectByProperty('uuid', parentTargetUUID) || instB.rootGroup;

  parentTargetNode.updateWorldMatrix(true, true);
  instA.rootGroup.updateWorldMatrix(true, true);

  const parentWorld = parentTargetNode.matrixWorld.clone();
  const childWorld = instA.rootGroup.matrixWorld.clone();
  const parentInv = parentWorld.clone().invert();
  const childRel = new THREE.Matrix4().multiplyMatrices(parentInv, childWorld);

  
  let parentTargetLinkName = null;
  if (instB.parsed && instB.linkObjects) {
    for (const lname in instB.linkObjects){
      const node = instB.linkObjects[lname];
      if (node && node.uuid === parentTargetNode.uuid){ parentTargetLinkName = lname; break; }
    }
  }
  if (!parentTargetLinkName && instB.pivotMap) {
    for (const lname in instB.pivotMap){
      const node = instB.pivotMap[lname];
      if (node && node.uuid === parentTargetNode.uuid){ parentTargetLinkName = lname; break; }
    }
  }
  if (!parentTargetLinkName) parentTargetLinkName = instB.rootLinkName;

  
  
  if (instB.parsed && instB.parsed.links && parentTargetLinkName) {
    const found = instB.parsed.links.find(l => l.name === parentTargetLinkName);
    
    
    if ((found && !found.hasVisual && !found.hasCollision) || parentTargetLinkName.includes('AP')) {
      
      
      function findKinematicRealLink(apLinkName, visited = new Set()) {
        if (visited.has(apLinkName)) return null; 
        visited.add(apLinkName);
        
        if (!instB.parsed.joints) return null;
        
        
        for (const joint of instB.parsed.joints) {
          
          
          if (joint.child === apLinkName) {
            
            
            
            
            
            const childJoints = instB.parsed.joints.filter(j => j.parent === apLinkName);
            for (const childJoint of childJoints) {
              const childLink = instB.parsed.links.find(l => l.name === childJoint.child);
              if (childLink && (childLink.hasVisual || childLink.hasCollision) && !childLink.name.includes('AP')) {
                return childJoint.child; 
              }
            }
            
            
            
            
            const parentLink = instB.parsed.links.find(l => l.name === joint.parent);
            if (parentLink && (parentLink.hasVisual || parentLink.hasCollision) && !parentLink.name.includes('AP')) {
              console.log(`AP link ${apLinkName} is child of joint ${joint.name}, connecting to parent ${joint.parent}`);
              return joint.parent;
            }
            
            
            if (parentLink && (parentLink.name.includes('AP') || (!parentLink.hasVisual && !parentLink.hasCollision))) {
              return findKinematicRealLink(joint.parent, visited);
            }
          }
          
          
          if (joint.parent === apLinkName) {
            
            
            const parentJoints = instB.parsed.joints.filter(j => j.child === apLinkName);
            if (parentJoints.length > 0) {
              const grandparentLink = instB.parsed.links.find(l => l.name === parentJoints[0].parent);
              if (grandparentLink && (grandparentLink.hasVisual || grandparentLink.hasCollision) && !grandparentLink.name.includes('AP')) {
                console.log(`AP link ${apLinkName} is parent with real grandparent ${parentJoints[0].parent}`);
                return parentJoints[0].parent;
              }
            }
            
            
            const childLink = instB.parsed.links.find(l => l.name === joint.child);
            if (childLink && (childLink.hasVisual || childLink.hasCollision) && !childLink.name.includes('AP')) {
              console.log(`AP link ${apLinkName} is parent of real child ${joint.child}`);
              return joint.child;
            }
          }
        }
        
        return null;
      }
      
      const realLink = findKinematicRealLink(parentTargetLinkName);
      if (realLink) {
        console.log(`Traced AP link ${parentTargetLinkName} to real link ${realLink}`);
        parentTargetLinkName = realLink;
      } else {
        console.warn(`Could not trace AP link ${parentTargetLinkName} to real link, using rootLinkName`);
        parentTargetLinkName = instB.rootLinkName;
      }
    }
  }

  const jointEntry = { 
    type: 'fixed', 
    parentId: instB.id, 
    parentTargetUUID: parentTargetUUID,
    parentTargetLinkName,
    childId: instA.id, 
    childRelMatrix: childRel.clone() 
  };

  instB.joints = instB.joints || []; instB.joints.push(jointEntry);
  instA.parentId = instB.id;
  instB.childrenIds = instB.childrenIds || []; if (!instB.childrenIds.includes(instA.id)) instB.childrenIds.push(instA.id);

  sphereB.material.color.set(0xff4444);
  if (selectedAttach && selectedAttach.sphere && selectedAttach.sphere.material) selectedAttach.sphere.material.color.set(0xff4444);
  selectedAttach = null;

  postAttachRotationMode = true;
  selectInstance(instA.id);
  transformControl.setMode('rotate');

  instA._lastAttachInfo = { parentId: instB.id, parentTargetUUID: parentTargetUUID, parentTargetLinkName };

  refreshOutliner();
  refreshPropertiesPanel();
}

function selectInstance(id){
  if (!instances[id]) return;
  if (selectedInstanceId && transformControl.object) transformControl.detach();
  selectedInstanceId = id;
  
  
  addSelectionOutline(id);
  
  refreshPropertiesPanel();

  document.querySelectorAll('.outliner-node .outliner-header').forEach(h => h.classList.remove('selected'));
  const nodeHeader = document.querySelector(`.outliner-node[data-instance-id="${id}"] .outliner-header`);
  if (nodeHeader) nodeHeader.classList.add('selected');
  interactionHasFocus = true;
}

function selectInstanceFromOutliner(id, linkName){
  selectInstance(id);
}

function deselectInstance(){

  Info.hideAllInfo();
  
  selectedInstanceId = null;
  
  
  removeSelectionOutline();
  
  if (transformControl && transformControl.object) {
    transformControl.detach();
  }
  transformControl.visible = false;
  
  const props = document.getElementById('properties-panel');
  if (props) props.innerHTML = 'Select an item';
  if (selectedAttach){ 
    if (selectedAttach.sphere && selectedAttach.sphere.material) selectedAttach.sphere.material.color.set(0xff4444); 
    selectedAttach = null; 
  }
  document.querySelectorAll('.outliner-node .outliner-header').forEach(h => h.classList.remove('selected'));
  
}

function onTransformChanged(parentId){
  const parentInst = instances[parentId];
  if (!parentInst) return;

  (parentInst.joints || []).forEach(j => {
    if (j.type === 'fixed'){
      const childInst = instances[j.childId];
      if (!childInst) return;
      const parentTargetNode = scene.getObjectByProperty('uuid', j.parentTargetUUID) || parentInst.rootGroup;
      parentTargetNode.updateWorldMatrix(true, true);
      const parentWorld = parentTargetNode.matrixWorld.clone();
      const childWorld = new THREE.Matrix4().multiplyMatrices(parentWorld, j.childRelMatrix);
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
      childWorld.decompose(pos, quat, scl);
      childInst.rootGroup.position.copy(pos);
      childInst.rootGroup.quaternion.copy(quat);
      childInst.rootGroup.scale.copy(scl);
      childInst.rootGroup.updateWorldMatrix(true, true);
      onTransformChanged(childInst.id);
    }
  });
}

function capturePrevWorldMatrices(){
  prevWorldMatrices = {};
  for (const id in instances){
    const g = instances[id].rootGroup;
    g.updateWorldMatrix(true, true);
    prevWorldMatrices[id] = g.matrixWorld.clone();
  }
}
function getCurrentWorldMatrices(){
  const res = {};
  for (const id in instances){
    const g = instances[id].rootGroup;
    g.updateWorldMatrix(true, true);
    res[id] = g.matrixWorld.clone();
  }
  return res;
}
function cloneMatrixMap(map){
  const out = {};
  for (const k in map) out[k] = map[k].clone();
  return out;
}
function matricesEqual(a,b){
  if (!a || !b) return false;
  const aKeys = Object.keys(a), bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys){
    if (!b[k]) return false;
    if (!a[k].equals(b[k])) return false;
  }
  return true;
}
function applyWorldMatrixToObject(obj, worldMatrix){
  const parent = obj.parent || scene;
  parent.updateWorldMatrix(true,true);
  const parentInv = parent.matrixWorld.clone().invert();
  const local = new THREE.Matrix4().multiplyMatrices(parentInv, worldMatrix);
  const pos=new THREE.Vector3(), quat=new THREE.Quaternion(), scl=new THREE.Vector3();
  local.decompose(pos, quat, scl);
  obj.position.copy(pos);
  obj.quaternion.copy(quat);
  obj.scale.copy(scl);
  obj.updateMatrixWorld(true);
}

function refreshOutliner(){
  const out = document.getElementById('outliner-tree');
  if (!out) return;

  enforceOutlinerStyles();

  out.innerHTML = '';
  for (const id in instances){
    if (!instances[id].parentId) out.appendChild(buildOutlinerNode(id, 0));
  }

  outlinerRuntimeCheck();
}

function buildOutlinerNode(id, depth){
  const inst = instances[id];

  const wrapper = document.createElement('div');
  wrapper.className = 'outliner-node';
  wrapper.dataset.instanceId = id;
  wrapper.style.display = 'block';
  wrapper.style.width = '100%';
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.margin = '2px 0';

  const header = document.createElement('div');
  header.className = 'outliner-header';
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.cursor = 'pointer';
  header.style.padding = '6px 8px';
  header.style.borderRadius = '4px';
  header.style.userSelect = 'none';
  header.style.background = 'transparent';
  header.style.boxSizing = 'border-box';
  header.style.width = '100%';
  header.style.minWidth = '0';

  const label = document.createElement('div');
  label.style.flex = '1';
  label.style.fontSize = '13px';
  label.style.whiteSpace = 'normal';
  label.style.overflowWrap = 'anywhere';
  label.style.wordBreak = 'break-word';
  label.style.minWidth = '0';
  label.textContent = (depth === 0 ? inst.name + ' (' + inst.id + ')' : '- ' + inst.name + ' (' + inst.id + ')');
  header.appendChild(label);

  const unlinkBtn = document.createElement('button');
  unlinkBtn.textContent = '🔗';
  unlinkBtn.title = 'Unlink from parent';
  unlinkBtn.style.marginLeft = '6px';
  unlinkBtn.style.border = 'none';
  unlinkBtn.style.cursor = 'pointer';
  unlinkBtn.className = 'outliner-line-btn';

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete this URDF';
  delBtn.style.marginLeft = '8px';
  delBtn.style.padding = '6px 8px';
  delBtn.style.border = 'none';
  delBtn.style.cursor = 'pointer';
  delBtn.className = 'outliner-line-btn';
  delBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!suppressHistory) {
      const snapshot = {
        parsed: inst.parsed,
        sourceURL: inst.sourceURL,
        worldMatrix: inst.rootGroup.matrixWorld.clone(),
        id: inst.id
      };
      pushHistory({ type:'delete', snapshot });
    }
    deleteInstance(id);
  });
  header.appendChild(delBtn);

  const focusBtn = document.createElement('button');
  focusBtn.textContent = 'F';
  focusBtn.title = 'Focus';
  focusBtn.style.marginLeft = '6px';
  focusBtn.style.border = 'none';
  focusBtn.style.padding = '6px 8px';
  focusBtn.style.cursor = 'pointer';
  focusBtn.className = 'outliner-line-btn';
  focusBtn.addEventListener('click', (ev) => { ev.stopPropagation(); focusOnInstance(id); });
  header.appendChild(focusBtn);

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    selectInstanceFromOutliner(id);
    const childrenContainer = wrapper.querySelector('.outliner-children');
    if (childrenContainer){
      const isHidden = childrenContainer.style.display === 'none';
      childrenContainer.style.display = isHidden ? 'block' : 'none';
      caret.textContent = isHidden ? '▾' : '▸';
    }
  });

  label.addEventListener('dblclick', (ev) => {
    ev.stopPropagation();
    const currentText = inst.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    label.innerHTML = '';
    label.appendChild(input);
    input.focus();
    input.select();
    function commit(){
      const v = (input.value || '').trim();
      if (v) {
        inst.name = v;
        refreshOutliner();
        refreshPropertiesPanel();
      } else {
        label.textContent = currentText;
      }
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ke) => { if (ke.key === 'Enter') { commit(); input.blur(); } if (ke.key === 'Escape') { refreshOutliner(); } });
  });

  wrapper.appendChild(header);

  function unlinkInstance(id) {
    const inst = instances[id];
    if (!inst || !inst.parentId) return;
    
    const parentInst = instances[inst.parentId];
    if (parentInst) {
      
      parentInst.childrenIds = parentInst.childrenIds.filter(childId => childId !== id);
      
      
      if (parentInst.joints) {
        parentInst.joints = parentInst.joints.filter(joint => joint.childId !== id);
      }
    }
    
    
    inst.parentId = null;
    
    
    refreshOutliner();
    refreshPropertiesPanel();
    
    console.log(`Unlinked instance ${inst.name} (${id}) from its parent`);
  }

  if (inst.parentId) {
    unlinkBtn.addEventListener('click', (ev) => { 
      ev.stopPropagation(); 
      unlinkInstance(id); 
    });
    header.appendChild(unlinkBtn);
  }

  header.appendChild(focusBtn);

  if (inst.parsed && inst.parsed.links && inst.parsed.links.length){
    const linksContainer = document.createElement('div');
    linksContainer.style.marginLeft = '18px';
    linksContainer.style.marginTop = '4px';
    linksContainer.style.width = '100%';
    linksContainer.style.boxSizing = 'border-box';
    inst.parsed.links.forEach(link => {
      if (!(link.hasVisual || link.hasCollision)) return;
      const lw = document.createElement('div');
      lw.className = 'outliner-link';
      lw.style.padding = '2px 0';
      lw.style.fontSize = '12px';
      lw.style.opacity = '0.9';
      lw.style.whiteSpace = 'normal';
      lw.style.wordBreak = 'break-word';
      lw.textContent = link.name;
      lw.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectInstanceFromOutliner(id, link.name);
      });
      linksContainer.appendChild(lw);
    });
    wrapper.appendChild(linksContainer);
  }

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'outliner-children';
  childrenContainer.style.marginLeft = '6px';
  childrenContainer.style.marginTop = '6px';
  childrenContainer.style.width = '100%';
  childrenContainer.style.boxSizing = 'border-box';
  if (inst.childrenIds && inst.childrenIds.length){
    inst.childrenIds.forEach(cid => {
      if (instances[cid]) childrenContainer.appendChild(buildOutlinerNode(cid, depth + 1));
    });
  }
  wrapper.appendChild(childrenContainer);

  wrapper.dataset.instanceId = id;
  return wrapper;
}

function refreshPropertiesPanel(){
  const panel = document.getElementById('properties-panel'); if(!panel) return;
  panel.innerHTML = '';
  if (!selectedInstanceId){ panel.textContent = 'Select an item'; return; }
  const inst = instances[selectedInstanceId];

  const title = document.createElement('div'); title.style.fontWeight='700'; title.style.marginBottom='12px'; title.style.fontSize='large';
  title.textContent = inst.name + ' (' + inst.id + ')'; panel.appendChild(title);

  if (typeof Info !== 'undefined' && Info.injectButtonForInstance) {
  Info.injectButtonForInstance(panel, inst);
  }

  const scaleRow = document.createElement('div'); scaleRow.className='prop-row';
  const scaleLabel = document.createElement('label'); scaleLabel.textContent = 'Global Scale';
  const scaleInput = document.createElement('input'); scaleInput.type='number'; scaleInput.step='0.01';
  scaleInput.value = Math.round((inst.rootGroup.scale.x || 1) * 100) / 100;
  scaleInput.addEventListener('change', ()=>{ const v = parseFloat(scaleInput.value) || 1; inst.rootGroup.scale.set(v,v,v); onTransformChanged(selectedInstanceId); });
  scaleRow.appendChild(scaleLabel); scaleRow.appendChild(scaleInput); panel.appendChild(scaleRow);

  const wp = new THREE.Vector3(); inst.rootGroup.getWorldPosition(wp);
  const wq = new THREE.Quaternion(); inst.rootGroup.getWorldQuaternion(wq);
  const eul = new THREE.Euler().setFromQuaternion(wq, 'XYZ');

  const makeNumberRow = (label, value, onChange) => {
    const row = document.createElement('div'); row.className = 'prop-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const input = document.createElement('input'); input.type='number'; input.step='0.001'; input.value = Math.round(value * 1000) / 1000;
    input.addEventListener('change', ()=> onChange(parseFloat(input.value) || 0));
    row.appendChild(lab); row.appendChild(input); return { row, input };
  };

  const posBox = document.createElement('div'); posBox.style.marginBottom='8px';
  posBox.appendChild(document.createElement('div')).textContent = 'World Position';
  const px = makeNumberRow('X', wp.x, (v)=>{ inst.rootGroup.position.x = v; onTransformChanged(selectedInstanceId); }); posBox.appendChild(px.row); 
  const py = makeNumberRow('Y', wp.y, (v)=>{ inst.rootGroup.position.y = v; onTransformChanged(selectedInstanceId); }); posBox.appendChild(py.row);
  const pz = makeNumberRow('Z', wp.z, (v)=>{ inst.rootGroup.position.z = v; onTransformChanged(selectedInstanceId); }); posBox.appendChild(pz.row);
  panel.appendChild(posBox);

  const rotBox = document.createElement('div'); rotBox.style.marginBottom='8px';

  if (postAttachRotationMode && selectedInstanceId && inst._lastAttachInfo){
    const info = inst._lastAttachInfo;
    const parentInst = instances[info.parentId];
    const parentNode = scene.getObjectByProperty('uuid', info.parentTargetUUID) || (parentInst && parentInst.rootGroup) || null;
    rotBox.appendChild(document.createElement('div')).textContent = 'Attach Point Rotation (90° increments)';
    const rotateButtons = document.createElement('div'); rotateButtons.style.display='flex'; rotateButtons.style.gap='6px'; rotateButtons.style.flexWrap='wrap'; rotateButtons.style.paddingTop='15px';
    const axes = [
      { name: 'X+90°', axis: new THREE.Vector3(1,0,0) },
      { name: 'X-90°', axis: new THREE.Vector3(-1,0,0) },
      { name: 'Y+90°', axis: new THREE.Vector3(0,1,0) },
      { name: 'Y-90°', axis: new THREE.Vector3(0,-1,0) },
      { name: 'Z+90°', axis: new THREE.Vector3(0,0,1) },
      { name: 'Z-90°', axis: new THREE.Vector3(0,0,-1) }
    ];
    axes.forEach(axisInfo => {
      const btn = document.createElement('button'); btn.textContent = axisInfo.name; btn.style.padding='4px 8px'; btn.style.fontSize='12px'; btn.classList.add('btn-redblack')
      btn.addEventListener('click', () => {
        if (!parentNode) return;
        parentNode.updateWorldMatrix(true, true);
        const pivot = new THREE.Vector3(); parentNode.getWorldPosition(pivot);
        rotateChildAroundPivot(inst, pivot, axisInfo.axis, Math.PI / 2 * (axisInfo.axis.x + axisInfo.axis.y + axisInfo.axis.z ? 1 : 1));
        const parentJ = instances[info.parentId] && instances[info.parentId].joints && instances[info.parentId].joints.find(j => j.childId === inst.id);
        if (parentJ){
          const parentNode2 = scene.getObjectByProperty('uuid', parentJ.parentTargetUUID) || instances[info.parentId].rootGroup;
          parentNode2.updateWorldMatrix(true,true);
          inst.rootGroup.updateWorldMatrix(true,true);
          const parentInv = parentNode2.matrixWorld.clone().invert();
          parentJ.childRelMatrix = new THREE.Matrix4().multiplyMatrices(parentInv, inst.rootGroup.matrixWorld.clone());
        }
        refreshPropertiesPanel();
      });
      rotateButtons.appendChild(btn);
    });
    rotBox.appendChild(rotateButtons);
    const exitBtn = document.createElement('button'); exitBtn.textContent = 'Exit Rotation Mode'; exitBtn.style.marginTop='8px'; exitBtn.style.width='100%'; exitBtn.classList.add('btn-redblack')
    exitBtn.addEventListener('click', ()=> {
      if (inst._lastAttachInfo){
        const pId = inst._lastAttachInfo.parentId;
        const parentJ = instances[pId] && instances[pId].joints && instances[pId].joints.find(j => j.childId === inst.id);
        if (parentJ){
          const parentNode2 = scene.getObjectByProperty('uuid', parentJ.parentTargetUUID) || instances[pId].rootGroup;
          parentNode2.updateWorldMatrix(true,true);
          inst.rootGroup.updateWorldMatrix(true,true);
          const parentInv = parentNode2.matrixWorld.clone().invert();
          parentJ.childRelMatrix = new THREE.Matrix4().multiplyMatrices(parentInv, inst.rootGroup.matrixWorld.clone());
        }
      }
      postAttachRotationMode = false;
      inst._lastAttachInfo = null;
      transformControl.setMode('translate');
      refreshPropertiesPanel();
    });
    rotBox.appendChild(exitBtn);
  }
  else if (jointEditMode && jointEditMode.childId === selectedInstanceId){
    const j = jointEditMode.joint;
    const parentNode = scene.getObjectByProperty('uuid', j.parentTargetUUID) || (instances[j.parentId] && instances[j.parentId].rootGroup);
    rotBox.appendChild(document.createElement('div')).textContent = 'Edit Fixed Joint (rotate around attach point)';
    const rotateButtons = document.createElement('div'); rotateButtons.style.display='flex'; rotateButtons.style.gap='6px'; rotateButtons.style.flexWrap='wrap'; rotateButtons.style.paddingTop='15px';
    const axes = [
      { name: 'X+90°', axis: new THREE.Vector3(1,0,0) },
      { name: 'X-90°', axis: new THREE.Vector3(-1,0,0) },
      { name: 'Y+90°', axis: new THREE.Vector3(0,1,0) },
      { name: 'Y-90°', axis: new THREE.Vector3(0,-1,0) },
      { name: 'Z+90°', axis: new THREE.Vector3(0,0,1) },
      { name: 'Z-90°', axis: new THREE.Vector3(0,0,-1) }
    ];
    axes.forEach(axisInfo => {
      const btn = document.createElement('button'); btn.textContent = axisInfo.name; btn.style.padding='4px 8px'; btn.style.fontSize='12px'; btn.classList.add('btn-redblack');
      btn.addEventListener('click', () => {
        if (!parentNode) return;
        parentNode.updateWorldMatrix(true, true);
        const pivot = new THREE.Vector3(); parentNode.getWorldPosition(pivot);
        rotateChildAroundPivot(inst, pivot, axisInfo.axis, Math.PI/2 * (axisInfo.axis.x + axisInfo.axis.y + axisInfo.axis.z ? 1 : 1));
        const parentInv = parentNode.matrixWorld.clone().invert();
        j.childRelMatrix = new THREE.Matrix4().multiplyMatrices(parentInv, inst.rootGroup.matrixWorld.clone());
        refreshPropertiesPanel();
      });
      rotateButtons.appendChild(btn);
    });
    rotBox.appendChild(rotateButtons);

    const saveBtn = document.createElement('button'); saveBtn.textContent = 'Save Joint Orientation'; saveBtn.style.marginTop='8px'; saveBtn.style.width='100%'; saveBtn.classList.add('btn-redblack');
    saveBtn.addEventListener('click', ()=> {
      jointEditMode = null;
      refreshPropertiesPanel();
    });
    const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancel Edit'; cancelBtn.style.marginTop='6px'; cancelBtn.style.width='100%'; cancelBtn.classList.add('btn-redblack')
    cancelBtn.addEventListener('click', ()=> {
      const j = jointEditMode && jointEditMode.joint;
      if (j){
        const parentNode2 = scene.getObjectByProperty('uuid', j.parentTargetUUID) || instances[j.parentId].rootGroup;
        parentNode2.updateWorldMatrix(true,true);
        const parentWorld = parentNode2.matrixWorld.clone();
        const childWorld = new THREE.Matrix4().multiplyMatrices(parentWorld, j.childRelMatrix);
        applyWorldMatrixToObject(inst.rootGroup, childWorld);
      }
      jointEditMode = null;
      refreshPropertiesPanel();
    });
    rotBox.appendChild(saveBtn);
    rotBox.appendChild(cancelBtn);
  }
  else {
    rotBox.appendChild(document.createElement('div')).textContent = 'World Rotation (deg)';
    const rx = makeNumberRow('Rx', deg(eul.x), (v)=>{ const qWorld = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(v), eul.y, eul.z, 'XYZ')); applyWorldQuaternionToObject(inst.rootGroup, qWorld); onTransformChanged(selectedInstanceId); }); rotBox.appendChild(rx.row);
    const ry = makeNumberRow('Ry', deg(eul.y), (v)=>{ const qWorld = new THREE.Quaternion().setFromEuler(new THREE.Euler(eul.x, rad(v), eul.z, 'XYZ')); applyWorldQuaternionToObject(inst.rootGroup, qWorld); onTransformChanged(selectedInstanceId); }); rotBox.appendChild(ry.row);
    const rz = makeNumberRow('Rz', deg(eul.z), (v)=>{ const qWorld = new THREE.Quaternion().setFromEuler(new THREE.Euler(eul.x, eul.y, rad(v), 'XYZ')); applyWorldQuaternionToObject(inst.rootGroup, qWorld); onTransformChanged(selectedInstanceId); }); rotBox.appendChild(rz.row);
  }
  panel.appendChild(rotBox);

  const scaleBox = document.createElement('div'); scaleBox.style.marginBottom='8px';
  scaleBox.appendChild(document.createElement('div')).textContent = 'Local Scale';
  const sx = makeNumberRow('Sx', inst.rootGroup.scale.x, (v)=>{ inst.rootGroup.scale.x = v; onTransformChanged(selectedInstanceId); }); scaleBox.appendChild(sx.row);
  const sy = makeNumberRow('Sy', inst.rootGroup.scale.y, (v)=>{ inst.rootGroup.scale.y = v; onTransformChanged(selectedInstanceId); }); scaleBox.appendChild(sy.row);
  const sz = makeNumberRow('Sz', inst.rootGroup.scale.z, (v)=>{ inst.rootGroup.scale.z = v; onTransformChanged(selectedInstanceId); }); scaleBox.appendChild(sz.row);
  panel.appendChild(scaleBox);

  if (inst.internalJoints && inst.internalJoints.length){
    const jbox = document.createElement('div'); jbox.style.marginTop='8px';
    jbox.appendChild(document.createElement('div')).textContent = 'Internal Joints';
    inst.internalJoints.forEach(j => {
      if (j.type === 'fixed') return;
      const row = document.createElement('div'); row.style.paddingTop='15px'
      const lab = document.createElement('label'); lab.textContent = j.name || (j.parent + '_to_' + j.child); lab.style.display='block';
      const range = document.createElement('input'); range.type = 'range'; range.className = 'slider';
      const min = (j.limit && !isNaN(j.limit.lower)) ? j.limit.lower : (j.type === 'prismatic' ? -0.1 : -Math.PI);
      const max = (j.limit && !isNaN(j.limit.upper)) ? j.limit.upper : (j.type === 'prismatic' ? 0.1 : Math.PI);
      range.min = min; range.max = max; range.step = (max - min) / 200; range.value = j.value || 0;

      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'joint-number';
      num.step = range.step;
      num.min = range.min;
      num.max = range.max;
      num.value = Math.round((parseFloat(range.value) || 0) * 1000) / 1000;

      
      row.classList.add('joint-row');

      
      function applyJointValueToModel(value) {
        const v = parseFloat(value) || 0;
        j.value = v;
        if (j.type === 'revolute' || j.type === 'continuous') {
          const ax = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize();
          const q = new THREE.Quaternion().setFromAxisAngle(ax, j.value);
          if (j.pivot) j.pivot.setRotationFromQuaternion(q);
        } else if (j.type === 'prismatic') {
          const ax = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize();
          const offset = ax.clone().multiplyScalar(j.value);
          if (j.mover && j.moverInitialPos) j.mover.position.copy(j.moverInitialPos.clone().add(offset));
        }
        onTransformChanged(inst.id);
      }

      
      range.addEventListener('input', () => {
        const v = parseFloat(range.value) || 0;
        num.value = Math.round(v * 1000) / 1000;
        applyJointValueToModel(v);
      });

      
      num.addEventListener('change', () => {
        let v = parseFloat(num.value);
        if (isNaN(v)) v = 0;
        if (v < parseFloat(range.min)) v = parseFloat(range.min);
        if (v > parseFloat(range.max)) v = parseFloat(range.max);
        num.value = Math.round(v * 1000) / 1000;
        range.value = v;
        applyJointValueToModel(v);
      });

      row.appendChild(lab);
      row.appendChild(range);
      row.appendChild(num);
      jbox.appendChild(row);
    });
    
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset all joints'; resetBtn.style.width = '100%'; resetBtn.classList.add('btn-redblack');resetBtn.style.marginTop='10px'
    resetBtn.addEventListener('click', () => {
      inst.internalJoints.forEach(j => {
        if (j.type === 'fixed') return;
        j.value = 0;
        if (j.type === 'revolute' || j.type === 'continuous') {
          const ax = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize();
          const q = new THREE.Quaternion().setFromAxisAngle(ax, j.value);
          j.pivot.setRotationFromQuaternion(q);
        } else if (j.type === 'prismatic') {
          j.mover.position.copy(j.moverInitialPos.clone());
        }
      });
      onTransformChanged(inst.id);
      refreshPropertiesPanel();
    });
    jbox.appendChild(resetBtn);
    panel.appendChild(jbox);
  }

  if (inst.parentId){
  const parentInst = instances[inst.parentId];
  if (parentInst && parentInst.joints && parentInst.joints.length){
    const joint = parentInst.joints.find(j => j.childId === inst.id && j.type === 'fixed');
    if (joint){
      const editRow = document.createElement('div'); 
      const editBtn = document.createElement('button'); editBtn.textContent = 'Edit fixed joint'; editBtn.style.width='100%'; editBtn.classList.add('btn-redblack');
      editBtn.addEventListener('click', ()=> {
        jointEditMode = { parentId: parentInst.id, childId: inst.id, joint };
        postAttachRotationMode = false;
        refreshPropertiesPanel();
      });
      editRow.appendChild(editBtn);
      panel.appendChild(editRow);
    }
  }
  }
}

function calculateAttachSphereSize(rootGroup) {
  const box = new THREE.Box3().setFromObject(rootGroup);
  if (box.isEmpty()) return 0.001;
  
  const size = box.getSize(new THREE.Vector3());
  const avgDimension = (size.x + size.y + size.z) / 3;
  
  let sphereSize = avgDimension * 3;
  sphereSize = Math.max(0.0005, sphereSize);
  
  console.log('Object size:', size, 'Sphere size:', sphereSize);
  
  return sphereSize;
}

function applyWorldQuaternionToObject(obj, qWorld){
  if (!obj.parent){ obj.quaternion.copy(qWorld); return; }
  const parentWorldQ = new THREE.Quaternion(); obj.parent.getWorldQuaternion(parentWorldQ);
  parentWorldQ.invert();
  obj.quaternion.copy(parentWorldQ.multiply(qWorld));
}

window.addEventListener('keydown', (e) => {
  if (suppressShortcutsOnModal) return;
  const activeEl = document.activeElement;
  const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;

  if (visualizeMode) {
    if (e.key === 'Escape') { 
      if (copyMode) {
        exitCopyMode();
        e.preventDefault();
        return;}


      exitSimulationMode(); 
      e.preventDefault(); return; 
    }
    
    return;
  }

  if (!interactionHasFocus || isTyping) {
    if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); return; }
    if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); return; }
    return;
  }

  if (e.key === 'd' && !ctrl && selectedInstanceId && !isTyping) {
    enterCopyMode(selectedInstanceId);
    e.preventDefault();
  }

  if (e.key === 'g') {
    if (!selectedInstanceId) return;
    
    
    if (!transformControl.object || transformControl.object !== instances[selectedInstanceId].rootGroup) {
      transformControl.attach(instances[selectedInstanceId].rootGroup);
    }
    transformControl.visible = true;
    
    if (axisCycle.mode === 'translate') {
      axisCycle.space = (axisCycle.space === 'local') ? 'world' : 'local';
    } else {
      axisCycle.mode = 'translate'; axisCycle.space = 'local';
    }
    transformControl.setMode('translate');
    transformControl.setSpace(axisCycle.space);
    e.preventDefault();
  }

  if (e.key === 'r') {
    if (!selectedInstanceId) return;
    
    
    if (!transformControl.object || transformControl.object !== instances[selectedInstanceId].rootGroup) {
      transformControl.attach(instances[selectedInstanceId].rootGroup);
    }
    transformControl.visible = true;
    
    if (axisCycle.mode === 'rotate') {
      axisCycle.space = (axisCycle.space === 'local') ? 'world' : 'local';
    } else {
      axisCycle.mode = 'rotate'; axisCycle.space = 'local';
    }
    transformControl.setMode('rotate');
    transformControl.setSpace(axisCycle.space);
    e.preventDefault();
  }

  if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
    if (!selectedInstanceId) return;
    
    
    if (!transformControl.object || transformControl.object !== instances[selectedInstanceId].rootGroup) {
      transformControl.attach(instances[selectedInstanceId].rootGroup);
    }
    transformControl.visible = true;
    
    if (axisCycle.mode === 'scale') {
      axisCycle.space = (axisCycle.space === 'local') ? 'world' : 'local';
    } else {
      axisCycle.mode = 'scale'; axisCycle.space = 'local';
    }
    transformControl.setMode('scale');
    transformControl.setSpace(axisCycle.space);
    e.preventDefault();
  }

  if (e.key === 'Escape') {
    if (transformControl.visible && transformControl.object) {
      transformControl.visible = false;
      e.preventDefault();
    }
    if (postAttachRotationMode || jointEditMode) {
      postAttachRotationMode = false;
      jointEditMode = null;
      transformControl.setMode('translate');
      refreshPropertiesPanel();
    }
  }

  if (e.key === 'Delete' && selectedInstanceId) {
    if (!suppressHistory) {
      const inst = instances[selectedInstanceId];
      if (inst) {
        const snapshot = {
          parsed: inst.parsed,
          sourceURL: inst.sourceURL,
          worldMatrix: inst.rootGroup.matrixWorld.clone(),
          id: inst.id
        };
        pushHistory({ type:'delete', snapshot });
      }
    }
    deleteInstance(selectedInstanceId);
  }

  if (ctrl && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if (ctrl && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    redo();
  }

  if (e.key === 'Escape' && (postAttachRotationMode || jointEditMode)) {
    postAttachRotationMode = false;
    jointEditMode = null;
    transformControl.setMode('translate');
    refreshPropertiesPanel();
  }
});

function deleteInstance(id){
  if (!instances[id]) return;
  const inst = instances[id];
  if (inst.parentId){
    const parent = instances[inst.parentId];
    if (parent){
      parent.childrenIds = parent.childrenIds.filter(c => c !== id);
      if (parent.joints) parent.joints = parent.joints.filter(j => j.childId !== id);
    }
  }
  inst.childrenIds.forEach(childId => { const c = instances[childId]; if (c) c.parentId = null; });
  inst.attachSpheres.forEach(ap => { if (ap.sphere && ap.sphere.parent) ap.sphere.parent.remove(ap.sphere); });
  if (inst.rootGroup.parent) inst.rootGroup.parent.remove(inst.rootGroup);
  delete instances[id];
  if (selectedInstanceId === id) {
    deselectInstance();
    postAttachRotationMode = false;
    jointEditMode = null;
  }
  refreshOutliner();
}

window.addEventListener('resize', ()=> {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
});

function focusOnInstance(id){
  const inst = instances[id];
  if (!inst) return;
  const box = new THREE.Box3().setFromObject(inst.rootGroup);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()); orbit.target.copy(c); camera.position.set(c.x + 0.4, c.y + 0.4, c.z + 0.8);
}

function loadScript(src){ return new Promise((resolve,reject)=>{ if(document.querySelector(`script[src="${src}"]`)){ resolve(); return; } const s=document.createElement('script'); s.src=src; s.onload=()=>resolve(); s.onerror=(e)=>reject(e); document.head.appendChild(s); }); }

async function saveAssemblyAsZip(filenameWithoutExt = 'assembly') {
  
  if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.0/dist/jszip.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js');
    } catch (err) {
      console.error('Failed to load zip/filesaver libraries', err);
      alert('Unable to load exporter libraries (JSZip/FileSaver). Check your internet connection.');
      return;
    }
  }

  try {
    
    const assemblyData = generateAssemblyData();
    console.log(assemblyData)
    if (!assemblyData) {
      alert('Failed to build assembly data.');
      return;
    }

    let urdf;
    try {
      urdf = await Promise.resolve(buildURDF(assemblyData));
    } catch (err) {
      console.error('buildURDF failed', err);
      alert('Failed to build URDF: ' + (err && err.message ? err.message : String(err)));
      return;
    }

    if (typeof urdf !== 'string') {
      console.error('buildURDF did not return a string', urdf);
      alert('Export failed: URDF generator did not return valid text.');
      return;
    }

    let meshItems = [];
    try {
      meshItems = await Promise.resolve(getMeshFiles(assemblyData) || []);
    } catch (err) {
      console.error('getMeshFiles failed', err);
      alert('Failed to gather mesh file list: ' + (err && err.message ? err.message : String(err)));
      return;
    }

    const meshNames = Array.from(new Set(
      (Array.isArray(meshItems) ? meshItems : [])
        .map(item => {
          if (!item) return null;
          if (typeof item === 'string') return item.split('/').pop();
          if (typeof item === 'object' && item.filename) return String(item.filename).split('/').pop();
          
          return String(item).split('/').pop();
        })
        .filter(Boolean)
    ));

    const missing = [];
    const fetched = {}; 

    if (meshNames.length) {
      await Promise.all(meshNames.map(async (name) => {
        const url = 'urdfs/meshes/' + name;
        try {
          const res = await fetch(url);
          if (!res.ok) {
            missing.push(name);
            return;
          }
          const blob = await res.blob();
          fetched[name] = blob;
        } catch (err) {
          console.warn('Fetch error for', url, err);
          missing.push(name);
        }
      }));
    }

    if (missing.length) {
      const msg = 'The STL files are missing:\n' + missing.join('\n');
      alert(msg);
      return;
    }

    const zip = new JSZip();
    const baseName = (filenameWithoutExt || 'assembly').replace(/\s+/g, '_');
    zip.file(baseName + '.urdf', urdf);

    if (meshNames.length) {
      const folder = zip.folder('meshes');
      meshNames.forEach(name => {
        folder.file(name, fetched[name]);
      });
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, baseName + '.zip');
  } catch (err) {
    console.error('saveAssemblyAsZip unexpected error', err);
    alert('Export failed: ' + (err && err.message ? err.message : String(err)));
  }
}


function showSaveModal(){
  if (document.getElementById('save-modal-overlay')) return;

  suppressShortcutsOnModal = true;
  interactionHasFocus = false;

  const overlay = document.createElement('div');
  overlay.id = 'save-modal-overlay';
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(0,0,0,0.45)';
  overlay.style.zIndex = 3000;
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';

  const box = document.createElement('div');
  box.style.width = '360px';
  box.style.maxWidth = '92%';
  box.style.background = '#111';
  box.style.border = '1px solid rgba(255,255,255,0.06)';
  box.style.padding = '16px';
  box.style.borderRadius = '10px';
  box.style.color = '#f3f6fb';
  box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.6)';

  const title = document.createElement('div');
  title.textContent = 'Export assembly';
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';
  box.appendChild(title);

  const hint = document.createElement('div');
  hint.textContent = 'This will generate a .urdf and a meshes/ folder (STL files referenced by the loaded URDFs).';
  hint.style.fontSize = '12px';
  hint.style.opacity = '0.85';
  hint.style.marginBottom = '12px';
  box.appendChild(hint);

  const input = document.createElement('input');
  input.placeholder = 'filename (without .urdf)';
  input.style.width = '100%';
  input.style.padding = '8px';
  input.style.borderRadius = '6px';
  input.style.border = '1px solid rgba(255,255,255,0.04)';
  input.style.background = '#0d0d0d';
  input.style.color = '#fff';
  input.value = 'assembly';
  box.appendChild(input);

  const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.marginTop='12px';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.style.background = 'transparent'; cancel.style.border = '1px solid rgba(255,255,255,0.06)'; cancel.style.color='#fff';
  cancel.addEventListener('click', ()=>{ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); suppressShortcutsOnModal=false; });
  const go = document.createElement('button'); go.textContent = 'Save URDF + meshes (zip)';
  go.addEventListener('click', async () => {
    const name = (input.value || 'assembly').trim().replace(/\s+/g,'_');
    try {
      await saveAssemblyAsZip(name);
    } catch (err) {
      console.error('Save failed', err);
      alert('Save failed: ' + (err && err.message));
    } finally {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      suppressShortcutsOnModal=false;
    }
  });

  row.appendChild(cancel); row.appendChild(go);
  box.appendChild(row);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

(function wireTopbarSaveAndVisualize(){
  function wire() {
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn){
      saveBtn.addEventListener('click', (ev)=> { ev.preventDefault(); showSaveModal(); });
    }

    const topbarRight = document.getElementById('topbar-right');


    let vizBtn = document.getElementById('visualize-btn');
    if (!vizBtn && topbarRight) {
      vizBtn = document.createElement('button');
      vizBtn.id = 'visualize-btn';
      vizBtn.className = 'btn-secondary';
      vizBtn.textContent = 'Visualize';
      vizBtn.style.marginRight = '8px';
      topbarRight.insertBefore(vizBtn, topbarRight.firstChild);
    }
    if (vizBtn) {
      vizBtn.replaceWith(vizBtn.cloneNode(true));
      vizBtn = document.getElementById('visualize-btn');
      vizBtn.addEventListener('click', ()=> {
        if (!visualizeMode) { 
          enterSimulationMode(vizBtn);
        }
        else {
          vizBtn.textContent="Visualize"; 
          exitSimulationMode();
        }
      });
    }
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', wire);
  else wire();
})();

enforceOutlinerStyles();
refreshOutliner();

window.saveAssemblyAsZip = saveAssemblyAsZip;

const history = [];
let historyIndex = -1;
const maxHistory = 10;
let suppressHistory = false;

function pushHistory(action){
  if (suppressHistory) return;
  if (historyIndex < history.length - 1) history.splice(historyIndex + 1);
  history.push(action);
  while (history.length > maxHistory) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedoButtons();
}

function updateUndoRedoButtons(){
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = historyIndex < 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
}

function undo(){
  if (historyIndex < 0) return;
  const action = history[historyIndex];
  if (!action) return;
  suppressHistory = true;
  try {
    if (action.type === 'transform'){
      const before = action.before || {};
      for (const id in before){
        const inst = instances[id];
        if (inst) applyWorldMatrixToObject(inst.rootGroup, before[id]);
      }
      for (const id in instances) onTransformChanged(id);
    } else if (action.type === 'add'){
      deleteInstance(action.id);
    } else if (action.type === 'delete'){
      const snap = action.snapshot;
      if (snap && snap.parsed){
        const pos = (snap.worldMatrix && (new THREE.Vector3()).setFromMatrixPosition(snap.worldMatrix)) || {x:0,y:0,z:0};
        instantiateParsedURDF(snap.parsed, snap.sourceURL, pos);
      }
    } else if (action.type === 'snap'){
      const parent = instances[action.parentId];
      const child = instances[action.childId];
      if (parent && child){
        parent.joints = (parent.joints || []).filter(j => j.childId !== child.id || j.parentTargetUUID !== (action.jointParentTargetUUID || j.parentTargetUUID));
        child.parentId = null;
        if (action.before){
          for (const id in action.before) {
            const inst = instances[id];
            if (inst) applyWorldMatrixToObject(inst.rootGroup, action.before[id]);
          }
        }
      }
    }
    historyIndex--;
  } finally {
    suppressHistory = false;
    refreshOutliner();
    refreshPropertiesPanel();
    updateUndoRedoButtons();
  }
}

function redo(){
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  const action = history[historyIndex];
  if (!action) return;
  suppressHistory = true;
  try {
    if (action.type === 'transform'){
      const after = action.after || {};
      for (const id in after) {
        const inst = instances[id];
        if (inst) applyWorldMatrixToObject(inst.rootGroup, after[id]);
      }
      for (const id in instances) onTransformChanged(id);
    } else if (action.type === 'add'){
      if (action.id && action.parsed) {
        instantiateParsedURDF(action.parsed, action.sourceURL, { x:0, y:0, z:0 });
      }
    } else if (action.type === 'delete'){
      if (action.snapshot && action.snapshot.id){
        const existing = Object.values(instances).find(i => i.id === action.snapshot.id);
        if (existing) deleteInstance(existing.id);
      }
    } else if (action.type === 'snap'){
      if (action.after){
        for (const id in action.after){
          const inst = instances[id];
          if (inst) applyWorldMatrixToObject(inst.rootGroup, action.after[id]);
        }
      }
    }
  } finally {
    suppressHistory = false;
    refreshOutliner();
    refreshPropertiesPanel();
    updateUndoRedoButtons();
  }
}

function findAssemblyRoot(){
  const roots = Object.values(instances).filter(i => !i.parentId);
  if (roots.length === 0) return null;
  return roots[0];
}


function generateAssemblyData() {
  
  console.log('Resetting all joint values to home position...');
  for (const inst of Object.values(instances)) {
    if (inst.internalJoints && inst.internalJoints.length > 0) {
      inst.internalJoints.forEach(joint => {
        if (joint.type !== 'fixed') {
          joint.value = 0;
          
          if (joint.type === 'revolute' || joint.type === 'continuous') {
            const ax = new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize();
            const q = new THREE.Quaternion().setFromAxisAngle(ax, 0);
            if (joint.pivot) joint.pivot.setRotationFromQuaternion(q);
          } else if (joint.type === 'prismatic') {
            if (joint.mover && joint.moverInitialPos) {
              joint.mover.position.copy(joint.moverInitialPos.clone());
            }
          }
        }
      });
      
      
      onTransformChanged(inst.id);
    }
  }

  
  const rootInstances = Object.values(instances).filter(inst => !inst.parentId);
  if (rootInstances.length > 0) {
    const rootInstance = rootInstances[0]; 
    console.log(`Moving root instance ${rootInstance.name} (${rootInstance.id}) to origin...`);
    
    
    rootInstance.rootGroup.position.set(0, 0, 0);
    rootInstance.rootGroup.rotation.set(0, 0, 0);
    
    
    onTransformChanged(rootInstance.id);
    
    
    rootInstance.rootGroup.updateWorldMatrix(true, true);
  }

  const assemblyData = {
    metadata: {
      totalInstances: Object.keys(instances).length,
      rootInstances: Object.values(instances).filter(inst => !inst.parentId).length,
      timestamp: Date.now(),
      generatedBy: 'URDF Assembly Editor',
      resetToHome: true,
      rootMovedToOrigin: true
    },
    instances: {},
    globalJointConnections: [],
    movableJoints: [],
    hierarchy: []
  };

  
  function getFirstRealLinkName(parsed) {
    if (!parsed || !parsed.links) return null;
    for (const link of parsed.links) {
      if (link.hasVisual || link.hasCollision) return link.name;
    }
    return null;
  }

  
  for (const [instId, inst] of Object.entries(instances)) {
    
    const rootPos = new THREE.Vector3();
    const rootQuat = new THREE.Quaternion();
    const rootScale = new THREE.Vector3();
    inst.rootGroup.matrixWorld.decompose(rootPos, rootQuat, rootScale);
    const rootEuler = new THREE.Euler().setFromQuaternion(rootQuat, 'XYZ');

    
    const processedLinks = [];
    if (inst.parsed && inst.parsed.links) {
      inst.parsed.links.forEach(link => {
        const linkData = {
          name: link.name,
          fullName: `${instId}__${link.name}`,
          hasVisual: link.hasVisual,
          hasCollision: link.hasCollision,
          isAttachOnly: !link.hasVisual && !link.hasCollision,
          visualOrigin: link.visualOrigin || { xyz: [0,0,0], rpy: [0,0,0] },
          meshes: (link.meshes || []).map(mesh => ({
            filename: mesh.filename ? mesh.filename.split('/').pop() : 'unknown.stl',
            originalFilename: mesh.filename,
            scale: mesh.scale || [0.001, 0.001, 0.001],
            finalScale: calculateFinalMeshScale(mesh, inst)
          }))
        };
        processedLinks.push(linkData);
      });
    }

    
    const processedInternalJoints = [];
    if (inst.internalJoints && inst.internalJoints.length > 0) {
      inst.internalJoints.forEach(joint => {
        const jointData = {
          name: joint.name,
          fullName: `${instId}__${joint.name}`,
          type: joint.type,
          parent: joint.parent,
          parentFullName: `${instId}__${joint.parent}`,
          child: joint.child,
          childFullName: `${instId}__${joint.child}`,
          currentValue: joint.value || 0,
          axis: joint.axis || [1, 0, 0],
          limit: joint.limit || null,
          origin: getJointOriginFromParsed(inst.parsed, joint.name),
          isMovable: joint.type !== 'fixed'
        };

        
        if (joint.pivot) {
          joint.pivot.updateWorldMatrix(true, true);
          const pivotPos = new THREE.Vector3();
          const pivotQuat = new THREE.Quaternion();
          joint.pivot.matrixWorld.decompose(pivotPos, pivotQuat, new THREE.Vector3());
          const pivotEuler = new THREE.Euler().setFromQuaternion(pivotQuat, 'XYZ');
          
          jointData.pivotWorldTransform = {
            position: [pivotPos.x, pivotPos.y, pivotPos.z],
            rotation: [pivotEuler.x, pivotEuler.y, pivotEuler.z]
          };
        }

        processedInternalJoints.push(jointData);

        
        assemblyData.globalJointConnections.push({
          parent: jointData.parentFullName,
          child: jointData.childFullName,
          jointName: jointData.fullName,
          type: joint.type,
          parentInstance: instId,
          childInstance: instId,
          isInternal: true,
          jointData: jointData
        });

        
        if (joint.type !== 'fixed') {
          assemblyData.movableJoints.push({
            instanceId: instId,
            instanceName: inst.name,
            jointName: joint.name,
            fullJointName: jointData.fullName,
            type: joint.type,
            currentValue: joint.value || 0,
            axis: joint.axis || [1, 0, 0],
            limits: joint.limit || null,
            parent: joint.parent,
            child: joint.child
          });
        }
      });
    }

    
    const processedSnapJoints = [];
    if (inst.joints && inst.joints.length > 0) {
      inst.joints.forEach(joint => {
        const childInst = instances[joint.childId];
        const childFirstLink = childInst ? (getFirstRealLinkName(childInst.parsed) || childInst.rootLinkName) : 'unknown';
        const parentLink = joint.parentTargetLinkName || getFirstRealLinkName(inst.parsed) || inst.rootLinkName;
        
        const parentLinkFull = `${instId}__${parentLink}`;
        const childLinkFull = `${joint.childId}__${childFirstLink}`;
        const snapJointName = `snap_${instId}_to_${joint.childId}`;

        
        
        let relativeTransform = { xyz: [0,0,0], rpy: [0,0,0], quaternion: [0,0,0,1] };
        if (joint.childRelMatrix) {
          const relPos = new THREE.Vector3();
          const relQuat = new THREE.Quaternion();
          joint.childRelMatrix.decompose(relPos, relQuat, new THREE.Vector3());
          
          relativeTransform = {
            xyz: [relPos.x, relPos.y, relPos.z],
            rpy: [0, 0, 0], 
            quaternion: [relQuat.x, relQuat.y, relQuat.z, relQuat.w]
          };
        }

        const snapJointData = {
          name: snapJointName,
          type: joint.type,
          parentId: instId,
          childId: joint.childId,
          parentTargetUUID: joint.parentTargetUUID,
          parentTargetLinkName: joint.parentTargetLinkName,
          parentLink: parentLink,
          parentLinkFull: parentLinkFull,
          childLink: childFirstLink,
          childLinkFull: childLinkFull,
          relativeTransform: relativeTransform,
          childRelMatrix: joint.childRelMatrix
        };

        processedSnapJoints.push(snapJointData);

        
        assemblyData.globalJointConnections.push({
          parent: parentLinkFull,
          child: childLinkFull,
          jointName: snapJointName,
          type: joint.type,
          parentInstance: instId,
          childInstance: joint.childId,
          isInternal: false,
          jointData: snapJointData
        });
      });
    }

    
    assemblyData.instances[instId] = {
      id: instId,
      name: inst.name,
      sourceURL: inst.sourceURL,
      parentId: inst.parentId,
      childrenIds: inst.childrenIds || [],
      rootLinkName: inst.rootLinkName,
      
      
      worldTransform: {
        position: [rootPos.x, rootPos.y, rootPos.z],
        rotation: [rootEuler.x, rootEuler.y, rootEuler.z],
        scale: [rootScale.x, rootScale.y, rootScale.z]
      },

      
      links: processedLinks,
      internalJoints: processedInternalJoints,
      snapJoints: processedSnapJoints,

      
      parsed: inst.parsed,
      
      
      stats: {
        totalLinks: processedLinks.length,
        visualLinks: processedLinks.filter(l => l.hasVisual).length,
        collisionLinks: processedLinks.filter(l => l.hasCollision).length,
        attachOnlyLinks: processedLinks.filter(l => l.isAttachOnly).length,
        internalJoints: processedInternalJoints.length,
        movableInternalJoints: processedInternalJoints.filter(j => j.isMovable).length,
        snapJoints: processedSnapJoints.length
      }
    };
  }

  
  const rootHierarchy = Object.values(instances).filter(inst => !inst.parentId);
  
  function buildHierarchy(inst) {
    const hierarchyNode = {
      id: inst.id,
      name: inst.name,
      children: []
    };
    
    if (inst.childrenIds && inst.childrenIds.length > 0) {
      inst.childrenIds.forEach(childId => {
        const childInst = instances[childId];
        if (childInst) {
          hierarchyNode.children.push(buildHierarchy(childInst));
        }
      });
    }
    
    return hierarchyNode;
  }

  assemblyData.hierarchy = rootHierarchy.map(rootInst => buildHierarchy(rootInst));

  return assemblyData;
}


function calculateFinalMeshScale(mesh, inst) {
  let finalScale = [0.001, 0.001, 0.001]; 
  
  if (mesh.scale && mesh.scale.length) {
    finalScale = [
      mesh.scale[0] || 0.001,
      mesh.scale[1] || mesh.scale[0] || 0.001,
      mesh.scale[2] || mesh.scale[0] || 0.001
    ];
  }
  
  
  if (inst.rootGroup && inst.rootGroup.scale) {
    finalScale[0] *= inst.rootGroup.scale.x || 1;
    finalScale[1] *= inst.rootGroup.scale.y || 1;
    finalScale[2] *= inst.rootGroup.scale.z || 1;
  }
  
  return finalScale;
}


function getJointOriginFromParsed(parsed, jointName) {
  if (!parsed || !parsed.joints) return { xyz: [0,0,0], rpy: [0,0,0] };
  
  const joint = parsed.joints.find(j => j.name === jointName);
  return joint ? (joint.origin || { xyz: [0,0,0], rpy: [0,0,0] }) : { xyz: [0,0,0], rpy: [0,0,0] };
}

function enterSimulationMode(vizBtn){
  Info.setRunMode(true);
  const root = findAssemblyRoot();
  if (!root) { alert('No assembly to Visualize'); return; }
  vizBtn.textContent="Exit";
  visualizeMode = true;
  selectionEnabled = false;
  interactionHasFocus = false;
  transformControl.detach();
  transformControl.visible = false;
  document.getElementById('left-column') && (document.getElementById('left-column').style.display = 'none');
  
  for (const id in instances){
    instances[id].attachSpheres.forEach(ap => { if (ap.sphere) ap.sphere.visible = false; });
  }
  focusOnInstance(root.id);

  const props = document.getElementById('properties-panel');
  if (!props) return;
  props.innerHTML = '';
  const title = document.createElement('div'); title.textContent = 'Move Joints'; title.style.fontWeight='700'; title.style.marginBottom='8px';
  props.appendChild(title);
  const container = document.createElement('div'); container.style.display='flex'; container.style.flexDirection='column'; container.style.gap='8px';

  const movable = [];
  for (const id in instances){
    const inst = instances[id];
    if (inst.internalJoints && inst.internalJoints.length){
      inst.internalJoints.forEach(j => { if (j.type !== 'fixed') movable.push({ inst, j }); });
    }
  }
  if (movable.length === 0) {
    const note = document.createElement('div'); note.textContent = 'No movable joints in this assembly.'; container.appendChild(note);
  } else {
    movable.forEach(item => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '6px';

      const lab = document.createElement('div');
      lab.textContent = `${item.inst.name} - ${item.j.name || (item.j.parent + '_to_' + item.j.child)}`;
      lab.style.fontWeight = '600';

      
      const range = document.createElement('input');
      range.type = 'range';
      range.min = (item.j.limit && !isNaN(item.j.limit.lower)) ? item.j.limit.lower : (item.j.type === 'prismatic' ? -0.1 : -Math.PI);
      range.max = (item.j.limit && !isNaN(item.j.limit.upper)) ? item.j.limit.upper : (item.j.type === 'prismatic' ? 0.1 : Math.PI);
      range.step = (parseFloat(range.max) - parseFloat(range.min)) / 200;
      range.style.width = "100%";
      range.value = item.j.value || 0;

      
      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'joint-number';
      num.step = range.step;
      num.min = range.min;
      num.max = range.max;
      num.value = Math.round((parseFloat(range.value) || 0) * 1000) / 1000;

      function applySimJointValue(v) {
        const val = parseFloat(v) || 0;
        item.j.value = val;
        if (item.j.type === 'revolute' || item.j.type === 'continuous') {
          const ax = new THREE.Vector3(item.j.axis[0], item.j.axis[1], item.j.axis[2]).normalize();
          const q = new THREE.Quaternion().setFromAxisAngle(ax, item.j.value);
          if (item.j.pivot) item.j.pivot.setRotationFromQuaternion(q);
        } else if (item.j.type === 'prismatic') {
          const ax = new THREE.Vector3(item.j.axis[0], item.j.axis[1], item.j.axis[2]).normalize();
          const offset = ax.clone().multiplyScalar(item.j.value);
          if (item.j.mover && item.j.moverInitialPos) item.j.mover.position.copy(item.j.moverInitialPos.clone().add(offset));
        }
        onTransformChanged(item.inst.id);
      }

      range.addEventListener('input', () => {
        const v = parseFloat(range.value) || 0;
        num.value = Math.round(v * 1000) / 1000;
        applySimJointValue(v);
      });

      num.addEventListener('change', () => {
        let v = parseFloat(num.value);
        if (isNaN(v)) v = 0;
        if (v < parseFloat(range.min)) v = parseFloat(range.min);
        if (v > parseFloat(range.max)) v = parseFloat(range.max);
        num.value = Math.round(v * 1000) / 1000;
        range.value = v;
        applySimJointValue(v);
      });

      const rr = document.createElement('div');
      rr.style.display = 'flex';
      rr.style.alignItems = 'center';
      rr.style.gap = '8px';
      rr.style.justifyContent = 'space-between';
      rr.appendChild(range);
      rr.appendChild(num);

      row.appendChild(lab);
      row.appendChild(rr);
      container.appendChild(row);
  });

  }
  props.appendChild(container);
}

function exitSimulationMode(){
  Info.setRunMode(false);
  Info.hideAllInfo();
  visualizeMode = false;
  selectionEnabled = true;
  transformControl.visible = true;
  document.getElementById('left-column') && (document.getElementById('left-column').style.display = '');
  document.getElementById('topbar') && (document.getElementById('topbar').style.display = '');
  for (const id in instances){
    instances[id].attachSpheres.forEach(ap => { if (ap.sphere) ap.sphere.visible = true; });
  }
  refreshPropertiesPanel();
  refreshOutliner();
  interactionHasFocus = true;
}

const Info = initInfoModule({ scene, camera, renderer, canvas, instances });
