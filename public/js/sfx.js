// TV 효과음 — 파일 없이 Web Audio 로 합성 (뉴스 시그널, 타자 소리)
// 브라우저 정책상 TV 화면을 한 번 클릭(또는 프레젠터 키 입력)한 뒤부터 소리가 납니다.
let ctx = null;
let master = null;
let muted = false;
let noise = null;

export function setMuted(m) {
  muted = m;
}

export function unlockAudio() {
  if (muted) return;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

const ready = () => !muted && ctx && ctx.state === 'running';

function noiseBuffer() {
  if (noise) return noise;
  noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  return noise;
}

function tone(freq, start, dur, { type = 'triangle', gain = 0.3 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + dur + 0.05);
}

// 타자기 한 글자
export function typeClick() {
  if (!ready()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200 + Math.random() * 1600;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.value = 0.55;
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  tone(140 + Math.random() * 30, t, 0.03, { type: 'square', gain: 0.04 });
}

// 속보 시그널 (띠-링-딩)
export function newsSting() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  tone(659.25, t, 0.22, { gain: 0.22 });
  tone(987.77, t + 0.16, 0.22, { gain: 0.22 });
  tone(1318.5, t + 0.32, 0.6, { gain: 0.26 });
  tone(329.63, t + 0.32, 0.7, { type: 'sine', gain: 0.18 });
}

// 스네어 한 번 (두구두구용)
function snare(t, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1100 + Math.random() * 400;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.09);
  tone(170 + Math.random() * 20, t, 0.06, { type: 'sine', gain: gain * 0.6 });
}

// 두구두구 (점점 커지는 드럼롤)
export function drumroll(sec = 1.1) {
  if (!ready()) return;
  const t0 = ctx.currentTime + 0.02;
  const step = 0.048;
  const n = Math.max(4, Math.floor(sec / step));
  for (let i = 0; i < n; i++) snare(t0 + i * step + Math.random() * 0.005, 0.18 + 0.5 * (i / n));
}

// 순위 카드 등장 (쿵!)
export function accent() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01;
  snare(t, 0.9);
  tone(98, t, 0.35, { type: 'sine', gain: 0.45 });
  tone(523.25, t, 0.25, { gain: 0.12 });
}

// 1위 축하 팡파르
export function fanfare() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01;
  snare(t, 1);
  tone(87.31, t, 0.6, { type: 'sine', gain: 0.5 });
  [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.11, 0.25, { gain: 0.2 }));
  [1046.5, 1318.5, 1567.98].forEach((f) => tone(f, t + 0.36, 1.3, { gain: 0.14 }));
  tone(523.25, t + 0.36, 1.3, { type: 'sawtooth', gain: 0.05 });
}

// 타이핑이 끝났을 때 (타자기 종)
export function bell() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(1760, t, 0.5, { type: 'sine', gain: 0.18 });
  tone(2637, t, 0.3, { type: 'sine', gain: 0.06 });
}
