// ─────────────────────────────────────────────
//  QuickMovie — script.js (통합본)
// ─────────────────────────────────────────────

// --- 1. API 키 ---
const KOBIS_API_KEY  = "4cc66795e4272f37db6169ed85eed268";
const TMDB_API_KEY   = "96a2f165cbef86dc5d7af5cc9c31fb62";
const GOOGLE_API_KEY = "AIzaSyCS0R14HglGfb2Di6WK587FKuxfy3n6ez4";

// --- 2. 상영관 데이터 ---
// nearbyTheaters: Google Places API + CGV 모듈로 로드
let nearbyTheaters = [];

// CGV 캐시: { movieId → [ { theaterId, theaterName, lat, lng, address, showtimes } ] }
const cgvShowtimeCache = {};

// ──────────────────────────────────────────
//  showtimes 호환 변환 헬퍼
//  cgv-showtimes.js 의 포맷 →
//  기존 코드가 사용하는 { date, times[] } 포맷으로 변환
//  (상세 페이지 renderTheaters 에서는 cgvData 를 직접 사용하므로
//   여기서는 검색 필터용 경량 포맷만 생성)
// ──────────────────────────────────────────
function cgvToLegacyShowtimes(cgvTheaters) {
    // 모든 극장의 날짜+시간을 합산한 경량 포맷
    const byDate = {};
    cgvTheaters.forEach(theater => {
        theater.showtimes.forEach(({ date, schedules }) => {
            if (!byDate[date]) byDate[date] = new Set();
            schedules.forEach(s => byDate[date].add(s.time));
        });
    });
    return Object.entries(byDate).map(([date, timeSet]) => ({
        date,
        times: [...timeSet].sort()
    }));
}

// ──────────────────────────────────────────
//  CGV 상영 정보 로드 (캐시 우선)
// ──────────────────────────────────────────
async function loadCGVShowtimes(movieId, movieTitle) {
    if (cgvShowtimeCache[movieId]) return cgvShowtimeCache[movieId];
    const data = await fetchCGVShowtimes(movieTitle, movieId);
    cgvShowtimeCache[movieId] = data;
    return data;
}

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

