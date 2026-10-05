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

// 타이핑이 끝났을 때 (타자기 종)
export function bell() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(1760, t, 0.5, { type: 'sine', gain: 0.18 });
  tone(2637, t, 0.3, { type: 'sine', gain: 0.06 });
}
