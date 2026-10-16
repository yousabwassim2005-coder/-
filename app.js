(() => {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const LEVEL_DEFAULTS = [
    { id: 'level-1', title: 'الفرقة الأولى', sort_order: 1 },
    { id: 'level-2', title: 'الفرقة الثانية', sort_order: 2 },
    { id: 'level-3', title: 'الفرقة الثالثة', sort_order: 3 },
    { id: 'level-4', title: 'الفرقة الرابعة', sort_order: 4 },
    { id: 'level-5', title: 'الفرقة الخامسة', sort_order: 5 }
  ];
  const CATEGORY_DEFAULTS = [
    'الألحان', 'التسبحة', 'القداس الإلهي', 'ألحان الأعياد والمناسبات', 'مردات الكنيسة', 'الألحان القبطية', 'الشرح والتدريبات الصوتية'
  ].map((name, index) => ({ id: `category-${index + 1}`, name, sort_order: index + 1, is_default: true }));
  const VIEW_NAMES = { home: 'الرئيسية', curriculum: 'المناهج الدراسية', chants: 'مكتبة الألحان', results: 'النتائج', enrollment: 'الالتحاق بالمعهد', admin: 'إدارة المحتوى' };
  const STORE_KEY = 'didymus-learning-v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const hasBackend = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && window.supabase?.createClient);
  const state = {
    client: hasBackend ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null,
    user: null,
    role: null,
    levels: LEVEL_DEFAULTS,
    categories: CATEGORY_DEFAULTS,
    subjects: [],
    lessons: [],
    chants: [],
    announcements: [],
    results: [],
    settings: {},
    backendReady: false,
    selectedLevel: null,
    selectedCategory: '',
    local: loadLocal('guest')
  };
  let localOwner = 'guest';

  function loadLocal(owner = 'guest') {
    try { return { favorites: [], completed: [], lastLesson: null, ...(JSON.parse(localStorage.getItem(`${STORE_KEY}:${owner}`) || (owner === 'guest' ? localStorage.getItem(STORE_KEY) : '{}') || '{}')) }; }
    catch { return { favorites: [], completed: [], lastLesson: null }; }
  }
  function saveLocal() { localStorage.setItem(`${STORE_KEY}:${state.user?.id || 'guest'}`, JSON.stringify(state.local)); }
  function toast(message, type = '') {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    $('#toast-region').append(item);
    setTimeout(() => item.remove(), 4200);
  }
  function idKey(item) { return String(item?.id ?? ''); }
  function currentLevel() { return state.levels.find(level => idKey(level) === String(state.selectedLevel)) || state.levels[0]; }
  function levelTitle(level) { return level?.title || level?.name || 'فرقة دراسية'; }
  function lessonKind(type) {
    const icons = { pdf: '▧', audio: '♫', video: '▷', image: '▣', link: '↗', text: '☷', file: '⇩' };
    return icons[type] || '▤';
  }
  function lessonTypeName(type) {
    const labels = { pdf: 'ملف PDF', audio: 'ملف صوتي', video: 'فيديو تعليمي', image: 'صورة', link: 'رابط خارجي', text: 'نص وملاحظات', file: 'ملف قابل للتنزيل' };
    return labels[type] || 'مادة تعليمية';
  }
  function activateView(view) {
    if (!VIEW_NAMES[view]) return;
    $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
    $$('.nav-item[data-view], .mobile-nav-item[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === view));
    $('#breadcrumb-current').textContent = VIEW_NAMES[view];
    $('#sidebar').classList.remove('open');
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    if (view === 'admin') renderAdmin();
    if (view === 'results') renderResults();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function updateConnection() {
    const offline = !navigator.onLine;
    const dot = $('#connection-dot');
    dot.className = `status-dot ${offline ? 'offline' : state.backendReady ? 'online' : ''}`;
    $('#connection-label').textContent = offline ? 'غير متصل بالإنترنت' : state.backendReady ? 'متصل بالمنصة' : hasBackend ? 'لم يتحقق الاتصال' : 'تصفح محلي';
    $('#connection-detail').textContent = offline ? 'المحفوظات تبقى على هذا الجهاز' : state.backendReady ? 'بيانات المنصة متاحة' : hasBackend ? 'تعذر التحقق من قاعدة البيانات' : 'قاعدة البيانات غير مهيأة';
    const notice = $('#backend-notice');
    notice.hidden = state.backendReady;
    if (offline && !notice.hidden) notice.querySelector('p').textContent = 'أنت غير متصل. تقدمك المحلي يبقى محفوظاً على هذا الجهاز، ولن تتم مزامنته.';
  }

  async function refreshRemote() {
    if (!state.client) return;
    try {
      const [levels, categories, subjects, lessons, chants, announcements, settings] = await Promise.all([
        state.client.from('study_levels').select('id,title,sort_order').order('sort_order'),
        state.client.from('chant_categories').select('id,name,sort_order').order('sort_order'),
        state.client.from('subjects').select('id,study_level_id,title,academic_year,semester').order('title'),
        state.client.from('lessons').select('id,subject_id,title,description,content_type,content_url,term,sort_order').order('sort_order'),
        state.client.from('chants').select('id,category_id,title,description,content_type,content_url,drive_file_id,source').order('title'),
        state.client.from('announcements').select('id,title,body,created_at,is_important').eq('published', true).order('created_at', { ascending: false }).limit(5),
        state.client.from('platform_settings').select('value').eq('key', 'public').maybeSingle()
      ]);
      for (const res of [levels, categories, subjects, lessons, chants, announcements, settings]) if (res.error) throw res.error;
      state.levels = levels.data?.length ? levels.data : LEVEL_DEFAULTS;
      state.categories = categories.data?.length ? categories.data : CATEGORY_DEFAULTS;
      state.subjects = subjects.data || [];
      state.lessons = lessons.data || [];
      state.chants = chants.data || [];
      state.announcements = announcements.data || [];
      state.settings = settings.data?.value || {};
      const { data: { user } } = await state.client.auth.getUser();
      state.user = user || null;
      state.role = null;
      if (user) {
        const profile = await state.client.from('profiles').select('display_name,role').eq('id', user.id).maybeSingle();
        if (!profile.error) state.role = profile.data?.role || 'student';
      }
      const owner = user?.id || 'guest';
      if (owner !== localOwner) { localOwner = owner; state.local = loadLocal(owner); }
      if (user) {
        const progress = await state.client.from('lesson_progress').select('lesson_id,is_favorite,is_completed,last_opened_at').eq('student_id', user.id);
        if (!progress.error) {
          for (const row of progress.data || []) {
            if (row.is_favorite && !state.local.favorites.includes(String(row.lesson_id))) state.local.favorites.push(String(row.lesson_id));
            if (row.is_completed && !state.local.completed.includes(String(row.lesson_id))) state.local.completed.push(String(row.lesson_id));
            if (row.last_opened_at && (!state.local.lastOpenedAt || row.last_opened_at > state.local.lastOpenedAt)) { state.local.lastOpenedAt = row.last_opened_at; state.local.lastLesson = String(row.lesson_id); }
          }
          saveLocal();
        }
      }
      state.backendReady = true;
    } catch (error) {
      state.backendReady = false;
      console.error('تعذر تحميل بيانات المنصة', error);
      toast('تعذر جلب بيانات المنصة. تحقق من إعداد قاعدة البيانات والاتصال.', 'error');
    }
    renderAll();
  }

  function renderAll() {
    updateConnection();
    renderProfile();
    renderLevels();
    renderCurriculum();
    renderChants();
    renderAnnouncements();
    renderPersonal();
    renderPublicSettings();
  }

  function renderProfile() {
    const name = state.user?.user_metadata?.display_name || state.user?.email?.split('@')[0] || 'زائر';
    $('#profile-name').textContent = name;
    $('#profile-role').textContent = state.user ? ({ admin: 'مدير المنصة', teacher: 'معلّم', student: 'طالب' }[state.role] || 'عضو') : 'تصفح المواد المتاحة';
    $('#avatar').textContent = [...name][0] || 'ز';
  }

  function renderLevels() {
    const home = $('#home-levels');
    home.innerHTML = state.levels.map((level, index) => {
      const subjects = state.subjects.filter(s => String(s.study_level_id) === idKey(level)).length;
      const lessons = state.lessons.filter(item => state.subjects.some(s => String(s.id) === String(item.subject_id) && String(s.study_level_id) === idKey(level))).length;
      return `<button class="level-card" data-level="${esc(idKey(level))}"><span class="level-number">${esc(index + 1)}</span><strong>${esc(levelTitle(level))}</strong><small>${subjects ? `${subjects} مواد · ${lessons} دروس` : 'مناهج المرحلة'}</small><span class="level-open">←</span></button>`;
    }).join('');
    const term = $('#term-filter');
    const selectedTerm = term.value;
    const terms = [...new Set(state.subjects.map(s => s.semester).concat(state.lessons.map(l => l.term)).filter(Boolean))];
    term.innerHTML = '<option value="">كل الفصول الدراسية</option>' + terms.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
    term.value = terms.includes(selectedTerm) ? selectedTerm : '';
    const tabContainer = $('#level-tabs');
    if (!state.selectedLevel || !state.levels.some(level => idKey(level) === String(state.selectedLevel))) state.selectedLevel = idKey(state.levels[0]);
    tabContainer.innerHTML = state.levels.map((level, index) => `<button role="tab" aria-selected="${idKey(level) === String(state.selectedLevel)}" class="tab-button ${idKey(level) === String(state.selectedLevel) ? 'active' : ''}" data-level="${esc(idKey(level))}">${esc(levelTitle(level))}</button>`).join('');
  }

  function lessonsForSubject(subject) {
    return state.lessons.filter(lesson => String(lesson.subject_id) === String(subject.id));
  }

  function renderCurriculum() {
    const level = currentLevel();
    if (!level) return;
    const query = ($('#curriculum-search').value || '').trim().toLocaleLowerCase('ar');
    const type = $('#type-filter').value;
    const term = $('#term-filter').value;
    let subjects = state.subjects.filter(subject => String(subject.study_level_id) === idKey(level));
    if (term) subjects = subjects.filter(subject => subject.semester === term || lessonsForSubject(subject).some(l => l.term === term));
    if (query) subjects = subjects.filter(subject => `${subject.title} ${lessonsForSubject(subject).map(l => l.title).join(' ')}`.toLocaleLowerCase('ar').includes(query));
    let visibleLessonCount = 0;
    const sections = subjects.map(subject => {
      const lessons = lessonsForSubject(subject).filter(lesson => (!type || lesson.content_type === type) && (!term || lesson.term === term) && (!query || `${lesson.title} ${lesson.description || ''}`.toLocaleLowerCase('ar').includes(query) || subject.title.toLocaleLowerCase('ar').includes(query)));
      if (query && !lessons.length && !subject.title.toLocaleLowerCase('ar').includes(query)) return '';
      visibleLessonCount += lessons.length;
      return `<article class="subject-card"><div class="subject-header"><h3>${esc(subject.title)}</h3><small>${esc([subject.academic_year, subject.semester].filter(Boolean).join(' · '))}</small></div>${lessons.length ? `<div class="lesson-list">${lessons.map(lesson => lessonRow(lesson)).join('')}</div>` : '<p class="muted-copy" style="margin-top:8px">لا توجد دروس منشورة في هذه المادة بعد.</p>'}</article>`;
    }).filter(Boolean);
    const host = $('#curriculum-content');
    if (!sections.length) {
      host.innerHTML = `<div class="empty-state"><span>▤</span><strong>${query || type || term ? 'لا توجد نتائج مطابقة' : 'لم يُنشر منهج لهذه الفرقة بعد'}</strong><p>${query || type || term ? 'جرّب تغيير كلمات البحث أو عوامل التصفية.' : 'ستظهر المواد والدروس هنا بعد أن تنشرها إدارة المعهد.'}</p></div>`;
    } else {
      host.innerHTML = `<div class="panel-heading"><h2>${esc(levelTitle(level))}</h2><small>${subjects.length} مواد · ${visibleLessonCount} دروس منشورة</small></div><div class="subject-list">${sections.join('')}</div>`;
    }
  }

  function lessonRow(lesson) {
    const done = state.local.completed.includes(String(lesson.id));
    const favorite = state.local.favorites.includes(String(lesson.id));
    return `<button class="lesson-row" data-lesson="${esc(lesson.id)}"><span class="lesson-kind">${lessonKind(lesson.content_type)}</span><span class="lesson-info"><strong>${esc(lesson.title)}</strong><small>${esc(lessonTypeName(lesson.content_type))}${lesson.term ? ` · ${esc(lesson.term)}` : ''}</small></span><span class="lesson-state">${done ? '✓ مكتمل' : favorite ? '♡ محفوظ' : 'عرض المادة'}</span></button>`;
  }

  function renderChants() {
    const categorySelect = $('#chant-category-filter');
    const old = categorySelect.value;
    categorySelect.innerHTML = '<option value="">كل التصنيفات</option>' + state.categories.map(cat => `<option value="${esc(cat.id)}">${esc(cat.name)}</option>`).join('');
    if (state.categories.some(c => idKey(c) === old)) categorySelect.value = old;
    const selected = categorySelect.value;
    const query = ($('#chant-search').value || '').trim().toLocaleLowerCase('ar');
    const categories = state.categories.filter(c => !selected || idKey(c) === selected);
    $('#chant-categories').innerHTML = `<button class="chip ${!selected ? 'active' : ''}" data-category="">الكل</button>` + state.categories.map(cat => `<button class="chip ${selected === idKey(cat) ? 'active' : ''}" data-category="${esc(idKey(cat))}">${esc(cat.name)}</button>`).join('');
    const rows = state.chants.filter(item => (!selected || String(item.category_id) === selected) && (!query || `${item.title} ${item.description || ''}`.toLocaleLowerCase('ar').includes(query)));
    const host = $('#chants-content');
    if (!rows.length) {
      host.innerHTML = `<div class="empty-state"><span>♫</span><strong>${query ? 'لا توجد ألحان مطابقة' : 'المكتبة جاهزة لاستقبال محتوى المعهد'}</strong><p>${query ? 'جرّب كلمة بحث أخرى.' : 'لا توجد ملفات منشورة بعد. تصنيفات المكتبة أمثلة قابلة للتعديل من إعداد قاعدة البيانات.'}</p></div>`;
      return;
    }
    host.innerHTML = `<div class="chants-grid">${rows.map(item => {
      const catName = state.categories.find(c => idKey(c) === String(item.category_id))?.name || 'بدون تصنيف';
      const source = item.source === 'google_drive' ? 'Google Drive' : item.source === 'storage' ? 'ملف المعهد' : 'رابط خارجي';
      return `<button class="chant-card" data-chant="${esc(item.id)}"><span class="lesson-kind">${lessonKind(item.content_type)}</span><span class="lesson-info"><strong>${esc(item.title)}</strong><small>${esc(catName)} · ${esc(lessonTypeName(item.content_type))}</small></span><span class="source-label">${esc(source)}</span></button>`;
    }).join('')}</div>`;
  }

  function renderAnnouncements() {
    const host = $('#home-announcements');
    const dot = $('#notification-dot');
    dot.hidden = state.announcements.length === 0;
    if (!state.announcements.length) {
      host.innerHTML = '<div class="empty-state compact"><span>♢</span><strong>لا توجد إعلانات منشورة</strong><p>ستظهر التنبيهات الرسمية هنا بعد إضافتها من إدارة المعهد.</p></div>';
      return;
    }
    host.innerHTML = state.announcements.map(item => `<article class="announcement-row"><span class="announcement-marker"></span><div><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></div></article>`).join('');
  }

  function renderPublicSettings() {
    const admission = $('#admission-copy');
    if (admission && state.settings.admission_text) { admission.textContent = state.settings.admission_text; $('#admission-empty').hidden = true; }
    const phone = $('#contact-phone');
    if (phone && state.settings.contact_phone) {
      const clean = String(state.settings.contact_phone).replace(/[^+\d]/g, '');
      phone.innerHTML = `<a href="tel:${esc(clean)}">${esc(state.settings.contact_phone)}</a>`;
    }
    const email = $('#contact-email');
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.settings.contact_email || '')) {
      email.innerHTML = `<a href="mailto:${esc(state.settings.contact_email)}">${esc(state.settings.contact_email)}</a>`;
    }
    const address = $('#contact-address');
    if (address && state.settings.contact_address) address.textContent = state.settings.contact_address;
  }

  function renderPersonal() {
    const favoriteCount = state.local.favorites.length;
    const completeCount = state.local.completed.length;
    const last = [...state.lessons, ...state.chants].find(item => String(item.id) === String(state.local.lastLesson));
    const cards = [
      `<button class="personal-card" data-personal="last"><span class="personal-icon">▷</span><span><strong>${last ? esc(last.title) : 'لا يوجد درس قيد المتابعة'}</strong><small>${last ? 'استكمل الدرس الأخير' : 'ابدأ بزيارة أحد المناهج'}</small></span></button>`,
      `<button class="personal-card" data-personal="favorites"><span class="personal-icon">♡</span><span><strong>${favoriteCount} مواد محفوظة</strong><small>المفضلة على هذا الجهاز</small></span></button>`,
      `<div class="personal-card"><span class="personal-icon">✓</span><span><strong>${completeCount} دروس مكتملة</strong><small>تقدم محلي غير متزامن</small></span></div>`
    ];
    $('#personal-summary').innerHTML = cards.join('');
  }

  function openLesson(lesson, isChant = false) {
    if (!lesson) return;
    state.local.lastLesson = String(lesson.id);
    state.local.lastOpenedAt = new Date().toISOString();
    saveLocal();
    syncLessonProgress(lesson.id);
    const completed = state.local.completed.includes(String(lesson.id));
    const favorite = state.local.favorites.includes(String(lesson.id));
    const url = lesson.content_url || '';
    const safeUrl = /^https?:\/\//i.test(url) ? url : '';
    let media = '';
    if (safeUrl && lesson.content_type === 'audio') media = `<audio controls preload="none" src="${esc(safeUrl)}" style="width:100%;margin-top:12px">يتعذر تشغيل الصوت في هذا المتصفح.</audio>`;
    else if (safeUrl && lesson.content_type === 'video') media = `<video controls preload="metadata" src="${esc(safeUrl)}" style="width:100%;max-height:320px;margin-top:12px;border-radius:9px"></video>`;
    else if (safeUrl && lesson.content_type === 'image') media = `<img src="${esc(safeUrl)}" alt="${esc(lesson.title)}" style="max-width:100%;max-height:390px;object-fit:contain;margin-top:12px;border-radius:9px">`;
    else if (safeUrl && lesson.content_type === 'pdf') media = `<iframe title="${esc(lesson.title)}" src="${esc(safeUrl)}" style="width:100%;height:min(55vh,520px);border:1px solid var(--line);border-radius:9px;margin-top:12px;background:#fff"></iframe>`;
    const sourceLabel = isChant && lesson.source === 'google_drive' ? 'ملف مرتبط من Google Drive' : safeUrl ? 'رابط المادة' : 'محتوى نصي';
    $('#lesson-detail').innerHTML = `<span class="eyebrow">${isChant ? 'مكتبة الألحان' : 'مادة دراسية'}</span><h2>${esc(lesson.title)}</h2><div class="lesson-detail-meta"><span class="meta-pill">${esc(lessonTypeName(lesson.content_type))}</span><span class="meta-pill">${esc(sourceLabel)}</span>${lesson.term ? `<span class="meta-pill">${esc(lesson.term)}</span>` : ''}</div>${lesson.description ? `<div class="lesson-body">${esc(lesson.description).replace(/\n/g, '<br>')}</div>` : '<p class="muted-copy">لا توجد ملاحظات مضافة لهذه المادة.</p>'}${media}<div class="lesson-actions"><button class="favorite-button ${favorite ? 'active' : ''}" data-action="favorite" data-id="${esc(lesson.id)}">${favorite ? '♥ في المفضلة' : '♡ أضف إلى المفضلة'}</button>${!isChant ? `<button class="complete-button ${completed ? 'active' : ''}" data-action="complete" data-id="${esc(lesson.id)}">${completed ? '✓ مكتمل' : 'علّم كمكتمل'}</button>` : ''}${safeUrl ? `<button class="complete-button" data-action="offline" data-url="${esc(safeUrl)}">⇩ حفظ للاستخدام دون اتصال</button><a class="button button-outline button-small" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">فتح المادة ↗</a>` : ''}${isChant && lesson.source === 'google_drive' && safeUrl ? `<a class="button button-outline button-small" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">فتح في Google Drive ↗</a>` : ''}</div>`;
    $('#lesson-modal').showModal();
    renderPersonal();
  }

  function toggleLocal(key, id) {
    const list = state.local[key];
    const index = list.indexOf(String(id));
    if (index >= 0) list.splice(index, 1); else list.push(String(id));
    saveLocal();
    syncLessonProgress(id);
    renderAll();
  }

  function syncLessonProgress(lessonId) {
    if (!state.client || !state.user || !state.lessons.some(item => String(item.id) === String(lessonId))) return;
    state.client.from('lesson_progress').upsert({
      student_id: state.user.id,
      lesson_id: lessonId,
      is_favorite: state.local.favorites.includes(String(lessonId)),
      is_completed: state.local.completed.includes(String(lessonId)),
      last_opened_at: state.local.lastLesson === String(lessonId) ? (state.local.lastOpenedAt || new Date().toISOString()) : null,
      updated_at: new Date().toISOString()
    }).then(({ error }) => { if (error) console.warn('تعذرت مزامنة تقدم الدرس', error); });
  }

  async function cacheOffline(url) {
    if (!url) return;
    if (!('serviceWorker' in navigator)) return toast('حفظ المواد غير متاح في هذا المتصفح.', 'error');
    const origin = new URL(url, location.href).origin;
    if (origin !== location.origin) return toast('حفظ المواد دون اتصال متاح للملفات المستضافة في موقع المعهد فقط.', 'error');
    try {
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active || navigator.serviceWorker.controller;
      if (!worker) throw new Error('service worker not ready');
      worker.postMessage({ type: 'CACHE_URL', url });
      toast('بدأ حفظ المادة على هذا الجهاز.', 'success');
    } catch { toast('تعذر حفظ المادة. افتح الموقع عبر HTTPS أو localhost ثم حاول مجدداً.', 'error'); }
  }

  function renderResults() {
    const host = $('#results-content');
    if (!state.user) {
      host.innerHTML = `<div class="empty-state"><span>◷</span><strong>سجّل الدخول لعرض نتائجك</strong><p>النتائج بيانات شخصية، ولا تُعرض في وضع التصفح المحلي.</p><button class="button button-primary" data-action="signin">تسجيل الدخول</button></div>`;
      return;
    }
    if (!state.client) return;
    host.innerHTML = '<div class="empty-state"><span>◌</span><strong>جارٍ تحميل النتائج</strong></div>';
    state.client.from('exam_results').select('id,exam_title,score,max_score,created_at').eq('student_id', state.user.id).order('created_at', { ascending: false }).then(({ data, error }) => {
      if (error) { host.innerHTML = '<div class="empty-state"><span>ⓘ</span><strong>تعذر تحميل النتائج</strong><p>راجع صلاحيات حسابك أو إعدادات قاعدة البيانات.</p></div>'; return; }
      state.results = data || [];
      host.innerHTML = state.results.length ? `<div class="subject-list">${state.results.map(result => `<article class="subject-card"><div class="subject-header"><h3>${esc(result.exam_title)}</h3><strong>${esc(result.score)} / ${esc(result.max_score)}</strong></div><small class="muted-copy">${result.created_at ? new Date(result.created_at).toLocaleDateString('ar-EG') : ''}</small></article>`).join('')}</div>` : '<div class="empty-state"><span>◷</span><strong>لا توجد نتائج منشورة</strong></div>';
    });
    $('#progress-content').innerHTML = `<div class="personal-grid"><div class="personal-card"><span class="personal-icon">✓</span><span><strong>${state.local.completed.length} دروس مكتملة</strong><small>هذا الجهاز</small></span></div><div class="personal-card"><span class="personal-icon">♡</span><span><strong>${state.local.favorites.length} مواد محفوظة</strong><small>هذا الجهاز</small></span></div></div>`;
  }

  function renderAdmin() {
    const auth = state.user
      ? `<div class="auth-state"><div><strong>تم تسجيل الدخول</strong><p>${esc(state.user.email)} · ${esc(state.role || 'عضو')}</p></div><button class="button button-outline button-small" data-action="signout">تسجيل الخروج</button></div>`
      : `<div class="auth-state"><div><strong>إدارة المحتوى محمية بتسجيل الدخول</strong><p>لا تُتاح أدوات الإدارة إلا لحساب يملك دور مدير أو معلّم.</p></div><button class="button button-primary button-small" data-action="signin">تسجيل الدخول</button></div>`;
    const canManage = state.user && ['admin', 'teacher'].includes(state.role);
    const backendStatus = state.backendReady ? '<span class="service-state ready">● الاتصال ناجح</span>' : hasBackend ? '<span class="service-state">● لم يتم التحقق</span>' : '<span class="service-state">● غير مهيأة</span>';
    const driveStatus = '<span class="service-state">● واجهة الاستيراد غير مهيأة</span>';
    const levelEditor = canManage && state.role === 'admin' ? '<section class="setup-note"><h2>أسماء الفرق الدراسية</h2><p>تغيير الاسم يحفظه في قاعدة البيانات ويظهر لجميع المستخدمين.</p><form id="levels-form" class="admin-form">' + state.levels.map(level => `<label class="field-label">الفرقة ${esc(level.sort_order)}<input name="level_${esc(idKey(level))}" required maxlength="100" value="${esc(levelTitle(level))}"></label>`).join('') + '<button class="button button-outline" type="submit">حفظ أسماء الفرق</button></form></section>' : '';
    const cards = `${levelEditor}<div class="admin-grid"><article class="service-card"><h2>قاعدة البيانات وتسجيل الدخول</h2><p>Supabase Auth وPostgres مع سياسات صلاحيات لكل دور.</p>${backendStatus}</article><article class="service-card"><h2>تكامل Google Drive</h2><p>يتطلب نقطة استيراد آمنة من الخادم وموافقة OAuth؛ لا تُحفظ أسرار Google في المتصفح.</p>${driveStatus}</article><article class="service-card"><h2>العمل دون اتصال</h2><p>الصفحات المخزنة وتقدم التعلم المحلي متاحان على هذا الجهاز.</p><span class="service-state ready">● مفعّل</span></article><article class="service-card"><h2>النسخ الاحتياطي والمزامنة</h2><p>تحتاج إلى قاعدة بيانات متصلة. البيانات المحلية لا تتزامن بين الأجهزة.</p><span class="service-state">● بانتظار إعداد قاعدة البيانات</span></article>${canManage ? `<section class="setup-note"><h2 style="margin-top:20px">إضافة درس</h2><p>يُنشر الدرس للمستخدمين الذين تسمح لهم سياسات قاعدة البيانات.</p><form id="lesson-create-form" class="admin-form"><label class="field-label">الفرقة<select name="level_id" required>${state.levels.map(level => `<option value="${esc(level.id)}">${esc(levelTitle(level))}</option>`).join('')}</select></label><label class="field-label">المادة<input name="subject" required maxlength="100" placeholder="مثال: الطقوس"></label><label class="field-label">السنة الدراسية<input name="academic_year" maxlength="30" placeholder="اختياري"></label><label class="field-label">الفصل الدراسي<input name="semester" maxlength="50" placeholder="اختياري"></label><label class="field-label">عنوان الدرس<input name="title" required maxlength="160"></label><label class="field-label">نوع المحتوى<select name="content_type"><option value="text">نص وملاحظات</option><option value="pdf">PDF</option><option value="audio">صوت</option><option value="video">فيديو</option><option value="image">صورة</option><option value="link">رابط</option><option value="file">ملف</option></select></label><label class="field-label">رابط المادة<input name="content_url" type="url" placeholder="اختياري"></label><label class="field-label">ملاحظات<textarea name="description" rows="3" maxlength="5000"></textarea></label><button class="button button-primary" type="submit">نشر الدرس</button></form>${state.role === 'admin' ? `<h2 style="margin-top:25px">الإعلانات وبيانات التواصل</h2><form id="announcement-form" class="admin-form"><label class="field-label">عنوان الإعلان<input name="title" required maxlength="150"></label><label class="field-label">نص الإعلان<textarea name="body" required rows="3" maxlength="3000"></textarea></label><button class="button button-outline" type="submit">نشر الإعلان</button></form><form id="settings-form" class="admin-form"><label class="field-label">معلومات الالتحاق<textarea name="admission_text" rows="3" maxlength="3000">${esc(state.settings.admission_text || '')}</textarea></label><label class="field-label">هاتف التواصل<input name="contact_phone" type="tel" maxlength="40" value="${esc(state.settings.contact_phone || '')}"></label><label class="field-label">البريد الإلكتروني<input name="contact_email" type="email" maxlength="200" value="${esc(state.settings.contact_email || '')}"></label><label class="field-label">العنوان<input name="contact_address" maxlength="250" value="${esc(state.settings.contact_address || '')}"></label><button class="button button-outline" type="submit">حفظ بيانات التواصل</button></form><h2 style="margin-top:25px">تصنيفات مكتبة الألحان</h2><form id="category-form" class="admin-form"><label class="field-label">اسم التصنيف الجديد<input name="name" required maxlength="100"></label><button class="button button-outline" type="submit">إضافة تصنيف</button></form><div class="category-edit-list">${state.categories.map(cat => `<form class="category-edit-form admin-form" data-category-id="${esc(cat.id)}"><label class="field-label">اسم التصنيف<input name="name" required maxlength="100" value="${esc(cat.name)}"></label><button class="button button-outline button-small" type="submit">حفظ الاسم</button></form>`).join('')}</div><h2 style="margin-top:25px">إضافة مادة إلى مكتبة الألحان</h2><form id="chant-form" class="admin-form"><label class="field-label">عنوان المادة<input name="title" required maxlength="160"></label><label class="field-label">التصنيف<select name="category_id">${state.categories.map(cat => `<option value="${esc(cat.id)}">${esc(cat.name)}</option>`).join('')}</select></label><label class="field-label">نوع المحتوى<select name="content_type"><option value="audio">صوت</option><option value="pdf">PDF</option><option value="video">فيديو</option><option value="link">رابط</option><option value="text">نص</option><option value="file">ملف</option></select></label><label class="field-label">رابط المادة<input name="content_url" type="url" placeholder="رابط يمكن للمستخدمين الوصول إليه"></label><label class="field-label">ملاحظات<textarea name="description" rows="3" maxlength="5000"></textarea></label><button class="button button-outline" type="submit">إضافة للمكتبة</button></form>` : ''}</section>` : ''}<section class="setup-note"><h2>ما يلزم لإطلاق المنصة</h2><p>هذه الحزمة واجهة PWA مع ربط اختياري بقاعدة Supabase. إضافة الدروس الحالية تقبل روابط؛ رفع الملفات وتكامل Google Drive يحتاجان إلى إعداد خادم إضافي.</p><ul><li>أنشئ مشروع Supabase، شغّل <code>backend/schema.sql</code>، ثم أنشئ أول مدير وفق دليل الإعداد.</li><li>ضع رابط المشروع ومفتاح anon العام في <code>config.js</code>. لا تضع service role key أو أسرار OAuth في المتصفح.</li><li>تكامل Google Drive واستيراد الملفات التلقائي لم يُنفذا بعد؛ يحتاجان إلى خدمة خادم مصادق عليها ومفاتيح OAuth محفوظة كأسرار.</li><li>انشر الموقع عبر HTTPS. تنزيل المواد يعتمد على تخزين المتصفح وقد يخضع لمساحته المتاحة.</li></ul><p>لا يُعرض محتوى دراسي تجريبي على أنه منشور. المستويات والتصنيفات الافتراضية مجرد هيكل فارغ.</p></section></div>`;
    $('#admin-content').innerHTML = auth + cards;
    $('#levels-form')?.addEventListener('submit', updateLevels);
    $('#lesson-create-form')?.addEventListener('submit', createLesson);
    $('#announcement-form')?.addEventListener('submit', createAnnouncement);
    $('#category-form')?.addEventListener('submit', createCategory);
    $('#chant-form')?.addEventListener('submit', createChant);
    $$('.category-edit-form', $('#admin-content')).forEach(form => form.addEventListener('submit', updateCategory));
    $('#settings-form')?.addEventListener('submit', saveSettings);
  }

  async function updateLevels(event) {
    event.preventDefault();
    if (!state.client || !state.user || state.role !== 'admin') return toast('تغيير أسماء الفرق يتطلب حساب مدير.', 'error');
    const form = new FormData(event.currentTarget);
    for (const level of state.levels) {
      const title = String(form.get(`level_${level.id}`) || '').trim();
      if (!title || title === levelTitle(level)) continue;
      const { error } = await state.client.from('study_levels').update({ title }).eq('id', level.id);
      if (error) return toast(`تعذر تحديث اسم الفرقة: ${error.message}`, 'error');
    }
    await refreshRemote();
    renderAdmin();
    toast('تم حفظ أسماء الفرق.', 'success');
  }

  async function createLesson(event) {
    event.preventDefault();
    if (!state.client || !state.user || !['admin', 'teacher'].includes(state.role)) return toast('تحتاج إلى حساب معلّم أو مدير وقاعدة بيانات متصلة.', 'error');
    const form = new FormData(event.currentTarget);
    const levelId = form.get('level_id');
    const title = String(form.get('title')).trim();
    let subject = state.subjects.find(item => String(item.study_level_id) === String(levelId) && item.title.trim() === String(form.get('subject')).trim());
    if (!subject) {
      const inserted = await state.client.from('subjects').insert({ study_level_id: levelId, title: String(form.get('subject')).trim(), academic_year: String(form.get('academic_year') || '').trim() || null, semester: String(form.get('semester') || '').trim() || null }).select('id,study_level_id,title,academic_year,semester').single();
      if (inserted.error) return toast(`تعذر حفظ المادة: ${inserted.error.message}`, 'error');
      subject = inserted.data;
    }
    const result = await state.client.from('lessons').insert({ subject_id: subject.id, title, description: String(form.get('description') || '').trim() || null, content_type: form.get('content_type'), content_url: String(form.get('content_url') || '').trim() || null, term: subject.semester }).select('id').single();
    if (result.error) return toast(`تعذر نشر الدرس: ${result.error.message}`, 'error');
    toast('تم نشر الدرس.', 'success');
    event.currentTarget.reset();
    await refreshRemote();
    activateView('curriculum');
  }

  async function createAnnouncement(event) {
    event.preventDefault();
    if (!state.client || !state.user || state.role !== 'admin') return toast('إضافة الإعلانات تتطلب حساب مدير.', 'error');
    const form = new FormData(event.currentTarget);
    const { error } = await state.client.from('announcements').insert({ title: String(form.get('title')).trim(), body: String(form.get('body')).trim(), published: true });
    if (error) return toast(`تعذر نشر الإعلان: ${error.message}`, 'error');
    toast('تم نشر الإعلان.', 'success');
    event.currentTarget.reset();
    await refreshRemote();
  }

  async function createCategory(event) {
    event.preventDefault();
    if (!state.client || !state.user || state.role !== 'admin') return toast('إدارة التصنيفات تتطلب حساب مدير.', 'error');
    const form = new FormData(event.currentTarget);
    const { error } = await state.client.from('chant_categories').insert({ name: String(form.get('name')).trim(), sort_order: state.categories.length + 1 });
    if (error) return toast(`تعذر إضافة التصنيف: ${error.message}`, 'error');
    toast('تمت إضافة التصنيف.', 'success');
    event.currentTarget.reset();
    await refreshRemote();
  }

  async function updateCategory(event) {
    event.preventDefault();
    if (!state.client || !state.user || state.role !== 'admin') return toast('إدارة التصنيفات تتطلب حساب مدير.', 'error');
    const form = new FormData(event.currentTarget);
    const { error } = await state.client.from('chant_categories').update({ name: String(form.get('name')).trim() }).eq('id', event.currentTarget.dataset.categoryId);
    if (error) return toast(`تعذر تعديل التصنيف: ${error.message}`, 'error');
    await refreshRemote();
    renderAdmin();
    toast('تم تحديث التصنيف.', 'success');
  }

  async function createChant(event) {
    event.preventDefault();
    if (!state.client || !state.user || !['admin', 'teacher'].includes(state.role)) return toast('إضافة مكتبة الألحان تتطلب حساب معلّم أو مدير.', 'error');
    const form = new FormData(event.currentTarget);
    const { error } = await state.client.from('chants').insert({ category_id: form.get('category_id') || null, title: String(form.get('title')).trim(), description: String(form.get('description') || '').trim() || null, content_type: form.get('content_type'), content_url: String(form.get('content_url') || '').trim() || null, source: 'link' });
    if (error) return toast(`تعذرت إضافة المادة: ${error.message}`, 'error');
    event.currentTarget.reset();
    await refreshRemote();
    renderAdmin();
    toast('تمت إضافة المادة إلى المكتبة.', 'success');
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!state.client || !state.user || state.role !== 'admin') return toast('حفظ بيانات المعهد يتطلب حساب مدير.', 'error');
    const form = new FormData(event.currentTarget);
    const value = Object.fromEntries(['admission_text', 'contact_phone', 'contact_email', 'contact_address'].map(key => [key, String(form.get(key) || '').trim()]));
    const { error } = await state.client.from('platform_settings').upsert({ key: 'public', value, updated_by: state.user.id });
    if (error) return toast(`تعذر حفظ البيانات: ${error.message}`, 'error');
    state.settings = value;
    renderPublicSettings();
    toast('تم حفظ بيانات المعهد.', 'success');
  }

  async function signIn(event) {
    event.preventDefault();
    if (!state.client) return toast('تسجيل الدخول غير متاح حتى إعداد Supabase في config.js.', 'error');
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    $('#auth-submit').disabled = true;
    const { error } = await state.client.auth.signInWithPassword({ email, password });
    $('#auth-submit').disabled = false;
    if (error) { $('#auth-message').textContent = `تعذر تسجيل الدخول: ${error.message}`; return; }
    $('#auth-modal').close();
    toast('تم تسجيل الدخول.', 'success');
    await refreshRemote();
    renderResults();
    renderAdmin();
  }

  async function signOut() {
    if (state.client) await state.client.auth.signOut();
    state.user = null;
    state.role = null;
    localOwner = 'guest';
    state.local = loadLocal('guest');
    renderAll();
    renderAdmin();
    renderResults();
    toast('تم تسجيل الخروج.');
  }

  function showAuth() {
    $('#auth-message').textContent = hasBackend ? 'استخدم حساباً أنشأته إدارة المنصة.' : 'تسجيل الدخول غير مهيأ في هذه النسخة. لا تُرسل بيانات دخول هنا.';
    $('#auth-email').disabled = !hasBackend;
    $('#auth-password').disabled = !hasBackend;
    $('#auth-submit').disabled = !hasBackend;
    $('#auth-modal').showModal();
  }

  document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) return activateView(viewButton.dataset.view);
    const go = event.target.closest('[data-go]');
    if (go) return activateView(go.dataset.go);
    const level = event.target.closest('[data-level]');
    if (level) { state.selectedLevel = level.dataset.level; renderLevels(); renderCurriculum(); activateView('curriculum'); return; }
    const category = event.target.closest('[data-category]');
    if (category) { $('#chant-category-filter').value = category.dataset.category; renderChants(); return; }
    const lesson = event.target.closest('[data-lesson]');
    if (lesson) { if (lesson.closest('#global-search-results')) activateView('curriculum'); const found = state.lessons.find(item => String(item.id) === lesson.dataset.lesson); openLesson(found); renderCurriculum(); return; }
    const chant = event.target.closest('[data-chant]');
    if (chant) { if (chant.closest('#global-search-results')) activateView('chants'); openLesson(state.chants.find(item => String(item.id) === chant.dataset.chant), true); return; }
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'signin') return showAuth();
      if (action.dataset.action === 'signout') return signOut();
      if (action.dataset.action === 'favorite') { toggleLocal('favorites', action.dataset.id); openLesson([...state.lessons, ...state.chants].find(item => String(item.id) === action.dataset.id), state.chants.some(item => String(item.id) === action.dataset.id)); return; }
      if (action.dataset.action === 'complete') { toggleLocal('completed', action.dataset.id); openLesson(state.lessons.find(item => String(item.id) === action.dataset.id)); return; }
      if (action.dataset.action === 'offline') return cacheOffline(action.dataset.url);
    }
    const personal = event.target.closest('[data-personal]');
    if (personal?.dataset.personal === 'last' && state.local.lastLesson) {
      const last = [...state.lessons, ...state.chants].find(item => String(item.id) === String(state.local.lastLesson));
      openLesson(last, state.chants.some(item => String(item.id) === String(last?.id)));
      return;
    }
    if (personal?.dataset.personal === 'favorites') {
      const saved = [...state.lessons, ...state.chants].filter(item => state.local.favorites.includes(String(item.id)));
      if (!saved.length) return toast('لا توجد مواد محفوظة بعد.');
      openLesson(saved[0], state.chants.some(item => String(item.id) === String(saved[0].id)));
      return;
    }
    if (event.target.closest('#profile-button')) { if (state.user) activateView('admin'); else showAuth(); }
  });
  $('#curriculum-search').addEventListener('input', renderCurriculum);
  $('#global-search-form').addEventListener('submit', event => {
    event.preventDefault();
    const query = $('#global-search').value.trim().toLocaleLowerCase('ar');
    const host = $('#global-search-results');
    host.hidden = false;
    if (!query) { host.hidden = true; return; }
    const lessonMatches = state.lessons.filter(lesson => {
      const subject = state.subjects.find(item => String(item.id) === String(lesson.subject_id));
      return `${lesson.title} ${lesson.description || ''} ${subject?.title || ''}`.toLocaleLowerCase('ar').includes(query);
    });
    const chantMatches = state.chants.filter(chant => `${chant.title} ${chant.description || ''}`.toLocaleLowerCase('ar').includes(query));
    const hits = [
      ...lessonMatches.map(lesson => `<button class="lesson-row" data-lesson="${esc(lesson.id)}"><span class="lesson-kind">${lessonKind(lesson.content_type)}</span><span class="lesson-info"><strong>${esc(lesson.title)}</strong><small>منهج دراسي · ${esc(lessonTypeName(lesson.content_type))}</small></span></button>`),
      ...chantMatches.map(chant => `<button class="lesson-row" data-chant="${esc(chant.id)}"><span class="lesson-kind">${lessonKind(chant.content_type)}</span><span class="lesson-info"><strong>${esc(chant.title)}</strong><small>مكتبة الألحان · ${esc(lessonTypeName(chant.content_type))}</small></span></button>`)
    ];
    host.innerHTML = hits.length ? `<div class="panel-heading"><h2>نتائج البحث</h2><small>${hits.length} مواد</small></div><div class="lesson-list">${hits.join('')}</div>` : `<div class="empty-state compact"><span>⌕</span><strong>لا توجد مواد منشورة تطابق بحثك</strong><p>جرّب كلمات أخرى أو تأكد من تسجيل الدخول لعرض المحتوى الدراسي.</p></div>`;
  });
  $('#global-search').addEventListener('input', () => { if (!$('#global-search').value.trim()) $('#global-search-results').hidden = true; });
  $('#type-filter').addEventListener('change', renderCurriculum);
  $('#term-filter').addEventListener('change', renderCurriculum);
  $('#chant-search').addEventListener('input', renderChants);
  $('#chant-category-filter').addEventListener('change', renderChants);
  $('#auth-form').addEventListener('submit', signIn);
  $('#auth-modal').addEventListener('click', event => { if (event.target === $('#auth-modal')) $('#auth-modal').close(); });
  $('#lesson-modal').addEventListener('click', event => { if (event.target === $('#lesson-modal') || event.target.closest('[data-close="lesson-modal"]')) $('#lesson-modal').close(); });
  $('#menu-toggle').addEventListener('click', () => { const side = $('#sidebar'); side.classList.toggle('open'); $('#menu-toggle').setAttribute('aria-expanded', String(side.classList.contains('open'))); });
  $('#theme-toggle').addEventListener('click', () => {
    const dark = document.body.classList.toggle('is-dark');
    localStorage.setItem('didymus-theme', dark ? 'dark' : 'light');
    $('#theme-toggle').lastChild.textContent = dark ? 'الوضع النهاري' : 'الوضع الليلي';
  });
  $('#notifications-button').addEventListener('click', () => activateView('home'));
  $('#drive-status-button').addEventListener('click', () => {
    toast('استيراد Google Drive غير مفعّل بعد. يلزم إعداد خادم آمن والتحقق من صلاحيات الملفات.', 'error');
  });
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  window.addEventListener('focus', () => { if (state.client && navigator.onLine) refreshRemote(); });
  if (localStorage.getItem('didymus-theme') === 'dark') document.body.classList.add('is-dark');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('تعذر تسجيل service worker', error)));
  }

  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; $('#install-button').hidden = false;
  });
  $('#install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#install-button').hidden = true;
  });

  renderAll();
  if (state.client) {
    refreshRemote();
    state.client.auth.onAuthStateChange(() => setTimeout(refreshRemote, 0));
  }
})();