// 상세 페이지 전용 필터 상태
let detailSelectedDates = new Set();
let detailMinTime = 0;
let detailMaxTime = 1440;

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

            // CGV 상영 정보 로드 (비동기, 캐시 우선)
            const cgvData  = await loadCGVShowtimes(rank, kMovie.movieNm);
            // 검색 필터용 경량 showtimes 포맷으로 변환
            const showtimes = cgvToLegacyShowtimes(cgvData);

            return {
                id:       rank,
                rank,
                title:    kMovie.movieNm,
                rating:   info ? parseFloat(info.vote_average.toFixed(1)) : 'N/A',
                audience: (parseInt(kMovie.audiAcc) / 10000).toFixed(1) + '만',
                seats:    250,
                seatsLeft: 0, // CGV 상세 데이터에서 관리
                poster:   info?.poster_path
                            ? `https://image.tmdb.org/t/p/w500${info.poster_path}`
                            : 'https://via.placeholder.com/500x750?text=No+Image',
                showtimes  // 경량 포맷 (날짜 필터용)
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
                const eId = extraId++;
                const cgvExtra = await loadCGVShowtimes(eId, t.title);
                extraMovies.push({
                    id:        eId,
                    rank:      null,
                    title:     t.title,
                    rating:    t.vote_average ? parseFloat(t.vote_average.toFixed(1)) : 'N/A',
                    audience:  '-',
                    seats:     250,
                    seatsLeft: 0,
                    poster:    t.poster_path
                                 ? `https://image.tmdb.org/t/p/w500${t.poster_path}`
                                 : 'https://via.placeholder.com/500x750?text=No+Image',
                    showtimes: cgvToLegacyShowtimes(cgvExtra)
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
        <div style="font-family:'Apple SD Gothic Neo',sans-serif;padding:2px;min-width:130px;max-width:160px;">
            <div style="font-weight:700;font-size:0.85rem;margin-bottom:2px;">${t.name}</div>
            <div style="font-size:0.72rem;color:#888;">📍 ${dist.toFixed(1)}km ${t.rating ? `· ⭐ ${t.rating}` : ''} ${t.open !== null ? `· <span style="color:${t.open ? '#2e7d32' : '#c62828'}">${t.open ? '영업중' : '영업종료'}</span>` : ''}</div>
            <button onclick="viewTheater('${t.name}', '${t.address}')" 
                style="margin-top:6px;width:100%;padding:5px;background:#022B2F;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.78rem;">
                🎬 상영 영화 보기
            </button>
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
        return m.showtimes.some(s => {
            const dateOk = !hasDateFilter || selectedDates.has(s.date);
            const timeOk = !hasTimeFilter || s.times.some(t => {
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

    // 상세 페이지 필터 초기화
    detailSelectedDates = new Set();
    detailMinTime = 0;
    detailMaxTime = 1440;

    setBreadcrumb([
        { label: '홈',   page: 'main-page'   },
        { label: '검색', page: 'search-page' },
        { label: movie.title, page: null }
    ]);

    renderDetailFilters(movieId);
    renderTheaters(movieId);
}

// 상세 페이지 날짜·시간 필터 UI 렌더
function renderDetailFilters(movieId) {
    const container = document.getElementById('detail-filter-area');
    if (!container) return;

    // 날짜 버튼 HTML
    const today = new Date();
    const dateBtnsHTML = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(today.getDate() + i);
        const dayIdx  = d.getDay();
        const dayName = DAY_NAMES[dayIdx];
        const dayNum  = d.getDate();
        const key     = `${d.getMonth()+1}-${dayNum}`;
        const sunClass = dayIdx === 0 ? ' sunday' : dayIdx === 6 ? ' saturday' : '';
        return `<button class="date-btn detail-date-btn${sunClass}" data-key="${key}">
            <span class="day-name">${dayName}</span>${dayNum}
        </button>`;
    }).join('');

    container.innerHTML = `
        <div class="detail-filter-bar">
            <div class="detail-filter-header">
                <span class="topbar-label" style="font-size:0.8rem;color:#555;">상영 일정 필터</span>
                <button id="detail-reset-btn">✕ 초기화</button>
            </div>
            <div class="detail-filter-row">
                <span class="topbar-label">날짜 <small>(없으면 전체)</small></span>
                <div class="date-picker-row" id="detail-date-buttons">${dateBtnsHTML}</div>
            </div>
            <div class="detail-filter-row">
                <span class="topbar-label">시간 범위</span>
                <div class="time-range-wrap">
                    <div class="dual-range-container">
                        <input type="range" id="detail-time-min" min="0" max="1440" value="0" step="10">
                        <input type="range" id="detail-time-max" min="0" max="1440" value="1440" step="10">
                        <div class="slider-track" id="detail-slider-track"></div>
                    </div>
                    <div class="time-range-display">
                        <input type="text" id="detail-time-min-input" class="time-text-input" value="00:00" maxlength="5">
                        <span class="time-tilde">~</span>
                        <input type="text" id="detail-time-max-input" class="time-text-input" value="24:00" maxlength="5">
                    </div>
                </div>
            </div>
        </div>`;

    // 날짜 버튼 이벤트
    document.querySelectorAll('.detail-date-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            if (detailSelectedDates.has(key)) {
                detailSelectedDates.delete(key);
                btn.classList.remove('active');
            } else {
                detailSelectedDates.add(key);
                btn.classList.add('active');
            }
            renderTheaters(movieId);
        });
    });

    // 시간 슬라이더 설정
    setupDetailTimeSlider(movieId);

    // 초기화 버튼
    document.getElementById('detail-reset-btn')?.addEventListener('click', () => {
        detailSelectedDates = new Set();
        detailMinTime = 0;
        detailMaxTime = 1440;
        document.querySelectorAll('.detail-date-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('detail-time-min').value = 0;
        document.getElementById('detail-time-max').value = 1440;
        document.getElementById('detail-time-min-input').value = '00:00';
        document.getElementById('detail-time-max-input').value = '24:00';
        const track = document.getElementById('detail-slider-track');
        if (track) track.style.background = '#ddd';
        renderTheaters(movieId);
    });
}

function setupDetailTimeSlider(movieId) {
    const minRange = document.getElementById('detail-time-min');
    const maxRange = document.getElementById('detail-time-max');
    const minInput = document.getElementById('detail-time-min-input');
    const maxInput = document.getElementById('detail-time-max-input');
    const track    = document.getElementById('detail-slider-track');
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
            else { minRange.value = hi; lo = hi; }
        }
        minInput.value = minsToStr(lo);
        maxInput.value = minsToStr(hi);
        minInput.classList.remove('error');
        maxInput.classList.remove('error');
        updateTrack(lo, hi);
        detailMinTime = lo;
        detailMaxTime = hi;
        renderTheaters(movieId);
    }

    function syncFromTextInput(which) {
        const input = which === 'min' ? minInput : maxInput;
        const val   = strToMins(input.value);
        if (val === null) { input.classList.add('error'); return; }
        input.classList.remove('error');
        const snapped = Math.round(val / 10) * 10;
        const clamped = Math.max(0, Math.min(1440, snapped));
        if (which === 'min') {
            const hi = parseInt(maxRange.value);
            const finalLo = Math.min(clamped, hi);
            minRange.value = finalLo;
            minInput.value = minsToStr(finalLo);
            detailMinTime = finalLo;
        } else {
            const lo = parseInt(minRange.value);
            const finalHi = Math.max(clamped, lo);
            maxRange.value = finalHi;
            maxInput.value = minsToStr(finalHi);
            detailMaxTime = finalHi;
        }
        updateTrack(parseInt(minRange.value), parseInt(maxRange.value));
        renderTheaters(movieId);
    }

    minRange.addEventListener('input', syncFromRanges);
    maxRange.addEventListener('input', syncFromRanges);
    ['min', 'max'].forEach(which => {
        const el = which === 'min' ? minInput : maxInput;
        el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); syncFromTextInput(which); el.blur(); } });
        el.addEventListener('blur', () => syncFromTextInput(which));
    });
    syncFromRanges();
}

