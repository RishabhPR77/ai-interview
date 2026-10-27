import os
import numpy as np
from typing import Optional


def _get_cv2():
    import cv2
    return cv2


def _get_mp():
    import mediapipe as mp
    return mp


def analyze_video(video_path: str, sample_interval_seconds: float = 0.5) -> dict:
    try:
        cv2 = _get_cv2()
        mp = _get_mp()
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return _empty_video_signals("could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps
        sample_every_n = max(1, int(fps * sample_interval_seconds))

        print(f"      [video] {width}x{height} @ {fps:.1f}fps  |  {total_frames} frames  |  {duration:.1f}s")

        frame_results = []
        frame_idx = 0
        faces_detected = 0
        frames_sampled = 0
        model_path = _ensure_model("face_landmarker.task", FACE_MODEL_URL)

        base_options = mp_python.BaseOptions(model_asset_path=model_path)
        options = mp_vision.FaceLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.VIDEO,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            num_faces=1,
            min_face_detection_confidence=0.2,
            min_face_presence_confidence=0.2,
            min_tracking_confidence=0.2,
        )

        # Body pose (posture + hand gestures) via the Tasks PoseLandmarker —
        # mp.solutions.pose no longer exists in current MediaPipe releases.
        # If the model can't load, posture falls back to face geometry only.
        pose_landmarker = None
        try:
            pose_options = mp_vision.PoseLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=_ensure_model("pose_landmarker_lite.task", POSE_MODEL_URL)
                ),
                running_mode=mp_vision.RunningMode.VIDEO,
                num_poses=1,
                min_pose_detection_confidence=0.4,
                min_pose_presence_confidence=0.4,
                min_tracking_confidence=0.4,
            )
            pose_landmarker = mp_vision.PoseLandmarker.create_from_options(pose_options)
        except Exception as e:
            print(f"      [video] Pose model unavailable ({e}) — using face-based posture only")

        with mp_vision.FaceLandmarker.create_from_options(options) as landmarker:
            last_timestamp_ms = -1
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                if frame_idx % sample_every_n == 0:
                    timestamp_ms = int((frame_idx / fps) * 1000)
                    if timestamp_ms <= last_timestamp_ms:
                        timestamp_ms = last_timestamp_ms + 1
                    last_timestamp_ms = timestamp_ms
                    frames_sampled += 1
                    result, face_found = _analyze_frame(
                        frame, landmarker, pose_landmarker, timestamp_ms, frame_idx / fps
                    )
                    result["face_found"] = face_found
                    if face_found:
                        faces_detected += 1
                    frame_results.append(result)
                frame_idx += 1

        cap.release()
        if pose_landmarker is not None:
            pose_landmarker.close()

        print(f"      [video] Face detected in {faces_detected}/{frames_sampled} sampled frames")

        if not frame_results:
            return _empty_video_signals("the recording contained no readable video frames")

        if faces_detected == 0:
            print("      [video] WARNING: No faces detected — video may be too dark or face not visible.")
            return _empty_video_signals("no face was visible in the recording (too dark, or off-camera)")

        # Detect glasses from iris variance across all frames
        glasses_detected = _detect_glasses(frame_results)
        if glasses_detected:
            print("      [video] Glasses detected — using head-pose-only eye contact (iris landmarks disabled)")

        signals = _aggregate(frame_results, duration, glasses_detected)
        signals["face_detected_pct"] = round(faces_detected / frames_sampled * 100, 1) if frames_sampled else 0.0
        signals["pose_tracking"] = pose_landmarker is not None
        return signals

    except Exception as e:
        import traceback
        print(f"      [video] ERROR in analyze_video: {e}")
        traceback.print_exc()
        return _empty_video_signals("video analysis failed on the server")


FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"


def _ensure_model(filename: str, url: str) -> str:
    import urllib.request
    model_dir = os.path.join(os.path.expanduser("~"), ".cache", "mediapipe")
    os.makedirs(model_dir, exist_ok=True)
    model_path = os.path.join(model_dir, filename)
    if not os.path.exists(model_path):
        print(f"Downloading MediaPipe model {filename}...")
        tmp_path = model_path + ".part"
        urllib.request.urlretrieve(url, tmp_path)
        os.replace(tmp_path, model_path)  # never leave a half-written model behind
        print("Model downloaded.")
    return model_path


