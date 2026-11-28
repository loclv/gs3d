/* --- colour management -------------------------------------------------- */

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
export function hexToRgb(hex) {
  const value = hex & 0xffffff;
  return [(value >> 16 & 0xff) / 255, (value >> 8 & 0xff) / 255, (value & 0xff) / 255];
}
function parseCssColor(style) {
  const text = String(style).trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map(d => d + d).join('');
    if (digits.length === 6 || digits.length === 8) {
      const value = parseInt(digits.slice(0, 6), 16);
      return [...hexToRgb(value).map(srgbToLinear), digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1];
    }
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) return [srgbToLinear(+rgb[1] / 255), srgbToLinear(+rgb[2] / 255), srgbToLinear(+rgb[3] / 255), 1];
  const named = { white: [1, 1, 1], black: [0, 0, 0], red: [1, 0, 0], green: [0, 128 / 255, 0],
    blue: [0, 0, 1], gray: [0.502, 0.502, 0.502], grey: [0.502, 0.502, 0.502],
    yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1], orange: [1, 0.647, 0] };
  if (named[text]) return [...named[text], 1];
  throw new Error(`gs3d: unsupported colour '${style}'`);
}

// Colours store linear working-space components, like three r152+ with the
// default color management. Hex and CSS strings arrive in sRGB and convert.
export class Color {
  isColor: boolean;
  r: number;
  g: number;
  b: number;
  constructor(r: any = 0xffffff, g?: number, b?: number) {
    this.isColor = true;
    this.r = 1; this.g = 1; this.b = 1;
    this.set(r, g, b);
  }
  set(value: any, g?: number, b?: number) {
    if (value === undefined) return this;
    if (typeof value === 'number' && g === undefined) return this.setHex(value);
    if (typeof value === 'string') {
      const [r, gg, bb] = parseCssColor(value);
      this.r = r; this.g = gg; this.b = bb;
      return this;
    }
    if (value && value.isColor) return this.copy(value);
    return this.setRGB(value, g, b);
  }
  setHex(hex) {
    const [r, g, b] = hexToRgb(hex);
    // Hex colours arrive in sRGB and convert to the linear working space.
    return this.setRGB(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  }
  setRGB(r, g, b) {
    // Numeric triples are already working-space (linear) values.
    this.r = r; this.g = g; this.b = b;
    return this;
  }
  setStyle(style) { return this.set(style); }
  copy(color) { this.r = color.r; this.g = color.g; this.b = color.b; return this; }
  clone() { return new Color().copy(this); }
  getHex() {
    const toByte = c => Math.round(Math.min(Math.max(linearToSrgb(c), 0), 1) * 255);
    return (toByte(this.r) << 16) | (toByte(this.g) << 8) | toByte(this.b);
  }
  getHexString() { return this.getHex().toString(16).padStart(6, '0'); }
  getStyle() {
    const toByte = c => Math.round(Math.min(Math.max(linearToSrgb(c), 0), 1) * 255);
    return `rgb(${toByte(this.r)}, ${toByte(this.g)}, ${toByte(this.b)})`;
  }
  lerp(color, alpha) {
    this.r += (color.r - this.r) * alpha;
    this.g += (color.g - this.g) * alpha;
    this.b += (color.b - this.b) * alpha;
    return this;
  }
  // HSL helpers operate in linear space like the stored components.
  getHSL(target: { h?: number; s?: number; l?: number } = {}) {
    const r = this.r, g = this.g, b = this.b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d > 1e-12) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    target.h = h; target.s = s; target.l = l;
    return target;
  }
  offsetHSL(h, s, l) {
    const hsl = this.getHSL({ h: 0, s: 0, l: 0 });
    hsl.h = (hsl.h + h) % 1; if (hsl.h < 0) hsl.h += 1;
    hsl.s = Math.min(1, Math.max(0, hsl.s + s));
    hsl.l = Math.min(1, Math.max(0, hsl.l + l));
    const { h: hh, s: ss, l: ll } = hsl;
    if (ss === 0) { const v = ll; return this.setRGB(v, v, v); }
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    const f = t => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return this.setRGB(f(hh + 1 / 3), f(hh), f(hh - 1 / 3));
  }
  // --- three.js parity ---------------------------------------------------------
  setHSL(h, s, l) {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    h = ((h % 1) + 1) % 1;
    if (s === 0) return this.setRGB(l, l, l);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return this.setRGB(
      hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3));
  }
  setScalar(s) { return this.setRGB(s, s, s); }
  setColorName(name: string) {
    // Route through setStyle so named colors resolve via parseCssColor.
    return this.setStyle(name);
  }
  setFromVector3(v) { return this.setRGB(v.x, v.y, v.z); }
  setFromBufferAttribute(attribute, index) {
    const o = index * attribute.itemSize;
    return this.setRGB(attribute.array[o], attribute.array[o + 1], attribute.array[o + 2]);
  }
  fromBufferAttribute(attribute, index) { return this.setFromBufferAttribute(attribute, index); }
  equals(c) { return c && this.r === c.r && this.g === c.g && this.b === c.b; }
  fromArray(array, offset = 0) { return this.setRGB(array[offset], array[offset + 1], array[offset + 2]); }
  toArray(array = [], offset = 0) {
    array[offset] = this.r; array[offset + 1] = this.g; array[offset + 2] = this.b;
    return array;
  }
  add(c) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
  addColors(a, b) { return this.add(a).add(b); }
  addScalar(s) { this.r += s; this.g += s; this.b += s; return this; }
  sub(c) { this.r -= c.r; this.g -= c.g; this.b -= c.b; return this; }
  multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  lerpColors(c1, c2, alpha) { return this.copy(c1).lerp(c2, alpha); }
  lerpHSL(c, alpha) {
    const a = this.getHSL({ h: 0, s: 0, l: 0 }), b = c.getHSL({ h: 0, s: 0, l: 0 });
    const dh = ((b.h - a.h + 1.5) % 1) - 0.5;
    return this.setHSL(
      (a.h + dh * alpha) % 1 || 0,
      a.s + (b.s - a.s) * alpha,
      a.l + (b.l - a.l) * alpha);
  }
  getRGB(target: any = {}) {
    target.r = Math.round(Math.min(Math.max(linearToSrgb(this.r), 0), 1) * 255);
    target.g = Math.round(Math.min(Math.max(linearToSrgb(this.g), 0), 1) * 255);
    target.b = Math.round(Math.min(Math.max(linearToSrgb(this.b), 0), 1) * 255);
    return target;
  }
  applyMatrix3(m: any) {
    const e = m.elements || m;
    const x = this.r, y = this.g, z = this.b;
    this.r = e[0] * x + e[3] * y + e[6] * z;
    this.g = e[1] * x + e[4] * y + e[7] * z;
    this.b = e[2] * x + e[5] * y + e[8] * z;
    return this;
  }
  // Convert between linear working space and sRGB-encoded components.
  convertSRGBToLinear() { this.r = srgbToLinear(this.r); this.g = srgbToLinear(this.g); this.b = srgbToLinear(this.b); return this; }
  convertLinearToSRGB() { this.r = linearToSrgb(this.r); this.g = linearToSrgb(this.g); this.b = linearToSrgb(this.b); return this; }
  copySRGBToLinear() { return this.convertSRGBToLinear(); }
  copyLinearToSRGB() { return this.convertLinearToSRGB(); }
  toJSON() { return this.getHex(); }
}

