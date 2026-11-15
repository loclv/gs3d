// WebGPU renderer for the built-in Goose demo. The production WebGL2 backend
// remains the automatic startup fallback and serves the feature-rich tools.
const shader = /* wgsl */ `
struct Frame {
  mvp: mat4x4<f32>, model: mat4x4<f32>, normal: mat4x4<f32>,
  color: vec4<f32>, params: vec4<f32>, ambient: vec4<f32>,
  light_dir: vec4<f32>, light_color: vec4<f32>, fog: vec4<f32>, eye: vec4<f32>,
  surface: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Frame;
struct In { @location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec4<f32> };
struct Out { @builtin(position) clip: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) color: vec4<f32> };
@vertex fn vs(v: In) -> Out {
  var o: Out;
  let world = u.model * vec4<f32>(v.pos, 1.0);
  o.clip = u.mvp * vec4<f32>(v.pos, 1.0);
  o.clip.z = (o.clip.z + o.clip.w) * 0.5;
  o.world = world.xyz;
  o.normal = normalize((u.normal * vec4<f32>(v.normal, 0.0)).xyz);
  o.color = v.color * u.color;
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
let width = 1, height = 1, meshes = new Map(), pipelines = {};
let dv, wasmModule, drawCalls = 0;

async function createPipelines(gpuDevice, outputFormat) {
  const module = gpuDevice.createShaderModule({ code: shader });
  const bindLayout = gpuDevice.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 320 } }] });
  const layout = gpuDevice.createPipelineLayout({ bindGroupLayouts: [bindLayout] });
  const vertex = { module, entryPoint: 'vs', buffers: [{ arrayStride: 120, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 104, format: 'float32x4' },
  ] }] };
  const target = { format: outputFormat, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }, writeMask: GPUColorWrite.ALL };
  const created = { bindLayout };
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
  const stride = Math.ceil(320 / alignment) * alignment;
  const needed = Math.max(stride, stride * count);
  if (needed <= uniformCapacity) return stride;
  if (uniformBuffer) uniformBuffer.destroy();
  uniformCapacity = Math.max(needed, uniformCapacity * 2, 65536);
  uniformBuffer = device.createBuffer({ size: uniformCapacity, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  uniformBindGroup = device.createBindGroup({ layout: pipelines.bindLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer, offset: 0, size: 320 } }] });
  return stride;
}

function readMat(ptr, byteOffset) {
  const out = new Float32Array(16), at = ptr + byteOffset;
  for (let i = 0; i < 16; i++) out[i] = dv.getFloat32(at + i * 4, true);
  return out;
}
function normalMatrix(m) {
  const a=m[0], b=m[4], c=m[8], d=m[1], e=m[5], f=m[9], g=m[2], h=m[6], i=m[10];
  const A=e*i-f*h, B=f*g-d*i, C=d*h-e*g, det=a*A+b*B+c*C;
  const o = new Float32Array(16);
  if (Math.abs(det) < 1e-12) return o;
  const k = 1/det;
  o[0]=A*k; o[1]=(c*h-b*i)*k; o[2]=(b*f-c*e)*k;
  o[4]=B*k; o[5]=(a*i-c*g)*k; o[6]=(c*d-b*g)*k;
  o[8]=C*k; o[9]=(b*g-a*h)*k; o[10]=(a*e-b*d)*k; o[15]=1;
  return o;
}
function copyVec(ptr, off, out, target) { for (let i=0;i<4;i++) out[target+i]=dv.getFloat32(ptr+off+i*4,true); }

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
    dv = new DataView(wasmModule.HEAPU8.buffer);
    const stride=allocUniforms(count), packed=new Float32Array(stride * count / 4);
    const ambient=new Float32Array(4), lightDir=new Float32Array(4), lightColor=new Float32Array(4), fog=new Float32Array(4), eye=new Float32Array(4);
    copyVec(viewPtr,36,ambient,0); copyVec(viewPtr,12,lightDir,0); copyVec(viewPtr,24,lightColor,0); copyVec(viewPtr,52,fog,0);
    for(let i=0;i<3;i++) eye[i]=dv.getFloat32(viewPtr+i*4,true);
    for(let i=0;i<count;i++) {
      const p=itemsPtr+i*653, base=i*stride/4;
      const mvp=readMat(p,4), model=readMat(p,68), normal=normalMatrix(model);
      packed.set(mvp,base); packed.set(model,base+16); packed.set(normal,base+32);
      copyVec(p,132,packed,base+48); copyVec(p,148,packed,base+52);
      packed.set(ambient,base+56); packed.set(lightDir,base+60); packed.set(lightColor,base+64); packed.set(fog,base+68); packed.set(eye,base+72);
      packed[base+76]=dv.getUint8(p+236)?1:0;
      packed[base+77]=dv.getInt32(p+172,true);
      packed[base+78]=dv.getFloat32(p+176,true);
    }
    if(count) device.queue.writeBuffer(uniformBuffer,0,packed);
    const clear={r:dv.getFloat32(viewPtr+68,true),g:dv.getFloat32(viewPtr+72,true),b:dv.getFloat32(viewPtr+76,true),a:1};
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:clear,loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    const align=device.limits.minUniformBufferOffsetAlignment||256;
    for(let i=0;i<count;i++) {
      const p=itemsPtr+i*653, id=dv.getInt32(p,true), mesh=meshes.get(id);
      if(!mesh||mesh.count===0) continue;
      const blended=dv.getFloat32(p+160,true)>0.5 || dv.getFloat32(p+144,true)<0.999 || dv.getInt32(p+172,true)===2;
      const doubleSided=dv.getUint8(p+236)!==0;
      const pipelineKey=`${blended?'blend':'opaque'}${doubleSided?'Double':''}`;
      pass.setPipeline(pipelines[pipelineKey]);
      pass.setBindGroup(0,uniformBindGroup,[i*stride]);
      pass.setVertexBuffer(0,mesh.vb); pass.setIndexBuffer(mesh.ib,'uint32'); pass.drawIndexed(mesh.count);
      drawCalls++;
    }
    pass.end(); device.queue.submit([encoder.finish()]);
  },
  shutdown() { for(const mesh of meshes.values()){mesh.vb.destroy();mesh.ib.destroy();} meshes.clear(); if(depth)depth.destroy();if(uniformBuffer)uniformBuffer.destroy(); depth=uniformBuffer=null;uniformCapacity=0; }
};