def _analyze_frame(frame, landmarker, pose_landmarker, timestamp_ms: int, timestamp_sec: float):
    """Returns (result_dict, face_was_detected)."""
    cv2 = _get_cv2()
    mp = _get_mp()

    result = {
        "timestamp":             timestamp_sec,
        "eye_contact":           False,
        "eye_contact_uncertain": True,
        "eye_contact_matrix":    None,
        "eye_contact_iris":      None,
        "iris_left_x":           None,
        "iris_right_x":          None,
        "gaze_direction":        "unknown",
        # expression
        "expression":             "neutral",
        "expression_confidence":  0.5,
        "yawning":                False,
        "heavy_blink":            False,
        "eye_widening":           False,
        "smirking":               False,
        "contempt":               False,
        "disgust":                False,
        "looking_down_eyes":      False,
        "jaw_clench":             False,
        "brow_inner_raise":       False,
        "genuine_smile":          False,
        "jaw_open":               0.0,   # raw jaw open (0-1) for temporal analysis
        "blink_score":            0.0,   # raw blink score (0-1)
        # posture
        "posture_score":   5.0,
        "posture_detail":  None,
        "position_class":  "unknown",   # upright/reclined/possibly_laying/etc.
        # nervousness composite
        "nervousness_signals": [],
    }

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    detection = landmarker.detect_for_video(mp_image, timestamp_ms)

    if not detection.face_landmarks:
        return result, False

    landmarks = detection.face_landmarks[0]
    matrix = detection.facial_transformation_matrixes[0] if detection.facial_transformation_matrixes else None

    # --- Eye contact: matrix-first, iris-second, NO fallback ---
    ec_matrix, ec_iris, iris_lx, iris_rx = _gaze_multi(landmarks, matrix)
    result["eye_contact_matrix"] = ec_matrix
    result["eye_contact_iris"] = ec_iris
    result["iris_left_x"] = iris_lx
    result["iris_right_x"] = iris_rx

    if ec_matrix is not None:
        result["eye_contact"] = ec_matrix
        result["eye_contact_uncertain"] = False
        result["gaze_direction"] = "center" if ec_matrix else "off-camera"
    elif ec_iris is not None:
        result["eye_contact"] = ec_iris
        result["eye_contact_uncertain"] = False
        result["gaze_direction"] = "center" if ec_iris else "off-camera"
    else:
        # No reliable signal — mark uncertain, exclude from % later
        result["eye_contact"] = False
        result["eye_contact_uncertain"] = True
        result["gaze_direction"] = "uncertain"

    # --- Comprehensive behavioral analysis (expressions, fatigue, micro-expressions) ---
    behavior = _analyze_behavior_signals(detection, landmarks)
    result["expression"]            = behavior["expression"]
    result["expression_confidence"] = behavior["expression_confidence"]
    result["yawning"]               = behavior["yawning"]
    result["heavy_blink"]           = behavior["heavy_blink"]
    result["eye_widening"]          = behavior["eye_widening"]
    result["smirking"]              = behavior["smirking"]
    result["contempt"]              = behavior["contempt"]
    result["disgust"]               = behavior["disgust"]
    result["looking_down_eyes"]     = behavior["looking_down_eyes"]
    result["jaw_clench"]            = behavior["jaw_clench"]
    result["brow_inner_raise"]      = behavior["brow_inner_raise"]
    result["genuine_smile"]         = behavior["genuine_smile"]
    result["jaw_open"]              = behavior["jaw_open"]
    result["blink_score"]           = behavior["blink_score"]

    # Nervousness composite: keep existing + add new signals
    if behavior["lip_compression"]:
        result["nervousness_signals"].append("lip_compression")
    if behavior["brow_furrow"]:
        result["nervousness_signals"].append("brow_furrow")
    if behavior["jaw_clench"]:
        result["nervousness_signals"].append("jaw_clench")
    if behavior["looking_down_eyes"]:
        result["nervousness_signals"].append("looking_down")
    if behavior["yawning"]:
        result["nervousness_signals"].append("yawning")

    # --- Posture: rich multi-metric analysis ---
    posture_detail = None
    posture_score  = 5.0

    body_posture, gesture_detected = _posture_from_pose(pose_landmarker, mp_image, timestamp_ms)

    if body_posture is not None:
        posture_detail = _compute_posture_rich(landmarks, matrix)
        posture_score  = round(
            (body_posture * 0.6 + (posture_detail["alignment"] if posture_detail else 5.0) * 0.4), 1
        )
    else:
        posture_detail = _compute_posture_rich(landmarks, matrix)
        if posture_detail is not None:
            posture_score = posture_detail["alignment"]

    result["posture_score"]   = posture_score
    result["posture_detail"]  = posture_detail
    result["position_class"]  = _classify_position(posture_detail)
    result["gesture_detected"] = gesture_detected

    return result, True


def _gaze_multi(landmarks, matrix):
    """
    Glasses-safe multi-method gaze detection.

    Method 1 (PRIMARY): Head pose transformation matrix — glasses-safe.
                        Tightened to ±20° yaw, ±15° pitch.
    Method 2 (SECONDARY): Iris position relative to eye corners.
                           Only trusted when both iris readings are stable.

    Returns: (ec_matrix, ec_iris, iris_left_x, iris_right_x)
    Each of ec_matrix / ec_iris is True (looking at camera), False (not), or None (unavailable).
    """
    ec_matrix = None
    ec_iris = None
    iris_lx = None
    iris_rx = None

    # --- Method 1: head pose matrix ---
    if matrix is not None:
        try:
            m = _parse_matrix(matrix)
            yaw   = np.arctan2(-m[2][1], m[2][2]) * (180 / np.pi)
            pitch = np.arcsin(np.clip(-m[2][0], -1.0, 1.0)) * (180 / np.pi)
            ec_matrix = (abs(yaw) <= 20 and abs(pitch) <= 15)
        except Exception:
            pass

    # --- Method 2: iris landmarks ---
    try:
        def _iris_rel(iris_idx, outer_idx, inner_idx, top_idx, bot_idx):
            ix = landmarks[iris_idx].x
            ow = landmarks[outer_idx].x
            iw = landmarks[inner_idx].x
            ew = abs(ow - iw)
            if ew < 0.001:
                return None, None
            rx = (ix - min(ow, iw)) / ew
            iy = landmarks[iris_idx].y
            et = landmarks[top_idx].y
            eb = landmarks[bot_idx].y
            eh = abs(eb - et)
            ry = (iy - et) / eh if eh > 0.001 else 0.5
            return rx, ry

        lx, ly = _iris_rel(468, 33, 133, 159, 145)
        rx, ry = _iris_rel(473, 263, 362, 386, 374)

        if lx is not None and rx is not None:
            iris_lx = lx
            iris_rx = rx
            in_center = (
                0.30 <= lx <= 0.70 and 0.25 <= ly <= 0.75 and
                0.30 <= rx <= 0.70 and 0.25 <= ry <= 0.75
            )
            ec_iris = in_center
    except Exception:
        pass

    return ec_matrix, ec_iris, iris_lx, iris_rx


def _detect_glasses(frame_results: list) -> bool:
    """
    Detect if the candidate is wearing glasses by measuring iris landmark
    instability. Glasses cause lens distortion/glare that makes iris x-positions
    jump erratically even when the head is relatively still.

    Returns True if glasses are likely present.
    """
    left_xs = [f["iris_left_x"] for f in frame_results if f["iris_left_x"] is not None]
    right_xs = [f["iris_right_x"] for f in frame_results if f["iris_right_x"] is not None]

    if len(left_xs) < 5 or len(right_xs) < 5:
        return False

    left_std = float(np.std(left_xs))
    right_std = float(np.std(right_xs))
    avg_std = (left_std + right_std) / 2

    # High iris variance (> 0.07) with no corresponding head movement = glasses
    # This threshold was tuned: normal eye movement is ~0.03-0.05 std dev
    return avg_std > 0.07


