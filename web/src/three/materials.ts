import { Color } from './color';
import { Vector2 } from './math';
import { NormalBlending, AddEquation, OneFactor, OneMinusSrcAlphaFactor,
  SrcAlphaFactor, LessEqualDepth, AlwaysStencilFunc, KeepStencilOp } from './textures';
import { releaseMaterial } from './bridge';
import { EventDispatcher } from './events';

/* --- materials --------------------------------------------------------------- */

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

export class Material extends EventDispatcher {
  isMaterial: boolean;
  name: string;
  color: Color;
  opacity: number;
  transparent: boolean;
  _alphaTest: number;
  get alphaTest() { return this._alphaTest; }
  set alphaTest(v) { this._alphaTest = v; }
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  side: number;
  visible: boolean;
  map: any;
  vertexColors: boolean;
  flatShading: boolean;
  normalMap: any;
  normalScale: Vector2;
  roughnessMap: any;
  metalnessMap: any;
  emissiveMap: any;
  aoMap: any;
  aoMapIntensity: number;
  envMapIntensity: number;
  depthTest: boolean;
  depthWrite: boolean;
  depthFunc: number;
  blending: number;
  blendEquation: number;
  blendEquationAlpha: number;
  blendSrc: number;
  blendDst: number;
  blendSrcAlpha: number;
  blendDstAlpha: number;
  stencilWrite: boolean;
  stencilWriteMask: number;
  stencilFunc: number;
  stencilRef: number;
  stencilFuncMask: number;
  stencilFail: number;
  stencilZFail: number;
  stencilZPass: number;
  dithering: boolean;
  alphaHash: boolean;
  version?: number;
  [key: string]: any;
  constructor(parameters: Record<string, any> = {}) {
    super();
    this.isMaterial = true;
    this.name = '';
    this.color = new Color(0xffffff);
    this.opacity = 1;
    this.transparent = false;
    this._alphaTest = 0;
    this.polygonOffset = false;
    this.polygonOffsetFactor = 0;
    this.polygonOffsetUnits = 0;
    this.side = FrontSide;
    this.visible = true;
    this.map = null;
    this.vertexColors = false;
    this.flatShading = false;
    this.normalMap = null;
    this.normalScale = new Vector2(1, 1);
    this.roughnessMap = null;
    this.metalnessMap = null;
    this.emissiveMap = null;
    this.aoMap = null;
    this.aoMapIntensity = 1;
    this.envMapIntensity = 1;
    this.depthTest = true;
    this.depthWrite = true;
    this.depthFunc = LessEqualDepth;
    this.blending = NormalBlending;
    this.blendEquation = AddEquation;
    this.blendEquationAlpha = AddEquation;
    this.blendSrc = SrcAlphaFactor;
    this.blendDst = OneMinusSrcAlphaFactor;
    this.blendSrcAlpha = OneFactor;
    this.blendDstAlpha = OneMinusSrcAlphaFactor;
    this.stencilWrite = false;
    this.stencilWriteMask = 0xff;
    this.stencilFunc = AlwaysStencilFunc;
    this.stencilRef = 0;
    this.stencilFuncMask = 0xff;
    this.stencilFail = KeepStencilOp;
    this.stencilZFail = KeepStencilOp;
    this.stencilZPass = KeepStencilOp;
    this.dithering = false;
    this.alphaHash = false;
    Object.assign(this, parameters);
    if (parameters.color !== undefined && !(parameters.color instanceof Color)) this.color = new Color(parameters.color);
  }
  // Prototype hooks matching three.js (empty defaults; subclasses override).
  onBeforeCompile(parameters: any, renderer: any) {}
  onBeforeRender(renderer: any, scene: any, camera: any, geometry: any, object: any, group: any) {}
  dispose() {
    this.version = (this.version || 0) + 1;
    releaseMaterial(this);
  }
  // Bumping needsUpdate invalidates cached shader/engine state, like three.
  set needsUpdate(value: boolean) {
    if (value) this.version = (this.version || 0) + 1;
  }
  get needsUpdate() { return false; }
  setValues(parameters: Record<string, any>) {
    for (const key of Object.keys(parameters)) {
      const value = parameters[key];
      if (value === undefined) continue;
      const current = (this as any)[key];
      if (current && current.isColor && value && !value.isColor) {
        current.set(value);
      } else if (current && current.isVector2 && value && !value.isVector2) {
        current.set(value.x, value.y);
      } else {
        (this as any)[key] = value;
      }
    }
    return this;
  }
  // Shallow clone with deep copies of color/vector/texture-like fields.
  copy(source: Material) {
    const skip = new Set(['isMaterial', 'isEventDispatcher', 'uuid', 'type', 'version', 'onBeforeCompile', '_listeners']);
    for (const key of Object.keys(source)) {
      if (skip.has(key)) continue;
      const v = (source as any)[key];
      if (v && typeof v === 'object') {
        if (v.isColor || v.isVector2 || v.isVector3 || v.isVector4 || v.isMatrix4 || v.isMatrix3 || v.isQuaternion || v.isEuler) {
          (this as any)[key] = v.clone();
          continue;
        }
        if (v.isTexture || v.isRenderTargetTexture) {
          (this as any)[key] = v; // textures are shared, like three
          continue;
        }
      }
      (this as any)[key] = v;
    }
    return this;
  }
  clone() {
    return new (this as any).constructor().copy(this);
  }
  customProgramCacheKey() {
    return this.onBeforeCompile ? this.onBeforeCompile.toString() : '';
  }
  toJSON(meta: any = {}) {
    const data: Record<string, any> = { type: (this as any).type || this.constructor.name, name: this.name };
    for (const key of Object.keys(this)) {
      const v = (this as any)[key];
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
        data[key] = v;
      } else if (v && v.isColor) {
        data[key] = '#' + v.getHexString();
      }
    }
    return data;
  }
}

