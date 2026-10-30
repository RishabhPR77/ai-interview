import { useEffect, useRef, useState, useCallback } from "react";
import {
  Camera, CameraOff, Mic, MicOff, ArrowRight,
  RefreshCw, CheckCircle2, AlertTriangle, Eye, Brain,
  Sun, Info, ArrowUp, ArrowDown, ArrowLeft,
  ArrowRight as ArrowR, Move, Briefcase, ChevronRight,
  Video, BarChart3, Loader2, Wifi,
} from "lucide-react";
import { preloadMediaPipe, isMediaPipePreloading } from "@/lib/mediapipe-loader";

declare global {
  interface Window {
    FaceMesh: any;
    Camera: any;
  }
}

interface Props {
  candidateName: string;
  onReady: () => void;
  onBack: () => void;
}

interface EnvHint {
  level: "ok" | "warn" | "info";
  message: string;
}

interface PostureHint {
  text: string;
  sub: string;
  status: "good" | "warn" | "info";
  icon: "up" | "down" | "left" | "right" | "closer" | "back" | "ok" | "look";
}

interface LiveMetrics {
  alertness: AlertnessState;
  eyeContact: boolean;
  headTilt: number;
  faceSize: number;
  pitchDeg: number;
}

const LM = {
  leftEyeOuter:  33,
  rightEyeOuter: 263,
  leftEyeInner:  133,
  rightEyeInner: 362,
  noseTip:       1,
  chin:          152,
  forehead:      10,
  leftCheek:     234,
  rightCheek:    454,
};

// Eye Aspect Ratio landmark indices (MediaPipe refined)
// Left eye:  top=159, bottom=145, outer=33, inner=133
// Right eye: top=386, bottom=374, outer=263, inner=362
const EAR_LM = {
  leftTop:     [159, 160, 158],
  leftBottom:  [145, 144, 153],
  leftOuter:   33,
  leftInner:   133,
  rightTop:    [386, 385, 387],
  rightBottom: [374, 373, 380],
  rightOuter:  263,
  rightInner:  362,
};

function computeEAR(lm: { x: number; y: number }[]): number {
  const avg = (indices: number[], axis: "x" | "y") =>
    indices.reduce((s, i) => s + lm[i][axis], 0) / indices.length;

  const leftV  = Math.abs(avg(EAR_LM.leftTop, "y")    - avg(EAR_LM.leftBottom, "y"));
  const leftH  = Math.abs(lm[EAR_LM.leftOuter].x      - lm[EAR_LM.leftInner].x);
  const rightV = Math.abs(avg(EAR_LM.rightTop, "y")   - avg(EAR_LM.rightBottom, "y"));
  const rightH = Math.abs(lm[EAR_LM.rightOuter].x     - lm[EAR_LM.rightInner].x);

  const leftEAR  = leftH  > 0.001 ? leftV  / leftH  : 0;
  const rightEAR = rightH > 0.001 ? rightV / rightH : 0;
  return (leftEAR + rightEAR) / 2;
}

type AlertnessLevel = "alert" | "normal" | "drowsy" | "sleeping";

interface AlertnessState {
  level: AlertnessLevel;
  ear: number;           // current EAR (0–1)
  earAvg: number;        // rolling 30-frame avg
  blinkRate: number;     // blinks per minute
  closedMs: number;      // how long eyes have been continuously closed
  label: string;
  sub: string;
  emoji: string;
}

// ── FIX: Mirror landmark X coords because video is flipped ──────────────────
// The canvas overlay is scale-x-[-1] so landmarks need to be mirrored too,
// but for ANALYSIS we must use raw (unmirrored) coords so angles are correct.
// We pass raw coords for analysis, mirrored coords only for drawing.

function mirrorLandmarks(lm: { x: number; y: number; z: number }[]) {
  return lm.map(p => ({ ...p, x: 1 - p.x }));
}

function analyzePosture(
  lm: { x: number; y: number; z: number }[],  // raw (unmirrored) landmarks
  canvasW: number,
  canvasH: number,
): PostureHint {
  const get = (i: number) => ({ x: lm[i].x * canvasW, y: lm[i].y * canvasH, z: lm[i].z });

  const leftEye    = get(LM.leftEyeOuter);
  const rightEye   = get(LM.rightEyeOuter);
  const nose       = get(LM.noseTip);
  const chin       = get(LM.chin);
  const forehead   = get(LM.forehead);
  const leftCheek  = get(LM.leftCheek);
  const rightCheek = get(LM.rightCheek);

  // ── Face width (distance check) ────────────────────────────────────
  const faceWidth = Math.abs(rightCheek.x - leftCheek.x) / canvasW;
  if (faceWidth < 0.10)
    return { text: "Sit closer to camera", sub: "Your face is too small — move forward", status: "warn", icon: "closer" };
  if (faceWidth > 0.75)
    return { text: "Move back a little", sub: "Too close — back up so shoulders are visible", status: "info", icon: "back" };

  // ── Horizontal centering ───────────────────────────────────────────
  const faceCenterX = (leftCheek.x + rightCheek.x) / 2 / canvasW;
  if (faceCenterX < 0.18)
    return { text: "Move right", sub: "Center yourself in the frame", status: "info", icon: "right" };
  if (faceCenterX > 0.82)
    return { text: "Move left", sub: "Center yourself in the frame", status: "info", icon: "left" };

  // ── Vertical position ──────────────────────────────────────────────
  const faceCenterY = (forehead.y + chin.y) / 2 / canvasH;
  if (faceCenterY > 0.72)
    return { text: "Sit up straight", sub: "Your head is too low — straighten your back", status: "warn", icon: "up" };
  if (faceCenterY < 0.08)
    return { text: "Sit a little lower", sub: "Or tilt your camera slightly downward", status: "info", icon: "down" };

  // ── Head roll (tilt / lying down) — eye line angle ─────────────────
  // FIX: In raw landmark space, left eye has SMALLER x than right eye when sitting upright.
  // When lying on their side, the eye line becomes nearly vertical → |rollDeg| → ~90°.
  const dy = rightEye.y - leftEye.y;
  const dx = rightEye.x - leftEye.x;
  const rollDeg = Math.atan2(dy, dx) * (180 / Math.PI);

  // FIX: Tightened thresholds — 28° was way too lenient (lying down = ~70-90°)
  if (Math.abs(rollDeg) > 40)
    return { text: "Sit upright — you appear to be lying down", sub: "Sit straight in a chair facing the camera", status: "warn", icon: "up" };
  if (Math.abs(rollDeg) > 18)
    return { text: "Straighten your head", sub: `Head tilted ${rollDeg > 0 ? "right" : "left"} — keep it level`, status: "warn", icon: "up" };

  // ── Head yaw (turned sideways) ─────────────────────────────────────
  const eyeMidX  = (leftEye.x + rightEye.x) / 2;
  const faceW    = Math.abs(rightCheek.x - leftCheek.x);
  const yawOffset = (nose.x - eyeMidX) / Math.max(faceW, 1);
  if (Math.abs(yawOffset) > 0.20)
    return { text: "Face the camera directly", sub: "You are turned to the side — look straight ahead", status: "warn", icon: "look" };

  // ── Head pitch (looking up/down) ───────────────────────────────────
  const faceH      = Math.abs(chin.y - forehead.y);
  const pitchRatio = (nose.y - forehead.y) / Math.max(faceH, 1);
  if (pitchRatio < 0.28)
    return { text: "Look at the camera", sub: "Head tilted too far back — look straight ahead", status: "warn", icon: "look" };
  if (pitchRatio > 0.72)
    return { text: "Lift your head up", sub: "You are looking down — raise your chin", status: "warn", icon: "up" };

  // ── Mild tilt ──────────────────────────────────────────────────────
  if (Math.abs(rollDeg) > 9)
    return { text: "Slight head tilt", sub: `Tilted ${rollDeg > 0 ? "right" : "left"} slightly — try to keep level`, status: "info", icon: "up" };

  return { text: "Good posture", sub: "Upright, centered, facing camera — you are ready", status: "good", icon: "ok" };
}

