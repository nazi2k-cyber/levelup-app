const crypto = require("crypto");
const https = require("https");

// ─── 환경변수 ───
// SMS_SERVICE_ID    NCP SENS 서비스 ID
// SMS_ACCESS_KEY    NCP Access Key
// SMS_SECRET_KEY    NCP Secret Key
// SMS_SENDER_NUMBER 발신번호
// PHONE_ENCRYPTION_KEY 32바이트 hex (AES-256-GCM)

function isSmsConfigured() {
    return !!(
        process.env.SMS_SERVICE_ID &&
        process.env.SMS_ACCESS_KEY &&
        process.env.SMS_SECRET_KEY &&
        process.env.SMS_SENDER_NUMBER
    );
}

// NCP SENS API 서명 생성 (HMAC-SHA256)
function makeSignature(timestamp) {
    const accessKey = process.env.SMS_ACCESS_KEY;
    const secretKey = process.env.SMS_SECRET_KEY;
    const serviceId = process.env.SMS_SERVICE_ID;
    const method = "POST";
    const url = `/sms/v2/services/${serviceId}/messages`;
    const message = `${method} ${url}\n${timestamp}\n${accessKey}`;
    return crypto.createHmac("sha256", secretKey).update(message).digest("base64");
}

// HTTP POST (Node 내장 https 모듈 사용, 외부 의존성 없음)
function httpsPost(hostname, path, headers, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request(
            { hostname, path, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(data) } },
            (res) => {
                let raw = "";
                res.on("data", (c) => (raw += c));
                res.on("end", () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                    catch { resolve({ status: res.statusCode, body: raw }); }
                });
            }
        );
        req.on("error", reject);
        req.write(data);
        req.end();
    });
}

/**
 * SMS 단건 발송 (NCP SENS)
 * @param {string} to   수신번호 (하이픈 없이, e.g. "01012345678")
 * @param {string} content 메시지 본문 (80바이트 이내 SMS)
 * @returns {Promise<{success:boolean, messageId?:string, dryRun?:boolean, error?:string}>}
 */
async function sendSms(to, content) {
    if (!isSmsConfigured()) {
        console.warn("[SmsGateway] 환경변수 미설정 — dry-run 모드로 실행. to=" + to);
        return { success: false, dryRun: true };
    }

    const serviceId = process.env.SMS_SERVICE_ID;
    const senderNumber = process.env.SMS_SENDER_NUMBER;
    const timestamp = String(Date.now());
    const signature = makeSignature(timestamp);

    const payload = {
        type: "SMS",
        from: senderNumber,
        content,
        messages: [{ to }],
    };

    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": process.env.SMS_ACCESS_KEY,
        "x-ncp-apigw-signature-v2": signature,
    };

    let lastError = null;
    const delays = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            const res = await httpsPost(
                "sens.apigw.ntruss.com",
                `/sms/v2/services/${serviceId}/messages`,
                headers,
                payload
            );

            if (res.status === 202) {
                const messageId = res.body?.requestId || null;
                console.log(`[SmsGateway] 발송 성공 to=${to} messageId=${messageId}`);
                return { success: true, messageId };
            }

            lastError = `HTTP ${res.status}: ${JSON.stringify(res.body)}`;
            console.warn(`[SmsGateway] 발송 실패 attempt=${attempt + 1} error=${lastError}`);
        } catch (e) {
            lastError = e.message;
            console.warn(`[SmsGateway] 네트워크 오류 attempt=${attempt + 1} error=${lastError}`);
        }

        if (attempt < delays.length) {
            await new Promise((r) => setTimeout(r, delays[attempt]));
        }
    }

    return { success: false, error: lastError };
}

// ─── 전화번호 암호화/복호화 (AES-256-GCM) ───

function getEncryptionKey() {
    const hex = process.env.PHONE_ENCRYPTION_KEY || "";
    if (hex.length !== 64) return null;
    return Buffer.from(hex, "hex");
}

/**
 * @param {string} phone 평문 전화번호 (e.g. "01012345678")
 * @returns {string|null} "iv:authTag:encrypted" hex 문자열, 키 없으면 null
 */
function encryptPhone(phone) {
    const key = getEncryptionKey();
    if (!key) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * @param {string} encrypted  encryptPhone() 의 출력값
 * @returns {string|null} 평문 전화번호, 실패 시 null
 */
function decryptPhone(encrypted) {
    const key = getEncryptionKey();
    if (!key || !encrypted) return null;
    try {
        const [ivHex, tagHex, encHex] = encrypted.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");
        const enc = Buffer.from(encHex, "hex");
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(enc) + decipher.final("utf8");
    } catch {
        return null;
    }
}

/**
 * 전화번호 마스킹 표시 (010-****-5678)
 * @param {string} phone "01012345678" 또는 "010-1234-5678"
 */
function maskPhone(phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11) {
        return `${digits.slice(0, 3)}-****-${digits.slice(7)}`;
    }
    return "***-****-****";
}

module.exports = { sendSms, encryptPhone, decryptPhone, maskPhone, isSmsConfigured };
