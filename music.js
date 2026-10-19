// Original background music, synthesized live with Web Audio (no audio files).
// Three songs: a chill lobby groove, an upbeat battle theme and a faster sudden-death track.
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = n => { const m = /^([A-G])(#?)(\d)$/.exec(n); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] ? 1 : 0); };
const bar = s => s.trim().split(/\s+/);   // 16 tokens: note, '.' rest, '-' hold
const CH = {
  Am: [57, [0, 3, 7]], F: [53, [0, 4, 7]], C: [48, [0, 4, 7]], G: [55, [0, 4, 7]], E: [52, [0, 4, 7]],
  Fmaj7: [53, [0, 4, 7, 11]], Em7: [52, [0, 3, 7, 10]], Dm7: [50, [0, 3, 7, 10]], Cmaj7: [48, [0, 4, 7, 11]], Dm: [50, [0, 3, 7]],
};

const SONGS = {
  lobby: {
    bpm: 100, swing: 0.12, lead: 'triangle', leadVol: 0.07, pad: true,
    chords: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7', 'Fmaj7', 'Em7', 'Dm7', 'Cmaj7'],
    bass: '1.......5...8...', kick: 'x.......x.....x.', snare: '....x.......x...', hat: '..x...x...x...x.', drumVol: 0.5,
    mel: [
      'A5 - - . G5 . E5 - - - . . C5 - D5 .', 'E5 - - . D5 . B4 - - - . . G4 - - .', 'F5 - - . E5 . D5 - - - . . A4 - C5 .', 'E5 - - - - - . . G5 - - - E5 - - .',
      'C6 - - . A5 . G5 - E5 - . . G5 - A5 .', 'B5 - - . G5 . E5 - D5 - . . B4 - - .', 'A5 - - . F5 . D5 - C5 - . . D5 - E5 .', 'C5 - - - - - - - . . . . . . . .',
    ].map(bar),
  },
  battle: {
    bpm: 132, swing: 0, lead: 'square', leadVol: 0.055, pad: false,
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E'],
    bass: '1.1.5.1.1.1.5.8.', kick: 'x...x...x...x...', snare: '....x.......x..x', hat: '..x...x...x...xx', drumVol: 0.8,
    mel: [
      'A4 . C5 . E5 . D5 C5 A4 - - - G4 A4 . .', 'F4 . A4 . C5 . A4 . C5 - D5 - C5 - A4 .', 'G4 . C5 . E5 . G5 . E5 - D5 - C5 - . .', 'D5 . B4 . G4 . B4 . D5 - - - E5 - D5 .',
      'E5 . E5 . D5 . C5 . D5 - E5 - A4 - . .', 'F5 . E5 . D5 . C5 . A4 - C5 - D5 - . .', 'E5 . G5 . E5 . D5 . C5 - D5 - E5 - G5 .', 'G#5 - - - E5 - - - B4 - - - G#4 - - -',
    ].map(bar),
  },
  intense: {
    bpm: 152, swing: 0, lead: 'sawtooth', leadVol: 0.035, pad: false, arp: true,
    chords: ['Am', 'Am', 'F', 'E', 'Am', 'Am', 'Dm', 'E'],
    bass: '1111111111111111', kick: 'x...x...x...x...', snare: '....x.......x.xx', hat: 'xxxxxxxxxxxxxxxx', drumVol: 0.85,
    mel: [
      'A5 - - - . . . . . . . . . . . .', '. . . . . . . . C6 - B5 - A5 - G5 -', 'A5 - - - . . . . . . . . . . . .', 'G#5 - - - B5 - - - E6 - - - . . . .',
      'A5 - - - . . . . . . . . . . . .', '. . . . . . . . C6 - B5 - A5 - G5 -', 'F5 - - - A5 - - - D6 - - - . . . .', 'E6 - - - - - - - . . . . . . . .',
    ].map(bar),
  },
};

export function createMusic(ac, out) {
  const bus = ac.createGain(); bus.connect(out);
  const delay = ac.createDelay(), fb = ac.createGain(), wet = ac.createGain();   // simple echo for lead + pads
  delay.delayTime.value = 0.28; fb.gain.value = 0.28; wet.gain.value = 0.22;
  delay.connect(fb).connect(delay); delay.connect(wet).connect(bus);
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const freq = m => 440 * 2 ** ((m - 69) / 12);

  function tone(m, t, dur, type, vol, cutoff = 2500, attack = 0.005, echo = false) {
    const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = type; o.frequency.value = freq(m); lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.7)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(bus); if (echo) g.connect(delay);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function hit(t, vol, type, f, decay) {   // noise-based drums
    const s = ac.createBufferSource(), g = ac.createGain(), fl = ac.createBiquadFilter();
    s.buffer = noise; fl.type = type; fl.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(fl).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + decay + 0.02);
  }
  function kick(t, vol) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.25);
  }

  let song = null, step = 0, nextT = 0;
  function scheduleStep(i, t) {
    const sp = 60 / song.bpm / 4, b = Math.floor(i / 16), s = i % 16, [root, tones] = CH[song.chords[b % song.chords.length]];
    if (s % 2) t += sp * song.swing;
    const dv = song.drumVol;
    if (song.kick[s] === 'x') kick(t, 0.55 * dv);
    if (song.snare[s] === 'x') { hit(t, 0.28 * dv, 'bandpass', 1800, 0.14); tone(50, t, 0.06, 'triangle', 0.08 * dv); }
    if (song.hat[s] === 'x') hit(t, 0.07 * dv, 'highpass', 7500, 0.035);
    const bn = song.bass[s];
    if (bn !== '.') tone(root - 12 + { 1: 0, 3: tones[1], 5: 7, 8: 12 }[bn], t, sp * 1.7, 'triangle', 0.16, 900);
    if (song.pad && s === 0) for (const k of tones) tone(root + 12 + k, t, sp * 16, 'sawtooth', 0.018, 1100, 0.35, true);
    if (song.arp) tone(root + 24 + tones[s % tones.length] + (s % 8 >= 4 ? 12 : 0), t, sp * 0.9, 'square', 0.022, 2200);
    const tok = song.mel[b % song.mel.length][s];
    if (tok !== '.' && tok !== '-') {
      let len = 1; while (s + len < 16 && song.mel[b % song.mel.length][s + len] === '-') len++;
      tone(midi(tok), t, sp * len * 0.95, song.lead, song.leadVol, 3200, 0.01, true);
    }
  }
  setInterval(() => {
    if (!song || ac.state !== 'running') return;
    const sp = 60 / song.bpm / 4;
    if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05;
    while (nextT < ac.currentTime + 0.15) { scheduleStep(step, nextT); step = (step + 1) % (song.mel.length * 16); nextT += sp; }
  }, 25);

  return {
    volume: bus.gain,
    play(name) { if (song === SONGS[name]) return; song = SONGS[name] || null; step = 0; nextT = ac.currentTime + 0.1; },
  };
}
