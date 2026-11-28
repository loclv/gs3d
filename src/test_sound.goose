// The sound module's unit test: envelopes and PCM bounds, voice exhaustion,
// WAV bytes, and the physics-contact bridge — all hand-checkable numbers,
// no backend and no device.
//
//   goose build -o build/test_sound src/test_sound.goose && ./build/test_sound
//   ./build_native.sh --test                                builds and runs it
//
// Like test_math, this root never reaches a g3p_* platform call: scene
// nodes and physics bodies are pure arena state, so no surface is linked.

import std;
import vec;
import math;
import os;
import g3.math;
import g3.scene;
import g3.mesh;
import g3.physics;
import g3.sound;
import g3.sound_wav;
import testing;

fn peak(pcm: f32[:]) -> f32 {
    var m: f32 = 0.0;
    for i in 0..pcm.len {
        let a = abs(pcm[i]);
        if a > m { m = a; }
    }
    return m;
}

fn main() {
    // --- config and buffer basics -------------------------------------
    g3::sound_init(8000.0);
    testing::check(g3::sound_rate() == 8000.0, "sound_init sets the rate");
    g3::sound_init(1.0);
    testing::check(g3::sound_rate() == 8000.0, "out-of-range rate is ignored");
    g3::sound_clear();
    testing::check(g3::sound_len() == 0 && g3::sound_seconds() == 0.0, "clear empties the buffer");

    // --- tone: length, bounds, envelope -------------------------------
    g3::sound_clear();
    testing::check(g3::sound_tone(440.0, 0.05, 0.5), "tone spawns");
    g3::sound_render(0.05);
    testing::check(g3::sound_len() == 400, "render appends rate*dt samples");
    let pcm = g3::sound_pcm();
    testing::check(pcm.len == 400 && peak(pcm) > 0.1 && peak(pcm) <= 1.0,
                   "tone stays in [-1,1] and is audible");
    testing::check(abs(pcm[0]) < 0.01, "attack ramp starts near zero");
    testing::check(abs(pcm[399]) < abs(pcm[100]), "envelope decays");

    // --- impact and noise ----------------------------------------------
    g3::sound_clear();
    testing::check(g3::sound_impact(0.8, 1.0), "impact spawns voices");
    testing::check(!g3::sound_impact(0.0), "zero-strength impact is silent");
    g3::sound_render(0.30);
    testing::check(g3::sound_len() == 2400 && peak(g3::sound_pcm()) > 0.2,
                   "impact renders a body and a click");
    g3::sound_clear();
    testing::check(g3::sound_noise(0.02, 0.4, 0.5), "noise spawns");
    g3::sound_render(0.02);
    testing::check(g3::sound_len() == 160 && peak(g3::sound_pcm()) <= 1.0,
                   "noise renders in range");

    // --- generic play and voice exhaustion ------------------------------
    g3::sound_clear();
    var spawned: i64 = 0;
    for i in g3::SOUND_MAX_VOICES + 8 {
        if g3::sound_play(g3::SOUND_KIND_TONE, 220.0, 0.0, 10.0, 0.5) { spawned += 1; }
    }
    testing::check(spawned == g3::SOUND_MAX_VOICES, "voice table caps at SOUND_MAX_VOICES");
    testing::check(!g3::sound_tone(440.0, 0.01, 0.5), "full table rejects new voices");
    g3::sound_clear();

    // --- WAV export ------------------------------------------------------
    g3::sound_clear();
    g3::sound_init(8000.0);
    g3::sound_tone(440.0, 0.01, 0.5);
    g3::sound_render(0.01);
    let n = g3::sound_len();
    testing::check(g3::sound_write_wav("build/test_sound.wav"), "wav writes");
    var bytes: u8[>..] = [];
    g3::sound_wav_bytes(bytes);
    testing::check(bytes.len == 44 + n * 2, "wav size is header plus PCM16");
    testing::check(bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F' &&
                   bytes[8] == 'W' && bytes[9] == 'A' && bytes[10] == 'V' && bytes[11] == 'E',
                   "wav starts with a RIFF/WAVE tag");
    var on_disk: u8[>..] = [];
    testing::check(read_file("build/test_sound.wav", on_disk) && on_disk.len == bytes.len,
                   "wav on disk matches the byte builder");

    // --- streaming view: pending / commit / peak ------------------------
    g3::sound_clear();
    g3::sound_tone(440.0, 0.01, 0.5);
    g3::sound_render(0.01);
    testing::check(g3::sound_pending_len() == g3::sound_len(), "pending covers the buffer");
    testing::check(g3::sound_pending_peak() > 0.0, "pending peak meters the signal");
    g3::sound_commit();
    testing::check(g3::sound_pending_len() == 0, "commit consumes the pending region");
    g3::sound_render(0.005);
    testing::check(g3::sound_pending_len() == 40, "pending regrows after commit");
    var pbytes: u8[>..] = [];
    g3::sound_wav_pending_bytes(pbytes);
    testing::check(pbytes.len == 44 + 40 * 2, "pending wav covers only new samples");

    // --- stereo and panning ------------------------------------------------
    g3::sound_init(8000.0, 2);
    testing::check(g3::sound_channels() == 2, "stereo init selects two channels");
    g3::sound_tone(440.0, 0.01, 0.5, 0.0, 1.0);
    g3::sound_render(0.01);
    testing::check(g3::sound_len() == 160, "stereo render writes interleaved L/R");
    let spcm = g3::sound_pcm();
    var el: f32 = 0.0;
    var er: f32 = 0.0;
    for i in 0..spcm.len / 2 {
        el += abs(spcm[i * 2]);
        er += abs(spcm[i * 2 + 1]);
    }
    testing::check(er > 0.0 && el == 0.0, "pan=+1 puts all energy on the right");
    var sb: u8[>..] = [];
    g3::sound_wav_pending_bytes(sb);
    testing::check(sb.len == 44 + 160 * 2, "stereo wav size is header plus PCM16");
    testing::check(sb[22] == 2 && sb[23] == 0, "wav header says two channels");
    testing::check(sb[32] == 4 && sb[33] == 0, "wav block align is 4 bytes");
    g3::sound_init(8000.0);
    testing::check(g3::sound_channels() == 1, "re-init returns to mono");

    // --- physics bridge --------------------------------------------------
    // Static floor box, dynamic sphere dropped onto it. The first contact
    // step has real closing speed; once the sphere rests, contacts stay
    // silent.
    g3::physics_clear();
    let mesh = g3::mesh_cube(0.5);
    let floor_node = g3::node_add(mesh);
    g3::node(floor_node).pos = float3 { 0.0, -0.5, 0.0 };
    g3::physics_body_add(floor_node, float3 { 10.0, 0.5, 10.0 }, 0.0);
    let ball_node = g3::node_add(mesh);
    g3::node(ball_node).pos = float3 { 0.0, 2.0, 0.0 };
    g3::physics_body_add_sphere(ball_node, 0.5, 1.0);
    // Stereo + a listener off to the contact's left: the impact should pan
    // right (positive pan -> right channel).
    g3::sound_init(8000.0, 2);
    g3::sound_set_listener(float3 { -3.0, 0.5, -3.0 }, float3 { 0.0, 0.0, 1.0 });
    g3::sound_clear();
    var emitted: i64 = 0;
    var landed = false;
    for step in 240 {
        g3::physics_step(1.0 / 60.0);
        emitted += g3::sound_contacts(1.0, 0.5);
        if g3::physics_contact_count() > 0 { landed = true; }
        g3::sound_render(1.0 / 60.0);
        if landed && g3::node(ball_node).pos.y < 1.0 { break; }
    }
    testing::check(landed, "sphere lands on the floor");
    testing::check(emitted >= 1, "impact contact emits a sound event");
    testing::check(g3::sound_len() > 0 && peak(g3::sound_pcm()) > 0.0,
                   "physics-driven render produced audible PCM");
    var el2: f32 = 0.0;
    var er2: f32 = 0.0;
    let pall = g3::sound_pcm();
    for i in 0..pall.len / 2 {
        el2 += abs(pall[i * 2]);
        er2 += abs(pall[i * 2 + 1]);
    }
    testing::check(er2 > el2, "listener pans the impact toward its side");
    g3::sound_clear_listener();
    // A settled scene must not keep firing: drain contacts while resting.
    var rest_hits: i64 = 0;
    for step in 60 {
        g3::physics_step(1.0 / 60.0);
        rest_hits += g3::sound_contacts(1.0, 0.5);
    }
    testing::check(rest_hits == 0, "resting contacts stay silent");

    if !testing::finish() { exit(1); }
}