def _posture_from_pose(pose_landmarker, mp_image, timestamp_ms: int) -> tuple:
    """
    Use MediaPipe PoseLandmarker body landmarks for posture scoring + gesture detection.
    Checks: shoulder tilt, forward lean, head drop.
    Returns (posture_score or None, gesture_detected bool).
    """
    if pose_landmarker is None:
        return None, False
    try:
        from mediapipe.tasks.python.vision import PoseLandmark as PL

        results = pose_landmarker.detect_for_video(mp_image, timestamp_ms)
        if not results.pose_landmarks:
            return None, False

        lm = results.pose_landmarks[0]

        left_shoulder  = lm[PL.LEFT_SHOULDER.value]
        right_shoulder = lm[PL.RIGHT_SHOULDER.value]
        left_ear       = lm[PL.LEFT_EAR.value]
        right_ear      = lm[PL.RIGHT_EAR.value]
        nose           = lm[PL.NOSE.value]
        lw = lm[PL.LEFT_WRIST.value]
        rw = lm[PL.RIGHT_WRIST.value]

        # 1. Shoulder tilt — how uneven are the shoulders?
        shoulder_tilt = abs(left_shoulder.y - right_shoulder.y)
        tilt_penalty  = min(4.0, shoulder_tilt * 20)

        # 2. Forward lean — ear should be above shoulder horizontally.
        avg_ear_x       = (left_ear.x + right_ear.x) / 2
        avg_shoulder_x  = (left_shoulder.x + right_shoulder.x) / 2
        forward_lean    = max(0.0, avg_ear_x - avg_shoulder_x)
        lean_penalty    = min(3.0, forward_lean * 15)

        # 3. Head drop — nose should not be below shoulder level
        avg_shoulder_y  = (left_shoulder.y + right_shoulder.y) / 2
        head_drop       = max(0.0, nose.y - avg_shoulder_y + 0.1)
        drop_penalty    = min(3.0, head_drop * 10)

        posture_score = max(0.0, min(10.0, 10.0 - tilt_penalty - lean_penalty - drop_penalty))

        # Gesture detection: wrist raised above shoulder = active hand gesture
        gesture_detected = bool(
            ((lw.visibility or 0) > 0.5 and lw.y < left_shoulder.y - 0.05) or
            ((rw.visibility or 0) > 0.5 and rw.y < right_shoulder.y - 0.05)
        )

        return round(posture_score, 1), gesture_detected
    except Exception:
        return None, False


def _parse_matrix(matrix) -> np.ndarray:
    """
    Convert a MediaPipe facial transformation matrix to a 4x4 numpy array.
    Handles both API styles:
      - New Tasks API (0.10+): matrix is already a numpy ndarray (4x4)
      - Old Tasks API: matrix is an object with a .data flat list of 16 floats
    """
    if isinstance(matrix, np.ndarray):
        return matrix.reshape(4, 4) if matrix.ndim == 1 else matrix
    # Old API: object with .data attribute (flat 16-element list)
    return np.array([[matrix.data[i * 4 + j] for j in range(4)] for i in range(4)])


def _posture_from_matrix(matrix) -> float:
    try:
        m = _parse_matrix(matrix)
        pitch = np.arcsin(np.clip(-m[2][0], -1.0, 1.0)) * (180 / np.pi)
        roll  = np.arctan2(m[1][0], m[0][0]) * (180 / np.pi)
        yaw   = np.arctan2(-m[2][1], m[2][2]) * (180 / np.pi)
        pitch_penalty = min(6.0, abs(pitch) / 5) if pitch < -10 else (min(3.0, pitch / 10) if pitch > 15 else 0)
        roll_penalty  = min(3.0, abs(roll) / 10)
        yaw_penalty   = min(2.0, abs(yaw) / 15)
        return round(max(0.0, min(10.0, 10.0 - pitch_penalty - roll_penalty - yaw_penalty)), 1)
    except Exception as e:
        print(f"      [posture_matrix_err] {e}")
        return 5.0


def _compute_posture_rich(landmarks, matrix) -> Optional[dict]:
    """
    Rich per-frame posture analysis combining face transformation matrix
    (rotation angles) with landmark geometry (proximity, roll, lean).

    Measures:
      - Yaw  : left/right head turn (matrix preferred, else landmark geometry)
      - Pitch: chin up/down tilt
      - Roll : head cant / lateral tilt (from eye-corner angle)
      - Face size: proxy for forward engagement lean
      - Alignment score: 0-10, weighted penalty from all four axes

    Returns a dict or None if landmarks are invalid.
    """
    try:
        # --- Face geometry (always available) ---
        nose_x     = landmarks[1].x
        left_edge  = landmarks[234].x
        right_edge = landmarks[454].x
        face_width = abs(right_edge - left_edge)
        if face_width < 0.01:
            return None

        # Roll: angle of the line between left and right eye outer corners
        lex_x = float(landmarks[33].x);  lex_y = float(landmarks[33].y)
        rex_x = float(landmarks[263].x); rex_y = float(landmarks[263].y)
        roll_deg = abs(float(np.degrees(np.arctan2(lex_y - rex_y, rex_x - lex_x))))
        # roll_deg == 0 means level; increases as head tilts sideways

        # Face size (engagement proximity): larger = leaning in
        face_size = float(face_width)

        if matrix is not None:
            # --- Matrix path: accurate yaw/pitch/roll ---
            m = _parse_matrix(matrix)
            pitch_deg = float(np.arcsin(np.clip(-m[2][0], -1.0, 1.0)) * (180 / np.pi))
            yaw_deg   = float(np.arctan2(-m[2][1], m[2][2]) * (180 / np.pi))
            source    = "matrix"
        else:
            # --- Landmark geometry path ---
            rel_nose_x = (float(nose_x) - min(float(left_edge), float(right_edge))) / float(face_width)
            yaw_deg    = (rel_nose_x - 0.5) * 2 * 45   # approx degrees

            avg_eye_y  = (float(landmarks[159].y) + float(landmarks[386].y)) / 2
            nose_y     = float(landmarks[1].y)
            chin_y     = float(landmarks[152].y)
            upper      = abs(nose_y - avg_eye_y)
            lower      = abs(chin_y - nose_y)
            ratio      = upper / lower if lower > 0.001 else 0.62
            pitch_deg  = (ratio - 0.62) * 90   # approx degrees: positive = chin up
            source     = "landmarks"

        # --- Penalties ---
        # Yaw: penalise beyond ±5° (natural slight turn is fine)
        yaw_penalty   = min(5.0, max(0.0, abs(yaw_deg) - 5.0) / 4.5)

        # Pitch: ±10° tolerance (nodding/looking up/down while explaining is normal)
        pitch_penalty = min(4.0, max(0.0, abs(pitch_deg) - 10.0) / 5.0)

        # Roll: penalise tilt beyond 5°
        roll_penalty  = min(3.0, max(0.0, roll_deg - 5.0) / 6.0)

        # Lean: too far back (disengaged) or too close (aggressive) both penalised
        if face_size < 0.18:
            lean_penalty = min(2.0, (0.18 - face_size) * 18.0)
        elif face_size > 0.60:
            lean_penalty = min(1.5, (face_size - 0.60) * 10.0)
        else:
            lean_penalty = 0.0

        alignment = round(max(0.0, min(10.0,
            10.0 - yaw_penalty - pitch_penalty - roll_penalty - lean_penalty
        )), 2)

        return {
            "alignment": alignment,
            "yaw":       round(float(yaw_deg),   1),
            "pitch":     round(float(pitch_deg),  1),
            "roll":      round(float(roll_deg),   1),
            "face_size": round(float(face_size),  3),
            "source":    source,
        }
    except Exception as e:
        print(f"      [posture_rich_err] {e}")
        return None


