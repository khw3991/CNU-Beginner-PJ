// --- 1. 가상 데이터 (나중에 백엔드 API 연결 지점) ---
const movies = [
    { id: 1, title: "인셉션", rating: 9.5, audience: "500만", poster: "https://i.namu.wiki/i/ujkt6TPVoeYxq3q9h2yE_MckhgdJ6rOcdgnkCcs1ivWzB5hlnPBCEzatFDMApkNfWlxuCTQYH3d2SMj632Fzsg.webp" },
    { id: 2, title: "인터스텔라", rating: 9.2, audience: "400만", poster: "https://i.namu.wiki/i/yd6wnRIWEVMFY3wNjB-WKc0_nXstbPdiq87sfkbe3wJ8y2ZAhoZAfpebxEgc9bU1xIQh2OmD7Oi12CkFDhWbag.webp" },
    { id: 3, title: "어바웃 타임", rating: 9.0, audience: "300만", poster: "https://i.namu.wiki/i/fBt_IWG9AADxLWh-QjXKZR_PsD-IpY1EhD50Sg4UhbkPTVcMUaIPz-soaZlh1BUyYgavsEHqqmfZIV7-unONBw.webp" },
    { id: 4, title: "테넷", rating: 8.5, audience: "200만", poster: "https://i.namu.wiki/i/mHRHiSBXgecwb4Bj857ayW0HipQdBeAF4TSeNegZi4yqUGBlNZ_kOqSXiyc3T_mKPOSUyvyqaNtMUyu1uR1eAQ.webp" },
    { id: 5, title: "조커", rating: 8.9, audience: "500만", poster: "https://upload.wikimedia.org/wikipedia/ko/3/31/%EC%A1%B0%EC%BB%A4_%ED%8F%AC%EC%8A%A4%ED%84%B0.jpg" }
];

const theaters = [
    { id: 101, name: "CGV 강남", lat: 37.501, lng: 127.025, movies: [1, 2, 5] },
    { id: 102, name: "메가박스 코엑스", lat: 37.512, lng: 127.058, movies: [1, 3, 4] },
    { id: 103, name: "롯데시네마 신림", lat: 37.484, lng: 126.929, movies: [2, 5] }
];

// --- 2. 상태 관리 변수 ---
let userCoords = { lat: 37.5665, lng: 126.9780 }; // 기본 서울
let currentDistance = 3; // 기본 3km
let map;
let minTime = 0;
let maxTime = 24;

// --- 3. 유틸리티 함수 (거리 계산 하버사인 공식) ---
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- 4. 핵심 기능 구현 --- 

// 초기 실행: 위치 정보 가져오기 및 맵 세팅
function init() {
    // [추가] 페이지 로드 시 날짜 버튼을 바로 만듭니다.
    renderDateButtons();
    // [추가] 시간 슬라이더 초기 설정
    setupTimeSlider();

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setupMap();
            renderMain();
        });
    }
}

// [추가] 오늘부터 6일간의 날짜 버튼 생성 함수
function renderDateButtons() {
    const container = document.getElementById('date-buttons-container');
    if(!container) return; // HTML에 해당 id가 있을 때만 실행

    const today = new Date();
    container.innerHTML = ''; // 초기화

    for (let i = 0; i < 6; i++) {
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + i);
        const day = futureDate.getDate();

        const btn = document.createElement('button');
        btn.className = 'date-btn';
        if (i === 0) btn.classList.add('active');
        btn.textContent = day;
        
        btn.onclick = () => {
            document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // 여기서 날짜 변경 시 데이터를 다시 불러오는 로직을 추가할 수 있어요.
        };
        container.appendChild(btn);
    }
}

