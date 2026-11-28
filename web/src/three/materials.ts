import { Color } from './color';
import { Vector2 } from './math';
import { NormalBlending } from './textures';
import { releaseMaterial } from './bridge';

/* --- materials --------------------------------------------------------------- */

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

export class Material {
  isMaterial: boolean;
  name: string;
  color: Color;
  opacity: number;
  transparent: boolean;
  alphaTest: number;
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
  version?: number;
  [key: string]: any;
  constructor(parameters: Record<string, any> = {}) {
    this.isMaterial = true;
    this.name = '';
    this.color = new Color(0xffffff);
    this.opacity = 1;
    this.transparent = false;
    this.alphaTest = 0;
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
    Object.assign(this, parameters);
    if (parameters.color !== undefined && !(parameters.color instanceof Color)) this.color = new Color(parameters.color);
  }
  dispose() {
    this.version = (this.version || 0) + 1;
    releaseMaterial(this);
  }
}

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

