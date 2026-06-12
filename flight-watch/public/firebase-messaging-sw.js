importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAx1DsvOcDSiDvPYG32Nw6wiFRQz8X5PB8",
  authDomain: "howardworld.firebaseapp.com",
  projectId: "howardworld",
  storageBucket: "howardworld.firebasestorage.app",
  messagingSenderId: "940701312592",
  appId: "1:940701312592:web:8882de89e067b9a727d355",
});

const messaging = firebase.messaging();

// 백그라운드 메시지: notification 페이로드가 있으면 브라우저가 자동 표시하므로
// 여기서는 별도 처리 없이 로그만 남긴다
messaging.onBackgroundMessage((payload) => {
  console.log("[sw] background message", payload);
});
