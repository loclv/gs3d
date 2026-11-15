// WebGPU renderer for the built-in Goose demo. The production WebGL2 backend
// remains the automatic startup fallback and serves the feature-rich tools.
const FRAME_UNIFORM_BYTES = 176;
const INSTANCE_BYTES = 80;
const INSTANCE_FLOATS = INSTANCE_BYTES / 4;
const VIEW_PROJ_BYTE_OFFSET = 1196; // g3_view_state.view_proj in g3_abi.h
const shader = /* wgsl */ `
struct Frame {
  params: vec4<f32>, ambient: vec4<f32>,
  light_dir: vec4<f32>, light_color: vec4<f32>, fog: vec4<f32>, eye: vec4<f32>,
  surface: vec4<f32>,
  view_proj: mat4x4<f32>,
};
struct Instance {
  // 80 bytes; clip position combines the shared camera matrix with the model.
  model: mat4x4<f32>, color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Frame;
@group(1) @binding(0) var<storage, read> g3_instances: array<Instance>;
struct In { @location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec4<f32>, @builtin(instance_index) instance_index: u32 };
struct Out { @builtin(position) clip: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec4<f32> };
@vertex fn vs(v: In) -> Out {
  var o: Out;
  let instance = g3_instances[v.instance_index];
  o.clip = u.view_proj * (instance.model * vec4<f32>(v.pos, 1.0));
  o.clip.z = (o.clip.z + o.clip.w) * 0.5;
  let world = instance.model * vec4<f32>(v.pos, 1.0);
  o.world = world.xyz;
  let c0 = instance.model[0].xyz;
  let c1 = instance.model[1].xyz;
  let c2 = instance.model[2].xyz;
  let n0 = cross(c1, c2);
  let n1 = cross(c2, c0);
  let n2 = cross(c0, c1);
  let determinant = dot(c0, n0);
  var transformedNormal = vec3<f32>(0.0);
  if (abs(determinant) > 1e-12) {
    transformedNormal = (n0 * v.normal.x + n1 * v.normal.y + n2 * v.normal.z) / determinant;
  }
  o.normal = normalize(transformedNormal);
  o.color = v.color * instance.color;
  return o;
}
@fragment fn fs(v: Out, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  if (u.surface.y > 0.5 && u.surface.y < 1.5 && v.color.a < u.surface.z) { discard; }
  var col = v.color.rgb;
  if (u.params.x <= 0.5) {
    var n = normalize(v.normal);
    if (u.surface.x > 0.5 && !front) { n = -n; }
    let l = normalize(-u.light_dir.xyz);
    let view = normalize(u.eye.xyz - v.world);
    let h = normalize(l + view);
    let diff = max(dot(n, l), 0.0);
    let spec = pow(max(dot(n, h), 0.0), max(u.params.z, 1.0)) * u.params.y;
    col = v.color.rgb * (u.ambient.rgb * u.ambient.a + u.light_color.rgb * diff) + u.light_color.rgb * spec;
  }
  if (u.fog.a > 0.0) {
    let dist = distance(v.world, u.eye.xyz);
    let f = clamp(1.0 - exp(-dist * u.fog.a), 0.0, 1.0);
    col = mix(col, u.fog.rgb, f);
  }
  var outAlpha = 1.0;
  if (u.surface.y > 1.5) { outAlpha = v.color.a; }
  return vec4<f32>(col, outAlpha);
}`;

let adapter, device, context, format, depth;
let canvas, uniformBuffer, uniformBindGroup, uniformCapacity = 0;
let uniformData, uniformCache, uniformBufferValid = false;
let instanceBuffer, instanceBindGroup, instanceCapacity = 0, instanceData;
let instanceBufferValid = false, instanceDataValid = false, packedInstanceCount = 0, uploadedInstanceCount = 0;
let timestampQuerySet, timestampResolveBuffer, timestampSlots = [], timestampSlotIndex = 0;
let timestampCapture = true, timestampEpoch = 0;
const gpuTimestampSamples = [];
const drawBatchStarts = [], drawBatchLengths = [];
// Bound queue overhead when many isolated records change. Small gaps are
// cheaper to upload than to issue an additional writeBuffer call.
const changedStarts = [], changedEnds = [];
const MAX_INSTANCE_WRITES = 8, MERGE_INSTANCE_GAP = 4;
let width = 1, height = 1, meshes = new Map(), pipelines = {};
let dv, wasmBuffer, wasmModule, drawCalls = 0, drawCpuMs = 0, frameConstants = new Float32Array(20), frameViewProj = new Float32Array(16);