def _analyze_behavior_signals(detection, landmarks) -> dict:
    """
    Comprehensive per-frame behavioral analysis.

    Detects (from blendshapes + landmarks):
      - Yawning               : jaw wide + eyes squinting
      - Heavy blink           : extended eye closure (fatigue)
      - Eye widening          : alertness / surprise / focus
      - Smirking              : asymmetric smile
      - Contempt              : one-sided mouth twist (no smile)
      - Disgust               : nose sneer
      - Looking down (eyes)   : gaze directed downward (notes/phone)
      - Jaw clench            : pressed lips (stress/tension)
      - Brow inner raise      : genuine worry or engaged concern
      - Genuine smile         : cheek squint confirms Duchenne smile
      - Lip compression       : tight mouth (nervousness)
      - Brow furrow           : concentration or stress
      - Raw jaw_open / blink  : for temporal drowsiness analysis
    """
    out = {
        "expression": "neutral", "expression_confidence": 0.5,
        "yawning": False, "heavy_blink": False, "eye_widening": False,
        "smirking": False, "contempt": False, "disgust": False,
        "looking_down_eyes": False, "jaw_clench": False,
        "brow_inner_raise": False, "genuine_smile": False,
        "lip_compression": False, "brow_furrow": False,
        "jaw_open": 0.0, "blink_score": 0.0,
    }

    # ── Landmark-based signals (always available when face detected) ──────────
    try:
        out["lip_compression"] = abs(float(landmarks[14].y) - float(landmarks[13].y)) < 0.005
        avg_brow = (float(landmarks[107].y) + float(landmarks[336].y)) / 2
        out["brow_furrow"]     = (avg_brow - float(landmarks[9].y)) < 0.02
    except Exception:
        pass

    # ── Blendshape-based signals ──────────────────────────────────────────────
    if not detection.face_blendshapes:
        return out

    try:
        bs = {b.category_name: float(b.score) for b in detection.face_blendshapes[0]}

        jaw_open      = bs.get("jawOpen", 0.0)
        blink_l       = bs.get("eyeBlinkLeft", 0.0)
        blink_r       = bs.get("eyeBlinkRight", 0.0)
        blink         = max(blink_l, blink_r)
        smile_l       = bs.get("mouthSmileLeft", 0.0)
        smile_r       = bs.get("mouthSmileRight", 0.0)
        brow_down_l   = bs.get("browDownLeft", 0.0)
        brow_down_r   = bs.get("browDownRight", 0.0)
        brow_inner    = bs.get("browInnerUp", 0.0)
        eye_wide_l    = bs.get("eyeWideLeft", 0.0)
        eye_wide_r    = bs.get("eyeWideRight", 0.0)
        sneer_l       = bs.get("noseSneerLeft", 0.0)
        sneer_r       = bs.get("noseSneerRight", 0.0)
        mouth_l       = bs.get("mouthLeft", 0.0)
        mouth_r       = bs.get("mouthRight", 0.0)
        look_dn_l     = bs.get("eyeLookDownLeft", 0.0)
        look_dn_r     = bs.get("eyeLookDownRight", 0.0)
        press_l       = bs.get("mouthPressLeft", 0.0)
        press_r       = bs.get("mouthPressRight", 0.0)
        cheek_sq_l    = bs.get("cheekSquintLeft", 0.0)
        cheek_sq_r    = bs.get("cheekSquintRight", 0.0)

        out["jaw_open"]    = jaw_open
        out["blink_score"] = blink

        # Yawning: wide jaw + at least partial eye squint/closure
        out["yawning"]           = jaw_open > 0.65 and blink > 0.25

        # Heavy blink: eyes nearly shut (fatigue / drowsiness)
        out["heavy_blink"]       = blink > 0.85

        # Eye widening: alertness, strong focus, or surprise
        out["eye_widening"]      = max(eye_wide_l, eye_wide_r) > 0.50

        # Smirking: highly asymmetric smile
        out["smirking"]          = abs(smile_l - smile_r) > 0.35 and max(smile_l, smile_r) > 0.28

        # Contempt: one-sided mouth corner displacement without a real smile
        out["contempt"]          = abs(mouth_l - mouth_r) > 0.25 and max(smile_l, smile_r) < 0.30

        # Disgust: nose sneer activation
        out["disgust"]           = max(sneer_l, sneer_r) > 0.35

        # Looking down (eyes): could be reading notes or phone
        out["looking_down_eyes"] = (look_dn_l + look_dn_r) / 2 > 0.40

        # Jaw clench / pressed lips: stress or tension
        out["jaw_clench"]        = (press_l + press_r) / 2 > 0.40

        # Brow inner raise: genuine worry, deep thought, or engaged concern
        out["brow_inner_raise"]  = brow_inner > 0.45

        # Genuine Duchenne smile: cheek squint confirms the smile is real
        smile_any = max(smile_l, smile_r) > 0.50
        out["genuine_smile"]     = smile_any and max(cheek_sq_l, cheek_sq_r) > 0.40

        # ── Primary expression label (priority order) ─────────────────────
        brow_down = max(brow_down_l, brow_down_r)
        smile     = max(smile_l, smile_r)

        if out["yawning"]:
            out["expression"], out["expression_confidence"] = "yawning",       jaw_open
        elif out["disgust"]:
            out["expression"], out["expression_confidence"] = "disgusted",      max(sneer_l, sneer_r)
        elif out["contempt"]:
            out["expression"], out["expression_confidence"] = "contemptuous",   abs(mouth_l - mouth_r)
        elif out["smirking"]:
            out["expression"], out["expression_confidence"] = "smirking",       abs(smile_l - smile_r)
        elif smile > 0.50:
            label = "smiling_genuine" if out["genuine_smile"] else "smiling"
            out["expression"], out["expression_confidence"] = label,            smile
        elif jaw_open > 0.60 and not out["yawning"]:
            out["expression"], out["expression_confidence"] = "surprised",      jaw_open
        elif brow_down > 0.40:
            out["expression"], out["expression_confidence"] = "stressed",       brow_down
        elif out["heavy_blink"] or (blink > 0.70 and jaw_open < 0.20):
            out["expression"], out["expression_confidence"] = "tired",          blink
        elif out["eye_widening"] and brow_inner > 0.30:
            out["expression"], out["expression_confidence"] = "focused",        max(eye_wide_l, eye_wide_r)
        else:
            out["expression"], out["expression_confidence"] = "neutral",        0.80

    except Exception as e:
        print(f"      [behavior_signals_err] {e}")

    return out


