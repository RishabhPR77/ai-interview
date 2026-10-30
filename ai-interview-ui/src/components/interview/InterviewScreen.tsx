import { useEffect, useRef, useState } from "react";
import {
  Circle, Loader2, CheckCircle2, Square, Video, RotateCcw, Send, LogOut,
  AlertOctagon, Maximize2, Minimize2, SkipForward, MicOff, Briefcase, Volume2, VolumeX,
} from "lucide-react";
import { submitAnswer, skipQuestion, getInterviewState, type StartResponse } from "@/lib/interview-api";
import { LoadingRing } from "@/components/LoadingRing";
import { ApiError } from "@/lib/api";

  const SESSION_KEY = 'tejaskrit_session'

  interface Props {
    start: StartResponse;
    candidateName: string;
    jobTitle: string;
    onComplete: (endedEarly?: boolean) => void;
    onError: (message: string) => void;
  }

  const CATEGORIES = [
    { key: "technical_depth", label: "Technical Depth" },
    { key: "problem_solving", label: "Problem Solving" },
    { key: "communication_clarity", label: "Communication" },
    { key: "confidence", label: "Confidence" },
    { key: "cultural_fit", label: "Cultural Fit" },
  ];

  const PROCESSING_MESSAGES = [
    "Saving your answer...",
    "Listening to what you said...",
    "Choosing your next question...",
  ];

  type RecState = 'idle' | 'recording' | 'review' | 'processing'

  // ── Think-time before auto-recording kicks in ──────────────────────────────
  // THINK_SECONDS is the TOTAL time given (including the big alert at the end).
  // The last ALERT_SECONDS of THINK_SECONDS are shown as a big on-screen
  // countdown before recording auto-starts — they are NOT extra time on top.
  const THINK_SECONDS = 45;
  const ALERT_SECONDS = 10;

  function normalizeCategory(c?: string): string | null {
    if (!c) return null;
    const k = c.toLowerCase().replace(/[\s-]+/g, "_");
    if (k.includes("technical")) return "technical_depth";
    if (k.includes("problem")) return "problem_solving";
    if (k.includes("communication")) return "communication_clarity";
    if (k.includes("confidence")) return "confidence";
    if (k.includes("cultural") || k.includes("fit")) return "cultural_fit";
    return null;
  }

  export function InterviewScreen({ start, candidateName, jobTitle, onComplete, onError }: Props) {
    const [currentQ, setCurrentQ] = useState({
      question_id: start.question_id,
      question: start.question,
      category: start.category,
      is_follow_up: false,
    });
    const [qIndex, setQIndex] = useState(1);
    const total = start.total_questions;
    const [recState, setRecState] = useState<RecState>('idle');
    const [elapsed, setElapsed] = useState(0);
    const [timeWarning, setTimeWarning] = useState(false); // true once 2:30 is reached
    const MAX_RECORDING_SECONDS = 180; // 3 minutes hard cap
    const WARNING_AT_SECONDS = 150;    // 2:30 — show "30 seconds left" warning
    const [processingStep, setProcessingStep] = useState<number>(-1);
    const [coverage, setCoverage] = useState<Record<string, number>>(() => {
      const init: Record<string, number> = {};
      CATEGORIES.forEach(c => (init[c.key] = 0));
      const k = normalizeCategory(start.category);
      if (k) init[k] = 1;
      return init;
    });
    const [error, setError] = useState<string | null>(null);
    const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
    const [reRecordUsed, setReRecordUsed] = useState(false);
    const [showEndModal, setShowEndModal] = useState(false);
    const [endingEarly, setEndingEarly] = useState(false);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [skipUsed, setSkipUsed] = useState(false);
    const [showSkipModal, setShowSkipModal] = useState(false);
    const [skipping, setSkipping] = useState(false);
    const [mutedAlert, setMutedAlert] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [ttsEnabled, setTtsEnabled] = useState(true);
    // Audio-only fallback state
    const [cameraFailed, setCameraFailed] = useState(false);
    const [audioOnlyMode, setAudioOnlyMode] = useState(false);

    // ── Think-time / auto-start state ─────────────────────────────────────
    const [thinkSecondsLeft, setThinkSecondsLeft] = useState<number | null>(null); // null = no think timer active
    const [alertCountdown, setAlertCountdown] = useState<number | null>(null);     // 10..1 big alert, then auto-start
    const thinkTimerRef = useRef<number | null>(null);
    const alertTimerRef = useRef<number | null>(null);


    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const recGenRef = useRef<number>(0); // incremented on each re-record so stale onstop is ignored
    const timerRef = useRef<number | null>(null);
    const stepTimerRef = useRef<number | null>(null);
    const muteCheckRef = useRef<number | null>(null);
    const lastAudioRef = useRef<number>(Date.now());
    const audioCtxRef = useRef<AudioContext | null>(null);
    const recStateRef = useRef<RecState>('idle');
    recStateRef.current = recState;
    const endingEarlyRef = useRef(false);

    // TTS helpers
    function speakQuestion(text: string) {
      if (!ttsEnabled || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.92;
      utt.pitch = 1;
      utt.onstart = () => setIsSpeaking(true);
      utt.onend = () => setIsSpeaking(false);
      utt.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utt);
    }

    function stopSpeaking() {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
    }

    // Auto-read question whenever it changes
    useEffect(() => {
      if (ttsEnabled) speakQuestion(currentQ.question);
      return () => { window.speechSynthesis?.cancel(); setIsSpeaking(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentQ.question_id]);

    // Stop speaking when recording starts
    useEffect(() => {
      if (recState === 'recording') stopSpeaking();
    }, [recState]);

    // ── Auto-start countdown: give the user time to think, then a big   ──
    // ── 10s alert countdown, then auto-start recording if they haven't ──
    useEffect(() => {
      // Clear any existing timers from a previous question
      if (thinkTimerRef.current) { window.clearInterval(thinkTimerRef.current); thinkTimerRef.current = null; }
      if (alertTimerRef.current) { window.clearInterval(alertTimerRef.current); alertTimerRef.current = null; }
      setThinkSecondsLeft(null);
      setAlertCountdown(null);

      // Only run for a fresh question, while idle (not for follow-ups mid-recording etc.)
      if (recStateRef.current !== 'idle') return;

      // The "thinking" phase runs for THINK_SECONDS - ALERT_SECONDS.
      // The remaining ALERT_SECONDS are the big on-screen countdown —
      // together they add up to THINK_SECONDS total, not THINK_SECONDS + ALERT_SECONDS.
      const thinkPhaseSeconds = Math.max(0, THINK_SECONDS - ALERT_SECONDS);

      if (thinkPhaseSeconds === 0) {
        // No separate thinking phase — go straight to the alert countdown
        setAlertCountdown(ALERT_SECONDS);
        return;
      }

      setThinkSecondsLeft(thinkPhaseSeconds);

      thinkTimerRef.current = window.setInterval(() => {
        setThinkSecondsLeft(prev => {
          if (prev === null) return null;
          if (prev <= 1) {
            // Think time is up — clear this timer, start the ALERT_SECONDS alert countdown
            if (thinkTimerRef.current) { window.clearInterval(thinkTimerRef.current); thinkTimerRef.current = null; }
            if (recStateRef.current === 'idle') {
              setAlertCountdown(ALERT_SECONDS);
            }
            return null;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (thinkTimerRef.current) { window.clearInterval(thinkTimerRef.current); thinkTimerRef.current = null; }
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentQ.question_id]);

    // ── 10-second big alert countdown -> auto-start recording at 0 ──────
    useEffect(() => {
      if (alertCountdown === null) return;

      if (alertCountdown <= 0) {
        if (recStateRef.current === 'idle') startRec();
        setAlertCountdown(null);
        return;
      }

      alertTimerRef.current = window.setTimeout(() => {
        setAlertCountdown(c => (c === null ? null : c - 1));
      }, 1000);

      return () => {
        if (alertTimerRef.current) { window.clearTimeout(alertTimerRef.current); alertTimerRef.current = null; }
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [alertCountdown]);

    // Cancel any pending auto-start timers if the user starts recording manually
    function cancelAutoStartTimers() {
      if (thinkTimerRef.current) { window.clearInterval(thinkTimerRef.current); thinkTimerRef.current = null; }
      if (alertTimerRef.current) { window.clearTimeout(alertTimerRef.current); alertTimerRef.current = null; }
      setThinkSecondsLeft(null);
      setAlertCountdown(null);
    }


    useEffect(() => {
      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: true,
          });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
          // Listen for video track ended events (camera disconnected)
          stream.getVideoTracks().forEach(track => {
            track.addEventListener('ended', () => {
              console.log('[InterviewScreen] Video track ended - switching to audio-only mode');
              setCameraFailed(true);
              setAudioOnlyMode(true);
            });
          });
        } catch (e: any) {
          // Camera failed - try audio-only fallback
          console.log('[InterviewScreen] Camera failed, attempting audio-only fallback:', e.message);
          try {
            const audioStream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: true,
            });
            streamRef.current = audioStream;
            setCameraFailed(true);
            setAudioOnlyMode(true);
            console.log('[InterviewScreen] Audio-only fallback successful');
          } catch (audioErr: any) {
            setError(`Microphone access denied: ${audioErr.message}`);
          }
        }
      })();
      return () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
        if (muteCheckRef.current) window.clearInterval(muteCheckRef.current);
        if (thinkTimerRef.current) window.clearInterval(thinkTimerRef.current);
        if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
        audioCtxRef.current?.close().catch(() => {});
        window.speechSynthesis?.cancel();
      };
    }, []);

    useEffect(() => {
      const handler = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', handler);
      return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    useEffect(() => {
      function handleKey(e: KeyboardEvent) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const state = recStateRef.current;
        if (e.code === 'Space' && state === 'idle') {
          e.preventDefault();
          startRec();
        }
        if (e.code === 'Enter' && state === 'review') {
          e.preventDefault();
          submitPending();
        }
      }
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, []);

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }

    function saveSession(nextQId: number, nextQ: string, nextCat: string, nextIndex: number) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          session_id: start.session_id,
          candidate_name: candidateName,
          question_id: nextQId,
          question: nextQ,
          category: nextCat,
          total_questions: total,
          qIndex: nextIndex,
          candidateName,
          jobTitle,
        }));
      } catch {}
    }

    async function handleEndEarly() {
      if (endingEarlyRef.current) return;
      endingEarlyRef.current = true;
      setEndingEarly(true);
      try {
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
        if (muteCheckRef.current) window.clearInterval(muteCheckRef.current);
        audioCtxRef.current?.close().catch(() => {});
        onComplete(true);
      } catch (e: any) {
        endingEarlyRef.current = false;
        setEndingEarly(false);
        setShowEndModal(false);
        setError(e.message ?? "Failed to end interview");
      }
    }

    function startAudioMonitor() {
      if (!streamRef.current) return;
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(streamRef.current);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        lastAudioRef.current = Date.now();

        muteCheckRef.current = window.setInterval(() => {
          const data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          if (avg > 3) {
            lastAudioRef.current = Date.now();
            setMutedAlert(false);
          } else {
            const silentSec = (Date.now() - lastAudioRef.current) / 1000;
            if (silentSec >= 5) setMutedAlert(true);
          }
        }, 1000);
      } catch {}
    }

    function stopAudioMonitor() {
      if (muteCheckRef.current) {
        window.clearInterval(muteCheckRef.current);
        muteCheckRef.current = null;
      }
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      setMutedAlert(false);
    }

    function startRec() {
      if (!streamRef.current) return;
      cancelAutoStartTimers();
      chunksRef.current = [];
      const gen = ++recGenRef.current; // capture current generation

      // Check if we have a live video track (if camera failed, we're audio-only)
      const hasVideo = streamRef.current.getVideoTracks().some(t => t.readyState === 'live');

      let mime: string;
      let blobType: string;
      if (hasVideo) {
        mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm";
        blobType = "video/webm";
      } else {
        // Audio-only: use an audio codec
        mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "audio/ogg;codecs=opus";
        blobType = mime;
      }

      // The server analyses video at 640×480, so a modest bitrate loses nothing
      // and keeps uploads quick on home connections.
      const rec = new MediaRecorder(streamRef.current, { mimeType: mime, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        // Ignore if this recorder was replaced by a re-record
        if (gen !== recGenRef.current) return;
        const blob = new Blob(chunksRef.current, { type: blobType });
        setPendingBlob(blob);
        setRecState('review');
      };
      rec.start(1000);
      recorderRef.current = rec;
      setRecState('recording');
      setElapsed(0);
      setTimeWarning(false);
      timerRef.current = window.setInterval(() => {
        setElapsed(e => {
          const next = e + 1;
          if (next === WARNING_AT_SECONDS) {
            setTimeWarning(true);
          }
          if (next >= MAX_RECORDING_SECONDS) {
            // Hit the 3-minute cap — auto-stop the recording
            stopRec();
          }
          return next;
        });
      }, 1000);
      startAudioMonitor();
    }

    function stopRec() {
      recorderRef.current?.stop();
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setTimeWarning(false);
      stopAudioMonitor();
    }

    function doReRecord() {
      // Bump generation first so the stopping recorder's onstop is ignored
      recGenRef.current++;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopAudioMonitor();
      setPendingBlob(null);
      setReRecordUsed(true);
      setRecState('idle');
      setTimeWarning(false);
      startRec();
    }

    function applyNextQuestion(res: Awaited<ReturnType<typeof submitAnswer>>) {
      if (res.question_id && res.question) {
        const isFollow = !!res.is_follow_up;
        const newIndex = isFollow ? qIndex : Math.min(res.question_number ?? qIndex + 1, total);
        setCurrentQ({
          question_id: res.question_id,
          question: res.question,
          category: res.category ?? "",
          is_follow_up: isFollow,
        });
        if (!isFollow) setQIndex(newIndex);
        if (!isFollow) {
          const k = normalizeCategory(res.category);
          if (k) setCoverage(prev => ({ ...prev, [k]: (prev[k] ?? 0) + 1 }));
        }
        saveSession(res.question_id, res.question, res.category ?? "", newIndex);
      }
      setRecState('idle');
      setPendingBlob(null);
      setReRecordUsed(false);
      setProcessingStep(-1);
    }

    // The server says this question was already handled (double-submit, lost
    // response, another tab): jump to wherever the interview actually is.
    async function resyncWithServer(): Promise<boolean> {
      try {
        const state = await getInterviewState(start.session_id);
        if (state.status === "complete") {
          onComplete();
          return true;
        }
        applyNextQuestion(state);
        return true;
      } catch {
        return false;
      }
    }

    async function submitPending() {
      if (!pendingBlob) return;
      setError(null);
      setRecState('processing');
      setProcessingStep(0);
      stepTimerRef.current = window.setInterval(() => {
        setProcessingStep(s => Math.min(s + 1, PROCESSING_MESSAGES.length - 1));
      }, 1500);

      try {
        const res = await submitAnswer(start.session_id, currentQ.question_id, pendingBlob, !!cameraFailed);
        if (stepTimerRef.current) { window.clearInterval(stepTimerRef.current); stepTimerRef.current = null; }

        if (res.status === "complete") {
          onComplete();
          return;
        }

        applyNextQuestion(res);
      } catch (e: any) {
        if (stepTimerRef.current) {
          window.clearInterval(stepTimerRef.current);
          stepTimerRef.current = null;
        }
        setProcessingStep(-1);
        if (e instanceof ApiError && e.code === "stale_question" && await resyncWithServer()) {
          setError("That answer had already been received — continuing with the next question.");
          return;
        }
        // Keep the recording so a transient failure never costs the candidate
        // their answer: back to review, where Submit retries.
        setRecState('review');
        const msg = e.message ?? "Submission failed";
        setError(`${msg} Your recording is saved — press Submit to try again.`);
        onError(msg);
      }
    }

    async function handleSkip() {
      setShowSkipModal(false);
      setSkipUsed(true);
      setSkipping(true);
      try {
        const res = await skipQuestion(start.session_id, currentQ.question_id);
        if (res.status === "complete") {
          onComplete();
          return;
        }
        applyNextQuestion(res);
      } catch (e: any) {
        if (e instanceof ApiError && e.code === "stale_question" && await resyncWithServer()) return;
        setError(e.message ?? "Skip failed");
      } finally {
        setSkipping(false);
      }
    }

    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    const progressPct = (qIndex / total) * 100;
    const processing = recState === 'processing';

    return (
      <div className="h-[100dvh] flex flex-col overflow-hidden bg-app screen-enter">

        {/* Full-screen processing overlay */}
        {processing && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-app/85 backdrop-blur-md gap-7 px-6 text-center">
            <LoadingRing size={128} />
            <div>
              <p className="font-serif text-2xl sm:text-3xl">
                {PROCESSING_MESSAGES[Math.min(processingStep, PROCESSING_MESSAGES.length - 1)]}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Your next question will be here in a moment.</p>
            </div>
          </div>
        )}

        {/* Auto-record countdown banner — non-blocking, question stays visible */}
        {alertCountdown !== null && alertCountdown > 0 && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 bg-destructive/95 backdrop-blur-md text-destructive-foreground px-6 py-3 rounded-2xl shadow-2xl border border-destructive-foreground/10 animate-in fade-in slide-in-from-top-4">
            <div
              key={alertCountdown}
              className="font-serif text-4xl leading-none tabular-nums select-none"
              style={{ animation: "countdown-pop 0.4s ease-out" }}
            >
              {alertCountdown}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-wide">Recording starts automatically...</span>
              <span className="text-xs opacity-80">
                Press <kbd className="px-1.5 py-0.5 rounded border border-destructive-foreground/30 bg-destructive-foreground/10 font-mono">Space</kbd> to start now
              </span>
            </div>
          </div>
        )}

        {/* ── Tejaskrit platform header ─────────────────────────────── */}
        <div className="shrink-0 border-b border-border bg-surface/80 backdrop-blur-xl z-10">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <Briefcase className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="font-serif text-base leading-none">tejaskrit</span>
            </div>
            <div className="h-4 w-px bg-border mx-1 hidden sm:block" />
            <span className="text-xs text-muted-foreground hidden sm:block">AI Interview Practice</span>

            {/* Progress bar — center */}
            <div className="flex-1 flex items-center gap-3 mx-3">
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Q <span className="text-foreground font-semibold">{qIndex}</span>/{total}
              </span>
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:block">
                {Math.round(progressPct)}%
              </span>
            </div>

            {/* Topic coverage: one dot per category, filled once a question has covered it */}
            <div className="hidden lg:flex items-center gap-1.5 shrink-0" aria-label="Topics covered">
              {CATEGORIES.map(c => {
                const ok = (coverage[c.key] ?? 0) > 0;
                return (
                  <span key={c.key} title={`${c.label}: ${coverage[c.key] ?? 0} question(s)`}
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${ok ? 'border-success/40 bg-success/15 text-success' : 'border-border text-muted-foreground'}`}>
                    {c.label.split(' ')[0]}
                  </span>
                );
              })}
            </div>

            {/* Right: candidate name + fullscreen + end early */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground truncate max-w-[140px] hidden xl:block">
                {candidateName}
              </span>
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-secondary transition"
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setShowEndModal(true)}
                disabled={processing || endingEarly}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" /> End Early
              </button>
            </div>
          </div>
        </div>

        {/* Video-call stage: the camera fills the screen, the question floats on top, controls float at the bottom */}
        <div className="flex-1 min-h-0 p-2 sm:p-4">
          <div className="relative h-full w-full max-w-6xl mx-auto rounded-2xl sm:rounded-3xl overflow-hidden bg-black border border-border">
            {!cameraFailed && (
              <video
                ref={videoRef}
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
            )}
            {cameraFailed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/60 text-center px-6">
                <div className="w-16 h-16 rounded-full bg-warning/15 border border-warning/30 flex items-center justify-center">
                  <MicOff className="w-8 h-8 text-warning" />
                </div>
                <p className="text-white font-medium">Audio-only mode</p>
                <p className="text-xs text-muted-foreground max-w-xs">Camera unavailable. Your answers are recorded as audio only — video analysis is skipped.</p>
              </div>
            )}
            {!streamRef.current && !error && !cameraFailed && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground gap-2 text-sm">
                <Loader2 className="w-5 h-5 animate-spin" /> Connecting camera…
              </div>
            )}

            {/* Soft shading so the floating panels stay readable over any background */}
            <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

            {/* Question card */}
            <div className="absolute top-3 inset-x-3 sm:top-5 sm:left-5 sm:right-auto sm:max-w-2xl max-h-[50%] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent] rounded-2xl border border-white/10 bg-black/55 backdrop-blur-md p-4 sm:p-5 text-white">
              <div className="flex items-center gap-2 flex-wrap mb-2 text-[11px] uppercase tracking-wider">
                <span className="text-primary font-semibold">Question {qIndex} of {total}</span>
                {currentQ.category && <span className="text-white/50">· {currentQ.category.replace(/_/g, " ")}</span>}
                {currentQ.is_follow_up && (
                  <span className="normal-case tracking-normal text-xs font-medium px-2 py-0.5 rounded-full bg-warning/20 text-warning border border-warning/30">Follow-up</span>
                )}
              </div>
              <h2 className="font-serif text-lg sm:text-xl lg:text-2xl leading-snug">{currentQ.question}</h2>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => isSpeaking ? stopSpeaking() : speakQuestion(currentQ.question)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 transition text-white/80"
                  title={isSpeaking ? "Stop reading" : "Read question aloud"}
                >
                  {isSpeaking ? <><VolumeX className="w-3.5 h-3.5" /> Stop</> : <><Volume2 className="w-3.5 h-3.5" /> Read aloud</>}
                </button>
                <button
                  onClick={() => { setTtsEnabled(v => !v); stopSpeaking(); }}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${ttsEnabled ? "border-white/15 text-white/70 hover:bg-white/10" : "border-destructive/40 text-destructive bg-destructive/15"}`}
                  title={ttsEnabled ? "Auto-read is on - click to turn off" : "Auto-read is off - click to turn on"}
                >
                  {ttsEnabled ? "Auto-read on" : "Auto-read off"}
                </button>
              </div>
              {thinkSecondsLeft !== null && recState === 'idle' && (
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-1000 ease-linear ${thinkSecondsLeft <= 5 ? 'bg-warning' : 'bg-primary'}`}
                      style={{ width: `${(thinkSecondsLeft / Math.max(1, THINK_SECONDS - ALERT_SECONDS)) * 100}%` }}
                    />
                  </div>
                  <span className={`text-xs whitespace-nowrap ${thinkSecondsLeft <= 5 ? 'text-warning font-medium' : 'text-white/60'}`}>
                    Recording starts in {thinkSecondsLeft + ALERT_SECONDS}s
                  </span>
                </div>
              )}
            </div>

            {/* Bottom: status line + floating control bar */}
            <div className="absolute inset-x-0 bottom-3 sm:bottom-5 px-3 flex flex-col items-center gap-2">
              {mutedAlert && recState === 'recording' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-white bg-destructive/90 px-3 py-1.5 rounded-full animate-pulse">
                  <MicOff className="w-3.5 h-3.5" /> Mic may be muted — no audio detected
                </div>
              )}
              {recState === 'recording' && timeWarning && (
                <div className="text-xs font-medium text-white bg-warning/85 px-3 py-1.5 rounded-full">30s left — recording stops automatically at 3:00</div>
              )}
              {recState === 'review' && (
                <div className="text-xs sm:text-sm text-white/85 bg-black/55 backdrop-blur px-3 py-1.5 rounded-full text-center">
                  <CheckCircle2 className="inline w-3.5 h-3.5 text-success -mt-0.5 mr-1" />
                  Answer recorded — submit it{!reRecordUsed ? ", or re-record once" : ""}.
                </div>
              )}
              {error && (
                <div className="text-xs sm:text-sm text-white bg-destructive/85 rounded-xl px-3 py-2 max-w-lg text-center">{error}</div>
              )}

              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 backdrop-blur-md p-1.5 sm:p-2 shadow-2xl">
                {recState === 'recording' && (
                  <div className={`flex items-center gap-1.5 pl-2.5 pr-1 text-xs font-medium tabular-nums ${timeWarning ? 'text-warning' : 'text-white'}`}>
                    <Circle className="w-2.5 h-2.5 fill-destructive text-destructive animate-blink" /> {mm}:{ss}
                  </div>
                )}

                {recState === 'idle' && (
                  <>
                    <button
                      onClick={startRec}
                      className="flex items-center gap-2 bg-success hover:bg-success/90 text-success-foreground font-medium px-5 sm:px-6 py-2.5 sm:py-3 rounded-full transition"
                    >
                      <Video className="w-5 h-5" /> Start answering
                    </button>
                    {!skipUsed && !currentQ.is_follow_up && (
                      <button
                        onClick={() => setShowSkipModal(true)}
                        disabled={skipping}
                        className="flex items-center gap-1.5 text-white/80 hover:bg-white/10 font-medium px-4 py-2.5 sm:py-3 rounded-full transition text-sm disabled:opacity-50"
                        title="Skip this question (1 use per interview)"
                      >
                        <SkipForward className="w-4 h-4" /> Skip
                      </button>
                    )}
                  </>
                )}

                {recState === 'recording' && (
                  <button
                    onClick={stopRec}
                    className="flex items-center gap-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-medium px-5 sm:px-6 py-2.5 sm:py-3 rounded-full transition"
                  >
                    <Square className="w-4 h-4 fill-current" /> Stop
                  </button>
                )}

                {recState === 'review' && (
                  <>
                    <button
                      onClick={submitPending}
                      className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-5 sm:px-6 py-2.5 sm:py-3 rounded-full transition glow-primary"
                    >
                      <Send className="w-4 h-4" /> Submit answer
                    </button>
                    {!reRecordUsed && (
                      <button
                        onClick={doReRecord}
                        className="flex items-center gap-1.5 text-white/85 hover:bg-white/10 font-medium px-4 py-2.5 sm:py-3 rounded-full transition text-sm"
                        title="You can re-record once per question"
                      >
                        <RotateCcw className="w-4 h-4" /> Re-record
                      </button>
                    )}
                  </>
                )}
              </div>

              {(recState === 'idle' || recState === 'review') && (
                <p className="text-[11px] text-white/45 hidden sm:block">
                  {recState === 'idle' && <>Press <kbd className="px-1.5 py-0.5 rounded border border-white/15 bg-white/5 font-mono text-[10px]">Space</kbd> to start</>}
                  {recState === 'review' && <>Press <kbd className="px-1.5 py-0.5 rounded border border-white/15 bg-white/5 font-mono text-[10px]">Enter</kbd> to submit</>}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Skip Confirmation Modal */}
        {showSkipModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="relative w-full max-w-md bg-surface border border-border rounded-2xl p-8 shadow-2xl">
              <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-gradient-to-r from-warning/80 via-warning/40 to-warning/20" />
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-14 h-14 rounded-full bg-warning/10 border border-warning/30 flex items-center justify-center">
                  <SkipForward className="w-7 h-7 text-warning" />
                </div>
                <div>
                  <h2 className="font-serif text-2xl">Skip this question?</h2>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    You can only skip <strong className="text-foreground">one question</strong> per interview.
                    The skipped question will be recorded with a score of 0 in your report.
                  </p>
                </div>
                <div className="flex w-full gap-3 pt-1">
                  <button
                    onClick={() => setShowSkipModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-border bg-secondary hover:bg-secondary/80 text-sm font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSkip}
                    className="flex-1 px-4 py-3 rounded-xl bg-warning hover:bg-warning/90 text-warning-foreground text-sm font-medium transition flex items-center justify-center gap-2"
                  >
                    <SkipForward className="w-4 h-4" /> Skip Question
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Early End Confirmation Modal */}
        {showEndModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="relative w-full max-w-md bg-surface border border-border rounded-2xl p-8 shadow-2xl">
              <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-gradient-to-r from-destructive/80 via-warning/60 to-destructive/40" />
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center">
                  <AlertOctagon className="w-8 h-8 text-destructive" />
                </div>
                <div>
                  <h2 className="font-serif text-2xl">End Interview?</h2>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    You've completed <strong className="text-foreground">{Math.max(0, qIndex - 1)} of {total}</strong> questions.
                    Ending now will generate a <span className="text-warning font-medium">partial report</span> — scores
                    will be based only on what you've answered so far.
                  </p>
                </div>
                <div className="w-full bg-background/60 border border-border rounded-xl px-4 py-3 text-xs text-muted-foreground text-left space-y-1">
                  <div className="flex items-center gap-2"><span className="text-warning">⚠</span> Incomplete data — {total - (qIndex - 1)} question{total - (qIndex - 1) !== 1 ? 's' : ''} unanswered</div>
                  <div className="flex items-center gap-2"><span className="text-warning">⚠</span> AI confidence in final scores will be lower</div>
                  <div className="flex items-center gap-2"><span className="text-destructive">✕</span> This action cannot be undone</div>
                </div>
                <div className="flex w-full gap-3 pt-1">
                  <button
                    onClick={() => setShowEndModal(false)}
                    disabled={endingEarly}
                    className="flex-1 px-4 py-3 rounded-xl border border-border bg-secondary hover:bg-secondary/80 text-sm font-medium transition disabled:opacity-50"
                  >
                    Keep Going
                  </button>
                  <button
                    onClick={handleEndEarly}
                    disabled={endingEarly}
                    className="flex-1 px-4 py-3 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-medium transition flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {endingEarly
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                      : <><LogOut className="w-4 h-4" /> End & Get Report</>
                    }
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <style>{`
          @keyframes countdown-pop {
            0%   { transform: scale(1.6); opacity: 0; }
            40%  { transform: scale(0.95); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }