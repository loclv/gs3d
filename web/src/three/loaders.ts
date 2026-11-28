/* --- loading -------------------------------------------------------------------
 * LoadingManager, FileLoader and Cache matching three.js semantics: loaders
 * report item start/end/error to their manager, FileLoader resolves URLs
 * through manager.resolveURL and honours Cache. TextureLoader/ImageLoader in
 * textures.ts accept an optional manager in their constructor for the same
 * hook points. */

export class LoadingManager {
  isLoadingManager: boolean;
  urlModifier: Function | null;
  handlers: Array<{ type: string; callback: Function }>;
  itemsTotal = 0;
  itemsLoaded = 0;
  filesLoaded = 0;
  // Assignable callbacks, matching three's LoadingManager public fields.
  onStart: Function = () => {};
  onLoad: Function = () => {};
  onProgress: Function = () => {};
  onError: Function = () => {};
  onLoadAll: Function = () => {};
  constructor(onLoad?: Function, onProgress?: Function, onError?: Function) {
    this.isLoadingManager = true;
    this.urlModifier = null;
    this.handlers = [];
    if (onLoad) this.onLoad = onLoad;
    if (onProgress) this.onProgress = onProgress;
    if (onError) this.onError = onError;
  }
  itemStart(url = '') {
    this.itemsTotal++;
    this.onStart(url, this.itemsLoaded, this.itemsTotal);
  }
  itemEnd(url = '') {
    this.itemsLoaded++;
    this.filesLoaded++;
    this.onProgress(url, this.itemsLoaded, this.itemsTotal);
    if (this.itemsLoaded === this.itemsTotal) {
      this.onLoadAll();
      this.onLoad('', this.itemsLoaded, this.itemsTotal);
    }
  }
  itemError(url = '') {
    this.onError(url);
  }
  resolveURL(url: string) {
    if (this.urlModifier) return this.urlModifier(url);
    return url;
  }
  addHandler(regex: RegExp | string, loader: Function) {
    this.handlers.push({ type: 'handler:' + String(regex), callback: loader });
    return this;
  }
  removeHandler(regex: RegExp | string) {
    const key = 'handler:' + String(regex);
    this.handlers = this.handlers.filter(h => h.type !== key);
    return this;
  }
  getHandler(url: string) {
    for (const h of this.handlers) {
      if (!h.type.startsWith('handler:')) continue;
      const re = h.type.slice(8);
      try {
        if (new RegExp(re).test(url)) return h.callback;
      } catch { /* invalid stored regex, skip */ }
    }
    return null;
  }
}

export const DefaultLoadingManager = new LoadingManager();

// three.js exports Cache as a singleton object, not a class.
export const Cache = {
  enabled: false,
  files: new Map<string, any>(),
  add(key: string, file: any) { if (this.enabled) this.files.set(key, file); },
  get(key: string) { return this.enabled ? this.files.get(key) : undefined; },
  remove(key: string) { this.files.delete(key); return this; },
  clear() { this.files.clear(); return this; },
};

/* --- loader base + utilities ---------------------------------------------------- */

