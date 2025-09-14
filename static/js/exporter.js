



function formatNumber(n) {
  const num = Number.parseFloat(n);
  if (!isFinite(num)) return '0.000000';
  return Math.abs(num) < 1e-12 ? '0.000000' : num.toFixed(6);
}




function canonicalizeQuat(q) {
  
  let [x,y,z,w] = q.map(Number);
  const n = Math.hypot(x||0,y||0,z||0,w||0) || 1;
  x /= n; y /= n; z /= n; w /= n;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  return [x,y,z,w];
}

function quatToRotationMatrix4(q) {
  const [qx, qy, qz, qw] = canonicalizeQuat(q);
  const xx = qx*qx, yy = qy*qy, zz = qz*qz;
  const xy = qx*qy, xz = qx*qz, yz = qy*qz;
  const wx = qw*qx, wy = qw*qy, wz = qw*qz;

  const r00 = 1 - 2*(yy + zz);
  const r01 = 2*(xy - wz);
  const r02 = 2*(xz + wy);

  const r10 = 2*(xy + wz);
  const r11 = 1 - 2*(xx + zz);
  const r12 = 2*(yz - wx);

  const r20 = 2*(xz - wy);
  const r21 = 2*(yz + wx);
  const r22 = 1 - 2*(xx + yy);

  
  return [
    [r00, r01, r02, 0],
    [r10, r11, r12, 0],
    [r20, r21, r22, 0],
    [0,   0,   0,   1]
  ];
}

function composeOriginFromQuatAndTranslation(quat, translation) {
  const M = quatToRotationMatrix4(quat);
  M[0][3] = (translation && translation[0]) ? Number(translation[0]) : 0;
  M[1][3] = (translation && translation[1]) ? Number(translation[1]) : 0;
  M[2][3] = (translation && translation[2]) ? Number(translation[2]) : 0;
  return M;
}

function callMatToXyzRpy(mat4rowmajor) {
  
  
  try {
    return matToXyzRpy(mat4rowmajor);
  } catch (e) {
    const flatColumnMajor = [
      mat4rowmajor[0][0], mat4rowmajor[1][0], mat4rowmajor[2][0], mat4rowmajor[3][0],
      mat4rowmajor[0][1], mat4rowmajor[1][1], mat4rowmajor[2][1], mat4rowmajor[3][1],
      mat4rowmajor[0][2], mat4rowmajor[1][2], mat4rowmajor[2][2], mat4rowmajor[3][2],
      mat4rowmajor[0][3], mat4rowmajor[1][3], mat4rowmajor[2][3], mat4rowmajor[3][3],
    ];
    return matToXyzRpy(flatColumnMajor);
  }
}


function quaternionToRPY(quat) {
  const [x, y, z, w] = quat;
  
  
  const test = x*y + z*w;
  
  if (test > 0.499) { 
    const yaw = 2 * Math.atan2(x, w);
    const pitch = Math.PI / 2;
    const roll = 0;
    return [roll, pitch, yaw];
  }
  
  if (test < -0.499) { 
    const yaw = -2 * Math.atan2(x, w);
    const pitch = -Math.PI / 2;
    const roll = 0;
    return [roll, pitch, yaw];
  }
  
  const sqx = x*x;
  const sqy = y*y;
  const sqz = z*z;
  
  const yaw = Math.atan2(2*y*w - 2*x*z, 1 - 2*sqy - 2*sqz);
  const pitch = Math.asin(2*test);
  const roll = Math.atan2(2*x*w - 2*y*z, 1 - 2*sqx - 2*sqz);
  
  return [roll, pitch, yaw];
}




