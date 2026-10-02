import { updatePassword } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { requireLogin, routeToCurrentStep, isAdmin } from "./shared.js";

let currentUser = null;
let currentParticipant = null;

const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const step1Form = document.getElementById("step1-form");
const step2Form = document.getElementById("step2-form");
const step1Error = document.getElementById("step1-error");
const step2Error = document.getElementById("step2-error");

init();

async function init() {
  const { user, participant } = await requireLogin();
  if (isAdmin(user.uid)) {
    location.href = "list.html";
    return;
  }
  // 이미 온보딩을 끝낸 사람이 URL로 직접 들어오면 원래 가야 할 화면으로 돌려보냄
  if (participant.onboarded) {
    await routeToCurrentStep(user, participant);
    return;
  }
  currentUser = user;
  currentParticipant = participant;
  step1.hidden = false;
}

step1Form.addEventListener("submit", async (e) => {
  e.preventDefault();
  step1Error.hidden = true;

  const pw1 = document.getElementById("new-password").value;
  const pw2 = document.getElementById("new-password-confirm").value;

  if (pw1.length < 6) {
    step1Error.textContent = "비밀번호는 6자 이상이어야 합니다.";
    step1Error.hidden = false;
    return;
  }
  if (pw1 !== pw2) {
    step1Error.textContent = "비밀번호가 일치하지 않습니다.";
    step1Error.hidden = false;
    return;
  }

  try {
    await updatePassword(currentUser, pw1);
    step1.hidden = true;
    step2.hidden = false;
  } catch (err) {
    console.error(err);
    step1Error.textContent = "비밀번호 변경에 실패했습니다. 로그아웃 후 다시 로그인해 시도해주세요.";
    step1Error.hidden = false;
  }
});

step2Form.addEventListener("submit", async (e) => {
  e.preventDefault();
  step2Error.hidden = true;

  const cefrLevel = document.getElementById("cefr-level").value;
  const displayMode = document.querySelector('input[name="display-mode"]:checked')?.value;

  if (!cefrLevel || !displayMode) {
    step2Error.textContent = "등급과 표시 방식을 모두 선택해주세요.";
    step2Error.hidden = false;
    return;
  }

  try {
    await updateDoc(doc(db, "participants", currentUser.uid), {
      cefrLevel,
      displayMode,
      onboarded: true,
    });

    // 다른 참가자들이 보게 될 "공개용 사본" — 익명이면 실명 대신 "익명"이라는
    // 문자열 자체를 저장해서, 이후로는 이 문서만 봐서는 실명을 알아낼 방법이 없게 함.
    const displayName = displayMode === "anonymous" ? "익명" : currentParticipant.nickname;
    await setDoc(doc(db, "publicProfiles", currentUser.uid), {
      displayName,
      cefrLevel,
      status: currentParticipant.status || "active",
      seasonId: currentParticipant.seasonId,
    });

    currentParticipant.onboarded = true;
    currentParticipant.cefrLevel = cefrLevel;
    currentParticipant.displayMode = displayMode;
    await routeToCurrentStep(currentUser, currentParticipant);
  } catch (err) {
    console.error(err);
    step2Error.textContent = "저장에 실패했습니다. 다시 시도해주세요.";
    step2Error.hidden = false;
  }
});
