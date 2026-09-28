/* ---------- sound (synthesized, no files) ---------- */
const sfx = (() => {
  let ac = null, master = null, noiseBuf = null, muted = store('bt-mute') !== '0';   // muted unless the player turned sound on
  function ensure() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  }
  function tone(f, dur, type, vol, f2, delay) {
    if (muted || !ac || document.hidden) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, fq, fq2) {
    if (muted || !ac || document.hidden) return;
    const t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(fq, t); f.frequency.exponentialRampToValueAtTime(fq2 || 80, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
  }
  return {
    ensure,
    isMuted: () => muted,
    setMuted(m) { muted = m; store('bt-mute', m ? '1' : '0'); },
    place() { tone(520, .08, 'square', .1, 260); },
    boom(n) { const v = Math.min(.9, .45 + .08 * n); noise(.6, v, 1800, 60); tone(90, .45, 'sine', v * .8, 35); },
    kick() { tone(170, .1, 'triangle', .3, 70); noise(.08, .2, 900, 200); },
    pickup() { [660, 880, 1320].forEach((f, i) => tone(f, .09, 'square', .09, null, i * .06)); },
    teleport() { tone(300, .35, 'sine', .16, 1400); tone(310, .35, 'triangle', .07, 1500); },
    death() { tone(500, .5, 'sawtooth', .12, 80); },
    beep(hi) { tone(hi ? 880 : 440, .14, 'square', .1); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .18, 'square', .11, null, i * .12)); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, .22, 'triangle', .13, null, i * .15)); },
    pop() { tone(990, .06, 'sine', .08); },
    down() { tone(220, .25, 'square', .12, 110); noise(.15, .2, 700, 150); },
    revive() { [523, 784, 1046, 1568].forEach((f, i) => tone(f, .12, 'triangle', .12, null, i * .05)); }
  };
})();
addEventListener('pointerdown', () => sfx.ensure(), { capture: true });
addEventListener('keydown', () => sfx.ensure(), { capture: true });
const muteBtn = $('muteBtn');
function syncMute() { muteBtn.textContent = sfx.isMuted() ? '🔇' : '🔊'; muteBtn.setAttribute('aria-label', sfx.isMuted() ? 'Bật âm thanh' : 'Tắt âm thanh'); }
muteBtn.onclick = () => { sfx.setMuted(!sfx.isMuted()); syncMute(); };
syncMute();
