// shared.js
// 여러 화면(로그인/온보딩/녹음/리스트)에서 공통으로 쓰는 함수 모음입니다.

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { auth, db } from "./firebase-config.js";

// ==================== ★ setup-participants.js와 한 글자도 다르면 안 되는 블록 ====================
// 참가자는 "닉네임 + 비밀번호"로 로그인하는데, Firebase Authentication은 이메일 기반이라
// 닉네임을 이메일로 바꾸는 계산이 서버(관리자 스크립트)와 클라이언트(여기)에서 정확히
// 똑같아야 합니다. 한쪽만 고치면 그 즉시 전원 로그인이 실패합니다.

export const EMAIL_DOMAIN = "internal.speaking-challenge.local";

export function normalizeNickname(nickname) {
  return nickname.trim().toLowerCase();
}

export function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function nicknameToEmail(seasonId, nickname) {
  const key = `${seasonId}::${normalizeNickname(nickname)}`;
  return `p-${fnv1aHash(key)}@${EMAIL_DOMAIN}`;
}

// ==================== 현재 시즌 ====================
// 시즌이 바뀌면 setup-participants.js의 SEASON_ID를 바꾸는 것과 함께 이 값도 바꿔야 합니다.
export const CURRENT_SEASON_ID = "test-1";

// ==================== Admin 계정 ====================
// firestore.rules의 isAdmin()에 넣은 UID와 반드시 똑같아야 합니다.
// Firebase Console > Authentication > Users 에서 admin 계정(이메일) 클릭하면 UID를 확인할 수 있습니다.
export const ADMIN_UID = "REPLACE_WITH_ADMIN_UID";

export function isAdmin(uid) {
  return uid === ADMIN_UID;
}

// ==================== 날짜/주차 계산 (한국 시간 기준) ====================
// 서버 시간이 아니라 "참가자가 보는 달력 날짜"로 계산해야 하므로 Asia/Seoul 기준으로 맞춥니다.

function toKstDateKey(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // "YYYY-MM-DD" 형태
}

function daysBetweenKst(fromDate, toDate) {
  const d1 = new Date(`${toKstDateKey(fromDate)}T00:00:00+09:00`);
  const d2 = new Date(`${toKstDateKey(toDate)}T00:00:00+09:00`);
  return Math.round((d2 - d1) / 86400000);
}

// 시즌 시작일 기준으로 오늘이 며칠째인지 (1일차부터 시작)
export function getDayNumber(seasonStartDate, now = new Date()) {
  return daysBetweenKst(seasonStartDate, now) + 1;
}

// N일차가 몇 주차인지 (1~7일차 = 1주차, 8~14일차 = 2주차 ...)
export function getWeekNumber(dayNumber) {
  return Math.ceil(dayNumber / 7);
}

// ==================== Firestore 조회 헬퍼 ====================

export async function getSeason(seasonId) {
  const snap = await getDoc(doc(db, "seasons", seasonId));
  if (!snap.exists()) {
    throw new Error(`시즌 문서를 찾을 수 없습니다: ${seasonId}`);
  }
  const data = snap.data();
  return {
    ...data,
    startDate: data.startDate.toDate(),
    endDate: data.endDate.toDate(),
  };
}

export async function getParticipant(uid) {
  const snap = await getDoc(doc(db, "participants", uid));
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

export async function getTodayRecording(uid, dayNumber) {
  const snap = await getDoc(doc(db, "recordings", `${uid}_day${dayNumber}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ==================== 로그인 가드 ====================

// 로그인 안 돼 있으면 로그인 화면으로 보냅니다. 로그인 돼 있으면 참가자 문서까지
// 같이 담아서 돌려줍니다. onboarding/record/list 화면 맨 위에서 항상 호출하세요.
// admin 계정은 participants 문서가 없는 게 정상이므로, 그 경우 participant: null, admin: true로 돌려줍니다.
export function requireLogin() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        location.href = "index.html";
        return;
      }
      if (isAdmin(user.uid)) {
        resolve({ user, participant: null, admin: true });
        return;
      }
      const participant = await getParticipant(user.uid);
      if (!participant) {
        // 정상적으로는 발생하지 않아야 하는 상태(Auth 계정은 있는데 참가자 문서가 없음)
        alert("참가자 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.");
        await signOut(auth);
        location.href = "index.html";
        return;
      }
      resolve({ user, participant, admin: false });
    });
  });
}

// 지금 이 계정이 가야 할 화면으로 보냅니다.
// 순서: admin → list / 온보딩 안 함 → onboarding / 탈락 → list / 오늘 이미 제출함 → list / 그 외 → record
export async function routeToCurrentStep(user, participant) {
  if (isAdmin(user.uid)) {
    location.href = "list.html";
    return;
  }
  if (!participant.onboarded) {
    location.href = "onboarding.html";
    return;
  }
  if (participant.status === "eliminated") {
    location.href = "list.html";
    return;
  }
  const season = await getSeason(participant.seasonId);
  const dayNumber = getDayNumber(season.startDate);
  const todayRecording = await getTodayRecording(user.uid, dayNumber);
  location.href = todayRecording ? "list.html" : "record.html";
}

export async function logout() {
  await signOut(auth);
  location.href = "index.html";
}
