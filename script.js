// ─────────────────────────────────────────────
//  QuickMovie — script.js (통합본)
// ─────────────────────────────────────────────

// --- 1. API 키 ---
const KOBIS_API_KEY  = "4cc66795e4272f37db6169ed85eed268";
const TMDB_API_KEY   = "96a2f165cbef86dc5d7af5cc9c31fb62";
const GOOGLE_API_KEY = "AIzaSyCS0R14HglGfb2Di6WK587FKuxfy3n6ez4";

// --- 2. 상영관 데이터 ---
// nearbyTheaters: Google Places API 로 동적 로드
let nearbyTheaters = [];

// 하드코딩 theaters는 showtimes 생성용으로만 유지 (rank 매핑)
const theaters = [
    { id: 101, name: "CGV 강남",        lat: 37.501, lng: 127.025, movieRanks: [1,2,5]  },
    { id: 102, name: "메가박스 코엑스",  lat: 37.512, lng: 127.058, movieRanks: [1,3,4]  },
    { id: 103, name: "롯데시네마 신림",  lat: 37.484, lng: 126.929, movieRanks: [2,5,6]  }
];

// 상영 시간 템플릿 (극장 index 별)
const SHOWTIME_TEMPLATES = [
    ["13:00","16:30","19:00","21:30"],
    ["12:00","15:30","18:00","20:30"],
    ["14:00","17:00","20:00","22:30"]
];

// --- 3. 전역 상태 ---
let movies = [];       // KOBIS TOP 10 (showtimes 포함)
let allMovies = [];    // KOBIS TOP 10 + TMDB 현재 상영작 전체
let displayLimit = 10; // 더보기용 표시 개수
let userCoords   = { lat: 37.5665, lng: 126.9780 };
let currentDistance = 3;
let map = null;          // Google Map 인스턴스
let mapMarkers = [];     // 지도 마커 목록
let minTime = 0;
let maxTime = 1440;
let selectedDates  = new Set();
let currentMovieId = null;
let currentSort    = 'default';
let currentKeyword = '';

const DAY_NAMES = ['일','월','화','수','목','금','토'];