// Marks the base no-op so the facade can tell user-defined onBeforeCompile
// apart from the inherited default (three always defines the method).
(Material.prototype.onBeforeCompile as any)._gs3dDefault = true;

export class MeshBasicMaterial extends Material {
  isMeshBasicMaterial: boolean;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshBasicMaterial = true;
    if (parameters.color !== undefined) this.color = parameters.color instanceof Color ? parameters.color : new Color(parameters.color);
  }
}

export class MeshStandardMaterial extends Material {
  isMeshStandardMaterial: boolean;
  metalness: number;
  roughness: number;
  emissive: Color;
  emissiveIntensity: number;
  ior: number;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshStandardMaterial = true;
    this.metalness = parameters.metalness ?? 0;
    this.roughness = parameters.roughness ?? 1;
    this.emissive = parameters.emissive !== undefined ? (parameters.emissive instanceof Color ? parameters.emissive : new Color(parameters.emissive)) : new Color(0x000000);
    this.emissiveIntensity = parameters.emissiveIntensity ?? 1;
    this.ior = parameters.ior ?? 1.5;
    if (parameters.color !== undefined) this.color = parameters.color instanceof Color ? parameters.color : new Color(parameters.color);
  }
}
// MeshPhysicalMaterial is an alias in this facade; expose the physical-material
// property surface as prototype accessors (three r180 style) so feature-detect
// code sees them. Values are stored on the instance and ignored by the bridge.
const PHYSICAL_DEFAULTS: Record<string, any> = {
  clearcoat: 0, clearcoatRoughness: 0, sheen: 0, sheenRoughness: 1,
  transmission: 0, thickness: 0, ior: 1.5, iridescence: 0, iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 400], dispersion: 0, anisotropy: 0,
  anisotropyRotation: 0, specularIntensity: 1, attenuationDistance: Infinity,
};
for (const name of Object.keys(PHYSICAL_DEFAULTS)) {
  const key = '_' + name;
  Object.defineProperty(MeshStandardMaterial.prototype, name, {
    get(this: any) { return this[key] ?? PHYSICAL_DEFAULTS[name]; },
    set(this: any, v: any) { this[key] = v; this.version = (this.version || 0) + 1; },
    configurable: true,
  });
}
// Aliases keep instanceof working for code that checks material classes.
export { MeshStandardMaterial as MeshPhysicalMaterial };