def _classify_position(posture_detail: Optional[dict]) -> str:
    """
    Classify the interviewee's physical sitting position from posture metrics.

    Uses pitch (chin angle), roll (head tilt), and face size (distance/lean):

      possibly_laying          — extreme pitch or roll: head nearly horizontal
      possibly_laying_sideways — very large roll angle (head rotated 90°)
      reclined                 — significant backward tilt, face looking upward
      hunching_forward         — chin down + large face (close + drooping head)
      leaning_side             — noticeable lateral head tilt
      too_far                  — face very small, person far from camera
      too_close                — face very large, uncomfortably close
      upright                  — good sitting position
      unknown                  — no posture data available
    """
    if posture_detail is None:
        return "unknown"

    pitch   = posture_detail.get("pitch",     0.0)
    roll    = posture_detail.get("roll",      0.0)
    face_sz = posture_detail.get("face_size", 0.30)

    # Extreme pitch backward (face pointing up) = reclined / possibly laying
    if pitch < -50:
        return "possibly_laying"
    if pitch < -28:
        return "reclined"

    # Extreme pitch forward (face pointing down) = possibly laying face-down or extreme hunch
    if pitch > 50:
        return "possibly_laying"

    # Extreme roll = head tilted almost horizontal = laying on side
    if roll > 40:
        return "possibly_laying_sideways"
    if roll > 22:
        return "leaning_side"

    # Proximity
    if face_sz < 0.11:
        return "too_far"
    if face_sz > 0.65:
        return "too_close"

    # Forward hunch: close to camera + chin pitched down
    if pitch > 16 and face_sz > 0.38:
        return "hunching_forward"

    # Reclined without extreme pitch: small face + mild upward pitch
    if face_sz < 0.17 and pitch < -8:
        return "reclined"

    return "upright"


def _aggregate(frame_results: list, duration: float, glasses_detected: bool = False) -> dict:
    total = len(frame_results)

    # ── Eye contact ──────────────────────────────────────────────────────────
    if glasses_detected:
        definite_frames = [f for f in frame_results if f["eye_contact_matrix"] is not None]
        contact_frames  = [f for f in definite_frames if f["eye_contact_matrix"] is True]
    else:
        definite_frames = [f for f in frame_results if not f["eye_contact_uncertain"]]
        contact_frames  = [f for f in definite_frames if f["eye_contact"]]

    eye_contact_pct = round(len(contact_frames) / len(definite_frames) * 100, 1) if definite_frames else 0.0

    # ── Expression ───────────────────────────────────────────────────────────
    expr_scores = {
        "smiling_genuine": 10.0, "smiling": 9.0, "focused": 8.5,
        "neutral": 7.0, "surprised": 5.5, "stressed": 3.0,
        "tired": 3.0, "yawning": 2.0, "disgusted": 2.5,
        "contemptuous": 2.0, "smirking": 4.0,
    }
    # Confidence-weighted mean over frames where a face was found. Frames
    # without a face carry no expression information and must not drag it down.
    face_frames = [f for f in frame_results if f.get("face_found")]
    weight_sum = sum(f["expression_confidence"] for f in face_frames)
    avg_expression = round(
        sum(expr_scores.get(f["expression"], 5.0) * f["expression_confidence"] for f in face_frames) / weight_sum, 1
    ) if weight_sum > 0 else 5.0

    # ── Nervousness ──────────────────────────────────────────────────────────
    all_nerv    = [n for f in frame_results for n in f["nervousness_signals"]]
    nerv_counts: dict = {}
    for n in all_nerv:
        nerv_counts[n] = nerv_counts.get(n, 0) + 1
    frequent_nerv = [k for k, v in nerv_counts.items() if v >= total * 0.2]

    # ── Posture ───────────────────────────────────────────────────────────────
    posture_agg   = _aggregate_posture_rich(frame_results)
    final_posture = posture_agg["posture_score"]

    # ── Fatigue & drowsiness ──────────────────────────────────────────────────
    yawn_events       = _detect_yawn_events(frame_results)
    drowsiness_score  = _compute_drowsiness_score(frame_results, yawn_events)
    fatigue_traj      = _compute_fatigue_trajectory(frame_results)

    # ── Position breakdown ────────────────────────────────────────────────────
    position_counts: dict = {}
    for f in frame_results:
        pc = f.get("position_class", "unknown")
        position_counts[pc] = position_counts.get(pc, 0) + 1
    position_breakdown = {k: round(v / total * 100, 1) for k, v in position_counts.items()}
    dominant_position  = max(position_counts, key=position_counts.get) if position_counts else "unknown"

    # ── Head movement pattern ─────────────────────────────────────────────────
    head_pattern = _detect_head_movement_pattern(frame_results)

    # ── Micro-expression events ───────────────────────────────────────────────
    micro_events = _detect_micro_expression_events(frame_results)

    # ── Attention arc (eye contact trend: early vs late) ─────────────────────
    attention_arc = _compute_attention_arc(frame_results, glasses_detected)

    # ── Misc behavioral counts ────────────────────────────────────────────────
    looking_down_count  = sum(1 for f in frame_results if f.get("looking_down_eyes"))
    looking_down_pct    = round(looking_down_count / total * 100, 1)
    contempt_detected   = any(f.get("contempt")     for f in frame_results)
    disgust_detected    = any(f.get("disgust")       for f in frame_results)
    smirk_detected      = any(f.get("smirking")      for f in frame_results)
    genuine_smile_frames = sum(1 for f in frame_results if f.get("genuine_smile"))
    smiling_frames       = sum(1 for f in frame_results if f.get("expression", "").startswith("smiling"))
    genuine_smile_pct    = round(genuine_smile_frames / smiling_frames * 100, 1) if smiling_frames else 0.0

    # ── Gesture frequency (fraction of frames with active wrist gesture) ──────
    gesture_frames    = sum(1 for f in frame_results if f.get("gesture_detected"))
    gesture_frequency = round(gesture_frames / total, 3)

    # ── Engagement ───────────────────────────────────────────────────────────
    drowsiness_penalty = min(2.0, drowsiness_score / 5.0)
    engagement = round(
        max(0.0, (eye_contact_pct / 100 * 4) +
                 (avg_expression  / 10  * 3) +
                 (final_posture   / 10  * 3) -
                  drowsiness_penalty),
        1
    )

    # ── Per-frame timeline ────────────────────────────────────────────────────
    timeline = [
        {
            "second":          round(f["timestamp"], 1),
            "expression":      f["expression"],
            "gaze":            f["gaze_direction"],
            "nervousness":     f["nervousness_signals"],
            "posture_score":   round(float(f["posture_score"]), 1),
            "position_class":  f.get("position_class", "unknown"),
            "posture_yaw":     round(float(f["posture_detail"]["yaw"]),   1) if f.get("posture_detail") else None,
            "posture_pitch":   round(float(f["posture_detail"]["pitch"]), 1) if f.get("posture_detail") else None,
            "posture_roll":    round(float(f["posture_detail"]["roll"]),  1) if f.get("posture_detail") else None,
            "yawning":         f.get("yawning", False),
            "eye_widening":    f.get("eye_widening", False),
            "looking_down":    f.get("looking_down_eyes", False),
        }
        for f in frame_results
    ]

    print(f"      Done. Eye contact: {eye_contact_pct}% | "
          f"Posture: {final_posture} ({dominant_position}) | "
          f"Drowsiness: {drowsiness_score:.1f}/10 | "
          f"Yawns: {len(yawn_events)} | "
          f"Head: {head_pattern}")

    return {
        # ── Core scores ──
        "eye_contact_percentage":  eye_contact_pct,
        "avg_expression_score":    avg_expression,
        "posture_score":           final_posture,
        "engagement_score":        engagement,
        # ── Posture detail ──
        "posture_breakdown":       posture_agg["posture_breakdown"],
        "posture_slump_events":    _detect_posture_slump_events(frame_results),
        "dominant_position":       dominant_position,
        "position_breakdown":      position_breakdown,
        # ── Fatigue & drowsiness ──
        "drowsiness_score":        round(drowsiness_score, 1),
        "yawn_count":              len(yawn_events),
        "yawn_events":             yawn_events,
        "fatigue_trajectory":      fatigue_traj,
        # ── Head & movement ──
        "head_movement_pattern":   head_pattern,
        # ── Behavioral signals ──
        "contempt_detected":       contempt_detected,
        "disgust_detected":        disgust_detected,
        "smirk_detected":          smirk_detected,
        "genuine_smile_pct":       genuine_smile_pct,
        "looking_down_pct":        looking_down_pct,
        "micro_expression_events": micro_events,
        "attention_arc":           attention_arc,
        # ── Nervousness ──
        "nervousness_indicators":  frequent_nerv,
        "gesture_frequency":       gesture_frequency,
        "expression_timeline":     timeline,
        "look_away_events":        _detect_look_away_events(frame_results, glasses_detected),
        "glasses_detected":        glasses_detected,
        "video_available":         True,
        "unavailable_reason":      None,
    }