// --- 4. 날짜 키 헬퍼 ---
function dateKey(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getMonth()+1}-${d.getDate()}`;
}

// --- 5. 어제 날짜 (KOBIS 용) ---
function getYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0].replace(/-/g, '');
}

// --- 6. API 데이터 로드 ---
async function fetchMovieData() {
    try {
        const kobisUrl = `https://kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?key=${KOBIS_API_KEY}&targetDt=${getYesterday()}`;
        const kobisRes  = await fetch(kobisUrl);
        const kobisData = await kobisRes.json();
        const dailyList = kobisData.boxOfficeResult.dailyBoxOfficeList; // 최대 10편

        const moviePromises = dailyList.map(async (kMovie, idx) => {
            const rank = idx + 1;
            const tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(kMovie.movieNm)}&language=ko-KR`;
            const tmdbRes  = await fetch(tmdbUrl);
            const tmdbData = await tmdbRes.json();
            const info     = tmdbData.results?.[0] ?? null;

            // showtimes 자동 생성: 해당 rank 를 상영하는 극장 찾아서 날짜별로 배분
            const showtimes = [];
            theaters.forEach((t, tIdx) => {
                if (t.movieRanks.includes(rank)) {
                    // 오늘 + 3일치 상영 일정 생성
                    for (let dayOff = 0; dayOff < 4; dayOff++) {
                        if (dayOff === 1 && tIdx === 0) continue; // 약간의 변화
                        showtimes.push({
                            date: dateKey(dayOff),
                            theaterId: t.id,
                            times: SHOWTIME_TEMPLATES[tIdx].filter((_, i) => (i + dayOff) % 2 === 0 || dayOff === 0)
                        });
                    }
                }
            });

            return {
                id:       rank,                          // 순위를 id로 사용
                rank,
                title:    kMovie.movieNm,
                rating:   info ? parseFloat(info.vote_average.toFixed(1)) : 'N/A',
                audience: (parseInt(kMovie.audiAcc) / 10000).toFixed(1) + '만',
                seats:    250,
                seatsLeft: Math.floor(Math.random() * 200) + 20, // 좌석은 랜덤 시뮬레이션
                poster:   info?.poster_path
                            ? `https://image.tmdb.org/t/p/w500${info.poster_path}`
                            : 'https://via.placeholder.com/500x750?text=No+Image',
                showtimes
            };
        });

        movies = await Promise.all(moviePromises);

        // TMDB 현재 상영작 추가 로드 (최대 3페이지 = 60편)
        const kobisIds = new Set(movies.map(m => m.title));
        const tmdbNowPages = await Promise.allSettled([1, 2, 3].map(page =>
            fetch(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=ko-KR&region=KR&page=${page}`)
                .then(r => r.json())
        ));

        let extraId = 1000;
        const extraMovies = [];
        for (const result of tmdbNowPages) {
            if (result.status !== 'fulfilled') continue;
            for (const t of (result.value.results ?? [])) {
                if (kobisIds.has(t.title)) continue; // 중복 제거
                kobisIds.add(t.title);
                extraMovies.push({
                    id:        extraId++,
                    rank:      null,
                    title:     t.title,
                    rating:    t.vote_average ? parseFloat(t.vote_average.toFixed(1)) : 'N/A',
                    audience:  '-',
                    seats:     250,
                    seatsLeft: Math.floor(Math.random() * 200) + 20,
                    poster:    t.poster_path
                                 ? `https://image.tmdb.org/t/p/w500${t.poster_path}`
                                 : 'https://via.placeholder.com/500x750?text=No+Image',
                    showtimes: [] // 추가 영화는 상영시간 없음 → 필터 통과 처리
                });
            }
        }

        allMovies = [...movies, ...extraMovies];

        renderMain();
        initInfiniteSlider();

    } catch (err) {
        console.error('API 로딩 오류:', err);
        showApiError();
    }
}

function showApiError() {
    const list = document.getElementById('popular-list');
    if (list) list.innerHTML = '<p style="color:#aaa;padding:20px;">데이터를 불러올 수 없습니다.</p>';
}

// --- 7. 무한 슬라이더 ---
function initInfiniteSlider() {
    const list = document.getElementById('popular-list');
    if (!list || movies.length === 0) return;

    // 카드 렌더 함수
    const makeCard = (m) => {
        const card = document.createElement('div');
        card.className = 'movie-card-mini';
        card.innerHTML = `
            <div class="rank">${m.rank}위</div>
            <img src="${m.poster}" alt="${m.title}">
            <p>${m.title}</p>`;
        card.addEventListener('click', () => viewDetail(m.id));
        return card;
    };

    // 원본 + 복제본(앞뒤) 으로 무한루프 구현
    list.innerHTML = '';
    const origCards = movies.map(makeCard);

    // 뒤쪽 복제 (10개 → 그 뒤에 1위~N위 반복)
    const clonesBefore = movies.map(makeCard); // 앞에 붙일 복제
    const clonesAfter  = movies.map(makeCard); // 뒤에 붙일 복제

    clonesBefore.forEach(c => list.appendChild(c)); // 앞 복제 (실제론 뒤에 DOM 순서로)
    // 실제로 원본을 중앙에, 복제를 앞뒤로

   // DOM 초기화 및 카드 삽입 완료 후
    list.innerHTML = '';
    [...clonesBefore, ...origCards, ...clonesAfter].forEach(c => list.appendChild(c));

    // 화면에 실제로 그려진 첫 번째 카드의 가로 폭을 소수점까지 정확하게 측정해옴
    const firstCard = list.firstElementChild;
    const cardWidth = firstCard ? firstCard.getBoundingClientRect().width : 110;
    const CARD_WIDTH = cardWidth + 14; // 실제 카드 폭 + gap(14)

    const total      = movies.length;
    let   index      = total; // 원본 시작 인덱스
    let   isTransitioning = false;

    // 초기 위치 설정
    list.style.transition = 'none';
    list.style.transform  = `translateX(-${index * CARD_WIDTH}px)`;

    function slideTo(idx, animate = true) {
        if (isTransitioning) return;
        isTransitioning = true;
        if (animate) {
            list.style.transition = 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)';
        } else {
            list.style.transition = 'none';
        }
        list.style.transform = `translateX(-${idx * CARD_WIDTH}px)`;
        index = idx;
    }

    list.addEventListener('transitionend', () => {
        isTransitioning = false;
        // 경계 도달 시 순간이동
        if (index >= total * 2) {
            list.style.transition = 'none';
            index = total;
            list.style.transform = `translateX(-${index * CARD_WIDTH}px)`;
        } else if (index < total) {
            list.style.transition = 'none';
            index = total * 2 - 1;
            list.style.transform = `translateX(-${index * CARD_WIDTH}px)`;
        }
    });

    // 3초마다 자동 이동
    setInterval(() => {
        slideTo(index + 1);
    }, 3000);
}