function checkLighting(video: HTMLVideoElement): EnvHint[] {
  const hints: EnvHint[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = 160; canvas.height = 120;
  const ctx = canvas.getContext("2d");
  if (!ctx || video.readyState < 1) return hints;

  ctx.drawImage(video, 0, 0, 160, 120);
  const data = ctx.getImageData(0, 0, 160, 120).data;
  const lum  = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

  let total = 0, over = 0;
  for (let i = 0; i < data.length; i += 4) { const l = lum(i); total += l; if (l > 220) over++; }
  const pixels = 160 * 120;

  let cLum = 0, cCount = 0, eLum = 0, eCount = 0;
  for (let y = 0; y < 120; y++) {
    for (let x = 0; x < 160; x++) {
      const l = lum((y * 160 + x) * 4);
      if (x >= 40 && x <= 120 && y >= 12 && y <= 96) { cLum += l; cCount++; }
      else { eLum += l; eCount++; }
    }
  }
  const avgC = cCount > 0 ? cLum / cCount : total / pixels;
  const avgE = eCount > 0 ? eLum / eCount : total / pixels;
  const backlight = avgE / Math.max(avgC, 1);

  if (backlight > 1.8 && avgC < 90)   hints.push({ level: "warn", message: "Backlight detected — bright light behind you darkens your face. Move so light faces you." });
  else if (avgC < 40)                  hints.push({ level: "warn", message: "Too dark — turn on a light in front of you or move closer to a window." });
  else if (avgC < 70)                  hints.push({ level: "warn", message: "Lighting could be better — sit near a lamp or window facing you." });
  else if (over / pixels > 0.35)       hints.push({ level: "warn", message: "Very bright background — move so the light is in front of you, not behind." });
  else                                  hints.push({ level: "ok",   message: "Lighting looks good." });

  return hints;
}

// ── Alertness tracker (stateful, lives outside component as a class-like object)
class AlertnessTracker {
  private earHistory: number[] = [];        // rolling 90 frames (~3s at 30fps)
  private blinkTimestamps: number[] = [];   // timestamps of blinks
  private eyesClosedSince: number | null = null;
  private wasBelow = false;                 // for blink edge detection
  private readonly EAR_CLOSE  = 0.18;      // below = eyes closed
  private readonly EAR_OPEN   = 0.22;      // above = eyes open (hysteresis)
  private readonly HISTORY_LEN = 90;
  private readonly BLINK_WINDOW = 60_000;  // 1 min window for blink rate

  update(ear: number, nowMs: number): AlertnessState {
    // Rolling history
    this.earHistory.push(ear);
    if (this.earHistory.length > this.HISTORY_LEN) this.earHistory.shift();
    const earAvg = this.earHistory.reduce((a, b) => a + b, 0) / this.earHistory.length;

    // Blink detection (edge: open→close→open)
    if (!this.wasBelow && ear < this.EAR_CLOSE) {
      this.wasBelow = true;
      this.eyesClosedSince = nowMs;
    } else if (this.wasBelow && ear > this.EAR_OPEN) {
      this.wasBelow = false;
      const duration = nowMs - (this.eyesClosedSince ?? nowMs);
      if (duration < 600) {
        // Short close = blink
        this.blinkTimestamps.push(nowMs);
      }
      this.eyesClosedSince = null;
    }

    // Prune old blinks
    const cutoff = nowMs - this.BLINK_WINDOW;
    this.blinkTimestamps = this.blinkTimestamps.filter(t => t > cutoff);
    const blinkRate = this.blinkTimestamps.length; // blinks in last minute

    // How long eyes have been continuously closed
    const closedMs = this.wasBelow && this.eyesClosedSince !== null
      ? nowMs - this.eyesClosedSince : 0;

    // ── Classify alertness ─────────────────────────────────────────────
    let level: AlertnessLevel;
    let label: string;
    let sub: string;
    let emoji: string;

    if (closedMs > 2500) {
      level = "sleeping"; label = "Eyes closed / sleeping"; emoji = "😴";
      sub = "Eyes have been closed for over 2 seconds";
    } else if (closedMs > 1200) {
      level = "drowsy"; label = "Microsleep detected"; emoji = "😪";
      sub = "Eyes closing for an extended moment";
    } else if (earAvg < 0.21 && this.earHistory.length > 30) {
      level = "drowsy"; label = "Drowsy"; emoji = "🥱";
      sub = "Eye openness is consistently low — you seem tired";
    } else if (blinkRate > 28) {
      level = "drowsy"; label = "Fatigued"; emoji = "😓";
      sub = `Blinking ${blinkRate}×/min — high blink rate indicates eye strain or fatigue`;
    } else if (blinkRate < 6 && this.earHistory.length >= this.HISTORY_LEN) {
      level = "alert"; label = "Very alert"; emoji = "🎯";
      sub = `Low blink rate (${blinkRate}×/min) — eyes wide open, highly focused`;
    } else if (earAvg > 0.28 && blinkRate >= 8 && blinkRate <= 20) {
      level = "alert"; label = "Alert & active"; emoji = "✅";
      sub = `Good eye openness and normal blink rate (${blinkRate}×/min)`;
    } else {
      level = "normal"; label = "Normal"; emoji = "🙂";
      sub = `Eye openness normal — blink rate ${blinkRate}×/min`;
    }

    return { level, ear, earAvg, blinkRate, closedMs, label, sub, emoji };
  }

  reset() {
    this.earHistory = [];
    this.blinkTimestamps = [];
    this.eyesClosedSince = null;
    this.wasBelow = false;
  }
}

const alertnessTracker = new AlertnessTracker();

// ── MediaPipe loading stages for the progress UI ─────────────────────────────
type LoadStage =
  | "idle"
  | "downloading-face-mesh"
  | "initializing"
  | "warming-up"
  | "ready"
  | "failed";

const STAGE_LABELS: Record<LoadStage, string> = {
  idle:                      "Waiting...",
  "downloading-face-mesh":   "Downloading face model (1/2)",
  initializing:              "Initializing AI model (2/2)",
  "warming-up":              "Warming up — detecting your face...",
  ready:                     "MediaPipe 468 landmarks",
  failed:                    "Face detector unavailable",
};


// ─── Component ────────────────────────────────────────────────────────────────
export function CameraCheckScreen({ candidateName, onReady, onBack }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const animRef     = useRef<number>(0);
  const faceMeshRef = useRef<any>(null);
  const mpCamRef    = useRef<any>(null);
  const missCount   = useRef(0);
  const firstFaceRef = useRef(false);

  const [camOk,       setCamOk]       = useState<boolean | null>(null);
  const [micOk,       setMicOk]       = useState<boolean | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [micLevel,    setMicLevel]    = useState(0);
  const [retrying,    setRetrying]    = useState(false);
  const [rechecking,  setRechecking]  = useState(false);
  const [countdown,   setCountdown]   = useState<number | null>(null);
  const [hints,       setHints]       = useState<EnvHint[]>([]);
  const [loadStage,   setLoadStage]   = useState<LoadStage>("idle");
  const [loadPct,     setLoadPct]     = useState(0);
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [postureHint, setPostureHint] = useState<PostureHint>({
    text: "Loading face detector...", sub: "One moment", status: "info", icon: "ok",
  });

  const modelsReady = loadStage === "ready";

  // countdown ticker
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { const t = setTimeout(onReady, 400); return () => clearTimeout(t); }
    const t = setTimeout(() => setCountdown(c => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onReady]);

  // Animate loadPct smoothly toward a target
  const animatePct = useCallback((target: number) => {
    setLoadPct(prev => {
      if (prev >= target) return prev;
      // Jump immediately then settle
      return target;
    });
  }, []);

  // ── Draw landmarks on canvas (mirrored coords for display) ──────────
  const drawLandmarks = useCallback((rawLm: { x: number; y: number; z: number }[], W: number, H: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // FIX: Mirror landmarks for drawing because canvas is scale-x-[-1]
    // so we need to flip X so dots land on the correct (visually mirrored) position
    const lm = mirrorLandmarks(rawLm);

    ctx.fillStyle = "rgba(139,92,246,0.45)";
    for (const pt of lm) {
      ctx.beginPath();
      ctx.arc(pt.x * W, pt.y * H, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const leftEyeIdx  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
    const rightEyeIdx = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];

    const drawEyeContour = (indices: number[], color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      indices.forEach((idx, i) => {
        const p = lm[idx];
        if (i === 0) ctx.moveTo(p.x * W, p.y * H);
        else ctx.lineTo(p.x * W, p.y * H);
      });
      ctx.closePath(); ctx.stroke();
      const cx = indices.reduce((s, i) => s + lm[i].x, 0) / indices.length * W;
      const cy = indices.reduce((s, i) => s + lm[i].y, 0) / indices.length * H;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    };
    drawEyeContour(leftEyeIdx,  "rgba(6,182,212,0.9)");
    drawEyeContour(rightEyeIdx, "rgba(6,182,212,0.9)");

    const nosePath = [168,6,197,195,5,4,1,19,94,2];
    ctx.strokeStyle = "rgba(251,191,36,0.6)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    nosePath.forEach((idx, i) => {
      const p = lm[idx];
      if (i === 0) ctx.moveTo(p.x * W, p.y * H);
      else ctx.lineTo(p.x * W, p.y * H);
    });
    ctx.stroke();
    const nt = lm[1];
    ctx.fillStyle = "rgba(251,191,36,0.95)";
    ctx.beginPath(); ctx.arc(nt.x * W, nt.y * H, 3, 0, Math.PI * 2); ctx.fill();

    const lipsOuter = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
    ctx.strokeStyle = "rgba(251,191,36,0.3)"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    lipsOuter.forEach((idx, i) => {
      const p = lm[idx];
      if (i === 0) ctx.moveTo(p.x * W, p.y * H);
      else ctx.lineTo(p.x * W, p.y * H);
    });
    ctx.closePath(); ctx.stroke();

    const ovalIdx = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,
                     148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
    ctx.strokeStyle = "rgba(34,197,94,0.5)"; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ovalIdx.forEach((idx, i) => {
      const p = lm[idx];
      if (i === 0) ctx.moveTo(p.x * W, p.y * H);
      else ctx.lineTo(p.x * W, p.y * H);
    });
    ctx.closePath(); ctx.stroke();
  }, []);

  // ── Init MediaPipe with loading stages ──────────────────────────────
  const initMediaPipe = useCallback(async (stream: MediaStream) => {
    try {
      // If preloaded during Setup, this resolves almost instantly.
      // If not (e.g. user navigated here directly), it starts the
      // download now and we show real progress while waiting.
      const alreadyDone = isMediaPipePreloading();
      if (!alreadyDone) {
        setLoadStage("downloading-face-mesh");
        animatePct(20);
      } else {
        setLoadStage("initializing");
        animatePct(60);
      }

      // Hard timeout — never let the user get stuck on this screen.
      // If MediaPipe hasn't loaded in 7s, mark it failed and let them
      // proceed without posture/alertness tracking.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("mediapipe-timeout")), 7000)
      );

      const { Camera: MPCamera, faceMesh } = await Promise.race([preloadMediaPipe(), timeout]);

      setLoadStage("initializing");
      animatePct(85);

      faceMesh.onResults((results: any) => {
        const video = videoRef.current;
        if (!video) return;
        const W = video.videoWidth  || 640;
        const H = video.videoHeight || 480;

        setHints(checkLighting(video));

        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
          missCount.current++;
          if (missCount.current >= 5) {
            const canvas = canvasRef.current;
            if (canvas) { canvas.width = W; canvas.height = H; canvas.getContext("2d")?.clearRect(0, 0, W, H); }
            setLiveMetrics(null);
            setPostureHint({ text: "No face detected", sub: "Face the camera — ensure good lighting", status: "warn", icon: "look" });
          }
          return;
        }

        missCount.current = 0;

        // Transition from "warming-up" to "ready" on first successful detection
        if (!firstFaceRef.current) {
          firstFaceRef.current = true;
          setLoadStage("ready");
          animatePct(100);
        }

        // RAW landmarks for analysis (unmirrored — correct angles)
        const rawLm: { x: number; y: number; z: number }[] = results.multiFaceLandmarks[0];

        // Draw with mirrored coords (canvas is CSS-flipped)
        drawLandmarks(rawLm, W, H);

        // ── Live metrics — use RAW landmarks ──────────────────────────
        const lEye    = rawLm[LM.leftEyeOuter];
        const rEye    = rawLm[LM.rightEyeOuter];
        const lCheek  = rawLm[LM.leftCheek];
        const rCheek  = rawLm[LM.rightCheek];
        const noseTip = rawLm[LM.noseTip];
        const forehead= rawLm[LM.forehead];
        const chin    = rawLm[LM.chin];

        const eyeMidX  = (lEye.x + rEye.x) / 2;
        const faceW    = Math.abs(rCheek.x - lCheek.x);
        const rollDeg  = Math.atan2((rEye.y - lEye.y) * H, (rEye.x - lEye.x) * W) * (180 / Math.PI);
        const yawOffset = (noseTip.x - eyeMidX) / Math.max(faceW, 0.01);
        const eyeContact = Math.abs(yawOffset) < 0.15 && Math.abs(rollDeg) < 18;
        const faceSize   = Math.round(faceW * 100);
        const faceH      = Math.abs(chin.y - forehead.y);
        const pitchRatio = (noseTip.y - forehead.y) / Math.max(faceH, 0.01);
        const pitchDeg   = Math.round((pitchRatio - 0.5) * 60);

        // EAR + alertness
        const ear = computeEAR(rawLm);
        const alertness = alertnessTracker.update(ear, Date.now());
        setLiveMetrics({ eyeContact, headTilt: Math.round(rollDeg * 10) / 10, faceSize, pitchDeg, alertness });
        setPostureHint(analyzePosture(rawLm, W, H));
      });

      faceMeshRef.current = faceMesh;

      setLoadStage("warming-up");
      animatePct(92);

      // Wait for the video element to actually have decodable frame data
      // (readyState >= 2 = HAVE_CURRENT_DATA). Without this, mpCam.start()
      // can begin sending blank frames immediately, causing 5+ false
      // "no face" misses before real video data arrives.
      const video = videoRef.current;
      if (video && video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const onReady = () => { video.removeEventListener("loadeddata", onReady); resolve(); };
          video.addEventListener("loadeddata", onReady);
          // Safety fallback in case the event already fired or never fires
          setTimeout(resolve, 1000);
        });
      }

      const mpCam = new MPCamera(videoRef.current, {
        onFrame: async () => { await faceMesh.send({ image: videoRef.current }); },
        width: 640, height: 480,
      });
      mpCamRef.current = mpCam;
      await mpCam.start();

      setPostureHint({ text: "Checking posture...", sub: "Sit facing the camera", status: "info", icon: "ok" });

    } catch (e) {
      console.error("MediaPipe init failed:", e);
      setLoadStage("failed");
      setPostureHint({ text: "Face detector unavailable", sub: "Posture check skipped — you can still proceed", status: "info", icon: "ok" });
    }
  }, [drawLandmarks, animatePct]);

  // ── Start devices ────────────────────────────────────────────────────
  async function startDevices() {
    setRetrying(true);
    setError(null);
    setCamOk(null);
    setMicOk(null);
    setHints([]);
    setLiveMetrics(null);
    setLoadStage("idle");
    setLoadPct(0);
    missCount.current = 0;
    firstFaceRef.current = false;
    alertnessTracker.reset();
    setPostureHint({ text: "Loading face detector...", sub: "One moment", status: "info", icon: "ok" });

    mpCamRef.current?.stop();
    // Note: faceMesh itself is a shared singleton (see mediapipe-loader.ts) —
    // we don't .close() it on retry, only stop the Camera frame-feed loop.
    streamRef.current?.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(animRef.current);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setCamOk(stream.getVideoTracks().length > 0);
      setMicOk(stream.getAudioTracks().length > 0);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch((e: any) => { if (e.name !== "AbortError") throw e; });
      }

      const audioCtx = new AudioContext();
      const src      = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const tick = () => {
        const d = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(d);
        setMicLevel(Math.min(100, Math.round(d.reduce((a, b) => a + b, 0) / d.length * 2.5)));
        animRef.current = requestAnimationFrame(tick);
      };
      tick();

      initMediaPipe(stream);

    } catch (e: any) {
      const msg =
        e.name === "NotAllowedError" ? "Camera/microphone access denied. Allow access and retry."
        : e.name === "NotFoundError"  ? "No camera or microphone found."
        : `Could not access devices: ${e.message}`;
      setError(msg); setCamOk(false); setMicOk(false);
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    startDevices();
    return () => {
      mpCamRef.current?.stop();
      // faceMesh is a shared singleton — leave it alive for the next screen/retry.
      streamRef.current?.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  function handleRecheck() {
    setRechecking(true);
    setTimeout(() => setRechecking(false), 800);
  }

  const allGood    = camOk === true && micOk === true;
  const isCounting = countdown !== null;
  const hasWarnings = hints.some(h => h.level === "warn");
  const isLoading  = loadStage !== "idle" && loadStage !== "ready" && loadStage !== "failed";

  const postureColors = {
    good: "bg-success/85 text-white border-success/40",
    warn: "bg-orange-500/85 text-white border-orange-400/40",
    info: "bg-black/65 text-white border-white/10",
  };

  const PostureIcon = () => {
    const cls = "w-3.5 h-3.5 shrink-0";
    if (postureHint.icon === "up")    return <ArrowUp    className={cls} />;
    if (postureHint.icon === "down")  return <ArrowDown  className={cls} />;
    if (postureHint.icon === "left")  return <ArrowLeft  className={cls} />;
    if (postureHint.icon === "right") return <ArrowR     className={cls} />;
    if (postureHint.icon === "closer" || postureHint.icon === "back") return <Move className={cls} />;
    if (postureHint.icon === "look")  return <Eye        className={cls} />;
    return <CheckCircle2 className={cls} />;
  };

  return (
    <div className="min-h-screen bg-app text-foreground flex flex-col relative overflow-hidden">

      <header className="sticky top-0 z-20 bg-surface/80 backdrop-blur-xl border-b border-border shrink-0">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Briefcase className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-serif text-base leading-none">tejaskrit</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground ml-1">
            <ChevronRight className="w-3.5 h-3.5" /><span>Jobs</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-foreground font-medium">AI Interview Practice</span>
          </div>
          <div className="ml-auto hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> Setup</span>
            <ChevronRight className="w-3 h-3" />
            <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 font-medium">1.5 · System Check</span>
            <ChevronRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><Video className="w-3 h-3" /> Interview</span>
            <ChevronRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /> Report</span>
          </div>
        </div>
      </header>

      <div className="pointer-events-none fixed -top-40 -left-40 w-[520px] h-[520px] rounded-full blur-[120px] opacity-25 bg-primary" />
      <div className="pointer-events-none fixed top-1/3 -right-40 w-[480px] h-[480px] rounded-full blur-[120px] opacity-20 bg-[#e8b04a]" />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="relative w-full max-w-2xl">
          <div className="relative">
            <div className="absolute -inset-px rounded-[28px] bg-gradient-to-b from-primary/40 via-border to-transparent opacity-60" />
            <div className="relative bg-surface/95 backdrop-blur-xl border border-border rounded-[28px] p-8 shadow-2xl space-y-6">

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-primary font-medium">Step 1.5 of 3</div>
                <h2 className="font-serif text-2xl mt-1">System check before interview</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Hi <span className="text-foreground font-medium">{candidateName}</span> — let's make sure your environment is set up for the best AI analysis.
                </p>
              </div>

              {/* Camera preview */}
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-border">
                <video ref={videoRef} muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none" />

                {camOk === false && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-muted-foreground">
                    <CameraOff className="w-10 h-10" /><span className="text-sm">Camera unavailable</span>
                  </div>
                )}
                {camOk === null && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-muted-foreground">
                    <Camera className="w-8 h-8 animate-pulse" /><span className="text-sm">Requesting camera access...</span>
                  </div>
                )}

                {/* ── MediaPipe Loading Overlay ── */}
                {camOk === true && isLoading && !isCounting && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-4 px-8">
                    <div className="flex items-center gap-3">
                      <div className="relative w-10 h-10">
                        <Wifi className="w-10 h-10 text-primary animate-pulse" />
                        <span className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping" />
                      </div>
                      <div>
                        <div className="text-white text-sm font-semibold">Loading AI Face Model</div>
                        <div className="text-white/60 text-[11px] mt-0.5">{STAGE_LABELS[loadStage]}</div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full max-w-xs">
                      <div className="flex justify-between text-[10px] text-white/50 mb-1.5">
                        <span>MediaPipe Face Mesh</span>
                        <span>{loadPct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400 transition-all duration-700 ease-out"
                          style={{ width: `${loadPct}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 mt-2.5 text-[10px] text-white/40">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Posture detection will activate after loading
                      </div>
                    </div>
                  </div>
                )}

                {isCounting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
                    {countdown! > 0 ? (
                      <>
                        <div key={countdown} className="font-serif text-[7rem] leading-none text-white select-none"
                          style={{ animation: "countdown-pop 0.4s ease-out" }}>{countdown}</div>
                        <p className="text-white/60 text-sm mt-4 uppercase tracking-widest">Get ready...</p>
                      </>
                    ) : (
                      <div className="font-serif text-5xl text-success select-none tracking-widest">GO!</div>
                    )}
                  </div>
                )}

                {camOk && !isCounting && (
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur px-2.5 py-1 rounded-full text-[10px] text-white">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" /> PREVIEW
                  </div>
                )}

                {camOk && !isCounting && (
                  <button onClick={handleRecheck} disabled={rechecking}
                    className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 hover:bg-black/80 disabled:opacity-50 backdrop-blur px-2.5 py-1.5 rounded-full text-[10px] text-white transition">
                    {rechecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {rechecking ? "Checking..." : "Re-check"}
                  </button>
                )}

                {/* Live HUD — only after model ready */}
                {camOk && !isCounting && liveMetrics && modelsReady && (
                  <div className="absolute top-10 right-3 pointer-events-none space-y-2">
                    {/* Main metrics HUD */}
                    <div className="bg-black/70 backdrop-blur rounded-lg px-2.5 py-1.5 text-[10px] text-white space-y-1 min-w-[118px]">
                      <div className="text-[9px] uppercase tracking-widest text-white/50 mb-1 font-semibold">Live Analysis</div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/70">Eye contact</span>
                        <span className={liveMetrics.eyeContact ? "text-cyan-400 font-medium" : "text-orange-400 font-medium"}>
                          {liveMetrics.eyeContact ? "✓ On" : "✗ Off"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/70">Head tilt</span>
                        <span className={Math.abs(liveMetrics.headTilt) < 8 ? "text-green-400 font-medium" : "text-orange-400 font-medium"}>
                          {liveMetrics.headTilt > 0 ? "+" : ""}{liveMetrics.headTilt}°
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/70">Face size</span>
                        <span className={liveMetrics.faceSize >= 10 && liveMetrics.faceSize <= 70 ? "text-green-400 font-medium" : "text-orange-400 font-medium"}>
                          {liveMetrics.faceSize}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-white/70">Pitch</span>
                        <span className={Math.abs(liveMetrics.pitchDeg) < 15 ? "text-green-400 font-medium" : "text-orange-400 font-medium"}>
                          {liveMetrics.pitchDeg > 0 ? "+" : ""}{liveMetrics.pitchDeg}°
                        </span>
                      </div>
                    </div>

                    {/* Alertness card */}
                    <div className={`backdrop-blur rounded-lg px-2.5 py-2 text-[10px] text-white min-w-[118px] border transition-all duration-500 ${
                      liveMetrics.alertness.level === "sleeping" ? "bg-red-900/80 border-red-500/50"
                      : liveMetrics.alertness.level === "drowsy"   ? "bg-orange-900/80 border-orange-500/50"
                      : liveMetrics.alertness.level === "alert"    ? "bg-cyan-900/80 border-cyan-500/50"
                      : "bg-black/70 border-white/10"
                    }`}>
                      <div className="text-[9px] uppercase tracking-widest text-white/50 mb-1.5 font-semibold">Alertness</div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-base leading-none">{liveMetrics.alertness.emoji}</span>
                        <span className={`font-semibold text-[11px] ${
                          liveMetrics.alertness.level === "sleeping" ? "text-red-300"
                          : liveMetrics.alertness.level === "drowsy" ? "text-orange-300"
                          : liveMetrics.alertness.level === "alert"  ? "text-cyan-300"
                          : "text-green-300"
                        }`}>{liveMetrics.alertness.label}</span>
                      </div>
                      <div className="mb-1">
                        <div className="flex justify-between text-[9px] text-white/40 mb-0.5">
                          <span>Eye openness</span>
                          <span>{Math.round(liveMetrics.alertness.earAvg * 100)}%</span>
                        </div>
                        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-300 ${
                            liveMetrics.alertness.level === "sleeping" ? "bg-red-400"
                            : liveMetrics.alertness.level === "drowsy" ? "bg-orange-400"
                            : liveMetrics.alertness.level === "alert"  ? "bg-cyan-400"
                            : "bg-green-400"
                          }`} style={{ width: `${Math.min(100, liveMetrics.alertness.earAvg * 300)}%` }} />
                        </div>
                      </div>
                      <div className="flex justify-between text-[9px] text-white/40">
                        <span>Blinks/min</span>
                        <span className={liveMetrics.alertness.blinkRate > 25 ? "text-orange-300" : "text-white/60"}>
                          {liveMetrics.alertness.blinkRate}
                        </span>
                      </div>
                      {(liveMetrics.alertness.level === "drowsy" || liveMetrics.alertness.level === "sleeping") && (
                        <div className="mt-1.5 text-[9px] text-orange-200/80 leading-tight border-t border-orange-500/30 pt-1.5">
                          {liveMetrics.alertness.sub}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Posture overlay — only after model ready */}
                {camOk && !isCounting && modelsReady && (
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div key={postureHint.text}
                      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border backdrop-blur-md transition-all duration-500 ${postureColors[postureHint.status]}`}
                      style={{ animation: "fade-slide-up 0.35s ease-out" }}>
                      <PostureIcon />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold leading-tight">{postureHint.text}</div>
                        <div className="text-[10px] opacity-80 leading-tight mt-0.5">{postureHint.sub}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Device status grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${camOk === true ? "border-success/40 bg-success/10" : camOk === false ? "border-destructive/40 bg-destructive/10" : "border-border bg-surface/50"}`}>
                  <Camera className={`w-4 h-4 ${camOk === true ? "text-success" : camOk === false ? "text-destructive" : "text-muted-foreground animate-pulse"}`} />
                  <div>
                    <div className="text-xs font-medium">Camera</div>
                    <div className={`text-[11px] ${camOk === true ? "text-success" : camOk === false ? "text-destructive" : "text-muted-foreground"}`}>
                      {camOk === true ? "Connected" : camOk === false ? "Not found" : "Checking..."}
                    </div>
                  </div>
                  {camOk === true && <CheckCircle2 className="w-4 h-4 text-success ml-auto" />}
                </div>

                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${micOk === true ? "border-success/40 bg-success/10" : micOk === false ? "border-destructive/40 bg-destructive/10" : "border-border bg-surface/50"}`}>
                  {micOk === false ? <MicOff className="w-4 h-4 text-destructive" /> : <Mic className={`w-4 h-4 ${micOk === true ? "text-success" : "text-muted-foreground animate-pulse"}`} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">Microphone</div>
                    {micOk === true ? (
                      <div className="flex items-end gap-[2px] mt-1 h-3">
                        {Array.from({ length: 16 }).map((_, i) => (
                          <div key={i} className="w-[3px] rounded-full bg-success transition-all duration-75"
                            style={{ height: `${micLevel > i * 6 ? Math.min(12, 4 + (micLevel / 100) * 8) : 3}px` }} />
                        ))}
                      </div>
                    ) : (
                      <div className={`text-[11px] ${micOk === false ? "text-destructive" : "text-muted-foreground"}`}>
                        {micOk === false ? "Not found" : "Checking..."}
                      </div>
                    )}
                  </div>
                  {micOk === true && <CheckCircle2 className="w-4 h-4 text-success ml-auto shrink-0" />}
                </div>

                {/* Face Detection tile with progress */}
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${
                  modelsReady ? "border-success/40 bg-success/10"
                  : loadStage === "failed" ? "border-warning/40 bg-warning/10"
                  : camOk === false ? "border-destructive/40 bg-destructive/10"
                  : "border-border bg-surface/50"
                }`}>
                  <Eye className={`w-4 h-4 shrink-0 ${modelsReady ? "text-success" : loadStage === "failed" ? "text-warning" : camOk === false ? "text-destructive" : "text-muted-foreground animate-pulse"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">Face Detection</div>
                    {isLoading && camOk === true ? (
                      <div className="mt-1.5">
                        <div className="text-[10px] text-muted-foreground mb-1">{STAGE_LABELS[loadStage]}</div>
                        <div className="h-1 rounded-full bg-border overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-700"
                            style={{ width: `${loadPct}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className={`text-[11px] ${modelsReady ? "text-success" : loadStage === "failed" ? "text-warning" : camOk === false ? "text-destructive" : "text-muted-foreground"}`}>
                        {camOk === true
                          ? modelsReady ? "MediaPipe 468 landmarks"
                          : loadStage === "failed" ? "Unavailable — skipped"
                          : "Waiting for camera..."
                          : "Needs camera"}
                      </div>
                    )}
                  </div>
                  {modelsReady && <CheckCircle2 className="w-4 h-4 text-success ml-auto shrink-0" />}
                  {isLoading && camOk === true && <Loader2 className="w-4 h-4 text-primary ml-auto shrink-0 animate-spin" />}
                </div>

                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${allGood ? "border-success/40 bg-success/10" : (camOk === false || micOk === false) ? "border-destructive/40 bg-destructive/10" : "border-border bg-surface/50"}`}>
                  <Brain className={`w-4 h-4 ${allGood ? "text-success" : (camOk === false || micOk === false) ? "text-destructive" : "text-muted-foreground animate-pulse"}`} />
                  <div>
                    <div className="text-xs font-medium">AI Scoring</div>
                    <div className={`text-[11px] ${allGood ? "text-success" : (camOk === false || micOk === false) ? "text-destructive" : "text-muted-foreground"}`}>
                      {allGood ? "Eye contact · Posture · Content" : (camOk === false || micOk === false) ? "Needs camera + mic" : "Waiting..."}
                    </div>
                  </div>
                  {allGood && <CheckCircle2 className="w-4 h-4 text-success ml-auto" />}
                </div>
              </div>

              {/* Lighting hints */}
              {camOk === true && hints.length > 0 && !isCounting && (
                <div className="space-y-2">
                  {hints.map((h, i) => (
                    <div key={i} className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border text-sm transition ${
                      h.level === "warn" ? "border-warning/40 bg-warning/10 text-warning"
                      : h.level === "info" ? "border-primary/30 bg-primary/10 text-muted-foreground"
                      : "border-success/30 bg-success/10 text-success"
                    }`}>
                      {h.level === "warn" ? <Sun className="w-4 h-4 mt-0.5 shrink-0" />
                        : h.level === "info" ? <Info className="w-4 h-4 mt-0.5 shrink-0" />
                        : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
                      {h.message}
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}
                </div>
              )}

              {allGood && !hasWarnings && !isCounting && hints.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-surface/50 border border-border rounded-xl px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  All systems ready! Sit upright, look at the camera, and speak clearly. Eye contact and posture are tracked throughout.
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={onBack} disabled={isCounting}
                  className="px-5 py-3 rounded-xl border border-border bg-surface hover:bg-secondary disabled:opacity-40 text-sm font-medium transition">
                  ← Back
                </button>
                {!allGood && !retrying && !isCounting && (
                  <button onClick={startDevices}
                    className="flex items-center gap-2 px-5 py-3 rounded-xl border border-border bg-surface hover:bg-secondary text-sm font-medium transition">
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                )}
                <button
                  onClick={() => { document.documentElement.requestFullscreen?.().catch(() => {}); setCountdown(3); }}
                  disabled={!allGood || isCounting}
                  className="flex-1 relative overflow-hidden group bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground font-medium px-6 py-3 rounded-xl transition glow-primary flex items-center justify-center gap-2 text-sm">
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  {isCounting ? <>Starting in {countdown}...</>
                    : allGood
                      ? hasWarnings
                        ? <><ArrowRight className="w-4 h-4" /> Start anyway</>
                        : <><CheckCircle2 className="w-4 h-4" /> Everything looks good — begin interview</>
                      : retrying ? <>Checking devices...</>
                      : <>Fix issues above to continue <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes countdown-pop {
          0%   { transform: scale(1.6); opacity: 0; }
          40%  { transform: scale(0.95); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fade-slide-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}