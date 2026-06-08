/* конфігурація та константи системи */
window.API_URL = window.API_URL || 'https://caring-respect-production-c61c.up.railway.app/api';
let activeSemesterStartDate = null;

const CONFIG = {
    apiUrl: window.API_URL,
    rolesMap: {
        'admin': 'Адміністратор', 'administrator': 'Адміністратор', '1': 'Адміністратор',
        'teacher': 'Викладач', '2': 'Викладач',
        'student': 'Студент', '3': 'Студент'
    },
    weekDaysMapping: { 1: 'Понеділок', 2: 'Вівторок', 3: 'Середа', 4: 'Четвер', 5: 'П\'ятниця', 6: 'Субота' },
    lessonsMapping: {
        '1': { title: '1 пара', time: '08:30 – 09:50' },
        '2': { title: '2 пара', time: '10:00 – 11:20' },
        '3': { title: '3 пара', time: '11:30 – 12:50' },
        '4': { title: '4 пара', time: '13:10 – 14:30' }
    }
};

/* глобальний стан додатка */
const state = {
    get user() {
        try {
            return JSON.parse(localStorage.getItem('currentUser')) || 
                   JSON.parse(localStorage.getItem('user')) || 
                   JSON.parse(localStorage.getItem('userData')) || null;
        } catch (e) {
            console.error("Помилка парсингу користувача з localStorage", e);
            return null;
        }
    },
    get token() { return localStorage.getItem('token') || localStorage.getItem('authToken') || ''; },
    currentScheduleDate: new Date(),
    isEventsInitialized: false,
    isScheduleNavInitialized: false
};

window.dashboardLoaded = false;
const loadedSectionsCache = { dashboard: false, schedule: false, journal: false, students: false };

/* відстеження завантаження сторінки та авторизації */
document.addEventListener('DOMContentLoaded', () => {
    if (state.user) {
        window.initApp();
    } else {
        console.warn("⚠️ Увага: Користувач не авторизований у системі. Перенаправлення на сторінку входу...");
        if (!window.location.pathname.includes('login.html')) window.location.replace('login.html');
    }

    /* безпечний вихід з ізоляцією кліку */
    document.addEventListener('click', (e) => {
        const logoutBtn = e.target.closest('#btn-logout-system') || e.target.closest('.logout-link');
        if (logoutBtn) { e.preventDefault(); e.stopPropagation(); logout(); }
    });
});

/* повна ініціалізація модулів інтерфейсу */
window.initApp = async function() {
    console.log("🚀 Запуск ініціалізації компонентів додатка...");
    state.currentScheduleDate.setHours(0, 0, 0, 0);

    try { if (typeof refreshProfileUI === 'function') refreshProfileUI(); } catch(e) { console.error("Помилка профілю:", e); }
    try { if (typeof initPhoneValue === 'function') initPhoneValue(); } catch(e) { console.error("Помилка telefonu:", e); }
    try { if (typeof initProfileEvents === 'function') initProfileEvents(); } catch(e) { console.error("Помилка подій профілю:", e); }          
    try { if (typeof updateDateTime === 'function') updateDateTime(); } catch(e) { console.error("Помилка часу:", e); }
    try { if (typeof renderMiniSidebarCalendar === 'function') renderMiniSidebarCalendar(); } catch(e) { console.error("Помилка міні-календаря:", e); }
    try { if (typeof initScheduleNavigation === 'function') initScheduleNavigation(); } catch(e) { console.error("Помилка навігації розкладу:", e); }
    try { if (typeof initNavigationMenuLinks === 'function') initNavigationMenuLinks(); } catch(e) { console.error("Помилка ініціалізації меню:", e); }

    if (state.user) await loadInitialData();
    try { if (typeof showSection === 'function') showSection('dashboard-sec', true); } catch(e) { console.error("Помилка стартової секції:", e); }
};

