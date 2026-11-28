// Procedural sound for the engine: a small PCM synthesizer that turns
// gameplay events — physics impacts above all — into samples.
//
// The module is event-driven and offline. Callers spawn voices with
// sound_impact / sound_tone / sound_noise (or the generic sound_play), then
// advance the mixer once per frame with sound_render(dt). Every render call
// appends `dt * rate` frames of f32 PCM to an internal grow-only buffer —
// mono by default, or interleaved stereo when sound_init selects two
// channels. Voices carry a `pan` (-1 left .. +1 right); sound_set_listener
// gives sound_contacts a world position and right vector so impacts pan by
// where they happen. Read samples back with sound_pcm() or write a
// RIFF/WAVE file with the helpers in g3.sound_wav (sound_write_wav).
// Nothing here touches a device, a window or the platform seam, so it links
// into headless builds unchanged.
//
// Three voice kinds share one envelope shape (short attack, exponential
// decay) and differ in what they oscillate:
//
//   kind 0  thump   — sine swept linearly from freq to freq_end; the
//                     collision body. sound_impact spawns one of these plus
//                     a short noise click.
//   kind 1  tone    — sine swept the same way; UI bleeps, beeps, hums.
//   kind 2  noise   — white noise through a one-pole lowpass whose mix
//                     amount is `cutoff`; impacts, surf, wind.
//
// sound_contacts() is the thin bridge to g3.physics: call it after
// physics_step and it turns qualifying contact records into impact events.
// The contact normal convention matches the solver — closing speed is
// -dot(v_b - v_a, normal), positive while the pair approaches — so resting
// and sleeping contacts (closing speed ~ 0) stay silent, and only real
// approach speed above `min_speed` makes a sound.

import std;
import vec;
import math;
import g3.physics;

namespace g3;

// Concurrent voices. Events beyond this are dropped, like the stdlib
// audio mixer's MAX_VOICES; raise it if a scene stacks many impacts.
const SOUND_MAX_VOICES = 64;

// Voice kinds, also the `kind` argument of sound_play.
const SOUND_KIND_THUMP = 0;
const SOUND_KIND_TONE = 1;
const SOUND_KIND_NOISE = 2;

struct SoundVoice {
    active: bool = false,
    kind: i32 = 0,
    freq: f32 = 0.0,
    freq_end: f32 = 0.0,
    amp: f32 = 0.0,
    dur: f32 = 0.1,
    age: f32 = 0.0,
    phase: f32 = 0.0,       // cycles; wrapped to [0,1)
    seed: u32 = 1,          // noise LFSR state
    lpf: f32 = 0.0,         // noise one-pole lowpass state
    cutoff: f32 = 0.25,     // noise lowpass mix amount, (0,1]
    pan: f32 = 0.0,         // -1 left .. +1 right; ignored in mono
}

var g_sound_rate: f64 = 48000.0;
var g_sound_channels: i64 = 1;
var g_sound_pcm: f32[>..];
var g_sound_mark: i64 = 0;
var g_sound_voices: SoundVoice[SOUND_MAX_VOICES];
var g_sound_seed: u32 = 1;

// Listener for spatial panning and distance attenuation in sound_contacts:
// world position and the camera's right vector (need not be normalized —
// it is normalized here). Disabled until sound_set_listener is called.
var g_sound_listener_on: bool = false;
var g_sound_listener_pos: float3 = float3_0;
var g_sound_listener_right: float3 = float3 { 1.0, 0.0, 0.0 };

// World units at which listener attenuation reaches its floor.
const SOUND_LISTENER_RANGE = 25.0;
// Gain floor so far-away impacts stay audible rather than vanishing.
const SOUND_LISTENER_MIN_GAIN = 0.05;

// Master volume, applied to the mixed signal before the WAV/PCM clamp.
var g_sound_volume: f32 = 1.0;

// Feedback-delay echo on the master bus: one interleaved ring holding
// `g_echo_frames * channels` samples. Off until sound_set_echo; cleared
// by sound_clear/sound_init (set it again after re-init).
var g_echo_on: bool = false;
var g_echo_frames: i64 = 0;
var g_echo_pos: i64 = 0;
var g_echo_delay_s: f64 = 0.0;
var g_echo_feedback: f32 = 0.0;
var g_echo_mix: f32 = 0.0;
var g_echo_buf: f32[>..];