function normalizeTransform(t) {
  if (!t) return { xyz: [0,0,0], rpy: [0,0,0] };
  if (Array.isArray(t.xyz) && Array.isArray(t.rpy)) {
    const out = { xyz: t.xyz.slice(0,3).map(Number), rpy: t.rpy.slice(0,3).map(Number) };
    if (Array.isArray(t.quaternion) && t.quaternion.length === 4) out.quaternion = t.quaternion.slice(0,4).map(Number);
    return out;
  }
  if (Array.isArray(t.position) && Array.isArray(t.rotation)) {
    const out = { xyz: t.position.slice(0,3).map(Number), rpy: t.rotation.slice(0,3).map(Number) };
    if (Array.isArray(t.quaternion) && t.quaternion.length === 4) out.quaternion = t.quaternion.slice(0,4).map(Number);
    return out;
  }
  if (t.origin && Array.isArray(t.origin.xyz) && Array.isArray(t.origin.rpy)) {
    const out = { xyz: t.origin.xyz.slice(0,3).map(Number), rpy: t.origin.rpy.slice(0,3).map(Number) };
    if (Array.isArray(t.quaternion) && t.quaternion.length === 4) out.quaternion = t.quaternion.slice(0,4).map(Number);
    return out;
  }
  if (typeof t === 'object') {
    const xyz = (Array.isArray(t.xyz) ? t.xyz : [t.x||t.X||0, t.y||t.Y||0, t.z||t.Z||0]).slice(0,3).map(Number);
    const rpy = (Array.isArray(t.rpy) ? t.rpy : (Array.isArray(t.rotation) ? t.rotation : [t.rx||0,t.ry||0,t.rz||0])).slice(0,3).map(Number);
    const out = { xyz, rpy };
    if (Array.isArray(t.quaternion) && t.quaternion.length === 4) out.quaternion = t.quaternion.slice(0,4).map(Number);
    return out;
  }
  return { xyz: [0,0,0], rpy: [0,0,0] };
}


function rpyToMatrix(rpy) {
  const [roll, pitch, yaw] = rpy;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);

  const m00 = cy * cp;
  const m01 = cy * sp * sr - sy * cr;
  const m02 = cy * sp * cr + sy * sr;

  const m10 = sy * cp;
  const m11 = sy * sp * sr + cy * cr;
  const m12 = sy * sp * cr - cy * sr;

  const m20 = -sp;
  const m21 = cp * sr;
  const m22 = cp * cr;

  
  return [
    [m00, m01, m02, 0],
    [m10, m11, m12, 0],
    [m20, m21, m22, 0],
    [0,   0,   0,   1]
  ];
}

function transformFromXyzRpy(xyz, rpy, scale) {
  const s = (scale && Array.isArray(scale)) ? scale : [1,1,1];
  const tx = (xyz[0]||0) * s[0];
  const ty = (xyz[1]||0) * s[1];
  const tz = (xyz[2]||0) * s[2];
  const R = rpyToMatrix(rpy);
  R[0][3] = tx;
  R[1][3] = ty;
  R[2][3] = tz;
  return R;
}

function matMul(A, B) {
  const C = Array.from({length:4}, () => Array(4).fill(0));
  for (let i=0;i<4;i++){
    for (let j=0;j<4;j++){
      let s = 0;
      for (let k=0;k<4;k++) s += A[i][k]*B[k][j];
      C[i][j] = s;
    }
  }
  return C;
}

function matInv(M) {
  
  const R = [
    [M[0][0], M[0][1], M[0][2]],
    [M[1][0], M[1][1], M[1][2]],
    [M[2][0], M[2][1], M[2][2]]
  ];
  const p = [M[0][3], M[1][3], M[2][3]];
  const RT = [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]]
  ];
  const negRTp = [
    -(RT[0][0]*p[0] + RT[0][1]*p[1] + RT[0][2]*p[2]),
    -(RT[1][0]*p[0] + RT[1][1]*p[1] + RT[1][2]*p[2]),
    -(RT[2][0]*p[0] + RT[2][1]*p[1] + RT[2][2]*p[2])
  ];
  return [
    [RT[0][0], RT[0][1], RT[0][2], negRTp[0]],
    [RT[1][0], RT[1][1], RT[1][2], negRTp[1]],
    [RT[2][0], RT[2][1], RT[2][2], negRTp[2]],
    [0,0,0,1]
  ];
}