/* екранування символів для захисту від xss */
function escapeHtml(str) {
    if (!str) return '—';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

/* нормалізація імені користувача */
function formatUserName(u) {
    if (!u) return '—';
    return `${u.last_name || ''} ${u.first_name || ''}`.trim() || u.name || "Користувач системи";
}

/* отримання ключа ролі */
function getUserRoleKey() {
    if (!state.user) return 'guest';
    const r = String(state.user.role || state.user.role_id || '').toLowerCase().trim();
    if (r === 'admin' || r === 'administrator' || r === '1') return 'admin';
    if (r === 'teacher' || r === '2') return 'teacher';
    if (r === 'student' || r === '3') return 'student';
    return 'guest';
}

/* локалізація ролі користувача */
function translateRole(role) {
    if (!role) return 'Гість';
    return CONFIG.rolesMap[String(role).toLowerCase().trim()] || role;
}

if (typeof activeSemesterStartDate === 'undefined') window.activeSemesterStartDate = null;

/* робота з внутрішніми датами календаря розкладу */
function getTargetScheduleDate() {
    if (typeof window.currentScheduleDate !== 'undefined' && window.currentScheduleDate instanceof Date) return window.currentScheduleDate;
    if (typeof state !== 'undefined' && state.currentScheduleDate instanceof Date) return state.currentScheduleDate;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    window.currentScheduleDate = d;
    if (typeof state !== 'undefined') state.currentScheduleDate = d;
    return d;
}

function setTargetScheduleDate(newDate) {
    newDate.setHours(0, 0, 0, 0);
    window.currentScheduleDate = newDate;
    if (typeof state !== 'undefined') state.currentScheduleDate = newDate;
}

/* отримання налаштувань семестру з бд або резервного конфігу */
async function loadSemestersConfig() {
    try {
        const token = typeof getAuthToken === 'function' ? getAuthToken() : (window.state?.token || null);
        if (!token) { console.warn("⚠️ Токен відсутній. Запит скасовано."); fallbackSemesterInit(); return; }

        const isAdmin = window.location.pathname.includes('admin') || (window.state?.user?.role_id === 1);
        const endpoint = isAdmin ? `${CONFIG.apiUrl}/admin/semesters` : `${CONFIG.apiUrl}/semesters/active`;
        const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        
        const data = await res.json();
        const activeSemester = Array.isArray(data) ? data.find(s => s.is_active === true || s.is_active === 'true' || parseInt(s.is_active, 10) === 1) : data;

        if (activeSemester && activeSemester.start_date) {
            const parsedDate = new Date(activeSemester.start_date); parsedDate.setHours(0, 0, 0, 0);
            window.activeSemesterStartDate = parsedDate; window.activeSemesterId = activeSemester.id; 
            console.log(`🎯 Період синхронізовано: ${activeSemester.name}. Старт: ${activeSemester.start_date}`);
            updateSemesterLabels(activeSemester.name);
        } else {
            console.warn("⚠️ Активний семестр не знайдено, увімкнено резерв."); fallbackSemesterInit();
        }
    } catch (e) {
        console.error("❌ Не вдалося синхронізувати календар з БД:", e); fallbackSemesterInit();
    } finally {
        if (typeof updateScheduleBadges === 'function') updateScheduleBadges();
    }
}

function fallbackSemesterInit() { window.activeSemesterStartDate = getSemesterStart(); updateSemesterLabels("Основний період"); }
function updateSemesterLabels(name) { const lbl = document.getElementById('current-semester-label') || document.getElementById('period-display'); if (lbl) lbl.innerText = name; }

function getSemesterStart(currentDate = new Date()) {
    if (window.activeSemesterStartDate) return new Date(window.activeSemesterStartDate.getTime());
    const year = currentDate.getFullYear(), month = currentDate.getMonth();
    let backup = (month >= 1 && month <= 6) ? new Date(year, 1, 2) : new Date(year, 8, 1);
    backup.setHours(0, 0, 0, 0); return backup;
}

/* розрахунок меж поточного тижня */
function getWeekRange(date) {
    const targetDate = date ? new Date(date.getTime()) : getTargetScheduleDate();
    const day = targetDate.getDay(), dayFixed = day === 0 ? 7 : day; 
    const monday = new Date(targetDate); monday.setDate(targetDate.getDate() - dayFixed + 1); monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 999);
    return { monday, sunday };
}

/* визначення типу тижня чисельник або знаменник */
function getWeekType(date) {
    const targetDate = date ? new Date(date.getTime()) : getTargetScheduleDate();
    const semesterStart = getSemesterStart(targetDate); 
    const startRange = getWeekRange(semesterStart), targetRange = getWeekRange(targetDate);
    if (targetRange.monday < startRange.monday) return { code: 'numerator', text: 'Чисельник (Верхній)' };
    const diffWeeks = Math.round((targetRange.monday.getTime() - startRange.monday.getTime()) / (1000 * 60 * 60 * 24 * 7));
    return ((diffWeeks + 1) % 2 !== 0) ? { code: 'numerator', text: 'Чисельник (Верхній)' } : { code: 'denominator', text: 'Знаменник (Нижній)' };
}

/* керування стрілками перемикання тижнів розкладу */
function initScheduleNavigation() {
    const ctx = (typeof state !== 'undefined') ? state : window;
    if (ctx.isScheduleNavInitialized) return; 
    const btnPrev = document.getElementById('btn-prev-week'), btnToday = document.getElementById('btn-today-week'), btnNext = document.getElementById('btn-next-week');
    if (!btnPrev || !btnToday || !btnNext) return;

    btnPrev.addEventListener('click', () => { const d = getTargetScheduleDate(); d.setDate(d.getDate() - 7); setTargetScheduleDate(d); triggerScheduleReload(); });
    btnToday.addEventListener('click', () => { setTargetScheduleDate(new Date()); triggerScheduleReload(); });
    btnNext.addEventListener('click', () => { const d = getTargetScheduleDate(); d.setDate(d.getDate() + 7); setTargetScheduleDate(d); triggerScheduleReload(); });
    ctx.isScheduleNavInitialized = true;
}