// Last step each contact pair emitted a sound, for the cooldown in
// sound_contacts. `step` is physics_stats().steps.
struct SoundContactMark { pkey: i64, step: i64 }
var g_sound_marks: SoundContactMark[>..];

// Steps between repeat sounds for one contact pair — about 0.2 s at 60 Hz.
const SOUND_CONTACT_COOLDOWN = 12;

// Longest echo delay sound_set_echo accepts, seconds.
const SOUND_ECHO_MAX_SECONDS = 0.5;

// Select the output sample rate (8000..192000, the same range the stdlib
// audio mixer accepts) and channel count (1 mono or 2 interleaved stereo),
// then reset the buffer and voices. Out-of-range arguments are ignored.
fn sound_init(sample_rate: f64 = 48000.0, channels: i64 = 1) {
    guard sample_rate >= 8000.0 && sample_rate <= 192000.0 else { return; }
    guard channels == 1 || channels == 2 else { return; }
    g_sound_rate = sample_rate;
    g_sound_channels = channels;
    sound_clear();
}

fn sound_channels() -> i64 { return g_sound_channels; }

// Set the listener sound_contacts pans against: `pos` is the listener's
// world position, `right` its right vector (e.g. the camera's). A contact
// to the listener's right pans right. Call sound_clear_listener to disable.
fn sound_set_listener(pos: float3, right: float3) {
    g_sound_listener_on = true;
    g_sound_listener_pos = pos;
    let len = length(right);
    if len > 0.0001 { g_sound_listener_right = right / len; }
}

fn sound_clear_listener() { g_sound_listener_on = false; }

// Master volume 0..2, applied after panning and echo. 1.0 is unity.
fn sound_set_volume(v: f32) { g_sound_volume = clamp(v, 0.0, 2.0); }
fn sound_volume() -> f32 { return g_sound_volume; }

// Feedback-delay echo across the whole mix: `delay_s` seconds (up to
// SOUND_ECHO_MAX_SECONDS), `feedback` 0..0.95 repeat decay, `wet` 0..1
// echo level added on top of the dry signal. Returns false on bad
// arguments. Call after sound_init — sound_clear disables the effect.
fn sound_set_echo(delay_s: f64, feedback: f32, wet: f32) -> bool {
    guard delay_s > 0.001 && delay_s <= SOUND_ECHO_MAX_SECONDS else { return false; }
    guard feedback >= 0.0 && feedback < 1.0 && wet >= 0.0 && wet <= 1.0 else { return false; }
    var frames = (delay_s * g_sound_rate + 0.5) as i64;
    if frames < 1 { frames = 1; }
    g_echo_buf.clear();
    for i in 0..frames * g_sound_channels { g_echo_buf.push(0.0); }
    g_echo_frames = frames;
    g_echo_pos = 0;
    g_echo_delay_s = delay_s;
    g_echo_feedback = feedback;
    g_echo_mix = wet;
    g_echo_on = true;
    return true;
}

fn sound_clear_echo() {
    g_echo_on = false;
    g_echo_frames = 0;
    g_echo_pos = 0;
    g_echo_buf.clear();
}

fn sound_echo_active() -> bool { return g_echo_on; }

// Drop every voice and discard the rendered PCM.
fn sound_clear() {
    g_sound_pcm.clear();
    g_sound_mark = 0;
    g_sound_marks.clear();
    sound_clear_echo();
    for i in SOUND_MAX_VOICES {
        g_sound_voices[i] = SoundVoice { .. };
    }
}

fn sound_rate() -> f64 { return g_sound_rate; }

// Mono samples rendered so far.
fn sound_len() -> i64 { return g_sound_pcm.len; }

fn sound_seconds() -> f64 { return g_sound_pcm.len / g_sound_rate; }

// The rendered mono PCM as a slice. The arena never moves, so the view
// stays valid while the buffer grows.
fn sound_pcm() -> f32[:] { return g_sound_pcm[..]; }