async function createPipelines(gpuDevice, outputFormat) {
  const module = gpuDevice.createShaderModule({ code: shader });
  const frameLayout = gpuDevice.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FRAME_UNIFORM_BYTES } }] });
  const instanceLayout = gpuDevice.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage', minBindingSize: INSTANCE_BYTES } }] });
  const layout = gpuDevice.createPipelineLayout({ bindGroupLayouts: [frameLayout, instanceLayout] });
  const vertex = { module, entryPoint: 'vs', buffers: [{ arrayStride: 120, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 104, format: 'float32x4' },
  ] }] };
  const target = { format: outputFormat, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }, writeMask: GPUColorWrite.ALL };
  const created = { frameLayout, instanceLayout };
  for (const transparent of [false, true]) {
    for (const doubleSided of [false, true]) {
      const key = `${transparent ? 'blend' : 'opaque'}${doubleSided ? 'Double' : ''}`;
      created[key] = await gpuDevice.createRenderPipelineAsync({
        layout, vertex, fragment: { module, entryPoint: 'fs', targets: [target] },
        primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: doubleSided ? 'none' : 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: !transparent, depthCompare: 'less' },
      });
    }
  }
  return created;
}

function allocUniforms(count) {
  const alignment = device.limits.minUniformBufferOffsetAlignment || 256;
  const stride = Math.ceil(FRAME_UNIFORM_BYTES / alignment) * alignment;
  const needed = Math.max(stride, stride * count);
  if (needed <= uniformCapacity) return stride;
  if (uniformBuffer) uniformBuffer.destroy();
  uniformCapacity = Math.max(needed, uniformCapacity * 2, 65536);
  uniformData = new Float32Array(uniformCapacity / 4);
  uniformCache = new Float32Array(uniformCapacity / 4);
  uniformBufferValid = false;
  uniformBuffer = device.createBuffer({ size: uniformCapacity, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  uniformBindGroup = device.createBindGroup({ layout: pipelines.frameLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer, offset: 0, size: FRAME_UNIFORM_BYTES } }] });
  return stride;
}

