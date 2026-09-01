// ── Shared MediaPipe FaceMesh loader ─────────────────────────────────────────
// MediaPipe's WASM binary + face landmark model (several MB) are NOT fetched
// when the <script> tags load — they're fetched lazily when
// `new FaceMesh(...)` is constructed AND `.initialize()` (or the first
// `.send()`) runs. To make the camera-check screen feel instant, we kick this
// whole process off as a module-level singleton the moment SetupScreen mounts,
// so by the time the user reaches camera-check it's already done (or close to it).

declare global {
  interface Window {
    FaceMesh: any;
    Camera: any;
  }
}

const CAMERA_UTILS_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";
const FACE_MESH_URL    = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js";
const LOCATE_FILE_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      // Already added (maybe still loading) — wait for it if not yet loaded
      if ((existing as any)._loaded) { resolve(); return; }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => { (s as any)._loaded = true; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export interface MediaPipeBundle {
  FaceMesh: any;
  Camera: any;
  faceMesh: any; // already constructed + initialize()'d instance, ready for onResults + send()
}

let bundlePromise: Promise<MediaPipeBundle> | null = null;

/**
 * Kicks off (or returns the existing) MediaPipe load.
 * Safe to call multiple times — subsequent calls return the same promise.
 * The heavy lifting (`faceMesh.initialize()`) happens here, not in the
 * camera-check screen.
 */
export function preloadMediaPipe(): Promise<MediaPipeBundle> {
  if (bundlePromise) return bundlePromise;

  bundlePromise = (async () => {
    await Promise.all([loadScript(CAMERA_UTILS_URL), loadScript(FACE_MESH_URL)]);

    const FaceMesh = window.FaceMesh;
    const Camera   = window.Camera;

    const faceMesh = new FaceMesh({
      locateFile: (file: string) => `${LOCATE_FILE_BASE}${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // This is the call that actually fetches the WASM + model binary (~several MB).
    // Doing it here means it happens while the user is still on Setup.
    await faceMesh.initialize();

    return { FaceMesh, Camera, faceMesh };
  })();

  // If it fails, allow retrying later instead of caching a rejected promise forever
  bundlePromise.catch(() => { bundlePromise = null; });

  return bundlePromise;
}

/** True if a preload has already been kicked off (regardless of completion). */
export function isMediaPipePreloading(): boolean {
  return bundlePromise !== null;
}