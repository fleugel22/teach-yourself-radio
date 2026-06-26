import { useState, useRef, useEffect } from "react";

/* ============================================================
   I/Q PRIMER · FOUNDATIONS  (the groundwork, before Part 1)
   Sampling theorem & aliasing, quantization / bit-depth,
   noise + SNR with a Monte-Carlo BER-vs-SNR curve, and the
   analog quadrature demodulator (LO, 90° split, mixers) with
   DC offset & I/Q imbalance. House rule: real DSP everywhere.
   ============================================================ */

const C = {
  bg: "#0E1419", panel: "#141D25", panelHi: "#1A2530", edge: "#26343F",
  grid: "#22303A", gridFaint: "#18222B", ink: "#ECE7DB", sub: "#8B98A3",
  faint: "#5A6973", I: "#E8B85C", Q: "#56C7BF", sum: "#ECE7DB",
  A: "#B49BE0", B: "#E58AA6", D: "#86D08A", warn: "#E58AA6",
};
const FONT = {
  disp: "'Space Grotesk', system-ui, -apple-system, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => { if (!window.matchMedia) return; const m = window.matchMedia("(prefers-reduced-motion: reduce)"); const h = () => setR(m.matches); h(); m.addEventListener?.("change", h); return () => m.removeEventListener?.("change", h); }, []);
  return r;
}
function fitCanvas(canvas, w, h) {
  const r = window.devicePixelRatio || 1; canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); canvas.style.width = w + "px"; canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d"); ctx.setTransform(r, 0, 0, r, 0, 0); return ctx;
}
let _seed = 90909;
const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const randn = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function erfc(x) { const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return 1 - (x >= 0 ? y : -y); }
const Qf = (x) => 0.5 * erfc(x / Math.SQRT2);
function tone(freq, ms = 750) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(), o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime, end = t + ms / 1000;
    o.type = "sine"; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.setValueAtTime(0.18, end - 0.06); g.gain.linearRampToValueAtTime(0, end);
    o.start(t); o.stop(end + 0.02); o.onended = () => ctx.close();
  } catch (e) {}
}

/* ---------- atoms ---------- */
function Eyebrow({ children }) { return <div style={{ fontFamily: FONT.mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.faint }}>{children}</div>; }
function Panel({ label, children, style }) { return <div style={{ background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 16, ...style }}>{label && <div style={{ marginBottom: 12 }}><Eyebrow>{label}</Eyebrow></div>}{children}</div>; }
function Slider({ label, value, min, max, step, onChange, color = C.ink, fmt }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}><span style={{ fontSize: 13, color: C.sub, fontFamily: FONT.body }}>{label}</span><span style={{ fontFamily: FONT.mono, fontSize: 13, color }}>{fmt ? fmt(value) : value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: "100%", color }} />
    </label>
  );
}
function Pills({ value, options, onChange, color = C.Q, labels }) { return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{options.map((o, i) => <button key={o} onClick={() => onChange(o)} className="iq-mini" data-on={value === o ? "1" : "0"} style={value === o ? { borderColor: color, color } : undefined}>{labels ? labels[i] : o}</button>)}</div>; }
function Readout({ rows }) { return <div style={{ display: "grid", gap: 8 }}>{rows.map(([l, v, c], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.gridFaint}`, paddingBottom: 6 }}><span style={{ fontFamily: FONT.body, fontSize: 12, color: C.sub }}>{l}</span><span style={{ fontFamily: FONT.mono, fontSize: 14, color: c || C.ink }}>{v}</span></div>)}</div>; }
function Lead({ n, title, body, notes }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ maxWidth: 730 }}><div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}><span style={{ fontFamily: FONT.mono, fontSize: 13, color: C.Q }}>{n}</span><h2 style={{ fontFamily: FONT.disp, fontSize: 23, fontWeight: 600, color: C.ink, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2></div><p style={{ fontFamily: FONT.body, fontSize: 14.5, color: C.sub, lineHeight: 1.62, margin: 0 }}>{body}</p></div>
      {notes && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16, maxWidth: 920 }}>{notes.map((nt, i) => <div key={i} style={{ flex: "1 1 200px", minWidth: 175, background: C.panel, border: `1px solid ${C.edge}`, borderLeft: `2px solid ${nt.c}`, borderRadius: 8, padding: "10px 12px" }}><div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: nt.c, marginBottom: 5 }}>{nt.t}</div><div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>{nt.x}</div></div>)}</div>}
    </div>
  );
}
function Deeper({ recap, example }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <button onClick={() => setOpen(!open)} style={{ fontFamily: FONT.mono, fontSize: 11.5, padding: "7px 13px", borderRadius: 6, border: `1px solid ${open ? C.Q : C.edge}`, background: open ? C.panelHi : "transparent", color: open ? C.Q : C.sub, cursor: "pointer" }}>{open ? "▾  hide the deeper dive" : "▸  go deeper — recap & a worked example"}</button>
      {open && <div style={{ marginTop: 12, background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 10, padding: 18, maxWidth: 940 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.Q, marginBottom: 6 }}>So what just happened</div>
        <p style={{ fontFamily: FONT.body, fontSize: 13.5, color: C.sub, lineHeight: 1.62, margin: "0 0 16px" }}>{recap}</p>
        <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.I, marginBottom: 8 }}>Worked example</div>
        <div style={{ fontFamily: FONT.mono, fontSize: 12, color: C.ink, lineHeight: 1.65, background: C.bg, border: `1px solid ${C.gridFaint}`, borderRadius: 8, padding: "12px 14px", whiteSpace: "pre-wrap", overflowX: "auto" }}>{example}</div>
      </div>}
    </div>
  );
}

/* ============================================================
   MODULE 0.1 — THE SAMPLING THEOREM
   ============================================================ */
function SamplingModule() {
  const ref = useRef(null);
  const [f, setF] = useState(3);
  const [fs, setFs] = useState(16);
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight));
    const w = cv.clientWidth, h = cv.clientHeight, midY = h / 2, amp = h * 0.34; ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
    // true signal
    ctx.strokeStyle = C.sub; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.7; ctx.beginPath();
    for (let i = 0; i <= 600; i++) { const t = i / 600, x = t * w, y = midY - Math.cos(2 * Math.PI * f * t) * amp; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.globalAlpha = 1;
    // alias
    const k = Math.round(f / fs), fa = f - k * fs, aliased = Math.abs(fa) < f - 1e-9 || Math.abs(f) > fs / 2 + 1e-9;
    if (aliased) { ctx.strokeStyle = C.warn; ctx.lineWidth = 1.8; ctx.beginPath(); for (let i = 0; i <= 600; i++) { const t = i / 600, x = t * w, y = midY - Math.cos(2 * Math.PI * fa * t) * amp; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
    // samples
    ctx.fillStyle = C.I; for (let n = 0; n <= fs; n++) { const t = n / fs, x = t * w, y = midY - Math.cos(2 * Math.PI * f * t) * amp; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill(); ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(x, midY); ctx.lineTo(x, y); ctx.stroke(); }
    ctx.fillStyle = C.faint; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left"; ctx.fillText("● samples", 6, 14); if (aliased) { ctx.fillStyle = C.warn; ctx.fillText("— alias the samples actually look like", 70, 14); }
  }, [f, fs]);
  const k = Math.round(f / fs), fa = Math.abs(f - k * fs), aliased = f > fs / 2 + 1e-9;
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "The sampling (Nyquist) theorem: to capture a signal without ambiguity, sample faster than twice its highest frequency. That threshold, Fs/2, is the Nyquist frequency." },
          { t: "Intuition", c: C.Q, x: "Too few samples per cycle and a fast sine is indistinguishable from a slow one passing through the same dots — that ghost is an alias. It’s the same folding you met as the spectrum window in Part 1." },
          { t: "Try it", c: C.D, x: "Push the signal frequency past Fs/2 and a red alias appears: a lower-frequency wave that fits every sample. Raise the sample rate to push the Nyquist limit out and banish it." },
        ]}
        n="0.1" title="The sampling theorem"
        body="Everything in this course is sampled data, so start here: how fast must you sample? Sample a sine too slowly and the dots you keep also fit a completely different, lower-frequency sine — an alias you can never undo afterward. Slide the frequency past half the sample rate and watch the ghost appear." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="A sine, its samples, and (if undersampled) its alias">
            <canvas ref={ref} style={{ width: "100%", height: 220, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Grey is the true signal, amber dots are the samples kept. Below Nyquist they pin the signal uniquely; above it, the red alias fits the same dots — the receiver can’t tell which was sent.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Signal & sampling">
            <div style={{ display: "grid", gap: 16 }}>
              <Slider label="Signal frequency" value={f} min={1} max={32} step={0.5} color={C.sub} fmt={(v) => v.toFixed(1) + " Hz"} onChange={setF} />
              <Slider label="Sample rate Fs" value={fs} min={4} max={40} step={1} color={C.I} fmt={(v) => v + " Hz"} onChange={setFs} />
            </div>
          </Panel>
          <Panel label="Status">
            <Readout rows={[["Nyquist frequency Fs/2", (fs / 2).toFixed(1) + " Hz", C.ink], ["signal vs Nyquist", aliased ? "above — aliasing" : "below — safe", aliased ? C.warn : C.D], ["apparent (alias) frequency", (aliased ? fa : f).toFixed(1) + " Hz", aliased ? C.warn : C.D]]} />
            <div style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
              <button className="iq-mini" onClick={() => tone(180 + f * 34)}>{"▶"} true tone</button>
              <button className="iq-mini" onClick={() => tone(180 + (aliased ? fa : f) * 34)} style={aliased ? { borderColor: C.warn, color: C.warn } : undefined}>{"▶"} what the samples reconstruct</button>
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 11.5, color: C.faint, marginTop: 7, lineHeight: 1.5 }}>Below Nyquist the two sound identical; above it, the reconstructed tone is the lower-pitched alias.</div>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A signal sampled at rate Fs is only unambiguous if all its energy sits below Fs/2. Beyond that, a component at frequency f is sampled identically to one at |f − k·Fs| — it folds back into the band as an alias and is unrecoverable. That’s why real receivers put an anti-alias filter before the sampler, and why your capture’s sample rate sets the bandwidth you can ever see (Part 1’s ±Fs/2 window)."
        example={`Sample rate Fs = 16 Hz → Nyquist = 8 Hz.
   signal at 3 Hz   → below 8, sampled faithfully (3 Hz)
   signal at 14 Hz  → above 8: alias = |14 − 16| = 2 Hz
        the 14 Hz wave and a 2 Hz wave share every sample.
   signal at 19 Hz  → alias = |19 − 16| = 3 Hz

General rule: apparent frequency = |f − round(f/Fs)·Fs|, always
≤ Fs/2. Once aliased, no processing can separate the ghost
from a real signal sitting at that frequency.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 0.2 — QUANTIZATION & BIT DEPTH
   ============================================================ */
function QuantizationModule() {
  const sRef = useRef(null), eRef = useRef(null);
  const [bits, setBits] = useState(4);
  const [snr, setSnr] = useState(0);
  useEffect(() => {
    const L = Math.pow(2, bits), step = 2 / L, N = 512, orig = [], quant = [], err = [];
    let ps = 0, pe = 0;
    for (let i = 0; i < N; i++) { const x = Math.sin(2 * Math.PI * 3 * i / N); const q = Math.max(-1, Math.min(1 - 1e-9, Math.round(x / step) * step)); orig.push(x); quant.push(q); err.push(x - q); ps += x * x; pe += (x - q) * (x - q); }
    setSnr(10 * Math.log10(ps / pe));
    const sc = sRef.current;
    if (sc) {
      const ctx = sc._ctx || (sc._ctx = fitCanvas(sc, sc.clientWidth, sc.clientHeight)); const w = sc.clientWidth, h = sc.clientHeight, midY = h / 2, amp = h * 0.4; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.gridFaint; for (let l = 0; l < L && L <= 32; l++) { const y = midY - (((l + 0.5) * step) - 1) * amp; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = C.sub; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.6; ctx.beginPath(); orig.forEach((v, i) => { const x = (i / (N - 1)) * w, y = midY - v * amp; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.I; ctx.lineWidth = 1.6; ctx.beginPath(); quant.forEach((v, i) => { const x = (i / (N - 1)) * w, y = midY - v * amp; if (i) { ctx.lineTo(x, midY - quant[i - 1] * amp); ctx.lineTo(x, y); } else ctx.moveTo(x, y); }); ctx.stroke();
    }
    const ec = eRef.current;
    if (ec) {
      const ctx = ec._ctx || (ec._ctx = fitCanvas(ec, ec.clientWidth, ec.clientHeight)); const w = ec.clientWidth, h = ec.clientHeight, midY = h / 2; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
      ctx.strokeStyle = C.warn; ctx.lineWidth = 1.2; ctx.beginPath(); err.forEach((v, i) => { const x = (i / (N - 1)) * w, y = midY - v / step * (h * 0.42); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    }
  }, [bits]);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "An ADC rounds each sample to one of 2^b levels, where b is the bit depth. The rounding error is quantization noise — a noise floor you build into the signal the moment you digitize." },
          { t: "Intuition", c: C.Q, x: "Each extra bit halves the step size, so it doubles the levels and cuts the rounding error in half — about 6 dB more dynamic range per bit. That’s the whole story of bit depth." },
          { t: "Heads up", c: C.warn, x: "Too few bits and quantization noise drowns weak signals; that’s why wideband receivers watching strong and weak signals together need plenty of bits (and careful gain)." },
        ]}
        n="0.2" title="Quantization and bit depth"
        body="Sampling fixes when you measure; quantization fixes how finely. An analog-to-digital converter snaps each sample to the nearest of 2^b levels, and the leftover rounding is noise you can never remove. The payoff is clean and famous: roughly six decibels of signal-to-noise per bit." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="Signal (grey) and its quantized staircase (amber)">
            <canvas ref={sRef} style={{ width: "100%", height: 180, display: "block" }} />
          </Panel>
          <Panel label="Quantization error (what got thrown away)">
            <canvas ref={eRef} style={{ width: "100%", height: 90, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Converter">
            <Slider label="Bit depth b" value={bits} min={2} max={12} step={1} color={C.I} fmt={(v) => v + " bits"} onChange={setBits} />
          </Panel>
          <Panel label="Dynamic range">
            <Readout rows={[["levels (2^b)", String(Math.pow(2, bits)), C.ink], ["measured SNR", snr.toFixed(1) + " dB", C.D], ["rule 6.02·b + 1.76", (6.02 * bits + 1.76).toFixed(1) + " dB", C.Q]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              The measured SNR tracks the textbook law almost exactly. Drop to a few bits and the staircase is coarse and the error large; add bits and both shrink ~6 dB at a time.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="Rounding each sample to one of 2^b levels injects an error roughly uniform over one step Δ. Its power is Δ²/12, fixed by the step size, while a full-scale sine carries power A²/2. The ratio gives the quantization SNR, and because each added bit halves Δ, the SNR climbs about 6.02 dB per bit — the dynamic range you bake in at the converter."
        example={`Full-scale sine, range ±1, bit depth b → step Δ = 2 / 2^b.
   signal power      = 1/2
   quant-noise power = Δ²/12
   SNR = (1/2)/(Δ²/12) → in dB: ≈ 6.02·b + 1.76

   8-bit  → ≈ 49.9 dB   (CD-quality is 16-bit ≈ 98 dB)
   12-bit → ≈ 74.0 dB

So a receiver’s ADC bits set its noise floor before any signal
processing. Spending bits buys the headroom to see a weak
signal sitting next to a strong one.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 0.3 — NOISE, SNR & THE BER CURVE
   ============================================================ */
const gray = (x) => x ^ (x >> 1);
function qam16norm() { const amp = [-3, -1, 1, 3], p = []; for (let q = 0; q < 4; q++) for (let i = 0; i < 4; i++) p.push({ I: amp[i], Q: amp[q], bI: gray(i), bQ: gray(q) }); let P = 0; p.forEach((s) => (P += s.I * s.I + s.Q * s.Q)); const g = Math.sqrt(p.length / P); return p.map((s) => ({ ...s, I: s.I * g, Q: s.Q * g })); }
const C16 = qam16norm();
const bit2 = (v) => [(v >> 1) & 1, v & 1];
function mcBER(scheme, ebnoDb, T) {
  const lin = Math.pow(10, ebnoDb / 10); let be = 0, nb = 0;
  if (scheme === "BPSK") { const N0 = 1 / lin, sd = Math.sqrt(N0 / 2); for (let i = 0; i < T; i++) { const b = rand() < 0.5 ? -1 : 1; if (Math.sign(b + sd * randn()) !== b) be++; nb++; } }
  else if (scheme === "QPSK") { const N0 = 1 / (2 * lin), sd = Math.sqrt(N0 / 2); for (let i = 0; i < T; i++) { const bI = rand() < 0.5 ? -1 : 1, bQ = rand() < 0.5 ? -1 : 1; if (Math.sign(bI * Math.SQRT1_2 + sd * randn()) !== bI) be++; if (Math.sign(bQ * Math.SQRT1_2 + sd * randn()) !== bQ) be++; nb += 2; } }
  else { const N0 = 1 / (4 * lin), sd = Math.sqrt(N0 / 2); for (let i = 0; i < T; i++) { const k = (rand() * 16) | 0, s = C16[k]; const rI = s.I + sd * randn(), rQ = s.Q + sd * randn(); let bi = 0, bd = 1e9; for (let j = 0; j < 16; j++) { const d = (C16[j].I - rI) ** 2 + (C16[j].Q - rQ) ** 2; if (d < bd) { bd = d; bi = j; } } const tb = [...bit2(s.bI), ...bit2(s.bQ)], db = [...bit2(C16[bi].bI), ...bit2(C16[bi].bQ)]; for (let b = 0; b < 4; b++) if (tb[b] !== db[b]) be++; nb += 4; } }
  return be / nb;
}
const theory = { BPSK: (e) => Qf(Math.sqrt(2 * Math.pow(10, e / 10))), QPSK: (e) => Qf(Math.sqrt(2 * Math.pow(10, e / 10))), "16QAM": (e) => 0.75 * Qf(Math.sqrt(0.8 * Math.pow(10, e / 10))) };
const SCH = [["BPSK", C.I], ["QPSK", C.Q], ["16QAM", C.A]];
function BERModule() {
  const ref = useRef(null);
  const [cursor, setCursor] = useState(8);
  const [hi, setHi] = useState(false);
  const data = useRef(null); const [ver, setVer] = useState(0);
  useEffect(() => {
    _seed = 24680; const T = hi ? 120000 : 25000, snrs = []; for (let e = 0; e <= 14; e += 1) snrs.push(e);
    const mc = {}; SCH.forEach(([s]) => { mc[s] = snrs.map((e) => mcBER(s, e, T)); }); data.current = { snrs, mc, T }; setVer((v) => v + 1);
  }, [hi]);
  useEffect(() => {
    const d = data.current; if (!d) return; const cv = ref.current; if (!cv) return;
    const ctx = cv._ctx || (cv._ctx = fitCanvas(cv, cv.clientWidth, cv.clientHeight)); const w = cv.clientWidth, h = cv.clientHeight, pl = 40, pr = 10, pt = 10, pb = 26;
    ctx.clearRect(0, 0, w, h); const x0 = pl, x1 = w - pr, y0 = pt, y1 = h - pb, EMAX = 14, top = 0, bot = -5;
    const xOf = (e) => x0 + (e / EMAX) * (x1 - x0), yOf = (ber) => { const L = Math.log10(Math.max(ber, 1e-6)); return y0 + (top - L) / (top - bot) * (y1 - y0); };
    ctx.strokeStyle = C.gridFaint; ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`;
    for (let dec = 0; dec >= -5; dec--) { const y = yOf(Math.pow(10, dec)); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText("1e" + dec, x0 - 4, y + 3); }
    for (let e = 0; e <= EMAX; e += 2) { const x = xOf(e); ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.textAlign = "center"; ctx.fillStyle = C.faint; ctx.fillText(e + "", x, y1 + 13); }
    ctx.textAlign = "center"; ctx.fillText("Eb/N0 (dB) →", (x0 + x1) / 2, h - 3);
    // cursor
    const xc = xOf(cursor); ctx.strokeStyle = C.edge; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xc, y0); ctx.lineTo(xc, y1); ctx.stroke(); ctx.setLineDash([]);
    SCH.forEach(([s, col]) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let e = 0; e <= EMAX; e += 0.25) { const x = xOf(e), y = yOf(theory[s](e)); e ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      ctx.fillStyle = col; d.snrs.forEach((e, i) => { const b = d.mc[s][i]; if (b > 0) { const x = xOf(e), y = yOf(b); ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); } });
    });
    ctx.font = `10px ${FONT.mono}`; ctx.textAlign = "left"; let ly = y0 + 10; SCH.forEach(([s, col]) => { ctx.fillStyle = col; ctx.fillText("— " + s, x1 - 64, ly); ly += 13; });
  }, [cursor, ver]);
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "SNR is signal power over noise power; for digital links the honest axis is Eb/N0, the energy per bit over the noise density. The bit error rate (BER) is the fraction of bits the receiver gets wrong." },
          { t: "Intuition", c: C.Q, x: "More energy per bit pushes constellation points further above the noise, so BER falls — steeply. The curve is the single most important plot in digital comms: how clean a channel each scheme needs." },
          { t: "Heads up", c: C.warn, x: "BPSK and QPSK need the same Eb/N0 (QPSK just sends two of them at once); 16QAM needs several dB more for the same BER — the price of its extra bits. Coding (Priority 5) buys some back." },
        ]}
        n="0.3" title="Noise, SNR, and the BER curve"
        body="Noise is what every later trick fights. Here we make it quantitative: drive each scheme through real additive-noise channels at a range of SNRs, count the bit errors, and plot bit error rate against energy-per-bit. The dots are live Monte-Carlo simulation; the smooth lines are the closed-form theory they should land on." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="BER vs Eb/N0 — Monte-Carlo dots on theory curves">
            <canvas ref={ref} style={{ width: "100%", height: 300, display: "block" }} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "10px 0 0", lineHeight: 1.5 }}>
              Each dot is a fresh noise simulation; it lands on the theoretical line because the math is real on both sides. The waterfall shape means a couple of dB of SNR can change BER by orders of magnitude.
            </p>
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Read the curve">
            <Slider label="Eb/N0 cursor" value={cursor} min={0} max={14} step={0.5} color={C.ink} fmt={(v) => v.toFixed(1) + " dB"} onChange={setCursor} />
            <div style={{ marginTop: 12 }}>
              <Readout rows={SCH.map(([s, col]) => [s + " BER (theory)", theory[s](cursor).toExponential(1), col])} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", color: C.Q, marginTop: 12 }}><input type="checkbox" checked={hi} onChange={(e) => setHi(e.target.checked)} style={{ width: 15, height: 15 }} /><span style={{ fontFamily: FONT.body, fontSize: 13, color: C.sub }}>more trials (slower, lower noise floor)</span></label>
          </Panel>
          <Panel label="Why it matters">
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: 0, lineHeight: 1.55 }}>
              To hit BER 10⁻⁵, BPSK/QPSK need about 9.6 dB; 16QAM about 13.4 dB. Below ~ −1.6 dB (the Shannon limit) no scheme can be reliable at all — which is exactly the room error-correcting codes work in.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A digital link’s quality is the bit error rate as a function of Eb/N0. For BPSK each bit is ±√Eb in noise of density N0, so a bit flips when noise exceeds the halfway point — probability Q(√(2·Eb/N0)). QPSK is two such bits on I and Q, identical in Eb/N0. Square QAM packs more bits per symbol but at smaller spacing, so it needs more Eb/N0 for the same BER. The Monte-Carlo dots confirm these formulas by direct counting."
        example={`BER formulas (Gray-coded, AWGN):
   BPSK / QPSK :  Q(√(2·Eb/N0))
   16QAM       :  ≈ 0.75 · Q(√(0.8·Eb/N0))

To reach BER = 1e-5:
   BPSK/QPSK ≈ 9.6 dB Eb/N0
   16QAM     ≈ 13.4 dB     (about 3.8 dB more for 2× the bits)

Monte-Carlo at 8 dB (counting ~25k symbols of errors):
   BPSK ≈ 2e-4, matching Q(√(2·10^0.8)). The dots sit on the
   lines because both sides are the same real DSP.`}
      />
    </div>
  );
}

