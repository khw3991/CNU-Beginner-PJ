// ─────────────────────────────────────────────
//  QuickMovie — script.js (통합본)
// ─────────────────────────────────────────────

// --- 1. API 키 ---
const KOBIS_API_KEY = "4cc66795e4272f37db6169ed85eed268";
const TMDB_API_KEY  = "96a2f165cbef86dc5d7af5cc9c31fb62";

// --- 2. 상영관 데이터 (고정) ---
// showtimes 는 API 로드 후 자동 생성됩니다
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
let movies = [];
let userCoords   = { lat: 37.5665, lng: 126.9780 };
let currentDistance = 3;
let map;
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

    // DOM 초기화
    list.innerHTML = '';
    [...clonesBefore, ...origCards, ...clonesAfter].forEach(c => list.appendChild(c));

    const CARD_WIDTH = 124; // card width(110) + gap(14)
    const total      = movies.length;
    let   index      = total; // 원본 시작 인덱스
    let   isTransitioning = false;

    // 초기 위치: 복제(앞) 다음인 원본 0번 카드
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

// --- 11. 지도 ---
function setupMap() {
    if (map) { map.remove(); map = null; }
    map = L.map('map', { zoomControl: false }).setView([userCoords.lat, userCoords.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    L.marker([userCoords.lat, userCoords.lng]).addTo(map).bindPopup('📍 내 위치').openPopup();

    theaters.forEach(t => {
        if (getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng) <= 5) {
            const marker = L.circleMarker([t.lat, t.lng], { color: '#e63946', radius: 6, fillColor: '#e63946', fillOpacity: 0.8 })
                .addTo(map)
                .bindPopup(`<b>🎬 ${t.name}</b><br><small style="color:#888">클릭하여 이 극장 영화 보기</small>`);
            marker.on('click', () => {
                showPage('search-page');
                filterByTheater(t);
            });
        }
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
    const filtered = movies.filter(m => theaterMovieIds.has(m.id));

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
    return `
    <div class="movie-item" onclick="viewDetail(${m.id})">
        <img class="movie-item-poster" src="${m.poster}" alt="${m.title}">
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
                <div class="meta-row">
                    <span class="meta-label">💺 좌석</span>
                    ${getSeatBadge(m)}
                </div>
            </div>
        </div>
    </div>`;
}

// --- 15. 영화 목록 표시 ---
function displayMovies(keyword = '') {
    currentKeyword = keyword;
    const results = document.getElementById('search-results');
    const titleEl = document.getElementById('search-title');
    const countEl = document.getElementById('result-count');

    let filtered = movies.filter(m => {
        if (keyword && !m.title.includes(keyword)) return false;
        const matchShowtime = m.showtimes.some(s => {
            const dateOk = selectedDates.size === 0 || selectedDates.has(s.date);
            const timeOk = s.times.some(t => {
                const [h, min] = t.split(':').map(Number);
                return (h * 60 + min) >= minTime && (h * 60 + min) <= maxTime;
            });
            return dateOk && timeOk;
        });
        return matchShowtime;
    });

    if (currentSort === 'rating') {
        filtered = [...filtered].sort((a, b) => b.rating - a.rating);
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
    results.innerHTML = filtered.map(m => makeMovieItemHTML(m)).join('');
}

// --- 16. 필터 초기화 ---
function resetFilters() {
    const searchInput = document.getElementById('result-search-input');
    if (searchInput) searchInput.value = '';
    currentKeyword = '';
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
    const movie = movies.find(m => m.id === movieId);
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

// --- 18. 상영관 리스트 ---
function renderTheaters(movieId) {
    const list  = document.getElementById('theater-list');
    const movie = movies.find(m => m.id === movieId);

    const result = theaters.map((t, tIdx) => {
        const dist = getDistance(userCoords.lat, userCoords.lng, t.lat, t.lng);
        const matchedTimes = [];
        movie.showtimes
            .filter(s => s.theaterId === t.id)
            .filter(s => selectedDates.size === 0 || selectedDates.has(s.date))
            .forEach(s => {
                s.times.forEach(time => {
                    const [h, min] = time.split(':').map(Number);
                    const totalMins = h * 60 + min;
                    if (totalMins >= minTime && totalMins <= maxTime) matchedTimes.push(time);
                });
            });
        return { ...t, dist, matchedTimes };
    })
    .filter(t => t.dist <= currentDistance && t.matchedTimes.length > 0)
    .sort((a, b) => a.dist - b.dist);

    if (result.length === 0) {
        list.innerHTML = `<div class="no-theater"><div class="no-icon">😶</div>조건에 맞는 상영관이 없습니다.</div>`;
        return;
    }

    list.innerHTML = result.map(t => {
        const timesHTML = [...new Set(t.matchedTimes)].map(ti => `<span class="time-badge">${ti}</span>`).join('');
        return `
        <div class="theater-item">
            <div>
                <div class="theater-name">${t.name}</div>
                <div class="theater-dist">📍 ${t.dist.toFixed(1)}km</div>
                <div class="theater-times">${timesHTML}</div>
            </div>
            <button class="timetable-btn" onclick="alert('${t.name} 시간표')">시간표 보기 →</button>
        </div>`;
    }).join('');
}

// --- 19. 브레드크럼 ---
function setBreadcrumb(crumbs) {
    const nav = document.getElementById('breadcrumb');
    if (!nav) return;
    nav.innerHTML = crumbs.map((c, i) => {
        const sep = i > 0 ? '<span class="sep">›</span>' : '';
        if (!c.page) return `${sep}<span class="crumb" style="color:#333">${c.label}</span>`;
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