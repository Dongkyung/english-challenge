import {
  collection,
  query,
  where,
  getDocs,
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import {
  requireLogin,
  logout,
  getSeason,
  getDayNumber,
  CURRENT_SEASON_ID,
} from "./shared.js";

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
const CEFR_LABEL = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-Intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Proficient",
};

// ==================== DOM ====================

const weekSelect = document.getElementById("week-select");
const recordLink = document.getElementById("record-link");
const listContent = document.getElementById("list-content");
const listError = document.getElementById("list-error");
const listLoading = document.getElementById("list-loading");
const logoutBtn = document.getElementById("logout-btn");

// ==================== 상태 ====================

let viewerIsAdmin = false;
let viewerUid = null;
let season = null;
let seasonId = CURRENT_SEASON_ID;
let todayDayNumber = 0;
let participants = []; // [{uid, nickname, cefrLevel, displayMode, status}, ...]
let recordingsByUid = {}; // { uid: { [dayNumber]: {downloadURL, ...} } }
let currentWeek = 1;

let currentAudio = null;
let currentButton = null;

logoutBtn.addEventListener("click", logout);

init();

async function init() {
  const { user, participant, admin } = await requireLogin();
  viewerUid = user.uid;
  viewerIsAdmin = !!admin;

  seasonId = admin ? CURRENT_SEASON_ID : participant.seasonId;

  try {
    season = await getSeason(seasonId);
  } catch (err) {
    console.error(err);
    showError("시즌 정보를 불러오지 못했습니다.");
    return;
  }

  todayDayNumber = getDayNumber(season.startDate);
  const totalWeeks = season.totalWeeks;

  // 주차 select box 채우기
  weekSelect.innerHTML = "";
  for (let w = 1; w <= totalWeeks; w++) {
    const opt = document.createElement("option");
    opt.value = String(w);
    opt.textContent = `${w}주차 (Day ${(w - 1) * 7 + 1}~${w * 7})`;
    weekSelect.appendChild(opt);
  }

  const defaultWeek = Math.min(
    Math.max(1, Math.ceil(todayDayNumber / 7)),
    totalWeeks
  );
  weekSelect.value = String(defaultWeek);
  currentWeek = defaultWeek;

  if (!viewerIsAdmin) {
    recordLink.hidden = participant.status === "eliminated";
  }

  try {
    // admin은 실명/공개여부가 필요하니 participants를, 일반 참가자는 이름이 가려진
    // publicProfiles를 읽는다 (익명 설정이 실제로 지켜지도록 — 서버 규칙으로 강제됨).
    participants = viewerIsAdmin
      ? await fetchCollection("participants", seasonId)
      : await fetchCollection("publicProfiles", seasonId);
    recordingsByUid = await fetchRecordingsForWeek(seasonId, currentWeek);
  } catch (err) {
    console.error(err);
    showError("데이터를 불러오지 못했습니다. 새로고침 해주세요.");
    return;
  }

  listLoading.hidden = true;
  render();

  weekSelect.addEventListener("change", onWeekChange);
}

async function onWeekChange() {
  currentWeek = Number(weekSelect.value);
  listLoading.hidden = false;
  listContent.innerHTML = "";
  try {
    recordingsByUid = await fetchRecordingsForWeek(seasonId, currentWeek);
  } catch (err) {
    console.error(err);
    showError("데이터를 불러오지 못했습니다. 새로고침 해주세요.");
    return;
  }
  listLoading.hidden = true;
  render();
}

function showError(msg) {
  listLoading.hidden = true;
  listError.textContent = msg;
  listError.hidden = false;
}

// ==================== Firestore 조회 ====================

async function fetchCollection(collectionName, seasonId) {
  const snap = await getDocs(
    query(collection(db, collectionName), where("seasonId", "==", seasonId))
  );
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

async function fetchRecordingsForWeek(seasonId, weekNumber) {
  const snap = await getDocs(
    query(
      collection(db, "recordings"),
      where("seasonId", "==", seasonId),
      where("weekNumber", "==", weekNumber)
    )
  );
  const byUid = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    if (!byUid[data.uid]) byUid[data.uid] = {};
    byUid[data.uid][data.dayNumber] = data;
  });
  return byUid;
}

// ==================== 결석 계산 (admin 탈락 버튼용) ====================

// 선택한 주차에서 "이미 지나간 날"이 며칠인지. 아직 시작 안 한 주차면 0.
function elapsedDaysInWeek(week) {
  const weekStartDay = (week - 1) * 7 + 1;
  const weekEndDay = week * 7;
  if (todayDayNumber < weekStartDay) return 0;
  if (todayDayNumber >= weekEndDay) return 7;
  return todayDayNumber - weekStartDay + 1;
}

