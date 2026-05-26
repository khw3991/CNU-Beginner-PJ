// ═══════════════════════════════════════════════════════
//  cgv-showtimes.js  |  CGV 상영 정보 연동 모듈
//
//  현재: CGV 실제 데이터 구조의 현실적인 목 데이터 사용
//  백엔드 준비: PROXY_URL에 서버 주소를 넣으면 실제 크롤링 데이터로 전환
// ═══════════════════════════════════════════════════════

// ──────────────────────────────────────────
//  [설정] 백엔드 프록시 URL
//  로컬 개발: 'http://localhost:3001/api/cgv'
//  배포 후:   'https://your-server.com/api/cgv'
//  null이면 아래 목 데이터를 사용
// ──────────────────────────────────────────
const CGV_PROXY_URL = null;

// ──────────────────────────────────────────
//  CGV 서울 주요 지점 (실제 위치 기반)
//  - theaterCode: CGV 내부 코드 (백엔드 연동 시 사용)
//  - 백엔드에서 https://www.cgv.co.kr/schedule/ 크롤링 시 이 코드로 조회
// ──────────────────────────────────────────
const CGV_THEATERS = [
    { id: "cgv_001", name: "CGV 강남",        lat: 37.5013, lng: 127.0259, theaterCode: "0013", address: "서울 강남구 강남대로 438" },
    { id: "cgv_002", name: "CGV 명동",         lat: 37.5620, lng: 126.9840, theaterCode: "0009", address: "서울 중구 퇴계로 264" },
    { id: "cgv_003", name: "CGV 홍대",         lat: 37.5574, lng: 126.9237, theaterCode: "0029", address: "서울 마포구 양화로 188" },
    { id: "cgv_004", name: "CGV 왕십리",       lat: 37.5614, lng: 127.0376, theaterCode: "0056", address: "서울 성동구 왕십리로 83" },
    { id: "cgv_005", name: "CGV 여의도",       lat: 37.5216, lng: 126.9237, theaterCode: "0039", address: "서울 영등포구 국제금융로 10" },
    { id: "cgv_006", name: "CGV 건대입구",     lat: 37.5392, lng: 127.0697, theaterCode: "0046", address: "서울 광진구 아차산로 272" },
    { id: "cgv_007", name: "CGV 압구정",       lat: 37.5272, lng: 127.0280, theaterCode: "0014", address: "서울 강남구 압구정로 42" },
    { id: "cgv_008", name: "CGV 신촌아트레온", lat: 37.5547, lng: 126.9368, theaterCode: "0022", address: "서울 서대문구 신촌로 83" },
    { id: "cgv_009", name: "CGV 용산아이파크몰", lat: 37.5302, lng: 126.9647, theaterCode: "0017", address: "서울 용산구 한강대로23길 55" },
    { id: "cgv_010", name: "CGV 목동",         lat: 37.5277, lng: 126.8751, theaterCode: "0020", address: "서울 양천구 목동동로 309" },
    { id: "cgv_011", name: "CGV 상암",         lat: 37.5799, lng: 126.8892, theaterCode: "0107", address: "서울 마포구 월드컵북로 400" },
    { id: "cgv_012", name: "CGV 은평",         lat: 37.6195, lng: 126.9220, theaterCode: "0099", address: "서울 은평구 통일로 1050" },
    { id: "cgv_013", name: "CGV 천호",         lat: 37.5382, lng: 127.1241, theaterCode: "0053", address: "서울 강동구 천호대로 1139" },
    { id: "cgv_014", name: "CGV 성신여대입구", lat: 37.5930, lng: 127.0166, theaterCode: "0076", address: "서울 성북구 동소문로 98-1" },
    { id: "cgv_015", name: "CGV 수원",         lat: 37.2699, lng: 127.0011, theaterCode: "0025", address: "경기 수원시 팔달구 권선로 809" },
];

// ──────────────────────────────────────────
//  상영 타입 (CGV 실제 포맷 반영)
// ──────────────────────────────────────────
const SCREEN_TYPES = ["2D", "3D", "4DX", "IMAX", "ScreenX", "IMAX 3D", "4DX 3D"];