def _empty_video_signals(reason: str = "") -> dict:
    return {
        "eye_contact_percentage":  0.0,
        "avg_expression_score":    5.0,
        "posture_score":           5.0,
        "engagement_score":        5.0,
        "posture_breakdown":       {},
        "posture_slump_events":    [],
        "dominant_position":       "unknown",
        "position_breakdown":      {},
        "drowsiness_score":        0.0,
        "yawn_count":              0,
        "yawn_events":             [],
        "fatigue_trajectory":      "none",
        "head_movement_pattern":   "unknown",
        "contempt_detected":       False,
        "disgust_detected":        False,
        "smirk_detected":          False,
        "genuine_smile_pct":       0.0,
        "looking_down_pct":        0.0,
        "micro_expression_events": [],
        "attention_arc":           "unknown",
        "nervousness_indicators":  [],
        "gesture_frequency":       0.0,
        "expression_timeline":     [],
        "look_away_events":        [],
        "glasses_detected":        False,
        # Callers must treat every number above as "unknown", not as a measurement.
        "video_available":         False,
        "unavailable_reason":      reason or "video analysis unavailable",
    }


def _aggregate_posture_rich(frame_results: list) -> dict:
    """
    Compute a final posture score that reflects explaining quality, not just
    whether someone is sitting perfectly still.

    Three components (all 0-10):
      1. Alignment (50%): average per-frame alignment score across all frames.
         Measures how well head is centered, level, and appropriately close.
      2. Consistency (30%): what fraction of frames have alignment >= 6.0.
         Penalises people who occasionally slump even if they often sit straight.
      3. Dynamics (20%): natural head movement = good explainer.
         - Frozen/stiff (very low movement): 7.0 — technically fine but rigid
         - Natural variation (moderate yaw std): 10.0 — engaged, animated
         - Excessive movement (high yaw std): decreasing score — distracted

    Additionally applies a "worst-stretch penalty" if there is a sustained run
    of bad-posture frames (alignment < 5.5), ensuring a long slump cannot be
    hidden by an otherwise-decent average.
    """
    valid = [f for f in frame_results if f.get("posture_detail") is not None]

    if len(valid) < 2:
        # Fallback: use raw posture_score floats if no rich detail available
        scores = [float(f["posture_score"]) for f in frame_results]
        if not scores:
            return {"posture_score": 5.0, "posture_breakdown": {}}
        return {
            "posture_score": round(float(np.mean(scores)), 1),
            "posture_breakdown": {"frames_analyzed": len(scores), "method": "score_average"},
        }

    alignments  = [float(f["posture_detail"]["alignment"]) for f in valid]
    yaw_vals    = [float(f["posture_detail"]["yaw"])       for f in valid]
    face_sizes  = [float(f["posture_detail"]["face_size"]) for f in valid]

    # 1. Alignment score
    mean_alignment = float(np.mean(alignments))

    # 2. Consistency score
    good_frames       = sum(1 for a in alignments if a >= 6.0)
    consistency_score = (good_frames / len(alignments)) * 10.0

    # 3. Dynamics score — moderate yaw variation = natural explanation style
    yaw_std = float(np.std(yaw_vals))
    if yaw_std < 1.5:
        dynamics_score = 7.0    # stiff / barely moving
    elif yaw_std <= 12.0:
        dynamics_score = 10.0   # natural range of head movement
    elif yaw_std <= 20.0:
        dynamics_score = 8.0    # animated but slightly excessive
    else:
        dynamics_score = max(4.0, 10.0 - (yaw_std - 20.0) * 0.2)

    # 4. Engagement lean bonus/penalty
    mean_face = float(np.mean(face_sizes))
    if 0.22 <= mean_face <= 0.52:
        lean_bonus = 0.5    # good interview distance, slight lean-in
    elif mean_face < 0.15 or mean_face > 0.65:
        lean_bonus = -1.0   # too far back or uncomfortably close
    else:
        lean_bonus = 0.0

    # 5. Worst-stretch penalty: sustained bad posture run
    bad_run_max = 0
    bad_run_cur = 0
    for a in alignments:
        if a < 5.5:
            bad_run_cur += 1
            bad_run_max = max(bad_run_max, bad_run_cur)
        else:
            bad_run_cur = 0
    bad_run_pct     = bad_run_max / len(alignments)
    bad_run_penalty = round(min(2.5, bad_run_pct * 10.0), 2)

    # Weighted final score
    raw = (
        mean_alignment  * 0.50 +
        consistency_score * 0.30 +
        dynamics_score  * 0.20
    ) + lean_bonus - bad_run_penalty

    final_score = round(float(max(0.0, min(10.0, raw))), 1)

    return {
        "posture_score": final_score,
        "posture_breakdown": {
            "alignment":            round(mean_alignment, 1),
            "consistency":          round(consistency_score, 1),
            "dynamics":             round(dynamics_score, 1),
            "lean_bonus":           round(lean_bonus, 2),
            "worst_stretch_penalty": bad_run_penalty,
            "frames_analyzed":      len(valid),
            "yaw_std_deg":          round(yaw_std, 1),
            "mean_face_size":       round(mean_face, 3),
        },
    }


