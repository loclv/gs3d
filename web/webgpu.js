// WebGPU renderer for the built-in Goose demo. The production WebGL2 backend
// remains the automatic startup fallback and serves the feature-rich tools.
const shader = /* wgsl */ `
struct Frame {
  params: vec4<f32>, ambient: vec4<f32>,
  light_dir: vec4<f32>, light_color: vec4<f32>, fog: vec4<f32>, eye: vec4<f32>,
  surface: vec4<f32>,
};
struct Instance {
  // 208 bytes, matching the packed per-node transform and colour uploaded
  // below. The draw's firstInstance selects its contiguous run in this array.
  mvp: mat4x4<f32>, model: mat4x4<f32>, normal: mat4x4<f32>, color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Frame;
@group(1) @binding(0) var<storage, read> g3_instances: array<Instance>;
struct In { @location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec4<f32>, @builtin(instance_index) instance_index: u32 };
struct Out { @builtin(position) clip: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec4<f32> };
@vertex fn vs(v: In) -> Out {
  var o: Out;
  let instance = g3_instances[v.instance_index];
  let world = instance.model * vec4<f32>(v.pos, 1.0);
  o.clip = instance.mvp * vec4<f32>(v.pos, 1.0);
  o.clip.z = (o.clip.z + o.clip.w) * 0.5;
  o.world = world.xyz;
  o.normal = normalize((instance.normal * vec4<f32>(v.normal, 0.0)).xyz);
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
let uniformData, instanceBuffer, instanceBindGroup, instanceCapacity = 0, instanceData;
let width = 1, height = 1, meshes = new Map(), pipelines = {};
let dv, wasmBuffer, wasmModule, drawCalls = 0, frameConstants = new Float32Array(20);

async function createPipelines(gpuDevice, outputFormat) {
  const module = gpuDevice.createShaderModule({ code: shader });
  const frameLayout = gpuDevice.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 112 } }] });
  const instanceLayout = gpuDevice.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage', minBindingSize: 208 } }] });
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
  const stride = Math.ceil(112 / alignment) * alignment;
  const needed = Math.max(stride, stride * count);
  if (needed <= uniformCapacity) return stride;
  if (uniformBuffer) uniformBuffer.destroy();
  uniformCapacity = Math.max(needed, uniformCapacity * 2, 65536);
  uniformData = new Float32Array(uniformCapacity / 4);
  uniformBuffer = device.createBuffer({ size: uniformCapacity, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  uniformBindGroup = device.createBindGroup({ layout: pipelines.frameLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer, offset: 0, size: 112 } }] });
  return stride;
}

function allocInstances(count) {
  if (count <= instanceCapacity) return;
  if (instanceBuffer) instanceBuffer.destroy();
  instanceCapacity = Math.max(count, instanceCapacity * 2, 64);
  instanceData = new Float32Array(instanceCapacity * 52);
  instanceBuffer = device.createBuffer({ size: instanceCapacity * 208, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  instanceBindGroup = device.createBindGroup({ layout: pipelines.instanceLayout, entries: [{ binding: 0, resource: { buffer: instanceBuffer, offset: 0, size: instanceCapacity * 208 } }] });
}

function readMatInto(ptr, byteOffset, out, target) {
  const at = ptr + byteOffset;
  for (let i=0;i<16;i++) out[target+i]=dv.getFloat32(at+i*4,true);
}
function normalMatrixInto(source, out, target) {
  const a=out[source], b=out[source+4], c=out[source+8], d=out[source+1], e=out[source+5], f=out[source+9], g=out[source+2], h=out[source+6], i=out[source+10];
  for(let n=0;n<16;n++) out[target+n]=0;
  const A=e*i-f*h, B=f*g-d*i, C=d*h-e*g, det=a*A+b*B+c*C;
  if (Math.abs(det) < 1e-12) return;
  const k = 1/det;
  out[target]=A*k; out[target+1]=(c*h-b*i)*k; out[target+2]=(b*f-c*e)*k;
  out[target+4]=B*k; out[target+5]=(a*i-c*g)*k; out[target+6]=(c*d-b*g)*k;
  out[target+8]=C*k; out[target+9]=(b*g-a*h)*k; out[target+10]=(a*e-b*d)*k; out[target+15]=1;
}
function copyVec(ptr, off, out, target) { for (let i=0;i<4;i++) out[target+i]=dv.getFloat32(ptr+off+i*4,true); }
function setFrameConstants(viewPtr) {
  copyVec(viewPtr,36,frameConstants,0); copyVec(viewPtr,12,frameConstants,4);
  copyVec(viewPtr,24,frameConstants,8); copyVec(viewPtr,52,frameConstants,12);
  for(let i=0;i<3;i++) frameConstants[16+i]=dv.getFloat32(viewPtr+i*4,true);
  frameConstants[19]=0;
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
    const result = await Promise.race([
      (async () => {
        const a = await navigator.gpu.requestAdapter(); if (!a) return false;
        const d = await a.requestDevice(), fmt = navigator.gpu.getPreferredCanvasFormat();
        const built = await createPipelines(d, fmt);
        return { adapter: a, device: d, format: fmt, pipelines: built };
      })(),
      new Promise(resolve => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!result) return false;
    adapter = result.adapter; device = result.device; format = result.format; pipelines = result.pipelines; return true;
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
    drawCalls = 0;
    if (wasmBuffer !== wasmModule.HEAPU8.buffer) { wasmBuffer=wasmModule.HEAPU8.buffer; dv=new DataView(wasmBuffer); }
    const stride=allocUniforms(count);
    allocInstances(count);
    setFrameConstants(viewPtr);
    for(let i=0;i<count;i++) {
      const p=itemsPtr+i*653, base=i*stride/4;
      const instanceBase=i*52;
      readMatInto(p,4,instanceData,instanceBase);
      readMatInto(p,68,instanceData,instanceBase+16);
      normalMatrixInto(instanceBase+16,instanceData,instanceBase+32);
      copyVec(p,132,instanceData,instanceBase+48);
      copyVec(p,148,uniformData,base);
      uniformData.set(frameConstants,base+4);
      uniformData[base+24]=dv.getUint8(p+236)?1:0;
      uniformData[base+25]=dv.getInt32(p+172,true);
      uniformData[base+26]=dv.getFloat32(p+176,true);
    }
    if(count) {
      device.queue.writeBuffer(uniformBuffer,0,uniformData.buffer,0,count*stride);
      device.queue.writeBuffer(instanceBuffer,0,instanceData.buffer,0,count*208);
    }
    const clear={r:dv.getFloat32(viewPtr+68,true),g:dv.getFloat32(viewPtr+72,true),b:dv.getFloat32(viewPtr+76,true),a:1};
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:clear,loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    pass.setBindGroup(1,instanceBindGroup);
    let boundPipeline=null, boundMesh=null;
    for(let i=0;i<count;) {
      const p=itemsPtr+i*653, id=dv.getInt32(p,true), mesh=meshes.get(id);
      let batchCount=1;
      if(!mesh||mesh.count===0) { i++; continue; }
      const alphaMode=dv.getInt32(p+172,true), alpha=dv.getFloat32(p+144,true);
      const blended=dv.getFloat32(p+160,true)>0.5 || alphaMode===2 || (alphaMode===0 && alpha<0.999);
      const doubleSided=dv.getUint8(p+236)!==0;
      if(!blended) while(i+batchCount<count && batchCompatible(p,itemsPtr+(i+batchCount)*653)) batchCount++;
      const pipelineKey=`${blended?'blend':'opaque'}${doubleSided?'Double':''}`;
      const pipeline=pipelines[pipelineKey];
      if(pipeline!==boundPipeline) { pass.setPipeline(pipeline); boundPipeline=pipeline; }
      pass.setBindGroup(0,uniformBindGroup,[i*stride]);
      if(mesh!==boundMesh) { pass.setVertexBuffer(0,mesh.vb); pass.setIndexBuffer(mesh.ib,'uint32'); boundMesh=mesh; }
      pass.drawIndexed(mesh.count,batchCount,0,0,i);
      drawCalls++;
      i+=batchCount;
    }
    pass.end(); device.queue.submit([encoder.finish()]);
  },
  shutdown() { for(const mesh of meshes.values()){mesh.vb.destroy();mesh.ib.destroy();} meshes.clear(); if(depth)depth.destroy();if(uniformBuffer)uniformBuffer.destroy();if(instanceBuffer)instanceBuffer.destroy(); depth=uniformBuffer=instanceBuffer=null;uniformCapacity=instanceCapacity=0;uniformBindGroup=instanceBindGroup=null;uniformData=instanceData=null;wasmBuffer=dv=null; }
};