// --- 18. 상영관 리스트 (CGV 데이터 기반) ---
async function renderTheaters(movieId) {
    const list  = document.getElementById('theater-list');
    const movie = allMovies.find(m => m.id === movieId);
    if (!movie) return;

    list.innerHTML = `<div class="no-theater"><div class="no-icon" style="font-size:1.5rem">⏳</div><div>CGV 상영 정보를 불러오는 중...</div></div>`;

    // CGV 상영 데이터 로드 (캐시 우선)
    const cgvData = await loadCGVShowtimes(movieId, movie.title);

    // 날짜 라벨 맵
    const dateLabels = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const key = `${d.getMonth()+1}-${d.getDate()}`;
        dateLabels[key] = `${d.getMonth()+1}/${d.getDate()} (${DAY_NAMES[d.getDay()]})`;
    }

    // CGV 극장 + 거리 계산 + currentDistance 필터 + 정렬
    const cgvWithDist = cgvData
        .map(t => ({
            ...t,
            dist: getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng)
        }))
        .filter(t => t.dist <= currentDistance)
        .sort((a, b) => a.dist - b.dist);

    if (cgvWithDist.length === 0) {
        list.innerHTML = `
            <div class="no-theater">
                <div class="no-icon">😭</div>
                <div>${currentDistance}km 이내 CGV 상영관이 없습니다</div>
                <div style="font-size:0.78rem;color:#ccc;margin-top:6px;">거리 범위를 늘려보세요</div>
            </div>`;
        return;
    }

    const hasDetailDateFilter = detailSelectedDates.size > 0;

    // 날짜 정렬 헬퍼
    const sortedDateKeys = Object.keys(dateLabels).sort((a, b) => {
        const [am, ad] = a.split('-').map(Number);
        const [bm, bd] = b.split('-').map(Number);
        return am !== bm ? am - bm : ad - bd;
    });

    const rows = cgvWithDist.map(theater => {
        // 이 극장의 날짜별 상영 데이터 가져오기
        const targetDates = hasDetailDateFilter
            ? [...detailSelectedDates].sort()
            : sortedDateKeys;

        const scheduleSections = targetDates.map(dk => {
            const dayData = theater.showtimes.find(s => s.date === dk);
            if (!dayData) return '';

            // 시간 필터 적용
            const filteredSchedules = dayData.schedules.filter(sch => {
                const [h, m] = sch.time.split(':').map(Number);
                const totalMins = h * 60 + m;
                return totalMins >= detailMinTime && totalMins <= detailMaxTime;
            });
            if (filteredSchedules.length === 0) return '';

            const label = dateLabels[dk] || dk;
            const buttons = filteredSchedules.map(sch => {
                // 좌석 상태 계산
                const ratio = sch.seatsLeft / sch.totalSeats;
                let seatClass, seatLabel;
                if      (ratio >= 0.5) { seatClass = 'seat-plenty'; seatLabel = `여유 ${sch.seatsLeft}석`; }
                else if (ratio >= 0.2) { seatClass = 'seat-few';    seatLabel = `혼잡 ${sch.seatsLeft}석`; }
                else                   { seatClass = 'seat-last';   seatLabel = `마감임박 ${sch.seatsLeft}석`; }

                // 상영 타입 배지 색상
                const typeBadgeClass = {
                    'IMAX': 'type-imax', 'IMAX 3D': 'type-imax',
                    '4DX': 'type-4dx', '4DX 3D': 'type-4dx',
                    'ScreenX': 'type-screenx',
                    '3D': 'type-3d'
                }[sch.screenType] || 'type-2d';

                // CGV 예매 링크 (실제 연동 시 theaterCode + 영화코드로 URL 생성)
                const bookingUrl = `https://www.cgv.co.kr/ticket/`;

                return `<button class="time-slot-btn" onclick="window.open('${bookingUrl}', '_blank')">
                    <span class="slot-date">${label}</span>
                    <span class="start-time">${sch.time}</span>
                    <span class="end-time">~${sch.endTime}</span>
                    <span class="hall-info">${sch.hall}</span>
                    <span class="screen-type-badge ${typeBadgeClass}">${sch.screenType}</span>
                    <span class="seat-badge ${seatClass}">${seatLabel}</span>
                </button>`;
            }).join('');

            return buttons;
        }).join('');

        if (!scheduleSections.trim()) return '';

        const googleMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(theater.theaterName)}`;
        const cgvUrl = `https://www.cgv.co.kr/theaters/?areacode=01&theaterCode=${theater.theaterCode}`;

        return `
        <div class="theater-schedule-box">
            <div class="theater-header">
                <div class="theater-name-wrapper">
                    <span class="theater-name">${theater.theaterName}</span>
                    <span class="theater-dist">📍 ${theater.dist.toFixed(1)}km</span>
                    <a class="cgv-link-badge" href="${cgvUrl}" target="_blank" rel="noopener">CGV↗</a>
                </div>
                <a class="map-link-btn" href="${googleMapUrl}" target="_blank" rel="noopener">지도보기 ↗</a>
            </div>
            <div class="theater-address">${theater.address}</div>
            <div class="time-slots-container">${scheduleSections}</div>
        </div>`;
    }).join('');

    const noResult = rows.trim() === '';
    list.innerHTML = noResult
        ? `<div class="no-theater"><div class="no-icon">🕐</div><div>해당 조건의 CGV 상영 시간이 없습니다</div><div style="font-size:0.78rem;color:#ccc;margin-top:6px;">날짜 또는 시간 범위를 변경해보세요</div></div>`
        : rows;
}