// --- 8. 유틸 ---
function getDistance(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getSeatBadge(movie) {
    const ratio = movie.seatsLeft / movie.seats;
    let cls, label;
    if      (ratio >= 0.5) { cls = 'seat-plenty'; label = `여유 (${movie.seatsLeft}석)`;     }
    else if (ratio >= 0.2) { cls = 'seat-few';    label = `부족 (${movie.seatsLeft}석)`;     }
    else                   { cls = 'seat-last';   label = `마감임박 (${movie.seatsLeft}석)`;  }
    return `<span class="seat-badge ${cls}">${label}</span>`;
}

// --- 9. 날짜 버튼 ---
function renderDateButtons() {
    const container = document.getElementById('date-buttons-container');
    if (!container) return;
    container.innerHTML = '';
    const today = new Date();

    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(today.getDate() + i);
        const dayNum  = d.getDate();
        const dayIdx  = d.getDay();
        const dayName = DAY_NAMES[dayIdx];
        const key     = `${d.getMonth()+1}-${dayNum}`;

        const btn = document.createElement('button');
        btn.className = 'date-btn';
        if (dayIdx === 0) btn.classList.add('sunday');
        if (dayIdx === 6) btn.classList.add('saturday');
        btn.innerHTML       = `<span class="day-name">${dayName}</span>${dayNum}`;
        btn.dataset.key     = key;

        btn.addEventListener('click', () => {
            if (selectedDates.has(key)) {
                selectedDates.delete(key);
                btn.classList.remove('active');
            } else {
                selectedDates.add(key);
                btn.classList.add('active');
            }
            updateResetBtnState();
            if (!document.getElementById('search-page').classList.contains('hidden')) {
                displayMovies(document.getElementById('result-search-input')?.value || '');
            }
        });
        container.appendChild(btn);
    }
}

// --- 10. 시간 슬라이더 (분 단위) ---
function minsToStr(mins) {
    if (mins >= 1440) return '24:00';
    return String(Math.floor(mins/60)).padStart(2,'0') + ':' + String(mins%60).padStart(2,'0');
}

function strToMins(str) {
    const m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1]), min = parseInt(m[2]);
    if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
    return h * 60 + min;
}

