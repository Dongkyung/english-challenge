import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { auth } from "./firebase-config.js";
import {
  nicknameToEmail,
  CURRENT_SEASON_ID,
  getParticipant,
  routeToCurrentStep,
} from "./shared.js";

const form = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");
const loginBtn = document.getElementById("login-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.hidden = true;
  loginBtn.disabled = true;
  loginBtn.textContent = "로그인 중...";

  const nickname = document.getElementById("nickname").value;
  const password = document.getElementById("password").value;
  const email = nicknameToEmail(CURRENT_SEASON_ID, nickname);

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const participant = await getParticipant(cred.user.uid);
    if (!participant) {
      throw new Error("참가자 정보를 찾을 수 없습니다.");
    }
    await routeToCurrentStep(cred.user, participant);
  } catch (err) {
    console.error(err);
    errorMsg.textContent = "닉네임 또는 비밀번호가 올바르지 않습니다.";
    errorMsg.hidden = false;
    loginBtn.disabled = false;
    loginBtn.textContent = "로그인";
  }
});