/* ============================================================
   MODULE 0.4 — THE QUADRATURE DEMODULATOR
   ============================================================ */
function QuadratureModule() {
  const dRef = useRef(null), cRef = useRef(null);
  const [dcI, setDcI] = useState(0);
  const [dcQ, setDcQ] = useState(0);
  const [gain, setGain] = useState(0);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    // block diagram
    const dc = dRef.current;
    if (dc) {
      const ctx = dc._ctx || (dc._ctx = fitCanvas(dc, dc.clientWidth, dc.clientHeight)); const w = dc.clientWidth, h = dc.clientHeight; ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.edge; ctx.fillStyle = C.sub; ctx.font = `11px ${FONT.mono}`; ctx.lineWidth = 1.4;
      const box = (x, y, bw, bh, t, col) => { ctx.strokeStyle = col || C.edge; ctx.strokeRect(x, y, bw, bh); ctx.fillStyle = col || C.sub; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x + bw / 2, y + bh / 2); };
      const circ = (x, y, t, col) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.stroke(); ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y); };
      const arr = (x0, y0, x1, y1) => { ctx.strokeStyle = C.faint; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 5, y1 - 3); ctx.lineTo(x1 - 5, y1 + 3); ctx.closePath(); ctx.fillStyle = C.faint; ctx.fill(); };
      const yU = h * 0.3, yD = h * 0.72, xIn = 30, xMix = 120, xLp = 210, xOut = w - 40;
      ctx.fillStyle = C.sub; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText("RF", 8, h / 2);
      arr(24, h / 2, xMix - 14, yU); arr(24, h / 2, xMix - 14, yD);
      circ(xMix, yU, "×", C.I); circ(xMix, yD, "×", C.Q);
      box(xMix + 18, yU - 12, 60, 24, "LPF", C.edge); box(xMix + 18, yD - 12, 60, 24, "LPF", C.edge);
      arr(xMix + 13, yU, xMix + 18, yU); arr(xMix + 13, yD, xMix + 18, yD);
      arr(xMix + 78, yU, xOut, yU); arr(xMix + 78, yD, xOut, yD);
      ctx.fillStyle = C.I; ctx.textAlign = "left"; ctx.fillText("I", xOut + 4, yU); ctx.fillStyle = C.Q; ctx.fillText("Q", xOut + 4, yD);
      box(xMix - 30, h / 2 - 13, 60, 26, "LO 90°", C.D); arr(xMix, h / 2 - 13, xMix, yU + 14); arr(xMix, h / 2 + 13, xMix, yD - 14);
      ctx.fillStyle = C.faint; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = "center"; ctx.fillText("cos", xMix - 16, (h / 2 + yU) / 2); ctx.fillText("−sin", xMix - 16, (h / 2 + yD) / 2);
    }
    // constellation with impairments applied to ideal QPSK
    const cc = cRef.current;
    if (cc) {
      _seed = 13579; const ctx = cc._ctx || (cc._ctx = fitCanvas(cc, cc.clientWidth, cc.clientHeight)); const w = cc.clientWidth, h = cc.clientHeight, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;
      ctx.clearRect(0, 0, w, h); ctx.strokeStyle = C.gridFaint; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
      const QP = [[0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707]], ph = phase * Math.PI / 180, sd = 0.04;
      QP.forEach((s, idx) => {
        const col = [C.A, C.B, C.D, C.I][idx];
        for (let i = 0; i < 120; i++) {
          const I0 = s[0] + sd * randn(), Q0 = s[1] + sd * randn();
          const Ii = I0 + dcI; const Qi = (1 + gain) * (I0 * Math.sin(ph) + Q0 * Math.cos(ph)) + dcQ;
          ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(cx + Ii * R, cy - Qi * R, 1.8, 0, 7); ctx.fill();
        }
      });
      ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; QP.forEach((s) => { ctx.beginPath(); ctx.arc(cx + s[0] * R, cy - s[1] * R, 2.5, 0, 7); ctx.fill(); });
    }
  }, [dcI, dcQ, gain, phase]);
  const clean = Math.abs(dcI) < 0.02 && Math.abs(dcQ) < 0.02 && Math.abs(gain) < 0.02 && Math.abs(phase) < 1;
  return (
    <div>
      <Lead
        notes={[
          { t: "Term", c: C.A, x: "The quadrature demodulator is the analog front end that creates I and Q: split the RF, multiply one copy by cos and the other by a 90°-shifted −sin from a local oscillator, then low-pass filter. The two outputs are I and Q." },
          { t: "Intuition", c: C.Q, x: "Mixing by cos and sin projects the RF onto two perpendicular axes — exactly the real and imaginary parts of Part 1’s arrow. This hardware is where the complex sample physically comes from." },
          { t: "Heads up", c: C.warn, x: "Real hardware is imperfect: a DC offset shifts the whole constellation off-centre, and gain or phase mismatch between the I and Q paths (I/Q imbalance) skews the square into a parallelogram." },
        ]}
        n="0.4" title="The analog quadrature demodulator"
        body="Where do I and Q actually come from? A receiver mixes the incoming radio wave against a local oscillator in two phases, 90° apart, and low-pass filters the results — that's the in-phase and quadrature pair this whole course rests on. It's also where real-world flaws creep in, so see how DC offset and I/Q imbalance distort an otherwise perfect QPSK constellation." />
      <div className="iq-grid2">
        <div style={{ display: "grid", gap: 14 }}>
          <Panel label="The downconversion chain">
            <canvas ref={dRef} style={{ width: "100%", height: 150, display: "block" }} />
          </Panel>
          <Panel label="QPSK constellation, with your impairments applied">
            <canvas ref={cRef} style={{ width: "100%", height: 230, display: "block" }} />
          </Panel>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Panel label="Front-end impairments">
            <div style={{ display: "grid", gap: 14 }}>
              <Slider label="DC offset — I" value={dcI} min={-0.4} max={0.4} step={0.01} color={C.I} fmt={(v) => v.toFixed(2)} onChange={setDcI} />
              <Slider label="DC offset — Q" value={dcQ} min={-0.4} max={0.4} step={0.01} color={C.Q} fmt={(v) => v.toFixed(2)} onChange={setDcQ} />
              <Slider label="I/Q gain imbalance" value={gain} min={-0.4} max={0.4} step={0.01} color={C.A} fmt={(v) => (v * 100).toFixed(0) + "%"} onChange={setGain} />
              <Slider label="I/Q phase error" value={phase} min={-25} max={25} step={1} color={C.B} fmt={(v) => v.toFixed(0) + "°"} onChange={setPhase} />
            </div>
            <button onClick={() => { setDcI(0); setDcQ(0); setGain(0); setPhase(0); }} className="iq-mini" style={{ marginTop: 12 }}>↺ ideal front end</button>
          </Panel>
          <Panel label="State">
            <Readout rows={[["constellation", clean ? "clean square" : "distorted", clean ? C.D : C.warn], ["DC offset", (Math.hypot(dcI, dcQ)).toFixed(2), Math.hypot(dcI, dcQ) < 0.02 ? C.D : C.warn], ["imbalance", Math.abs(gain) > 0.02 || Math.abs(phase) > 1 ? "present" : "none", Math.abs(gain) > 0.02 || Math.abs(phase) > 1 ? C.warn : C.D]]} />
            <p style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, margin: "12px 0 0", lineHeight: 1.55 }}>
              DC offset slides every point the same way (a tone at the centre frequency); imbalance shears the square. Receivers estimate and correct both before the slicer.
            </p>
          </Panel>
        </div>
      </div>
      <Deeper
        recap="A quadrature demodulator multiplies the received RF by cos(2πf_c t) and by −sin(2πf_c t) from a local oscillator, then low-pass filters each — recovering the baseband I and Q that were modulated onto the carrier. Because cos and sin are orthogonal, this cleanly separates the two. Hardware imperfections then show up geometrically: a DC offset adds a constant to I/Q (whole constellation shifts), and gain/phase mismatch between the paths skews the constellation."
        example={`Transmit s(t) = I·cos(2πf_c t) − Q·sin(2πf_c t). At the receiver:
   2·s(t)·cos(2πf_c t)  —LPF→  I      (the cos×cos term)
   −2·s(t)·sin(2πf_c t) —LPF→  Q      (the sin×sin term)
   → with a perfect LO, exactly (I, Q) back. (Verified: 0.7, −0.3.)

Impairments (applied to the recovered point):
   DC offset:      I′ = I + d_I,   Q′ = Q + d_Q     (shift)
   I/Q imbalance:  Q′ = (1+g)·(I·sinφ + Q·cosφ)     (shear)
A 10% gain + 10° phase error turns (0.7, −0.3) into (0.76, −0.33)
— the parallelogram you see, which the receiver must calibrate out.`}
      />
    </div>
  );
}