function setupTimeSlider() {
    const minRange = document.getElementById('time-min');
    const maxRange = document.getElementById('time-max');
    const minInput = document.getElementById('time-min-input');
    const maxInput = document.getElementById('time-max-input');
    const track    = document.querySelector('.slider-track');
    if (!minRange || !maxRange) return;

    function updateTrack(lo, hi) {
        const loPct = (lo / 1440) * 100;
        const hiPct = (hi / 1440) * 100;
        track.style.background = `linear-gradient(to right, #ddd ${loPct}%, #333 ${loPct}%, #333 ${hiPct}%, #ddd ${hiPct}%)`;
    }

    function syncFromRanges() {
        let lo = parseInt(minRange.value);
        let hi = parseInt(maxRange.value);
        if (lo > hi) {
            if (document.activeElement === minRange) { maxRange.value = lo; hi = lo; }
            else                                      { minRange.value = hi; lo = hi; }
        }
        minInput.value = minsToStr(lo);
        maxInput.value = minsToStr(hi);
        minInput.classList.remove('error');
        maxInput.classList.remove('error');
        updateTrack(lo, hi);
        minTime = lo; maxTime = hi;
        updateResetBtnState();
        if (!document.getElementById('search-page').classList.contains('hidden')) {
            displayMovies(currentKeyword);
        }
    }

    function syncFromTextInput(which) {
        const input   = which === 'min' ? minInput : maxInput;
        const val     = strToMins(input.value);
        if (val === null) { input.classList.add('error'); return; }
        input.classList.remove('error');
        const snapped = Math.round(val / 10) * 10;
        const clamped = Math.max(0, Math.min(1440, snapped));
        if (which === 'min') {
            const hi     = parseInt(maxRange.value);
            const finalLo = Math.min(clamped, hi);
            minRange.value = finalLo;
            minInput.value = minsToStr(finalLo);
            minTime = finalLo;
        } else {
            const lo     = parseInt(minRange.value);
            const finalHi = Math.max(clamped, lo);
            maxRange.value = finalHi;
            maxInput.value = minsToStr(finalHi);
            maxTime = finalHi;
        }
        updateTrack(parseInt(minRange.value), parseInt(maxRange.value));
        updateResetBtnState();
        if (!document.getElementById('search-page').classList.contains('hidden')) {
            displayMovies(currentKeyword);
        }
    }

    minRange.addEventListener('input', syncFromRanges);
    maxRange.addEventListener('input', syncFromRanges);
    ['min','max'].forEach(which => {
        const el = which === 'min' ? minInput : maxInput;
        el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); syncFromTextInput(which); el.blur(); } });
        el.addEventListener('blur',    () => syncFromTextInput(which));
    });
    syncFromRanges();
}