// Samples rendered since the last sound_commit — the streaming view. Pair
// with sound_commit to consume the buffer incrementally (chunked WAV,
// feeding a playback queue) instead of keeping every sample forever.
fn sound_pending() -> f32[:] { return g_sound_pcm[g_sound_mark..]; }

fn sound_pending_len() -> i64 { return g_sound_pcm.len - g_sound_mark; }

// Discard the pending prefix: everything before it is considered consumed.
fn sound_commit() { g_sound_mark = g_sound_pcm.len; }

// Largest |sample| in the pending region, for level meters and
// normalisation. 0.0 when nothing is pending.
fn sound_pending_peak() -> f32 {
    var m: f32 = 0.0;
    for i in g_sound_mark..g_sound_pcm.len {
        let a = abs(g_sound_pcm[i]);
        if a > m { m = a; }
    }
    return m;
}

// Scale the pending region so its peak becomes `target` (clamped to
// [0,1]). Boosting can push samples past [-1,1] — the mix already clipped
// at render, so this is a gain on stored audio, not a limiter. No-op on
// silence.
fn sound_normalize(target: f32) {
    let p = sound_pending_peak();
    guard p > 0.0001 else { return; }
    let g = clamp(target, 0.0, 1.0) / p;
    for i in g_sound_mark..g_sound_pcm.len {
        g_sound_pcm[i] *= g;
    }
}

// Attack-ramp then exponential-decay envelope, 1.0 at the attack's end.
fn sound_envelope(age: f32, dur: f32, attack: f32, decay: f32) -> f32 {
    var e = exp(-decay * age / dur);
    if age < attack { e *= age / attack; }
    return e;
}

// Claim a free voice slot, or -1 when all SOUND_MAX_VOICES are active.
fn sound_voice_slot() -> i64 {
    for i in SOUND_MAX_VOICES {
        if !g_sound_voices[i].active { return i; }
    }
    return -1;
}

// Start a voice. freq_end <= 0 holds the pitch at freq. Returns false when
// the voice table is full or the arguments cannot make a sound.
fn sound_spawn(kind: i32, freq: f32, freq_end: f32, dur: f32, amp: f32, cutoff: f32, pan: f32) -> bool {
    guard kind >= SOUND_KIND_THUMP && kind <= SOUND_KIND_NOISE else { return false; }
    guard dur > 0.0 && amp > 0.0 else { return false; }
    var fq = freq;
    var fe = freq_end;
    if kind != SOUND_KIND_NOISE {
        guard fq > 0.0 else { return false; }
        if fe <= 0.0 { fe = fq; }
    } else {
        fq = 0.0;
        fe = 0.0;
    }
    let slot = sound_voice_slot();
    if slot < 0 { return false; }
    g_sound_seed = g_sound_seed * 1664525 + 1013904223;
    g_sound_voices[slot] = SoundVoice {
        active: true, kind: kind, freq: fq, freq_end: fe,
        amp: clamp(amp, 0.0, 1.0), dur: dur, age: 0.0, phase: 0.0,
        seed: g_sound_seed | 1, lpf: 0.0, cutoff: cutoff,
        pan: clamp(pan, -1.0, 1.0),
    };
    return true;
}

// Generic escape hatch: kind is SOUND_KIND_*, freq/freq_end in Hz,
// dur in seconds, amp in [0,1], cutoff the noise lowpass amount, pan
// -1..+1 (ignored when the buffer is mono).
fn sound_play(kind: i32, freq: f32, freq_end: f32, dur: f32, amp: f32, cutoff: f32 = 0.25, pan: f32 = 0.0) -> bool {
    return sound_spawn(kind, freq, freq_end, dur, amp, cutoff, pan);
}