/* ============================================================
   APP SHELL
   ============================================================ */
const MODULES = [
  { id: "0.1", label: "Sampling theorem", comp: SamplingModule },
  { id: "0.2", label: "Quantization", comp: QuantizationModule },
  { id: "0.3", label: "Noise, SNR & BER", comp: BERModule },
  { id: "0.4", label: "Quadrature demod", comp: QuadratureModule },
];

const DIFF = [1, 1, 2, 2];
const PREDICTS = {"0": {"q": "A 9 Hz tone is sampled at 16 Hz. Where does its peak land?", "options": ["9 Hz", "7 Hz", "2 Hz"], "answer": 1, "why": "9 Hz is above the 8 Hz Nyquist, so it folds to |9 - 16| = 7 Hz."}, "2": {"q": "Near BER 1e-3, about how much more Eb/N0 drops the error rate by 10x?", "options": ["~0.2 dB", "~2 dB", "~10 dB"], "answer": 1, "why": "The waterfall is steep here: a couple of dB changes BER by an order of magnitude."}};
function Predict({ q, options, answer, why }) {
  const [pick, setPick] = useState(null);
  return (
    <div style={{ background: C.panel, border: "1px solid " + C.edge, borderLeft: "2px solid " + C.I, borderRadius: 8, padding: "12px 14px", marginBottom: 16, maxWidth: 720 }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.I, marginBottom: 6 }}>Predict before you drag</div>
      <div style={{ fontFamily: FONT.body, fontSize: 13.5, color: C.ink, marginBottom: 10, lineHeight: 1.5 }}>{q}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o, i) => { const on = pick === i, correct = i === answer; const bc = pick == null ? C.edge : (correct ? C.D : (on ? C.warn : C.edge)); const tc = pick == null ? C.sub : (correct ? C.D : (on ? C.warn : C.faint)); return <button key={i} onClick={() => setPick(i)} style={{ fontFamily: FONT.body, fontSize: 12.5, padding: "6px 11px", borderRadius: 6, border: "1px solid " + bc, background: on ? C.panelHi : "transparent", color: tc, cursor: "pointer" }}>{o}</button>; })}
      </div>
      {pick != null && <div style={{ fontFamily: FONT.body, fontSize: 12.5, color: C.sub, marginTop: 10, lineHeight: 1.5 }}><span style={{ color: pick === answer ? C.D : C.warn, fontFamily: FONT.mono, fontSize: 11 }}>{pick === answer ? "correct" : "not quite"}</span>{" — "}{why}</div>}
    </div>
  );
}