/* очищення контейнера та перезапуск завантаження розкладу під роль */
async function triggerScheduleReload() {
    const container = document.getElementById('student-schedule-container') || document.getElementById('teacher-schedule-container') || document.getElementById('schedule-container');
    if (container) {
        container.innerHTML = `
            <div class="schedule-perfect-grid" style="justify-content: center; padding: 40px;">
                <p class="table-empty-state" style="font-weight: 600; color: #64748b;">
                    <i class="fa-solid fa-circle-notch fa-spin" style="color: #4f46e5; margin-right: 8px;"></i> Оновлюємо розклад занять...
                </p>
            </div>`;
    }
    updateScheduleBadges();
    const role = typeof getUserRoleKey === 'function' ? getUserRoleKey() : null, workingDate = getTargetScheduleDate();

    if (role === 'student' && typeof window.loadScheduleData === 'function') await window.loadScheduleData(workingDate);
    else if (role === 'teacher' && typeof window.loadTeacherSchedule === 'function') await window.loadTeacherSchedule(workingDate);
    else if (typeof syncWeekAndLoad === 'function') await syncWeekAndLoad();
    else console.warn("⚠️ Метод оновлення даних розкладу не знайдено.");

    if (typeof loadedSectionsCache !== 'undefined') loadedSectionsCache.schedule = true;
}

/* оновлення текстових плашок періоду та типу тижня */
function updateScheduleBadges() {
    const rangeEl = document.getElementById('schedule-week-range'), badgeEl = document.getElementById('week-type-badge');
    const workingDate = getTargetScheduleDate(), currentRange = getWeekRange(workingDate), currentWeekInfo = getWeekType(workingDate);

    if (rangeEl) {
        rangeEl.innerText = `Тиждень: ${currentRange.monday.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} — ${currentRange.sunday.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} ${currentRange.sunday.getFullYear()} р.`;
    }
    if (badgeEl) {
        const textSpan = badgeEl.querySelector('.badge-text');
        if (textSpan) textSpan.innerText = currentWeekInfo.text; else badgeEl.innerText = currentWeekInfo.text;
        badgeEl.className = 'week-badge-new';
        const lowerText = currentWeekInfo.text.toLowerCase();
        if (lowerText.includes('чисельник')) badgeEl.classList.add('week-numerator');
        if (lowerText.includes('знаменник')) badgeEl.classList.add('week-denominator');
    }
}

/* автоматична зміна списків у модальному вікні адміна */
function rebuildGroupContextDropdowns() {
    const groupId = parseInt(document.getElementById('modal-sch-group')?.value, 10);
    const mSubj = document.getElementById('modal-sch-subject'), mTeach = document.getElementById('modal-sch-teacher');
    if (!groupId || !mSubj || !mTeach) return;

    mSubj.innerHTML = (window.dbSubjects || []).map(s => `<option value="${s.id}">${escapeHtml(s.name || s.title)}</option>`).join('');
    mTeach.innerHTML = (window.dbTeachers || []).map(t => `<option value="${t.id}">${escapeHtml(`${t.last_name || ''} ${t.first_name || ''}`.trim())}</option>`).join('');
    filterTeacherBySelectedSubject();
}

/* фільтрація викладачів за обраним предметом */
function filterTeacherBySelectedSubject() {
    if (isSyncingDropdowns) return;
    const groupId = parseInt(document.getElementById('modal-sch-group')?.value, 10);
    const subjectId = parseInt(document.getElementById('modal-sch-subject')?.value, 10);
    const mTeach = document.getElementById('modal-sch-teacher');
    if (!groupId || !subjectId || !mTeach) return;

    const match = (window.cachedLessons || []).find(l => l.group_id === groupId && l.subject_id === subjectId);
    if (match && match.teacher_id) { isSyncingDropdowns = true; mTeach.value = match.teacher_id; isSyncingDropdowns = false; }
}

/* фільтрація предметів за обраним викладачем */
function filterSubjectBySelectedTeacher() {
    if (isSyncingDropdowns) return;
    const groupId = parseInt(document.getElementById('modal-sch-group')?.value, 10);
    const teacherId = parseInt(document.getElementById('modal-sch-teacher')?.value, 10);
    const mSubj = document.getElementById('modal-sch-subject');
    if (!groupId || !teacherId || !mSubj) return;

    const match = (window.cachedLessons || []).find(l => l.group_id === groupId && l.teacher_id === teacherId);
    if (match && match.subject_id) { isSyncingDropdowns = true; mSubj.value = match.subject_id; isSyncingDropdowns = false; }
}