function allocInstances(count) {
  if (count <= instanceCapacity) return;
  if (instanceBuffer) instanceBuffer.destroy();
  instanceCapacity = Math.max(count, instanceCapacity * 2, 64);
  instanceData = new Float32Array(instanceCapacity * INSTANCE_FLOATS);
  instanceBufferValid = false;
  instanceDataValid = false;
  packedInstanceCount = 0;
  uploadedInstanceCount = 0;
  instanceBuffer = device.createBuffer({ size: instanceCapacity * INSTANCE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  instanceBindGroup = device.createBindGroup({ layout: pipelines.instanceLayout, entries: [{ binding: 0, resource: { buffer: instanceBuffer, offset: 0, size: instanceCapacity * INSTANCE_BYTES } }] });
}

function packInstance(p, base, force) {
  let changed=force;
  for(let i=0;i<16;i++) {
    const model=dv.getFloat32(p+68+i*4,true);
    if(instanceData[base+i]!==model) { instanceData[base+i]=model; changed=true; }
  }
  for(let i=0;i<4;i++) {
    const color=dv.getFloat32(p+132+i*4,true);
    if(instanceData[base+16+i]!==color) { instanceData[base+16+i]=color; changed=true; }
  }
  return changed;
}
function copyVec(ptr, off, out, target) { for (let i=0;i<4;i++) out[target+i]=dv.getFloat32(ptr+off+i*4,true); }
function setFrameConstants(viewPtr) {
  copyVec(viewPtr,36,frameConstants,0); copyVec(viewPtr,12,frameConstants,4);
  copyVec(viewPtr,24,frameConstants,8); copyVec(viewPtr,52,frameConstants,12);
  for(let i=0;i<3;i++) frameConstants[16+i]=dv.getFloat32(viewPtr+i*4,true);
  frameConstants[19]=0;
  for(let i=0;i<16;i++) frameViewProj[i]=dv.getFloat32(viewPtr+VIEW_PROJ_BYTE_OFFSET+i*4,true);
}
function batchCompatible(a, b) {
  if (dv.getInt32(a, true) !== dv.getInt32(b, true) || dv.getFloat32(a+160,true) > 0.5 || dv.getFloat32(b+160,true) > 0.5) return false;
  const modeA=dv.getInt32(a+172,true), modeB=dv.getInt32(b+172,true);
  if (modeA===2 || modeB===2 || (modeA===0&&dv.getFloat32(a+144,true)<0.999) || (modeB===0&&dv.getFloat32(b+144,true)<0.999)) return false;
  if (dv.getUint8(a+236) !== dv.getUint8(b+236) || modeA !== modeB || dv.getFloat32(a+176,true) !== dv.getFloat32(b+176,true)) return false;
  for (let offset=148; offset<160; offset+=4)
    if (dv.getFloat32(a+offset,true) !== dv.getFloat32(b+offset,true)) return false;
  return true;
}

export async function prepareWebGPU(targetCanvas) {
  canvas = targetCanvas;
  if (!navigator.gpu) return false;
  try {
    const requestGpuTiming = new URLSearchParams(location.search).get('gpu-timing') === '1';
    const result = await Promise.race([
      (async () => {
        const a = await navigator.gpu.requestAdapter(); if (!a) return false;
        const requiredFeatures = requestGpuTiming && a.features.has('timestamp-query') ? ['timestamp-query'] : [];
        const d = await a.requestDevice({ requiredFeatures }), fmt = navigator.gpu.getPreferredCanvasFormat();
        const built = await createPipelines(d, fmt);
        return { adapter: a, device: d, format: fmt, pipelines: built, requestGpuTiming };
      })(),
      new Promise(resolve => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!result) return false;
    adapter = result.adapter; device = result.device; format = result.format; pipelines = result.pipelines;
    if (result.requestGpuTiming && device.features.has('timestamp-query')) {
      timestampQuerySet = device.createQuerySet({ type: 'timestamp', count: 2 });
      timestampResolveBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      timestampSlots = Array.from({ length: 4 }, () => ({ busy: false, buffer: device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) }));
    }
    return true;
  }
  catch (error) { console.warn('WebGPU unavailable; using WebGL2:', error); adapter = device = null; return false; }
}

window.g3wgpu = {
  setModule(module) { wasmModule = module; },
  init(w, h) {
    if (!device) return false;
    try {
      canvas = document.getElementById('canvas');
      context = canvas.getContext('webgpu');
      if (!context) return false;
      context.configure({ device, format, alphaMode: 'opaque' });
      this.resize(w, h);
      device.lost.then(info => { console.error('WebGPU device lost:', info.message); });
      return true;
    } catch (error) { console.warn('WebGPU renderer setup failed; using WebGL2:', error); return false; }
  },
  resetCanvas() {
    if (context) { try { context.unconfigure(); } catch {} }
    const old = document.getElementById('canvas');
    const replacement = old.cloneNode(false);
    replacement.width = old.width; replacement.height = old.height;
    old.replaceWith(replacement); canvas = replacement; context = null;
  },
  resize(w, h) {
    width = Math.max(1, w|0); height = Math.max(1, h|0);
    if (!context) return;
    canvas.width = width; canvas.height = height;
    context.configure({ device, format, alphaMode: 'opaque' });
    if (depth) depth.destroy();
    depth = device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  },
  width: () => width,
  height: () => height,
  drawCalls: () => drawCalls,
  drawCpuMs: () => drawCpuMs,
  gpuTimestampMs: () => gpuTimestampSamples.slice(-300),
  gpuTimestampAvailable: () => !!timestampQuerySet,
  gpuTimestampBegin() { timestampEpoch++; gpuTimestampSamples.length=0; timestampCapture=true; },
  gpuTimestampEnd() { timestampCapture=false; },
  gpuTimestampPending: () => timestampSlots.filter(slot => slot.busy && slot.epoch===timestampEpoch).length,
  uploadMesh(id, vp, vn, ip, inum) {
    const heap = wasmModule.HEAPU8;
    const vertices = new Uint8Array(heap.buffer, vp, vn * 120).slice();
    const indices = new Uint8Array(heap.buffer, ip, inum * 4).slice();
    const vb = device.createBuffer({ size: Math.max(4, (vertices.byteLength + 3) & ~3), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const ib = device.createBuffer({ size: Math.max(4, indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    if (vertices.length) device.queue.writeBuffer(vb, 0, vertices);
    if (indices.length) device.queue.writeBuffer(ib, 0, indices);
    this.releaseMesh(id); meshes.set(id, { vb, ib, count: inum });
  },
  releaseMesh(id) { const mesh=meshes.get(id); if (mesh) { mesh.vb.destroy(); mesh.ib.destroy(); meshes.delete(id); } },
  draw(itemsPtr, count, viewPtr) {
    if (!device || !context || !depth) return;
    const started=performance.now();
    drawCalls = 0;
    if (wasmBuffer !== wasmModule.HEAPU8.buffer) { wasmBuffer=wasmModule.HEAPU8.buffer; dv=new DataView(wasmBuffer); }
    const stride=allocUniforms(count);
    allocInstances(count);
    setFrameConstants(viewPtr);
    drawBatchStarts.length=0; drawBatchLengths.length=0;
    changedStarts.length=0; changedEnds.length=0;
    let tooManyRanges=false;
    const markChanged = i => {
      const last=changedStarts.length-1;
      if(last>=0 && (tooManyRanges || i-changedEnds[last]<=MERGE_INSTANCE_GAP+1)) changedEnds[last]=i;
      else if(changedStarts.length<MAX_INSTANCE_WRITES) { changedStarts.push(i); changedEnds.push(i); }
      else { tooManyRanges=true; changedEnds[last]=i; }
    };
    for(let i=0;i<count;i++) {
      const p=itemsPtr+i*653;
      const mesh=meshes.get(dv.getInt32(p,true));
      if(!mesh||mesh.count===0) continue;
      if(packInstance(p,i*INSTANCE_FLOATS,!instanceDataValid||i>=packedInstanceCount)) markChanged(i);
      let batchCount=1;
      const alphaMode=dv.getInt32(p+172,true), alpha=dv.getFloat32(p+144,true);
      const blended=dv.getFloat32(p+160,true)>0.5 || alphaMode===2 || (alphaMode===0 && alpha<0.999);
      if(!blended) while(i+batchCount<count && batchCompatible(p,itemsPtr+(i+batchCount)*653)) batchCount++;
      for(let j=1;j<batchCount;j++) {
        const item=i+j;
        if(packInstance(itemsPtr+item*653,item*INSTANCE_FLOATS,!instanceDataValid||item>=packedInstanceCount)) markChanged(item);
      }
      const uniformBase=drawBatchStarts.length*stride/4;
      copyVec(p,148,uniformData,uniformBase);
      uniformData.set(frameConstants,uniformBase+4);
      uniformData[uniformBase+24]=dv.getUint8(p+236)?1:0;
      uniformData[uniformBase+25]=alphaMode;
      uniformData[uniformBase+26]=dv.getFloat32(p+176,true);
      uniformData.set(frameViewProj,uniformBase+28);
      drawBatchStarts.push(i); drawBatchLengths.push(batchCount);
      i+=batchCount-1;
    }
    if(count>packedInstanceCount) packedInstanceCount=count;
    instanceDataValid=true;
    if(count) {
      const uniformLength=drawBatchStarts.length*stride/4;
      let uniformsChanged=!uniformBufferValid;
      for(let j=0;!uniformsChanged&&j<uniformLength;j++) uniformsChanged=uniformData[j]!==uniformCache[j];
      if(uniformsChanged&&uniformLength) {
        device.queue.writeBuffer(uniformBuffer,0,uniformData.buffer,0,drawBatchStarts.length*stride);
        uniformCache.set(uniformData.subarray(0,uniformLength),0);
        uniformBufferValid=true;
      }
      // Slots beyond the uploaded high-water mark have no GPU contents yet,
      // even if the corresponding draw item currently references no mesh.
      if(!instanceBufferValid) { changedStarts.length=0; changedEnds.length=0; changedStarts.push(0); changedEnds.push(count-1); }
      else if(count>uploadedInstanceCount) {
        // The tail may include missing meshes, whose slots still need initialization.
        const first=changedStarts.length ? Math.min(changedStarts[0],uploadedInstanceCount) : uploadedInstanceCount;
        changedStarts.length=0; changedEnds.length=0; changedStarts.push(first); changedEnds.push(count-1);
      }
      for(let range=0;range<changedStarts.length;range++) {
        const offset=changedStarts[range]*INSTANCE_BYTES;
        device.queue.writeBuffer(instanceBuffer,offset,instanceData.buffer,offset,(changedEnds[range]-changedStarts[range]+1)*INSTANCE_BYTES);
        instanceBufferValid=true;
        uploadedInstanceCount=Math.max(uploadedInstanceCount,count);
      }
    }
    const clear={r:dv.getFloat32(viewPtr+68,true),g:dv.getFloat32(viewPtr+72,true),b:dv.getFloat32(viewPtr+76,true),a:1};
    const encoder=device.createCommandEncoder();
    let timestampSlot=null;
    if(timestampQuerySet && timestampCapture) {
      for(let i=0;i<timestampSlots.length;i++) {
        const slot=timestampSlots[timestampSlotIndex];
        timestampSlotIndex=(timestampSlotIndex+1)%timestampSlots.length;
        if(!slot.busy) { timestampSlot=slot; slot.busy=true; slot.epoch=timestampEpoch; break; }
      }
    }
    const passDescriptor={colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:clear,loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}};
    if(timestampSlot) passDescriptor.timestampWrites={querySet:timestampQuerySet,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1};
    const pass=encoder.beginRenderPass(passDescriptor);
    pass.setBindGroup(1,instanceBindGroup);
    let boundPipeline=null, boundMesh=null;
    for(let batch=0;batch<drawBatchStarts.length;batch++) {
      const i=drawBatchStarts[batch], batchCount=drawBatchLengths[batch];
      const p=itemsPtr+i*653, id=dv.getInt32(p,true), mesh=meshes.get(id);
      if(!mesh||mesh.count===0) continue;
      const doubleSided=dv.getUint8(p+236)!==0;
      const alphaMode=dv.getInt32(p+172,true), alpha=dv.getFloat32(p+144,true);
      const blended=dv.getFloat32(p+160,true)>0.5 || alphaMode===2 || (alphaMode===0 && alpha<0.999);
      const pipelineKey=`${blended?'blend':'opaque'}${doubleSided?'Double':''}`;
      const pipeline=pipelines[pipelineKey];
      if(pipeline!==boundPipeline) { pass.setPipeline(pipeline); boundPipeline=pipeline; }
      pass.setBindGroup(0,uniformBindGroup,[batch*stride]);
      if(mesh!==boundMesh) { pass.setVertexBuffer(0,mesh.vb); pass.setIndexBuffer(mesh.ib,'uint32'); boundMesh=mesh; }
      pass.drawIndexed(mesh.count,batchCount,0,0,i);
      drawCalls++;
    }
    pass.end();
    if(timestampSlot) {
      encoder.resolveQuerySet(timestampQuerySet,0,2,timestampResolveBuffer,0);
      encoder.copyBufferToBuffer(timestampResolveBuffer,0,timestampSlot.buffer,0,16);
    }
    device.queue.submit([encoder.finish()]);
    if(timestampSlot) timestampSlot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      const values=new BigUint64Array(timestampSlot.buffer.getMappedRange());
      if(timestampSlot.epoch===timestampEpoch) gpuTimestampSamples.push(Number(values[1]-values[0])/1e6);
      if(gpuTimestampSamples.length>2048) gpuTimestampSamples.shift();
      timestampSlot.buffer.unmap(); timestampSlot.busy=false;
    }).catch(() => { timestampSlot.busy=false; });
    drawCpuMs=performance.now()-started;
  },
  shutdown() { for(const mesh of meshes.values()){mesh.vb.destroy();mesh.ib.destroy();} meshes.clear(); if(depth)depth.destroy();if(uniformBuffer)uniformBuffer.destroy();if(instanceBuffer)instanceBuffer.destroy();if(timestampQuerySet)timestampQuerySet.destroy();if(timestampResolveBuffer)timestampResolveBuffer.destroy();for(const slot of timestampSlots)slot.buffer.destroy();timestampQuerySet=timestampResolveBuffer=null;timestampSlots=[];gpuTimestampSamples.length=0;timestampEpoch++;timestampCapture=true; depth=uniformBuffer=instanceBuffer=null;uniformCapacity=instanceCapacity=0;uniformBindGroup=instanceBindGroup=null;uniformData=uniformCache=instanceData=null;uniformBufferValid=instanceBufferValid=instanceDataValid=false;packedInstanceCount=uploadedInstanceCount=0;wasmBuffer=dv=null; }
};
