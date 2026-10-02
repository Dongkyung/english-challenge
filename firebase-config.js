// firebase-config.js
// 모든 화면이 공통으로 불러다 쓰는 Firebase 초기화 파일입니다.
// 값은 Firebase 콘솔 > 프로젝트 설정 > 내 앱 에서 복사한 것으로, 공개되어도 안전합니다
// (실제 보안은 firestore.rules / storage.rules 가 담당합니다).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBagJ9KBGQHqTvPChSCpjh-br_doa0dgYs",
  authDomain: "english-challenge-abb40.firebaseapp.com",
  projectId: "english-challenge-abb40",
  storageBucket: "english-challenge-abb40.firebasestorage.app",
  messagingSenderId: "909328806652",
  appId: "1:909328806652:web:b81ea7c328a8969829dd79",
};

// ★ setup-participants.js의 FIRESTORE_DATABASE_ID와 반드시 같은 값이어야 합니다.
// (콘솔에서 "(default)"가 아니라 "english-challenge"라는 이름으로 DB를 만들었기 때문)
const FIRESTORE_DATABASE_ID = "english-challenge";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, FIRESTORE_DATABASE_ID);
export const storage = getStorage(app);