/* ініціалізація слухачів подій та елементів керування після завантаження сторінки */
document.addEventListener("DOMContentLoaded", async () => {
    const adminDateInput = document.getElementById('schedule-admin-date');
    if (adminDateInput) {
        if (!adminDateInput.value) adminDateInput.valueAsDate = new Date();
        setTargetScheduleDate(new Date(adminDateInput.value));
        adminDateInput.onchange = (e) => {
            if (e.target.value) { setTargetScheduleDate(new Date(e.target.value)); if (typeof syncWeekAndLoad === 'function') syncWeekAndLoad(); }
        };
    }

    if (typeof loadSemestersConfig === 'function') await loadSemestersConfig(); else console.warn("loadSemestersConfig відсутня.");
    if (typeof loadInitialDataFromDB === 'function') await loadInitialDataFromDB(); else console.error("loadInitialDataFromDB не знайдена в JS файлах!");
    if (typeof syncWeekAndLoad === 'function') syncWeekAndLoad();

    const schedForm = document.getElementById('matrix-schedule-form');
    if (schedForm) schedForm.onsubmit = saveScheduleFromModal;

    const assignClick = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    assignClick('close-matrix-modal-btn', closeMatrixScheduleModal);
    assignClick('cancel-matrix-modal-btn', closeMatrixScheduleModal);
    assignClick('close-matrix-delete-btn', closeMatrixDeleteModal);
    assignClick('cancel-matrix-delete-btn', closeMatrixDeleteModal);
    assignClick('execute-matrix-delete-btn', executeDeleteMatrixLesson);
    assignClick('matrix-reset-btn', resetMatrixFilters);

    const streamCheckbox = document.getElementById('modal-sch-is-stream');
    if (streamCheckbox) {
        streamCheckbox.onchange = () => streamCheckbox.checked ? (typeof clearModalError === 'function' && clearModalError()) : (typeof checkFormConflicts === 'function' && checkFormConflicts());
    }

    if (typeof setupModalErrorContainer === 'function') setupModalErrorContainer();

    const mGroup = document.getElementById('modal-sch-group'), mSubject = document.getElementById('modal-sch-subject'), mTeacher = document.getElementById('modal-sch-teacher');
    if (mGroup) mGroup.onchange = () => { rebuildGroupContextDropdowns(); if (typeof checkFormConflicts === 'function') checkFormConflicts(); };
    if (mSubject) mSubject.onchange = () => { filterTeacherBySelectedSubject(); if (typeof checkFormConflicts === 'function') checkFormConflicts(); };
    if (mTeacher) mTeacher.onchange = () => { filterSubjectBySelectedTeacher(); if (typeof checkFormConflicts === 'function') checkFormConflicts(); };

    ['matrix-dept-filter', 'matrix-course-filter', 'matrix-group-filter'].forEach(id => {
        const el = document.getElementById(id); if (el) el.onchange = typeof onAnalyticsFilterChange === 'function' ? onAnalyticsFilterChange : null;
    });

    ['modal-sch-day', 'modal-sch-pair-number', 'modal-sch-week-type', 'modal-sch-room'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.onchange = typeof checkFormConflicts === 'function' ? checkFormConflicts : null;
            if (id === 'modal-sch-room') el.oninput = typeof checkFormConflicts === 'function' ? checkFormConflicts : null;
        }
    });
    
    initScheduleNavigation();
});

/* відображення інформації користувача в шапці та профілі сайдбару */
function refreshProfileUI() {
    const u = state.user; if (!u) return;
    const roleKey = getUserRoleKey(), fullName = formatUserName(u), rawRoleText = translateRole(u.role || u.role_id);
    
    let roleText = `Кабінет ${rawRoleText.toLowerCase()}`;
    if (roleKey === 'admin') roleText = `Кабінет адміністратора`;
    else if (roleKey === 'teacher') roleText = `Кабінет викладача`;
    else if (roleKey === 'student') roleText = `Кабінет студента`;

    let groupText = '—';
    if (roleKey === 'admin') groupText = 'Повний доступ';
    else if (roleKey === 'teacher') groupText = u.department_name || u.department_short || 'Кафедра викладачів';
    else groupText = u.group_name ? `Група: ${u.group_name}` : 'Група: —';

    const nameEl = document.getElementById('user-name'), roleEl = document.getElementById('student-cabinet-title') || document.getElementById('cabinet-title'), groupEl = document.getElementById('user-group');
    if (nameEl) nameEl.textContent = fullName;
    if (roleEl) roleEl.textContent = roleText;
    if (groupEl) groupEl.textContent = groupText;

    const editName = document.getElementById('edit-profile-name'), editEmail = document.getElementById('edit-profile-email');
    if (editName) editName.value = fullName; if (editEmail) editEmail.value = u.email || '';
}

