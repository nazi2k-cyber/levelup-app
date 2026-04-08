// ===== 내 영화 (My Movies) 모듈 =====
(function() {
    'use strict';

    const AppState = window.AppState;
    const i18n = window.i18n;

    // TMDB API (무료, 한국영화 지원)
    const TMDB_API_KEY = '0be08905dbc2b220e3c8d4e88b0e977d';
    const TMDB_BASE = 'https://api.themoviedb.org/3';
    const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';
    const TMDB_IMG_LG = 'https://image.tmdb.org/t/p/w342';

    let _movCurrentTab = 'watched';
    let _movCurrentPeriod = 'total';
    let _movSearchQuery = '';
    let _movLocalSearch = false;
    let _apiSearchResults = [];
    let _apiSearchPage = 1;
    let _apiSearchHasMore = false;
    let _apiSearchQuery = '';
    let _searchDebounce = null;

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

    function getTmdbLang() {
        var lang = getLang();
        if (lang === 'ko') return 'ko-KR';
        if (lang === 'ja') return 'ja-JP';
        return 'en-US';
    }

    // ── TMDB API ──
    async function searchTMDB(query, page) {
        page = page || 1;
        var lang = getTmdbLang();
        var url = TMDB_BASE + '/search/movie?api_key=' + TMDB_API_KEY +
            '&language=' + lang + '&query=' + encodeURIComponent(query) +
            '&page=' + page + '&include_adult=false';
        try {
            var res = await fetch(url);
            var data = await res.json();
            return {
                results: (data.results || []).map(function(m) {
                    return {
                        tmdbId: m.id,
                        title: m.title || m.original_title || '',
                        originalTitle: m.original_title || '',
                        posterPath: m.poster_path || '',
                        releaseDate: m.release_date || '',
                        voteAverage: m.vote_average || 0,
                        overview: m.overview || '',
                        genreIds: m.genre_ids || []
                    };
                }),
                totalPages: data.total_pages || 1,
                page: data.page || 1
            };
        } catch(e) {
            console.error('[Movie] TMDB search error:', e);
            return { results: [], totalPages: 1, page: 1 };
        }
    }

    async function fetchMovieDetails(tmdbId) {
        var lang = getTmdbLang();
        var url = TMDB_BASE + '/movie/' + tmdbId + '?api_key=' + TMDB_API_KEY +
            '&language=' + lang + '&append_to_response=credits';
        try {
            var res = await fetch(url);
            var d = await res.json();
            var director = '';
            var castArr = [];
            if (d.credits) {
                var dirs = (d.credits.crew || []).filter(function(c) { return c.job === 'Director'; });
                if (dirs.length > 0) director = dirs.map(function(c) { return c.name; }).join(', ');
                castArr = (d.credits.cast || []).slice(0, 5).map(function(c) { return c.name; });
            }
            var genres = (d.genres || []).map(function(g) { return g.name; }).join(', ');
            return {
                tmdbId: d.id,
                title: d.title || d.original_title || '',
                originalTitle: d.original_title || '',
                director: director,
                cast: castArr.join(', '),
                posterPath: d.poster_path || '',
                releaseDate: d.release_date || '',
                voteAverage: d.vote_average || 0,
                overview: d.overview || '',
                genres: genres,
                runtime: d.runtime || 0
            };
        } catch(e) {
            console.error('[Movie] TMDB detail error:', e);
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
        overlay.classList.remove('d-none');
        _movCurrentTab = 'watched';
        _movCurrentPeriod = 'total';
        _movSearchQuery = '';
        _movLocalSearch = false;
        _apiSearchResults = [];
        _apiSearchQuery = '';
        _apiSearchPage = 1;
        _apiSearchHasMore = false;
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

        _searchDebounce = setTimeout(async function() {
            _apiSearchQuery = _movSearchQuery;
            _apiSearchPage = 1;
            var result = await searchTMDB(_apiSearchQuery, 1);
            _apiSearchResults = result.results;
            _apiSearchHasMore = result.page < result.totalPages;
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
        if (_apiSearchResults.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-sub);">' + t('mov_no_results') + '</div>';
            return;
        }
        var existingIds = ((AppState.movies && AppState.movies.items) || []).map(function(m) { return m.tmdbId; });
        var html = '';
        _apiSearchResults.forEach(function(m) {
            var exists = existingIds.indexOf(m.tmdbId) !== -1;
            var poster = m.posterPath ? (TMDB_IMG + m.posterPath) : '';
            var year = m.releaseDate ? m.releaseDate.substring(0, 4) : '';
            var rating = m.voteAverage ? m.voteAverage.toFixed(1) : '-';
            html += '<div class="movie-search-item" onclick="window.showMovieAddOptions(' + m.tmdbId + ')" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-bottom:1px solid var(--border-color); cursor:pointer;">';
            if (poster) {
                html += '<img src="' + poster + '" style="width:40px; height:60px; object-fit:cover; border-radius:4px; flex-shrink:0;" onerror="this.style.display=\'none\'">';
            } else {
                html += '<div style="width:40px; height:60px; background:var(--border-color); border-radius:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">🎬</div>';
            }
            html += '<div style="flex:1; min-width:0;">';
            html += '<div style="font-size:0.85rem; font-weight:700; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(m.title) + '</div>';
            if (m.originalTitle && m.originalTitle !== m.title) {
                html += '<div style="font-size:0.7rem; color:var(--text-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(m.originalTitle) + '</div>';
            }
            html += '<div style="font-size:0.7rem; color:var(--text-sub);">' + year + (year && rating !== '-' ? ' · ' : '') + (rating !== '-' ? '★ ' + rating : '') + '</div>';
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
        var result = await searchTMDB(_apiSearchQuery, _apiSearchPage);
        _apiSearchResults = _apiSearchResults.concat(result.results);
        _apiSearchHasMore = result.page < result.totalPages;
        showMovieSearchResults();
    };

    // ── Add Movie Options ──
    window.showMovieAddOptions = async function(tmdbId) {
        var detail = await fetchMovieDetails(tmdbId);
        if (!detail) return;

        var existingIds = ((AppState.movies && AppState.movies.items) || []).map(function(m) { return m.tmdbId; });
        if (existingIds.indexOf(tmdbId) !== -1) {
            alert(t('mov_already_exists'));
            return;
        }

        var poster = detail.posterPath ? (TMDB_IMG_LG + detail.posterPath) : '';
        var year = detail.releaseDate ? detail.releaseDate.substring(0, 4) : '';
        var rating = detail.voteAverage ? detail.voteAverage.toFixed(1) : '-';

        var modalHtml = '<div class="modal-overlay" id="movie-add-modal" onclick="window.closeMovieAddModal(event)" style="display:flex; align-items:center; justify-content:center; z-index:300;">';
        modalHtml += '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:340px; width:90%; max-height:80vh; overflow-y:auto; padding:16px;">';

        if (poster) {
            modalHtml += '<div style="text-align:center; margin-bottom:12px;"><img src="' + poster + '" style="max-height:200px; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.3);" onerror="this.style.display=\'none\'"></div>';
        }
        modalHtml += '<div style="font-size:1rem; font-weight:800; color:var(--text-main); margin-bottom:4px;">' + escHtml(detail.title) + '</div>';
        if (detail.originalTitle && detail.originalTitle !== detail.title) {
            modalHtml += '<div style="font-size:0.75rem; color:var(--text-sub); margin-bottom:8px;">' + escHtml(detail.originalTitle) + '</div>';
        }

        var infoHtml = '';
        if (detail.director) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_director') + '</span> ' + escHtml(detail.director) + '</div>';
        if (detail.cast) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_cast') + '</span> ' + escHtml(detail.cast) + '</div>';
        if (year) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_release') + '</span> ' + year + '</div>';
        if (rating !== '-') infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_rating') + '</span> ★ ' + rating + '</div>';
        if (detail.genres) infoHtml += '<div><span style="color:var(--neon-cyan); font-weight:600;">' + t('mov_genre') + '</span> ' + escHtml(detail.genres) + '</div>';
        if (infoHtml) {
            modalHtml += '<div style="font-size:0.75rem; color:var(--text-sub); line-height:1.6; margin-bottom:10px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px;">' + infoHtml + '</div>';
        }
        if (detail.overview) {
            modalHtml += '<div style="font-size:0.72rem; color:var(--text-sub); line-height:1.5; margin-bottom:12px; max-height:80px; overflow-y:auto;">' + escHtml(detail.overview) + '</div>';
        }

        modalHtml += '<div style="display:flex; flex-direction:column; gap:8px;">';
        modalHtml += '<button class="btn-primary" style="padding:10px; font-size:0.85rem;" onclick="window.addMovieToList(' + tmdbId + ', \'watched\')">' + t('mov_add_watched') + '</button>';
        modalHtml += '<button class="btn-primary" style="padding:10px; font-size:0.85rem; background:var(--neon-cyan);" onclick="window.addMovieToList(' + tmdbId + ', \'watching\')">' + t('mov_add_watching') + '</button>';
        modalHtml += '<button class="btn-primary" style="padding:10px; font-size:0.85rem; background:var(--border-color);" onclick="window.addMovieToList(' + tmdbId + ', \'wantToWatch\')">' + t('mov_add_want') + '</button>';
        modalHtml += '</div>';

        modalHtml += '</div></div>';

        // Store detail temporarily
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
    window.addMovieToList = function(tmdbId, category) {
        var detail = window._pendingMovieDetail;
        if (!detail || detail.tmdbId !== tmdbId) return;

        if (!AppState.movies) AppState.movies = { items: [], rewardedIds: [] };
        if (!Array.isArray(AppState.movies.items)) AppState.movies.items = [];
        if (!Array.isArray(AppState.movies.rewardedIds)) AppState.movies.rewardedIds = [];

        var existing = AppState.movies.items.find(function(m) { return m.tmdbId === tmdbId; });
        if (existing) {
            alert(t('mov_already_exists'));
            return;
        }

        var movie = {
            tmdbId: detail.tmdbId,
            title: detail.title,
            originalTitle: detail.originalTitle,
            director: detail.director || '',
            cast: detail.cast || '',
            posterPath: detail.posterPath || '',
            releaseDate: detail.releaseDate || '',
            voteAverage: detail.voteAverage || 0,
            overview: detail.overview || '',
            genres: detail.genres || '',
            category: category,
            addedDate: todayStr(),
            finishedDate: category === 'watched' ? todayStr() : null,
            rewardGranted: false
        };

        AppState.movies.items.push(movie);

        if (category === 'watched') {
            grantWatchReward(movie);
        }

        // Close modal
        var modal = document.getElementById('movie-add-modal');
        if (modal) modal.remove();
        window._pendingMovieDetail = null;

        // Refresh
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
        if (movie.tmdbId && AppState.movies.rewardedIds.indexOf(movie.tmdbId) !== -1) {
            movie.rewardGranted = true;
            return;
        }
        movie.rewardGranted = true;
        if (movie.tmdbId) AppState.movies.rewardedIds.push(movie.tmdbId);
        AppState.user.points += 10;
        AppState.user.pendingStats.int += 0.5;
        if (window.AppLogger) AppLogger.info('[Movie] 영화 감상 보상 지급: +10P, INT +0.5');
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

        // Period filter
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

        // Local search filter
        if (_movLocalSearch && _movSearchQuery) {
            var q = _movSearchQuery.toLowerCase();
            filtered = filtered.filter(function(m) {
                return (m.title && m.title.toLowerCase().indexOf(q) !== -1) ||
                    (m.originalTitle && m.originalTitle.toLowerCase().indexOf(q) !== -1) ||
                    (m.director && m.director.toLowerCase().indexOf(q) !== -1);
            });
        }

        // Sort: newest first
        filtered.sort(function(a, b) { return (b.addedDate || '').localeCompare(a.addedDate || ''); });

        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--text-sub); font-size:0.85rem;">' + t('mov_empty') + '</div>';
            return;
        }

        var html = '';
        filtered.forEach(function(m, idx) {
            var poster = m.posterPath ? (TMDB_IMG + m.posterPath) : '';
            var year = m.releaseDate ? m.releaseDate.substring(0, 4) : '';
            var rating = m.voteAverage ? m.voteAverage.toFixed(1) : '-';
            var realIdx = items.indexOf(m);

            html += '<div class="movie-item" style="display:flex; align-items:flex-start; gap:12px; padding:12px; border-bottom:1px solid var(--border-color);">';

            if (poster) {
                html += '<img src="' + poster + '" style="width:55px; height:82px; object-fit:cover; border-radius:6px; flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.2);" onerror="this.style.display=\'none\'">';
            } else {
                html += '<div style="width:55px; height:82px; background:var(--border-color); border-radius:6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">🎬</div>';
            }

            html += '<div style="flex:1; min-width:0;">';
            html += '<div style="font-size:0.88rem; font-weight:700; color:var(--text-main); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(m.title) + '</div>';
            if (m.originalTitle && m.originalTitle !== m.title) {
                html += '<div style="font-size:0.68rem; color:var(--text-sub); margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escHtml(m.originalTitle) + '</div>';
            }
            if (m.director) {
                html += '<div style="font-size:0.7rem; color:var(--text-sub);">' + escHtml(m.director) + '</div>';
            }
            html += '<div style="font-size:0.7rem; color:var(--text-sub); margin-top:2px;">';
            if (year) html += year;
            if (rating !== '-') html += (year ? ' · ' : '') + '★ ' + rating;
            if (m.genres) html += ' · ' + escHtml(m.genres.split(',')[0]);
            html += '</div>';

            // Action buttons
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
        items.splice(idx, 1);
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
    if (window.updateMovieCardCount) window.updateMovieCardCount();

})();