function viewTheater(theaterName, theaterAddress) {
    // infoWindow 닫기
    mapMarkers.forEach(m => m.iw?.close());

    // 극장 페이지로 이동
    showPage('theater-page');
    document.getElementById('selected-theater-name').textContent = theaterName;
    document.getElementById('selected-theater-info').textContent = theaterAddress;

    setBreadcrumb([
        { label: '홈', page: 'main-page' },
        { label: theaterName, page: null }
    ]);

    // 해당 극장 이름이 포함된 영화 찾기
    const theaterMovieList = document.getElementById('theater-movie-list');
    theaterMovieList.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#aaa;">⏳ 상영 영화를 불러오는 중...</div>';

    // CGV 캐시에서 해당 극장 이름으로 영화 찾기
    const matchedMovies = [];

    allMovies.forEach(movie => {
        const cgvData = cgvShowtimeCache[movie.id];
        if (!cgvData) return;
        const hasThisTheater = cgvData.some(t =>
            t.theaterName.includes(theaterName) || theaterName.includes(t.theaterName)
        );
        if (hasThisTheater) matchedMovies.push(movie);
    });

    if (matchedMovies.length === 0) {
        theaterMovieList.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:60px;color:#bbb;">
                <div style="font-size:2rem;margin-bottom:10px;">🎬</div>
                <div>상영 영화 정보가 없습니다</div>
                <div style="font-size:0.78rem;margin-top:6px;color:#ccc;">CGV 지점이 아니거나 데이터가 없을 수 있어요</div>
            </div>`;
        return;
    }

    theaterMovieList.innerHTML = matchedMovies.map(m => makeMovieItemHTML(m)).join('');
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
document.getElementById('back-to-main-btn')?.addEventListener('click', () => {
    showPage('main-page');
});
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