// ──────────────────────────────────────────
//  목 상영 시간 생성 (CGV 실제 시간대 패턴 반영)
//  실제 CGV 상영 패턴: 조조(~10시), 주간(10~17시), 저녁(17~21시), 심야(21시~)
// ──────────────────────────────────────────
const CGV_SHOWTIME_POOLS = {
    // 조조
    earlyMorning: ["09:00", "09:30", "10:00"],
    // 주간
    daytime:      ["10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"],
    // 저녁
    evening:      ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30"],
    // 심야
    lateNight:    ["21:00", "21:30", "22:00", "22:30", "23:00", "23:30"]
};

// 상영관 번호 배정 (CGV는 보통 1관~15관)
function assignHall(theaterIdx, timeSlot, screenType) {
    // 특수관은 고정 번호 부여 (실제 CGV 패턴)
    if (screenType === "IMAX" || screenType === "IMAX 3D") return "IMAX관";
    if (screenType === "4DX" || screenType === "4DX 3D")   return "4DX관";
    if (screenType === "ScreenX") return "ScreenX관";
    const hallNum = ((theaterIdx * 3 + timeSlot) % 12) + 1;
    return `${hallNum}관`;
}

// 영화 러닝타임 추정 (id 기반, 실제론 TMDB/KOBIS에서 가져옴)
function estimateRuntime(movieId) {
    const base = [88, 95, 102, 108, 112, 118, 124, 130, 138, 148];
    return base[movieId % base.length];
}

