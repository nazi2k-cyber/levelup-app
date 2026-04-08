// ===== 내 영화 (My Movies) 모듈 =====
(function() {
    'use strict';

    const AppState = window.AppState;
    const i18n = window.i18n;

    // 기존 TMDB 영화 하위 호환용 (posterPath → 전체 URL 변환)
    const TMDB_IMG_COMPAT = 'https://image.tmdb.org/t/p/w185';
    const TMDB_IMG_LG_COMPAT = 'https://image.tmdb.org/t/p/w342';

    let _movCurrentTab = 'watched';
    let _movCurrentPeriod = 'total';
    let _movSearchQuery = '';
    let _movLocalSearch = false;
    let _apiSearchResults = [];
    let _apiSearchPage = 1;
    let _apiSearchHasMore = false;
    let _apiSearchQuery = '';
    let _searchDebounce = null;
    let _lastSearchError = false;
    let _movViewMode = 'tower';
    let _movTowerTheme = 'dark';

    function t(key) {
        const lang = (AppState && AppState.currentLang) || 'ko';
        return (i18n[lang] && i18n[lang][key]) || (i18n.ko && i18n.ko[key]) || key;
    }

    function todayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    function getLang() {
        return (AppState && AppState.currentLang) || 'ko';
    }

    function log(msg) {
        if (window.AppLogger) AppLogger.info('[Movie] ' + msg);
    }

    function logWarn(msg) {
        if (window.AppLogger) AppLogger.warn('[Movie] ' + msg);
    }

    function logError(msg) {
        if (window.AppLogger) AppLogger.error('[Movie] ' + msg);
    }

    // ── KOBIS+KMDb API (Cloud Function 경유) ──
    async function searchMoviesAPI(query, page) {
        page = page || 1;
        log('검색 시작: query=' + query + ', page=' + page);
        var tracker = window.AppLogger
            ? AppLogger.apiCall('[Movie]', '검색(searchMovies)')
            : null;
        try {
            var _ping = window._httpsCallable(window._functions, 'ping');
            var result = await _ping({ action: 'searchMovies', query: query, page: page });
            var data = result.data || {};
            var movies = data.movies || [];
            var hasMore = data.hasMore || false;
            if (tracker) tracker.success(movies.length + '건, hasMore=' + hasMore + ', total=' + (data.totalCount || 0));
            _lastSearchError = false;
            return { results: movies, hasMore: hasMore, totalCount: data.totalCount || 0 };
        } catch(e) {
            if (tracker) {
                tracker.fail(e, { action: 'searchMovies', query: query, page: page });
            } else {
                logError('검색 실패: ' + ((e && e.message) || String(e)));
            }
            _lastSearchError = true;
            return { results: [], hasMore: false, totalCount: 0 };
        }
    }

    async function fetchMovieDetails(movieCd, title, year, source) {
        log('상세 조회: movieCd=' + movieCd + ', title=' + title);
        var tracker = window.AppLogger
            ? AppLogger.apiCall('[Movie]', '상세조회(lookupMovie)')
            : null;
        try {
            var _ping = window._httpsCallable(window._functions, 'ping');
            var result = await _ping({ action: 'lookupMovie', movieCd: String(movieCd), title: title, year: year, source: source });
            var data = result.data || {};
            var movie = data.movie || null;
            if (movie) {
                if (tracker) tracker.success(movie.title);
            } else {
                logWarn('상세 조회 결과 없음: movieCd=' + movieCd);
            }
            return movie;
        } catch(e) {
            if (tracker) {
                tracker.fail(e, { action: 'lookupMovie', movieCd: movieCd, title: title, year: year, source: source });
            } else {
                logError('상세 조회 실패: ' + ((e && e.message) || String(e)));
            }
            return null;
        }
    }

    // ── Movie Card Count (status screen) ──
    window.updateMovieCardCount = function() {
        var items = (AppState.movies && AppState.movies.items) || [];
        var year = new Date().getFullYear();
        var yearlyCount = items.filter(function(m) {
            return m.category === 'watched' && new Date(m.addedDate).getFullYear() === year;
        }).length;
        var el = document.getElementById('mov-yearly-card-count');
        if (el) el.textContent = yearlyCount;
    };

    // ── Movie View Open/Close ──
    window.openMovieView = function() {
        var overlay = document.getElementById('movie-overlay');
        if (!overlay) return;
        log('상세화면 열림');
        overlay.classList.remove('d-none');
        _movCurrentTab = 'watched';
        _movCurrentPeriod = 'total';
        _movSearchQuery = '';
        _movLocalSearch = false;
        _apiSearchResults = [];
        _apiSearchQuery = '';
        _apiSearchPage = 1;
        _apiSearchHasMore = false;
        _lastSearchError = false;
        _movViewMode = 'tower';
        var input = document.getElementById('movie-search-input');
        if (input) input.value = '';
        var cb = document.getElementById('movie-local-filter');
        if (cb) cb.checked = false;
        // 뷰 토글 UI 초기화 (영화 오버레이 내부만)
        var movOverlay = document.getElementById('movie-overlay');
        if (movOverlay) {
            movOverlay.querySelectorAll('.lib-view-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.view === 'tower');
            });
        }
        updateMoviePeriodLabels();
        updateMoviePeriodCounts();
        updateMovieTabUI();
        showMovieMainContent(true);
        renderMovieList();
        hideMovieSearchResults();
    };

    window.closeMovieView = function() {
        var overlay = document.getElementById('movie-overlay');
        if (overlay) overlay.classList.add('d-none');
        window.updateMovieCardCount();
    };

    // ── Tab Switching ──
    window.switchMovieTab = function(cat) {
        _movCurrentTab = cat;
        updateMovieTabUI();
        updateMoviePeriodCounts();
        renderMovieList();
    };

    function updateMovieTabUI() {
        var tabs = document.querySelectorAll('.mov-tab');
        tabs.forEach(function(tab) {
            tab.classList.toggle('active', tab.getAttribute('data-cat') === _movCurrentTab);
        });
    }

    // ── Period Switching ──
    window.switchMoviePeriod = function(period) {
        _movCurrentPeriod = period;
        var btns = document.querySelectorAll('.mov-count-btn');
        btns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-period') === period);
        });
        renderMovieList();
    };

    function updateMoviePeriodLabels() {
        var now = new Date();
        var year = now.getFullYear();
        var month = String(now.getMonth() + 1).padStart(2, '0');
        var yearEl = document.getElementById('mov-label-yearly');
        if (yearEl) yearEl.textContent = year + (getLang() === 'en' ? '' : '년');
        var monthEl = document.getElementById('mov-label-monthly');
        if (monthEl) monthEl.textContent = year + '-' + month;
    }

    function updateMoviePeriodCounts() {
        var items = (AppState.movies && AppState.movies.items) || [];
        var filtered = items.filter(function(m) { return m.category === _movCurrentTab; });
        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth();
        var totalCount = filtered.length;
        var yearlyCount = filtered.filter(function(m) { return new Date(m.addedDate).getFullYear() === year; }).length;
        var monthlyCount = filtered.filter(function(m) {
            var d = new Date(m.addedDate);
            return d.getFullYear() === year && d.getMonth() === month;
        }).length;
        var elT = document.getElementById('mov-count-total');
        var elY = document.getElementById('mov-count-yearly');
        var elM = document.getElementById('mov-count-monthly');
        if (elT) elT.textContent = totalCount;
        if (elY) elY.textContent = yearlyCount;
        if (elM) elM.textContent = monthlyCount;
    }

    // ── 메인 콘텐츠 표시/숨김 (검색 시 결과만 표시) ──
    function showMovieMainContent(show) {
        var selectors = '#movie-overlay .library-count-bar, #movie-overlay .library-tabs, #movie-overlay .library-view-toggle, #movie-content';
        var els = document.querySelectorAll(selectors);
        els.forEach(function(el) {
            el.style.display = show ? '' : 'none';
        });
    }

    // ── Search ──
    window.filterMovieList = function(query) {
        _movSearchQuery = (query || '').trim();
        if (_searchDebounce) clearTimeout(_searchDebounce);

        if (_movLocalSearch) {
            renderMovieList();
            return;
        }

        if (_movSearchQuery.length < 2) {
            hideMovieSearchResults();
            showMovieMainContent(true);
            renderMovieList();
            return;
        }

        // 검색 중 표시 — 메인 콘텐츠 숨기고 검색 결과 영역만 표시
        showMovieMainContent(false);
        var container = document.getElementById('movie-search-results');
        if (container) {
            container.classList.remove('d-none');
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-sub);">' + t('mov_searching') + '</div>';
        }

        _searchDebounce = setTimeout(async function() {
            _apiSearchQuery = _movSearchQuery;
            _apiSearchPage = 1;
            var result = await searchMoviesAPI(_apiSearchQuery, 1);
            _apiSearchResults = result.results;
            _apiSearchHasMore = result.hasMore;
            showMovieSearchResults();
        }, 400);
    };

    window.toggleMovieSearchMode = function(checked) {
        _movLocalSearch = checked;
        if (checked) {
            hideMovieSearchResults();
            showMovieMainContent(true);
            renderMovieList();
        } else {
            if (_movSearchQuery.length >= 2) {
                window.filterMovieList(_movSearchQuery);
            } else {
                showMovieMainContent(true);
            }
        }
    };

    function showMovieSearchResults() {
        var container = document.getElementById('movie-search-results');
        if (!container) return;
        container.classList.remove('d-none');

        // API 오류 시 별도 메시지 표시
        if (_lastSearchError) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#ff6b6b; font-size:0.82rem;">⚠️ ' + t('mov_search_error') + '</div>';
            return;
        }

        if (_apiSearchResults.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-sub);">' + t('mov_no_results') + '</div>';
            return;
        }
        var existingIds = ((AppState.movies && AppState.movies.items) || []).map(function(m) { return m.movieCd || m.tmdbId; });
        var html = '';
        _apiSearchResults.forEach(function(m, idx) {
            var exists = existingIds.indexOf(m.movieCd) !== -1;
            html += '<div class="movie-search-item" onclick="window.showMovieAddOptions(' + idx + ')" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-bottom:1px solid var(--border-color); cursor:pointer;">';
            html += '<div style="width:40px; height:60px; background:var(--border-color); border-radius:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">🎬</div>';
            html += '<div style="flex:1; min-width:0;">';
            html += '<div style="font-size:0.85rem; font-weight:700; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(m.title) + '</div>';
            if (m.titleEn && m.titleEn !== m.title) {
                html += '<div style="font-size:0.7rem; color:var(--text-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(m.titleEn) + '</div>';
            }
            var info = m.year || '';
            if (m.genres) info += (info ? ' · ' : '') + escHtml(m.genres.split(',')[0]);
            if (m.directors) info += (info ? ' · ' : '') + escHtml(m.directors);
            html += '<div style="font-size:0.7rem; color:var(--text-sub);">' + info + '</div>';
            html += '</div>';
            if (exists) {
                html += '<span style="font-size:0.65rem; color:var(--neon-cyan); flex-shrink:0;">✓</span>';
            }
            html += '</div>';
        });
        if (_apiSearchHasMore) {
            html += '<div onclick="window.loadMoreMovieResults()" style="padding:12px; text-align:center; color:var(--neon-blue); cursor:pointer; font-size:0.8rem;">더 보기 ▼</div>';
        }
        container.innerHTML = html;
    }

    function hideMovieSearchResults() {
        var container = document.getElementById('movie-search-results');
        if (container) {
            container.classList.add('d-none');
            container.innerHTML = '';
        }
    }

    window.loadMoreMovieResults = async function() {
        if (!_apiSearchHasMore || !_apiSearchQuery) return;
        _apiSearchPage++;
        log('더 보기: page=' + _apiSearchPage);
        var result = await searchMoviesAPI(_apiSearchQuery, _apiSearchPage);
        _apiSearchResults = _apiSearchResults.concat(result.results);
        _apiSearchHasMore = result.hasMore;
        showMovieSearchResults();
    };

    // ── Add Movie Options ──
    window.showMovieAddOptions = async function(idx) {
        var searchItem = _apiSearchResults[idx];
        if (!searchItem) return;

        var detail = await fetchMovieDetails(searchItem.movieCd, searchItem.title, searchItem.year, searchItem.source);
        if (!detail) {
            logWarn('상세정보 로드 실패로 추가 불가: movieCd=' + searchItem.movieCd);
            alert(t('mov_search_error'));
            return;
        }

        var existingIds = ((AppState.movies && AppState.movies.items) || []).map(function(m) { return m.movieCd || m.tmdbId; });
        if (existingIds.indexOf(detail.movieCd) !== -1) {
            alert(t('mov_already_exists'));
            return;
        }

        var poster = detail.posterUrl || '';
        var year = detail.releaseDate ? detail.releaseDate.substring(0, 4) : '';

        // API 출처 라벨
        var sourceLabel = '';
        if (detail.source === 'kobis') sourceLabel = 'KOBIS';
        else if (detail.source === 'kmdb') sourceLabel = 'KMDb';

        var modalHtml = '<div class="modal-overlay" id="movie-add-modal" onclick="window.closeMovieAddModal(event)" style="display:flex; align-items:center; justify-content:center; z-index:300;">';
        modalHtml += '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:340px; width:90%; max-height:80vh; overflow-y:auto; padding:16px; position:relative;">';

        // X 닫기 버튼
        modalHtml += '<button onclick="var m=document.getElementById(\'movie-add-modal\'); if(m) m.remove(); window._pendingMovieDetail=null;" style="position:absolute; top:8px; right:10px; background:none; border:none; color:var(--text-sub); font-size:1.2rem; cursor:pointer; padding:4px 8px; z-index:1;">✕</button>';

        if (poster) {
            modalHtml += '<div style="text-align:center; margin-bottom:12px;"><img src="' + poster + '" style="max-height:200px; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.3);" onerror="this.style.display=\'none\'"></div>';
        }
        modalHtml += '<div style="font-size:1rem; font-weight:800; color:var(--text-main); margin-bottom:4px;">' + escHtml(detail.title) + '</div>';
        if (detail.titleEn && detail.titleEn !== detail.title) {
            modalHtml += '<div style="font-size:0.75rem; color:var(--text-sub); margin-bottom:8px;">' + escHtml(detail.titleEn) + '</div>';
        }

        var infoHtml = '';
        if (detail.director) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_director') + '</span> ' + escHtml(detail.director) + '</div>';
        if (detail.cast) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_cast') + '</span> ' + escHtml(detail.cast) + '</div>';
        if (year) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_release') + '</span> ' + year + '</div>';
        if (detail.watchGrade) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_watch_grade') + '</span> ' + escHtml(detail.watchGrade) + '</div>';
        if (detail.genres) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_genre') + '</span> ' + escHtml(detail.genres) + '</div>';
        if (infoHtml) {
            modalHtml += '<div style="font-size:0.75rem; color:var(--text-sub); line-height:1.6; margin-bottom:10px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px;">' + infoHtml + '</div>';
        }
        if (detail.overview) {
            modalHtml += '<div style="font-size:0.72rem; color:var(--text-sub); line-height:1.5; margin-bottom:12px; max-height:80px; overflow-y:auto;">' + escHtml(detail.overview) + '</div>';
        }

        // API 출처 뱃지
        if (sourceLabel) {
            modalHtml += '<div style="margin-bottom:10px; text-align:right;"><span style="font-size:0.6rem; padding:2px 8px; border-radius:3px; background:rgba(0,217,255,0.1); color:var(--neon-cyan); border:1px solid rgba(0,217,255,0.2);">' + sourceLabel + '</span></div>';
        }

        modalHtml += '<div style="display:flex; flex-direction:column; gap:8px;">';
        modalHtml += '<button class="btn-primary" style="padding:10px; font-size:0.85rem;" onclick="window.addMovieFromPending(\'watched\')">' + t('mov_add_watched') + '</button>';
        modalHtml += '<button class="btn-primary" style="padding:10px; font-size:0.85rem; background:var(--neon-cyan);" onclick="window.addMovieFromPending(\'watching\')">' + t('mov_add_watching') + '</button>';
        modalHtml += '<button class="btn-primary" style="padding:10px; font-size:0.85rem; background:var(--border-color);" onclick="window.addMovieFromPending(\'wantToWatch\')">' + t('mov_add_want') + '</button>';
        modalHtml += '</div>';

        modalHtml += '</div></div>';

        window._pendingMovieDetail = detail;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    window.closeMovieAddModal = function(e) {
        if (e && e.target && e.target.id !== 'movie-add-modal') return;
        var modal = document.getElementById('movie-add-modal');
        if (modal) modal.remove();
        window._pendingMovieDetail = null;
    };

    // ── Add Movie to List ──
    window.addMovieFromPending = function(category) {
        var detail = window._pendingMovieDetail;
        if (!detail) return;

        if (!AppState.movies) AppState.movies = { items: [], rewardedIds: [] };
        if (!Array.isArray(AppState.movies.items)) AppState.movies.items = [];
        if (!Array.isArray(AppState.movies.rewardedIds)) AppState.movies.rewardedIds = [];

        var movieId = detail.movieCd;
        var existing = AppState.movies.items.find(function(m) { return (m.movieCd || m.tmdbId) === movieId; });
        if (existing) {
            alert(t('mov_already_exists'));
            return;
        }

        var movie = {
            movieCd: detail.movieCd,
            title: detail.title,
            titleEn: detail.titleEn || '',
            director: detail.director || '',
            cast: detail.cast || '',
            posterUrl: detail.posterUrl || '',
            releaseDate: detail.releaseDate || '',
            watchGrade: detail.watchGrade || '',
            overview: detail.overview || '',
            genres: detail.genres || '',
            source: detail.source || null,
            category: category,
            addedDate: todayStr(),
            finishedDate: category === 'watched' ? todayStr() : null,
            rewardGranted: false
        };

        AppState.movies.items.push(movie);
        log('영화 추가: ' + movie.title + ' → ' + category);

        if (category === 'watched') {
            grantWatchReward(movie);
        }

        var modal = document.getElementById('movie-add-modal');
        if (modal) modal.remove();
        window._pendingMovieDetail = null;

        hideMovieSearchResults();
        var input = document.getElementById('movie-search-input');
        if (input) input.value = '';
        _movSearchQuery = '';
        _apiSearchResults = [];

        _movCurrentTab = category;
        updateMovieTabUI();
        updateMoviePeriodCounts();
        renderMovieList();
        window.updateMovieCardCount();
        if (window.saveUserData) window.saveUserData();

        alert(t('mov_added'));
    };

    // ── Watch Reward (INT) ──
    function grantWatchReward(movie) {
        if (movie.rewardGranted) return;
        if (!AppState.movies.rewardedIds) AppState.movies.rewardedIds = [];
        var mid = movie.movieCd || movie.tmdbId;
        if (mid && AppState.movies.rewardedIds.indexOf(mid) !== -1) {
            movie.rewardGranted = true;
            return;
        }
        movie.rewardGranted = true;
        if (mid) AppState.movies.rewardedIds.push(mid);
        AppState.user.points += 10;
        AppState.user.pendingStats.int += 0.5;
        log('영화 감상 보상 지급: +10P, INT +0.5');
        window.updatePointUI();
        window.drawRadarChart();
        var lang = AppState.currentLang;
        alert(i18n[lang].mov_watch_reward || '🎬 영화 감상 완료! +10P & INT +0.5');
    }

    // ── 필터링된 영화 목록 반환 ──
    function getFilteredMovies() {
        var items = (AppState.movies && AppState.movies.items) || [];
        var filtered = items.filter(function(m) { return m.category === _movCurrentTab; });

        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth();
        if (_movCurrentPeriod === 'yearly') {
            filtered = filtered.filter(function(m) { return new Date(m.addedDate).getFullYear() === year; });
        } else if (_movCurrentPeriod === 'monthly') {
            filtered = filtered.filter(function(m) {
                var d = new Date(m.addedDate);
                return d.getFullYear() === year && d.getMonth() === month;
            });
        }

        if (_movLocalSearch && _movSearchQuery) {
            var q = _movSearchQuery.toLowerCase();
            filtered = filtered.filter(function(m) {
                return (m.title && m.title.toLowerCase().indexOf(q) !== -1) ||
                    (m.titleEn && m.titleEn.toLowerCase().indexOf(q) !== -1) ||
                    (m.originalTitle && m.originalTitle.toLowerCase().indexOf(q) !== -1) ||
                    (m.director && m.director.toLowerCase().indexOf(q) !== -1);
            });
        }

        filtered.sort(function(a, b) {
            var cmp = (b.addedDate || '').localeCompare(a.addedDate || '');
            if (cmp !== 0) return cmp;
            // 같은 날짜면 나중에 추가된 항목이 위로 (배열 인덱스 역순)
            var items = (AppState.movies && AppState.movies.items) || [];
            return items.indexOf(b) - items.indexOf(a);
        });
        return filtered;
    }

    // ── Render Movie List (뷰모드 분기) ──
    function renderMovieList() {
        var towerContainer = document.getElementById('movie-tower');
        var listContainer = document.getElementById('movie-list');
        var filtered = getFilteredMovies();

        // 이미지 저장 버튼 표시/숨김
        var shareBtn = document.getElementById('movie-share-btn');
        if (shareBtn) {
            shareBtn.classList.toggle('d-none', filtered.length === 0);
        }

        if (_movViewMode === 'tower') {
            if (listContainer) listContainer.style.display = 'none';
            // 타워: 1층=가장 오래된 항목(바닥), 최신=맨 위
            var towerOrder = filtered.slice().reverse();
            if (towerContainer) { towerContainer.style.display = ''; renderMovieTowerView(towerContainer, towerOrder); }
        } else {
            if (towerContainer) towerContainer.style.display = 'none';
            if (listContainer) { listContainer.style.display = ''; renderMovieListView(listContainer, filtered); }
        }
    }

    // ── 뷰 모드 전환 ──
    window.switchMovieViewMode = function(mode) {
        _movViewMode = mode;
        var movOverlay = document.getElementById('movie-overlay');
        if (movOverlay) {
            movOverlay.querySelectorAll('.lib-view-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.view === mode);
            });
        }
        renderMovieList();
    };

    // ── 타워 테마 전환 ──
    window.switchMovieTowerTheme = function(theme) {
        _movTowerTheme = theme;
        var picker = document.getElementById('movie-theme-picker');
        if (picker) {
            picker.querySelectorAll('.tower-theme-dot').forEach(function(dot) {
                dot.classList.toggle('active', dot.dataset.theme === theme);
            });
        }
        renderMovieList();
    };

    // ── 타워 뷰 렌더링 (바벨의 영화관) ──
    function renderMovieTowerView(container, movies) {
        container.className = 'library-tower tower-theme-' + _movTowerTheme;

        if (movies.length === 0) {
            container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--text-sub); font-size:0.85rem;">' + t('mov_empty') + '</div>';
            return;
        }

        // 바벨의 영화관 라벨 (column-reverse이므로 HTML 첫 번째 = 화면 최하단)
        var html = '<div class="book-tower-top">'
            + '<div class="book-tower-top-label">' + t('mov_babel_cinema') + '<br>' + movies.length + '층</div>'
            + '</div>';
        html += '<div class="book-tower-base"></div>';

        movies.forEach(function(m, i) {
            var floor = i + 1;
            var title = m.title.length > 20 ? m.title.substring(0, 18) + '…' : m.title;
            var thickness = getMovieThickness(m);
            var widthPct = getMovieWidth(m, i);
            var yearLabel = m.releaseDate ? m.releaseDate.substring(0, 4) : '';
            var realIdx = (AppState.movies.items || []).indexOf(m);

            html += '<div class="book-tower-item" style="width:' + widthPct + '%; max-width:360px; padding-top:' + thickness + 'px; padding-bottom:' + thickness + 'px; cursor:pointer;" onclick="window.openMovieDetail(' + realIdx + ')">'
                + '<span class="book-tower-floor">' + floor + '층</span>'
                + '<span class="book-tower-title">' + escHtml(title) + '</span>'
                + (yearLabel ? '<span class="book-tower-pages">' + yearLabel + '</span>' : '')
                + '</div>';
        });
        container.innerHTML = html;
    }

    function getMovieThickness(movie) {
        // 기본 8px, 장르·감독 유무에 따라 변화
        var base = 7;
        if (movie.genres) base += 1;
        if (movie.director) base += 1;
        if (movie.cast) base += 1;
        if (movie.overview) base += 2;
        return Math.min(14, Math.max(5, base));
    }

    function getMovieWidth(movie, index) {
        var base = 72;
        if (movie.genres && movie.genres.length > 10) base += 5;
        if (movie.director) base += 3;
        if (movie.cast) base += 3;
        var offset = ((index * 7 + 3) % 11) - 5;
        return Math.min(92, Math.max(55, base + offset));
    }

    // ── 리스트 뷰 렌더링 ──
    function renderMovieListView(container, filtered) {
        var items = (AppState.movies && AppState.movies.items) || [];

        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--text-sub); font-size:0.85rem;">' + t('mov_empty') + '</div>';
            return;
        }

        var html = '';
        filtered.forEach(function(m) {
            var poster = m.posterUrl || (m.posterPath ? (TMDB_IMG_COMPAT + m.posterPath) : '');
            var yr = m.releaseDate ? m.releaseDate.substring(0, 4) : '';
            var realIdx = items.indexOf(m);

            html += '<div class="movie-item" onclick="window.openMovieDetail(' + realIdx + ')" style="display:flex; align-items:flex-start; gap:12px; padding:12px; border-bottom:1px solid var(--border-color); cursor:pointer;">';

            if (poster) {
                html += '<img src="' + poster + '" style="width:55px; height:82px; object-fit:cover; border-radius:6px; flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.2);" onerror="this.style.display=\'none\'">';
            } else {
                html += '<div style="width:55px; height:82px; background:var(--border-color); border-radius:6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">🎬</div>';
            }

            html += '<div style="flex:1; min-width:0;">';
            html += '<div style="font-size:0.88rem; font-weight:700; color:var(--text-main); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(m.title) + '</div>';
            var subTitle = m.titleEn || m.originalTitle || '';
            if (subTitle && subTitle !== m.title) {
                html += '<div style="font-size:0.68rem; color:var(--text-sub); margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(subTitle) + '</div>';
            }
            if (m.director) {
                var srcBadge = '';
                if (m.source) {
                    var sl = m.source === 'kobis' ? 'KOBIS' : m.source === 'kmdb' ? 'KMDb' : m.source;
                    srcBadge = ' <span class="source-badge source-' + escHtml(m.source) + '">' + escHtml(sl) + '</span>';
                }
                html += '<div style="font-size:0.7rem; color:var(--text-sub);">' + escHtml(m.director) + srcBadge + '</div>';
            }
            html += '<div style="font-size:0.7rem; color:var(--text-sub); margin-top:2px;">';
            if (yr) html += yr;
            if (m.watchGrade) html += (yr ? ' · ' : '') + escHtml(m.watchGrade);
            else if (m.voteAverage) html += (yr ? ' · ' : '') + '★ ' + m.voteAverage.toFixed(1);
            if (m.genres) html += ' · ' + escHtml(m.genres.split(',')[0]);
            html += '</div>';

            html += '<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;" onclick="event.stopPropagation()">';
            if (_movCurrentTab !== 'watched') {
                html += '<button class="movie-action-btn" onclick="window.moveMovie(' + realIdx + ', \'watched\')" style="font-size:0.65rem; padding:3px 8px; border:1px solid var(--neon-blue); border-radius:4px; background:transparent; color:var(--neon-blue); cursor:pointer;">' + t('mov_move_watched') + '</button>';
            }
            if (_movCurrentTab !== 'watching') {
                html += '<button class="movie-action-btn" onclick="window.moveMovie(' + realIdx + ', \'watching\')" style="font-size:0.65rem; padding:3px 8px; border:1px solid var(--neon-cyan); border-radius:4px; background:transparent; color:var(--neon-cyan); cursor:pointer;">' + t('mov_move_watching') + '</button>';
            }
            if (_movCurrentTab !== 'wantToWatch') {
                html += '<button class="movie-action-btn" onclick="window.moveMovie(' + realIdx + ', \'wantToWatch\')" style="font-size:0.65rem; padding:3px 8px; border:1px solid var(--text-sub); border-radius:4px; background:transparent; color:var(--text-sub); cursor:pointer;">' + t('mov_move_want') + '</button>';
            }
            html += '<button class="movie-action-btn" onclick="window.deleteMovie(' + realIdx + ')" style="font-size:0.65rem; padding:3px 8px; border:1px solid #ff4757; border-radius:4px; background:transparent; color:#ff4757; cursor:pointer;">' + t('mov_delete') + '</button>';
            html += '</div>';

            html += '</div></div>';
        });

        container.innerHTML = html;
    }

    // ── 영화 상세 보기 (타워 클릭 시) ──
    window.openMovieDetail = function(realIdx) {
        var items = (AppState.movies && AppState.movies.items) || [];
        var m = items[realIdx];
        if (!m) return;

        var poster = m.posterUrl || (m.posterPath ? (TMDB_IMG_COMPAT + m.posterPath) : '');
        var yr = m.releaseDate ? m.releaseDate.substring(0, 4) : '';
        var catLabels = { watching: '보는 중', watched: '본 영화', wantToWatch: '보고 싶은 영화' };
        var cats = ['watching', 'watched', 'wantToWatch'].filter(function(c) { return c !== m.category; });
        var moveLabels = { watching: t('mov_move_watching'), watched: t('mov_move_watched'), wantToWatch: t('mov_move_want') };

        var html = '<div class="book-detail-overlay" onclick="this.remove()">'
            + '<div class="book-detail-sheet" onclick="event.stopPropagation()">'
            + '<button class="book-detail-close" onclick="this.closest(\'.book-detail-overlay\').remove()">✕</button>'
            + '<div class="book-detail-header">';
        if (poster) {
            html += '<img class="book-detail-thumb" src="' + escHtml(poster) + '" alt="" onerror="this.style.visibility=\'hidden\'">';
        }
        html += '<div class="book-detail-meta">'
            + '<div class="book-detail-title">' + escHtml(m.title) + '</div>';
        if (m.titleEn && m.titleEn !== m.title) {
            html += '<div class="book-detail-author">' + escHtml(m.titleEn) + '</div>';
        }
        if (m.director) html += '<div class="book-detail-publisher">' + escHtml(m.director) + '</div>';
        html += '<div class="book-detail-date">' + escHtml(m.addedDate || '') + ' 등록</div>';
        // API 출처
        if (m.source) {
            var srcLabel = m.source === 'kobis' ? 'KOBIS' : m.source === 'kmdb' ? 'KMDb' : m.source;
            html += '<div class="book-detail-source"><span class="source-badge source-' + escHtml(m.source) + '">' + escHtml(srcLabel) + '</span></div>';
        }
        html += '</div></div>';

        // 상세 정보 그리드
        html += '<div class="book-detail-info-grid">';
        html += '<div class="book-detail-info-item"><div class="book-detail-info-label">분류</div><div class="book-detail-info-value">' + (catLabels[m.category] || m.category) + '</div></div>';
        if (yr) html += '<div class="book-detail-info-item"><div class="book-detail-info-label">개봉</div><div class="book-detail-info-value">' + yr + '</div></div>';
        if (m.genres) html += '<div class="book-detail-info-item"><div class="book-detail-info-label">장르</div><div class="book-detail-info-value">' + escHtml(m.genres) + '</div></div>';
        if (m.watchGrade) html += '<div class="book-detail-info-item"><div class="book-detail-info-label">등급</div><div class="book-detail-info-value">' + escHtml(m.watchGrade) + '</div></div>';
        if (m.cast) html += '<div class="book-detail-info-item"><div class="book-detail-info-label">출연</div><div class="book-detail-info-value">' + escHtml(m.cast) + '</div></div>';
        if (m.finishedDate) html += '<div class="book-detail-info-item"><div class="book-detail-info-label">감상일</div><div class="book-detail-info-value">' + escHtml(m.finishedDate) + '</div></div>';
        html += '</div>';

        if (m.overview) {
            html += '<div class="book-detail-description">' + escHtml(m.overview) + '</div>';
        }

        // 액션 버튼
        html += '<div class="book-detail-actions">';
        cats.forEach(function(cat) {
            html += '<button class="book-action-btn" onclick="window.moveMovie(' + realIdx + ',\'' + cat + '\'); this.closest(\'.book-detail-overlay\').remove(); renderMovieList();">' + moveLabels[cat] + '</button>';
        });
        html += '<button class="book-action-btn danger" onclick="window.deleteMovie(' + realIdx + '); this.closest(\'.book-detail-overlay\').remove();">' + t('mov_delete') + '</button>';
        html += '</div></div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
    };

    // ── Move Movie Category ──
    window.moveMovie = function(idx) {
        var items = (AppState.movies && AppState.movies.items) || [];
        var movie = items[idx];
        if (!movie) return;
        var newCat = arguments[1];
        if (!newCat) return;

        var oldCat = movie.category;
        movie.category = newCat;
        log('카테고리 변경: ' + movie.title + ' (' + oldCat + ' → ' + newCat + ')');

        if (newCat === 'watched' && oldCat !== 'watched') {
            movie.finishedDate = todayStr();
            grantWatchReward(movie);
        }

        updateMoviePeriodCounts();
        renderMovieList();
        window.updateMovieCardCount();
        if (window.saveUserData) window.saveUserData();
    };

    // ── Delete Movie ──
    window.deleteMovie = function(idx) {
        var items = (AppState.movies && AppState.movies.items) || [];
        if (!items[idx]) return;
        if (!confirm(t('mov_confirm_delete'))) return;
        var title = items[idx].title;
        items.splice(idx, 1);
        log('영화 삭제: ' + title);
        updateMoviePeriodCounts();
        renderMovieList();
        window.updateMovieCardCount();
        if (window.saveUserData) window.saveUserData();
    };

    // ── 이미지 저장 (바벨의 영화관 Canvas) ──
    window.shareMovieAsImage = async function() {
        var lang = AppState.currentLang;
        var movies = getFilteredMovies();
        if (movies.length === 0) return;

        var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

        if (isNative && window.AdManager) {
            if (!confirm(i18n[lang].mov_ad_prompt || i18n[lang].lib_ad_prompt || '광고 시청 후 이미지를 저장할 수 있습니다. 진행하시겠습니까?')) return;
            var adShown = await window.AdManager.showRewarded({
                context: 'movieImage',
                onSuccess: function() { _doMovieImageSave(lang, movies); },
                onFail: function() { alert(i18n[AppState.currentLang].lib_ad_fail || '광고 시청에 실패했습니다.'); }
            });
            if (!adShown) alert(i18n[lang].lib_ad_not_ready || '광고가 준비되지 않았습니다.');
            return;
        }

        _doMovieImageSave(lang, movies);
    };

    async function _doMovieImageSave(lang, movies) {
        if (!movies || movies.length === 0) return;

        // 이미지도 타워와 동일: 1층=오래된 항목(바닥), 최신=맨 위
        movies = movies.slice().reverse();

        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var W = 540;
        var pad = 20;
        var innerW = W - pad * 2;
        var centerX = W / 2;

        // 스파인 색상 팔레트 (테마별)
        var themeColors = {
            dark:  { colors: [['#3a3a4a','#2e2e3e'],['#404052','#343446'],['#464658','#3a3a4c'],['#383848','#2c2c3c'],['#3e3e50','#32324a'],['#424254','#363648'],['#484860','#3c3c50'],['#363646','#2a2a3a']], text: '#c0c0d0' },
            warm:  { colors: [['#f2b4a8','#eea090'],['#f5c4b8','#f0b0a0'],['#f8d0c4','#f4bcae'],['#eea898','#e89888'],['#f5bcae','#f0a898'],['#f0c0b4','#ecaca0'],['#f8d4c8','#f4c0b4'],['#ecb0a0','#e8a090']], text: '#3a2a2a', darkText: '#5a3a3a', darkTextIndices: [2,6] },
            ocean: { colors: [['#1e3a5f','#162e4f'],['#234068','#1b3458'],['#284870','#203c60'],['#1c3555','#142a45'],['#203d62','#183252'],['#254468','#1d3858'],['#2a4c72','#224062'],['#1a3250','#122640']], text: '#a8c8e0' }
        };
        var activeTheme = themeColors[_movTowerTheme] || themeColors.dark;
        var spineColors = activeTheme.colors;
        var defaultTextColor = activeTheme.text;
        var darkTextIndices = activeTheme.darkTextIndices || [];

        // 메트릭 계산
        var totalBooksH = 0;
        var movieMetrics = movies.map(function(m, i) {
            var thickness = getMovieThickness(m);
            var paddingV = thickness * 2;
            var textH = 14;
            var itemH = paddingV + textH;
            var widthPct = getMovieWidth(m, i);
            var itemW = Math.min(360, (innerW * widthPct / 100));
            totalBooksH += itemH;
            return { movie: m, itemH: itemH, itemW: itemW, floor: i + 1 };
        });

        var hexH = 48;
        var baseH = 14;
        var baseGap = 4;
        var footerH = 36;
        var totalH = pad + totalBooksH + baseGap + baseH + hexH + footerH + pad;

        canvas.width = W;
        canvas.height = totalH;

        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, totalH);

        var y = pad;

        // 영화 스파인 (맨 위층부터 아래로)
        for (var i = movieMetrics.length - 1; i >= 0; i--) {
            var mm = movieMetrics[i];
            var colorIdx = i % 8;
            var c = spineColors[colorIdx];
            var itemX = centerX - mm.itemW / 2;
            var iw = mm.itemW, ih = mm.itemH;
            var inset = iw * 0.04;

            ctx.beginPath();
            ctx.moveTo(itemX + inset, y);
            ctx.lineTo(itemX + iw - inset, y);
            ctx.lineTo(itemX + iw, y + ih / 2);
            ctx.lineTo(itemX + iw - inset, y + ih);
            ctx.lineTo(itemX + inset, y + ih);
            ctx.lineTo(itemX, y + ih / 2);
            ctx.closePath();

            var spineGrad = ctx.createLinearGradient(0, y, 0, y + ih);
            spineGrad.addColorStop(0, c[0]);
            spineGrad.addColorStop(1, c[1]);
            ctx.fillStyle = spineGrad;
            ctx.fill();

            var textColor = (activeTheme.darkText && darkTextIndices.indexOf(colorIdx) >= 0) ? activeTheme.darkText : defaultTextColor;
            ctx.fillStyle = textColor;
            ctx.font = 'bold 10px Pretendard, sans-serif';
            var title = mm.movie.title.length > 20 ? mm.movie.title.substring(0, 18) + '…' : mm.movie.title;
            var titleW = ctx.measureText(title).width;
            ctx.fillText(title, centerX - titleW / 2, y + ih / 2 + 3);

            ctx.fillStyle = '#888';
            ctx.font = 'bold 8px Pretendard, sans-serif';
            ctx.fillText(mm.floor + '층', itemX - 32, y + ih / 2 + 3);

            var yearLabel = mm.movie.releaseDate ? mm.movie.releaseDate.substring(0, 4) : '';
            if (yearLabel) {
                ctx.fillStyle = textColor;
                ctx.globalAlpha = 0.6;
                ctx.font = '8px Pretendard, sans-serif';
                ctx.fillText(yearLabel, centerX + titleW / 2 + 6, y + ih / 2 + 3);
                ctx.globalAlpha = 1.0;
            }

            y += ih;
        }

        // 받침대
        y += baseGap;
        var baseW = Math.min(390, innerW * 0.92);
        var baseX = centerX - baseW / 2;
        var baseGrad = ctx.createLinearGradient(0, y, 0, y + baseH);
        baseGrad.addColorStop(0, '#4a4a5a');
        baseGrad.addColorStop(1, '#2a2a3a');
        ctx.fillStyle = baseGrad;
        ctx.beginPath();
        ctx.roundRect(baseX, y, baseW, baseH, [0, 0, 6, 6]);
        ctx.fill();
        y += baseH;

        // 바벨의 영화관 육각형
        var hexW = innerW * 0.6;
        var hexX = centerX - hexW / 2;
        ctx.beginPath();
        ctx.moveTo(hexX + hexW * 0.1, y);
        ctx.lineTo(hexX + hexW * 0.9, y);
        ctx.lineTo(hexX + hexW, y + hexH / 2);
        ctx.lineTo(hexX + hexW * 0.9, y + hexH);
        ctx.lineTo(hexX + hexW * 0.1, y + hexH);
        ctx.lineTo(hexX, y + hexH / 2);
        ctx.closePath();
        var hexGrad = ctx.createLinearGradient(0, y, 0, y + hexH);
        hexGrad.addColorStop(0, '#4a4a5a');
        hexGrad.addColorStop(1, '#3a3a4a');
        ctx.fillStyle = hexGrad;
        ctx.fill();

        ctx.fillStyle = '#00d9ff';
        ctx.font = 'bold 11px Pretendard, sans-serif';
        var hexLine1 = t('mov_babel_cinema') || '바벨의 영화관';
        var hexLine2 = movies.length + '층';
        ctx.fillText(hexLine1, centerX - ctx.measureText(hexLine1).width / 2, y + hexH / 2 - 2);
        ctx.fillText(hexLine2, centerX - ctx.measureText(hexLine2).width / 2, y + hexH / 2 + 12);
        y += hexH;

        // 푸터
        ctx.fillStyle = '#444';
        ctx.font = '10px Pretendard, sans-serif';
        var today = new Date().toISOString().slice(0, 10);
        ctx.fillText('LEVEL UP: REBOOT | ' + today, pad + 6, y + 12);

        // 저장 파이프라인
        var userName = (AppState.user && AppState.user.name) ? AppState.user.name.replace(/[^a-zA-Z0-9가-힣]/g, '') : '';
        var saveCountKey = 'movie_save_count_' + userName;
        var saveCount = parseInt(localStorage.getItem(saveCountKey) || '0', 10) + 1;
        localStorage.setItem(saveCountKey, String(saveCount));
        var countSuffix = saveCount > 1 ? String(saveCount) : '';
        var fileName = 'movie_tower_' + userName + countSuffix + '.png';
        var msgs = { ko: '이미지가 저장되었습니다.', en: 'Image saved.', ja: '画像を保存しました。' };
        var failMsgs = { ko: '이미지 저장에 실패했습니다.', en: 'Failed to save image.', ja: '画像の保存に失敗しました。' };

        try {
            var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
            var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
            if (!blob) throw new Error('toBlob failed');

            var saved = false;

            if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                var Filesystem = window.Capacitor.Plugins.Filesystem;
                var dataUrl = canvas.toDataURL('image/png');
                var base64Data = dataUrl.split(',')[1];
                var dirs = ['DOCUMENTS', 'EXTERNAL', 'CACHE'];
                for (var d = 0; d < dirs.length; d++) {
                    try {
                        await Filesystem.writeFile({ path: fileName, data: base64Data, directory: dirs[d], recursive: true });
                        saved = true;
                        break;
                    } catch(dirErr) {
                        if (window.AppLogger) AppLogger.warn('[Movie] Filesystem write failed for dir ' + dirs[d] + ': ' + dirErr.message);
                    }
                }
            }

            if (!saved && navigator.share && navigator.canShare) {
                try {
                    var file = new File([blob], fileName, { type: 'image/png' });
                    if (navigator.canShare({ files: [file] })) {
                        await navigator.share({ files: [file] });
                        saved = true;
                    }
                } catch(shareErr) {
                    if (shareErr.name === 'AbortError') saved = true;
                    else if (window.AppLogger) AppLogger.warn('[Movie] Share API failed: ' + shareErr.message);
                }
            }

            if (!saved && isNative) {
                showImageOverlay(canvas.toDataURL('image/png'), lang);
                saved = true;
            }

            if (!saved && !isNative) {
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                setTimeout(function() { document.body.removeChild(link); URL.revokeObjectURL(url); }, 1000);
                saved = true;
            }

            if (saved) alert(msgs[lang] || msgs.ko);
            else throw new Error('All save methods failed');
        } catch(e) {
            if (window.AppLogger) AppLogger.error('[Movie] Image save error: ' + e.message);
            try { showImageOverlay(canvas.toDataURL('image/png'), lang); } catch(e2) { alert(failMsgs[lang] || failMsgs.ko); }
        }
    }

    // ── i18n 기본값 보완 ──
    (function() {
        var defaults = {
            mov_babel_cinema: '바벨의 영화관',
            mov_stack_view: '쌓아보기',
            mov_list_view: '리스트형 보기',
            mov_save_image: '이미지 저장'
        };
        ['ko','en','ja'].forEach(function(lang) {
            if (!i18n[lang]) return;
            for (var k in defaults) {
                if (!i18n[lang][k]) i18n[lang][k] = defaults[k];
            }
        });
        if (i18n.en) {
            if (!i18n.en.mov_babel_cinema) i18n.en.mov_babel_cinema = 'Tower of Cinema';
            if (!i18n.en.mov_stack_view) i18n.en.mov_stack_view = 'Stack View';
            if (!i18n.en.mov_list_view) i18n.en.mov_list_view = 'List View';
            if (!i18n.en.mov_save_image) i18n.en.mov_save_image = 'Save Image';
        }
        if (i18n.ja) {
            if (!i18n.ja.mov_babel_cinema) i18n.ja.mov_babel_cinema = 'バベルの映画館';
        }
    })();

    // ── Util ──
    function escHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Init ──
    log('모듈 로드 완료');
    if (window.updateMovieCardCount) window.updateMovieCardCount();

})();