function matToXyzRpy(M) {
  const x = M[0][3], y = M[1][3], z = M[2][3];
  const r20 = M[2][0];
  const r21 = M[2][1];
  const r22 = M[2][2];
  const r10 = M[1][0];
  const r00 = M[0][0];

  const pitch = Math.atan2(-r20, Math.sqrt(r21*r21 + r22*r22));
  const sy = Math.sqrt(r21*r21 + r22*r22);
  let roll, yaw;
  if (sy > 1e-8) {
    roll = Math.atan2(r21, r22);
    yaw  = Math.atan2(r10, r00);
  } else {
    roll = Math.atan2(-M[1][2], M[1][1]);
    yaw  = 0;
  }
  return { xyz: [x,y,z], rpy: [roll, pitch, yaw] };
}

function isZeroVec(v) {
  if (!v || v.length===0) return true;
  return v.every(x=>Math.abs(x) < 1e-9);
}



function buildInstanceLinkWorldTransforms(inst) {
  if (!inst) return {};
  if (inst.__linkWorldCache) return inst.__linkWorldCache;

  const world = normalizeTransform(inst.worldTransform || { position: [0,0,0], rotation: [0,0,0] });
  const scale = (inst.worldTransform && inst.worldTransform.scale) || [1,1,1];
  const rootLinkName = inst.rootLinkName || (inst.links && inst.links[0] && inst.links[0].name);
  const rootFull = `${inst.id}__${rootLinkName}`;

  const map = {};
  
  
  const rootPos = [ (world.xyz[0]||0), (world.xyz[1]||0), (world.xyz[2]||0) ];
  map[rootFull] = transformFromXyzRpy(rootPos, world.rpy, [1,1,1]); 

  
  const joints = inst.internalJoints || [];
  const adj = {};
  for (const j of joints) {
    const pFull = j.parentFullName || `${inst.id}__${j.parent}`;
    const cFull = j.childFullName  || `${inst.id}__${j.child}`;
    if (!adj[pFull]) adj[pFull] = [];
    if (!adj[cFull]) adj[cFull] = [];
    adj[pFull].push({ to: cFull, origin: normalizeTransform(j.origin), dir: 'down' });
    adj[cFull].push({ to: pFull, origin: normalizeTransform(j.origin), dir: 'up' });
  }

  
  const q = [rootFull];
  const visited = new Set([rootFull]);
  while (q.length) {
    const cur = q.shift();
    const curMat = map[cur];
    const neigh = adj[cur] || [];
    for (const nb of neigh) {
      const to = nb.to;
      if (visited.has(to)) continue;
      if (nb.dir === 'down') {
        
        const originMat = transformFromXyzRpy(nb.origin.xyz, nb.origin.rpy, scale);
        const worldMat = matMul(curMat, originMat);
        map[to] = worldMat;
        visited.add(to);
        q.push(to);
      } else {
        
        const originMat = transformFromXyzRpy(nb.origin.xyz, nb.origin.rpy, scale);
        const invOrigin = matInv(originMat);
        const worldMat = matMul(curMat, invOrigin);
        map[to] = worldMat;
        visited.add(to);
        q.push(to);
      }
    }
  }

  
  (inst.links || []).forEach(l => {
    const full = l.fullName || `${inst.id}__${l.name}`;
    if (!map[full]) map[full] = map[rootFull];
  });

  inst.__linkWorldCache = map;
  return map;
}