// Base class for loaders that carry a LoadingManager (three.Loader).
export class Loader {
  manager: LoadingManager;
  crossOrigin: string;
  path = '';
  resourcePath = '';
  requestHeader: Record<string, string> = {};
  withCredentials = false;
  constructor(manager: LoadingManager = DefaultLoadingManager) {
    this.manager = manager;
    this.crossOrigin = 'anonymous';
  }
  load(url?: string, onLoad?: any, onProgress?: any, onError?: any): any {
    throw new Error('Loader.load must be implemented by subclasses');
  }
  loadAsync(url: string, onProgress?: (e: any) => void) {
    return new Promise((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }
  setCrossOrigin(value: string) { this.crossOrigin = value; return this; }
  setPath(value: string) { this.path = value; return this; }
  setResourcePath(value: string) { this.resourcePath = value; return this; }
  setRequestHeader(key: string, value: string) { this.requestHeader[key] = value; return this; }
  setWithCredentials(value: boolean) { this.withCredentials = value; return this; }
  abort() { return this; }
  // Subclasses override; default is identity.
  parse(data: any) { return data; }
}

// URL helpers matching three's LoaderUtils subset.
export const LoaderUtils = {
  extractUrlBase(url: string) {
    const i = url.lastIndexOf('/');
    return i === -1 ? '' : url.slice(0, i + 1);
  },
  getUrlExtension(url: string) {
    const m = /\.([^\.\/?]+)(\?.*)?$/.exec(url);
    return m ? m[1].toLowerCase() : '';
  },
  // Returns a blob URL for the given blob, falling back to a data URL.
  createBlobURL(blob: Blob) {
    if (typeof URL !== 'undefined' && URL.createObjectURL) return URL.createObjectURL(blob);
    return '';
  },
  revokeBlobURL(url: string) {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url);
  },
  resolveURL(base: string, url: string) {
    if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (url.startsWith('/')) return url;
    return (base || '') + url;
  },
};

export class FileLoader extends Loader {
  isFileLoader: boolean;
  manager: LoadingManager;
  responseType: string;
  mimeType: string;
  withCredentials: boolean;
  requestHeader: Record<string, string>;
  path = '';
  constructor(manager: LoadingManager = DefaultLoadingManager) {
    super(manager);
    this.isFileLoader = true;
    this.responseType = '';
    this.mimeType = '';
  }
  load(url: string, onLoad?: (data: any) => void, onProgress?: (e: any) => void, onError?: (e: any) => void) {
    const resolved = this.manager.resolveURL(this.resourcePath + this.path + url);
    const mimeType = this.mimeType;
    const cached = Cache.get(resolved);
    if (cached !== undefined) {
      // Cached path still reports through the manager asynchronously.
      Promise.resolve().then(() => {
        this.manager.itemStart(resolved);
        if (onLoad) onLoad(cached);
        this.manager.itemEnd(resolved);
      });
      return this;
    }
    this.manager.itemStart(resolved);
    const headers: Record<string, string> = { ...(this.requestHeader || {}) };
    if (mimeType) headers['Accept'] = mimeType;
    fetch(resolved, { headers, credentials: this.withCredentials ? 'include' : 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(`gs3d: failed to fetch '${resolved}' (${response.status})`);
        if (onProgress && response.body) {
          // Stream progress when the body supports it.
          const total = Number(response.headers.get('content-length')) || 0;
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let loaded = 0;
          const pump = (): Promise<void> => reader.read().then(({ done, value }) => {
            if (done) return;
            chunks.push(value); loaded += value.length;
            if (onProgress) onProgress({ loaded, total, lengthComputable: total > 0 });
            return pump();
          });
          return pump().then(() => {
            const merged = new Uint8Array(loaded);
            let off = 0;
            for (const c of chunks) { merged.set(c, off); off += c.length; }
            return { response, data: merged };
          });
        }
        const type = this.responseType || 'text';
        if (type === 'arraybuffer') return response.arrayBuffer().then(data => ({ response, data }));
        if (type === 'blob') return response.blob().then(data => ({ response, data }));
        if (type === 'json') return response.json().then(data => ({ response, data }));
        return response.text().then(data => ({ response, data }));
      })
      .then(({ data }) => {
        Cache.add(resolved, data);
        if (onLoad) onLoad(data);
        this.manager.itemEnd(resolved);
      })
      .catch(error => {
        this.manager.itemError(resolved);
        this.manager.itemEnd(resolved);
        if (onError) onError(error);
      });
    return this;
  }
  setPath(value: string) { this.path = value; return this; }
  setResourcePath(value: string) { this.resourcePath = value; return this; }
  setResponseType(value: string) { this.responseType = value; return this; }
  setMimeType(value: string) { this.mimeType = value; return this; }
  loadAsync(url: string, onProgress?: (e: any) => void) {
    return new Promise((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }
  abort() { /* fetch cannot be aborted here; kept for API parity */ return this; }
}