def _detect_posture_slump_events(frame_results: list,
                                  threshold: float = 6.0,
                                  min_duration_s: float = 1.5) -> list:
    """
    Identify sustained periods where posture alignment dropped below threshold.
    Similar to look_away_events but for posture.
    Returns a list of {start, end, duration, avg_score} dicts.
    """
    events    = []
    in_slump  = False
    slump_start = 0.0
    slump_scores: list = []

    for f in frame_results:
        ts    = float(f["timestamp"])
        score = float(f["posture_score"])
        bad   = score < threshold

        if bad and not in_slump:
            in_slump    = True
            slump_start = ts
            slump_scores = [score]
        elif bad and in_slump:
            slump_scores.append(score)
        elif not bad and in_slump:
            dur = round(ts - slump_start, 1)
            if dur >= min_duration_s:
                events.append({
                    "start":     round(slump_start, 1),
                    "end":       round(ts, 1),
                    "duration":  dur,
                    "avg_score": round(float(np.mean(slump_scores)), 1),
                })
            in_slump = False
            slump_scores = []

    if in_slump and frame_results:
        last_ts = float(frame_results[-1]["timestamp"])
        dur = round(last_ts - slump_start, 1)
        if dur >= min_duration_s:
            events.append({
                "start":     round(slump_start, 1),
                "end":       round(last_ts, 1),
                "duration":  dur,
                "avg_score": round(float(np.mean(slump_scores)), 1),
            })

    return events


def _detect_look_away_events(frame_results: list, glasses_detected: bool = False,
                              min_duration: float = 1.0) -> list:
    """
    Find contiguous segments where the candidate is not making eye contact.
    Lowered min_duration to 1.0s (was 1.5s) to catch real distraction events
    that fall between 1-second sample points.
    Uncertain frames are treated as look-away events.
    """
    events = []
    in_event = False
    event_start = 0.0

    for frame in frame_results:
        if glasses_detected:
            looking_away = frame["eye_contact_matrix"] is not True
        else:
            looking_away = not frame["eye_contact"] or frame["eye_contact_uncertain"]

        if looking_away and not in_event:
            in_event = True
            event_start = frame["timestamp"]
        elif not looking_away and in_event:
            dur = round(frame["timestamp"] - event_start, 1)
            if dur >= min_duration:
                events.append({"start": round(event_start, 1), "end": round(frame["timestamp"], 1), "duration": dur})
            in_event = False

    if in_event and frame_results:
        last_ts = frame_results[-1]["timestamp"]
        dur = round(last_ts - event_start, 1)
        if dur >= min_duration:
            events.append({"start": round(event_start, 1), "end": round(last_ts, 1), "duration": dur})

    return events


def _detect_yawn_events(frame_results: list) -> list:
    """
    Find discrete yawn events: contiguous frames where yawning=True,
    collapsed into single events with timestamp.
    Returns list of {timestamp, duration_s}.
    """
    events   = []
    in_yawn  = False
    start_ts = 0.0

    for f in frame_results:
        ts = float(f["timestamp"])
        if f.get("yawning") and not in_yawn:
            in_yawn  = True
            start_ts = ts
        elif not f.get("yawning") and in_yawn:
            dur = round(ts - start_ts, 1)
            events.append({"timestamp": round(start_ts, 1), "duration_s": max(dur, 0.5)})
            in_yawn = False

    if in_yawn and frame_results:
        dur = round(float(frame_results[-1]["timestamp"]) - start_ts, 1)
        events.append({"timestamp": round(start_ts, 1), "duration_s": max(dur, 0.5)})

    return events


