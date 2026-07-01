/* ============================================================================
   Навигация по слайдам + ленивое воспроизведение видео.
   - Десктоп: колесо мыши (с учётом внутренней прокрутки), стрелки, кнопки, точки.
   - Мобильный: вертикальный/горизонтальный свайп.
   - Видео играют только на активном слайде; «сторож» перезапускает зависшие
     ролики (фикс archive-loop.mp4 при возврате на экран).
   - Поддержка deep-link (#s3) и prefers-reduced-motion.
   ========================================================================= */
(function () {
  var deck = document.getElementById('deck');
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var pipsBox = document.getElementById('pips');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var hint = document.getElementById('hint');
  var current = 0;

  // ── Точки-индикаторы ─────────────────────────────────────────────────────
  slides.forEach(function (s, i) {
    var b = document.createElement('button');
    b.className = 'pip' + (i === 0 ? ' on' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', 'Слайд ' + (i + 1));
    b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    b.addEventListener('click', function () { go(i); });
    pipsBox.appendChild(b);
  });
  var pips = Array.prototype.slice.call(pipsBox.children);

  // ── Видео: запуск со «сторожем» против зависаний ──────────────────────────
  function playWithWatchdog(v) {
    if (!v.src && v.dataset.src) v.src = v.dataset.src;
    var t0 = v.currentTime;
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* autoplay может быть отклонён — не критично */ });

    clearTimeout(v._wd);
    v._wd = setTimeout(function () {
      // Если кадр не сдвинулся, хотя метаданные есть — ролик завис: перезагружаем.
      if (!v.paused && v.readyState >= 1 && v.currentTime <= t0 + 0.02) {
        try {
          v.load();
          var p2 = v.play();
          if (p2 && p2.catch) p2.catch(function () { });
        } catch (e) { }
      }
    }, 480);
  }

  function activateVideos(slide) {
    slide.querySelectorAll('video').forEach(function (v) {
      if (!v._bound) {
        v._bound = true;
        // авто-восстановление при ошибке/застревании буфера
        v.addEventListener('stalled', function () { if (slide.classList.contains('active')) playWithWatchdog(v); });
        v.addEventListener('error', function () {
          try { v.load(); } catch (e) { }
          if (slide.classList.contains('active')) playWithWatchdog(v);
        });
      }
      playWithWatchdog(v);
    });
  }

  function pauseVideos(slide) {
    slide.querySelectorAll('video').forEach(function (v) {
      clearTimeout(v._wd);
      try { v.pause(); } catch (e) { }
    });
  }

  // ── Переход к слайду i ─────────────────────────────────────────────────────
  function go(i, dir) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === current) { activateVideos(slides[i]); return; }
    dir = dir || (i > current ? 'next' : 'prev');

    pauseVideos(slides[current]);
    slides[current].classList.remove('active', 'from-next', 'from-prev');
    pips[current].classList.remove('on');
    pips[current].setAttribute('aria-selected', 'false');

    current = i;
    var s = slides[current];
    s.classList.remove('from-next', 'from-prev');
    void s.offsetWidth;                       // перезапуск CSS-анимации
    s.classList.add(dir === 'next' ? 'from-next' : 'from-prev', 'active');
    s.scrollTop = 0;                          // сброс внутренней прокрутки

    pips[current].classList.add('on');
    pips[current].setAttribute('aria-selected', 'true');
    activateVideos(s);

    prev.disabled = current === 0;
    next.disabled = current === slides.length - 1;

    hideHint();
    if (s.id) history.replaceState(null, '', '#' + s.id);
  }

  // ── Кнопки / клавиатура ────────────────────────────────────────────────────
  prev.addEventListener('click', function () { go(current - 1, 'prev'); });
  next.addEventListener('click', function () { go(current + 1, 'next'); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') { go(current + 1, 'next'); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { go(current - 1, 'prev'); e.preventDefault(); }
    if (e.key === 'Home') go(0, 'prev');
    if (e.key === 'End') go(slides.length - 1, 'next');
  });

  // Микро-переполнение (от округлений) не должно блокировать листание:
  // слайд считается прокручиваемым только если перерастает экран заметно.
  var SCROLL_TOL = 16;

  // ── Колесо мыши (учитывает внутреннюю прокрутку слайда) ────────────────────
  var wheelLock = false;
  deck.addEventListener('wheel', function (e) {
    var s = slides[current];
    var canScroll = s.scrollHeight > s.clientHeight + SCROLL_TOL;
    if (canScroll) {
      var atTop = s.scrollTop <= 0;
      var atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;
      if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) return; // обычная прокрутка
    }
    if (wheelLock) return;
    wheelLock = true;
    setTimeout(function () { wheelLock = false; }, 500);
    if (e.deltaY > 0) go(current + 1, 'next');
    else if (e.deltaY < 0) go(current - 1, 'prev');
  }, { passive: true });

  // ── Сенсорный свайп ────────────────────────────────────────────────────────
  var tx0 = null, ty0 = null;
  var TH = 48; // порог срабатывания, px
  deck.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tx0 = ty0 = null; return; }
    tx0 = e.touches[0].clientX;
    ty0 = e.touches[0].clientY;
  }, { passive: true });

  deck.addEventListener('touchend', function (e) {
    if (tx0 == null) return;
    var dx = e.changedTouches[0].clientX - tx0;
    var dy = e.changedTouches[0].clientY - ty0;
    var s = slides[current];
    var canScroll = s.scrollHeight > s.clientHeight + SCROLL_TOL;

    if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > TH) {
      // вертикальный свайп — но не мешаем прокрутке длинного контента
      var atTop = s.scrollTop <= 0;
      var atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;
      var wasScroll = canScroll && ((dy < 0 && !atBottom) || (dy > 0 && !atTop));
      if (!wasScroll) { if (dy < 0) go(current + 1, 'next'); else go(current - 1, 'prev'); }
    } else if (Math.abs(dx) > TH) {
      if (dx < 0) go(current + 1, 'next'); else go(current - 1, 'prev');
    }
    tx0 = ty0 = null;
  }, { passive: true });

  // ── Перезапуск видео при возврате во вкладку ────────────────────────────────
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) activateVideos(slides[current]);
  });

  // ── Подсказка-свайп (только сенсорные устройства) ───────────────────────────
  var hinted = false;
  function hideHint() { if (hint) hint.classList.remove('show'); }
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && hint) {
    setTimeout(function () { if (!hinted) hint.classList.add('show'); }, 900);
    setTimeout(hideHint, 6000);
    deck.addEventListener('touchstart', function () { hinted = true; hideHint(); }, { passive: true, once: true });
  }

  // ── Старт (с учётом deep-link #sX) ──────────────────────────────────────────
  var start = 0;
  if (location.hash) {
    var idx = slides.findIndex(function (s) { return '#' + s.id === location.hash; });
    if (idx > 0) start = idx;
  }
  prev.disabled = true;
  if (start > 0) {
    go(start);
  } else {
    next.disabled = slides.length <= 1;
    activateVideos(slides[0]);
  }
})();

