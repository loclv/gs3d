import type { Object3D } from './three.js';

export interface GLTFExporterParseOptions {
  binary?: boolean;
  [key: string]: unknown;
}

export class GLTFExporter {
  constructor();
  parseAsync(object: Object3D, options?: GLTFExporterParseOptions): Promise<ArrayBuffer | string>;
  parse(
    object: Object3D,
    onDone: (result: ArrayBuffer | string) => void,
    onError?: (error: unknown) => void,
    options?: GLTFExporterParseOptions,
  ): void;
}
