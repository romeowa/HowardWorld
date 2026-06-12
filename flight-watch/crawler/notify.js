// 등록된 모든 FCM 토큰(웹 푸시: Mac 브라우저 + iPhone PWA)에 알림 전송

const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const SITE_URL = "https://howardworld.web.app";

async function sendToAll({ title, body }) {
  const db = getFirestore();
  const snap = await db.collection("fcmTokens").get();
  const tokens = snap.docs.map((d) => d.id);
  if (tokens.length === 0) {
    console.log("등록된 FCM 토큰이 없어 알림을 건너뜀");
    return { sent: 0 };
  }

  const result = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      fcmOptions: { link: SITE_URL },
      notification: { icon: `${SITE_URL}/icon-192.png` },
    },
  });

  // 만료/해지된 토큰 정리
  const deletions = [];
  result.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code;
      console.warn(`토큰 전송 실패 [${code}]: ${tokens[i].slice(0, 20)}...`);
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        deletions.push(db.collection("fcmTokens").doc(tokens[i]).delete());
      }
    }
  });
  await Promise.all(deletions);

  console.log(`알림 전송: 성공 ${result.successCount} / 실패 ${result.failureCount}`);
  return { sent: result.successCount };
}

module.exports = { sendToAll };
