// --- 1. API 설정 및 전역 변수 ---
const KOBIS_API_KEY = "4cc66795e4272f37db6169ed85eed268";
const TMDB_API_KEY = "96a2f165cbef86dc5d7af5cc9c31fb62";

let movies = []; // API 데이터를 담을 공간
let sliderInterval = null; // 슬라이더 타이머

// 팀원 코드에서 가져온 상영관 데이터
const theaters = [
    { id: 101, name: "CGV 강남", lat: 37.501, lng: 127.025, movies: [1, 2, 5] },
    { id: 102, name: "메가박스 코엑스", lat: 37.512, lng: 127.058, movies: [1, 3, 4] },
    { id: 103, name: "롯데시네마 신림", lat: 37.484, lng: 126.929, movies: [2, 5] }
];

let userCoords = { lat: 37.5665, lng: 126.9780 };
let currentDistance = 3;
let map;
let minTime = 0;
let maxTime = 24;

// --- 2. 날짜 및 데이터 호출 로직 (효원님 코드) ---
const getYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0].replace(/-/g, "");
};

async function fetchMovieData() {
    try {
        const targetDt = getYesterday();
        const kobisUrl = `http://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?key=${KOBIS_API_KEY}&targetDt=${targetDt}`;
        const kobisResponse = await fetch(kobisUrl);
        const kobisData = await kobisResponse.json();
        const dailyList = kobisData.boxOfficeResult.dailyBoxOfficeList;

        const moviePromises = dailyList.map(async (kMovie) => {
            const tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(kMovie.movieNm)}&language=ko-KR`;
            const tmdbResponse = await fetch(tmdbUrl);
            const tmdbData = await tmdbResponse.json();
            const movieInfo = tmdbData.results && tmdbData.results.length > 0 ? tmdbData.results[0] : null;
            
            return {
                id: kMovie.movieCd,
                title: kMovie.movieNm,
                rating: movieInfo ? movieInfo.vote_average : "N/A",
                audience: (parseInt(kMovie.audiAcc) / 10000).toFixed(1) + "만",
                poster: movieInfo 
                    ? `https://image.tmdb.org/t/p/w500${movieInfo.poster_path}` 
                    : "https://via.placeholder.com/500x750?text=No+Image"
            };
        });

        movies = await Promise.all(moviePromises);
        renderMain(); // 데이터 로드 후 화면 그리기
        startSlider(); // 화면 그린 후 슬라이더 시작
    } catch (error) {
        console.error("데이터 로딩 중 에러 발생:", error);
    }
}

// --- 3. 슬라이더 애니메이션 로직 (효원님 코드) ---
function startSlider() {
    if (sliderInterval) clearInterval(sliderInterval); 
    const list = document.getElementById('popular-list');
    let sliderIndex = 0;
    const gap = 10; 

    sliderInterval = setInterval(() => {
        const cards = list.querySelectorAll('.movie-card-mini');
        if (cards.length === 0) return;

        const cardWidth = cards[0].offsetWidth; 
        const moveDistance = cardWidth + gap;
        sliderIndex++;

        if (sliderIndex > 9) sliderIndex = 0;
        list.style.transform = `translateX(-${sliderIndex * moveDistance}px)`;
    }, 3000);
}

// --- 4. 유틸리티 및 지도 로직 (팀원 코드) ---
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setupMap() {
    if (map) map.remove(); // 기존 맵 초기화 방지
    map = L.map('map').setView([userCoords.lat, userCoords.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    L.marker([userCoords.lat, userCoords.lng]).addTo(map).bindPopup("내 위치").openPopup();

    theaters.forEach(t => {
        if (getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng) <= 5) {
            L.circleMarker([t.lat, t.lng], { color: 'red', radius: 5 }).addTo(map).bindPopup(t.name);
        }
    });
}

// --- 5. 화면 렌더링 및 이벤트 (팀원 코드 통합) ---
function renderMain() {
    const list = document.getElementById('popular-list');
    if(!list) return;
    list.innerHTML = movies.map((m, idx) => `
        <div class="movie-card-mini">
            <small>${idx + 1}위</small>
            <img src="${m.poster}" alt="${m.title}">
            <p>${m.title}</p>
        </div>
    `).join('');
}

function renderDateButtons() {
    const container = document.getElementById('date-buttons-container');
    if(!container) return;
    const today = new Date();
    container.innerHTML = '';
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
        };
        container.appendChild(btn);
    }
}

function setupTimeSlider() {
    const minInput = document.getElementById('time-min');
    const maxInput = document.getElementById('time-max');
    const minLabel = document.getElementById('min-label');
    const maxLabel = document.getElementById('max-label');
    const track = document.querySelector('.slider-track');
    if(!minInput || !maxInput) return;

    const updateRange = () => {
        if (parseInt(minInput.value) > parseInt(maxInput.value)) minInput.value = maxInput.value;
        const minVal = parseInt(minInput.value);
        const maxVal = parseInt(maxInput.value);
        const minPercent = (minVal / 24) * 100;
        const maxPercent = (maxVal / 24) * 100;
        track.style.background = `linear-gradient(to right, #ddd ${minPercent}%, #007bff ${minPercent}%, #007bff ${maxPercent}%, #ddd ${maxPercent}%)`;
        minLabel.textContent = minVal.toString().padStart(2, '0') + ":00";
        maxLabel.textContent = maxVal.toString().padStart(2, '0') + ":00";
        minTime = minVal;
        maxTime = maxVal;
    };
    minInput.addEventListener('input', updateRange);
    maxInput.addEventListener('input', updateRange);
    updateRange();
}

// --- 6. 초기화 함수 (중요!) ---
async function init() {
    renderDateButtons();
    setupTimeSlider();
    
    // 1. API 데이터 먼저 가져오기
    await fetchMovieData(); 

    // 2. 위치 가져오기 및 지도 설정
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setupMap();
        });
    } else {
        setupMap(); // 위치 거부 시 기본 서울 위치로 지도 설정
    }
}

// 로고 클릭 시 메인 이동
document.getElementById('logo').onclick = () => {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById('main-page').classList.remove('hidden');
};

init();