// 종료 시간 계산
function calcEndTime(startTime, runtimeMins) {
    const [h, m] = startTime.split(':').map(Number);
    const total  = h * 60 + m + runtimeMins + 15; // +15분 (광고/예고편)
    const endH   = Math.floor(total / 60) % 24;
    const endM   = total % 60;
    return `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
}

// ──────────────────────────────────────────
//  결정론적 목 상영 데이터 생성
//  - movieId와 theaterId 기반으로 일관된 데이터 생성
//  - CGV 실제 상영 포맷 그대로 반영
// ──────────────────────────────────────────
function generateCGVMockShowtimes(movieId, theaterId) {
    const theaterIdx  = CGV_THEATERS.findIndex(t => t.id === theaterId);
    if (theaterIdx === -1) return [];

    const runtime     = estimateRuntime(movieId);
    // 이 영화가 이 극장에서 상영하는지 결정 (70% 확률, 결정론적)
    const seed        = (movieId * 31 + theaterIdx * 17) % 100;
    if (seed > 70) return []; // 30%는 미상영

    // 상영 타입 결정 (일반 2D가 기본, 특수관은 랜덤)
    const typePool    = ["2D", "2D", "2D", "3D", "4DX", "IMAX"]; // 2D 비중 높게
    const screenType  = typePool[(movieId + theaterIdx) % typePool.length];

    const showtimes   = [];

    for (let dayOff = 0; dayOff < 7; dayOff++) {
        const d = new Date();
        d.setDate(d.getDate() + dayOff);
        const dateKey    = `${d.getMonth()+1}-${d.getDate()}`;
        const isWeekend  = d.getDay() === 0 || d.getDay() === 6;

        // 요일·극장·영화에 따라 시간대 조합 결정
        const combo = (movieId + theaterIdx + dayOff) % 8;
        let timeSlotsRaw = [];

        // 조조 (주말엔 더 많이, 평일엔 적게)
        if (combo % 3 === 0 || isWeekend) {
            const pool = CGV_SHOWTIME_POOLS.earlyMorning;
            timeSlotsRaw.push(pool[(movieId + dayOff) % pool.length]);
        }
        // 주간 (2~3편)
        {
            const pool   = CGV_SHOWTIME_POOLS.daytime;
            const count  = isWeekend ? 3 : 2;
            const offset = (movieId * 5 + theaterIdx + dayOff * 2) % (pool.length - count);
            for (let i = 0; i < count; i++) timeSlotsRaw.push(pool[offset + i]);
        }
        // 저녁 (1~2편)
        {
            const pool   = CGV_SHOWTIME_POOLS.evening;
            const count  = isWeekend ? 2 : 1;
            const offset = (theaterIdx * 3 + dayOff) % (pool.length - count);
            for (let i = 0; i < count; i++) timeSlotsRaw.push(pool[offset + i]);
        }
        // 심야 (50% 확률, 주말엔 더 많이)
        if ((combo + dayOff) % 2 === 0 || isWeekend) {
            const pool   = CGV_SHOWTIME_POOLS.lateNight;
            const offset = (movieId + theaterIdx) % (pool.length - 1);
            timeSlotsRaw.push(pool[offset]);
        }

        // 중복 제거 + 오름차순 정렬
        const uniqueTimes = [...new Set(timeSlotsRaw)].sort((a, b) => {
            const [ah, am] = a.split(':').map(Number);
            const [bh, bm] = b.split(':').map(Number);
            return (ah * 60 + am) - (bh * 60 + bm);
        });

        if (uniqueTimes.length === 0) continue;

        // 각 상영 시간에 좌석·상영관 정보 부여
        const schedules = uniqueTimes.map((time, slotIdx) => {
            const totalSeats   = screenType === "IMAX" ? 300 : screenType === "4DX" ? 150 : 200;
            const leftSeedBase = (movieId * 7 + theaterIdx * 11 + dayOff * 5 + slotIdx) % 100;
            // 인기 시간대(저녁)는 좌석 적게
            const [h] = time.split(':').map(Number);
            const isPeakHour = h >= 17 && h <= 21;
            const leftRatio  = isPeakHour
                ? (leftSeedBase % 40) / 100         // 0~40% 남음
                : (20 + leftSeedBase % 60) / 100;   // 20~80% 남음
            const seatsLeft = Math.max(1, Math.round(totalSeats * leftRatio));

            return {
                time,
                endTime:    calcEndTime(time, runtime),
                hall:       assignHall(theaterIdx, slotIdx, screenType),
                screenType,
                totalSeats,
                seatsLeft,
                runtime
            };
        });

        showtimes.push({ date: dateKey, schedules });
    }

    return showtimes;
}

// ──────────────────────────────────────────
//  [PUBLIC API]  fetchCGVShowtimes(movieTitle, movieId)
//
//  1) CGV_PROXY_URL이 설정된 경우 → 실제 서버에서 크롤링 데이터 수신
//  2) null인 경우 → 목 데이터 생성
//
//  반환 형태:
//  [
//    {
//      theaterId: "cgv_001",
//      theaterName: "CGV 강남",
//      lat, lng, address,
//      showtimes: [
//        {
//          date: "5-27",
//          schedules: [
//            { time, endTime, hall, screenType, totalSeats, seatsLeft, runtime }
//          ]
//        }
//      ]
//    }, ...
//  ]
// ──────────────────────────────────────────
async function fetchCGVShowtimes(movieTitle, movieId) {
    // ── 백엔드 연동 모드 ──
    if (CGV_PROXY_URL) {
        try {
            const res  = await fetch(`${CGV_PROXY_URL}?title=${encodeURIComponent(movieTitle)}`);
            const data = await res.json();
            // 서버 응답이 같은 포맷을 따른다고 가정
            // 백엔드 예시: Node.js + puppeteer로 CGV 크롤링 후 아래 포맷으로 반환
            return data.theaters ?? [];
        } catch (err) {
            console.warn('[CGV] 백엔드 요청 실패, 목 데이터로 대체:', err.message);
            // 실패 시 목 데이터로 fallback
        }
    }

    // ── 목 데이터 모드 ──
    return CGV_THEATERS
        .map(theater => {
            const showtimes = generateCGVMockShowtimes(movieId, theater.id);
            if (showtimes.length === 0) return null; // 미상영 극장 제외
            return {
                theaterId:   theater.id,
                theaterName: theater.name,
                theaterCode: theater.theaterCode,
                lat:         theater.lat,
                lng:         theater.lng,
                address:     theater.address,
                showtimes
            };
        })
        .filter(Boolean);
}

// ──────────────────────────────────────────
//  [PUBLIC API]  getCGVTheaters()
//  Google Places API 없이 CGV 지점 목록만 필요할 때 사용
// ──────────────────────────────────────────
function getCGVTheaters() {
    return CGV_THEATERS;
}
