// WAV export for the sound module's PCM buffer: serialize the mono f32
// samples as a 16-bit PCM RIFF/WAVE file. Split from sound.goose so the
// synthesizer stays linkable where `os` file output is not wanted; import
// g3.sound_wav alongside g3.sound.
//
//   sound_write_wav("impact.wav")   // writes g_sound_pcm
//   var bytes: u8[>..] = [];
//   sound_wav_bytes(bytes);         // same bytes, for your own sink

import os;
import g3.sound;

namespace g3;

fn sound_wav_u16(out: u8[>..]&, v: u16) {
    out.push((v & 0xff) as u8);
    out.push((v >> 8) as u8);
}

fn sound_wav_u32(out: u8[>..]&, v: u32) {
    out.push((v & 0xff) as u8);
    out.push((v >> 8) as u8);
    out.push((v >> 16) as u8);
    out.push((v >> 24) as u8);
}

fn sound_wav_tag(out: u8[>..]&, tag: const u8[:]) {
    for i in 0..tag.len { out.push(tag[i]); }
}

// Append a complete WAV file image for the current PCM buffer: 44-byte
// canonical header, mono, 16-bit samples, little-endian.
fn sound_wav_bytes(out: u8[>..]&) {
    let n = g_sound_pcm.len;
    let data_bytes = n * 2;
    sound_wav_tag(out, "RIFF");
    sound_wav_u32(out, (36 + data_bytes) as u32);
    sound_wav_tag(out, "WAVE");
    sound_wav_tag(out, "fmt ");
    sound_wav_u32(out, 16);
    sound_wav_u16(out, 1);                        // PCM
    sound_wav_u16(out, 1);                        // mono
    sound_wav_u32(out, g_sound_rate as u32);
    sound_wav_u32(out, (g_sound_rate as u32) * 2); // byte rate
    sound_wav_u16(out, 2);                        // block align
    sound_wav_u16(out, 16);                       // bits per sample
    sound_wav_tag(out, "data");
    sound_wav_u32(out, data_bytes as u32);
    for i in 0..n {
        let s = clamp(g_sound_pcm[i], -1.0, 1.0);
        sound_wav_u16(out, ((s * 32767.0 + 32768.0) as i64) as u16);
    }
}

// Write the current PCM buffer to `path` as a WAV file. Returns false when
// the file cannot be written; the reason is not distinguished, matching
// os::write_file.
fn sound_write_wav(path: const u8[:]) -> bool {
    var bytes: u8[>..] = [];
    sound_wav_bytes(bytes);
    return write_file(path, bytes[..]);
}