// A collision thump: a pitch-swept low sine for the body plus a short noise
// click for the contact. `strength` is clamped to [0,1] and drives loudness
// and length; `pitch` scales both voices (1.0 is a mid knock, higher is a
// smaller/lighter object). Returns false only when every voice is busy.
fn sound_impact(strength: f32, pitch: f32 = 1.0, pan: f32 = 0.0) -> bool {
    let s = clamp(strength, 0.0, 1.0);
    guard s > 0.001 else { return false; }
    // Deterministic per-call jitter so a burst of identical impacts does
    // not sound like one sample repeated.
    g_sound_seed = g_sound_seed * 1664525 + 1013904223;
    let jitter = 0.94 + ((g_sound_seed >> 8) as f32) / 8388608.0 * 0.12;
    let p = clamp(pitch * jitter, 0.25, 4.0);
    var ok = sound_spawn(SOUND_KIND_THUMP, 115.0 * p, 38.0 * p,
                         0.10 + 0.25 * s, 0.85 * s, 0.0, pan);
    // Harder hits click brighter.
    ok = sound_spawn(SOUND_KIND_NOISE, 0.0, 0.0,
                     0.015 + 0.03 * s, 0.6 * s, 0.6 + 0.35 * s, pan) || ok;
    return ok;
}

// A plain enveloped sine, optionally gliding to freq_end (0 keeps freq).
fn sound_tone(freq: f32, dur: f32, amp: f32, freq_end: f32 = 0.0, pan: f32 = 0.0) -> bool {
    return sound_spawn(SOUND_KIND_TONE, freq, freq_end, dur, amp, 0.0, pan);
}

// An enveloped lowpassed noise burst. cutoff is the lowpass mix amount:
// near 1 is bright, near 0 is a low rumble.
fn sound_noise(dur: f32, amp: f32, cutoff: f32 = 0.3, pan: f32 = 0.0) -> bool {
    return sound_spawn(SOUND_KIND_NOISE, 0.0, 0.0, dur, amp, cutoff, pan);
}

// Mix every live voice for `dt` seconds and append the result to the PCM
// buffer — one sample per channel per frame (mono, or interleaved L/R when
// sound_init selected two channels). Call once per frame after spawning
// that frame's events; events spawned between renders all start at the
// next sample boundary.
fn sound_render(dt: f64) {
    guard dt > 0.0 else { return; }
    var frames = (dt * g_sound_rate + 0.5) as i64;
    guard frames > 0 else { return; }
    let inv_rate = (1.0 / g_sound_rate) as f32;
    let step = (1.0 / g_sound_rate) as f32;
    let stereo = g_sound_channels == 2;
    for s in 0..frames {
        var mix: f32 = 0.0;
        var mix_r: f32 = 0.0;
        var v: i64 = 0;
        while v < SOUND_MAX_VOICES {
            if g_sound_voices[v].active {
                let dur = g_sound_voices[v].dur;
                let age = g_sound_voices[v].age;
                if age >= dur {
                    g_sound_voices[v].active = false;
                } else {
                    var sample: f32 = 0.0;
                    if g_sound_voices[v].kind == SOUND_KIND_NOISE {
                        g_sound_voices[v].seed = g_sound_voices[v].seed * 1664525 + 1013904223;
                        let white = ((g_sound_voices[v].seed >> 8) as f32) / 8388608.0 - 1.0;
                        let a = clamp(g_sound_voices[v].cutoff, 0.001, 1.0);
                        g_sound_voices[v].lpf += a * (white - g_sound_voices[v].lpf);
                        sample = g_sound_voices[v].lpf * sound_envelope(age, dur, 0.001, 5.0);
                    } else {
                        let f = g_sound_voices[v].freq +
                            (g_sound_voices[v].freq_end - g_sound_voices[v].freq) * (age / dur);
                        g_sound_voices[v].phase += f * inv_rate;
                        if g_sound_voices[v].phase >= 1.0 { g_sound_voices[v].phase -= 1.0; }
                        let attack = if g_sound_voices[v].kind == SOUND_KIND_THUMP { 0.003 } else { 0.005 };
                        let decay = if g_sound_voices[v].kind == SOUND_KIND_THUMP { 7.0 } else { 3.0 };
                        sample = sin(g_sound_voices[v].phase * TAU) *
                            sound_envelope(age, dur, attack, decay);
                    }
                    let a = sample * g_sound_voices[v].amp;
                    if stereo {
                        // Linear pan law: center is unity on both sides,
                        // hard left/right is silent on the far side.
                        mix += a * (1.0 - max(g_sound_voices[v].pan, 0.0));
                        mix_r += a * (1.0 + min(g_sound_voices[v].pan, 0.0));
                    } else {
                        mix += a;
                    }
                    g_sound_voices[v].age += step;
                }
            }
            v += 1;
        }
        // Master bus: feedback-delay echo, then volume, then the clamp.
        if g_echo_on {
            for ch in 0..g_sound_channels {
                let idx = g_echo_pos * g_sound_channels + ch;
                let delayed = g_echo_buf[idx];
                let dry = if ch == 0 { mix } else { mix_r };
                g_echo_buf[idx] = dry + delayed * g_echo_feedback;
                if ch == 0 { mix += delayed * g_echo_mix; }
                else { mix_r += delayed * g_echo_mix; }
            }
            g_echo_pos += 1;
            if g_echo_pos >= g_echo_frames { g_echo_pos = 0; }
        }
        g_sound_pcm.push(clamp(mix * g_sound_volume, -1.0, 1.0));
        if stereo { g_sound_pcm.push(clamp(mix_r * g_sound_volume, -1.0, 1.0)); }
    }
}