/* оновлення текстового віджета дати */
function updateDateTime() {
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        dateEl.innerHTML = `<i class="fa-regular fa-calendar"></i> ` + new Date().toLocaleDateString('uk-UA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
}

/* перемикання активних секцій та ліниве завантаження даних */
function showSection(sectionId, isFirstInit = false) {
    const allSections = document.querySelectorAll('.content-section'), target = document.getElementById(sectionId);
    if (!target) return;
    const role = getUserRoleKey();

    const activateTarget = () => {
        allSections.forEach(s => { s.classList.remove('section-active', 'active-section'); s.style.display = 'none'; s.style.opacity = ''; s.style.transform = ''; });
        target.style.display = 'block'; setTimeout(() => { target.classList.add('section-active', 'active-section'); }, 25);

        if (sectionId === 'dashboard-sec' && window.charts) {
            if (window.charts.line?.ctx) window.charts.line.resize();
            if (window.charts.pie?.ctx) window.charts.pie.resize();
            if (window.charts.bar?.ctx) window.charts.bar.resize();
            if (window.charts.doughnut?.ctx) window.charts.doughnut.resize();
        }
    };

    if (isFirstInit) activateTarget(); else {
        allSections.forEach(s => { if (s.classList.contains('section-active') || s.style.display === 'block') { s.style.opacity = '0'; s.style.transform = 'scale(0.99) translateY(-8px)'; } });
        setTimeout(activateTarget, 180);
    }

    document.querySelectorAll('.nav-item, .nav-link, .sidebar-link').forEach(i => i.classList.remove('active', 'navigation-active'));
    const map = { 'dashboard-sec': 'btn-dashboard', 'journal-sec': 'btn-grades', 'students-sec': 'btn-students', 'schedule-sec': 'btn-schedule', 'settings-sec': 'btn-settings' };
    const btnId = map[sectionId], activeBtn = document.getElementById(btnId);

    if (activeBtn) {
        activeBtn.classList.add('active', 'navigation-active');
        const parentLi = activeBtn.closest('.nav-item'); if (parentLi) parentLi.classList.add('active', 'navigation-active');
        const titleEl = document.getElementById('main-title'), span = activeBtn.querySelector('span');
        if (titleEl && span) titleEl.innerText = span.innerText;
    }

    if (role === 'student') {
        if (sectionId === 'schedule-sec' && !loadedSectionsCache.schedule) {
            if (typeof window.loadScheduleData === 'function') window.loadScheduleData(state.currentScheduleDate);
            loadedSectionsCache.schedule = true;
        }
    } else {
        if (sectionId === 'dashboard-sec' && !window.dashboardLoaded) loadInitialData();
        else if (sectionId === 'schedule-sec' && role === 'teacher' && !loadedSectionsCache.schedule) {
            if (typeof window.loadTeacherSchedule === 'function') window.loadTeacherSchedule(state.currentScheduleDate);
            loadedSectionsCache.schedule = true;
        } else if (role === 'teacher') {
            if (sectionId === 'journal-sec' && !loadedSectionsCache.journal && typeof initJournalSection === 'function') { initJournalSection(); loadedSectionsCache.journal = true; }
            else if (sectionId === 'students-sec' && !loadedSectionsCache.students && typeof initStudentsSection === 'function') { initStudentsSection(); loadedSectionsCache.students = true; }
        }
    }
}

/* активація посилань головного меню навігації */
async function initNavigationMenuLinks() {
    document.querySelectorAll('[data-target], [data-section]').forEach(link => {
        if (link.dataset.listenerActive) return;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = link.getAttribute('data-target') || link.getAttribute('data-section');
            if (sectionId) showSection(sectionId);
        });
        link.dataset.listenerActive = "true";
    });
}

/* завантаження первинних даних залежно від ролі користувача */
async function loadInitialData() {
    try {
        updateScheduleBadges();
        const role = getUserRoleKey();
        console.log(`🔑 Синхронізація даних для ролі: ${role}`);

        if (window.dashboardLoaded) {
            console.log("ℹ️ Первинні дані системи вже ініціалізовано.");
            return;
        }

        switch (role) {
            case 'admin':
                if (typeof window.initAdminDashboard === 'function') {
                    await window.initAdminDashboard();
                } else {
                    if (typeof window.loadDashboardCounters === 'function') await window.loadDashboardCounters();
                    if (typeof window.loadUsersTable === 'function') window.loadUsersTable();
                }
                break;
                
            case 'teacher':
                if (typeof window.initTeacherModule === 'function') {
                    await window.initTeacherModule(state.user);
                } else if (typeof window.initTeacherDashboard === 'function') {
                    await window.initTeacherDashboard();
                }
                break;
                
            case 'student':
                if (typeof window.initStudentModule === 'function') {
                    await window.initStudentModule(state.user, state.currentScheduleDate);
                } else if (typeof window.initStudentDashboard === 'function') {
                    await window.initStudentDashboard();
                }
                loadedSectionsCache.dashboard = true;
                break;
                
            default:
                console.warn("⚠️ Невідома роль або гість. Початкові дані не завантажено.");
                return; 
        }

        window.dashboardLoaded = true;

    } catch (err) {
        console.error("❌ Помилка ініціалізації даних системи:", err);
        
        const nameEl = document.getElementById('user-name');
        const hasDataRendered = nameEl && nameEl.textContent !== '—' && nameEl.textContent !== '';

        if (!hasDataRendered) {
            showToast("Помилка завантаження даних профілю", "error");
        } else {
            console.warn("⚠️ Мікро-помилка в UI після успішного завантаження профілю. Сповіщення приховано.");
        }
    }
}

