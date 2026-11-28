---
name: g3-sound
description: Use when working with goose-3d procedural audio — the g3.sound PCM synthesizer (thump/tone/noise voices, mono/stereo panning, sound_render, streaming pending/commit view, metering, listener), the g3.sound_wav WAV exporter, or the sound_contacts physics-impact bridge.
---

# Sound in goose-3d

`g3.sound` (`src/g3/sound.goose`) is a heap-free, offline PCM synthesizer —
mono or interleaved stereo. `g3.sound_wav` (`src/g3/sound_wav.goose`)
serializes the buffer to 16-bit WAV through `os`. Neither touches the
`g3p_*` platform seam, a device, or a window — the same code runs headless
and (unexported) could feed wasm later.

## Model

- `sound_init(rate, channels)` once (rate 8000..192000, channels 1 or 2;
  default 48000/1), then per frame: spawn events, `sound_render(dt)`
  appends `round(dt * rate)` frames — 1 sample per channel — to a
  grow-only buffer. Re-init resets buffer, voices and the consumed mark.
- Three voice kinds behind one attack+exponential-decay envelope:
  `SOUND_KIND_THUMP` (pitch-swept sine, the collision body),
  `SOUND_KIND_TONE` (sine, optionally gliding to `freq_end`),
  `SOUND_KIND_NOISE` (white noise through a one-pole lowpass, `cutoff`
  0..1 mix amount). `SOUND_MAX_VOICES = 64`; overflow drops the event.
- Every event takes `pan` (-1 left .. +1 right, linear law, ignored in
  mono): `sound_impact(strength, pitch, pan)` (thump + brightness-scaled
  click, deterministic ±6% pitch jitter), `sound_tone`, `sound_noise`,
  generic `sound_play`.
- `sound_clear()` resets buffer, voices, marks and the contact cooldown.

## Panning, listener and distance

- `sound_set_listener(pos, right)` stores a world position and right
  vector (normalized internally); `sound_clear_listener()` disables.
- `sound_contacts` then pans each impact by `dot(dir(contact - pos),
  right)` and attenuates linearly to `SOUND_LISTENER_RANGE` (25 world
  units) floored at `SOUND_LISTENER_MIN_GAIN` (0.05). Feed it the camera
  position and its right vector each frame.

## Master bus

- `sound_set_volume(v)` — 0..2 gain applied after panning and echo,
  before the [-1,1] clamp. `sound_volume()` reads it back.
- `sound_normalize(target)` — scales the *pending* region so its peak
  hits `target`; boosting can exceed [-1,1] (it's gain on stored audio,
  not a limiter).
- `sound_set_echo(delay_s, feedback, wet)` — feedback-delay on the whole
  mix, one interleaved ring sized `delay_frames × channels`
  (`SOUND_ECHO_MAX_SECONDS` = 0.5). `sound_clear_echo()` /
  `sound_echo_active()`. `sound_clear()` and `sound_init()` disable it —
  set echo again after re-init or clear.

## Reading the buffer

- `sound_pcm()` — whole buffer slice (interleaved when stereo);
  `sound_len()`/`sound_seconds()` count f32 samples, i.e. frames ×
  channels; `sound_channels()` reports the mode.
- Streaming: `sound_pending()`/`sound_pending_len()` is the unconsumed
  tail since `sound_commit()`; `sound_pending_peak()` is its max |sample|
  for metering/normalisation (`sound_normalize` rescales it). Commit
  after handing samples off.
- WAV: `sound_write_wav(path)` whole buffer;
  `sound_write_wav_pending(path)` / `sound_wav_pending_bytes(out)` only
  the pending region — pair with `sound_commit()` for chunked output.
  The header's channel count, byte rate and block align follow
  `g_sound_channels`.

## Physics bridge

`sound_contacts(scale = 1.0, min_speed = 0.5)` after `physics_step` scans
the step's `BodyContact` records and emits an impact per qualifying pair.
Strength is the contact's `impact` field (approach speed in m/s recorded
pre-solve — see `g3-physics`); pitch is `1/sqrt(lighter mass)` clamped
0.4..2.5; pan and distance attenuation come from the listener when set.
A per-pair cooldown
(`SOUND_CONTACT_COOLDOWN = 12` steps, keyed on `pkey`, tracked against
`physics_stats().steps`) prevents repeats while a record persists;
resting contacts have ~0 impact and stay silent. Returns the number of
events emitted.

## Gotchas

- `sound.goose` and `sound_wav.goose` are both `namespace g3`; qualify
  calls `g3::sound_*` from other namespaces. `sound_wav.goose` is the only
  file importing `os` — keep `os`-free consumers on `g3.sound` alone.
- All f32; `sound_render` mixes at the buffer's rate — call it once per
  frame with the frame `dt`, not per physics substep.
- The buffer is grow-only: `sound_commit()` marks consumption but does not
  free prefix samples. Long-running streams should `sound_clear()`
  periodically or accept the growth (48 kHz stereo ≈ 384 KB/s).
- Voice state is per-slot, not per-sound: two impacts in one frame both
  start at the next render boundary and overlap in the mix.
- Changing `sound_init` channels mid-stream changes the sample layout of
  everything rendered afterwards; the pending mark is a sample index, so
  keep the mode fixed for a stream or `sound_clear()` on switch. The echo
  ring is sized for the rate/channels at `sound_set_echo` time — set it
  after `sound_init`, and re-set after any clear.

## Verify

- `goose check src/test_sound.goose` — typechecks the module graph.
- `G3_NATIVE_CC=/usr/bin/cc goose build --cc tools/native_cc.sh -o
  build/test_sound src/test_sound.goose && ./build/test_sound` — 42
  checks: envelopes, bounds, voice cap, WAV header/size (mono + stereo),
  pending/commit, hard-pan channel energy, master volume/normalize,
  echo tail repeats, listener pan + attenuation on a real
  dropped-sphere impact, and silence at rest.
- `./build_native.sh --test` runs it with the rest of the suite.