// --- 11. 지도 (Google Maps + Places API) ---
function setupMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // Google Map 초기화
    map = new google.maps.Map(mapEl, {
        center: { lat: userCoords.lat, lng: userCoords.lng },
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: false,
        styles: [
            { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'simplified' }] }
        ]
    });

    // 내 위치 마커 (파란 원 - 안정적인 SVG)
    const userMarker = new google.maps.Marker({
        position: { lat: userCoords.lat, lng: userCoords.lng },
        map,
        title: '내 위치',
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="8" fill="#4285F4" stroke="white" stroke-width="3"/>
                </svg>`),
            scaledSize: new google.maps.Size(20, 20),
            anchor: new google.maps.Point(10, 10)
        },
        zIndex: 999
    });

    // Places API 로 주변 영화관 검색
    const service = new google.maps.places.PlacesService(map);
    service.nearbySearch({
        location: { lat: userCoords.lat, lng: userCoords.lng },
        radius: 5000,
        keyword: '영화관',
        type: 'movie_theater'
    }, (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) return;

        nearbyTheaters = results.map(p => ({
            placeId:  p.place_id,
            name:     p.name,
            lat:      p.geometry.location.lat(),
            lng:      p.geometry.location.lng(),
            address:  p.vicinity || '',
            rating:   p.rating || null,
            open:     p.opening_hours?.open_now ?? null
        }));

        // 지도에 마커 추가
        nearbyTheaters.forEach(t => {
            const dist = getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng);
            const marker = new google.maps.Marker({
                position: { lat: t.lat, lng: t.lng },
                map,
                title: t.name,
                icon: {
                    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
                            <path d="M16 0C7.16 0 0 7.16 0 16c0 11 16 24 16 24s16-13 16-24C32 7.16 24.84 0 16 0z" fill="#e63946"/>
                            <text x="16" y="20" text-anchor="middle" font-size="14" fill="white">🎬</text>
                        </svg>`),
                    scaledSize: new google.maps.Size(32, 40),
                    anchor: new google.maps.Point(16, 40)
                }
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="font-family:'Apple SD Gothic Neo',sans-serif;padding:4px 2px;min-width:140px;">
                        <div style="font-weight:700;font-size:0.9rem;margin-bottom:4px;">${t.name}</div>
                        <div style="font-size:0.75rem;color:#888;margin-bottom:4px;">📍 ${dist.toFixed(1)}km</div>
                        ${t.rating ? `<div style="font-size:0.75rem;color:#f57f17;">⭐ ${t.rating}</div>` : ''}
                        ${t.open !== null ? `<div style="font-size:0.72rem;color:${t.open ? '#2e7d32' : '#c62828'};margin-top:3px;">${t.open ? '🟢 영업중' : '🔴 영업종료'}</div>` : ''}
                    </div>`
            });

            marker.addListener('click', () => {
                mapMarkers.forEach(m => m.iw?.close());
                infoWindow.open(map, marker);
            });

            mapMarkers.push({ marker, iw: infoWindow, theater: t });
        });
    });
}

// --- 12. 메인 렌더 (로딩 중 스켈레톤) ---
function renderMain() {
    // 슬라이더는 initInfiniteSlider 에서 처리
    // 여기서는 필요 시 다른 메인 요소 렌더
}

// --- 13. 극장 필터 렌더 ---
function filterByTheater(theater) {
    const titleEl = document.getElementById('search-title');
    const countEl = document.getElementById('result-count');
    const results = document.getElementById('search-results');

    const theaterMovieIds = new Set(
        movies.flatMap(m => m.showtimes.filter(s => s.theaterId === theater.id).map(() => m.id))
    );
    const filtered = allMovies.filter(m => theaterMovieIds.has(m.id));

    titleEl.textContent = `📍 ${theater.name}`;
    countEl.textContent = `${filtered.length}편`;

    if (filtered.length === 0) {
        results.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:#bbb;">상영 중인 영화가 없습니다.</div>`;
        return;
    }
    results.innerHTML = filtered.map(m => makeMovieItemHTML(m)).join('');
}

// --- 14. 영화 카드 HTML ---
function makeMovieItemHTML(m) {
    const rankBadge = m.rank ? `<div class="rank-badge">🏆 ${m.rank}위</div>` : '';
    return `
    <div class="movie-item" onclick="viewDetail(${m.id})">
        <div class="movie-poster-wrap">
            ${rankBadge}
            <img class="movie-item-poster" src="${m.poster}" alt="${m.title}">
        </div>
        <div class="movie-item-info">
            <div class="movie-item-title">${m.title}</div>
            <div class="movie-item-meta">
                <div class="meta-row">
                    <span class="meta-label">⭐ 평점</span>
                    <span class="meta-value" style="font-weight:700;color:#f57f17;">${m.rating}</span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">👥 관객</span>
                    <span class="meta-value">${m.audience}</span>
                </div>
            </div>
        </div>
    </div>`;
}