/* відображення кастомних спливаючих сповіщень */
function showToast(message, type = 'success') {
    let container = document.getElementById('global-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'global-toast-container';
        container.className = 'global-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `modern-toast toast-${type}`;
    
    let icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-xmark';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}" style="font-size: 16px;"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3500);
}

/* перехоплення стандартного системного alert та заміна на toast */
window.alert = function(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'warning');
    } else {
        console.warn("Перехоплено alert: " + message);
    }
    return true;
};

/* візуальне підсвічування помилки введення в інпуті */
function highlightInputError(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.style.borderColor = '#ef4444';
    el.style.boxShadow = '0 0 0 4px rgba(239, 68, 68, 0.12)';
    el.style.animation = 'inputErrorShake 0.3s ease-in-out';
    el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

/* очищення візуальних стилів помилки з інпута */
function clearInputError(el) {
    if (!el) return;
    el.style.borderColor = '';
    el.style.boxShadow = '';
}

/* ініціалізація та форматування початкового значення телефону */
function initPhoneValue() {
    const phoneInput = document.getElementById('edit-profile-phone');
    if (!phoneInput) return;
    const currentUser = state.user;
    const dbPhone = currentUser && currentUser.phone ? String(currentUser.phone).trim() : '';
    if (dbPhone && dbPhone.length >= 9) {
        const digitsOnly = dbPhone.replace(/\D/g, '');
        phoneInput.value = '+380' + digitsOnly.substring(digitsOnly.length - 9);
    } else { phoneInput.value = '+380'; }
}

/* прив\'язка подій до елементів редагування профілю та пароля */
function initProfileEvents() {
    if (state.isEventsInitialized) return; 
    const phoneInput = document.getElementById('edit-profile-phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', handlePhoneInputLogic);
        phoneInput.addEventListener('keydown', handlePhoneKeydownLogic);
        phoneInput.addEventListener('click', protectPhoneCursor);
        phoneInput.addEventListener('focus', (e) => { protectPhoneCursor(e); clearInputError(e.target); });
    }
    
    ['old-password', 'new-password', 'confirm-password'].forEach(id => {
        document.getElementById(id)?.addEventListener('focus', (e) => clearInputError(e.target));
    });

    const profileForm = document.getElementById('form-update-profile');
    if (profileForm) profileForm.addEventListener('submit', handleProfileUpdate);
    const passwordForm = document.getElementById('form-change-password');
    if (passwordForm) passwordForm.addEventListener('submit', handlePasswordChange);
    state.isEventsInitialized = true;
}

/* заборона видалення коду країни у полі телефону */
function handlePhoneKeydownLogic(e) {
    const input = e.target;
    if (e.key === 'Backspace' && input.selectionStart <= 4 && input.selectionEnd === input.selectionStart) e.preventDefault();
    if (e.key === 'Delete' && input.selectionStart < 4) e.preventDefault();
}

/* фіксація курсору після коду країни */
function protectPhoneCursor(e) {
    const input = e.target;
    if (input.selectionStart < 4) input.setSelectionRange(4, 4);
}

/* маска та правила введення для телефонного номера */
function handlePhoneInputLogic(e) {
    const input = e.target; let val = input.value;
    if (!val.startsWith('+380')) {
        const cleanDigits = val.replace(/\D/g, '');
        if (cleanDigits.startsWith('380')) val = '+380' + cleanDigits.substring(3, 12);
        else val = '+380' + cleanDigits.substring(0, 9);
    } else { const body = val.substring(4).replace(/\D/g, '').substring(0, 9); val = '+380' + body; }
    input.value = val;
}