/* ============================================================================
   Фоновая музыка.
   - Автозапуск звука браузеры блокируют → стартуем при первом действии
     пользователя (клик / клавиша / касание / колесо).
   - Тихо (громкость 0.18). Кнопка-переключатель; выбор запоминается.
   - На неактивной вкладке ставим на паузу.
   ========================================================================= */
(function () {
  var bgm = document.getElementById('bgm');
  var btn = document.getElementById('soundToggle');
  if (!bgm || !btn) return;

  bgm.volume = 0.18;
  var wanted = true;                       // желаемое состояние (вкл по умолчанию)
  try { if (localStorage.getItem('bgm') === 'off') wanted = false; } catch (e) { }
  var started = false;

  function render() {
    var playing = wanted && !bgm.paused;
    btn.classList.toggle('is-off', !playing);
    btn.setAttribute('aria-pressed', wanted ? 'true' : 'false');
    btn.setAttribute('aria-label', wanted ? 'Выключить звук' : 'Включить звук');
  }
  function tryPlay() {
    if (!wanted) return;
    var p = bgm.play();
    if (p && p.catch) p.catch(function () { });
  }

  // первый жест разблокирует звук
  var GESTURES = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
  function firstGesture() {
    if (started) return;
    started = true;
    tryPlay();
    render();
    GESTURES.forEach(function (ev) { document.removeEventListener(ev, firstGesture); });
  }
  GESTURES.forEach(function (ev) { document.addEventListener(ev, firstGesture, { passive: true }); });

  // переключатель
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    wanted = !wanted;
    try { localStorage.setItem('bgm', wanted ? 'on' : 'off'); } catch (e) { }
    if (wanted) tryPlay(); else bgm.pause();
    render();
  });

  bgm.addEventListener('play', render);
  bgm.addEventListener('pause', render);

  // пауза на скрытой вкладке
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { try { bgm.pause(); } catch (e) { } }
    else if (wanted) tryPlay();
  });

  render();
})();