// Bridge to g3.physics: scan this step's contact records and emit an
// impact for each pair whose recorded approach speed exceeds `min_speed`
// m/s. The solver stores that speed on the contact at detection time —
// before its own impulses cancel the velocity — so resting and sleeping
// contacts stay silent even though their records persist. `scale` multiplies
// approach speed into impact strength (m/s is already a reasonable [0,1]
// input). Pitch follows the lighter body's mass — a heavy crate knocks
// lower than a pebble. When a listener is set with sound_set_listener,
// each impact also pans toward the contact point and attenuates linearly
// to SOUND_LISTENER_RANGE (floored at SOUND_LISTENER_MIN_GAIN). A pair
// re-arms after SOUND_CONTACT_COOLDOWN steps,
// so a bounce that keeps reporting does not machine-gun. Call after
// physics_step; events land on the next sound_render either way. Returns
// the number of events emitted.
fn sound_contacts(scale: f32 = 1.0, min_speed: f32 = 0.5) -> i64 {
    var hits: i64 = 0;
    let step = physics_stats().steps;
    // Drop marks that have aged out of the cooldown window.
    var w: i64 = 0;
    for i in 0..g_sound_marks.len {
        if step - g_sound_marks[i].step < SOUND_CONTACT_COOLDOWN {
            if w != i { g_sound_marks[w] = g_sound_marks[i]; }
            w += 1;
        }
    }
    while g_sound_marks.len > w { g_sound_marks.pop(); }
    var i: i64 = 0;
    while i < physics_contact_count() {
        let c = physics_contact(i);
        if c.impact > min_speed {
            var marked = false;
            for m in 0..g_sound_marks.len {
                if g_sound_marks[m].pkey == c.pkey { marked = true; break; }
            }
            if !marked {
                let ma = if physics_body_valid(c.a) { physics_body(c.a).mass } else { 0.0 };
                let mb = if physics_body_valid(c.b) { physics_body(c.b).mass } else { 0.0 };
                var m: f32 = 0.0;
                if ma > 0.0 && mb > 0.0 { m = min(ma, mb); }
                else if ma > 0.0 { m = ma; }
                else if mb > 0.0 { m = mb; }
                var pitch: f32 = 1.0;
                if m > 0.0 { pitch = 1.0 / sqrt(m); }
                pitch = clamp(pitch, 0.4, 2.5);
                // Pan and attenuate by where the contact sits relative to
                // the listener, when one is set: linear falloff to
                // SOUND_LISTENER_RANGE with a floor of
                // SOUND_LISTENER_MIN_GAIN so far impacts stay audible.
                var pan: f32 = 0.0;
                var att: f32 = 1.0;
                if g_sound_listener_on {
                    let to = c.point - g_sound_listener_pos;
                    let d = length(to);
                    if d > 0.0001 {
                        pan = clamp(dot(to / d, g_sound_listener_right), -1.0, 1.0);
                    }
                    att = clamp(1.0 - d / SOUND_LISTENER_RANGE,
                                SOUND_LISTENER_MIN_GAIN, 1.0);
                }
                if sound_impact(c.impact * scale * att, pitch, pan) {
                    hits += 1;
                    g_sound_marks.push(SoundContactMark { pkey: c.pkey, step: step });
                }
            }
        }
        i += 1;
    }
    return hits;
}