/* збереження оновлених даних профілю користувача */
async function handleProfileUpdate(e) {
    e.preventDefault(); 
    
    const userRaw = localStorage.getItem('currentUser') || localStorage.getItem('user') || localStorage.getItem('userData');
    if (!userRaw) { 
        showToast("Користувача не знайдено у системі!", "error"); 
        return; 
    }
    
    let parsedUser = JSON.parse(userRaw);
    const phoneInput = document.getElementById('edit-profile-phone'); 
    let finalPhoneValue = null;
    
    if (phoneInput && phoneInput.value.trim() !== '+380') {
        const rawDigits = phoneInput.value.replace(/\D/g, ''); 
        if (rawDigits.length !== 12) { 
            highlightInputError('edit-profile-phone');
            showToast("Некоректний формат телефону!", "warning"); 
            return; 
        }
        finalPhoneValue = '+' + rawDigits; 
    }
    
    try {
        const response = await fetch(`${CONFIG.apiUrl}/users/${parsedUser.id}/profile`, {
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
            body: JSON.stringify({ phone: finalPhoneValue })
        });
        
        if (response.ok) {
            parsedUser.phone = finalPhoneValue || '';
            const storageKey = localStorage.getItem('currentUser') ? 'currentUser' : (localStorage.getItem('user') ? 'user' : 'userData');
            localStorage.setItem(storageKey, JSON.stringify(parsedUser));
            
            const uiPhoneDisplay = document.getElementById('profile-phone-display') || document.querySelector('.user-phone-text');
            if (uiPhoneDisplay) uiPhoneDisplay.textContent = finalPhoneValue || 'Не вказано';
            
            if (typeof refreshProfileUI === 'function') refreshProfileUI(); 
            showToast('Профіль успішно оновлено!', 'success');
        } else { 
            showToast('Помилка збереження даних на сервері.', 'error'); 
        }
    } catch (error) { 
        showToast("Помилка зв'язку з сервером.", "error"); 
    }
}

