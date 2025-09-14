import * as THREE from 'three';

export default function initInfoModule({ scene, camera, renderer, canvas, instances }){
  if (!scene || !renderer || !canvas) throw new Error('initInfoModule: missing required params');

  const densities = {
    'Steel (A36)': 7850,     
    'Aluminium (6061)': 2700,
    'ABS': 1040,
    'PLA': 1250
  };

  let currentMarker = null;
  let runMode = false; 
  const openInlinePanels = new Map(); 
  let assemblyPanelOpen = false;
  let assemblyButtonInProps = null;
  let propsObserver = null;

  
  const markerOptions = {
    color: 0xffff00,
    opacity: 0.85,
    size: 0.02,
    depthTest: false 
  };

  function createModal(){ 
    let modal = document.getElementById('rb-info-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'rb-info-modal';
    modal.style.position = 'fixed';
    modal.style.left = '50%'; modal.style.top = '50%';
    modal.style.transform = 'translate(-50%,-50%)';
    modal.style.minWidth = '360px'; modal.style.maxWidth = '720px';
    modal.style.zIndex = 20000; modal.style.background = 'linear-gradient(180deg,#121212,#0b0b0b)';
    modal.style.border = '1px solid rgba(255,255,255,0.06)'; modal.style.padding = '14px';
    modal.style.borderRadius = '10px'; modal.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)'; modal.style.color = '#e8eef1';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div style="font-weight:700;flex:1">Part info</div>
        <button id="rb-info-close" class="btn-help" title="Close">✕</button>
      </div>
      <div id="rb-info-content" style="font-size:13px;line-height:1.3"></div>
    `;
    document.body.appendChild(modal);
    document.getElementById('rb-info-close').addEventListener('click', ()=>{ hideModal(); });
    return modal;
  }
  function showModal(html){ const modal = createModal(); const content = modal.querySelector('#rb-info-content'); content.innerHTML = html; modal.style.display = 'block'; }
  function hideModal(){ const modal = document.getElementById('rb-info-modal'); if (modal) modal.style.display='none'; removeMarker(); }

  function makeInfoButton(){
    const btn = document.createElement('button');
    btn.className = 'btn-info';
    btn.title = 'Info';
    btn.style.width = '30px'; btn.style.height = '30px'; btn.style.padding = '0';
    btn.style.display = 'inline-flex'; btn.style.alignItems = 'center'; btn.style.justifyContent = 'center';
    btn.textContent = 'ⓘ';
    return btn;
  }

  function formatNumber(n, digits=3){ if (!isFinite(n)) return '—'; return Number(n).toFixed(digits).replace(/\.0+$/,''); }

  
  function applyMatrixToVector3Array(matrix, arr){ const out = new Float32Array(arr.length); const v = new THREE.Vector3(); for (let i=0;i<arr.length;i+=3){ v.set(arr[i],arr[i+1],arr[i+2]).applyMatrix4(matrix); out[i]=v.x; out[i+1]=v.y; out[i+2]=v.z; } return out; }

  function computeInstanceVolumeAndCOM(inst){
    const parsed = inst.parsed || {}; const links = parsed.links || [];
    let totalVol = 0; const weighted = new THREE.Vector3(0,0,0);
    for (const lname in inst.linkObjects){
      const linkDef = links.find(l => l.name === lname) || { hasVisual: true, hasCollision: true };
      if (!linkDef.hasVisual && !linkDef.hasCollision) continue;
      const container = inst.linkObjects[lname]; if (!container) continue;
      container.traverse(node => { 
        if (!node.isMesh) return; 
        if (node.name && node.name.startsWith('AP:')) return; 
        node.updateWorldMatrix(true,true); 
        
        const box = new THREE.Box3().setFromObject(node);
        if (box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3());
        const volume = size.x * size.y * size.z;
        const centroid = box.getCenter(new THREE.Vector3());
        
        if (!volume || !isFinite(volume)) return; 
        totalVol += volume; 
        weighted.addScaledVector(centroid, volume); 
      });
    }
    if (totalVol <= 0) return { volume: 0, com: new THREE.Vector3() };
    const com = weighted.divideScalar(totalVol); 
    return { volume: totalVol, com }; 
  }

  function computeAssemblyVolumeAndCOM(){ let totalVol = 0; const weighted = new THREE.Vector3(0,0,0); for (const id in instances){ const inst = instances[id]; const { volume, com } = computeInstanceVolumeAndCOM(inst); if (!volume || volume <= 0) continue; totalVol += volume; weighted.addScaledVector(com, volume); } if (totalVol <= 0) return { volume: 0, com: new THREE.Vector3() }; const com = weighted.divideScalar(totalVol); return { volume: totalVol, com }; }

  
  function createMarkerMaterial(){
    return new THREE.MeshBasicMaterial({
      color: markerOptions.color,
      transparent: markerOptions.opacity < 1.0,
      opacity: markerOptions.opacity,
      depthTest: !!markerOptions.depthTest,
      depthWrite: false
    });
  }

  function placeMarkerAt(worldVec){
    removeMarker();
    
    const g = new THREE.SphereGeometry(markerOptions.size, 12, 10);
    const m = createMarkerMaterial();
    const s = new THREE.Mesh(g, m);
    s.name = 'rb-info-marker';
    s.position.copy(worldVec);
    s.renderOrder = 99999;
    s.frustumCulled = false;
    
    scene.add(s);
    currentMarker = s;
  }

  function removeMarker(){ if (currentMarker){ try{ scene.remove(currentMarker); if (currentMarker.geometry) currentMarker.geometry.dispose(); if (currentMarker.material) currentMarker.material.dispose(); }catch(e){} currentMarker = null; } }

  function escapeHtml(s){ return (s+'').replace(/[&<>\"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]||m)); }

  
  function createInlineInfoBox(inst){
    const container = document.createElement('div');
    container.className = 'rb-inline-info';
    container.style.marginLeft = '8px';
    container.style.padding = '8px';
    container.style.border = '1px solid rgba(255,255,255,0.04)';
    container.style.borderRadius = '6px';
    container.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.02))';
    container.style.fontSize = '12px'; container.style.maxWidth = '320px';

    
    const box = new THREE.Box3(); let found=false;
    for (const lname in inst.linkObjects){ const linkDef = (inst.parsed && inst.parsed.links) ? inst.parsed.links.find(l => l.name === lname) : { hasVisual:true }; if (!linkDef || (!linkDef.hasVisual && !linkDef.hasCollision)) continue; const obj = inst.linkObjects[lname]; if (!obj) continue; box.expandByObject(obj); found=true; }

    let html = '';
    if (!found || box.isEmpty()){
      html += `<div>No visual geometry to measure</div>`;
    } else {
      const size = new THREE.Vector3(); box.getSize(size);
      html += `<div style="font-weight:700;margin-bottom:6px">Dimensions</div>`;
      html += `<div>${formatNumber(size.x,4)} m × ${formatNumber(size.y,4)} m × ${formatNumber(size.z,4)} m</div>`;
      html += `<div style="color:var(--muted)">= ${formatNumber(size.x*1000,2)} mm × ${formatNumber(size.y*1000,2)} mm × ${formatNumber(size.z*1000,2)} mm</div>`;
    }

    const { volume, com } = computeInstanceVolumeAndCOM(inst);
    html += `<hr style="opacity:0.06;margin:8px 0">`;
    html += `<div>Volume: <strong>${formatNumber(volume,6)} m³</strong></div>`;

    html += `<div style="margin-top:8px">Material: <select class="rb-inline-material">`;
    for (const k in densities) html += `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`;
    html += `</select></div>`;
    html += `<div class="rb-mass" style="margin-top:8px">Mass: —</div>`;
    html += `<div class="rb-com" style="margin-top:6px">COM: —</div>`;

    container.innerHTML = html;

    
    const sel = container.querySelector('.rb-inline-material'); const massDiv = container.querySelector('.rb-mass'); const comDiv = container.querySelector('.rb-com');
    function update(){ const mat = sel.value; const rho = densities[mat] || 1000; const mass = volume * rho; massDiv.innerHTML = `Mass: <strong>${formatNumber(mass,4)} kg</strong>`; if (volume>0 && com){ comDiv.innerHTML = `COM: <strong>${formatNumber(com.x,4)} m, ${formatNumber(com.y,4)} m, ${formatNumber(com.z,4)} m</strong>`; placeMarkerAt(com); } }
    sel.addEventListener('change', update); update();

    return container;
  }

  
  function injectButtonForInstance(panel, inst){
    if (!panel || !inst) return;
    
    const title = panel.querySelector('div[style*="font-weight:700"]') || panel.firstChild;
    if (!title) return;

    
    let wrapper = panel.querySelector('.rb-title-wrapper');
    if (!wrapper){ wrapper = document.createElement('div'); wrapper.className='rb-title-wrapper'; wrapper.style.display='flex'; wrapper.style.alignItems='center'; wrapper.style.gap='8px'; wrapper.style.justifyContent = "space-between"; panel.insertBefore(wrapper, title); wrapper.appendChild(title); }

    
    let existing = wrapper.querySelector('.rb-info-btn');
    if (existing){ return; }

    const btn = makeInfoButton(); btn.classList.add('rb-info-btn'); btn.style.width='26px'; btn.style.height='26px';
    wrapper.appendChild(btn);

    btn.addEventListener('click', (e) => { e.stopPropagation();
      if (runMode){ 
        toggleAssemblyPanel();
        return;
      }

      
      const key = inst.id;
      if (openInlinePanels.has(key)){
        const node = openInlinePanels.get(key); if (node && node.parentNode) node.parentNode.removeChild(node); openInlinePanels.delete(key); removeMarker(); return; }

      const box = createInlineInfoBox(inst);
      wrapper.after(box);
      openInlinePanels.set(key, box);
    });
  }

  
  function ensureAssemblyButtonInProperties(){
    const props = document.getElementById('properties-panel'); if (!props) return;
    if (assemblyButtonInProps && props.contains(assemblyButtonInProps)) return;
    const container = document.createElement('div'); container.style.display='flex'; container.style.justifyContent='flex-end'; container.style.padding='6px 8px';
    const btn = makeInfoButton(); btn.id = 'rb-assembly-info-btn-props'; btn.title='Assembly Info'; btn.style.width='28px'; btn.style.height='28px';
    container.appendChild(btn);
    props.insertBefore(container, props.firstChild);
    assemblyButtonInProps = container;
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleAssemblyPanel(); });
  }

  function removeAssemblyButtonFromProperties(){ const props = document.getElementById('properties-panel'); if (!props) return; if (assemblyButtonInProps && assemblyButtonInProps.parentNode) assemblyButtonInProps.parentNode.removeChild(assemblyButtonInProps); assemblyButtonInProps=null; }

  function toggleAssemblyPanel(){ if (!assemblyPanelOpen){ showAssemblyInfo(); assemblyPanelOpen = true; } else { hideAssemblyInfo(); assemblyPanelOpen = false; } }

  function showAssemblyInfo(){ const { volume, com } = computeAssemblyVolumeAndCOM(); const vol_m3 = volume; const vol_cm3 = vol_m3 * 1e6; let html = `<div style="font-weight:700;margin-bottom:6px">Assembly info</div>`; html += `<div style="margin-bottom:8px">Estimated total volume: <strong>${formatNumber(vol_m3,6)} m³</strong> (${formatNumber(vol_cm3,2)} cm³)</div>`; html += `<div style="margin-bottom:8px">Select material: <select id="rb-info-assembly-material">`; for (const k in densities) html += `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`; html += `</select></div>`; html += `<div id="rb-info-assembly-mass" style="margin-top:8px">Mass: —</div>`; html += `<div id="rb-info-assembly-com" style="margin-top:8px">COM: —</div>`;
    const props = document.getElementById('properties-panel'); if (!props) { showModal(html); return; }
    let existing = props.querySelector('.rb-assembly-info-block'); if (existing) existing.remove();
    const block = document.createElement('div'); block.className='rb-assembly-info-block'; block.style.marginTop='10px'; block.style.padding='8px'; block.style.border='1px solid rgba(255,255,255,0.04)'; block.style.borderRadius='6px'; block.style.maxWidth='100%'; block.innerHTML = html;
    
    if (assemblyButtonInProps && props.contains(assemblyButtonInProps)) {
      if (assemblyButtonInProps.nextSibling) props.insertBefore(block, assemblyButtonInProps.nextSibling);
      else props.appendChild(block);
    } else {
      props.insertBefore(block, props.firstChild);
    }

    const sel = block.querySelector('#rb-info-assembly-material'); const massDiv = block.querySelector('#rb-info-assembly-mass'); const comDiv = block.querySelector('#rb-info-assembly-com');
    function update(){ const mat = sel.value; const rho = densities[mat] || 1000; const mass = vol_m3 * rho; massDiv.innerHTML = `Mass (est): <strong>${formatNumber(mass,4)} kg</strong>`; if (volume>0){ comDiv.innerHTML = `COM: <strong>${formatNumber(com.x,4)} m, ${formatNumber(com.y,4)} m, ${formatNumber(com.z,4)} m</strong>`; placeMarkerAt(com); } }
    sel.addEventListener('change', update); update(); }

  function hideAssemblyInfo(){
  
  const props = document.getElementById('properties-panel');
  if (props) {
    const existing = props.querySelector('.rb-assembly-info-block');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  
  const all = document.querySelectorAll('.rb-assembly-info-block');
  all.forEach(node => {
    try{ if (node && node.parentNode) node.parentNode.removeChild(node); }catch(e){}
  });

  
  removeMarker();
  assemblyPanelOpen = false;
}

  
  function hideAllInfo(){
    
    try{
      openInlinePanels.forEach((node, key) => { if (node && node.parentNode) node.parentNode.removeChild(node); });
    }catch(e){}
    openInlinePanels.clear();

    
    hideAssemblyInfo();
    removeAssemblyButtonFromProperties();

    
    const floatBtn = document.getElementById('rb-assembly-info-btn'); if (floatBtn && floatBtn.parentNode) floatBtn.parentNode.removeChild(floatBtn);

    
    hideModal();

    
    removeMarker();
  }

  
  function setRunMode(enabled){ runMode = !!enabled; if (runMode){ ensureAssemblyButtonInProperties(); if (!propsObserver){ const props = document.getElementById('properties-panel'); if (props){ propsObserver = new MutationObserver(()=>{ ensureAssemblyButtonInProperties(); }); propsObserver.observe(props, { childList:true, subtree:false }); } } } else { if (propsObserver){ propsObserver.disconnect(); propsObserver=null; } removeAssemblyButtonFromProperties(); hideAssemblyInfo(); } }

  
  function start(){ createTopAssemblyUI(); }
  function stop(){ const btn = document.getElementById('rb-assembly-info-btn'); if (btn) btn.remove(); hideModal(); removeMarker(); }
  function hide(){ hideModal(); removeMarker(); }

  
  function createTopAssemblyUI(){ if (document.getElementById('rb-assembly-info-btn')) return; const btn = document.createElement('button'); btn.id='rb-assembly-info-btn'; btn.className='btn-help'; btn.textContent='i'; btn.title='Assembly info'; btn.style.position='fixed'; btn.style.left='calc(50% + 60px)'; btn.style.top='15px'; btn.style.zIndex=1100; document.body.appendChild(btn); btn.addEventListener('click', (e)=>{ e.preventDefault(); toggleAssemblyPanel(); }); }

  
  function setMarkerAppearance({ color, opacity, size, depthTest } = {}){
    if (typeof color !== 'undefined') markerOptions.color = color;
    if (typeof opacity !== 'undefined') markerOptions.opacity = opacity;
    if (typeof size !== 'undefined') markerOptions.size = size;
    if (typeof depthTest !== 'undefined') markerOptions.depthTest = depthTest;

    
    if (currentMarker){ const pos = currentMarker.position.clone(); removeMarker(); placeMarkerAt(pos); }
  }

  return {
    injectButtonForInstance,
    showAssemblyInfo,
    showInstanceInfo: function(inst){ 
      const { volume, com } = computeInstanceVolumeAndCOM(inst);
      let html = `<div style="font-weight:700;margin-bottom:6px">${escapeHtml(inst.name || inst.id)}</div>`;
      html += `<div>Estimated Volume: <strong>${formatNumber(volume,6)} m³</strong></div>`;
      html += `<div id="rb-info-com">COM: —</div>`;
      showModal(html);
      if (volume>0 && com) placeMarkerAt(com);
    },
    createAssemblyInfoButton: createTopAssemblyUI,
    start, stop, hide,
    setRunMode,
    
    hideAllInfo,
    
    setMarkerAppearance
  };
}
