/**
 * Web Audio API procedural sound synthesizer for Teen Patti
 * Produces crisp casino sound effects without external audio files
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.kissAudio = null;
    this.initAudioAssets();
  }

  initAudioAssets() {
    try {
      this.kissAudio = new Audio('/audio/kiss_muah.wav');
      this.kissAudio.preload = 'auto';
    } catch (e) {}
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  // Chip click / betting sound
  playChip() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.09);

    // Second faint click for chip stacking effect
    setTimeout(() => {
      if (!this.enabled || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(2400, t);
      osc2.frequency.exponentialRampToValueAtTime(800, t + 0.05);
      gain2.gain.setValueAtTime(0.2, t);
      gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(t);
      osc2.stop(t + 0.06);
    }, 40);
  }

  // Card deal sliding whoosh
  playDeal() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // White noise burst filtered
    const bufferSize = this.ctx.sampleRate * 0.12;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.12);
    filter.Q.setValueAtTime(3, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(now);
  }

  // Turn chime - gently alerts player it is their turn
  playTurn() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = [523.25, 659.25]; // C5, E5
    notes.forEach((freq, i) => {
      const start = this.ctx.currentTime + i * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + 0.36);
    });
  }

  // Fold sound (subtle thud)
  playFold() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(250, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.16);
  }

  // Sideshow Challenge Alert (dramatic brass chime + sword whoosh)
  playSideshowPrompt() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // Urgent attention chord: D5, F#5, A5, D6
    const freqs = [587.33, 739.99, 880.00, 1174.66];
    freqs.forEach((freq, idx) => {
      const start = now + idx * 0.08;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + 0.45);
    });

    // Metallic shimmer
    setTimeout(() => this.playSwordClash(), 260);
  }

  // Metallic sword clash effect
  playSwordClash() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Fast frequency drop + noise burst
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(3200, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.18);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  }

  // Accept comparison positive double-chime
  playAccept() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [659.25, 1046.50].forEach((freq, i) => {
      const start = now + i * 0.08;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.28);
    });
  }

  // Win fanfare / jackpot chime
  playWin() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const melody = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    melody.forEach((freq, idx) => {
      const start = this.ctx.currentTime + idx * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.35, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + 0.5);
    });
  }

  // Proper "MUAAAH" Kiss sound: authentic vocal lip-smack + suction release + breathy "waaah" sigh
  // Strictly NO coin chimes or metallic bells!
  playKiss() {
    if (!this.enabled) return;

    // 1. Primary: High-fidelity authentic "MUAAAH" audio recording
    if (this.kissAudio) {
      try {
        const sound = this.kissAudio.cloneNode();
        sound.volume = 0.95;
        const playPromise = sound.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            this.playProceduralMwahKiss();
          });
          return;
        }
      } catch (e) {}
    }

    // 2. Fallback: Procedural acoustic human "MWAH" synthesis
    this.playProceduralMwahKiss();
  }

  playProceduralMwahKiss() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. "Mmm" Pre-kiss murmur (humming nasal resonance ~230Hz)
    const oscMmm = this.ctx.createOscillator();
    const gainMmm = this.ctx.createGain();
    const filterMmm = this.ctx.createBiquadFilter();

    oscMmm.type = 'triangle';
    oscMmm.frequency.setValueAtTime(220, now);
    oscMmm.frequency.linearRampToValueAtTime(270, now + 0.08);

    filterMmm.type = 'lowpass';
    filterMmm.frequency.setValueAtTime(450, now);

    gainMmm.gain.setValueAtTime(0.001, now);
    gainMmm.gain.linearRampToValueAtTime(0.32, now + 0.06);
    gainMmm.gain.exponentialRampToValueAtTime(0.01, now + 0.09);

    oscMmm.connect(filterMmm);
    filterMmm.connect(gainMmm);
    gainMmm.connect(this.ctx.destination);
    oscMmm.start(now);
    oscMmm.stop(now + 0.095);

    // 2. The Wet Lip Smack / Suction Release (The "Pop")
    const popStart = now + 0.065;
    const oscPop = this.ctx.createOscillator();
    const gainPop = this.ctx.createGain();

    oscPop.type = 'sine';
    oscPop.frequency.setValueAtTime(450, popStart);
    oscPop.frequency.exponentialRampToValueAtTime(1200, popStart + 0.025);
    oscPop.frequency.exponentialRampToValueAtTime(220, popStart + 0.065);

    gainPop.gain.setValueAtTime(0.01, popStart);
    gainPop.gain.linearRampToValueAtTime(0.65, popStart + 0.015);
    gainPop.gain.exponentialRampToValueAtTime(0.001, popStart + 0.07);

    oscPop.connect(gainPop);
    gainPop.connect(this.ctx.destination);
    oscPop.start(popStart);
    oscPop.stop(popStart + 0.075);

    // Filtered noise burst for the lip suction texture
    try {
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
      }
      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = noiseBuffer;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1600, popStart);
      noiseFilter.Q.setValueAtTime(3.0, popStart);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.01, popStart);
      noiseGain.gain.linearRampToValueAtTime(0.45, popStart + 0.01);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, popStart + 0.07);

      noiseNode.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      noiseNode.start(popStart);
      noiseNode.stop(popStart + 0.08);
    } catch (e) {}

    // 3. "WAAAH" Vocalized Sigh Formant (The open mouth sigh release)
    const sighStart = now + 0.085;
    const oscSigh = this.ctx.createOscillator();
    const gainSigh = this.ctx.createGain();
    const filterSigh = this.ctx.createBiquadFilter();

    oscSigh.type = 'sawtooth';
    oscSigh.frequency.setValueAtTime(270, sighStart);
    oscSigh.frequency.exponentialRampToValueAtTime(205, sighStart + 0.34);

    filterSigh.type = 'bandpass';
    filterSigh.frequency.setValueAtTime(450, sighStart);
    filterSigh.frequency.linearRampToValueAtTime(800, sighStart + 0.12);
    filterSigh.frequency.linearRampToValueAtTime(600, sighStart + 0.34);
    filterSigh.Q.setValueAtTime(2.2, sighStart);

    gainSigh.gain.setValueAtTime(0.01, sighStart);
    gainSigh.gain.linearRampToValueAtTime(0.4, sighStart + 0.05);
    gainSigh.gain.exponentialRampToValueAtTime(0.001, sighStart + 0.36);

    oscSigh.connect(filterSigh);
    filterSigh.connect(gainSigh);
    gainSigh.connect(this.ctx.destination);
    oscSigh.start(sighStart);
    oscSigh.stop(sighStart + 0.38);
  }
}

window.sound = new SoundEngine();

