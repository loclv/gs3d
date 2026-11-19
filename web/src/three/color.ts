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
}

