import createGoose3D from './app.js';
const output = document.querySelector('#results');
try {
  const width = 320, height = 200;
  const canvas = document.querySelector('#canvas');
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2');
  const engine = await createGoose3D();
  if (!engine._g3_host_start(width, height)) throw new Error('engine startup failed');
  let matricesValid = true, matrixUploads = 0;
  const upload = gl.uniformMatrix4fv.bind(gl);
  gl.uniformMatrix4fv = (location, transpose, data, ...rest) => {
    const offset = rest[0] || 0;
    const count = rest[1] || data.length - offset;
    // All demo transforms are finite and bounded: camera radius 9.5,
    // display extent 5, and scales at most 5. Corrupt uploads violate this.
    for (let i = offset; i < offset + count; i++)
      matricesValid &&= Number.isFinite(data[i]) && Math.abs(data[i]) < 100;
    matrixUploads++;
    return upload(location, transpose, data, ...rest);
  };
  const read = () => {
    const bytes = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return bytes;
  };
  engine._g3_app_frame(0);
  let previous = read();
  let staticChanges = 0, maxMeanDelta = 0, maxFlashPixels = 0;
  for (let frame = 0; frame < 600; frame++) {
    engine._g3_app_frame(frame < 8 ? 0 : 1 / 60);
    const pixels = read();
    let delta = 0, flashPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const d = Math.abs(pixels[i] - previous[i]) + Math.abs(pixels[i+1] - previous[i+1]) + Math.abs(pixels[i+2] - previous[i+2]);
      delta += d;
      if (d > 192) flashPixels++;
      if (frame < 8 && d) staticChanges++;
    }
    maxMeanDelta = Math.max(maxMeanDelta, delta / (width * height * 3));
    maxFlashPixels = Math.max(maxFlashPixels, flashPixels);
    previous = pixels;
  }
  const metrics = {staticChanges, maxMeanDelta, maxFlashPixels, matrixUploads, matricesValid};
  if (!matricesValid || matrixUploads < 1000) throw new Error('invalid or missing object matrix uploads: ' + JSON.stringify(metrics));
  if (staticChanges || maxMeanDelta > 2 || maxFlashPixels > width * height * 0.02)
    throw new Error('discontinuous animation: ' + JSON.stringify(metrics));
  if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
  engine._g3_app_shutdown();
  window.__g3DemoChecks = {passed: true, results: [
    {ok:true,name:'all uploaded matrices are finite and bounded'},
    {ok:true,name:'paused frames are byte-identical'},
    {ok:true,name:'600 animated frames have bounded pixel changes'},
    {ok:true,name:'WebGL reports no errors'},
  ], metrics};
  output.textContent = 'PASS: 600 frames, aligned finite matrices, stable paused image, smooth animation. ' + JSON.stringify(metrics);
} catch(error) { window.__g3DemoChecks = {passed:false, results:[],error:error.message}; output.textContent = 'FAIL: ' + error.message; }