/* відправка запиту на зміну пароля користувача з валідацією */
async function handlePasswordChange(e) {
    e.preventDefault(); 
    const oldPassEl = document.getElementById('old-password'); 
    const newPassEl = document.getElementById('new-password');
    const confPassEl = document.getElementById('confirm-password'); 
    
    if (!oldPassEl || !newPassEl || !confPassEl) return;
    
    const oldPass = oldPassEl.value.trim(); 
    const newPass = newPassEl.value.trim(); 
    const confPass = confPassEl.value.trim();
    
    if (!oldPass || !newPass || !confPass) { 
        if (!oldPass) highlightInputError('old-password');
        if (!newPass) highlightInputError('new-password');
        if (!confPass) highlightInputError('confirm-password');
        showToast("Заповніть усі обов'язкові поля!", "warning"); 
        return; 
    }
    
    if (newPass !== confPass) { 
        highlightInputError('new-password');
        highlightInputError('confirm-password');
        showToast("Нові паролі не збігаються!", "warning"); 
        return; 
    }
    
    try {
        const response = await fetch(`${CONFIG.apiUrl}/users/${state.user.id}/change-password`, {
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${state.token}` 
            },
            body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
        });

        if (response.ok) {
            showToast('Пароль успішно змінено!', 'success');
            document.getElementById('form-change-password')?.reset();
        } else {
            try {
                const errorData = await response.json();
                if (errorData && (errorData.message || errorData.error)) {
                    const serverMessage = errorData.message || errorData.error;
                    const msgLower = serverMessage.toLowerCase();
                    
                    if (msgLower.includes('поточний') || msgLower.includes('старий') || msgLower.includes('old') || msgLower.includes('current') || response.status === 401) {
                        highlightInputError('old-password');
                    } 
                    else if (msgLower.includes('length') || msgLower.includes('short') || msgLower.includes('довжин') || msgLower.includes('new')) {
                        highlightInputError('new-password');
                        highlightInputError('confirm-password');
                    } 
                    else {
                        highlightInputError('old-password');
                    }
                    
                    showToast(serverMessage, "error");
                    return;
                }
            } catch (e) {}

            highlightInputError('old-password');
            showToast("Неправильний поточний пароль або помилка сервера", "error");
        }
    } catch (error) {
        showToast("Помилка зв'язку з сервером.", "error");
    }
}

/* рендеринг мініатюрного календаря для бокової панелі */
function renderMiniSidebarCalendar() {
    const container = document.getElementById('mini-calendar-days'); const monthHeader = document.getElementById('mini-cal-month');
    if (!container || !monthHeader) return; const now = new Date(); const currentYear = now.getFullYear(); const currentMonth = now.getMonth(); const todayDate = now.getDate();
    let monthStr = now.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }); monthHeader.textContent = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate(); const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
    let cellsHtml = ''; for (let i = 0; i < startOffset; i++) { cellsHtml += `<div class="mini-cal-day" style="opacity: 0; pointer-events: none;"></div>`; }
    for (let day = 1; day <= totalDays; day++) { cellsHtml += `<div class="mini-cal-day ${day === todayDate ? 'today' : ''}">${day}</div>`; }
    container.innerHTML = cellsHtml;
}

/* експорт робочої області звітів в документ pdf */
function exportToPDF() {
    if (typeof html2pdf === 'undefined') { 
        alert("Помилка: Бібліотеку html2pdf не знайдено.");
        return; 
    }

    const element = document.getElementById('main-report-area');
    
    if (!element) {
        alert("Контейнер #main-report-area не знайдено!");
        return;
    }

    /* створення тимчасових стилів для оптимізації pdf-верстки */
    const styleOverride = document.createElement('style');
    styleOverride.id = 'pdf-runtime-styles';
    styleOverride.innerHTML = `
        .global-report-toolbar {
            display: none !important;
        }
        
        .card, 
        .chart-container, 
        #main-report-area > div,
        .grid > div,
        [style*="background"] {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            -webkit-column-break-inside: avoid !important;
        }

        #main-report-area {
            background: #ffffff !important;
            padding: 20px !important;
            box-sizing: border-box !important;
        }
    `;
    document.head.appendChild(styleOverride);

    /* конфігурація генератора файлів pdf */
    const opt = { 
        margin: [10, 10, 10, 10], 
        filename: `Головна_аналітика_${new Date().toISOString().slice(0,10)}.pdf`, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { 
            scale: 2,               
            useCORS: true, 
            logging: false,
            letterRendering: true,
            scrollX: 0,
            scrollY: 0,
            windowWidth: element.clientWidth 
        }, 
        pagebreak: { mode: ['css', 'avoid-all'] },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } 
    };

    /* запуск рендерингу та видалення службових стилів після завершення */
    html2pdf().set(opt).from(element).save().then(() => {
        document.getElementById('pdf-runtime-styles')?.remove();
    }).catch(err => {
        console.error("Помилка генерації PDF:", err);
        document.getElementById('pdf-runtime-styles')?.remove();
    });
}

/* створення та запуск захищеного вікна підтвердження виходу */
function logout() {
    if (document.getElementById('logout-modal')) return;

    const modalHtml = `
    <div id="logout-modal" style="position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(15, 23, 42, 0.75) !important; backdrop-filter: blur(5px) !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 9999999 !important;">
        <div class="custom-modal-card" style="background: #1e293b !important; padding: 32px !important; border-radius: 16px !important; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important; max-width: 400px !important; width: 90% !important; text-align: center !important; position: relative !important; z-index: 10000000 !important; border: 1px solid #334155 !important; animation: modalFadeIn 0.25s ease-out;">
            <div class="custom-modal-icon" style="width: 56px !important; height: 56px !important; background: rgba(239, 68, 68, 0.15) !important; color: #f87171 !important; border-radius: 50% !important; display: flex !important; align-items: center !important; justify-content: center !important; margin: 0 auto 16px !important; font-size: 24px !important;">
                <i class="fa-solid fa-right-from-bracket"></i>
            </div>
            <h3 style="font-size: 20px !important; font-weight: 700 !important; color: #f8fafc !important; margin-bottom: 8px !important; font-family: sans-serif !important;">Вийти</h3>
            <p style="font-size: 14px !important; color: #94a3b8 !important; margin-bottom: 24px !important; line-height: 1.5 !important; font-family: sans-serif !important;">Ви дійсно бажаєте вийти з системи?</p>
            <div class="custom-modal-buttons" style="display: flex !important; gap: 12px !important; justify-content: center !important;">
                <button id="modal-cancel-btn" type="button" style="padding: 10px 20px !important; border-radius: 8px !important; font-size: 14px !important; font-weight: 600 !important; cursor: pointer !important; background: #334155 !important; border: 1px solid #475569 !important; color: #cbd5e1 !important; transition: all 0.2s !important;">Скасувати</button>
                <button id="modal-confirm-btn" type="button" style="padding: 10px 20px !important; border-radius: 8px !important; font-size: 14px !important; font-weight: 600 !important; cursor: pointer !important; background: #ef4444 !important; border: none !important; color: #ffffff !important; transition: all 0.2s !important;">Вийти</button>
            </div>
        </div>
    </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = document.getElementById('logout-modal');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const confirmBtn = document.getElementById('modal-confirm-btn');

    if (cancelBtn) {
        cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#475569');
        cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = '#334155');
    }
    if (confirmBtn) {
        confirmBtn.addEventListener('mouseenter', () => confirmBtn.style.background = '#dc2626');
        confirmBtn.addEventListener('mouseleave', () => confirmBtn.style.background = '#ef4444');
    }

    modalEl.querySelector('.custom-modal-card')?.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    cancelBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modalEl.remove();
    });

    confirmBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('login.html');
    });

    modalEl.addEventListener('click', (e) => {
        e.preventDefault();
        modalEl.remove();
    });
}

/* експорт у глобальну область видимості */
window.state = state;
window.CONFIG = CONFIG;
window.logout = logout;
window.exportToPDF = exportToPDF;
window.showSection = showSection;
window.getUserRoleKey = getUserRoleKey;
window.triggerScheduleReload = triggerScheduleReload;