export default function App() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(() => { try { const _h = parseInt((location.hash.match(/m(\d+)/) || [])[1], 10); if (_h >= 0 && _h < MODULES.length) return _h; } catch (_e) {} return 0; });
  const Comp = MODULES[active].comp;
  useEffect(() => { try { history.replaceState(null, "", "#m" + active); } catch (_e) {} }, [active]);
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input[type=range]{ -webkit-appearance:none; appearance:none; height:4px; border-radius:2px; background:${C.grid}; outline:none; }
        input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:currentColor; cursor:pointer; border:2px solid ${C.bg}; }
        input[type=range]::-moz-range-thumb{ width:14px; height:14px; border:2px solid ${C.bg}; border-radius:50%; background:currentColor; cursor:pointer; }
        input[type=checkbox]{ accent-color: currentColor; cursor:pointer; }
        input:focus-visible, button:focus-visible { outline: 2px solid ${C.Q}; outline-offset: 2px; }
        .iq-wrap { max-width: 1080px; margin: 0 auto; padding: 28px 22px 64px; }
        .iq-grid2 { display: grid; grid-template-columns: 1.5fr 1fr; gap: 18px; align-items: start; }
        @media (max-width: 880px){ .iq-grid2 { grid-template-columns: 1fr; } }
        .iq-tab { font-family:${FONT.mono}; font-size:12px; letter-spacing:0.04em; padding:8px 13px; border-radius:7px; border:1px solid transparent; background:transparent; color:${C.sub}; cursor:pointer; white-space:nowrap; transition:background .15s,color .15s; }
        .iq-tab:hover { color:${C.ink}; }
        .iq-tab[data-on="1"]{ background:${C.panelHi}; border-color:${C.edge}; color:${C.ink}; }
        .iq-mini { font-family:${FONT.mono}; font-size:11px; padding:5px 10px; border-radius:6px; border:1px solid ${C.edge}; background:transparent; color:${C.sub}; cursor:pointer; transition:background .15s; }
        .iq-mini:hover { background:${C.panelHi}; color:${C.ink}; }
        .iq-mini[data-on="1"]{ background:${C.panelHi}; border-color:${C.Q}; color:${C.Q}; }
        canvas { background:${C.bg}; border-radius:4px; }
      `}</style>
      <div className="iq-wrap">
        <header style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.I }} />
            <span style={{ width: 11, height: 11, borderRadius: 11, background: C.Q }} />
            <Eyebrow>I/Q signal primer · foundations</Eyebrow>
          </div>
          <h1 style={{ fontFamily: FONT.disp, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em", lineHeight: 1.05 }}>The groundwork</h1>
          <p style={{ fontFamily: FONT.body, fontSize: 15, color: C.sub, maxWidth: 720, lineHeight: 1.6, margin: 0 }}>
            Four ideas everything else stands on: how fast you must sample, how finely you must quantize, how noise sets the limit on getting bits right, and the analog mixer chain that produces I and Q in the first place. Every plot runs the real DSP — the BER dots are live Monte-Carlo.
          </p>
          {reduced && <p style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, marginTop: 10 }}>Reduced-motion on — all views are static and respond to controls.</p>}
          <nav style={{ display: "flex", gap: 6, marginTop: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.edge}`, paddingBottom: 16 }}>
            {MODULES.map((m, i) => <button key={m.id} className="iq-tab" data-on={active === i ? "1" : "0"} onClick={() => setActive(i)}><span style={{ color: active === i ? C.Q : C.faint, marginRight: 7 }}>{m.id}</span>{m.label}<span title="math intensity (light / medium / heavy)" style={{ marginLeft: 7, letterSpacing: 1, fontSize: 9 }}>{[0, 1, 2].map((_d) => <span key={_d} style={{ color: _d < DIFF[i] ? (DIFF[i] === 1 ? C.D : DIFF[i] === 2 ? C.I : C.warn) : C.gridFaint }}>{"•"}</span>)}</span></button>)}
          </nav>
        </header>
        {PREDICTS[active] && <Predict q={PREDICTS[active].q} options={PREDICTS[active].options} answer={PREDICTS[active].answer} why={PREDICTS[active].why} />}
        <main key={active}><Comp reduced={reduced} /></main>
        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${C.gridFaint}`, fontFamily: FONT.body, fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          Sample fast enough, quantize finely enough, respect the noise floor, and trust the mixer that makes I and Q. With that groundwork, Part 1 can take the complex sample as a given and build upward.
        </footer>
      </div>
    </div>
  );
}
