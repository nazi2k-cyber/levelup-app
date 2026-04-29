// 리전 장애로 간주할 Firebase Functions 오류 코드
const REGIONAL_ERROR_CODES = [
    'functions/unavailable',
    'functions/internal',
    'functions/deadline-exceeded',
    'functions/resource-exhausted',
];

function isRegionalError(e) {
    const code = String((e && e.code) || '').toLowerCase();
    if (REGIONAL_ERROR_CODES.some(c => code.includes(c.split('/')[1]))) return true;
    // 네트워크 수준 fetch 실패 (리전 연결 불가)
    if (e instanceof TypeError) return true;
    return false;
}

/**
 * 주 리전 호출 실패 시 보조 리전으로 자동 전환.
 * - UNAVAILABLE / INTERNAL / DEADLINE_EXCEEDED / RESOURCE_EXHAUSTED + TypeError → name+'Secondary' 호출
 * - NOT_FOUND(404)는 re-throw → 호출부의 기존 ping 폴백이 동작하도록 함
 * - 전환 시 [Failover] 로그 기록 → Cloud Logging textPayload:"[Failover]" 필터로 추적 가능
 */
export async function callWithRegionalFailover(httpsCallable, primaryFns, secondaryFns, name, payload) {
    try {
        return await httpsCallable(primaryFns, name)(payload || {});
    } catch (primaryErr) {
        if (!isRegionalError(primaryErr)) throw primaryErr;

        console.warn('[Failover] ' + name + ': 주 리전 실패, 보조 리전 전환', primaryErr.code || primaryErr.message);

        return await httpsCallable(secondaryFns, name + 'Secondary')(payload || {});
    }
}