// --- 15. 영화 목록 표시 ---
function displayMovies(keyword = '', resetLimit = true) {
    currentKeyword = keyword;
    if (resetLimit) displayLimit = 12;

    const results = document.getElementById('search-results');
    const titleEl = document.getElementById('search-title');
    const countEl = document.getElementById('result-count');

    // 날짜·시간 필터가 활성화된 경우 showtimes 없는 영화는 제외, 아니면 전부 포함
    const hasDateFilter = selectedDates.size > 0;
    const hasTimeFilter = minTime !== 0 || maxTime !== 1440;
    const useShowtimeFilter = hasDateFilter || hasTimeFilter;

    let filtered = allMovies.filter(m => {
        if (keyword && !m.title.includes(keyword)) return false;
        if (!useShowtimeFilter) return true; // 필터 없으면 전체 통과
        if (m.showtimes.length === 0) return false; // 추가영화는 시간필터 시 제외
        return m.showtimes.some(s => {
            const dateOk = !hasDateFilter || selectedDates.has(s.date);
            const timeOk = s.times.some(t => {
                const [h, min] = t.split(':').map(Number);
                return (h * 60 + min) >= minTime && (h * 60 + min) <= maxTime;
            });
            return dateOk && timeOk;
        });
    });

    if (currentSort === 'rating') {
        filtered = [...filtered].sort((a, b) => {
            if (a.rating === 'N/A') return 1;
            if (b.rating === 'N/A') return -1;
            return b.rating - a.rating;
        });
    } else if (currentSort === 'seats') {
        filtered = [...filtered].sort((a, b) => b.seatsLeft - a.seatsLeft);
    }

    titleEl.textContent = keyword ? `"${keyword}" 검색 결과` : '전체 영화';
    countEl.textContent = `${filtered.length}편`;

    if (filtered.length === 0) {
        results.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:#bbb;">
            <div style="font-size:2rem;margin-bottom:10px;">🎬</div>
            <div style="margin-bottom:16px;">조건에 맞는 영화가 없습니다</div>
            <button onclick="resetFilters()" style="padding:8px 20px;border:1.5px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;font-family:inherit;color:#555;">✕ 필터 초기화</button>
        </div>`;
        return;
    }

    const visible  = filtered.slice(0, displayLimit);
    const hasMore  = filtered.length > displayLimit;

    results.innerHTML = visible.map(m => makeMovieItemHTML(m)).join('');

    // 더보기 버튼
    if (hasMore) {
        const remaining = filtered.length - displayLimit;
        const moreBtn = document.createElement('div');
        moreBtn.style.cssText = 'grid-column:1/-1;text-align:center;padding:10px 0 20px;';
        moreBtn.innerHTML = `
            <button id="load-more-btn" onclick="loadMore()">
                더보기 <span class="more-count">${remaining}편 더 있음</span>
            </button>`;
        results.appendChild(moreBtn);
    }
}

function loadMore() {
    displayLimit += 12;
    displayMovies(currentKeyword, false);
    // 스크롤 유지 (새로 추가된 카드 위치로 부드럽게)
    const btn = document.getElementById('load-more-btn');
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- 16. 필터 초기화 ---
function resetFilters() {
    const searchInput = document.getElementById('result-search-input');
    if (searchInput) searchInput.value = '';
    currentKeyword = '';
    displayLimit = 12;
    selectedDates.clear();
    document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('time-min').value       = 0;
    document.getElementById('time-max').value       = 1440;
    document.getElementById('time-min-input').value = '00:00';
    document.getElementById('time-max-input').value = '24:00';
    document.getElementById('time-min-input').classList.remove('error');
    document.getElementById('time-max-input').classList.remove('error');
    minTime = 0; maxTime = 1440;
    const track = document.querySelector('.slider-track');
    if (track) track.style.background = '#ddd';
    updateResetBtnState();
    displayMovies('');
}

function updateResetBtnState() {
    const btn = document.getElementById('reset-filter-btn');
    if (!btn) return;
    const hasFilter = selectedDates.size > 0 || minTime !== 0 || maxTime !== 1440 || currentKeyword !== '';
    btn.classList.toggle('has-filter', hasFilter);
}

// --- 17. 상세 페이지 ---
function viewDetail(movieId) {
    currentMovieId = movieId;
    const movie = allMovies.find(m => m.id === movieId);
    if (!movie) return;
    showPage('detail-page');

    document.getElementById('detail-poster').src          = movie.poster;
    document.getElementById('detail-title').innerText     = movie.title;
    document.getElementById('detail-rating').textContent   = `⭐ ${movie.rating}`;
    document.getElementById('detail-audience').textContent = `👥 관객 ${movie.audience}`;

    setBreadcrumb([
        { label: '홈',   page: 'main-page'   },
        { label: '검색', page: 'search-page' },
        { label: movie.title, page: null }
    ]);
    renderTheaters(movieId);
}

// --- 18. 상영관 리스트 (Google Places 기반) ---
function renderTheaters(movieId) {
    const list  = document.getElementById('theater-list');
    const movie = allMovies.find(m => m.id === movieId);
    if (!movie) return;

    // nearbyTheaters 가 아직 로드 안 됐을 때
    if (nearbyTheaters.length === 0) {
        list.innerHTML = `
            <div class="no-theater">
                <div class="no-icon">🗺️</div>
                <div>주변 상영관을 불러오는 중입니다...</div>
                <div style="font-size:0.78rem;color:#ccc;margin-top:6px;">위치 권한을 허용했는지 확인해주세요</div>
            </div>`;
        // 2초 후 재시도
        setTimeout(() => { if (currentMovieId === movieId) renderTheaters(movieId); }, 2000);
        return;
    }

    // 거리 계산 + currentDistance 필터 + 정렬
    const filteredTheaters = nearbyTheaters
        .map(t => ({
            ...t,
            dist: getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng)
        }))
        .filter(t => t.dist <= currentDistance)
        .sort((a, b) => a.dist - b.dist);

    if (filteredTheaters.length === 0) {
        list.innerHTML = `
            <div class="no-theater">
                <div class="no-icon">😭</div>
                <div>${currentDistance}km 이내 상영관이 없습니다</div>
                <div style="font-size:0.78rem;color:#ccc;margin-top:6px;">거리 범위를 늘려보세요</div>
            </div>`;
        return;
    }

    /*list.innerHTML = result.map(t => {
        const googleMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.name)}&query_place_id=${t.placeId}`;
        return `
        <div class="theater-item">
            <div class="theater-info">
                <div class="theater-name">${t.name}</div>
                <div class="theater-meta-row">
                    <span class="theater-dist">📍 ${t.dist.toFixed(1)}km</span>
                    ${t.rating ? `<span class="theater-rating">⭐ ${t.rating}</span>` : ''}
                    ${t.open !== null
                        ? `<span class="theater-open ${t.open ? 'open' : 'closed'}">${t.open ? '영업중' : '영업종료'}</span>`
                        : ''}
                </div>
                <div class="theater-address">${t.address}</div>
            </div>
            <a class="timetable-btn" href="${googleMapUrl}" target="_blank" rel="noopener">
                지도 보기 →
            </a>
        </div>`;
    }).join('');
    */
   list.innerHTML = filteredTheaters.map((t, idx) => {
        
        // 영화 ID와 극장 index를 기반으로 가짜 상영시간 배열 만들기
        // 네이버 예매 화면처럼 여러 개의 시간 버튼을 나열하기 위함
        const baseHour = 10 + (movieId % 5) + (idx % 3); 
        const fakeTimes = [
            `${baseHour}:00`,
            `${baseHour + 2}:30`,
            `${baseHour + 5}:10`,
            `${baseHour + 7}:45`
        ].filter(time => {
            // 시간 슬라이더(minTime, maxTime) 필터 연동
            const [h, m] = time.split(':').map(Number);
            const totalMins = h * 60 + m;
            return totalMins >= minTime && totalMins <= maxTime;
        });

        // 만약 필터링된 상영 시간이 없다면 이 극장은 표시하지 않거나 패스
        if (fakeTimes.length === 0) return '';

        // 네이버 예매 화면 스타일의 시간 버튼 HTML 생성
        const timeButtonsHTML = fakeTimes.map(time => {
            const [h, m] = time.split(':').map(Number);
            // 대략 2시간 뒤 종료되도록 계산
            const endHour = m + 120 >= 1440 ? 24 : h + 2; 
            const endMin = String((m + 20) % 60).padStart(2, '0');
            
            return `
                <button class="time-slot-btn" onclick="alert('${t.name} ${time} 예매 페이지로 이동합니다.')">
                    <span class="start-time">${time}</span>
                    <span class="end-time">~${endHour}:${endMin}</span>
                    <span class="hall-info">${(idx % 3) + 1}관 층</span>
                </button>
            `;
        }).join('');

        const googleMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.name)}&query_place_id=${t.placeId}`;
        
        return `
        <div class="theater-schedule-box">
            <div class="theater-header">
                <div class="theater-name-wrapper">
                    <span class="theater-name">${t.name}</span>
                    <span class="theater-dist">📍 ${t.dist.toFixed(1)}km</span>
                </div>
                <a class="map-link-btn" href="${googleMapUrl}" target="_blank" rel="noopener">지도보기 ↗</a>
            </div>
            <div class="time-slots-container">
                ${timeButtonsHTML}
            </div>
        </div>`;
   }).join('');

}

// --- 19. 브레드크럼 ---
function setBreadcrumb(crumbs) {
    const nav = document.getElementById('breadcrumb');
    if (!nav) return;
    nav.innerHTML = crumbs.map((c, i) => {
        const sep = i > 0 ? '<span class="sep">›</span>' : '';
        if (!c.page) return `${sep}<span class="crumb" style="color:#D4E7E1">${c.label}</span>`;
        return `${sep}<span class="crumb" onclick="showPage('${c.page}')">${c.label}</span>`;
    }).join('');
}

// --- 20. 페이지 전환 ---
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
    if (pageId === 'main-page') {
        const nav = document.getElementById('breadcrumb');
        if (nav) nav.innerHTML = '';
    } else if (pageId === 'search-page') {
        setBreadcrumb([
            { label: '홈',   page: 'main-page' },
            { label: '검색 결과', page: null }
        ]);
        if (movies.length > 0 && !currentKeyword) displayMovies('');
    }
}

// --- 21. 이벤트 바인딩 ---
document.getElementById('search-btn')?.addEventListener('click', () => {
    const kw = document.getElementById('search-input').value;
    showPage('search-page');
    displayMovies(kw);
});
document.getElementById('search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('search-btn').click();
});
document.getElementById('discover-btn')?.addEventListener('click', () => {
    showPage('search-page');
    displayMovies('');
});
document.getElementById('result-search-btn')?.addEventListener('click', () => {
    displayMovies(document.getElementById('result-search-input').value);
});
document.getElementById('result-search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('result-search-btn').click();
});
document.querySelectorAll('.dist-opt').forEach(btn => {
    btn.addEventListener('click', e => {
        document.querySelectorAll('.dist-opt').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentDistance = parseInt(e.target.dataset.dist);
        if (currentMovieId) renderTheaters(currentMovieId);
    });
});
document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentSort = e.target.dataset.sort;
        displayMovies(currentKeyword);
    });
});
document.getElementById('reset-filter-btn')?.addEventListener('click', resetFilters);
document.getElementById('logo').onclick = () => showPage('main-page');

// --- 22. 초기화 ---
async function init() {
    renderDateButtons();
    setupTimeSlider();

    // 로딩 스켈레톤
    const list = document.getElementById('popular-list');
    if (list) {
        list.innerHTML = Array(5).fill(0).map(() => `
            <div class="movie-card-mini skeleton">
                <div class="skeleton-img"></div>
                <div class="skeleton-text"></div>
            </div>`).join('');
    }

    // API 데이터 로드
    await fetchMovieData();

    // 위치 + 지도
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => { userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setupMap(); },
            ()  => { setupMap(); }
        );
    } else {
        setupMap();
    }
}

init();