// 반환값: null이면 아직 판단 불가(주차 시작 전), 아니면 결석 일수
function countAbsences(uid, week) {
  const elapsed = elapsedDaysInWeek(week);
  if (elapsed === 0) return null;
  const weekStartDay = (week - 1) * 7 + 1;
  let submitted = 0;
  for (let i = 0; i < elapsed; i++) {
    const day = weekStartDay + i;
    if (recordingsByUid[uid]?.[day]) submitted++;
  }
  return elapsed - submitted;
}

// ==================== 렌더링 ====================

function render() {
  listContent.innerHTML = "";

  const groups = {};
  for (const p of participants) {
    if (!p.cefrLevel) continue;
    if (!groups[p.cefrLevel]) groups[p.cefrLevel] = [];
    groups[p.cefrLevel].push(p);
  }

  for (const level of CEFR_ORDER) {
    const members = groups[level];
    if (!members || members.length === 0) continue;

    const sortKey = (p) => (viewerIsAdmin ? p.nickname : p.displayName) || "";
    members.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    const section = document.createElement("section");
    section.className = "cefr-group";

    const heading = document.createElement("h2");
    heading.className = "cefr-heading";
    heading.textContent = CEFR_LABEL[level] || level;
    section.appendChild(heading);

    members.forEach((p) => section.appendChild(renderRow(p)));
    listContent.appendChild(section);
  }

  if (listContent.children.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "표시할 참가자가 없습니다.";
    listContent.appendChild(empty);
  }
}

function renderRow(p) {
  const row = document.createElement("div");
  row.className = "participant-row";
  if (p.status === "eliminated") row.classList.add("is-eliminated");

  const nameEl = document.createElement("span");
  nameEl.className = "participant-name";
  if (viewerIsAdmin) {
    // admin에게는 항상 실제 닉네임을 보여주되, 공개/익명 설정에 따라 색을 다르게
    nameEl.textContent = p.nickname;
    nameEl.classList.add(p.displayMode === "anonymous" ? "name-anonymous" : "name-public");
  } else {
    // publicProfiles 문서에는 이미 "익명" 또는 실제 닉네임이 확정되어 들어있음
    nameEl.textContent = p.displayName;
  }
  row.appendChild(nameEl);

  const daysWrap = document.createElement("div");
  daysWrap.className = "day-cells";
  const weekStartDay = (currentWeek - 1) * 7 + 1;
  for (let i = 0; i < 7; i++) {
    const day = weekStartDay + i;
    const recording = recordingsByUid[p.uid]?.[day];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell";
    cell.textContent = String(i + 1);
    if (recording) {
      cell.classList.add("has-recording");
      cell.addEventListener("click", () => togglePlay(cell, recording.downloadURL));
    } else {
      cell.disabled = true;
    }
    daysWrap.appendChild(cell);
  }
  row.appendChild(daysWrap);

  if (viewerIsAdmin) {
    const absences = countAbsences(p.uid, currentWeek);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eliminate-btn";
    const isEliminated = p.status === "eliminated";
    btn.textContent = isEliminated ? "재참여" : "탈락";
    if (!isEliminated && absences !== null && absences >= 4) {
      btn.classList.add("is-danger");
    }
    if (absences === null && !isEliminated) {
      btn.disabled = true;
      btn.title = "아직 시작하지 않은 주차입니다.";
    }
    btn.addEventListener("click", () => toggleElimination(p, btn, row));
    row.appendChild(btn);
  }

  return row;
}

async function toggleElimination(p, btn, row) {
  const willEliminate = p.status !== "eliminated";
  btn.disabled = true;
  try {
    // participants(비공개)와 publicProfiles(공개용 사본) 양쪽의 status를 같이 바꿔야
    // 탈락 음영 처리가 일반 참가자 화면에도 반영됨.
    const batch = writeBatch(db);
    batch.update(doc(db, "participants", p.uid), {
      status: willEliminate ? "eliminated" : "active",
      eliminatedAt: willEliminate ? serverTimestamp() : null,
    });
    batch.update(doc(db, "publicProfiles", p.uid), {
      status: willEliminate ? "eliminated" : "active",
    });
    await batch.commit();
    p.status = willEliminate ? "eliminated" : "active";
    render();
  } catch (err) {
    console.error(err);
    alert("처리에 실패했습니다. 다시 시도해주세요.");
    btn.disabled = false;
  }
}

function togglePlay(btn, url) {
  if (currentAudio && currentButton === btn) {
    if (currentAudio.paused) {
      currentAudio.play();
      btn.classList.add("is-playing");
    } else {
      currentAudio.pause();
      btn.classList.remove("is-playing");
    }
    return;
  }

  if (currentAudio) {
    currentAudio.pause();
    currentButton?.classList.remove("is-playing");
  }

  currentAudio = new Audio(url);
  currentButton = btn;
  currentAudio.addEventListener("ended", () => {
    btn.classList.remove("is-playing");
  });
  currentAudio.play();
  btn.classList.add("is-playing");
}