function resolveInstanceLinkForSnap(instance, targetName) {
  if (!instance) return null;
  if (!targetName) {
    const root = instance.rootLinkName || (instance.links && instance.links[0] && instance.links[0].name);
    return `${instance.id}__${root}`;
  }
  
  const byFull = (instance.links||[]).find(l => l.fullName === targetName);
  if (byFull) {
    if (byFull.isAttachOnly) {
      
      for (const j of (instance.internalJoints||[])) {
        const childFull = j.childFullName || `${instance.id}__${j.child}`;
        const parentFull = j.parentFullName || `${instance.id}__${j.parent}`;
        if (childFull === byFull.fullName) {
          const pLink = (instance.links||[]).find(ll => ll.fullName === parentFull);
          if (pLink && (pLink.hasVisual || pLink.hasCollision)) return parentFull;
        }
      }
      
      const root = instance.rootLinkName || (instance.links && instance.links[0] && instance.links[0].name);
      return `${instance.id}__${root}`;
    } else {
      return byFull.fullName;
    }
  }
  
  const byName = (instance.links||[]).find(l => l.name === targetName);
  if (byName) {
    if (byName.isAttachOnly) {
      for (const j of (instance.internalJoints||[])) {
        const childFull = j.childFullName || `${instance.id}__${j.child}`;
        const parentFull = j.parentFullName || `${instance.id}__${j.parent}`;
        if (childFull === byName.fullName) {
          const pLink = (instance.links||[]).find(ll => ll.fullName === parentFull);
          if (pLink && (pLink.hasVisual || pLink.hasCollision)) return parentFull;
        }
      }
      const root = instance.rootLinkName || (instance.links && instance.links[0] && instance.links[0].name);
      return `${instance.id}__${root}`;
    } else {
      return byName.fullName || `${instance.id}__${byName.name}`;
    }
  }
  
  return `${instance.id}__${targetName}`;
}



