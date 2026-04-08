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
        var input = document.getElementById('movie-search-input');
        if (input) input.value = '';
        var cb = document.getElementById('movie-local-filter');
        if (cb) cb.checked = false;
        updateMoviePeriodLabels();
        updateMoviePeriodCounts();
        updateMovieTabUI();
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
            renderMovieList();
            return;
        }

        // 검색 중 표시
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
            renderMovieList();
        } else {
            if (_movSearchQuery.length >= 2) {
                window.filterMovieList(_movSearchQuery);
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

        var modalHtml = '<div class="modal-overlay" id="movie-add-modal" onclick="window.closeMovieAddModal(event)" style="display:flex; align-items:center; justify-content:center; z-index:300;">';
        modalHtml += '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:340px; width:90%; max-height:80vh; overflow-y:auto; padding:16px;">';

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
        if (e && e.target && !e.target.id) return;
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
        if (window.saveState) window.saveState();

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

    // ── Render Movie List ──
    function renderMovieList() {
        var container = document.getElementById('movie-list');
        if (!container) return;

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

        filtered.sort(function(a, b) { return (b.addedDate || '').localeCompare(a.addedDate || ''); });

        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--text-sub); font-size:0.85rem;">' + t('mov_empty') + '</div>';
            return;
        }

        var html = '';
        filtered.forEach(function(m) {
            var poster = m.posterUrl || (m.posterPath ? (TMDB_IMG_COMPAT + m.posterPath) : '');
            var yr = m.releaseDate ? m.releaseDate.substring(0, 4) : '';
            var realIdx = items.indexOf(m);

            html += '<div class="movie-item" style="display:flex; align-items:flex-start; gap:12px; padding:12px; border-bottom:1px solid var(--border-color);">';

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
                html += '<div style="font-size:0.7rem; color:var(--text-sub);">' + escHtml(m.director) + '</div>';
            }
            html += '<div style="font-size:0.7rem; color:var(--text-sub); margin-top:2px;">';
            if (yr) html += yr;
            if (m.watchGrade) html += (yr ? ' · ' : '') + escHtml(m.watchGrade);
            else if (m.voteAverage) html += (yr ? ' · ' : '') + '★ ' + m.voteAverage.toFixed(1);
            if (m.genres) html += ' · ' + escHtml(m.genres.split(',')[0]);
            html += '</div>';

            html += '<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">';
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
        if (window.saveState) window.saveState();
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
        if (window.saveState) window.saveState();
    };

    // ── Util ──
    function escHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Init ──
    log('모듈 로드 완료');
    if (window.updateMovieCardCount) window.updateMovieCardCount();

})();
