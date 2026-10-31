export class SoundDeck {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: AudioBufferSourceNode | null = null;
  private ambienceGain: GainNode | null = null;
  private muted = false;
  private volume = 0.35;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined" || !("AudioContext" in window)) return null;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  unlock(): void {
    const context = this.ensure();
    if (!context || this.ambience) return;
    const size = context.sampleRate * 2;
    const buffer = context.createBuffer(1, size, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < size; i += 1) channel[i] = (Math.random() * 2 - 1) * 0.17;
    const source = context.createBufferSource();
    source.buffer = buffer; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 440;
    const gain = context.createGain(); gain.gain.value = 0.18;
    source.connect(filter); filter.connect(gain); gain.connect(this.master!); source.start();
    this.ambience = source; this.ambienceGain = gain;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if (this.master && this.context) this.master.gain.setTargetAtTime(value ? 0 : this.volume, this.context.currentTime, 0.04);
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.04);
  }

  get isMuted(): boolean { return this.muted; }
  get currentVolume(): number { return this.volume; }

  dispose(): void {
    try { this.ambience?.stop(); } catch { /* already stopped */ }
    this.ambience = null;
    if (this.context && this.context.state !== "closed") void this.context.close();
    this.context = null; this.master = null; this.ambienceGain = null;
  }

  play(kind: string): void {
    if (this.muted) return;
    const context = this.ensure();
    const master = this.master;
    if (!context || !master) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    if (kind === "explosion" || kind === "hit") {
      const length = Math.floor(context.sampleRate * (kind === "explosion" ? 0.35 : 0.13));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
      const noise = context.createBufferSource(); noise.buffer = buffer;
      const noiseFilter = context.createBiquadFilter(); noiseFilter.type = "lowpass"; noiseFilter.frequency.value = kind === "explosion" ? 680 : 1_200;
      const noiseGain = context.createGain(); noiseGain.gain.setValueAtTime(kind === "explosion" ? 0.28 : 0.13, now); noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (kind === "explosion" ? 0.35 : 0.13));
      noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master); noise.start(now); noise.stop(now + (kind === "explosion" ? 0.36 : 0.14));
    }
    const settings: Record<string, [number, number, number, number]> = {
      cannon: [120, 55, 0.18, 0.8], torpedo: [260, 150, 0.26, 0.58], missile: [380, 120, 0.2, 0.5],
      machinegun: [210, 130, 0.06, 1.1], special: [330, 80, 0.34, 0.55], boost: [150, 310, 0.24, 0.66], victory: [420, 700, 0.38, 0.5]
    };
    const [start, end, duration, peak] = settings[kind] ?? [220, 100, 0.1, 0.35];
    oscillator.type = kind === "cannon" || kind === "explosion" ? "sawtooth" : "triangle";
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
    filter.frequency.value = kind === "cannon" ? 500 : 1500;
    gain.gain.setValueAtTime(Math.min(peak, 0.5), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(filter); filter.connect(gain); gain.connect(master);
    oscillator.start(now); oscillator.stop(now + duration + 0.01);
  }
}