export async function buildURDF(assemblyData) {
  if (!assemblyData || !assemblyData.instances) throw new Error('Invalid assembly data');

  let ERROR = false; 

  const instances = Object.values(assemblyData.instances || {});

  
  const instanceLinkWorld = {};
  instances.forEach(inst => {
    instanceLinkWorld[inst.id] = buildInstanceLinkWorldTransforms(inst);
  });

  
  function findLinkInInstance(inst, fullName) {
    if (!inst || !inst.links) return null;
    return inst.links.find(l => l.fullName === fullName || l.name === fullName) || null;
  }
  function isAttachOnlyLink(inst, fullName) {
    const l = findLinkInInstance(inst, fullName);
    return !!(l && l.isAttachOnly);
  }

  
  function normAngle(a) {
    let v = a;
    while (v <= -Math.PI) v += 2*Math.PI;
    while (v >  Math.PI) v -= 2*Math.PI;
    return v;
  }
  function normalizeRPY(rpy) {
    return [ normAngle(rpy[0]||0), normAngle(rpy[1]||0), normAngle(rpy[2]||0) ];
  }

  
  function recomputeInstanceMapWithRoot(inst, rootFullName, rootMatrix) {
    const scale = (inst.worldTransform && inst.worldTransform.scale) || [1,1,1];
    const joints = inst.internalJoints || [];
    const adj = {};
    for (const j of joints) {
      const pFull = j.parentFullName || `${inst.id}__${j.parent}`;
      const cFull = j.childFullName  || `${inst.id}__${j.child}`;
      if (!adj[pFull]) adj[pFull] = [];
      if (!adj[cFull]) adj[cFull] = [];
      adj[pFull].push({ to: cFull, origin: normalizeTransform(j.origin), dir: 'down' });
      adj[cFull].push({ to: pFull, origin: normalizeTransform(j.origin), dir: 'up' });
    }
    const map = {};
    map[rootFullName] = rootMatrix;
    const q = [rootFullName];
    const visited = new Set([rootFullName]);
    while (q.length) {
      const cur = q.shift();
      const curMat = map[cur];
      const neigh = adj[cur] || [];
      for (const nb of neigh) {
        const to = nb.to;
        if (visited.has(to)) continue;
        if (nb.dir === 'down') {
          const originMat = transformFromXyzRpy(nb.origin.xyz, nb.origin.rpy, scale);
          map[to] = matMul(curMat, originMat);
        } else {
          const originMat = transformFromXyzRpy(nb.origin.xyz, nb.origin.rpy, scale);
          map[to] = matMul(curMat, matInv(originMat));
        }
        visited.add(to);
        q.push(to);
      }
    }
    (inst.links || []).forEach(l => {
      const full = l.fullName || `${inst.id}__${l.name}`;
      if (!map[full]) map[full] = map[rootFullName];
    });
    return map;
  }

  
  const snapConns = assemblyData.globalJointConnections || [];
  const snapsByParent = {};
  const childInstancesSet = new Set();
  for (const conn of snapConns) {
    if (!conn || !conn.jointData) continue;
    const jd = conn.jointData || {};
    snapsByParent[conn.parentInstance] = snapsByParent[conn.parentInstance] || [];
    snapsByParent[conn.parentInstance].push({ conn, jd });
    childInstancesSet.add(conn.childInstance);
  }

  
  const roots = instances.filter(i => !childInstancesSet.has(i.id));
  const startIds = roots.length ? roots.map(r => r.id) : instances.map(i => i.id);

  const processedSnapKeys = new Set();
  const queue = startIds.slice();
  const visited = new Set(queue);

  while (queue.length) {
    const parentId = queue.shift();
    const parentInst = assemblyData.instances[parentId];
    if (!parentInst) continue;
    const outgoing = snapsByParent[parentId] || [];
    for (const { conn, jd } of outgoing) {
      const key = `${conn.parentInstance}|${conn.childInstance}|${jd.parentLink||jd.parent||''}|${jd.childLink||jd.child||''}|${jd.name||jd.jointName||''}`;
      if (processedSnapKeys.has(key)) continue;
      processedSnapKeys.add(key);

      const parentInstObj = assemblyData.instances[conn.parentInstance];
      const childInstObj  = assemblyData.instances[conn.childInstance];
      if (!parentInstObj || !childInstObj) continue;
      if (conn.parentInstance === conn.childInstance) continue;

      
      let parentLinkFull = resolveInstanceLinkForSnap(parentInstObj, jd.parentLink || jd.parent);
      let childLinkFull  = resolveInstanceLinkForSnap(childInstObj, jd.childLink  || jd.child);
      if (!parentLinkFull || !childLinkFull) continue;

      
      if (isAttachOnlyLink(parentInstObj, parentLinkFull)) {
        
        for (const j of (parentInstObj.internalJoints || [])) {
          const childF = j.childFullName || `${parentInstObj.id}__${j.child}`;
          const parentF = j.parentFullName || `${parentInstObj.id}__${j.parent}`;
          if (childF === parentLinkFull && !isAttachOnlyLink(parentInstObj, parentF)) {
            parentLinkFull = parentF;
            break;
          }
        }
      }
      if (isAttachOnlyLink(childInstObj, childLinkFull)) {
        for (const j of (childInstObj.internalJoints || [])) {
          const childF = j.childFullName || `${childInstObj.id}__${j.child}`;
          const parentF = j.parentFullName || `${childInstObj.id}__${j.parent}`;
          if (childF === childLinkFull && !isAttachOnlyLink(childInstObj, parentF)) {
            
            
            ERROR = true;
          }
        }
        
        childLinkFull = `${childInstObj.id}__${(childInstObj.rootLinkName || (childInstObj.links && childInstObj.links[0] && childInstObj.links[0].name))}`;
      }

      
      const parentRoot = `${parentInstObj.id}__${(parentInstObj.rootLinkName || (parentInstObj.links && parentInstObj.links[0] && parentInstObj.links[0].name))}`;
      const childRoot  = `${childInstObj.id}__${(childInstObj.rootLinkName  || (childInstObj.links && childInstObj.links[0] && childInstObj.links[0].name))}`;
      const parentIsChild = (parentLinkFull !== parentRoot);
      const childIsChild  = (childLinkFull !== childRoot);
      if (parentIsChild && childIsChild) {
        ERROR = true;
        console.warn('Invalid AP-to-child-child; skipping snap:', key);
        continue;
      }

      
      const pMap = instanceLinkWorld[parentInstObj.id] || {};
      const cMap = instanceLinkWorld[childInstObj.id]  || {};
      const pWorld = pMap[parentLinkFull] || (pMap[Object.keys(pMap)[0]]);
      const cWorld = cMap[childLinkFull]  || (cMap[Object.keys(cMap)[0]]);
      if (!pWorld || !cWorld) continue;

      
      let explicitPose = null;
      if (jd.relativeTransform) {
        const rt = jd.relativeTransform;
        const rtx = (Array.isArray(rt.xyz) ? rt.xyz.map(Number) : [0,0,0]);
        const rtr = (Array.isArray(rt.rpy) ? rt.rpy.map(Number) : [0,0,0]);

        const hasQuat = Array.isArray(rt.quaternion) && rt.quaternion.length === 4 && !(
          Math.abs(rt.quaternion[0]) < 1e-12 &&
          Math.abs(rt.quaternion[1]) < 1e-12 &&
          Math.abs(rt.quaternion[2]) < 1e-12 &&
          Math.abs((rt.quaternion[3] || 0) - 1) < 1e-12
        );

        if (!isZeroVec(rtx) || !isZeroVec(rtr) || hasQuat) {
          explicitPose = normalizeTransform(rt);
          if (hasQuat && (!explicitPose.quaternion || explicitPose.quaternion.length !== 4)) {
            explicitPose.quaternion = rt.quaternion.map(Number);
          }
        }
      }

      
      
      
      let originMat;
      let originPoseForURDF;

      
      const rel = matMul(matInv(pWorld), cWorld);
      const relDecomp = matToXyzRpy(rel);
      const relTrans = relDecomp && relDecomp.xyz ? relDecomp.xyz.slice(0,3) : [0,0,0];

      
      let explicitP = null;
      if (jd.relativeTransform) explicitP = normalizeTransform(jd.relativeTransform);

      
      if (explicitP && Array.isArray(explicitP.quaternion) && explicitP.quaternion.length === 4) {
        originMat = composeOriginFromQuatAndTranslation(explicitP.quaternion, relTrans);
        const decomposed = callMatToXyzRpy(originMat);
        originPoseForURDF = {
          xyz: decomposed.xyz ? decomposed.xyz.slice(0,3) : relTrans,
          rpy: normalizeRPY(decomposed.rpy ? decomposed.rpy.slice(0,3) : [0,0,0])
        };
      } else {
        
        originMat = rel;
        const decomposed = matToXyzRpy(originMat);
        originPoseForURDF = { xyz: decomposed.xyz, rpy: normalizeRPY(decomposed.rpy) };
      }


      
      const oldChildMap = instanceLinkWorld[childInstObj.id] || {};
      const oldChildRootWorld = oldChildMap[childRoot] || oldChildMap[Object.keys(oldChildMap)[0]];
      const oldChildLinkWorld = oldChildMap[childLinkFull] || oldChildRootWorld;

      let newChildRootWorld;
      if (oldChildRootWorld && oldChildLinkWorld) {
        const invOldRoot = matInv(oldChildRootWorld);
        const T_root_to_child_old = matMul(invOldRoot, oldChildLinkWorld);
        const inv_T_root_to_child_old = matInv(T_root_to_child_old);
        const tmp = matMul(pWorld, originMat);
        newChildRootWorld = matMul(tmp, inv_T_root_to_child_old);
      } else {
        newChildRootWorld = matMul(pWorld, originMat);
      }

      
      const recomputed = recomputeInstanceMapWithRoot(childInstObj, childRoot, newChildRootWorld);
      instanceLinkWorld[childInstObj.id] = recomputed;

      
      conn.__computedSnap = conn.__computedSnap || [];
      conn.__computedSnap.push({
        parentFull: parentLinkFull,
        childFull: childLinkFull,
        originPose: originPoseForURDF,
        name: jd.fullName || jd.name || jd.jointName || `${parentLinkFull}_to_${childLinkFull}`,
        type: jd.type || 'fixed'
      });

      
      if (!visited.has(childInstObj.id)) {
        queue.push(childInstObj.id);
        visited.add(childInstObj.id);
      }
    }
  } 

  
  const parts = [];
  parts.push('<?xml version="1.0"?>\n');
  parts.push('<robot name="robot_assembly">\n\n');

  
  const linkIncluded = new Set();
  for (const inst of instances) {
    for (const link of (inst.links || [])) {
      if (link.isAttachOnly) continue; 
      if (link.hasVisual || link.hasCollision) linkIncluded.add(link.fullName);
    }
  }

  
  for (const inst of instances) {
    const instScale = (inst.worldTransform && inst.worldTransform.scale) || [1,1,1];
    if (!inst.links) continue;
    for (const link of inst.links) {
      if (!linkIncluded.has(link.fullName)) continue;
      parts.push(`  <link name="${link.fullName}">\n`);
      parts.push('    <inertial>\n');
      parts.push('      <origin xyz="0 0 0" rpy="0 0 0"/>\n');
      parts.push('      <mass value="0.0001"/>\n');
      parts.push('      <inertia ixx="1e-06" iyy="1e-06" izz="1e-06" ixy="0" iyz="0" ixz="0"/>\n');
      parts.push('    </inertial>\n');

      if (link.hasVisual && link.meshes && link.meshes.length>0) {
        const mesh = link.meshes[0];
        const vo = normalizeTransform(link.visualOrigin);
        const voScaled = [ (vo.xyz[0]||0)*instScale[0], (vo.xyz[1]||0)*instScale[1], (vo.xyz[2]||0)*instScale[2] ];
        const scale = mesh.finalScale || mesh.scale || [1,1,1];
        const fname = mesh.filename || mesh.name || mesh.file || mesh.fileName || '';
        parts.push(`    <visual>\n`);
        parts.push(`      <origin xyz="${voScaled.map(formatNumber).join(' ')}" rpy="${vo.rpy.map(formatNumber).join(' ')}"/>\n`);
        parts.push('      <geometry>\n');
        if (fname) parts.push(`        <mesh filename="meshes/${fname}" scale="${scale.map(formatNumber).join(' ')}"/>\n`);
        else parts.push('        <box size="0.01 0.01 0.01"/>\n');
        parts.push('      </geometry>\n');
        parts.push('    </visual>\n');
      }

      if (link.hasCollision && link.meshes && link.meshes.length>0) {
        const mesh = link.meshes[0];
        const vo = normalizeTransform(link.visualOrigin);
        const voScaled = [ (vo.xyz[0]||0)*instScale[0], (vo.xyz[1]||0)*instScale[1], (vo.xyz[2]||0)*instScale[2] ];
        const scale = mesh.finalScale || mesh.scale || [1,1,1];
        const fname = mesh.filename || mesh.name || mesh.file || mesh.fileName || '';
        parts.push('    <collision>\n');
        parts.push(`      <origin xyz="${voScaled.map(formatNumber).join(' ')}" rpy="${vo.rpy.map(formatNumber).join(' ')}"/>\n`);
        parts.push('      <geometry>\n');
        if (fname) parts.push(`        <mesh filename="meshes/${fname}" scale="${scale.map(formatNumber).join(' ')}"/>\n`);
        else parts.push('        <box size="0.01 0.01 0.01"/>\n');
        parts.push('      </geometry>\n');
        parts.push('    </collision>\n');
      }

      parts.push('  </link>\n\n');
    }
  }

  
  parts.push('  <!-- Snap joints -->\n');
  for (const conn of snapConns) {
    if (!conn || !conn.__computedSnap) continue;
    for (const s of conn.__computedSnap) {
      
      const pInst = assemblyData.instances[conn.parentInstance];
      const cInst = assemblyData.instances[conn.childInstance];
      if (!pInst || !cInst) continue;
      if (isAttachOnlyLink(pInst, s.parentFull) || isAttachOnlyLink(cInst, s.childFull)) {
        
        continue;
      }
      const originPose = s.originPose;
      parts.push(`  <joint name="${s.name}" type="${s.type || 'fixed'}">\n`);
      parts.push(`    <origin xyz="${originPose.xyz.map(formatNumber).join(' ')}" rpy="${originPose.rpy.map(formatNumber).join(' ')}"/>\n`);
      parts.push(`    <parent link="${s.parentFull}"/>\n`);
      parts.push(`    <child link="${s.childFull}"/>\n`);
      parts.push('  </joint>\n\n');
    }
  }

  
  parts.push('  <!-- Internal joints -->\n');

  function transpose3(R) {
    return [
      [R[0][0], R[1][0], R[2][0]],
      [R[0][1], R[1][1], R[2][1]],
      [R[0][2], R[1][2], R[2][2]]
    ];
  }
  function transformVec3(R, v) {
    return [
      R[0][0]*v[0] + R[0][1]*v[1] + R[0][2]*v[2],
      R[1][0]*v[0] + R[1][1]*v[1] + R[1][2]*v[2],
      R[2][0]*v[0] + R[2][1]*v[1] + R[2][2]*v[2]
    ];
  }
  function normalizeVec(v) {
    const n = Math.hypot(v[0]||0, v[1]||0, v[2]||0);
    if (n < 1e-12) return [0,0,0];
    return [v[0]/n, v[1]/n, v[2]/n];
  }

  for (const inst of instances) {
    const map = instanceLinkWorld[inst.id] || {};
    for (const j of (inst.internalJoints || [])) {
      const pFull = j.parentFullName || `${inst.id}__${j.parent}`;
      const cFull = j.childFullName  || `${inst.id}__${j.child}`;
      
      if (isAttachOnlyLink(inst, pFull) || isAttachOnlyLink(inst, cFull)) continue;
      const pLink = (inst.links||[]).find(l => l.fullName === pFull);
      const cLink = (inst.links||[]).find(l => l.fullName === cFull);
      if (!pLink || !cLink) continue;
      if (! (pLink.hasVisual || pLink.hasCollision)) continue;
      if (! (cLink.hasVisual || cLink.hasCollision)) continue;

      const Mparent = map[pFull];
      const Mchild  = map[cFull];
      if (!Mparent || !Mchild) continue;
      const originMat = matMul(matInv(Mparent), Mchild);
      const decomposed = matToXyzRpy(originMat);

      const jtype = j.type || 'fixed';
      parts.push(`  <joint name="${j.fullName || j.name || `${pFull}_to_${cFull}`}" type="${jtype}">\n`);
      parts.push(`    <origin xyz="${decomposed.xyz.map(formatNumber).join(' ')}" rpy="${normalizeRPY(decomposed.rpy).map(formatNumber).join(' ')}"/>\n`);
      parts.push(`    <parent link="${pFull}"/>\n`);
      parts.push(`    <child link="${cFull}"/>\n`);

      if (jtype === 'revolute' || jtype === 'prismatic' || jtype === 'continuous') {
        
        
        
        const R_origin = [
          [originMat[0][0], originMat[0][1], originMat[0][2]],
          [originMat[1][0], originMat[1][1], originMat[1][2]],
          [originMat[2][0], originMat[2][1], originMat[2][2]]
        ];
        const axis_parent = j.axis || [1,0,0];
        
        const axis_joint = normalizeVec(transformVec3(R_origin, axis_parent));
        parts.push(`    <axis xyz="${axis_joint.map(formatNumber).join(' ')}"/>\n`);
        if (j.limit) {
          parts.push(`    <limit upper="${formatNumber(j.limit.upper||0)}" lower="${formatNumber(j.limit.lower||0)}" effort="100" velocity="100"/>\n`);
        }
      }

      parts.push('  </joint>\n\n');
    }
  }

  if (ERROR) {
    parts.push('  <!-- ERROR: one or more invalid AP-to-child-child attachments were detected and skipped. -->\n');
  }

  parts.push('</robot>\n');
  return parts.join('');
}


export async function getMeshFiles(assemblyData) {
  if (!assemblyData || !assemblyData.instances) return [];
  const meshSet = new Set();
  for (const instKey of Object.keys(assemblyData.instances)) {
    const inst = assemblyData.instances[instKey];
    if (!inst.links || !Array.isArray(inst.links)) continue;
    for (const link of inst.links) {
      if (link.isAttachOnly) continue;
      if (!Array.isArray(link.meshes) || link.meshes.length === 0) continue;
      for (const mesh of link.meshes) {
        const filename = mesh.filename || mesh.name || mesh.file || mesh.fileName || null;
        if (filename) meshSet.add(filename);
      }
    }
  }
  return Array.from(meshSet);
}
