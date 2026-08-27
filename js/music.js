export function createMusicDancer(svg, blob) {
  let actx = null;
  let analyser = null;
  let source = null;
  let dataArray = null;
  let raf = null;
  let dancing = false;
  let lastBeat = 0;
  let beatInterval = 500;
  let energy = 0;
  let smoothEnergy = 0;

  function init() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  async function startFromMic() {
    init();
    if (actx.state === 'suspended') await actx.resume();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      source = actx.createMediaStreamSource(stream);
      source.connect(analyser);
      dancing = true;
      loop();
      return true;
    } catch { return false; }
  }

  function startFromElement(el) {
    init();
    if (actx.state === 'suspended') actx.resume();
    if (!source) {
      source = actx.createMediaElementSource(el);
      source.connect(analyser);
      analyser.connect(actx.destination);
    }
    dancing = true;
    loop();
  }

  function stop() {
    dancing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    svg.style.transform = '';
    svg.style.transition = 'transform 0.3s ease-out';
    setTimeout(() => { svg.style.transition = ''; }, 350);
  }

  function loop() {
    if (!dancing) return;
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    energy = sum / dataArray.length / 255;
    smoothEnergy = smoothEnergy * 0.7 + energy * 0.3;

    const bass = avgRange(dataArray, 0, 4);
    const mid = avgRange(dataArray, 4, 20);
    const high = avgRange(dataArray, 20, 60);
    const now = performance.now();

    const dynamicThreshold = 0.15 + smoothEnergy * 0.25;
    if (bass > dynamicThreshold && now - lastBeat > 200) {
      const timeSinceLastBeat = now - lastBeat;
      if (lastBeat > 0) {
        beatInterval = beatInterval * 0.8 + timeSinceLastBeat * 0.2;
      }
      lastBeat = now;
      onBeat(bass, mid, high);
    }

    const tiltX = Math.sin(now * 0.001 * (1 + mid * 3)) * (3 + smoothEnergy * 12);
    const tiltY = Math.cos(now * 0.0013 * (1 + bass * 2)) * (2 + smoothEnergy * 8);
    const bounce = Math.sin(now * 0.004 * (1 + bass * 2)) * (1 + bass * 6);
    const scaleX = 1 + Math.sin(now * 0.003) * smoothEnergy * 0.08;
    const scaleY = 1 + Math.cos(now * 0.003) * smoothEnergy * 0.08;
    const rot = Math.sin(now * 0.002) * smoothEnergy * 5;

    svg.style.transform = `translate(${tiltX.toFixed(1)}px, ${(tiltY + bounce).toFixed(1)}px) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;
    svg.style.transition = 'none';

    raf = requestAnimationFrame(loop);
  }

  function onBeat(bass, mid, high) {
    const scale = 1.08 + bass * 0.15;
    svg.style.filter = `drop-shadow(0 0 ${8 + bass * 20}px rgba(124,92,255,${0.3 + bass * 0.5})) brightness(${1 + bass * 0.3})`;
    setTimeout(() => { svg.style.filter = ''; }, 150);

    if (bass > 0.4) {
      blob.poke();
    }
  }

  function avgRange(arr, from, to) {
    let s = 0;
    for (let i = from; i < Math.min(to, arr.length); i++) s += arr[i];
    return (s / (to - from)) / 255;
  }

  function isDancing() { return dancing; }

  return { startFromMic, startFromElement, stop, isDancing };
}