// Distinct subclasses so is* flags match three.js for code that feature-
// detects materials. Rendering falls back to the nearest supported shading.
export class MeshPhongMaterial extends MeshStandardMaterial {
  isMeshPhongMaterial: boolean;
  shininess: number;
  specular: Color;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshPhongMaterial = true;
    this.shininess = parameters.shininess ?? 30;
    this.specular = parameters.specular instanceof Color ? parameters.specular : new Color(parameters.specular ?? 0x111111);
  }
}
export class MeshLambertMaterial extends MeshStandardMaterial {
  isMeshLambertMaterial: boolean;
  emissive: Color;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshLambertMaterial = true;
  }
}
export class MeshNormalMaterial extends MeshBasicMaterial {
  isMeshNormalMaterial: boolean;
  flatShading: boolean;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshNormalMaterial = true;
  }
}
export class MeshToonMaterial extends MeshStandardMaterial {
  isMeshToonMaterial: boolean;
  gradientMap: any;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshToonMaterial = true;
    this.gradientMap = parameters.gradientMap ?? null;
  }
}
export class MeshDepthMaterial extends MeshBasicMaterial {
  isMeshDepthMaterial: boolean;
  depthPacking: number;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshDepthMaterial = true;
    this.depthPacking = parameters.depthPacking ?? 0;
  }
}
export class MeshDistanceMaterial extends MeshBasicMaterial {
  isMeshDistanceMaterial: boolean;
  referencePosition: any;
  near: number;
  far: number;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshDistanceMaterial = true;
    this.referencePosition = parameters.referencePosition ?? null;
    this.near = parameters.near ?? 1;
    this.far = parameters.far ?? 1000;
  }
}
export class ShadowMaterial extends Material {
  isShadowMaterial: boolean;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isShadowMaterial = true;
    this.opacity = parameters.opacity ?? 1;
  }
}
export class MeshMatcapMaterial extends MeshBasicMaterial {
  isMeshMatcapMaterial: boolean;
  matcap: any;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isMeshMatcapMaterial = true;
    this.matcap = parameters.matcap ?? null;
  }
}
export class SpriteMaterial extends MeshBasicMaterial {
  isSpriteMaterial: boolean;
  rotation: number;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isSpriteMaterial = true;
    this.rotation = parameters.rotation ?? 0;
  }
}
export class PointsMaterial extends MeshBasicMaterial {
  isPointsMaterial: boolean;
  size: number;
  sizeAttenuation: boolean;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isPointsMaterial = true;
    this.size = parameters.size ?? 1;
    this.sizeAttenuation = parameters.sizeAttenuation !== false;
  }
}
export class LineBasicMaterial extends Material {
  isLineBasicMaterial: boolean;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isLineBasicMaterial = true;
  }
}
export class LineDashedMaterial extends LineBasicMaterial {
  isLineDashedMaterial: boolean;
  dashSize: number;
  gapSize: number;
  scale: number;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isLineDashedMaterial = true;
    this.dashSize = parameters.dashSize ?? 1;
    this.gapSize = parameters.gapSize ?? 1;
    this.scale = parameters.scale ?? 1;
  }
}

// Complete user vertex+fragment programs (GLSL ES 1.00, three.js style).
// The engine supplies the standard matrix/camera uniforms and the vertex
// attributes position, normal, uv, color and tangent; packed UV sets beyond
// `uv`, custom vertex attributes, projective texturing and custom blending
// modes are not reachable. `#include <tonemapping_fragment>` and
// `#include <colorspace_fragment>` resolve to the engine's output chain.
export class ShaderMaterial extends Material {
  isShaderMaterial: boolean;
  defines: Record<string, any>;
  uniforms: Record<string, any>;
  vertexShader: string;
  fragmentShader: string;
  depthWrite: boolean;
  depthTest: boolean;
  blending: number;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isShaderMaterial = true;
    this.defines = parameters.defines ? { ...parameters.defines } : {};
    this.uniforms = parameters.uniforms || {};
    this.vertexShader = parameters.vertexShader || '';
    this.fragmentShader = parameters.fragmentShader || '';
    this.depthWrite = parameters.depthWrite !== false;
    this.depthTest = parameters.depthTest !== false;
    this.blending = parameters.blending ?? NormalBlending;
    this.side = parameters.side ?? FrontSide;
    this.transparent = parameters.transparent === true;
  }
}

// RawShaderMaterial is ShaderMaterial without three's prefix chunk injection;
// the gs3d raw-shader path already compiles user sources verbatim.
export class RawShaderMaterial extends ShaderMaterial {
  isRawShaderMaterial: boolean;
  constructor(parameters: Record<string, any> = {}) {
    super(parameters);
    this.isRawShaderMaterial = true;
  }
}