// [추가] 시간 슬라이더 작동 함수
function setupTimeSlider() {
    const minInput = document.getElementById('time-min');
    const maxInput = document.getElementById('time-max');
    const minLabel = document.getElementById('min-label');
    const maxLabel = document.getElementById('max-label');
    const track = document.querySelector('.slider-track'); // 트랙 가져오기

    if(!minInput || !maxInput) return;

    const updateRange = () => {
        if (parseInt(minInput.value) > parseInt(maxInput.value)) {
            minInput.value = maxInput.value;
        }
        const minVal = parseInt(minInput.value);
        const maxVal = parseInt(maxInput.value);

        // --- 여기서부터 핵심: 배경색 칠하기 ---
        // (min% 지점까지는 회색, min%~max%는 파란색, max% 이후는 다시 회색)
        const minPercent = (minVal / 24) * 100;
        const maxPercent = (maxVal / 24) * 100;
        track.style.background = `linear-gradient(to right, #ddd ${minPercent}%, #007bff ${minPercent}%, #007bff ${maxPercent}%, #ddd ${maxPercent}%)`;
        // --------------------------------------

        minLabel.textContent = minVal.toString().padStart(2, '0') + ":00";
        maxLabel.textContent = maxVal.toString().padStart(2, '0') + ":00";
        
        minTime = minVal;
        maxTime = maxVal;

        // 슬라이더를 움직일 때마다 검색 결과를 다시 필터링하고 싶다면 여기에 함수 추가
    };

    minInput.addEventListener('input', updateRange);
    maxInput.addEventListener('input', updateRange);

    updateRange();
}

function setupMap() {
    map = L.map('map').setView([userCoords.lat, userCoords.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    L.marker([userCoords.lat, userCoords.lng]).addTo(map).bindPopup("내 위치").openPopup();

    // 5km 이내 상영관 표시
    theaters.forEach(t => {
        if (getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng) <= 5) {
            L.circleMarker([t.lat, t.lng], { color: 'red', radius: 5 }).addTo(map).bindPopup(t.name);
        }
    });
}

// 메인 페이지 렌더링
function renderMain() {
    const list = document.getElementById('popular-list');
    list.innerHTML = movies.map((m, idx) => `
        <div class="movie-card-mini">
            <small>${idx + 1}위</small>
            <img src="${m.poster}" alt="${m.title}">
            <p>${m.title}</p>
        </div>
    `).join('');
}

// 검색 기능 
document.getElementById('search-btn').addEventListener('click', () => {
    showPage('search-page');
    const results = document.getElementById('search-results');
    // 실제로는 필터링 로직이 들어가야 함 (여기선 전체 출력)
    results.innerHTML = movies.map(m => `
        <div class="movie-item" onclick="viewDetail(${m.id})">
            <img src="${m.poster}">
            <h3>${m.title}</h3>
            <p>상영 시간 범위: ${minTime}:00 ~ ${maxTime}:00</p>
        </div>
    `).join('');
});

// 상세 페이지 보기
function viewDetail(movieId) {
    const movie = movies.find(m => m.id === movieId);
    showPage('detail-page');
    
    document.getElementById('detail-poster').src = movie.poster;
    document.getElementById('detail-title').innerText = movie.title;
    renderTheaters(movieId);
}

// 상영관 리스트 렌더링 (거리 필터 적용)
function renderTheaters(movieId) {
    const list = document.getElementById('theater-list');
    const filtered = theaters
        .filter(t => t.movies.includes(movieId))
        .map(t => ({ ...t, dist: getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng) }))
        .filter(t => t.dist <= currentDistance)
        .sort((a, b) => a.dist - b.dist);

    list.innerHTML = filtered.length > 0 
        ? filtered.map(t => `
            <div class="theater-item">
                <div>
                    <div class="theater-name">${t.name}</div>
                    <div class="theater-dist">${t.dist.toFixed(1)}km 떨어짐</div>
                </div>
                <button style="padding: 10px; cursor: pointer;">시간표 보기</button>
            </div>
        `).join('')
        : '<p>해당 거리 내에 상영관이 없습니다.</p>';
}

// 페이지 전환 함수
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
}

// 이벤트 리스너: 거리 옵션 변경
document.querySelectorAll('.dist-opt').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.dist-opt').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentDistance = parseInt(e.target.dataset.dist);
        // 현재 열려있는 영화 ID를 가져와 재렌더링 (간소화 위해 로직 생략 가능)
        const currentTitle = document.getElementById('detail-title').innerText;
        const movie = movies.find(m => m.title === currentTitle);
        if (movie) renderTheaters(movie.id);
    });
});

document.getElementById('logo').onclick = () => showPage('main-page');

init();