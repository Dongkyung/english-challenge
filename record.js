import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db, storage } from "./firebase-config.js";
import {
  requireLogin,
  routeToCurrentStep,
  getSeason,
  getDayNumber,
  getWeekNumber,
  getTodayRecording,
  isAdmin,
} from "./shared.js";

const MIN_SECONDS = 60; // 완료 버튼이 활성화되는 최소 녹음 시간
const MAX_SECONDS = 300; // 자동으로 녹음이 끝나는 최대 시간

// ==================== 아이콘 ====================

const MIC_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
  <line x1="12" y1="19" x2="12" y2="23"/>
  <line x1="8" y1="23" x2="16" y2="23"/>
</svg>`;

const PAUSE_ICON = `
<svg viewBox="0 0 24 24" fill="currentColor">
  <rect x="6" y="4" width="4" height="16" rx="1"/>
  <rect x="14" y="4" width="4" height="16" rx="1"/>
</svg>`;

const PLAY_ICON = `
<svg viewBox="0 0 24 24" fill="currentColor">
  <path d="M8 5v14l11-7z"/>
</svg>`;

// ==================== DOM ====================

const dayLabel = document.getElementById("day-label");
const micButton = document.getElementById("mic-button");
const micIconSlot = document.getElementById("mic-icon-slot");
const timerDisplay = document.getElementById("timer-display");
const progressTrack = document.getElementById("progress-track");
const progressFill = document.getElementById("progress-fill");
const progressCaption = document.getElementById("progress-caption");
const recordingButtons = document.getElementById("recording-buttons");
const cancelBtn = document.getElementById("cancel-btn");
const completeBtn = document.getElementById("complete-btn");
const previewButtons = document.getElementById("preview-buttons");
const retryBtn = document.getElementById("retry-btn");
const submitBtn = document.getElementById("submit-btn");
const errorMsg = document.getElementById("record-error");

// ==================== 상태 ====================

let currentUser = null;
let currentParticipant = null;
let season = null;
let dayNumber = null;
let weekNumber = null;

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordedMimeType = "";
let timerStart = 0;
let timerHandle = null;
let elapsedSeconds = 0;

let previewAudio = null;
let isPlaying = false;

// "idle" | "recording" | "preview" | "submitting"
let state = "idle";

init();

async function init() {
  const { user, participant } = await requireLogin();

  if (isAdmin(user.uid)) {
    location.href = "list.html";
    return;
  }

  if (!participant.onboarded || participant.status === "eliminated") {
    await routeToCurrentStep(user, participant);
    return;
  }

  season = await getSeason(participant.seasonId);
  dayNumber = getDayNumber(season.startDate);
  weekNumber = getWeekNumber(dayNumber);

  if (dayNumber < 1 || dayNumber > season.totalWeeks * 7) {
    // 시즌 기간이 아직 시작 전이거나 이미 끝난 경우
    errorMsg.textContent = "지금은 녹음 가능한 기간이 아닙니다.";
    errorMsg.hidden = false;
    micButton.disabled = true;
    return;
  }

  // 오늘 이미 제출했다면 리스트로 돌려보냄 (직접 URL로 들어온 경우 대비)
  const today = await getTodayRecording(user.uid, dayNumber);
  if (today) {
    location.href = "list.html";
    return;
  }

  currentUser = user;
  currentParticipant = participant;
  dayLabel.textContent = `Day ${dayNumber} / ${season.totalWeeks * 7}`;

  setIcon(MIC_ICON);
}

// ==================== 아이콘/상태 표시 ====================

function setIcon(svg) {
  micIconSlot.innerHTML = svg;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function updateProgressUI(seconds) {
  timerDisplay.textContent = formatTime(seconds);
  const pct = Math.min(100, (seconds / MAX_SECONDS) * 100);
  progressFill.style.width = `${pct}%`;

  const canComplete = seconds >= MIN_SECONDS;
  progressFill.classList.toggle("can-complete", canComplete);
  completeBtn.disabled = !canComplete;

  progressCaption.textContent = canComplete
    ? "완료할 수 있어요 (최대 5분)"
    : `최소 ${MIN_SECONDS}초부터 완료할 수 있어요`;
}

// ==================== 녹음 시작/중지 ====================

function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

function mimeTypeToExtension(mimeType) {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("aac")) return "aac";
  return "webm";
}

async function startRecording() {
  errorMsg.hidden = true;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error(err);
    errorMsg.textContent = "마이크 권한이 필요합니다. 브라우저 설정에서 마이크 접근을 허용해주세요.";
    errorMsg.hidden = false;
    return;
  }

  recordedChunks = [];
  recordedMimeType = pickMimeType();
  mediaRecorder = recordedMimeType
    ? new MediaRecorder(mediaStream, { mimeType: recordedMimeType })
    : new MediaRecorder(mediaStream);

  mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  });

  mediaRecorder.addEventListener("stop", onRecordingStopped);

  mediaRecorder.start();
  state = "recording";
  elapsedSeconds = 0;
  timerStart = Date.now();

  micButton.classList.add("is-recording");
  setIcon(PAUSE_ICON);
  timerDisplay.hidden = false;
  progressTrack.hidden = false;
  progressCaption.hidden = false;
  recordingButtons.hidden = false;
  updateProgressUI(0);

  timerHandle = setInterval(() => {
    elapsedSeconds = (Date.now() - timerStart) / 1000;
    updateProgressUI(elapsedSeconds);
    if (elapsedSeconds >= MAX_SECONDS) {
      finishRecording();
    }
  }, 200);
}

function stopMediaRecorderAndTracks() {
  clearInterval(timerHandle);
  timerHandle = null;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

// 완료 버튼 또는 5분 자동 종료 시 호출
function finishRecording() {
  if (state !== "recording") return;
  stopMediaRecorderAndTracks();
  // 실제 상태 전환은 onRecordingStopped (dataavailable 다 모인 뒤)에서 처리
}

function onRecordingStopped() {
  if (state !== "recording") return; // 취소로 인한 stop이면 여기서 처리 안 함
  recordedBlob = new Blob(recordedChunks, { type: recordedMimeType || "audio/webm" });

  micButton.classList.remove("is-recording");
  timerDisplay.hidden = true;
  progressTrack.hidden = true;
  progressCaption.hidden = true;
  recordingButtons.hidden = true;

  enterPreviewState();
}

// 취소 버튼: 녹음 중 데이터를 버리고 처음 상태로
function cancelRecording() {
  state = "idle";
  mediaRecorder?.removeEventListener("stop", onRecordingStopped);
  stopMediaRecorderAndTracks();
  recordedChunks = [];
  recordedBlob = null;

  micButton.classList.remove("is-recording");
  setIcon(MIC_ICON);
  timerDisplay.hidden = true;
  progressTrack.hidden = true;
  progressCaption.hidden = true;
  recordingButtons.hidden = true;

  // removeEventListener 이후 다시 등록해야 다음 녹음에서 정상 동작함
  if (mediaRecorder) {
    mediaRecorder.addEventListener("stop", onRecordingStopped);
  }
}

// ==================== 미리듣기 ====================

function enterPreviewState() {
  state = "preview";
  if (previewAudio) {
    previewAudio.pause();
    URL.revokeObjectURL(previewAudio.src);
  }
  previewAudio = new Audio(URL.createObjectURL(recordedBlob));
  previewAudio.addEventListener("ended", () => {
    isPlaying = false;
    setIcon(PLAY_ICON);
  });

  setIcon(PLAY_ICON);
  previewButtons.hidden = false;
}

function togglePlayback() {
  if (!previewAudio) return;
  if (isPlaying) {
    previewAudio.pause();
    isPlaying = false;
    setIcon(PLAY_ICON);
  } else {
    previewAudio.play();
    isPlaying = true;
    setIcon(PAUSE_ICON);
  }
}

function retryRecording() {
  if (previewAudio) {
    previewAudio.pause();
    URL.revokeObjectURL(previewAudio.src);
    previewAudio = null;
  }
  isPlaying = false;
  recordedBlob = null;
  previewButtons.hidden = true;
  state = "idle";
  setIcon(MIC_ICON);
}

// ==================== 제출 ====================

async function submitRecording() {
  if (!recordedBlob || state !== "preview") return;
  state = "submitting";
  submitBtn.disabled = true;
  retryBtn.disabled = true;
  submitBtn.textContent = "업로드 중...";
  errorMsg.hidden = true;

  try {
    const ext = mimeTypeToExtension(recordedMimeType);
    const storagePath = `recordings/${currentUser.uid}/day${dayNumber}.${ext}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, recordedBlob, { contentType: recordedBlob.type });
    const downloadURL = await getDownloadURL(storageRef);

    const recordingId = `${currentUser.uid}_day${dayNumber}`;
    await setDoc(doc(db, "recordings", recordingId), {
      uid: currentUser.uid,
      seasonId: currentParticipant.seasonId,
      dayNumber,
      weekNumber,
      storagePath,
      downloadURL,
      durationSeconds: Math.round(elapsedSeconds),
      createdAt: serverTimestamp(),
    });

    location.href = "list.html";
  } catch (err) {
    console.error(err);
    errorMsg.textContent = "업로드에 실패했습니다. 네트워크를 확인하고 다시 시도해주세요.";
    errorMsg.hidden = false;
    submitBtn.disabled = false;
    retryBtn.disabled = false;
    submitBtn.textContent = "완료하기";
    state = "preview";
  }
}

// ==================== 이벤트 바인딩 ====================

micButton.addEventListener("click", () => {
  if (state === "idle") {
    startRecording();
  } else if (state === "preview") {
    togglePlayback();
  }
});

cancelBtn.addEventListener("click", cancelRecording);
completeBtn.addEventListener("click", finishRecording);
retryBtn.addEventListener("click", retryRecording);
submitBtn.addEventListener("click", submitRecording);
