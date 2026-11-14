import createGoose3D from './app.js';
const results = [];
function check(ok, name) {
  results.push((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) throw new Error(name);
}
const canvas = document.querySelector('canvas');
try {
  const gl = canvas.getContext('webgl2');
  check(!!gl, 'WebGL2 is available');
  const hardwareUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  // Exercise the minimum WebGL2 budget even on a more capable test machine.
  const getParameter = gl.getParameter.bind(gl);
  gl.getParameter = parameter => parameter === gl.MAX_TEXTURE_IMAGE_UNITS ? 16 : getParameter(parameter);
  let fragmentBudgetOK = true;
  const drawElements = gl.drawElements.bind(gl);
  gl.drawElements = (...args) => {
    const program = getParameter(gl.CURRENT_PROGRAM);
    const vertexSamplers = new Set(['u_joint_palette', 'u_morph_positions', 'u_morph_normals', 'u_morph_tangents', 'u_morph_weights']);
    let fragmentSamplers = 0;
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const uniform = gl.getActiveUniform(program, i);
      if (![gl.SAMPLER_2D, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW].includes(uniform.type) || vertexSamplers.has(uniform.name)) continue;
      fragmentSamplers++;
      const unit = gl.getUniform(program, gl.getUniformLocation(program, uniform.name));
      fragmentBudgetOK &&= unit >= 0 && unit < 16;
    }
    fragmentBudgetOK &&= fragmentSamplers <= 16;
    return drawElements(...args);
  };
  const engine = await createGoose3D();
  let error = '';
  window.gooseError = text => { error = text; };
  check(engine._g3_host_start(480, 360), 'engine boots with a 16-unit budget (hardware: ' + hardwareUnits + ')');
  engine._g3_app_frame(0);
  const pixels = new Uint8Array(480 * 360 * 4);
  gl.readPixels(0, 0, 480, 360, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let changed = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2]) changed++;
  check(changed > 1000 && engine._siege_drawn() > 50, 'arena contains rendered geometry');
  check(engine._siege_wave() === 1 && engine._siege_alive() === 8, 'combat initializes');
  engine._g3_input_key(68, 1); engine._g3_input_key(16, 1); engine._g3_input_key(39, 1);
  for (let i = 0; i < 10; i++) engine._g3_app_frame(1 / 60);
  check(engine._siege_dash() > 1, 'input activates dash during combat');
  engine._g3_input_key(68, 0); engine._g3_input_key(16, 0); engine._g3_input_key(39, 0);
  for (let i = 0; i < 90; i++) engine._g3_app_frame(1 / 60);
  check(engine._siege_state() === 0, 'simulation continues after movement and shooting');
  engine._siege_reset(); engine._g3_app_frame(0);
  check(engine._siege_health() === 5 && engine._siege_score() === 0 && engine._siege_alive() === 8, 'restart restores combat state');
  check(fragmentBudgetOK, 'every active fragment sampler fits units 0–15');
  check(gl.getError() === gl.NO_ERROR && !error, 'drawing reports no WebGL errors');
  engine._g3_app_shutdown();
  document.querySelector('#results').textContent = ['PASS (' + results.length + ' checks)', ...results].join(String.fromCharCode(10));
} catch (error) {
  document.querySelector('#results').textContent = ['FAIL: ' + error.message, ...results].join(String.fromCharCode(10));
}