def _compute_drowsiness_score(frame_results: list, yawn_events: list) -> float:
    """
    Composite drowsiness score 0–10 from multiple fatigue signals:
      - Yawn frequency   (40%): more yawns = higher drowsiness
      - Heavy blink rate (30%): sustained eye closure events
      - Posture slumping (20%): low alignment scores signal fatigue
      - Posture drop arc (10%): posture getting worse over time

    0   = very alert
    5   = mild fatigue, noticeable
    8+  = strong drowsiness
    """
    if not frame_results:
        return 0.0

    total    = len(frame_results)
    duration = max(float(frame_results[-1]["timestamp"]) - float(frame_results[0]["timestamp"]), 1.0)

    # Yawn rate per minute
    yawn_rate   = len(yawn_events) / (duration / 60.0)
    yawn_score  = min(10.0, yawn_rate * 5.0)   # 2 yawns/min → 10

    # Heavy blink rate (% of frames)
    heavy_blink_pct = sum(1 for f in frame_results if f.get("heavy_blink")) / total
    blink_score     = min(10.0, heavy_blink_pct * 30.0)   # 33% heavy blink → 10

    # Posture slump contribution
    alignments  = [float(f["posture_score"]) for f in frame_results]
    avg_align   = float(np.mean(alignments)) if alignments else 7.0
    posture_drw = max(0.0, (7.0 - avg_align) * 1.5)      # below 7 → increasing penalty

    # Posture arc: compare first third vs last third
    n3 = max(1, total // 3)
    early_align = float(np.mean([f["posture_score"] for f in frame_results[:n3]]))
    late_align  = float(np.mean([f["posture_score"] for f in frame_results[-n3:]]))
    drop_arc    = max(0.0, early_align - late_align) * 1.5   # penalise degrading posture

    composite = (yawn_score * 0.40 + blink_score * 0.30 +
                 posture_drw * 0.20 + drop_arc * 0.10)
    return round(float(min(10.0, composite)), 2)


def _compute_fatigue_trajectory(frame_results: list) -> str:
    """
    Assess whether fatigue signals are accumulating over the answer:
      "none"     — no meaningful fatigue detected
      "mild"     — light signs (some yawns or blink spikes)
      "moderate" — clear signals: yawns + increasing blink + posture drift
      "severe"   — persistent drowsiness signals throughout
    """
    if not frame_results:
        return "none"

    yawn_count   = sum(1 for f in frame_results if f.get("yawning"))
    heavy_blink  = sum(1 for f in frame_results if f.get("heavy_blink"))
    total        = len(frame_results)

    yawn_frac  = yawn_count  / total
    blink_frac = heavy_blink / total

    if yawn_frac >= 0.15 or (yawn_frac >= 0.08 and blink_frac >= 0.10):
        return "severe"
    elif yawn_frac >= 0.06 or blink_frac >= 0.15:
        return "moderate"
    elif yawn_frac >= 0.02 or blink_frac >= 0.08:
        return "mild"
    return "none"


def _detect_head_movement_pattern(frame_results: list) -> str:
    """
    Classify the interviewee's head movement pattern during their answer:

      "natural"         — moderate, purposeful movement typical of engaged explanation
      "rigid"           — almost no movement; stiff, tense presentation style
      "excessive_nod"   — strong rhythmic up-down pitch variation (over-nodding)
      "excessive_sway"  — strong side-to-side yaw variation (swaying/rocking)
      "head_bob_drowsy" — slow rhythmic head drop and recovery (drowsy nodding)
      "unknown"         — insufficient data
    """
    details = [f["posture_detail"] for f in frame_results if f.get("posture_detail")]
    if len(details) < 4:
        return "unknown"

    yaw_vals   = [float(d["yaw"])   for d in details]
    pitch_vals = [float(d["pitch"]) for d in details]

    yaw_std   = float(np.std(yaw_vals))
    pitch_std = float(np.std(pitch_vals))

    # Drowsy head bob: pitch slowly drops then recovers — high pitch std but
    # autocorrelation shows slow oscillation rather than intentional nods.
    # Approximate: high pitch std + low yaw std + posture degradation
    posture_scores = [float(f["posture_score"]) for f in frame_results]
    n3             = max(1, len(posture_scores) // 3)
    posture_drop   = float(np.mean(posture_scores[:n3])) - float(np.mean(posture_scores[-n3:]))

    if yaw_std < 1.5 and pitch_std < 1.5:
        return "rigid"
    if pitch_std > 12.0 and posture_drop > 2.0 and yaw_std < 6.0:
        return "head_bob_drowsy"
    if pitch_std > 14.0:
        return "excessive_nod"
    if yaw_std > 18.0:
        return "excessive_sway"
    return "natural"


def _detect_micro_expression_events(frame_results: list) -> list:
    """
    Detect brief non-neutral expressions that might reveal emotional reactions:
    contempt, disgust, smirk, and sudden anger/stress spikes.
    Returns list of {timestamp, type, confidence}.
    Only reports isolated events (not sustained expressions).
    """
    events     = []
    MICRO_TYPES = ["contemptuous", "disgusted", "smirking"]

    for i, f in enumerate(frame_results):
        expr = f.get("expression", "neutral")
        conf = float(f.get("expression_confidence", 0.0))

        if expr in MICRO_TYPES and conf > 0.30:
            # Check it is isolated (not sustained for 3+ consecutive frames)
            prev_same = (i > 0 and frame_results[i-1].get("expression") == expr)
            next_same = (i < len(frame_results)-1 and frame_results[i+1].get("expression") == expr)
            if not (prev_same and next_same):   # at least one edge is different
                events.append({
                    "timestamp":  round(float(f["timestamp"]), 1),
                    "type":       expr,
                    "confidence": round(conf, 2),
                })

    return events


def _compute_attention_arc(frame_results: list, glasses_detected: bool) -> str:
    """
    Compare eye-contact quality in the first half vs the second half of the answer.
    Returns:
      "consistent"  — similar attention throughout
      "improving"   — started distracted, improved
      "degrading"   — started attentive, lost focus
      "unknown"     — not enough data
    """
    if len(frame_results) < 6:
        return "unknown"

    mid = len(frame_results) // 2
    early = frame_results[:mid]
    late  = frame_results[mid:]

    def _contact_rate(frames):
        if glasses_detected:
            valid = [f for f in frames if f["eye_contact_matrix"] is not None]
            good  = [f for f in valid  if f["eye_contact_matrix"] is True]
        else:
            valid = [f for f in frames if not f["eye_contact_uncertain"]]
            good  = [f for f in valid  if f["eye_contact"]]
        return len(good) / len(valid) if valid else 0.5

    early_rate = _contact_rate(early)
    late_rate  = _contact_rate(late)
    diff       = late_rate - early_rate

    if abs(diff) < 0.10:
        return "consistent"
    elif diff > 0.10:
        return "improving"
    else:
        return "degrading"