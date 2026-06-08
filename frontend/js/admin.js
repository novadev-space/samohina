window.API_URL = window.API_URL || 'https://caring-respect-production-c61c.up.railway.app/api';
if (typeof window.charts === 'undefined') {
    window.charts = {
        globalGpa: null,
        attendancePie: null,
        activityLoad: null, 
        specialties: null,
        groupTrends: null
    };
}

// глобальні стани адміна
window.currentScheduleDate = new Date();
window.attendancePeriod = 'semester'; 
window.globalGroups = []; 
window.cachedLessons = []; 

// локальний кеш та змінні стану
let localUsersCache = [];
let userIdToDelete = null;
let loadedAssignments = [];
let globalDepartments = []; 
let pendingDeleteId = null;
let deleteTargetId = null;
let activeMatrixType = 'assignments'; 
let rawMatrixData = []; 
let isSavingSchedule = false;
let currentMatrixCategory = '';
let dbSubjects = [];
let dbTeachers = [];
let currentMatrixData = [];
let originalGroupSubjects = []; 
let currentEditAssignmentId = null;

// базова адреса апі
const API_BASE_URL = (typeof CONFIG !== 'undefined' && CONFIG.apiUrl) ? CONFIG.apiUrl.replace(/\/$/, '') : '/api/admin'; 

// довідник робочих днів
const standardWeekdays = [
    { id: 1, name: "Понеділок" },
    { id: 2, name: "Вівторок" },
    { id: 3, name: "Середа" },
    { id: 4, name: "Четвер" },
    { id: 5, name: "П'ятниця" }
];

// слухач завантаження сторінки
document.addEventListener("DOMContentLoaded", async () => {
    if (typeof initAssignmentsModule === 'function') initAssignmentsModule();
    if (typeof initModalSystem === 'function') initModalSystem();
    
    // ініціалізація календаря розкладу
    const adminDateInput = document.getElementById('schedule-admin-date');
    if (adminDateInput) {
        if (!adminDateInput.value) adminDateInput.valueAsDate = new Date();
        window.currentScheduleDate = new Date(adminDateInput.value);
        
        adminDateInput.addEventListener('change', (e) => {
            if (e.target.value) {
                window.currentScheduleDate = new Date(e.target.value);
                if (typeof syncWeekAndLoad === 'function') syncWeekAndLoad();
            }
        });
    }

    // скидання помилок при виборі потокової пари
    const streamCheckbox = document.getElementById('modal-sch-is-stream');
    if (streamCheckbox) {
        streamCheckbox.addEventListener('change', () => {
            if (streamCheckbox.checked && typeof clearModalError === 'function') {
                clearModalError();
            }
        });
    }

    // запуск головного ядра системи
    await initAdminDashboard();
});

// послідовний запуск модулів панелі
async function initAdminDashboard() {
    console.log("🛠️ Запуск модулів адміністратора...");
    if (typeof setupAdminLogoutListener === 'function') setupAdminLogoutListener();
    if (typeof setupAdminNavigation === 'function') setupAdminNavigation();
    
    // завантаження груп та викладачів
    try { 
        await loadFilterOptions(); 
    } catch(e) { 
        console.error("Помилка loadFilterOptions:", e); 
    }
    
    // наповнення фільтрів спеціальностей
    try {
        await initAdminDashboardFilters();
    } catch(e) {
        console.error("Помилка ініціалізації аналітичних фільтрів:", e);
    }

    // активація слухачів подій
    setupFilterEventListeners();
    setupAnalyticsResetListener();
    setupMatrixResetListener();

    // первинне завантаження сітки розкладу
    if (typeof loadGlobalMatrix === 'function') {
        try { await loadGlobalMatrix(); } catch(e) { console.error("Помилка матриці:", e); }
    } else if (typeof loadScheduleGrid === 'function') {
        try { await loadScheduleGrid(); } catch(e) { console.error("Помилка розкладу:", e); }
    }

    // побудова графіків та аналітики
    try { 
        if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB(); 
    } catch(e) { 
        console.error("Помилка завантаження графіків:", e); 
    }
    
    if (typeof loadAdminUsersTable === 'function') {
        await loadAdminUsersTable();
    }

    // автоматична активація першої вкладки меню
    const firstRealTab = document.querySelector('.sidebar .nav-item[data-target], .sidebar a[data-target]');
    if (firstRealTab && firstRealTab.id !== 'btn-logout-system') {
        firstRealTab.click();
    } else if (typeof showSectionAdmin === 'function') {
        showSectionAdmin('dashboard', null);
    }
}

// запит базових довідників з бази даних
async function loadFilterOptions() {
    const token = (typeof window.state !== 'undefined' && window.state?.token) ? window.state.token : (localStorage.getItem('token') || '');
    let apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '/api');
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    
    const safeEscape = (str) => typeof escapeHtml === 'function' ? escapeHtml(str) : (str || '');

    // безпечне отримання масиву даних
    async function safeFetchArray(endpoint) {
        try {
            const cleanEndpoint = endpoint.startsWith('/admin') ? endpoint : `/admin${endpoint}`;
            const res = await fetch(`${apiUrl}${cleanEndpoint}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            const contentType = res.headers.get("content-type") || "";
            if (!res.ok || !contentType.includes("application/json")) return null;
            return await res.json();
        } catch (err) {
            return null;
        }
    }

    try {
        const [groups, subjects, teachers] = await Promise.all([
            safeFetchArray('/groups'),
            safeFetchArray('/subjects'),
            safeFetchArray('/teachers')
        ]);

        if (groups && Array.isArray(groups)) {
            window.globalGroups = groups; 
            window.matrixActiveGroupIds = groups.map(g => g.id); 
        }

        // заповнення селекторів груп у всіх модулях
        const groupSelectors = ['analytics-group-filter', 'sch-group', 'report-criteria-group', 'schedule-group-filter', 'modal-sch-group'];
        groupSelectors.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            
            el.innerHTML = (id === 'schedule-group-filter' || id === 'modal-sch-group') 
                ? '<option value="all">🔍 Оберіть групу з бази даних</option>' 
                : '<option value="all">Усі академічні групи</option>';
            
            if (Array.isArray(groups)) {
                groups.forEach(g => {
                    const val = (id === 'analytics-group-filter') ? g.name : g.id;
                    el.insertAdjacentHTML('beforeend', `<option value="${safeEscape(val)}">${safeEscape(g.name)}</option>`);
                });
            }
        });

        // заповнення селектора дисциплін
        const schSubject = document.getElementById('sch-subject') || document.getElementById('modal-sch-subject');
        if (schSubject && Array.isArray(subjects)) {
            schSubject.innerHTML = '<option value="" disabled selected>Оберіть дисципліну...</option>';
            subjects.forEach(s => {
                schSubject.insertAdjacentHTML('beforeend', `<option value="${s.id}">${safeEscape(s.name)}</option>`);
            });
        }

        // заповнення селектора викладачів
        const schTeacher = document.getElementById('sch-teacher') || document.getElementById('modal-sch-teacher');
        if (schTeacher && Array.isArray(teachers)) {
            schTeacher.innerHTML = '<option value="" disabled selected>Оберіть викладача...</option>';
            teachers.forEach(t => {
                const name = `${t.last_name || ''} ${t.first_name || ''}`.trim() || t.name;
                schTeacher.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeEscape(name)}</option>`);
            });
        }

    } catch (err) {
        console.error("❌ Загальна помилка наповнення довідників:", err);
    }
}

// отримання та генерація списку спеціальностей
async function initAdminDashboardFilters() {
    const token = (typeof window.state !== 'undefined' && window.state?.token) ? window.state.token : (localStorage.getItem('token') || '');
    let apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : '';
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    
    if (!apiUrl) return;
    const safeEscape = (str) => typeof escapeHtml === 'function' ? escapeHtml(str) : (str || '');

    try {
        const specRes = await fetch(`${apiUrl}/admin/analytics/specialties`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        }).catch(() => null);
        
        if (specRes && specRes.ok) {
            const specialties = await specRes.json().catch(() => []);
            
            const specFilters = [
                document.getElementById('analytics-specialty-filter'),
                document.getElementById('matrix-dept-filter')
            ];

            specFilters.forEach(filter => {
                if (!filter) return;
                filter.innerHTML = '<option value="all">Усі спеціальності</option>';
                
                if (Array.isArray(specialties)) {
                    specialties.forEach(s => {
                        const shortName = s.short_name || '';
                        const fullName = s.name || '';
                        filter.insertAdjacentHTML('beforeend', `<option value="${safeEscape(shortName)}">${safeEscape(shortName)} — ${safeEscape(fullName)}</option>`);
                    });
                }
            });
        }
        
        // оновлення пов'язаних фільтрів курсів та груп
        await updateCourseAndGroupFilters(null, 'analytics');
        await updateCourseAndGroupFilters(null, 'matrix');
        
    } catch (e) {
        console.error("Помилка ініціалізації фільтрів:", e);
    }
}

// каскадне оновлення списків курсів та груп
async function updateCourseAndGroupFilters(event, forcePrefix = null) {
    const token = (typeof window.state !== 'undefined' && window.state?.token) ? window.state.token : (localStorage.getItem('token') || '');
    let apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : '';
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    if (!apiUrl) return;

    const safeEscape = (str) => typeof escapeHtml === 'function' ? escapeHtml(str) : (str || '');

    // визначення поточного модуля
    let prefix = forcePrefix;
    if (event && event.target) {
        prefix = event.target.id.startsWith('matrix') ? 'matrix' : 'analytics';
    }

    const specFilter = prefix === 'matrix' ? document.getElementById('matrix-dept-filter') : document.getElementById('analytics-specialty-filter');
    const courseFilter = prefix === 'matrix' ? document.getElementById('matrix-course-filter') : document.getElementById('analytics-course-filter');
    const groupFilter = prefix === 'matrix' ? document.getElementById('matrix-group-filter') : document.getElementById('analytics-group-filter');

    const selectedSpecialty = specFilter?.value || 'all';
    const triggerElement = event ? event.target : specFilter;

    try {
        // крок 1: оновлення курсів
        if (!event || triggerElement === specFilter) {
            const res = await fetch(`${apiUrl}/admin/analytics/filter-meta?specialty=${encodeURIComponent(selectedSpecialty)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => null);

            if (res && res.ok) {
                const meta = await res.json().catch(() => ({ courses: [] }));
                const prevCourse = courseFilter ? courseFilter.value : 'all';

                if (courseFilter) {
                    courseFilter.innerHTML = '<option value="all">Усі курси</option>';
                    if (meta && meta.courses && Array.isArray(meta.courses)) {
                        meta.courses.map(Number).sort((a,b) => a - b).forEach(c => {
                            courseFilter.insertAdjacentHTML('beforeend', `<option value="${c}">${c} курс</option>`);
                        });
                    }
                    
                    if (meta && meta.courses?.map(String).includes(String(prevCourse))) {
                        courseFilter.value = prevCourse;
                    } else {
                        courseFilter.value = 'all';
                    }
                }
            }
        }

        // крок 2: оновлення академічних груп
        const currentCourse = courseFilter ? courseFilter.value : 'all';
        const prevGroup = groupFilter ? groupFilter.value : 'all';

        const groupsRes = await fetch(`${apiUrl}/admin/analytics/groups?specialty=${encodeURIComponent(selectedSpecialty)}&course=${encodeURIComponent(currentCourse)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null);

        if (groupsRes && groupsRes.ok && groupFilter) {
            const filteredGroups = await groupsRes.json().catch(() => []);
            groupFilter.innerHTML = '<option value="all">Усі академічні групи</option>';
            
            if (Array.isArray(filteredGroups)) {
                filteredGroups.forEach(gName => {
                    let optionValue = gName;
                    if (prefix === 'matrix' && window.globalGroups) {
                        const found = window.globalGroups.find(g => g.name === gName);
                        if (found) optionValue = found.id;
                    }
                    groupFilter.insertAdjacentHTML('beforeend', `<option value="${safeEscape(optionValue)}">${safeEscape(gName)}</option>`);
                });

                groupFilter.value = prevGroup;
            }

            // синхронізація активних груп для матриці розкладу
            if (prefix === 'matrix' && window.globalGroups) {
                if (groupFilter.value !== 'all') {
                    window.matrixActiveGroupIds = [Number(groupFilter.value)];
                } else if (selectedSpecialty === 'all' && currentCourse === 'all') {
                    window.matrixActiveGroupIds = window.globalGroups.map(g => g.id);
                } else {
                    window.matrixActiveGroupIds = window.globalGroups
                        .filter(g => filteredGroups.includes(g.name))
                        .map(g => g.id);
                }
            }
        }
    } catch (e) {
        console.error("Не вдалося динамічно оновити каскадні фільтри:", e);
    }
}

// активація слухачів змін у фільтрах
function setupFilterEventListeners() {
    const specFilter = document.getElementById('analytics-specialty-filter');
    const courseFilter = document.getElementById('analytics-course-filter');
    const groupFilter = document.getElementById('analytics-group-filter');

    if (specFilter) specFilter.addEventListener('change', onSpecialtyOrCourseChange);
    if (courseFilter) courseFilter.addEventListener('change', onSpecialtyOrCourseChange);
    if (groupFilter) {
        groupFilter.addEventListener('change', async () => {
            if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
        });
    }

    const mSpecFilter = document.getElementById('matrix-dept-filter');
    const mCourseFilter = document.getElementById('matrix-course-filter');
    const mGroupFilter = document.getElementById('matrix-group-filter');

    if (mSpecFilter) mSpecFilter.addEventListener('change', onMatrixFilterChange);
    if (mCourseFilter) mCourseFilter.addEventListener('change', onMatrixFilterChange);
    if (mGroupFilter) {
        mGroupFilter.addEventListener('change', () => {
            if (mGroupFilter.value !== 'all') {
                window.matrixActiveGroupIds = [Number(mGroupFilter.value)];
            } else {
                onMatrixFilterChange({ target: mCourseFilter });
                return;
            }
            if (typeof loadGlobalMatrix === 'function') loadGlobalMatrix();
        });
    }
}

// обробник фільтрів модуля аналітики
async function onSpecialtyOrCourseChange(event) {
    await updateCourseAndGroupFilters(event, 'analytics');
    if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
}

// обробник фільтрів модуля матриці розкладу
async function onMatrixFilterChange(event) {
    await updateCourseAndGroupFilters(event, 'matrix');
    if (typeof loadGlobalMatrix === 'function') loadGlobalMatrix();
}

// скидання фільтрації аналітики до початкового стану
function setupAnalyticsResetListener() {
    const resetBtn = document.getElementById('btn-reset-analytics');
    if (!resetBtn) return;

    resetBtn.replaceWith(resetBtn.cloneNode(true)); 
    const cleanBtn = document.getElementById('btn-reset-analytics');
    
    cleanBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log("🔄 Скидання фільтрів аналітики...");

        const specFilter = document.getElementById('analytics-specialty-filter');
        const courseFilter = document.getElementById('analytics-course-filter');
        const groupFilter = document.getElementById('analytics-group-filter');

        if (specFilter) specFilter.value = 'all';

        await updateCourseAndGroupFilters(null, 'analytics');

        if (courseFilter) courseFilter.value = 'all';
        if (groupFilter) groupFilter.value = 'all';

        if (typeof loadStatsAndChartsFromDB === 'function') {
            await loadStatsAndChartsFromDB();
        }
    });
}

// повне скидання фільтрації матриці розкладу
function setupMatrixResetListener() {
    const matrixResetBtn = document.getElementById('matrix-reset-btn');
    if (!matrixResetBtn) return;

    matrixResetBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const mSpecFilter = document.getElementById('matrix-dept-filter');
        const mCourseFilter = document.getElementById('matrix-course-filter');
        const mGroupFilter = document.getElementById('matrix-group-filter');

        if (mSpecFilter) mSpecFilter.value = 'all';
        if (mCourseFilter) mCourseFilter.value = 'all';
        if (mGroupFilter) mGroupFilter.value = 'all';

        if (window.globalGroups) {
            window.matrixActiveGroupIds = window.globalGroups.map(g => g.id);
        }

        await updateCourseAndGroupFilters(null, 'matrix');
        if (typeof loadGlobalMatrix === 'function') loadGlobalMatrix();
    });
}

// завантаження та обробка аналітичних даних з бази даних
// завантаження та обробка аналітичних даних з бази даних
async function loadStatsAndChartsFromDB() {
    const periodSelect = document.getElementById('analytics-period-filter') || document.getElementById('report-criteria-period');
    let selectedPeriodId = 'all';
    let isPeriodActive = true;

    if (periodSelect) {
        const selectedOption = periodSelect.selectedOptions[0] || periodSelect.options[periodSelect.selectedIndex];
        selectedPeriodId = periodSelect.value || 'all';
        isPeriodActive = selectedOption?.getAttribute('data-active') === 'true';
        
        // 🛑 КЛАПАН ДЛЯ КАНІКУЛ / ДІЙСНО ПОРОЖНІХ ПЕРІОДІВ
        // Якщо це не просто архівний семестр, а глобальні канікули (наприклад, значення 'vacation' або порожній селектор)
        if (selectedPeriodId === 'vacation' || selectedPeriodId === '') {
            console.warn("⚠️ Обрано період канікул. Аналітика примусово занулюється.");
            resetDashboardUIToAbsoluteZero();
            return; 
        }
    }

    // 2. ОСНОВНИЙ КОД: Виконується для будь-якого семестру (активного чи архівного)
    const specialty = (document.getElementById('analytics-specialty-filter') || document.getElementById('report-criteria-spec'))?.value || 'all';
    const course = (document.getElementById('analytics-course-filter') || document.getElementById('report-criteria-course'))?.value || 'all';
    const group = (document.getElementById('analytics-group-filter') || document.getElementById('report-criteria-group'))?.value || 'all';
    
    const token = (typeof window.state !== 'undefined' && window.state?.token) ? window.state.token : (localStorage.getItem('token') || '');
    const apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : '';

    if (!apiUrl) return;

    try {
        if (!window.attendancePeriod) window.attendancePeriod = 'semester';

        // 🔥 ФІКС: Обов'язково додаємо &period_id (або &semester_id) у query-параметри, 
        // щоб бекенд знав, з якого саме семестру брати оцінки та відвідуваність!
        const queryParams = `?group=${encodeURIComponent(group)}&specialty=${encodeURIComponent(specialty)}&course=${encodeURIComponent(course)}&period=${encodeURIComponent(window.attendancePeriod)}&period_id=${encodeURIComponent(selectedPeriodId)}`;
        
        const res = await fetch(`${apiUrl}/admin/analytics/summary${queryParams}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res || !res.ok) throw new Error("Сервер не зміг згенерувати аналітику");
        const data = await res.json().catch(() => ({}));

        // Заповнення лічильників
        if (document.getElementById('stat-students')) document.getElementById('stat-students').innerText = data.counters?.students ?? '0';
        if (document.getElementById('stat-teachers')) document.getElementById('stat-teachers').innerText = data.counters?.teachers ?? '0';
        if (document.getElementById('stat-courses')) document.getElementById('stat-courses').innerText = data.counters?.subjects ?? '0';
        
        const incomingValues = data.attendancePieData?.values || [];
        const incomingLabels = data.attendancePieData?.labels || [];
        const total = incomingValues.reduce((a, b) => a + b, 0);
        const hasAttendanceData = incomingValues.length > 0 && total > 0;

        const attendanceCard = document.getElementById('card-attendance-metric');
        const attendanceTitle = document.getElementById('label-attendance-title');
        const attendanceValue = document.getElementById('stat-attendance-today');

        if (attendanceTitle) {
            if (window.attendancePeriod === 'day') attendanceTitle.innerText = 'Відвідуваність за день';
            else if (window.attendancePeriod === 'week') attendanceTitle.innerText = 'Відвідуваність за тиждень';
            else if (window.attendancePeriod === 'semester') attendanceTitle.innerText = 'Відвідуваність за семестр';
        }

        if (attendanceValue) {
            if (hasAttendanceData) {
                let presentCount = 0;
                let lateCount = 0;

                incomingLabels.forEach((label, index) => {
                    const l = label.toLowerCase();
                    const val = parseInt(incomingValues[index], 10) || 0;
                    if (l.includes('присутн')) presentCount = val;
                    else if (l.includes('запізнен')) lateCount = val;
                });

                const finalAttendanceRate = Math.min(100, Math.round(((presentCount + lateCount) * 100) / total));
                attendanceValue.innerText = `${finalAttendanceRate}%`;
                if (attendanceCard) {
                    attendanceCard.style.background = 'linear-gradient(135deg, #ec4899, #db2777)';
                    attendanceCard.style.boxShadow = '0 4px 6px -1px rgba(236, 72, 153, 0.2)';
                }
            } else {
                attendanceValue.innerText = '—';
                if (attendanceCard) {
                    attendanceCard.style.background = '#cbd5e1'; 
                    attendanceCard.style.boxShadow = 'none';
                }
            }
        }

        // Рендеринг даних (тепер вони будуть або порожні від сервера, або історичні з Семестру 1)
        if (typeof renderAttendancePieChart === 'function') renderAttendancePieChart(data.attendancePieData, hasAttendanceData);
        if (typeof renderGlobalGradeChart === 'function') renderGlobalGradeChart(data.gradeData || { labels: [], values: [] });
        if (typeof renderSpecialtiesChart === 'function') renderSpecialtiesChart(data.specialtiesData);
        
        // Відображення списків лідерів/ризику
        if (typeof renderTopAndRiskLists === 'function') {
            renderTopAndRiskLists(data.riskStudents || [], data.excellentStudents || []);
        }

        // Графік завантаженості (пов'язаний із розкладом)
        if (typeof renderActivityLoadChart === 'function') {
            renderActivityLoadChart(window.cachedLessons);
        }

    } catch (err) {
        console.error("❌ Помилка побудови аналітичних звітів:", err);
    }
}

// 🧼 ДОПОМІЖНА ФУНКЦІЯ ПОВНОГО ОБНУЛЕННЯ (для канікул)
// Зручно винести окремо, щоб не засмічувати основний код
function resetDashboardUIToAbsoluteZero() {
    if (document.getElementById('stat-students')) document.getElementById('stat-students').innerText = '0';
    if (document.getElementById('stat-teachers')) document.getElementById('stat-teachers').innerText = '0';
    if (document.getElementById('stat-courses')) document.getElementById('stat-courses').innerText = '0';

    const attendanceValue = document.getElementById('stat-attendance-today');
    const attendanceCard = document.getElementById('card-attendance-metric');
    if (attendanceValue) attendanceValue.innerText = '—';
    if (attendanceCard) {
        attendanceCard.style.background = '#cbd5e1'; 
        attendanceCard.style.boxShadow = 'none';
    }

    if (typeof renderAttendancePieChart === 'function') renderAttendancePieChart(null, false);
    if (typeof renderGlobalGradeChart === 'function') renderGlobalGradeChart({ labels: [], values: [] });
    if (typeof renderSpecialtiesChart === 'function') renderSpecialtiesChart({ labels: [], values: [] });
    if (typeof renderTopAndRiskLists === 'function') renderTopAndRiskLists([], []);
    if (typeof renderActivityLoadChart === 'function') renderActivityLoadChart([]);
}

// побудова лінійного графіка завантаженості навчального процесу по днях тижня
function renderActivityLoadChart(serverData) {
    const ctx = document.getElementById('adminActivityLoadChart')?.getContext('2d');
    if (!ctx) return;
    
    if (!window.charts) window.charts = {};
    if (window.charts.activityLoad) window.charts.activityLoad.destroy();

    const workingDaysLabels = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П\'ятниця'];
    let filteredValues = [0, 0, 0, 0, 0];

    const deptFilter = (document.getElementById('analytics-specialty-filter') || document.getElementById('report-criteria-spec'))?.value || 'all';
    const courseFilter = (document.getElementById('analytics-course-filter') || document.getElementById('report-criteria-course'))?.value || 'all';
    const groupFilter = (document.getElementById('analytics-group-filter') || document.getElementById('report-criteria-group'))?.value || 'all';

    const dateInput = document.getElementById('schedule-admin-date');
    const activeDate = dateInput?.value ? new Date(dateInput.value) : (window.currentAdminScheduleDate || new Date());
    const currentWeekTypeCode = getAnalyticalWeekType(activeDate);

    let rawLessons = [];
    if (Array.isArray(serverData) && serverData.length > 0 && typeof serverData[0] === 'object') {
        rawLessons = serverData;
    } else if (window.cachedLessons && window.cachedLessons.length > 0) {
        rawLessons = window.cachedLessons;
    }

    if (rawLessons.length > 0 && window.globalGroups && Array.isArray(window.globalGroups)) {
        const allowedGroupIds = window.globalGroups.filter(g => {
            const matchesDept = (deptFilter === 'all' || 
                                 g.department_name === deptFilter || 
                                 g.short_name === deptFilter || 
                                 g.name?.startsWith(deptFilter));
                                 
            const matchesCourse = (courseFilter === 'all' || String(g.course) === String(courseFilter));
            
            const matchesGroup = (groupFilter === 'all' || 
                                 String(g.id) === String(groupFilter) || 
                                 String(g.name).toLowerCase().trim() === String(groupFilter).toLowerCase().trim());
            
            return matchesDept && matchesCourse && matchesGroup;
        }).map(g => g.id);

        workingDaysLabels.forEach((dayName, index) => {
            const dayId = index + 1;
            const dayLessons = rawLessons.filter(l => {
                const matchDay = parseInt(l.day_of_week || l.day, 10) === dayId;
                const matchGroup = allowedGroupIds.includes(l.group_id);
                const isActive = l.is_active !== false && !l.is_cancelled_today;
                const matchWeek = (!l.week_type || l.week_type === 'always' || String(l.week_type) === String(currentWeekTypeCode));
                return matchDay && matchGroup && isActive && matchWeek;
            });

            const uniqueIds = new Set(dayLessons.map(l => l.id || `${l.group_id}_${l.day_of_week}_${l.lesson_number}`));
            filteredValues[index] = uniqueIds.size;
        });
    } else if (serverData) {
        if (Array.isArray(serverData.values)) {
            filteredValues = serverData.values.slice(0, 5);
        } else if (Array.isArray(serverData) && typeof serverData[0] !== 'object') {
            filteredValues = serverData.slice(0, 5);
        }
    }

    filteredValues = filteredValues.map(v => parseInt(v, 10) || 0);
    const maxValue = Math.max(...filteredValues);
    const computedMax = maxValue === 0 ? 5 : maxValue + 2; 

    window.charts.activityLoad = new Chart(ctx, {
        type: 'line',
        data: {
            labels: workingDaysLabels,
            datasets: [{
                label: 'Завантаженість (кількість пар)',
                data: filteredValues,
                borderColor: '#06b6d4', 
                backgroundColor: 'rgba(6, 182, 212, 0.08)',
                fill: true,
                tension: 0.25, 
                pointBackgroundColor: '#06b6d4',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#06b6d4',
                pointHoverBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                borderWidth: 3
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 10,
                    borderRadius: 6,
                    callbacks: {
                        label: function(context) {
                            return ` Кількість пар: ${context.parsed.y}`;
                        }
                    }
                }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    min: 0,
                    max: computedMax, 
                    ticks: { 
                        stepSize: maxValue > 10 ? 2 : 1, 
                        color: '#64748b',
                        precision: 0 
                    }, 
                    grid: { color: '#f1f5f9' } 
                },
                x: { 
                    ticks: { color: '#64748b', font: { weight: '500' } }, 
                    grid: { display: false } 
                }
            }
        }
    });
}

// ініціалізація обробників кліків для навігаційного меню адмін-панелі
function setupAdminNavigation() {
    const navItems = document.querySelectorAll('.sidebar .nav-item[data-target]');
    navItems.forEach(item => {
        if (item.id === 'btn-logout-system' || item.classList.contains('logout-link')) return;
        item.addEventListener('click', handleNavClick);
    });
}

// посередник обробки кліку по елементу меню для скасування стандартної поведінки посилання
function handleNavClick(e) {
    e.preventDefault();
    const targetSec = this.getAttribute('data-target');
    if (targetSec) showSectionAdmin(targetSec, this);
}

// перемикання видимості секцій контенту та оновлення заголовків сторінки
function showSectionAdmin(sectionId, activeBtn) {
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    
    const target = document.getElementById(sectionId);
    if (target) {
        target.style.display = 'block';
    } else {
        console.warn(`⚠️ Секцію з ID "${sectionId}" не знайдено в HTML.`);
    }

    document.querySelectorAll('.sidebar .nav-item').forEach(i => i.classList.remove('active'));
    if (activeBtn) {
        activeBtn.classList.add('active');
        const titleEl = document.getElementById('main-title');
        const span = activeBtn.querySelector('span');
        if (titleEl && span) titleEl.innerText = span.innerText;
    }
}

// налаштування обробника події виходу із системи з очищенням сесії та локального сховища
function setupAdminLogoutListener() {
    const logoutBtn = document.getElementById('btn-logout-system');
    if (!logoutBtn) return;

    logoutBtn.onclick = null;
    logoutBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation(); 

        if (typeof window.logout === 'function') {
            window.logout();
        } else {
            const confirmed = confirm("Ви дійсно бажаєте вийти з системи?");
            if (confirmed) {
                localStorage.clear();
                sessionStorage.clear();
                window.location.replace('login.html');
            }
        }
    };
}

// визначення типу поточного навчального тижня (чисельник або знаменник) відповідно до дати
function getAnalyticalWeekType(targetDate) {
    const date = targetDate instanceof Date ? targetDate : new Date();
    if (typeof window.getWeekType === 'function') {
        return window.getWeekType(date)?.code || 'always';
    }
    const tempDate = new Date(date.getTime());
    tempDate.setHours(0, 0, 0, 0);
    tempDate.setDate(tempDate.getDate() + 3 - (tempDate.getDay() + 6) % 7);
    const week1 = new Date(tempDate.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((tempDate - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return (weekNum % 2 === 0) ? 'denominator' : 'numerator';
}

// побудова кругової діаграми відвідуваності студентів (присутність, запізнення, відсутність)
function renderAttendancePieChart(serverData, hasAttendanceData) {
    const ctx = document.getElementById('adminPieChart')?.getContext('2d');
    const emptyMessageDiv = document.getElementById('pie-empty-message'); 
    if (!ctx) return;
    
    if (!window.charts) window.charts = {};
    if (window.charts.attendancePie) window.charts.attendancePie.destroy();

    let chartLabels = [];
    let chartValues = [0, 0, 0];
    let bgColors = ['#10b981', '#f59e0b', '#ef4444'];
    let total = 0;
    let calculatedPercentages = [0, 0, 0];

    if (hasAttendanceData && serverData) {
        if (emptyMessageDiv) emptyMessageDiv.style.display = 'none';

        const incomingValues = serverData?.values || [];
        const incomingLabels = serverData?.labels || [];
        total = incomingValues.reduce((a, b) => a + b, 0);

        incomingLabels.forEach((label, index) => {
            const l = label.toLowerCase();
            const val = parseInt(incomingValues[index], 10) || 0;
            if (l.includes('присутн')) chartValues[0] = val;
            else if (l.includes('запізнен')) chartValues[1] = val;
            else if (l.includes('відсутн')) chartValues[2] = val;
        });
        
        if (total > 0) {
            calculatedPercentages[0] = Math.round((chartValues[0] * 100) / total);
            calculatedPercentages[1] = Math.round((chartValues[1] * 100) / total);
            
            if (chartValues[2] > 0) {
                calculatedPercentages[2] = 100 - calculatedPercentages[0] - calculatedPercentages[1];
            } else {
                calculatedPercentages[2] = 0;
                if (calculatedPercentages[0] + calculatedPercentages[1] !== 100 && chartValues[0] > 0) {
                    calculatedPercentages[0] = 100 - calculatedPercentages[1];
                }
            }
        }

        const baseLabels = ['Присутні', 'Запізнення', 'Відсутні'];
        chartLabels = baseLabels.map((label, idx) => {
            return `${label}: ${calculatedPercentages[idx]}%`;
        });
    } else {
        chartLabels = ['Немає даних за цей період']; 
        chartValues = [1]; 
        bgColors = ['#f1f5f9']; 
        if (emptyMessageDiv) emptyMessageDiv.style.display = 'block';
    }

    window.charts.attendancePie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                data: chartValues,
                backgroundColor: bgColors,
                borderWidth: hasAttendanceData ? 2 : 1, 
                borderColor: '#ffffff'
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    display: true, 
                    position: 'bottom', 
                    labels: { 
                        boxWidth: 12, 
                        font: { size: 12, weight: '600' }, 
                        color: '#475569', 
                        padding: 14 
                    } 
                },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        title: function() { return ''; },
                        label: function(context) {
                            if (!hasAttendanceData) return ' Дані відсутні';
                            
                            const baseLabels = ['Присутні', 'Запізнення', 'Відсутні'];
                            const currentLabel = baseLabels[context.dataIndex] || '';
                            const pct = calculatedPercentages[context.dataIndex];
                            
                            return ` ${currentLabel}: ${pct}%`;
                        }
                    }
                }
            },
            cutout: '70%', 
            borderRadius: hasAttendanceData ? 4 : 0
        }
    });
}

// зміна часового інтервалу для аналітики відвідуваності та оновлення інтерфейсу кнопок перемикання
function changeAttendancePeriod(period, btn) {
    if (!btn) return;
    window.attendancePeriod = period;
    const parent = btn.parentNode;
    if (parent) {
        parent.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = '#fff';
            b.style.color = '#64748b';
            b.style.boxShadow = 'none';
        });
    }
    btn.classList.add('active');
    btn.style.background = '#6366f1';
    btn.style.color = '#fff';
    loadStatsAndChartsFromDB();
}

// побудова стовпчикового графіка загальної успішності та середнього балу по групах
function renderGlobalGradeChart(serverData) {
    const ctx = document.getElementById('adminGlobalChart')?.getContext('2d');
    if (!ctx) return;
    
    if (!window.charts) window.charts = {};
    if (window.charts.globalGpa) window.charts.globalGpa.destroy();

    window.charts.globalGpa = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: serverData?.labels || [],
            datasets: [{
                label: 'Середній бал групи',
                data: serverData?.values || [],
                backgroundColor: 'rgba(99, 102, 241, 0.85)',
                borderColor: '#6366f1',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { 
                y: { min: 0, max: 100, ticks: { stepSize: 10, color: '#64748b' }, grid: { color: '#f1f5f9' } },
                x: { ticks: { color: '#64748b' }, grid: { display: false } }
            }
        }
    });
}

// побудова полярного графіка порівняння успішності або кількості студентів між спеціальностями
function renderSpecialtiesChart(serverData) {
    const ctx = document.getElementById('adminSpecialtiesCompareChart')?.getContext('2d');
    if (!ctx) return;
    
    if (!window.charts) window.charts = {};
    if (window.charts.specialties) window.charts.specialties.destroy();

    window.charts.specialties = new Chart(ctx, {
        type: 'polarArea',
        data: {
            labels: serverData?.labels || [],
            datasets: [{
                data: serverData?.values || [],
                backgroundColor: ['rgba(99, 102, 241, 0.75)', 'rgba(168, 85, 247, 0.75)', 'rgba(236, 72, 153, 0.75)', 'rgba(20, 184, 166, 0.75)'],
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: { r: { grid: { color: '#f1f5f9' }, ticks: { display: false } } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11, weight: '600' }, color: '#475569' } } }
        }
    });
}

// генерація html списків для відмінників та студентів з незадовільними оцінками в зоні ризику
function renderTopAndRiskLists(risk, excellent) {
    const riskContainer = document.getElementById('admin-risk-students-list');
    const excelContainer = document.getElementById('admin-excellent-students-list');

    // студенти в зоні ризику
    if (riskContainer) {
        if (!risk || risk.length === 0) {
            riskContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); border: 1px dashed #e2e8f0; border-radius: 12px; text-align: center;">
                    <div style="background: #f0fdf4; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 8px;">
                        <i class="fa-solid fa-user-check" style="font-size: 14px; color: #16a34a;"></i>
                    </div>
                    <span style="font-size: 13px; color: #475569; font-weight: 600; line-height: 1.2;">Студентів у зоні ризику немає</span>
                </div>
            `;
        } else {
            riskContainer.innerHTML = risk.map(s => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#fff5f5; border-left:4px solid #ef4444; border-radius:8px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:600; color:#1e293b;">${escapeHtml(s.last_name)} ${escapeHtml(s.first_name)}</span>
                        <span style="font-size:11px; color:#64748b; margin-top:1px;">Група: ${escapeHtml(s.group_name)}</span>
                    </div>
                    <span style="background:#fee2e2; color:#ef4444; padding:4px 8px; border-radius:6px; font-weight:700; font-size:12px;">${parseFloat(s.avg_grade || 0).toFixed(1)} б.</span>
                </div>
            `).join('');
        }
    }

    // найкращі студенти
    if (excelContainer) {
        if (!excellent || excellent.length === 0) {
            excelContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); border: 1px dashed #e2e8f0; border-radius: 12px; text-align: center;">
                    <div style="background: #fcf8e3; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 8px;">
                        <i class="fa-solid fa-graduation-cap" style="font-size: 14px; color: #d97706;"></i>
                    </div>
                    <span style="font-size: 13px; color: #475569; font-weight: 600; line-height: 1.2;">Студентів-відмінників немає</span>
                </div>
            `;
        } else {
            excelContainer.innerHTML = excellent.map(s => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#f0fdf4; border-left:4px solid #10b981; border-radius:8px; margin-bottom:8px; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:600; color:#1e293b;">${escapeHtml(s.last_name)} ${escapeHtml(s.first_name)}</span>
                        <span style="font-size:11px; color:#64748b; margin-top:1px;">Група: ${escapeHtml(s.group_name)}</span>
                    </div>
                    <span style="background:#d1fae5; color:#10b981; padding:4px 8px; border-radius:6px; font-weight:700; font-size:12px;">${parseFloat(s.avg_grade || 0).toFixed(1)} б.</span>
                </div>
            `).join('');
        }
    }
}
// користувачі
const ROLE_MAP = { 'admin': 1, 'teacher': 2, 'student': 3 };
const ROLE_ID_TO_NAME = { 1: 'admin', 2: 'teacher', 3: 'student' };

function detectCourseFromGroup(user) {
    if (!user) return null;
    
    // Пріоритет 1: Якщо сервер повернув готове поле course із таблиці groups
    if (user.course !== undefined && user.course !== null && String(user.course).trim() !== '') {
        return parseInt(user.course, 10);
    }
    
    // Пріоритет 2: Парсимо назву групи (якщо група "21", то перша цифра "2" — це курс)
    if (!user.group_name) return null;
    
    const groupName = String(user.group_name).trim();
    const digits = groupName.match(/\d/g); // Знаходить усі цифри окремо
    
    if (digits && digits.length > 0) {
        // Беремо найпершу цифру в назві групи
        return parseInt(digits[0], 10); 
    }
    
    return null;
}
// фільтрація
function populateMetaFilterOptions() {
    const metaFilter = document.getElementById('user-meta-filter');
    const courseFilter = document.getElementById('user-course-filter');
    
    if (!metaFilter) return;

    // Зберігаємо поточні вибрані користувачем значення, щоб вони не злітали
    const currentMetaValue = metaFilter.value;
    const currentCourseValue = courseFilter ? courseFilter.value : 'all';

    // Очищаємо до дефолтних значень
    metaFilter.innerHTML = '<option value="all">Усі групи / каф.</option>';
    if (courseFilter) {
        courseFilter.innerHTML = '<option value="all">Усі курси</option>';
    }

    // 1. Наповнюємо селект курсів статично або динамічно (1-6 курси є стандартом)
    if (courseFilter) {
        const courses = [1, 2, 3, 4];
        courses.forEach(course => {
            const option = document.createElement('option');
            option.value = String(course);
            option.textContent = `${course} курс`;
            courseFilter.appendChild(option);
        });
        courseFilter.value = currentCourseValue;
    }

    // 2. Додаємо ВСІ кафедри з глобального довідника БД
    if (window.globalDepartments && Array.isArray(window.globalDepartments)) {
        const sortedDepts = [...window.globalDepartments].sort((a, b) => {
            const nameA = a.short_name || a.name || '';
            const nameB = b.short_name || b.name || '';
            return nameA.localeCompare(nameB, 'uk');
        });

        sortedDepts.forEach(dept => {
            if (!dept.id) return;
            const option = document.createElement('option');
            option.value = `dep_${dept.id}`;
            option.textContent = `Каф. ${dept.short_name || dept.name}`;
            metaFilter.appendChild(option);
        });
    }

    // 3. Додаємо ВСІ групи з глобального довідника БД з точною прив'язкою курсу
    if (window.globalGroups && Array.isArray(window.globalGroups)) {
        const sortedGroups = [...window.globalGroups].sort((a, b) => {
            const nameA = a.name || a.group_name || '';
            const nameB = b.name || b.group_name || '';
            return nameA.localeCompare(nameB, 'uk');
        });

        sortedGroups.forEach(group => {
            const gId = group.id;
            const gName = group.name || group.group_name;
            if (!gId || !gName) return;

            const option = document.createElement('option');
            option.value = `gr_${gId}`;
            option.textContent = `Гр. ${gName}`;
            
            // Визначаємо курс групи прямо з об'єкта бази або парсимо з імені
            let groupCourse = group.course;
            if (!groupCourse) {
                const digits = String(gName).match(/\d/g);
                if (digits && digits.length > 0) {
                    groupCourse = parseInt(digits[0], 10);
                }
            }

            // Зашиваємо курс в дата-атрибут для фільтрації
            if (groupCourse) {
                option.setAttribute('data-course', String(groupCourse));
            } else {
                option.setAttribute('data-course', 'all');
            }

            metaFilter.appendChild(option);
        });
    }

    // Відновлюємо попередній вибір
    metaFilter.value = currentMetaValue;
}

function handleRoleAndCourseFilters(forcedRole = null, forcedCourse = null) {
    const roleSelect = document.getElementById('user-role-filter');
    const courseSelect = document.getElementById('user-course-filter');
    const metaSelect = document.getElementById('user-meta-filter');

    if (!roleSelect || !metaSelect || !courseSelect) return;

    // Визначаємо актуальні значення (пріоритет у примусових параметрів, наприклад при скиданні)
    const selectedRole = forcedRole !== null ? forcedRole : roleSelect.value;
    const selectedCourse = forcedCourse !== null ? forcedCourse : courseSelect.value;
    const currentMetaValue = metaSelect.value;

    // --- КРОК 1: Керування доступністю (disabled) елементів селектів ---
    if (selectedRole === '1') {
        courseSelect.disabled = true;
        metaSelect.disabled = true;
        courseSelect.style.background = '#e2e8f0';
        metaSelect.style.background = '#e2e8f0';
    } else if (selectedRole === '2') {
        courseSelect.disabled = true;
        metaSelect.disabled = false;
        courseSelect.style.background = '#e2e8f0';
        metaSelect.style.background = '#f8fafc';
    } else {
        // Для студентів (3) або "Усі ролі" (all)
        courseSelect.disabled = false;
        metaSelect.disabled = false;
        courseSelect.style.background = '#f8fafc';
        metaSelect.style.background = '#f8fafc';
    }

    // --- КРОК 2: Розумна фільтрація вмісту опцій груп/кафедр ---
    let isCurrentMetaStillValid = true;

    Array.from(metaSelect.options).forEach(option => {
        const val = option.value;

        // Дефолтну опцію показуємо завжди
        if (val === 'all') {
            option.style.display = '';
            return;
        }

        const isGroup = val.startsWith('gr_');
        const isDept = val.startsWith('dep_');
        const groupCourse = option.getAttribute('data-course');

        let shouldShow = true;

        if (selectedRole === '2' && isGroup) {
            shouldShow = false; // Викладач -> ховаємо групи
        } else if (selectedRole === '3' && isDept) {
            shouldShow = false; // Студент -> ховаємо кафедри
        } else if (isGroup && selectedCourse !== 'all' && groupCourse !== selectedCourse) {
            shouldShow = false; // Фільтр по конкретному курсу для груп
        }

        // Застосовуємо стилі відображення опції
        if (shouldShow) {
            option.style.display = '';
        } else {
            option.style.display = 'none';
            // Якщо поточна вибрана група ховається, прапорець валідності падає
            if (currentMetaValue === val) {
                isCurrentMetaStillValid = false;
            }
        }
    });

    // Якщо раніше обрана група тепер прихована або ми примусово все скидаємо
    if (!isCurrentMetaStillValid || forcedCourse === 'all') {
        metaSelect.value = 'all';
    }
}

// скидання фільтрів
function clearUserFilters() {
    const searchInput = document.getElementById('user-search');
    const roleSelect = document.getElementById('user-role-filter');
    const courseSelect = document.getElementById('user-course-filter');
    const metaSelect = document.getElementById('user-meta-filter');

    // 1. Спочатку скидаємо всі значення у DOM елементах
    if (searchInput) searchInput.value = '';
    if (roleSelect) roleSelect.value = 'all';
    if (courseSelect) courseSelect.value = 'all';
    if (metaSelect) metaSelect.value = 'all';

    // 2. Примусово передаємо 'all', щоб миттєво розкрити всі приховані групи/кафедри
    handleRoleAndCourseFilters('all', 'all');

    // 3. Перерендерюємо таблицю користувачів з уже чистими фільтрами
    applyUsersFiltersAndRender();
}

// побудова таблиці коритсувачів
function applyUsersFiltersAndRender() {
    const activeCache = (typeof localUsersCache !== 'undefined' ? localUsersCache : null) || window.localUsersCache;
    
    if (!Array.isArray(activeCache)) {
        console.error("❌ Кеш користувачів localUsersCache не знайдено.");
        return;
    }

    handleRoleAndCourseFilters();

    const searchVal = document.getElementById('user-search')?.value.toLowerCase().trim() || '';
    const roleVal = document.getElementById('user-role-filter')?.value || 'all';
    const courseVal = document.getElementById('user-course-filter')?.value || 'all';
    const metaVal = document.getElementById('user-meta-filter')?.value || 'all';

    const filteredUsers = activeCache.filter(user => {
        
        // 1. ФІЛЬТР РОЛЕЙ
        if (roleVal !== 'all') {
            const userRoleId = parseInt(user.role_id, 10);
            let selectedRoleFilter = roleVal;

            if (isNaN(selectedRoleFilter) && typeof ROLE_MAP !== 'undefined' && ROLE_MAP[selectedRoleFilter]) {
                selectedRoleFilter = ROLE_MAP[selectedRoleFilter];
            } else {
                selectedRoleFilter = parseInt(selectedRoleFilter, 10);
            }

            if (userRoleId !== selectedRoleFilter) return false;
        }

        // 2. ФІЛЬТР КУРСІВ (Діє виключно на студентів)
        if (courseVal !== 'all') {
            if (Number(user.role_id) !== 3) return false; 
            
            const userCourse = detectCourseFromGroup(user);
            if (!userCourse || String(userCourse) !== String(courseVal)) return false;
        }

        // 3. ФІЛЬТР ГРУП ТА КАФЕДР
        if (metaVal !== 'all') {
            if (metaVal.startsWith('dep_')) {
                const depId = metaVal.replace('dep_', '').trim();
                if (String(user.department_id).trim() !== depId) return false;
            } else if (metaVal.startsWith('gr_')) {
                const groupId = metaVal.replace('gr_', '').trim();
                if (String(user.group_id).trim() !== groupId) return false;
            }
        }

        // 4. ТЕКСТОВИЙ ПОШУК
        if (searchVal) {
            const fullName = `${user.last_name || ''} ${user.first_name || ''}`.toLowerCase();
            const email = (user.email || '').toLowerCase();
            if (!fullName.includes(searchVal) && !email.includes(searchVal)) return false;
        }

        return true;
    });

    renderUsersTable(filteredUsers);
}

function closeMatrixScheduleModal() { 
    toggleModalDisplay('matrixScheduleModal', 'close'); 
}

function openDeleteMatrixModal(id) {
    pendingDeleteId = id; 
    const lesson = cachedLessons.find(l => l.id === id);
    const textBlock = document.getElementById('matrixDeleteConfirmText');
    if (textBlock && lesson) {
        textBlock.innerText = `Виберіть варіант скасування для дисципліни "${lesson.subject_name}" (${lesson.room_name}):`;
    }
    const defaultRadio = document.querySelector('input[name="deleteType"][value="once"]');
    if (defaultRadio) defaultRadio.checked = true;
    toggleModalDisplay('matrixDeleteConfirmModal', 'open');
}

function closeMatrixDeleteModal() {
    toggleModalDisplay('matrixDeleteConfirmModal', 'close');
    pendingDeleteId = null;
}

// сповіщення
function showSystemToast(message, type = 'success') {
    let container = document.getElementById('global-system-toast-container');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'global-system-toast-container';
        document.body.appendChild(container);
    }

    // Абсолютна ізоляція та фіксація по центру екрана користувача
    container.style.cssText = `
        position: fixed !important;
        top: 30px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important; /* Максимально можливий z-index в браузерах */
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        pointer-events: none !important;
        align-items: center !important;
        width: max-content !important;
        max-width: 90vw !important;
    `;

    // Створюємо елемент самого тосту
    const toast = document.createElement('div');
    const bg = type === 'success' ? '#10b981' : (type === 'error' || type === 'danger') ? '#ef4444' : '#3b82f6';
    
    toast.style.cssText = `
        background: ${bg} !important;
        color: #ffffff !important;
        padding: 14px 24px !important;
        border-radius: 10px !important;
        font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
        font-weight: 700 !important;
        font-size: 14px !important;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2) !important;
        pointer-events: auto !important;
        min-width: 300px !important;
        max-width: 500px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 16px !important;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
        opacity: 0 !important;
        transform: translateY(-30px) scale(0.9) !important;
    `;
    
    const cleanMessage = typeof escapeHtml === 'function' ? escapeHtml(message) : message;
    
    toast.innerHTML = `
        <span style="line-height: 1.4; flex: 1; text-align: left;">${cleanMessage}</span>
        <span style="cursor: pointer; opacity: 0.8; font-weight: bold; font-size: 16px; line-height: 1; padding: 4px; transition: opacity 0.2s;" 
              onmouseover="this.style.opacity='1'" 
              onmouseout="this.style.opacity='0.8'" 
              onclick="this.parentElement.remove()">✕</span>
    `;
    
    container.appendChild(toast);

    // Плавний ефект падіння зверху прямо перед очима
    setTimeout(() => {
        toast.style.setProperty('opacity', '1', 'important');
        toast.style.setProperty('transform', 'translateY(0) scale(1)', 'important');
    }, 20);

    // Автоматичне безслідне видалення через 3.5 секунди
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.setProperty('opacity', '0', 'important');
            toast.style.setProperty('transform', 'translateY(-20px) scale(0.9)', 'important');
            setTimeout(() => { 
                if (toast.parentNode) toast.remove(); 
                // Якщо контейнер порожній — прибираємо і його
                if (container.children.length === 0) container.remove();
            }, 300);
        }
    }, 3500);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadFiltersAndSelectorsFromDB();
    await loadAdminUsersTable();
});

async function updateDashboardCharts() {
    try {
        const token = window.state?.token || localStorage.getItem('token') || '';
        const apiUrl = window.CONFIG?.apiUrl || '/api';
        
        if (window.myDashboardChart && typeof window.myDashboardChart.update === 'function') {
            const response = await fetch(`${apiUrl}/admin/dashboard-stats`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const newData = await response.json();
                window.myDashboardChart.data.datasets[0].data = newData.chartValues; 
                window.myDashboardChart.update();
            }
        }
        
        if (typeof renderAnalyticsCharts === 'function') {
            await renderAnalyticsCharts(); 
        }
        console.log("📊 Графіки успішно оновлено в реальному часі!");
    } catch (e) {
        console.error("Помилка оновлення графіків:", e);
    }
}

// завантаження довідників
async function loadFiltersAndSelectorsFromDB() {
    const token = window.state?.token || localStorage.getItem('token') || '';
    const apiUrl = window.CONFIG?.apiUrl || '/api';
    const headers = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

    try {
        const groupsRes = await fetch(`${apiUrl}/admin/groups`, { headers });
        if (groupsRes.ok) {
            window.globalGroups = await groupsRes.json();
        }

        const deptRes = await fetch(`${apiUrl}/admin/departments`, { headers });
        if (deptRes.ok) {
            window.globalDepartments = await deptRes.json();
        }

        const rolesRes = await fetch(`${apiUrl}/admin/roles`, { headers });
        if (rolesRes.ok) {
            const roles = await rolesRes.json();
            const filterRole = document.getElementById('user-role-filter');
            if (filterRole) {
                filterRole.innerHTML = '<option value="all">Усі ролі</option>';
                roles.forEach(role => {
                    const ukrName = Number(role.id) === 1 ? 'Адміністратор' : Number(role.id) === 2 ? 'Викладач' : 'Студент';
                    filterRole.innerHTML += `<option value="${role.id}">${ukrName}и</option>`;
                });
            }
        }
    } catch (e) {
        console.error("Помилка завантаження селектів довідників:", e);
    }
}

// таблиця користувачів
async function loadAdminUsersTable() {
    const token = window.state?.token || localStorage.getItem('token') || '';
    const apiUrl = window.CONFIG?.apiUrl || '/api';
    if (!token) return;

    try {
        const response = await fetch(`${apiUrl}/admin/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Не вдалося завантажити дані з бази.');
        }
        
        const data = await response.json();
        
        window.globalDepartments = window.globalDepartments || [];
        
        localUsersCache = data.sort((a, b) => {
            if (Number(a.role_id) !== Number(b.role_id)) return Number(a.role_id) - Number(b.role_id); 
            
            const nameA = `${a.last_name || ''} ${a.first_name || ''}`.toLowerCase().trim();
            const nameB = `${b.last_name || ''} ${b.first_name || ''}`.toLowerCase().trim();

            if (Number(a.role_id) === 2) return nameA.localeCompare(nameB, 'uk');
            
            if (Number(a.role_id) === 3) { 
                const courseA = detectCourseFromGroup(a) || 0;
                const courseB = detectCourseFromGroup(b) || 0;
                if (courseA !== courseB) return courseA - courseB;

                const groupA = (a.group_name || '').toLowerCase();
                const groupB = (b.group_name || '').toLowerCase();
                if (groupA !== groupB) return groupA.localeCompare(groupB, 'uk');
            }
            return nameA.localeCompare(nameB, 'uk');
        });

        // Ініціалізуємо фільтри глобальними довідниками
        populateMetaFilterOptions();
        // Рендеримо таблицю
        applyUsersFiltersAndRender();
    } catch (error) {
        showSystemToast(error.message, 'error');
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    await loadFiltersAndSelectorsFromDB();
    await loadAdminUsersTable();
    const roleSelect = document.getElementById('user-role-filter');
    const courseSelect = document.getElementById('user-course-filter');

    if (roleSelect) {
        roleSelect.addEventListener('change', () => {
            handleRoleAndCourseFilters(); 
            applyUsersFiltersAndRender(); 
        });
    }

    if (courseSelect) {
        courseSelect.addEventListener('change', () => {
            handleRoleAndCourseFilters(); 
            applyUsersFiltersAndRender(); 
        });
    }
});

function renderUsersTable(users) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const safeEscape = (str) => typeof escapeHtml === 'function' ? escapeHtml(str) : str;

    if (!users || users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:#94a3b8; font-weight:500;">Користувачів за вказаними критеріями не знайдено</td></tr>`;
        return;
    }

    users.forEach((user) => {
        const fullName = `${user.last_name || ''} ${user.first_name || ''}`.trim();
        const roleLabel = Number(user.role_id) === 1 ? 'Адміністратор' : Number(user.role_id) === 2 ? 'Викладач' : 'Студент';
        const roleBadgeColor = Number(user.role_id) === 1 ? '#ef4444' : Number(user.role_id) === 2 ? '#3b82f6' : '#10b981';
        
        let metaLabel = '<span style="color:#94a3b8; font-style:italic;">Немає даних</span>';
        
        if (Number(user.role_id) === 2) {
            const depName = user.department_short || user.department_name || 'Не вказано';
            metaLabel = `<span style="display:inline-flex; align-items:center; gap:6px;"><i class="fa-solid fa-id-card-clip" style="color:#3b82f6;"></i> Каф. <b style="color:#1e293b;">${safeEscape(depName)}</b></span>`;
        } else if (Number(user.role_id) === 3) {
            const course = typeof detectCourseFromGroup === 'function' ? detectCourseFromGroup(user) : '?';
            metaLabel = `<span style="display:inline-flex; align-items:center; gap:6px;"><i class="fa-solid fa-graduation-cap" style="color:#10b981;"></i> Група: <b style="color:#1e293b;">${safeEscape(user.group_name || 'Немає')}</b> <span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:600;">${course} курс</span></span>`;
        } else if (Number(user.role_id) === 1) {
            metaLabel = `<span style="color:#475569; font-weight:600;"><i class="fa-solid fa-shield-halved" style="color:#cbd5e1; margin-right:4px;"></i> Admin</span>`;
        }

        const tr = document.createElement('tr');
        tr.id = `user-row-${user.id}`;
        tr.style.cssText = `border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #334155; transition: background 0.15s ease; position: relative;`;
        
        tr.onmouseenter = () => tr.style.backgroundColor = '#f8fafc';
        tr.onmouseleave = () => tr.style.backgroundColor = 'transparent';

        tr.innerHTML = `
            <td style="padding: 14px 16px;">
                <div style="font-weight: 600; color: #0f172a; font-size:14.5px;">${safeEscape(fullName)}</div>
                <div style="font-size: 12px; color: #64748b; margin-top:2px;"><i class="fa-solid fa-phone" style="font-size:10px; margin-right:4px; color:#cbd5e1;"></i>${safeEscape(user.phone || 'Немає телефону')}</div>
            </td>
            <td style="padding: 14px 16px; font-weight:500; color:#475569;">${safeEscape(user.email)}</td>
            <td style="padding: 14px 16px;">
                <span style="background:${roleBadgeColor}12; color:${roleBadgeColor}; padding:5px 12px; border-radius:6px; font-size:12px; font-weight:700; display:inline-block;">
                    ${roleLabel}
                </span>
            </td>
            <td style="padding: 14px 16px;">
                ${metaLabel}
                <div id="user-error-${user.id}" style="display:none; margin-top:6px; color:#ef4444; font-size:11px; font-weight:600; background:#fef2f2; padding:4px 8px; border-radius:4px; border:1px solid #fee2e2;"></div>
            </td>
            <td style="padding: 14px 16px; text-align: center;">
                <div style="display: flex; gap: 4px; justify-content: center; align-items: center;">
                    <button type="button" onclick="prepareEditUser(${user.id})" style="background:none; border:none; color:#2563eb; cursor:pointer; font-weight:600; font-size:13px; padding:6px 10px; border-radius:4px;">
                        <i class="fa-solid fa-pen-to-square"></i> Ред.
                    </button>
                    <button type="button" onclick="askDeleteUser(${user.id})" style="background:none; border:none; color:#dc2626; cursor:pointer; font-weight:600; font-size:13px; padding:6px 10px; border-radius:4px;">
                        <i class="fa-solid fa-trash-can"></i> Видалити
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openUserModal(mode = 'create') {
    const modal = document.getElementById('userFormModal');
    if (!modal) return;
    
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const form = document.getElementById('crudUserForm');
    if (form) form.reset();
    
    const inputs = ['form-user-name', 'form-user-email', 'form-user-phone', 'form-user-password', 'form-user-role', 'meta-student-select', 'meta-teacher-select'];
    inputs.forEach(id => {
        const inp = document.getElementById(id);
        if (inp) { 
            inp.style.borderColor = '#cbd5e1'; 
            inp.style.background = id.includes('select') ? '#ffffff' : '#f8fafc'; 
        }
    });

    const errorIds = ['error-user-name', 'error-user-email', 'error-user-password', 'error-user-meta'];
    errorIds.forEach(id => {
        const err = document.getElementById(id);
        if (err) err.style.display = 'none';
    });

    const title = document.getElementById('modalUserTitle');
    const passLabel = document.getElementById('label-user-password');
    const passHelp = document.getElementById('password-help');
    const passInput = document.getElementById('form-user-password');

    if (document.getElementById('form-user-id')) document.getElementById('form-user-id').value = '';

    if (mode === 'create') {
        if(title) title.innerText = 'Додати нового користувача';
        if(passLabel) passLabel.innerHTML = 'Пароль <span style="color: #f43f5e;">*</span>';
        if(passInput) passInput.required = true;
        if(passHelp) passHelp.style.display = 'none';
        
        const roleSelect = document.getElementById('form-user-role');
        if (roleSelect) roleSelect.value = '';
        toggleMetaFieldLabel(); // Скине відомості на заблоковане поле за замовчуванням
    } else {
        if(title) title.innerText = 'Редагувати профіль користувача';
        if(passLabel) passLabel.innerText = 'Змінити пароль';
        if(passInput) passInput.required = false; 
        if(passHelp) passHelp.style.display = 'block';
    }
}

// завантаження даних для редагування
function prepareEditUser(userId) {
    const activeCache = window.localUsersCache || (typeof localUsersCache !== 'undefined' ? localUsersCache : null);
    if (!activeCache || !Array.isArray(activeCache)) {
        console.error("Кеш користувачів відсутній.");
        return;
    }

    const user = activeCache.find(u => Number(u.id) === Number(userId));
    if (!user) return;

    openUserModal('edit');
    
    // Наповнюємо текстові поля
    if (document.getElementById('form-user-id')) document.getElementById('form-user-id').value = user.id;
    if (document.getElementById('form-user-name')) document.getElementById('form-user-name').value = `${user.last_name || ''} ${user.first_name || ''}`.trim();
    if (document.getElementById('form-user-email')) document.getElementById('form-user-email').value = user.email || '';
    if (document.getElementById('form-user-phone')) document.getElementById('form-user-phone').value = user.phone || '';

    // Встановлюємо роль користувача
    const roleSelect = document.getElementById('form-user-role');
    if (roleSelect) {
        roleSelect.value = String(user.role_id);
    }

    // Визначаємо збережене ID мета-даних з об'єкта бази даних
    let savedMetaValue = null;
    const currentRole = Number(user.role_id);
    
    if (currentRole === 3) {
        savedMetaValue = user.group_id; 
    } else if (currentRole === 2) {
        savedMetaValue = user.department_id; 
    } else if (currentRole === 1) {
        savedMetaValue = "Admin";
    }

    // Ініціюємо примусове перемикання полів з передачею збереженого ID
    toggleMetaFieldLabel(savedMetaValue);
}

function closeUserModal() {
    const modal = document.getElementById('userFormModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = ''; 
}

// поле відповідно ролі
function toggleMetaFieldLabel(selectedValue = null) {
    const roleSelect = document.getElementById('form-user-role');
    const metaLabel = document.getElementById('form-meta-label');
    const errorMeta = document.getElementById('error-user-meta');
    
    if (errorMeta) errorMeta.style.display = 'none';
    if (!roleSelect || !metaLabel) return;

    // Перетворюємо у число для надійності порівняння з БД
    const role = Number(roleSelect.value);

    const defInput = document.getElementById('meta-default');
    const studentSelect = document.getElementById('meta-student-select');
    const teacherSelect = document.getElementById('meta-teacher-select');
    const adminInput = document.getElementById('meta-admin-input');

    // Ховаємо всі контейнери
    [defInput, studentSelect, teacherSelect, adminInput].forEach(el => {
        if (el) el.style.display = 'none';
    });

    if (role === 3) { // СТУДЕНТ -> Показуємо групи
        metaLabel.innerHTML = 'Група <span style="color: #f43f5e;">*</span>';
        if (studentSelect) {
            studentSelect.style.display = 'block';
            studentSelect.innerHTML = '<option value="" disabled selected>Оберіть групу...</option>';
            
            if (window.globalGroups && Array.isArray(window.globalGroups)) {
                window.globalGroups.forEach(g => {
                    const isSelected = (selectedValue !== null && Number(g.id) === Number(selectedValue)) ? 'selected' : '';
                    studentSelect.innerHTML += `<option value="${g.id}" ${isSelected}>${g.name}</option>`;
                });
            }
            if (selectedValue !== null) studentSelect.value = String(selectedValue);
        }
    } 
    else if (role === 2) { // ВИКЛАДАЧ -> Показуємо кафедри
        metaLabel.innerHTML = 'Спеціальність <span style="color: #f43f5e;">*</span>';
        if (teacherSelect) {
            teacherSelect.style.display = 'block';
            teacherSelect.innerHTML = '<option value="" disabled selected>Оберіть спеціальність...</option>';
            
            if (window.globalDepartments && Array.isArray(window.globalDepartments)) {
                window.globalDepartments.forEach(d => {
                    const isSelected = (selectedValue !== null && Number(d.id) === Number(selectedValue)) ? 'selected' : '';
                    teacherSelect.innerHTML += `<option value="${d.id}" ${isSelected}>${d.short_name || d.name}</option>`;
                });
            }
            if (selectedValue !== null) teacherSelect.value = String(selectedValue);
        }
    } 
    else if (role === 1) { // АДМІНІСТРАТОР -> Автоматом текст Admin
        metaLabel.innerHTML = 'Додаткові відомості (Системне поле)';
        if (adminInput) {
            adminInput.style.display = 'block';
            adminInput.value = 'Admin';
        }
    } 
    else { // Якщо роль не вибрана
        metaLabel.innerHTML = 'Додаткові відомості (Системне поле)';
        if (defInput) defInput.style.display = 'block';
    }
}


// збереження
async function validateAndSaveUserForm(event) {
    if (event) event.preventDefault();
    
    const userId = document.getElementById('form-user-id')?.value || '';
    const nameInput = document.getElementById('form-user-name');
    const emailInput = document.getElementById('form-user-email');
    const passwordInput = document.getElementById('form-user-password');
    const roleSelect = document.getElementById('form-user-role');

    const errorName = document.getElementById('error-user-name');
    const errorEmail = document.getElementById('error-user-email');
    const errorPassword = document.getElementById('error-user-password');
    const errorMeta = document.getElementById('error-user-meta');

    let isFormValid = true;

    // Скидання стилів помилок для інпутів
    [nameInput, emailInput, passwordInput, roleSelect].forEach(input => {
        if (input) { input.style.borderColor = '#cbd5e1'; input.style.background = '#f8fafc'; }
    });
    ['meta-student-select', 'meta-teacher-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.borderColor = '#cbd5e1'; el.style.background = '#ffffff'; }
    });
    
    if (errorName) errorName.style.display = 'none';
    if (errorEmail) errorEmail.style.display = 'none';
    if (errorPassword) errorPassword.style.display = 'none';
    if (errorMeta) errorMeta.style.display = 'none';

    // 1. Валідація ПІБ (Прізвище + Ім'я)
    const nameValue = nameInput ? nameInput.value.trim() : '';
    const nameParts = nameValue.split(/\s+/);
    if (!nameValue || nameParts.length < 2) {
        if (nameInput) { nameInput.style.borderColor = '#ef4444'; nameInput.style.background = '#fef2f2'; }
        if (errorName) errorName.style.display = 'block';
        isFormValid = false;
    }

    // 2. Валідація Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailValue = emailInput ? emailInput.value.trim() : '';
    if (!emailRegex.test(emailValue)) {
        if (emailInput) { emailInput.style.borderColor = '#ef4444'; emailInput.style.background = '#fef2f2'; }
        if (errorEmail) errorEmail.style.display = 'block';
        isFormValid = false;
    }

    // 3. Валідація Пароля (Тільки при створенні нового юзера обов'язковий)
    const passwordValue = passwordInput ? passwordInput.value : '';
    if (!userId && (!passwordValue || passwordValue.length < 6)) {
        if (passwordInput) { passwordInput.style.borderColor = '#ef4444'; passwordInput.style.background = '#fef2f2'; }
        if (errorPassword) errorPassword.style.display = 'block';
        isFormValid = false;
    }

    // 4. Валідація Ролі
    const roleValue = roleSelect ? roleSelect.value.trim() : '';
    if (!roleValue) {
        if (roleSelect) { roleSelect.style.borderColor = '#ef4444'; roleSelect.style.background = '#fef2f2'; }
        isFormValid = false;
    }

    const mappedRole = parseInt(roleValue, 10);
    let metaValue = 'Admin';
    let currentActiveInput = null;

    if (mappedRole === 3) { 
        currentActiveInput = document.getElementById('meta-student-select');
        metaValue = currentActiveInput ? currentActiveInput.value : '';
    } else if (mappedRole === 2) { 
        currentActiveInput = document.getElementById('meta-teacher-select');
        metaValue = currentActiveInput ? currentActiveInput.value : '';
    } else if (mappedRole === 1) { 
        metaValue = 'Admin';
    }

    // 5. Валідація мета-даних (Кафедра / Група)
    if ((mappedRole === 2 || mappedRole === 3) && (!metaValue || metaValue === "")) {
        if (currentActiveInput) { 
            currentActiveInput.style.borderColor = '#ef4444'; 
            currentActiveInput.style.background = '#fef2f2'; 
        }
        if (errorMeta) errorMeta.style.display = 'block';
        isFormValid = false;
    }

    if (!isFormValid) {
        if (typeof showSystemToast === 'function') showSystemToast('Будь ласка, заповніть усі обов’язкові поля!', 'danger');
        return;
    }

    // Збір чистих даних для бекенду
    const token = window.state?.token || localStorage.getItem('token') || '';
    
    // Безпечне отримання базового API URL
    let baseApiUrl = window.CONFIG?.apiUrl || '/api';
    if (baseApiUrl.endsWith('/')) baseApiUrl = baseApiUrl.slice(0, -1);

    const lastName = nameParts[0] || '';
    const firstName = nameParts.slice(1).join(' ') || '';
    const phoneValue = document.getElementById('form-user-phone')?.value.trim() || '';

    const payload = {
        last_name: lastName,
        first_name: firstName,
        email: emailValue,
        role_id: mappedRole,
        phone: phoneValue || null,
        group_id: mappedRole === 3 ? parseInt(metaValue, 10) : null,
        department_id: mappedRole === 2 ? parseInt(metaValue, 10) : null
    };

    if (passwordValue && passwordValue.trim()) {
        payload.password = passwordValue;
    }

    // Гнучке формування шляху (якщо використовується сервісна функція getApiUrl)
    let url = userId ? `/api/admin/users/${userId}` : '/api/admin/users';
    if (typeof getApiUrl === 'function') {
        url = getApiUrl(url);
    } else {
        url = `${baseApiUrl}/admin/users${userId ? '/' + userId : ''}`;
    }

    const method = userId ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Сталася помилка при збереженні.');

        // 1. Закриваємо модальне вікно форми
        closeUserModal();
        
        // 2. Показуємо красиве сповіщення перед очима
        if (typeof showSystemToast === 'function') {
            showSystemToast(userId ? 'Профіль успішно оновлено!' : 'Користувача додано в систему!', 'success');
        }
        
        // 3.  РЕАКТИВНЕ ОНОВЛЕННЯ ТАБЛИЦІ (Без перезавантаження сторінки)
        if (typeof loadAdminUsersTable === 'function') {
            await loadAdminUsersTable(); 
        }

        // 4.  ГРАФІКІВ ТА АНАЛІТИКИ (Оновлюємо дашборд відразу)
        if (typeof loadStatsAndChartsFromDB === 'function') {
            await loadStatsAndChartsFromDB(); 
        } else if (typeof updateDashboardCharts === 'function') {
            await updateDashboardCharts();
        }

    } catch (error) {
        console.error("❌ Помилка збереження користувача:", error);
        if (typeof showSystemToast === 'function') showSystemToast(error.message, 'danger');
    }
}

// видалення
function askDeleteUser(id) {
    if (document.getElementById('delete-confirm-modal')) return;

    userIdToDelete = id; 
    const activeCache = window.localUsersCache || (typeof localUsersCache !== 'undefined' ? localUsersCache : []);
    const user = activeCache.find(u => Number(u.id) === Number(id));
    const currentName = user ? `${user.last_name || ''} ${user.first_name || ''}`.trim() : 'Користувач';

    const safeEscape = (str) => typeof escapeHtml === 'function' ? escapeHtml(str) : str;

    const modalHtml = `
    <div id="delete-confirm-modal" style="position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(15, 23, 42, 0.75) !important; backdrop-filter: blur(5px) !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 9999999 !important;">
        <div class="custom-modal-card" style="background: #1e293b !important; padding: 32px !important; border-radius: 16px !important; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important; max-width: 400px !important; width: 90% !important; text-align: center !important; position: relative !important; z-index: 10000000 !important; border: 1px solid #334155 !important;">
            <div class="custom-modal-icon" style="width: 56px !important; height: 56px !important; background: rgba(239, 68, 68, 0.15) !important; color: #f87171 !important; border-radius: 50% !important; display: flex !important; align-items: center !important; justify-content: center !important; margin: 0 auto 16px !important; font-size: 24px !important;">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <h3 style="font-size: 20px !important; font-weight: 700 !important; color: #f8fafc !important; margin-bottom: 8px !important; font-family: sans-serif !important;">Видалити користувача?</h3>
            <p id="deleteConfirmText" style="font-size: 14px !important; color: #94a3b8 !important; margin-bottom: 24px !important; line-height: 1.6 !important; font-family: sans-serif !important;">
                Ви дійсно бажаєте видалити користувача
                <span style="display: block !important; color: #ffffff !important; font-weight: 700 !important; font-size: 16px !important; margin: 6px 0 10px 0 !important;">${safeEscape(currentName)}</span>
                <span style="font-size: 12px; color: #64748b; display: block;">Цю дію не можна буде скасувати.</span>
            </p>
            <div class="custom-modal-buttons" style="display: flex !important; gap: 12px !important; justify-content: center !important;">
                <button id="modal-cancel-btn" type="button" style="padding: 10px 20px !important; border-radius: 8px !important; font-size: 14px !important; font-weight: 600 !important; cursor: pointer !important; background: #334155 !important; border: 1px solid #475569 !important; color: #cbd5e1 !important; transition: all 0.2s !important; min-width: 110px !important;">Скасувати</button>
                <button id="confirmDeleteBtn" type="button" style="padding: 10px 20px !important; border-radius: 8px !important; font-size: 14px !important; font-weight: 600 !important; cursor: pointer !important; background: #ef4444 !important; border: none !important; color: #ffffff !important; transition: all 0.2s !important; min-width: 110px !important;">Видалити</button>
            </div>
        </div>
    </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';

    const modalEl = document.getElementById('delete-confirm-modal');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    if (cancelBtn) {
        cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#475569');
        cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = '#334155');
        cancelBtn.addEventListener('click', (e) => { e.preventDefault(); closeDeleteModal(); });
    }
    if (confirmBtn) {
        confirmBtn.addEventListener('mouseenter', () => confirmBtn.style.background = '#dc2626');
        confirmBtn.addEventListener('mouseleave', () => confirmBtn.style.background = '#ef4444');
        confirmBtn.addEventListener('click', (e) => { 
            e.preventDefault(); 
            executeUserDeletion(); 
        });
    }

    modalEl.querySelector('.custom-modal-card')?.addEventListener('click', (e) => e.stopPropagation());
    modalEl.addEventListener('click', (e) => { e.preventDefault(); closeDeleteModal(); });
}

function closeDeleteModal() {
    const modal = document.getElementById('delete-confirm-modal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

// видалення
async function executeUserDeletion() {
    const userId = userIdToDelete; 
    if (!userId) return;

    const token = window.state?.token || localStorage.getItem('token') || '';
    let apiUrl = window.CONFIG?.apiUrl || (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '/api');
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    
    closeDeleteModal();

    try {
        const response = await fetch(`${apiUrl}/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Помилка при видаленні користувача.');

        userIdToDelete = null;

        if (typeof showSystemToast === 'function') showSystemToast('🗑️ Користувача та всі його дані успішно видалено!', 'success');

        if (typeof loadAdminUsersTable === 'function') {
            await loadAdminUsersTable(); 
        }
        
        if (typeof loadStatsAndChartsFromDB === 'function') {
            await loadStatsAndChartsFromDB(); 
        } else if (typeof updateDashboardCharts === 'function') {
            await updateDashboardCharts();
        }

    } catch (error) {
        console.error("❌ Помилка видалення користувача:", error);
        if (typeof showSystemToast === 'function') showSystemToast(error.message, 'danger');
        userIdToDelete = null;
    }
}

// скидання фільтрів
function clearUserFilters() {
    const searchInput = document.getElementById('user-search');
    const roleSelect = document.getElementById('user-role-filter');
    const courseSelect = document.getElementById('user-course-filter');
    const metaSelect = document.getElementById('user-meta-filter');

    // 1. Скидаємо текстові значення
    if (searchInput) searchInput.value = '';
    if (roleSelect) roleSelect.value = 'all';
    if (courseSelect) courseSelect.value = 'all';
    if (metaSelect) metaSelect.value = 'all';

    // 2. Примусово оновлюємо видимість та доступність
    if (typeof handleRoleAndCourseFilters === 'function') {
        handleRoleAndCourseFilters('all', 'all');
    }

    // 3. Перерендерюємо таблицю через єдину точку входу
    if (typeof applyUsersFiltersAndRender === 'function') {
        applyUsersFiltersAndRender();
    } else {
        // Резервний варіант, якщо головного рендерера немає в цьому модулі
        const cache = window.localUsersCache || (typeof localUsersCache !== 'undefined' ? localUsersCache : null);
        if (cache && typeof renderUsersTable === 'function') {
            renderUsersTable(cache);
        }
    }
}

// розклад
if (!window.CONFIG) window.CONFIG = {};
CONFIG.lessonsMapping = {
    1: { name: "1 пара", time: "08:30 - 09:50" },
    2: { name: "2 пара", time: "10:00 - 11:20" },
    3: { name: "3 пара", time: "11:40 - 13:00" },
    4: { name: "4 пара", time: "13:20 - 14:40" }
};

const weekdaysConfig = [
    { id: 1, name: "ПОНЕДІЛОК" },
    { id: 2, name: "ВІВТОРОК" },
    { id: 3, name: "СЕРЕДА" },
    { id: 4, name: "ЧЕТВЕР" },
    { id: 5, name: "П'ЯТНИЦЯ" }
];

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 Запуск архітектури адмін-панелі розкладу...");
    
    // 1. Негайно виставляємо дату, щоб календар не був порожнім
    const adminDateInput = document.getElementById('schedule-admin-date');
    if (adminDateInput) {
        if (!adminDateInput.value) {
            const today = new Date();
            const offset = today.getTimezoneOffset();
            const localToday = new Date(today.getTime() - (offset * 60 * 1000));
            adminDateInput.value = localToday.toISOString().split('T')[0];
        }
        window.currentScheduleDate = new Date(adminDateInput.value);
        
        // Ізольований слухач зміни дати
        adminDateInput.onchange = async (e) => {
            if (e.target.value) {
                window.currentScheduleDate = new Date(e.target.value);
                console.log("📅 Дата змінена на:", e.target.value);
                
                // Перераховуємо дати тижня
                window.currentWeekDaysMap = calculateWeekDates(window.currentScheduleDate);
                
                if (typeof window.syncAdminScheduleWeekMeta === 'function') {
                    window.syncAdminScheduleWeekMeta(window.currentScheduleDate);
                }
                if (typeof syncWeekAndLoad === 'function') {
                    await syncWeekAndLoad();
                } else if (typeof loadGlobalMatrix === 'function') {
                    await loadGlobalMatrix();
                }
            }
        };
    }

    // Ініціалізуємо карту дат для поточного тижня
    window.currentWeekDaysMap = calculateWeekDates(window.currentScheduleDate || new Date());

    try {
        if (typeof loadSemestersConfig === 'function') {
            console.log("⏳ Завантаження конфігурації періодів та семестрів...");
            await loadSemestersConfig();
        } else {
            console.warn("⚠️ Функцію loadSemestersConfig не знайдено в глобальному контексті!");
        }

        // Завантажуємо базові довідники в усі селектори (включаючи фільтри матриці)
        await loadFilterOptionsAndInitialData();

        // Ініціалізуємо фільтри аналітики та матриці
        await initAdminDashboardFilters();
        setupFilterEventListeners(); // 🔥 ТУТ ініціалізуються ВСІ change-слухачі для обох панелей
        setupAnalyticsResetListener();

        // 3. Синхронізуємо мета-дані тижня для адмінки
        if (typeof window.syncAdminScheduleWeekMeta === 'function' && window.currentScheduleDate) {
            window.syncAdminScheduleWeekMeta(window.currentScheduleDate);
        }

        // 4. Запускаємо генерацію сітки розкладу
        if (typeof syncWeekAndLoad === 'function') {
            console.log("🔄 Синхронізація тижня та рендер матриці...");
            await syncWeekAndLoad();
        } else if (typeof loadGlobalMatrix === 'function') {
            await loadGlobalMatrix();
        }

        // Ініціалізуємо слухачі каскаду модалки розкладу
        setupScheduleModalEventListeners();

    } catch (initError) {
        console.error("❌ Критичний збій під час завантаження конфігів адмінки:", initError);
    }

    // 5. Налаштування форми (Переведено на addEventListener для надійності)
    const schedForm = document.getElementById('matrix-schedule-form');
    if (schedForm) {
        schedForm.addEventListener('submit', saveScheduleFromModal);
    }

    // 6. Слухачі кнопок модалок
    const assignClick = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    
    assignClick('close-matrix-modal-btn', closeMatrixScheduleModal);
    assignClick('cancel-matrix-modal-btn', closeMatrixScheduleModal);
    assignClick('close-matrix-delete-btn', closeMatrixDeleteModal);
    assignClick('cancel-matrix-delete-btn', closeMatrixDeleteModal);
    assignClick('execute-matrix-delete-btn', executeDeleteMatrixLesson);
    
    // Очищення каскаду фільтрів розкладу
    assignClick('matrix-reset-btn', async (e) => {
        if (e) e.preventDefault();
        const dF = document.getElementById('matrix-dept-filter');
        const cF = document.getElementById('matrix-course-filter');
        const gF = document.getElementById('matrix-group-filter');
        if (dF) dF.value = 'all';
        if (cF) cF.value = 'all';
        if (gF) gF.value = 'all';
        
        // Викликаємо коректну функцію каскаду заміні неіснуючої
        if (typeof updateCourseAndGroupFilters === 'function') {
            await updateCourseAndGroupFilters(null, 'matrix');
        }
        if (typeof loadGlobalMatrix === 'function') await loadGlobalMatrix();
    });

    // 7. Обробка потокових лекцій
    const streamCheckbox = document.getElementById('modal-sch-is-stream');
    if (streamCheckbox) {
        streamCheckbox.onchange = () => {
            if (streamCheckbox.checked) {
                if (typeof clearModalError === 'function') clearModalError();
            } else {
                checkFormConflicts();
            }
        };
    }

    if (typeof setupModalErrorContainer === 'function') setupModalErrorContainer();

    // 10. Миттєва перевірка накладок у модалці
    ['modal-sch-day', 'modal-sch-pair-number', 'modal-sch-week-type', 'modal-sch-room'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.onchange = checkFormConflicts;
            if (id === 'modal-sch-room') el.oninput = checkFormConflicts;
        }
    });
});

// Функція розрахунку дат для кожного дня поточного тижня (Понеділок - Субота)
function calculateWeekDates(baseDate) {
    const current = new Date(baseDate);
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(current.setDate(diff));
    
    const weekMap = {};
    for (let i = 1; i <= 6; i++) {
        const nextDay = new Date(monday);
        nextDay.setDate(monday.getDate() + (i - 1));
        weekMap[i] = nextDay.toISOString().split('T')[0];
    }
    return weekMap;
}

// Helper для отримання токена та базового URL
function getScheduleFetchMeta() {
    const token = (typeof window.state !== 'undefined' && window.state?.token) ? window.state.token : (localStorage.getItem('token') || '');
    let apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '/api');
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    return { token, apiUrl };
}

async function loadFilterOptionsAndInitialData() {
    const { token, apiUrl } = getScheduleFetchMeta();
    if (!apiUrl) return;

    async function safeFetchArray(endpoint) {
        try {
            const cleanEndpoint = endpoint.startsWith('/admin') ? endpoint : `/admin${endpoint}`;
            const res = await fetch(`${apiUrl}${cleanEndpoint}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            const contentType = res.headers.get("content-type") || "";
            if (!res.ok || !contentType.includes("application/json")) return null;
            return await res.json();
        } catch (err) {
            return null;
        }
    }

    try {
        console.log("📥 Первинне стягування єдиних довідників та фільтрів...");
        
        const [groups, subjects, teachers] = await Promise.all([
            safeFetchArray('/groups'),
            safeFetchArray('/subjects'),
            safeFetchArray('/teachers')
        ]);

        if (groups) {
            window.globalGroups = groups;
            window.matrixActiveGroupIds = groups.map(g => g.id);
        }
        if (subjects) window.dbSubjects = subjects;
        if (teachers) window.dbTeachers = teachers;

        // Наповнюємо селектори груп
        const groupSelectors = [
            'analytics-group-filter', 
            'sch-group', 
            'report-criteria-group', 
            'schedule-group-filter', 
            'modal-sch-group', 
            'matrix-group-filter'
        ];
        
        groupSelectors.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            
            el.innerHTML = (id === 'schedule-group-filter' || id === 'modal-sch-group') 
                ? '<option value="">🔍 Оберіть групу з бази даних</option>' 
                : '<option value="all">Усі академічні групи</option>';
            
            if (Array.isArray(groups)) {
                groups.forEach(g => {
                    const val = (id === 'analytics-group-filter') ? g.name : g.id;
                    el.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(String(val))}">${escapeHtml(g.name)}</option>`);
                });
            }
        });

        populateSubjectsDropdown(window.dbSubjects);
        populateTeachersDropdown(window.dbTeachers);

        if (typeof initAdminDashboardFilters === 'function') {
            await initAdminDashboardFilters();
        }

    } catch (err) {
        console.error("❌ Загальна помилка наповнення довідників:", err);
    }
}

async function initAdminDashboardFilters() {
    const { token, apiUrl } = getScheduleFetchMeta();
    if (!apiUrl) return;

    try {
        const specRes = await fetch(`${apiUrl}/admin/analytics/specialties`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        }).catch(() => null);
        
        if (specRes && specRes.ok) {
            const specialties = await specRes.json().catch(() => []);
            
            const specFilters = [
                document.getElementById('analytics-specialty-filter'),
                document.getElementById('matrix-dept-filter')
            ];

            specFilters.forEach(filter => {
                if (!filter) return;
                filter.innerHTML = '<option value="all">Усі спеціальності</option>';
                if (Array.isArray(specialties)) {
                    specialties.forEach(s => {
                        const shortName = s.short_name || '';
                        const fullName = s.name || '';
                        filter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(shortName)}">${escapeHtml(shortName)} — ${escapeHtml(fullName)}</option>`);
                    });
                }
            });
        }
        
        await updateCourseAndGroupFilters(null, 'analytics');
        await updateCourseAndGroupFilters(null, 'matrix');
        
    } catch (e) {
        console.error("Помилка ініціалізації фільтрів адміна:", e);
    }
}

async function updateCourseAndGroupFilters(event, forcePrefix = null) {
    const { token, apiUrl } = getScheduleFetchMeta();
    if (!apiUrl) return;

    let prefix = forcePrefix;
    if (event && event.target) {
        prefix = event.target.id.startsWith('matrix') ? 'matrix' : 'analytics';
    }
    if (!prefix) prefix = 'analytics';

    const specFilter = prefix === 'matrix' ? document.getElementById('matrix-dept-filter') : document.getElementById('analytics-specialty-filter');
    const courseFilter = prefix === 'matrix' ? document.getElementById('matrix-course-filter') : document.getElementById('analytics-course-filter');
    const groupFilter = prefix === 'matrix' ? document.getElementById('matrix-group-filter') : document.getElementById('analytics-group-filter');

    const selectedSpecialty = specFilter?.value || 'all';
    const triggerElement = event ? event.target : specFilter;

    try {
        if (!event || triggerElement === specFilter) {
            const res = await fetch(`${apiUrl}/admin/analytics/filter-meta?specialty=${encodeURIComponent(selectedSpecialty)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => null);

            if (res && res.ok) {
                const meta = await res.json().catch(() => ({ courses: [] }));
                const prevCourse = courseFilter ? courseFilter.value : 'all';

                if (courseFilter) {
                    courseFilter.innerHTML = '<option value="all">Усі курси</option>';
                    if (meta && meta.courses && Array.isArray(meta.courses)) {
                        meta.courses.map(Number).sort((a,b) => a - b).forEach(c => {
                            courseFilter.insertAdjacentHTML('beforeend', `<option value="${c}">${c} курс</option>`);
                        });
                    }
                    courseFilter.value = meta.courses?.map(String).includes(String(prevCourse)) ? prevCourse : 'all';
                }
            }
        }

        const currentCourse = courseFilter ? courseFilter.value : 'all';
        const prevGroup = groupFilter ? groupFilter.value : 'all';

        const groupsRes = await fetch(`${apiUrl}/admin/analytics/groups?specialty=${encodeURIComponent(selectedSpecialty)}&course=${encodeURIComponent(currentCourse)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null);

        if (groupsRes && groupsRes.ok && groupFilter) {
            const filteredGroups = await groupsRes.json().catch(() => []);
            groupFilter.innerHTML = '<option value="all">Усі академічні групи</option>';
            
            if (Array.isArray(filteredGroups)) {
                filteredGroups.forEach(gName => {
                    let optionValue = gName;
                    if (prefix === 'matrix' && window.globalGroups) {
                        const found = window.globalGroups.find(g => g.name === gName);
                        if (found) optionValue = found.id;
                    }
                    groupFilter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(String(optionValue))}">${escapeHtml(gName)}</option>`);
                });

                groupFilter.value = prevGroup;
            }

            if (prefix === 'matrix' && window.globalGroups) {
                if (groupFilter.value !== 'all') {
                    window.matrixActiveGroupIds = [Number(groupFilter.value)];
                } else if (selectedSpecialty === 'all' && currentCourse === 'all') {
                    window.matrixActiveGroupIds = window.globalGroups.map(g => g.id);
                } else {
                    window.matrixActiveGroupIds = window.globalGroups
                        .filter(g => filteredGroups.includes(g.name))
                        .map(g => g.id);
                }
            }
        }
    } catch (e) {
        console.error("Не вдалося динамічно оновити фільтри:", e);
    }
}

function setupFilterEventListeners() {
    const specFilter = document.getElementById('analytics-specialty-filter');
    const courseFilter = document.getElementById('analytics-course-filter');
    const groupFilter = document.getElementById('analytics-group-filter');

    if (specFilter) specFilter.addEventListener('change', onSpecialtyOrCourseChange);
    if (courseFilter) courseFilter.addEventListener('change', onSpecialtyOrCourseChange);
    if (groupFilter) {
        groupFilter.addEventListener('change', async () => {
            if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
        });
    }

    const mSpecFilter = document.getElementById('matrix-dept-filter');
    const mCourseFilter = document.getElementById('matrix-course-filter');
    const mGroupFilter = document.getElementById('matrix-group-filter');

    if (mSpecFilter) mSpecFilter.addEventListener('change', onMatrixFilterChange);
    if (mCourseFilter) mCourseFilter.addEventListener('change', onMatrixFilterChange);
    if (mGroupFilter) {
        mGroupFilter.addEventListener('change', () => {
            if (mGroupFilter.value !== 'all') {
                window.matrixActiveGroupIds = [Number(mGroupFilter.value)];
            } else {
                onMatrixFilterChange({ target: mCourseFilter });
                return;
            }
            if (typeof loadGlobalMatrix === 'function') loadGlobalMatrix();
        });
    }
}

async function onSpecialtyOrCourseChange(event) {
    await updateCourseAndGroupFilters(event, 'analytics');
    if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
}

async function onMatrixFilterChange(event) {
    await updateCourseAndGroupFilters(event, 'matrix');
    if (typeof loadGlobalMatrix === 'function') loadGlobalMatrix();
}

async function rebuildGroupContextDropdowns(event) {
    if (window.isSyncingDropdowns) return;
    
    const { token, apiUrl } = getScheduleFetchMeta();
    if (!apiUrl) return;

    const groupSelect = document.getElementById('modal-sch-group');
    const mSubj = document.getElementById('modal-sch-subject');
    const mTeach = document.getElementById('modal-sch-teacher');
    const periodFilter = document.getElementById('schedule-period-filter') || document.getElementById('matrix-period-filter');
    const periodId = periodFilter ? periodFilter.value : '';
    
    if (!groupSelect || !mSubj || !mTeach) return;
    const groupId = groupSelect.value;
    
    // Якщо групу не обрано — очищаємо селектори
    if (!groupId || groupId === "" || groupId === "all") {
        mSubj.innerHTML = '<option value="" disabled selected>— Спочатку оберіть групу —</option>';
        mTeach.innerHTML = '<option value="" disabled selected>— Спочатку оберіть групу —</option>'; 
        window.currentGroupLoadMatrix = [];
        return;
    }

    window.isSyncingDropdowns = true;

    try {
        const url = `${apiUrl}/admin/schedule/filter-meta?group_id=${encodeURIComponent(groupId)}&period_id=${encodeURIComponent(periodId)}`;
        
        console.log(`📡 Запит мета-даних для групи ${groupId} у семестрі ${periodId || 'поточному'}...`);
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null);

        if (res && res.ok) {
            const data = await res.json().catch(() => ({ subjects: [], teachers: [], load_matrix: [] }));
            
            window.currentGroupLoadMatrix = data.load_matrix || [];
            window.currentContextSubjects = data.subjects || [];
            window.currentContextTeachers = data.teachers || [];

            // Перемальовуємо випадаючі списки новими, щойно прийшовшими даними
            populateSubjectsDropdown(window.currentContextSubjects);
            populateTeachersDropdown(window.currentContextTeachers);
        } else {
            mSubj.innerHTML = '<option value="" disabled selected>❌ Немає дисциплін для цієї групи</option>';
            mTeach.innerHTML = '<option value="" disabled selected>❌ Немає викладачів для цієї групи</option>';
            window.currentGroupLoadMatrix = [];
        }
    } catch (e) {
        console.error("❌ Помилка каскадного підвантаження розкладу:", e);
    } finally {
        window.isSyncingDropdowns = false;
    }
}

// розумна підстановка
function syncSubjectAndTeacherFields(triggerSource) {
    if (window.isFilteringDropdowns) return;

    const subjEl = document.getElementById('modal-sch-subject');
    const teachEl = document.getElementById('modal-sch-teacher');

    if (!subjEl || !teachEl) return;

    const selectedSubjectId = subjEl.value;
    const selectedTeacherId = teachEl.value;
    
    const loadMatrix = window.currentGroupLoadMatrix || [];
    if (loadMatrix.length === 0) return; // Немає матриці — нічого підставляти

    window.isFilteringDropdowns = true;

    // Скидаємо будь-які блокування, якщо вони десь залишилися (про всяк випадок)
    Array.from(subjEl.options).forEach(opt => { opt.disabled = false; opt.style.color = ""; });
    Array.from(teachEl.options).forEach(opt => { opt.disabled = false; opt.style.color = ""; });

    if (triggerSource === 'subject') {
        // --- ОБРАЛИ ПРЕДМЕТ -> Клієнт підказує вчителя ---
        if (selectedSubjectId) {
            // Шукаємо всіх вчителів, які закріплені за цим предметом у групі
            const allowedTeachers = loadMatrix.filter(item => String(item.subject_id) === String(selectedSubjectId));

            // Якщо такий вчитель один-єдиний — автоматично підставляємо його
            if (allowedTeachers.length === 1) {
                teachEl.value = allowedTeachers[0].teacher_id;
            }
        }
    } 
    else if (triggerSource === 'teacher') {
        // --- ОБРАЛИ ВЧИТЕЛЯ -> Клієнт підказує предмет ---
        if (selectedTeacherId) {
            // Шукаємо всі предмети, які цей вчитель веде в цій групі
            const allowedSubjects = loadMatrix.filter(item => String(item.teacher_id) === String(selectedTeacherId));

            // Якщо цей вчитель веде лише 1 предмет у цій групі — автоматично підставляємо його
            if (allowedSubjects.length === 1) {
                subjEl.value = allowedSubjects[0].subject_id;
            }
        }
    }

    window.isFilteringDropdowns = false;
}

function fallbackLocalFilter(prevSubj, prevTeach) {
    window.currentContextSubjects = window.dbSubjects || [];
    window.currentContextTeachers = window.dbTeachers || [];
    populateSubjectsDropdown(window.currentContextSubjects);
    populateTeachersDropdown(window.currentContextTeachers);
}

function setupScheduleModalEventListeners() {
    const groupSelect = document.getElementById('modal-sch-group');
    const subjSelect = document.getElementById('modal-sch-subject');
    const teachSelect = document.getElementById('modal-sch-teacher');

    if (groupSelect) groupSelect.onchange = async (e) => { await rebuildGroupContextDropdowns(e); checkFormConflicts(); };
    
    if (subjSelect) {
        subjSelect.onchange = () => { 
            syncSubjectAndTeacherFields('subject'); 
            checkFormConflicts(); 
        };
    }
    if (teachSelect) {
        teachSelect.onchange = () => { 
            syncSubjectAndTeacherFields('teacher'); 
            checkFormConflicts(); 
        };
    }
}

async function checkScheduleConflict(db, payload, ignoreId = null) {
    const { teacher_id, room_name, lesson_number, day_of_week, week_type, period_id, subject_id, is_stream } = payload;

    // Робимо JOIN на назву предмета, щоб адмін бачив, що саме веде викладач
    const conflictQuery = `
        SELECT s.id, s.subject_id, s.is_stream, s.room_name, sub.name as subject_name 
        FROM schedule s
        JOIN subjects sub ON s.subject_id = sub.id
        WHERE s.period_id = $1 
          AND s.lesson_number = $2 
          AND s.day_of_week = $3 
          AND (s.week_type = $4 OR s.week_type = 'always' OR $4 = 'always')
          AND (s.teacher_id = $5 OR s.room_name = $6)
          AND s.id != $7
    `;
    
    const res = await db.query(conflictQuery, [
        parseInt(period_id, 10), 
        parseInt(lesson_number, 10), 
        parseInt(day_of_week, 10), 
        week_type, 
        parseInt(teacher_id, 10), 
        room_name.trim(), 
        ignoreId ? parseInt(ignoreId, 10) : 0
    ]);

    if (res.rows.length > 0) {
        for (const existingLesson of res.rows) {
            
            // Якщо активовано потік або в БД вже потік, і предмети однакові — конфлікту немає
            if ((is_stream === true || is_stream === 'true' || existingLesson.is_stream) && 
                existingLesson.subject_id === parseInt(subject_id, 10)) {
                continue; 
            }
            
            // Якщо предмети ОДНАКОВІ, але галочку "Потік" забули поставити:
            if (existingLesson.subject_id === parseInt(subject_id, 10)) {
                return {
                    error: true,
                    type: 'STREAM_SUGGESTION',
                    message: `Викладач у цей час уже читає "${existingLesson.subject_name}" в ${existingLesson.room_name}. Бажаєте створити пару на потік (увімкніть галочку "Потік")?`
                };
            }
            
            // Жорсткий конфлікт: різні дисципліни
            if (existingLesson.room_name.toLowerCase() === room_name.trim().toLowerCase()) {
                return {
                    error: true,
                    type: 'ROOM_OCCUPIED',
                    message: `Аудиторія ${room_name} вже зайнята дисципліною "${existingLesson.subject_name}" на цей час!`
                };
            }

            return {
                error: true,
                type: 'TEACHER_BUSY',
                message: `Викладач уже веде предмет "${existingLesson.subject_name}" в ${existingLesson.room_name} на цій парі!`
            };
        }
    }
    return null; // Конфліктів немає
}

// матриця розкладу
async function loadGlobalMatrix() {
    const matrixWrapper = document.getElementById('matrix-wrapper');
    if (!matrixWrapper) return;

    const adminDateInput = document.getElementById('schedule-admin-date');
    const selectedDateStr = adminDateInput ? adminDateInput.value : new Date().toISOString().split('T')[0];
    const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
    
    const groupFilterValue = document.getElementById('matrix-group-filter')?.value || 'all';
    let currentCalculatedWeekCode = 'always'; 
    if (typeof getWeekType === 'function') {
        const weekInfo = getWeekType(new Date(selectedDateStr));
        if (weekInfo && weekInfo.code) {
            currentCalculatedWeekCode = weekInfo.code; // Отримуємо 'numerator' або 'denominator'
        }
    }

    try {
        matrixWrapper.innerHTML = `
            <div style="text-align:center; padding:50px 20px; color:#64748b; font-family:'Inter', system-ui, sans-serif;">
                <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 26px; color: #6366f1; margin-bottom: 12px;"></i>
                <div style="font-weight: 600; font-size: 14px; letter-spacing: 0.3px;">Синхронізація розкладу...</div>
            </div>
        `;
        
        const response = await fetch(`${CONFIG.apiUrl}/admin/schedule/all?date=${selectedDateStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const responseData = await response.json().catch(() => []);
        
        // ПЕРЕВІРКА НА КАНІКУЛИ 
        if (responseData && responseData.isVacation === true) {
            matrixWrapper.innerHTML = `
                <div style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    text-align: center;
                    background: #f8fafc;
                    border: 2px dashed #cbd5e1;
                    border-radius: 16px;
                    margin: 20px auto;
                    max-width: 600px;
                    font-family: 'Inter', system-ui, sans-serif;
                    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
                ">
                    <div style="
                        font-size: 55px;
                        margin-bottom: 16px;
                        display: inline-block;
                        animation: vacationFloat 3s ease-in-out infinite;
                    ">🌴</div>
                    <h3 style="
                        margin: 0 0 8px 0;
                        color: #1e293b;
                        font-size: 22px;
                        font-weight: 800;
                        letter-spacing: -0.5px;
                    ">Період канікул</h3>
                    <p style="
                        margin: 0;
                        color: #64748b;
                        font-size: 14px;
                        line-height: 1.5;
                        max-width: 420px;
                        font-weight: 500;
                    ">${responseData.message || 'У цей проміжок часу занять немає. Сітка відпочиває!'}</p>
                </div>
                
                <style>
                    @keyframes vacationFloat {
                        0% { transform: translateY(0px) rotate(0deg); }
                        50% { transform: translateY(-10px) rotate(4deg); }
                        100% { transform: translateY(0px) rotate(0deg); }
                    }
                </style>
            `;
            return; 
        }

        // Якщо канікул немає — записуємо масив занять, який прийшов від бази даних
        window.cachedLessons = Array.isArray(responseData) ? responseData : [];

        // Рендеримо тільки ті групи, які дозволені каскадом
        const visibleGroups = (window.globalGroups || []).filter(g => {
            if (groupFilterValue !== 'all') {
                return String(g.id) === String(groupFilterValue);
            }
            return window.matrixActiveGroupIds ? window.matrixActiveGroupIds.includes(g.id) : true;
        });

        if (visibleGroups.length === 0) {
            matrixWrapper.innerHTML = `<p style="text-align:center; padding:30px; color:#94a3b8; font-family:'Inter', system-ui, sans-serif;">Немає груп для відображення за обраними фільтрами.</p>`;
            return;
        }

        const weekdaysList = [
            {id: 1, name: 'Понеділок'}, {id: 2, name: 'Вівторок'}, {id: 3, name: 'Середа'},
            {id: 4, name: 'Четвер'}, {id: 5, name: 'П\'ятниця'}
        ];

        let html = `<table style="width: 100%; table-layout: fixed; border-collapse: collapse; min-width:1000px;">`;
        html += `<thead><tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;"><th style="padding: 12px; font-size:12px; font-weight:700; color:#475569; width:120px; text-align:center;">ДЕНЬ / ПАРА</th>`;
        visibleGroups.forEach(g => { html += `<th style="padding: 12px; font-size:13px; font-weight:700; color:#1e293b; border-left: 1px solid #e2e8f0; text-align:center;">${typeof escapeHtml === 'function' ? escapeHtml(g.name) : g.name}</th>`; });
        html += `</tr></thead><tbody>`;

        weekdaysList.forEach(day => {
            for (let pairNum = 1; pairNum <= 4; pairNum++) {
                html += `<tr style="border-bottom: 1px solid #f1f5f9;">`;
                if (pairNum === 1) { 
                    const dayName = typeof escapeHtml === 'function' ? escapeHtml(day.name) : day.name;
                    html += `<td rowspan="4" style="background: #f8fafc; font-weight:700; font-size:11px; color:#475569; text-align:center; vertical-align:middle; border-right: 2px solid #e2e8f0; border-bottom: 2px solid #cbd5e1;">${dayName}</td>`; 
                }
                
                visibleGroups.forEach(group => {
                    const lesson = (window.cachedLessons || []).find(l => 
                        l.day_of_week === day.id && 
                        l.lesson_number === pairNum && 
                        l.group_id === group.id &&
                        (l.week_type === 'always' || l.week_type === currentCalculatedWeekCode)
                    );

                    const borderBottomStyle = (pairNum === 4) ? 'border-bottom: 2px solid #cbd5e1;' : '';
                    html += `<td style="padding: 8px; vertical-align: top; height: 110px; border-left: 1px solid #e2e8f0; ${borderBottomStyle}">`;
                    
                    if (lesson) {
                        const isCancelled = 
                            lesson.is_cancelled_today == true || 
                            lesson.is_cancelled == true || 
                            lesson.is_active == false ||
                            lesson.cancelled_date === selectedDateStr ||
                            (Array.isArray(lesson.cancelled_dates) && lesson.cancelled_dates.includes(selectedDateStr));
                        
                        let weekTypeBadge = '';
                        let cardBg = isCancelled ? 'background:#fef2f2; border-left:3px solid #ef4444;' : 'background:#fff; border-left:3px solid #6366f1;';
                        
                        if (!isCancelled) {
                            if (lesson.week_type === 'numerator') {
                                cardBg = 'background:#f0f9ff; border-left:3px solid #0284c7;';
                                weekTypeBadge = `<span style="background:#e0f2fe; color:#0369a1; padding:1px 4px; border-radius:4px; font-size:9px;">Чис</span>`;
                            } else if (lesson.week_type === 'denominator') {
                                cardBg = 'background:#fffbeb; border-left:3px solid #d97706;';
                                weekTypeBadge = `<span style="background:#fef3c7; color:#b45309; padding:1px 4px; border-radius:4px; font-size:9px;">Знам</span>`;
                            }
                        }

                        const timeStr = (CONFIG.lessonsMapping && CONFIG.lessonsMapping[pairNum]) ? CONFIG.lessonsMapping[pairNum].time : '';
                        const safeEscape = (str) => typeof escapeHtml === 'function' ? escapeHtml(str) : (str || '');
                        
                        html += `
                            <div style="${cardBg} box-shadow: 0 1px 3px rgba(0,0,0,0.05); padding: 8px; border-radius: 6px; height: 100%; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box;">
                                <div>
                                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#94a3b8; margin-bottom:2px;">
                                        <span>Пара ${pairNum} ${weekTypeBadge}</span>
                                        <span>${safeEscape(timeStr)}</span>
                                    </div>
                                    <div style="font-weight: 700; font-size: 12px; color: ${isCancelled ? '#ef4444' : '#1e293b'}; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                        ${isCancelled ? '<span style="text-decoration:line-through; color:#ef4444;">' : ''}${safeEscape(lesson.subject_name)}${isCancelled ? ' (Скасовано)</span>' : ''}
                                    </div>
                                    <div style="font-size: 11px; color: #64748b; margin-top:2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${safeEscape(lesson.teacher_name)}</div>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding-top:4px; border-top:1px solid #f1f5f9;">
                                    <span style="font-size:10px; font-weight:600; color:#334155;">📍 ${safeEscape(lesson.room_name)}</span>
                                    <div style="display:flex; gap:4px;">
                                        <button onclick="openEditMatrixModal(${lesson.id})" style="background:none; border:none; color:#6366f1; cursor:pointer; font-size:11px;"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="openDeleteMatrixModal(${lesson.id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:11px;"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </div>
                            </div>`;
                    } else {
                        html += `<div onclick="openCreateMatrixModal(${group.id}, ${day.id}, ${pairNum})" style="height:100%; display:flex; align-items:center; justify-content:center; border: 1px dashed #e2e8f0; border-radius:6px; color:#cbd5e1; cursor:pointer; font-size:11px; font-family:'Inter', system-ui, sans-serif;"><i class="fa-solid fa-plus-circle" style="margin-right:4px;"></i> Додати</div>`;
                    }
                    html += `</td>`;
                }
                );
                html += `</tr>`;
            }
        });
        html += `</tbody></table>`;
        matrixWrapper.innerHTML = html;
    } catch (err) { 
        console.error("❌ Помилка рендерингу матриці:", err); 
        matrixWrapper.innerHTML = `<p style="text-align:center; padding:30px; color:#ef4444; font-weight:600;">❌ Не вдалося завантажити матрицю розкладу.</p>`;
    }
}

// Функція, яка синхронізує бейджі періоду та типу тижня для адміна
function updateAdminWeekBadges(selectedDate) {
    const rangeEl = document.getElementById('week-range-label');
    const badgeEl = document.getElementById('current-week-type-badge');
    
    if (!selectedDate) return;

    // 1. Оновлюємо діапазон дат (Понеділок - Неділя)
    if (typeof getWeekRange === 'function') {
        const weekRange = getWeekRange(selectedDate);
        if (rangeEl && weekRange) {
            rangeEl.innerText = `${weekRange.monday.toLocaleDateString('uk-UA')} - ${weekRange.sunday.toLocaleDateString('uk-UA')}`;
        }
    } else {
        console.warn("⚠️ Функція getWeekRange не знайдена в глобальній області.");
    }

    // 2. Оновлюємо тип тижня (Чисельник / Знаменник)
    if (typeof getWeekType === 'function') {
        const weekInfo = getWeekType(selectedDate);
        if (badgeEl && weekInfo) {
            badgeEl.innerText = weekInfo.text;

            // Стилізуємо бейдж динамічно під колір типу тижня
            if (weekInfo.code === 'numerator' || weekInfo.text.toLowerCase().includes('чисельник')) {
                badgeEl.style.background = '#e0f2fe';
                badgeEl.style.color = '#0369a1';
            } else if (weekInfo.code === 'denominator' || weekInfo.text.toLowerCase().includes('знаменник')) {
                badgeEl.style.background = '#fef3c7';
                badgeEl.style.color = '#b45309';
            } else {
                badgeEl.style.background = '#e2e8f0';
                badgeEl.style.color = '#475569';
            }
        }
    } else {
        if (badgeEl) badgeEl.innerText = "Поточний тиждень";
    }
}

// Слухач подій для інпуту дати
document.addEventListener('DOMContentLoaded', () => {
    const adminDateInput = document.getElementById('schedule-admin-date');
    
    if (adminDateInput) {
        if (!adminDateInput.value) {
            adminDateInput.value = new Date().toISOString().split('T')[0];
        }

        updateAdminWeekBadges(new Date(adminDateInput.value));

        adminDateInput.addEventListener('change', (e) => {
            if (e.target.value) {
                const newDate = new Date(e.target.value);
                updateAdminWeekBadges(newDate);
                
                if (typeof loadGlobalMatrix === 'function') {
                    loadGlobalMatrix();
                }
            }
        });
    }
});

async function executeDeleteMatrixLesson() {
    return window.executeMatrixLessonDeleteOrCancel();
}

// форми 
function resetModalFormVisuals() {
    const inputs = ['modal-sch-group', 'modal-sch-subject', 'modal-sch-teacher', 'modal-sch-room', 'modal-sch-week-type', 'modal-sch-day', 'modal-sch-pair-number'];
    inputs.forEach(id => {
        const inp = document.getElementById(id);
        if (inp) { 
            inp.style.borderColor = '#cbd5e1'; 
            inp.style.background = id.includes('room') ? '#f8fafc' : '#ffffff'; 
        }
    });

    const errorIds = ['error-sch-group', 'error-sch-subject', 'error-sch-teacher', 'error-sch-room'];
    errorIds.forEach(id => {
        const err = document.getElementById(id);
        if (err) err.style.display = 'none';
    });

    const saveBtn = document.getElementById('matrix-schedule-form')?.querySelector('button[type="submit"]') || document.querySelector('.modal-footer .btn-primary');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";
        saveBtn.style.pointerEvents = "auto";
    }
    const streamZone = document.getElementById('stream-checkbox-zone') || document.getElementById('modal-sch-is-stream')?.closest('div');
    if (streamZone) {
        streamZone.style.background = "";
        streamZone.style.padding = "";
        streamZone.style.borderRadius = "";
        streamZone.style.border = "";
    }
    
    const streamCheck = document.getElementById('modal-sch-is-stream');
    if (streamCheck) streamCheck.checked = false;
}

// дисципліни
function populateSubjectsDropdown(subjectsList) {
    const schSubject = document.getElementById('modal-sch-subject') || document.getElementById('sch-subject');
    if (!schSubject || !Array.isArray(subjectsList)) return;
    
    const currentVal = schSubject.value; 
    schSubject.innerHTML = '<option value="" disabled>Оберіть дисципліну...</option>';

    subjectsList.forEach(s => {
        const isSelected = String(s.id) === String(currentVal) ? 'selected' : '';
        schSubject.insertAdjacentHTML('beforeend', `<option value="${s.id}" ${isSelected}>${escapeHtml(s.name)}</option>`);
    });

    if (currentVal && !schSubject.value) {
        schSubject.value = currentVal;
    }
    if (!schSubject.value && schSubject.options.length > 0) {
        schSubject.selectedIndex = 0;
    }
}

// викладачі
function populateTeachersDropdown(teachersList) {
    const schTeacher = document.getElementById('modal-sch-teacher') || document.getElementById('sch-teacher');
    if (!schTeacher || !Array.isArray(teachersList)) return;
    
    const currentVal = schTeacher.value;
    schTeacher.innerHTML = '<option value="" disabled>Оберіть викладача...</option>';

    teachersList.forEach(t => {
        const fullName = t.name || `${t.last_name || ''} ${t.first_name || ''}`.trim() || 'ID ' + t.id;
        const isSelected = String(t.id) === String(currentVal) ? 'selected' : '';
        
        schTeacher.insertAdjacentHTML('beforeend', `<option value="${t.id}" ${isSelected}>${escapeHtml(fullName)}</option>`);
    });

    if (currentVal && !schTeacher.value) {
        schTeacher.value = currentVal;
    }
    if (!schTeacher.value && schTeacher.options.length > 0) {
        schTeacher.selectedIndex = 0;
    }
}

// форми
window.openCentralModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.error(`❌ Модальне вікно з ID "${modalId}" не знайдено в HTML!`);
        return;
    }
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; 
};

window.closeCentralModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    modal.classList.remove('active');
    
    const anyActive = document.querySelector('.custom-central-modal.active');
    if (!anyActive) {
        document.body.style.overflow = ''; 
    }
};

window.closeMatrixDeleteModal = function() { 
    window.closeCentralModal('matrixDeleteConfirmModal'); 
    window.pendingDeleteId = null; 
};

window.closeMatrixScheduleModal = function() { 
    window.closeCentralModal('matrixScheduleModal'); 
};

// створення, редагування, видалення
window.openCreateMatrixModal = function(groupId, dayId, pairNumber) {
    if (typeof clearModalError === 'function') clearModalError();
    
    const form = document.getElementById('matrix-schedule-form');
    if (form) form.reset();
    
    if (document.getElementById('modal-sch-id')) {
        document.getElementById('modal-sch-id').value = '';
    }

    resetModalFormVisuals(); 
    
    if (groupId && document.getElementById('modal-sch-group')) document.getElementById('modal-sch-group').value = groupId;
    if (dayId && document.getElementById('modal-sch-day')) document.getElementById('modal-sch-day').value = dayId;
    if (pairNumber && document.getElementById('modal-sch-pair-number')) document.getElementById('modal-sch-pair-number').value = pairNumber;
    
    const adminDateInput = document.getElementById('schedule-admin-date');
    const mWeekSelector = document.getElementById('modal-sch-week-type');
    if (mWeekSelector) {
        if (adminDateInput && adminDateInput.value && typeof getWeekType === 'function') {
            const calculatedWeek = getWeekType(new Date(adminDateInput.value));
            mWeekSelector.value = calculatedWeek ? calculatedWeek.code : 'always';
        } else {
            mWeekSelector.value = 'always';
        }
    }

    const title = document.getElementById('matrixModalTitle');
    if (title) title.innerText = "Додати нове заняття";

    if (typeof rebuildGroupContextDropdowns === 'function') rebuildGroupContextDropdowns();
    
    window.openCentralModal('matrixScheduleModal');
};

window.openEditMatrixModal = async function(lessonId) {
    if (typeof clearModalError === 'function') clearModalError();
    
    const lesson = window.cachedLessons?.find(l => l.id === lessonId);
    if (!lesson) {
        console.error(`Пару з ID ${lessonId} не знайдено в cachedLessons!`);
        return;
    }

    console.log("📋 Дані картки заняття, які прийшли з кешу:", lesson);

    resetModalFormVisuals(); 

    if (document.getElementById('modal-sch-id')) document.getElementById('modal-sch-id').value = lesson.id;
    if (document.getElementById('modal-sch-group')) document.getElementById('modal-sch-group').value = lesson.group_id;
    
    if (typeof rebuildGroupContextDropdowns === 'function') {
        try {
            await rebuildGroupContextDropdowns();
        } catch(e) {
            console.error("Помилка під час rebuildGroupContextDropdowns:", e);
        }
    }

    if (document.getElementById('modal-sch-subject')) document.getElementById('modal-sch-subject').value = lesson.subject_id;
    if (document.getElementById('modal-sch-teacher')) document.getElementById('modal-sch-teacher').value = lesson.teacher_id;
    if (document.getElementById('modal-sch-day')) document.getElementById('modal-sch-day').value = lesson.day_of_week;
    if (document.getElementById('modal-sch-pair-number')) document.getElementById('modal-sch-pair-number').value = lesson.lesson_number;
    if (document.getElementById('modal-sch-week-type')) document.getElementById('modal-sch-week-type').value = lesson.week_type || 'always';
    if (document.getElementById('modal-sch-room')) document.getElementById('modal-sch-room').value = lesson.room_name || '';
    
    const rawStreamValue = (lesson.is_stream !== undefined) ? lesson.is_stream : lesson.stream;
    const isStreamTarget = filterBooleanValue(rawStreamValue);
    
    const streamCheckbox = document.getElementById('modal-sch-is-stream');
    if (streamCheckbox) {
        streamCheckbox.checked = isStreamTarget;
        console.log(`[Matrix Success] Галочку потоку виставлено в: ${isStreamTarget}`);
    } else {
        console.warn("⚠️ Чекбокс 'modal-sch-is-stream' не знайдено в DOM вікна!");
    }
    
    const title = document.getElementById('matrixModalTitle');
    if (title) title.innerText = "Редагувати заняття розкладу";
    
    window.openCentralModal('matrixScheduleModal');
};


function filterBooleanValue(val) {
    if (val === true || val === 1 || val === '1' || val === 'true' || val === 'Y' || val === 'yes') return true;
    return false;
}

window.openDeleteMatrixModal = function(id) { 
    window.pendingDeleteId = id; 
    
    const idInput = document.getElementById('modal-sch-id');
    if (idInput) {
        idInput.value = id;
    }
    
    const lesson = window.cachedLessons?.find(l => l.id === id);
    const infoContainer = document.getElementById('delete-modal-lesson-info');
    
    if (infoContainer && lesson) {
        infoContainer.innerHTML = '';
        infoContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center; margin-bottom: 20px;";

        const subjectDiv = document.createElement('div');
        subjectDiv.style.cssText = "font-size: 16px; font-weight: 700; color: #f8fafc; line-height: 1.4; word-break: break-word;";
        subjectDiv.innerText = lesson.subject_name || 'Невідомий предмет';

        const teacherDiv = document.createElement('div');
        teacherDiv.style.cssText = "font-size: 14px; font-weight: 500; color: #94a3b8;";
        teacherDiv.innerHTML = `<i class="fa-solid fa-user-tie" style="margin-right: 6px; color: #6366f1;"></i>`;
        
        const teacherNameSpan = document.createElement('span');
        teacherNameSpan.textContent = lesson.teacher_name || 'Склад викладачів відсутній';
        teacherDiv.appendChild(teacherNameSpan);

        const roomDiv = document.createElement('div');
        roomDiv.style.cssText = "display: inline-block; font-size: 12px; font-weight: 600; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); padding: 4px 10px; border-radius: 20px; margin-top: 4px;";
        roomDiv.innerHTML = `<i class="fa-solid fa-location-dot" style="margin-right: 4px;"></i> Аудиторія: `;
        
        const roomNameSpan = document.createElement('span');
        roomNameSpan.textContent = lesson.room_name || '—';
        roomDiv.appendChild(roomNameSpan);

        infoContainer.appendChild(subjectDiv);
        infoContainer.appendChild(teacherDiv);
        infoContainer.appendChild(roomDiv);

    } else if (infoContainer) {
        infoContainer.innerHTML = `<div style="font-size: 15px; color: #94a3b8; font-weight: 600;">Обране заняття розкладу</div>`;
    }

    const defaultRadio = document.querySelector('input[name="delete-scope"][value="once"]');
    if (defaultRadio) defaultRadio.checked = true;

    window.openCentralModal('matrixDeleteConfirmModal'); 
};

// збереження розкладу
async function saveScheduleFromModal(e) {
    if (e) e.preventDefault();
    if (window.isSavingSchedule) return;

    const groupEl = document.getElementById('modal-sch-group');
    const subjEl = document.getElementById('modal-sch-subject');
    const teachEl = document.getElementById('modal-sch-teacher');
    const roomEl = document.getElementById('modal-sch-room');
    const pairEl = document.getElementById('modal-sch-pair-number');
    const dayEl = document.getElementById('modal-sch-day');
    const weekEl = document.getElementById('modal-sch-week-type');
    const idVal = document.getElementById('modal-sch-id')?.value;

    const groupId = groupEl?.value;
    const subjectId = subjEl?.value;
    const teacherId = teachEl?.value;
    const roomName = roomEl?.value?.trim();
    const dayOfWeek = dayEl ? parseInt(dayEl.value, 10) : null;

    if (!groupId || !subjectId || !teacherId || !roomName || dayOfWeek === null || isNaN(dayOfWeek)) {
        if (typeof showSystemToast === 'function') {
            showSystemToast("Не вдалося зберегти! Перевірте, чи обрані група, предмет, викладач та аудиторія.", "danger");
        }
        return;
    }
    
    if (typeof checkFormConflicts === 'function') {
        const isFormValid = await checkFormConflicts();
        if (!isFormValid) return; 
    }

    window.isSavingSchedule = true; 

    const adminDateInput = document.getElementById('schedule-admin-date');
    const targetWeekMap = window.currentWeekDaysMap || {};
    const localNow = new Date();
    const fallbackDateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
    
    const targetDateStr = targetWeekMap[dayOfWeek] || adminDateInput?.value || fallbackDateStr;

    const selectedPeriod = document.getElementById('matrix-period-filter')?.value;
    const finalPeriodId = selectedPeriod ? parseInt(selectedPeriod, 10) : (window.currentActivePeriodId ? parseInt(window.currentActivePeriodId, 10) : 2);

    try {
        const { token, apiUrl } = getScheduleFetchMeta();
        const cleanApiUrl = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;
        
        const isStreamChecked = !!document.getElementById('modal-sch-is-stream')?.checked;

        const formData = {
            id: idVal ? parseInt(idVal, 10) : null,
            group_id: parseInt(groupId, 10),
            subject_id: parseInt(subjectId, 10),
            teacher_id: parseInt(teacherId, 10),
            lesson_number: parseInt(pairEl?.value || "1", 10), 
            day_of_week: dayOfWeek,
            week_type: weekEl?.value || 'always', 
            room_name: roomName,
            is_stream: isStreamChecked, 
            period_id: finalPeriodId,
            target_date: targetDateStr
        };

        const isEdit = !!formData.id;
        const endpoint = isEdit ? `${cleanApiUrl}/admin/schedule/${formData.id}` : `${cleanApiUrl}/admin/schedule`;
        const method = isEdit ? 'PUT' : 'POST';

        const res = await fetch(endpoint, {
            method: method,
            headers: { 
                'Authorization': `Bearer ${token}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(formData)
        });

        if (res.ok) {
            if (typeof closeMatrixScheduleModal === 'function') closeMatrixScheduleModal(); 
            if (typeof showSystemToast === 'function') {
                showSystemToast(isEdit ? "Заняття успішно оновлено! 🎉" : "Нове заняття успішно додано! 🚀", "success");
            }
            if (typeof loadGlobalMatrix === 'function') await loadGlobalMatrix();
        } else {
            const errData = await res.json().catch(() => ({}));
            const backendError = errData.error || errData.message || 'Не вдалося зберегти зміни через помилку сервера.';
            
            if (typeof showModalError === 'function') {
                showModalError(`🚫 ${backendError}`);
            } else if (typeof showSystemToast === 'function') {
                showSystemToast(`🚫 ${backendError}`, "danger");
            }
        }
    } catch (err) {
        console.error("❌ Помилка збереження картки:", err);
        if (typeof showSystemToast === 'function') showSystemToast("Критична помилка відправки форми", "danger");
    } finally {
        window.isSavingSchedule = false;
    }
}

// скасування чи видалення заняття
window.executeMatrixLessonDeleteOrCancel = async function() {
    const lessonId = window.pendingDeleteId || document.getElementById('modal-sch-id')?.value;
    if (!lessonId) {
        if (typeof showSystemToast === 'function') {
            showSystemToast("Помилка: Не знайдено ID заняття розкладу!", "danger");
        }
        return;
    }

    const adminDateInput = document.getElementById('schedule-admin-date');
    const localNow = new Date();
    const fallbackDateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
    const selectedDateStr = adminDateInput?.value ? adminDateInput.value : fallbackDateStr;

    const scopeRadio = document.querySelector('input[name="delete-scope"]:checked');
    const deleteScope = scopeRadio ? scopeRadio.value : 'once'; 

    const token = typeof getAuthToken === 'function' ? getAuthToken() : (localStorage.getItem('token') || '');
    const { apiUrl } = getScheduleFetchMeta();
    const cleanApiUrl = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;

    try {
        let endpoint = '';
        let options = {};

        if (deleteScope === 'once') {
            endpoint = `${cleanApiUrl}/admin/schedule/${parseInt(lessonId, 10)}/cancel?date=${encodeURIComponent(selectedDateStr)}`;
            options = {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };
        } else {
            endpoint = `${cleanApiUrl}/admin/schedule/${parseInt(lessonId, 10)}`;
            options = {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            };
        }

        const response = await fetch(endpoint, options);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || errData.message || 'Сервер відхилив запит операції розкладу.');
        }

        if (typeof showSystemToast === 'function') {
            showSystemToast(
                deleteScope === 'once' ? "🗑️ Заняття скасовано на вказану дату!" : "🔥 Заняття повністю видалено з сітки розкладу!", 
                "success"
            );
        }

        window.closeMatrixDeleteModal();
        if (typeof closeMatrixScheduleModal === 'function') closeMatrixScheduleModal();
        
        if (typeof loadGlobalMatrix === 'function') {
            await loadGlobalMatrix(); 
        }

    } catch (error) {
        console.error("❌ Помилка синхронізації видалення:", error);
        if (typeof showSystemToast === 'function') {
            showSystemToast(`Увага: ${error.message}`, "danger");
        }
    }
};

// повідомлення
window.showSystemToast = function(message, type = 'success') {
    let container = document.getElementById('global-system-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'global-system-toast-container';
        document.body.appendChild(container);
    }

    container.style.cssText = `
        position: fixed !important;
        top: 30px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        pointer-events: none !important;
        align-items: center !important;
        width: max-content !important;
        max-width: 90vw !important;
    `;

    const existingToasts = container.querySelectorAll('.custom-system-toast-item');
    for (let currentToast of existingToasts) {
        if (currentToast.getAttribute('data-msg-text') === message) {
            currentToast.style.setProperty('transform', 'translateY(0) scale(1.05)', 'important');
            setTimeout(() => {
                currentToast.style.setProperty('transform', 'translateY(0) scale(1)', 'important');
            }, 150);
        }
    }

    const toast = document.createElement('div');
    toast.className = 'custom-system-toast-item'; 
    toast.setAttribute('data-msg-text', message); 

    let bg = '#3b82f6'; 
    if (type === 'success') bg = '#10b981';
    if (type === 'error' || type === 'danger') bg = '#ef4444';
    if (type === 'warning') bg = '#f59e0b'; 

    toast.style.cssText = `
        background: ${bg} !important;
        color: #ffffff !important;
        padding: 14px 24px !important;
        border-radius: 10px !important;
        font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
        font-weight: 700 !important;
        font-size: 14px !important;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2) !important;
        pointer-events: auto !important;
        min-width: 300px !important;
        max-width: 500px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 16px !important;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
        opacity: 0 !important;
        transform: translateY(-30px) scale(0.9) !important;
    `;
    
    const textSpan = document.createElement('span');
    textSpan.style.cssText = "line-height: 1.4; flex: 1; text-align: left;";
    textSpan.textContent = message;
    
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = "cursor: pointer; opacity: 0.8; font-weight: bold; font-size: 16px; line-height: 1; padding: 4px; transition: opacity 0.2s;";
    
    closeBtn.addEventListener('mouseover', () => closeBtn.style.opacity = '1');
    closeBtn.addEventListener('mouseout', () => closeBtn.style.opacity = '0.8');
    closeBtn.addEventListener('click', () => {
        toast.remove();
        if (container.children.length === 0) container.remove();
    });
    
    toast.appendChild(textSpan);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.setProperty('opacity', '1', 'important');
        toast.style.setProperty('transform', 'translateY(0) scale(1)', 'important');
    }, 20);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.setProperty('opacity', '0', 'important');
            toast.style.setProperty('transform', 'translateY(-20px) scale(0.9)', 'important');
            setTimeout(() => { 
                if (toast.parentNode) toast.remove(); 
                if (container.children.length === 0) container.remove();
            }, 300);
        }
    }, 4000);
};

// фільтрація в звітах
function setupAllSystemFilterListeners() {
    const dashSpec = document.getElementById('analytics-specialty-filter');
    const dashCourse = document.getElementById('analytics-course-filter');
    const dashGroup = document.getElementById('analytics-group-filter');
    const dashPeriod = document.getElementById('analytics-period-filter'); 

    if (dashSpec) dashSpec.addEventListener('change', (e) => onDashboardFilterChange(e));
    if (dashCourse) dashCourse.addEventListener('change', (e) => onDashboardFilterChange(e));
    if (dashGroup) {
        dashGroup.addEventListener('change', async () => {
            if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
        });
    }
    if (dashPeriod) {
        dashPeriod.addEventListener('change', async () => {
            if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
        });
    }

    const reportSpec = document.getElementById('report-criteria-spec'); 
    const reportCourse = document.getElementById('report-criteria-course');
    const reportGroup = document.getElementById('report-criteria-group');
    const reportType = document.getElementById('report-type');
    const reportStart = document.getElementById('report-date-start');
    const reportEnd = document.getElementById('report-date-end');
    const reportStatus = document.getElementById('report-status-filter');
    const reportSort = document.getElementById('report-sort-order');
    
    const reportPeriod = document.getElementById('report-period-filter'); 

    if (reportSpec) reportSpec.addEventListener('change', () => onReportCascadeChange('spec'));
    if (reportCourse) reportCourse.addEventListener('change', () => onReportCascadeChange('course'));
    if (reportGroup) reportGroup.addEventListener('change', () => loadTableAnalytics());
    if (reportType) reportType.addEventListener('change', () => loadTableAnalytics());
    if (reportStart) reportStart.addEventListener('change', () => loadTableAnalytics());
    if (reportEnd) reportEnd.addEventListener('change', () => loadTableAnalytics());
    if (reportStatus) reportStatus.addEventListener('change', () => renderFilteredTable());
    if (reportSort) reportSort.addEventListener('change', () => renderFilteredTable());
    
    if (reportPeriod) {
        reportPeriod.addEventListener('change', () => {
            console.log("🔄 Семестр у звітах змінено, перевантажуємо дані...");
            loadTableAnalytics();
        });
    }

    const matrixPeriod = document.getElementById('matrix-period-filter') || document.getElementById('schedule-period-filter');
    
    if (matrixPeriod) {
        matrixPeriod.addEventListener('change', async () => {
            console.log("🔄 Семестр матриці розкладу змінено, оновлюємо сітку...");
            if (typeof loadGlobalMatrix === 'function') {
                await loadGlobalMatrix();
            } else if (typeof loadScheduleMatrix === 'function') {
                await loadScheduleMatrix();
            }
        });
    }
}

// оцінки
function cleanStatusText(status, score = 0) {
    let numericScore = parseFloat(score);
    let st = String(status || '').trim().toUpperCase();

    if (st.includes('НЕМАЄ ОЦІНОК') || st.includes('НЕМАЄ ДАНИХ') || st === '') {
        if (isNaN(numericScore) || numericScore === 0) return 'Немає даних';
    }

    // Розрахунок за цифровою шкалою
    if (!isNaN(numericScore) && numericScore > 0) {
        if (numericScore >= 90) return 'Відмінно';
        if (numericScore >= 82) return 'Дуже добре';
        if (numericScore >= 74) return 'Добре'; 
        if (numericScore >= 60) return 'Задовільно';
        return 'Незадовільно'; 
    }

    // Текстові підстраховки
    if (st.includes('ВІДМІННО')) return 'Відмінно';
    if (st.includes('ДУЖЕ DOBRE') || st.includes('ДУЖЕ ДОБРЕ')) return 'Дуже добре';
    if (st.includes('ДОБРЕ') || st.includes('DOBRE')) return 'Добре';
    if (st.includes('ЗАДОВІЛЬНО')) return 'Задовільно';
    
    return 'Незадовільно';
}

async function initAllSystemFilters() {
    const token = localStorage.getItem('token') || '';
    const headers = { 'Authorization': `Bearer ${token}` };
    let apiUrl = (typeof CONFIG !== 'undefined' && CONFIG?.apiUrl) ? CONFIG.apiUrl : '/api';
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);

    try {
        const [resDepts, resGroups] = await Promise.all([
            fetch(`${apiUrl}/admin/departments`, { headers }).catch(() => null), 
            fetch(`${apiUrl}/admin/groups`, { headers }).catch(() => null)
        ]);

        const deptsData = resDepts && resDepts.ok ? await resDepts.json().catch(() => []) : [];
        const groupsData = resGroups && resGroups.ok ? await resGroups.json().catch(() => []) : [];
        
        window.allReportGroups = groupsData;
        window.allReportDepartments = deptsData;

        const dashSpecSelect = document.getElementById('analytics-specialty-filter');
        const reportSpecSelect = document.getElementById('report-criteria-spec');

        if (dashSpecSelect) {
            dashSpecSelect.innerHTML = '<option value="all">Усі спеціальності</option>';
            deptsData.forEach(d => {
                dashSpecSelect.insertAdjacentHTML('beforeend', `<option value="${d.id}">${escapeHtml(d.short_name || d.name)} — ${escapeHtml(d.name)}</option>`);
            });
        }

        if (reportSpecSelect) {
            reportSpecSelect.innerHTML = '<option value="all">Усі спеціальності</option>';
            deptsData.forEach(d => {
                reportSpecSelect.insertAdjacentHTML('beforeend', `<option value="${d.id}">${escapeHtml(d.short_name || d.name)} — ${escapeHtml(d.name)}</option>`);
            });
        }

        await updateDashboardCourseAndGroupFilters();
        updateReportCoursesAndGroupsCascade('spec');
        await loadTableAnalytics();

    } catch (err) {
        console.error("❌ Збій ініціалізації фільтрації:", err);
    }
}

async function updateDashboardCourseAndGroupFilters(event) {
    const token = localStorage.getItem('token') || '';
    let apiUrl = (typeof CONFIG !== 'undefined' && CONFIG?.apiUrl) ? CONFIG.apiUrl : '/api';
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);

    const specFilter = document.getElementById('analytics-specialty-filter');
    const courseFilter = document.getElementById('analytics-course-filter');
    const groupFilter = document.getElementById('analytics-group-filter');

    const selectedSpecialty = specFilter?.value || 'all';
    const triggerElement = event ? event.target : specFilter;

    try {
        if (!event || triggerElement === specFilter) {
            const res = await fetch(`${apiUrl}/admin/analytics/filter-meta?specialty=${encodeURIComponent(selectedSpecialty)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => null);

            if (res && res.ok) {
                const meta = await res.json().catch(() => ({ courses: [] }));
                if (courseFilter) {
                    courseFilter.innerHTML = '<option value="all">Усі курси</option>';
                    if (meta && meta.courses && Array.isArray(meta.courses)) {
                        meta.courses.map(Number).filter(c => c >= 1 && c <= 6).sort((a,b) => a - b).forEach(c => {
                            courseFilter.insertAdjacentHTML('beforeend', `<option value="${c}">${c} курс</option>`);
                        });
                    }
                    courseFilter.value = 'all';
                }
            }
        }

        const currentCourse = courseFilter ? courseFilter.value : 'all';
        const groupsRes = await fetch(`${apiUrl}/admin/analytics/groups?specialty=${encodeURIComponent(selectedSpecialty)}&course=${encodeURIComponent(currentCourse)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null);

        if (groupsRes && groupsRes.ok && groupFilter) {
            const filteredGroups = await groupsRes.json().catch(() => []);
            groupFilter.innerHTML = '<option value="all">Усі академічні групи</option>';
            if (Array.isArray(filteredGroups)) {
                filteredGroups.forEach(gName => {
                    groupFilter.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(gName)}">${escapeHtml(gName)}</option>`);
                });
            }
            groupFilter.value = 'all';
        }
    } catch (e) {
        console.error("Помилка каскаду Дашборду:", e);
    }
}

async function onDashboardFilterChange(event) {
    await updateDashboardCourseAndGroupFilters(event);
    if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
}

function updateReportCoursesAndGroupsCascade(triggeredBy) {
    const specSelect = document.getElementById('report-criteria-spec');
    const courseSelect = document.getElementById('report-criteria-course');
    const groupSelect = document.getElementById('report-criteria-group');

    if (!window.allReportGroups) return;

    const selectedSpec = specSelect?.value || 'all';
    const selectedCourse = courseSelect?.value || 'all';

    if (triggeredBy === 'spec' && courseSelect) {
        const availableCourses = new Set();
        window.allReportGroups.forEach(g => {
            if (selectedSpec === 'all' || String(g.department_id) === String(selectedSpec)) {
                if (g.course) availableCourses.add(Number(g.course));
            }
        });

        const sortedCourses = Array.from(availableCourses).filter(c => c >= 1 && c <= 6).sort((a, b) => a - b);
        courseSelect.innerHTML = '<option value="all">Усі курси</option>';
        sortedCourses.forEach(c => {
            courseSelect.insertAdjacentHTML('beforeend', `<option value="${c}">${c} курс</option>`);
        });
        courseSelect.value = 'all';
    }

    if (groupSelect) {
        const freshCourse = courseSelect?.value || 'all';
        const filteredGroups = window.allReportGroups.filter(g => {
            const matchSpec = (selectedSpec === 'all' || String(g.department_id) === String(selectedSpec));
            const matchCourse = (freshCourse === 'all' || String(g.course) === String(freshCourse));
            return matchSpec && matchCourse;
        });

        groupSelect.innerHTML = '<option value="all">Усі групи</option>';
        filteredGroups.forEach(g => {
            groupSelect.insertAdjacentHTML('beforeend', `<option value="${g.id}">${escapeHtml(g.name)}</option>`);
        });
        groupSelect.value = 'all';
    }
}

async function onReportCascadeChange(triggeredBy) {
    updateReportCoursesAndGroupsCascade(triggeredBy);
    await loadTableAnalytics();
}

// таблиця в звітах
async function loadTableAnalytics() {
    const reportType = document.getElementById('report-type')?.value || 'success';
    const spec = document.getElementById('report-criteria-spec')?.value || 'all';
    const course = document.getElementById('report-criteria-course')?.value || 'all';
    const group = document.getElementById('report-criteria-group')?.value || 'all';
    const start = document.getElementById('report-date-start')?.value || '';
    const end = document.getElementById('report-date-end')?.value || '';
    
    const reportPeriodSelect = document.getElementById('report-period-filter');
    const periodId = reportPeriodSelect?.value || '';

    let apiUrl = (typeof CONFIG !== 'undefined' && CONFIG?.apiUrl) ? CONFIG.apiUrl : '/api';
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);

    const tbody = document.getElementById('analytics-table-body');
    const thMetric = document.getElementById('th-dynamic-metric');
    
    if (thMetric) {
        thMetric.innerHTML = reportType === 'success' 
            ? 'Поточний бал<br><span style="font-size: 11px; font-weight: normal; color: #64748b;">(100-бальна)</span>' 
            : 'Відвідуваність<br><span style="font-size: 11px; font-weight: normal; color: #64748b;">(%)</span>';
    }

    if (tbody) {
        tbody.innerHTML = `<tr id="table-loading-row"><td colspan="4" style="padding: 25px; text-align: center; color: #4f46e5; font-weight: 600; background: #f0fdf4;">⏳ Дані завантажуються з бази даних...</td></tr>`;
    }

    try {
        const urlParams = new URLSearchParams();
        urlParams.append('type', reportType);
        
        if (spec !== 'all' && spec !== '') urlParams.append('dept', spec);
        if (course !== 'all' && course !== '') urlParams.append('course', course);
        if (group !== 'all' && group !== '') urlParams.append('group', group);
        if (start) urlParams.append('start', start);
        if (end) urlParams.append('end', end);
        
        if (periodId && periodId !== 'all') {
            urlParams.append('periodId', periodId);
        }

        const token = localStorage.getItem('token') || '';
        const res = await fetch(`${apiUrl}/admin/reports/build?${urlParams.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Помилка сервера при генерації звіту.");
        const data = await res.json();
        
        window.currentReportRows = data.rows || []; 
        renderFilteredTable();

    } catch (err) {
        console.error("Помилка завантаження аналітики:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding: 25px; text-align: center; color: #b91c1c; font-weight: 600; background: #fee2e2;">❌ Помилка завантаження даних з сервера. Оновіть сторінку.</td></tr>`;
        }
    }
}

function renderFilteredTable() {
    const tbody = document.getElementById('analytics-table-body');
    const avgBadge = document.getElementById('analytics-avg-badge');
    const countBadge = document.getElementById('analytics-count-badge');
    const reportType = document.getElementById('report-type')?.value || 'success';
    
    if (!tbody) return;
    
    if (!window.currentReportRows || window.currentReportRows.length === 0) {
        tbody.innerHTML = `<tr id="table-empty-row"><td colspan="4" style="padding: 25px; text-align: center; color: #ef4444; font-weight: 600; background: #fef2f2;">⚠️ Немає даних за обраними критеріями.</td></tr>`;
        if (avgBadge) avgBadge.innerText = "-";
        if (countBadge) countBadge.innerText = "0";
        window.filteredReportRowsForExport = [];
        return;
    }

    let localRows = [...window.currentReportRows];

    const statusFilter = document.getElementById('report-status-filter')?.value || 'all';
    if (statusFilter !== 'all') {
        localRows = localRows.filter(row => {
            const cleanSt = cleanStatusText(row.status, parseFloat(row.score)).toLowerCase();
            if (statusFilter === 'high') return cleanSt === 'відмінно';
            if (statusFilter === 'good') return cleanSt === 'дуже добре' || cleanSt === 'добре';
            if (statusFilter === 'risk') return cleanSt === 'задовільно' || cleanSt === 'незадовільно';
            return true;
        });
    }

    const sortOrder = document.getElementById('report-sort-order')?.value || 'none';
    if (sortOrder === 'desc') {
        localRows.sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0));
    } else if (sortOrder === 'asc') {
        localRows.sort((a, b) => (parseFloat(a.score) || 0) - (parseFloat(b.score) || 0));
    }

    let totalScore = 0;
    let studentsWithGradesCount = 0; 
    let rowsHtml = "";

    localRows.forEach(row => {
        const currentScore = parseFloat(row.score) || 0;
        const cleanStatus = cleanStatusText(row.status, currentScore); 
        
        if (currentScore > 0) {
            totalScore += currentScore;
            studentsWithGradesCount++;
        }

        let statusStyle = "background: #f1f5f9; color: #475569;";
        if (cleanStatus === 'Відмінно') statusStyle = "background: #dcfce7; color: #15803d; font-weight: 700;";
        else if (cleanStatus === 'Дуже добре') statusStyle = "background: #f0fdf4; color: #166534;";
        else if (cleanStatus === 'Добре') statusStyle = "background: #e0f2fe; color: #0369a1; font-weight: 600;"; 
        else if (cleanStatus === 'Задовільно') statusStyle = "background: #fef08a; color: #854d0e; font-weight: bold; border: 1px solid #fef08a;";
        else if (cleanStatus === 'Незадовільно') statusStyle = "background: #fee2e2; color: #b91c1c; font-weight: 700;";
        else if (cleanStatus === 'Немає даних') statusStyle = "background: #f8fafc; color: #94a3b8; border: 1px dashed #cbd5e1;";

        let displayScore = currentScore > 0 ? currentScore : (cleanStatus === 'Немає даних' ? `<span style="color: #94a3b8;">-</span>` : currentScore);

        rowsHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 12px; font-weight: 600; color: #0f172a;">${escapeHtml(row.name)}</td>
                <td style="padding: 12px; color: #475569;">${escapeHtml(row.group_name || row.group)}</td>
                <td style="padding: 12px; text-align: center; font-weight: 700; color: #4f46e5;">${displayScore}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="padding: 4px 10px; border-radius: 6px; font-size: 11px; display: inline-block; ${statusStyle}">
                        ${escapeHtml(cleanStatus)}
                    </span>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
    
    if (studentsWithGradesCount > 0) {
        const finalAvg = (totalScore / studentsWithGradesCount).toFixed(1);
        if (avgBadge) avgBadge.innerText = reportType === 'success' ? `${finalAvg}/100` : `${finalAvg}%`;
    } else {
        if (avgBadge) avgBadge.innerText = "-"; 
    }
    if (countBadge) countBadge.innerText = localRows.length;
    
    window.filteredReportRowsForExport = localRows;
}

// пдф
function downloadPDF() {
    // 1. Перевірка наявності даних для експорту
    const rowsToExport = window.filteredReportRowsForExport || window.currentReportRows;
    
    if (!rowsToExport || rowsToExport.length === 0) {
        alert("Нічого завантажувати, дані аналітики порожні або ще не завантажилися!");
        return;
    }

    // 2. Перевірка підключення бібліотеки html2pdf
    if (typeof html2pdf === 'undefined') {
        alert("Помилка: На сторінці не знайдено бібліотеку html2pdf. Перевірте підключення скрипта!");
        return;
    }

    // 3. Визначення типу звіту
    const isSuccess = document.getElementById('report-type')?.value === 'success';
    const reportTitle = isSuccess ? 'ЗВІТ УСПІШНОСТІ СТУДЕНТІВ' : 'ЗВІТ ВІДВІДУВАНОСТІ СТУДЕНТІВ';
    const metricTitle = isSuccess ? 'Поточний бал (100-бальна)' : 'Відвідуваність (%)';
    
    // 4. Отримання текстових значень із фільтрів (селектів)
    const specEl = document.getElementById('report-criteria-spec');
    const courseEl = document.getElementById('report-criteria-course');
    const groupEl = document.getElementById('report-criteria-group');

    const specText = specEl?.options[specEl.selectedIndex]?.text || 'Усі';
    const courseText = courseEl?.options[courseEl.selectedIndex]?.text || 'Усі';
    const groupText = groupEl?.options[groupEl.selectedIndex]?.text || 'Усі';

    // 5. Створення невидимого обгорткового контейнера строго під розмір А4
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.top = '0px';
    wrapper.style.left = '-9999px'; 
    wrapper.style.width = '210mm';
    wrapper.style.zIndex = '-1';

    const container = document.createElement('div');
    container.style.width = '210mm'; 
    container.style.boxSizing = 'border-box';
    container.style.padding = '10mm 10mm 10mm 10mm';
    container.style.background = '#ffffff';
    container.style.color = '#0f172a';
    container.style.fontFamily = 'system-ui, -apple-system, sans-serif';

    // Шаблон шапки таблиці
    const tableHeaderHtml = `
        <thead>
            <tr>
                <th style="text-align: left; width: 6%;">№</th>
                <th style="text-align: left; width: 44%;">ПІБ Студента</th>
                <th style="text-align: left; width: 15%;">Група</th>
                <th style="text-align: center; width: 15%;">${metricTitle}</th>
                <th style="text-align: center; width: 20%;">Статус</th>
            </tr>
        </thead>
    `;

    // Початкова розмітка документа
    let pdfHtml = `
        <style>
            .pdf-table { 
                width: 100%; 
                border-collapse: separate !important; 
                border-spacing: 0 !important;
                font-size: 10px; 
                margin-bottom: 0px;
                border-top: 1px solid #cbd5e1 !important;
                border-left: 1px solid #cbd5e1 !important;
            }
            .pdf-table tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
            }
            .pdf-table th { 
                border-right: 1px solid #cbd5e1 !important; 
                border-bottom: 1px solid #cbd5e1 !important; 
                padding: 10px 8px; 
                background-color: #f8fafc !important; 
                font-weight: bold; 
                color: #475569; 
                text-transform: uppercase; 
                font-size: 9px; 
                line-height: 1.4;
            }
            .pdf-table td { 
                border-right: 1px solid #cbd5e1 !important; 
                border-bottom: 1px solid #cbd5e1 !important; 
                padding: 11px 8px; 
                vertical-align: middle; 
                background: #ffffff; 
                line-height: 1.4; 
            }
            .page-break { 
                page-break-before: always !important; 
                break-before: always !important;
                height: 0; 
                margin: 0; 
                padding: 0;
            }
            .pdf-header { margin-bottom: 14px; }
            .pdf-footer-html { 
                margin-top: 15px;
                padding-top: 6px;
                border-top: 1px dashed #cbd5e1;
                font-size: 9px; 
                color: #64748b; 
                width: 100%;
                display: flex;
                justify-content: space-between;
                page-break-inside: avoid !important;
            }
        </style>

        <div class="pdf-header">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td>
                        <h2 style="margin: 0 0 3px 0; font-size: 18px; font-weight: 800; color: #0f172a;">${reportTitle}</h2>
                        <div style="font-size: 11px; color: #4f46e5; font-weight: 600;">Система моніторингу EduPlatform</div>
                    </td>
                    <td style="text-align: right; vertical-align: top; font-size: 10px; color: #64748b;">
                        <div>Дата: <b>${new Date().toLocaleDateString('uk-UA')}</b></div>
                        <div>Час: <b>${new Date().toLocaleTimeString('uk-UA', {hour: '2-digit', minute:'2-digit'})}</b></div>
                    </td>
                </tr>
            </table>
            
            <div style="background: #f8fafc; border-radius: 8px; padding: 8px; margin-top: 6px; font-size: 11px; color: #334155; line-height: 1.3; border: 1px solid #e2e8f0;">
                <b>Спеціальність:</b> ${escapeHtml(specText)}<br>
                <b>Курс / Академічна група:</b> ${escapeHtml(courseText)} | ${escapeHtml(groupText)}
            </div>
        </div>

        <table class="pdf-table">
            ${tableHeaderHtml}
            <tbody>
    `;

    let renderedCount = 0; 

    rowsToExport.forEach((r) => {
        renderedCount++; 

        const currentScore = parseFloat(r.score) || 0;
        const cleanStatus = cleanStatusText(r.status, currentScore);
        const displayScore = currentScore > 0 ? currentScore : (cleanStatus === 'Немає даних' ? '-' : currentScore);

        let badgeBg = '#f1f5f9';
        let badgeColor = '#475569';
        let badgeBorder = '#cbd5e1';
        
        if (cleanStatus === 'Відмінно' || cleanStatus === 'Висока') {
            badgeBg = '#dcfce7'; badgeColor = '#166534'; badgeBorder = '#bbf7d0';
        } else if (cleanStatus === 'Дуже добре') {
            badgeBg = '#f0fdf4'; badgeColor = '#166534'; badgeBorder = '#dcfce7';
        } else if (cleanStatus === 'Добре' || cleanStatus === 'Нормальна') {
            badgeBg = '#e0f2fe'; badgeColor = '#0369a1'; badgeBorder = '#bae6fd';
        } else if (cleanStatus === 'Задовільно') {
            badgeBg = '#fef08a'; badgeColor = '#854d0e'; badgeBorder = '#fef08a';
        } else if (cleanStatus === 'Незадовільно' || cleanStatus === 'Критична зона') {
            badgeBg = '#fee2e2'; badgeColor = '#991b1b'; badgeBorder = '#fecaca';
        }

        pdfHtml += `
            <tr>
                <td style="color: #64748b; font-size: 11px; font-weight: bold;">${renderedCount}</td>
                <td style="font-weight: bold; color: #0f172a;">${escapeHtml(r.name)}</td>
                <td style="color: #475569;">${escapeHtml(r.group_name || r.group)}</td>
                <td style="text-align: center; font-weight: bold; color: #4f46e5; font-size: 11px;">${displayScore}</td>
                <td style="text-align: center;">
                    <span style="padding: 3px 5px; border-radius: 4px; font-size: 8.5px; display: inline-block; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-weight: bold; min-width: 75px; text-align: center;">
                        ${escapeHtml(cleanStatus)}
                    </span>
                </td>
            </tr>
        `;

        const hasMoreRows = renderedCount < rowsToExport.length;

        if (hasMoreRows) {
            let shouldBreak = false;
            if (renderedCount === 19) {
                shouldBreak = true;
            } else if (renderedCount > 19 && (renderedCount - 19) % 21 === 0) {
                shouldBreak = true;
            }

            if (shouldBreak) {
                pdfHtml += `
                        </tbody>
                    </table>
                    <div class="page-break"></div>
                    
                    <div style="height: 12mm; width: 100%; clear: both;"></div>
                    
                    <table class="pdf-table">
                        ${tableHeaderHtml}
                        <tbody>
                `;
            }
        }
    });

    pdfHtml += `
            </tbody>
        </table>

        <div class="pdf-footer-html">
            <span>Звіт сформовано автоматично в системі EduPlatform</span>
            <span>Документ аналітики</span>
        </div>
    `;
    
    container.innerHTML = pdfHtml;
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);

    const opt = {
        margin:        0, 
        filename:      `Звіт_${isSuccess ? 'Успішність' : 'Відвідуваність'}_${new Date().toISOString().slice(0,10)}.pdf`,
        image:         { type: 'jpeg', quality: 0.98 },
        html2canvas:   { 
            scale: 2, 
            useCORS: true, 
            logging: false,
            letterRendering: true,
            scrollX: 0,
            scrollY: 0
        },
        pagebreak:     { mode: ['css'] }, 
        jsPDF:         { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    setTimeout(() => {
        html2pdf().set(opt).from(container).save().then(() => {
            wrapper.remove(); 
        }).catch(err => {
            console.error("Помилка генерації PDF:", err);
            wrapper.remove();
        });
    }, 250);
}

// ексель
function downloadExcel() {
    const rowsToExport = window.filteredReportRowsForExport || window.currentReportRows;
    if (!rowsToExport || rowsToExport.length === 0) {
        alert("Нічого експортувати, таблиця аналітики порожня!");
        return;
    }

    const isSuccess = document.getElementById('report-type')?.value === 'success';
    const reportTitle = isSuccess ? 'Звіт успішності студентів' : 'Звіт відвідуваності студентів';
    const metricTitle = isSuccess ? 'Поточний бал (100-бальна)' : 'Відвідуваність (%)';
    
    const specEl = document.getElementById('report-criteria-spec');
    const courseEl = document.getElementById('report-criteria-course');
    const groupEl = document.getElementById('report-criteria-group');

    const specText = specEl?.options[specEl.selectedIndex]?.text || 'Усі';
    const courseText = courseEl?.options[courseEl.selectedIndex]?.text || 'Усі';
    const groupText = groupEl?.options[groupEl.selectedIndex]?.text || 'Усі';

    let excelTemplate = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
        <meta http-equiv="content-type" content="text/plain; charset=UTF-8">
        <style>
            th { background-color: #f1f5f9; color: #475569; font-weight: bold; text-align: center; border: 1px solid #cbd5e1; padding: 6px; }
            td { border: 1px solid #cbd5e1; padding: 6px; }
            .header-title { font-size: 16px; font-weight: bold; color: #1e1b4b; }
            .meta-info { font-size: 11px; color: #475569; }
        </style>
    </head>
    <body>
        <table>
            <tr><td colspan="4" class="header-title">${reportTitle.toUpperCase()}</td></tr>
            <tr><td colspan="4" class="meta-info">Дата генерації: ${new Date().toLocaleDateString('uk-UA')}</td></tr>
            <tr><td colspan="4" class="meta-info">Спеціальність: ${specText} | Курс: ${courseText} | Группа: ${groupText}</td></tr>
            <tr></tr>
            <thead>
                <tr>
                    <th style="text-align: left;">Студент</th>
                    <th style="text-align: left;">Група</th>
                    <th>${metricTitle}</th>
                    <th>Статус</th>
                </tr>
            </thead>
            <tbody>
    `;

    rowsToExport.forEach(r => {
        const currentScore = parseFloat(r.score) || 0;
        const cleanStatus = cleanStatusText(r.status, currentScore);
        const displayScore = currentScore > 0 ? currentScore : (cleanStatus === 'Немає даних' ? '-' : currentScore);

        excelTemplate += `
            <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(r.group_name || r.group)}</td>
                <td style="text-align: center; font-weight: bold;">${displayScore}</td>
                <td>${escapeHtml(cleanStatus)}</td>
            </tr>
        `;
    });

    excelTemplate += `</tbody></table></body></html>`;

    const blob = new Blob([excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement("a");
    const filename = `Звіт_${isSuccess ? 'Успішність' : 'Відвідуваність'}_${new Date().toISOString().slice(0,10)}.xls`;

    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", async () => {
    setupAllSystemFilterListeners(); 
    await initAllSystemFilters();      
});

// Глобальна змінна для збереження активного типу матриці
if (typeof window.activeMatrixType === 'undefined') {
    window.activeMatrixType = 'assignments'; 
}

if (typeof window.systemSearchState === 'undefined') {
    window.systemSearchState = {
        matrixSearchQuery: '',
        activeFilters: {}
    };
}

// Автоматичний старт модуля після готовності DOM
document.addEventListener("DOMContentLoaded", () => {
    initAssignmentsModule();
    if (typeof initModalSystem === 'function') initModalSystem();
    if (typeof initSemesterDateListeners === 'function') initSemesterDateListeners();
    if (typeof loadGlobalSemesterSelector === 'function') loadGlobalSemesterSelector(); 
    initLiveSearchEngine(); 
});

async function initAssignmentsModule() {
    console.log("💼 Ініціалізація модуля навантажень та довідників...");
    
    window.systemSearchState = {
        matrixSearchQuery: '',
        activeFilters: {}
    };

    if (typeof window.resetSystemSearchInput === 'function') {
        window.resetSystemSearchInput();
    } else {
        const searchInput = document.getElementById('search-assignments-input');
        if (searchInput) searchInput.value = ''; 
    }
    
    const tbody = document.getElementById('table-assignments-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="10" style="padding: 50px; text-align: center; color: #94a3b8;"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px; color: #4f46e5; font-size: 18px;"></i> Синхронізація з базою даних...</td></tr>`;
    }

    const results = await Promise.allSettled([
        typeof loadCurrentSemesterInfo === 'function' ? loadCurrentSemesterInfo() : Promise.resolve(),
        typeof preloadAllDropdowns === 'function' ? preloadAllDropdowns() : Promise.resolve(),
        typeof loadCurrentAssignments === 'function' ? loadCurrentAssignments() : Promise.resolve()
    ]);

    results.forEach((res, idx) => {
        if (res.status === 'rejected') {
            console.error(`Помилка ініціалізації потоку №${idx}:`, res.reason);
        }
    });
}


function initLiveSearchEngine() {
    const searchInput = document.getElementById('search-assignments-input');
    if (!searchInput) {
        console.warn("⚠️ Поле пошуку '#search-assignments-input' не знайдено.");
        return;
    }

    searchInput.replaceWith(searchInput.cloneNode(true));
    const activeInput = document.getElementById('search-assignments-input');

    activeInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (window.systemSearchState) {
            window.systemSearchState.matrixSearchQuery = query;
        }
        executeClientSideFiltering(query);
    });
}

window.resetSystemSearchInput = function() {
    if (window.systemSearchState) {
        window.systemSearchState.matrixSearchQuery = '';
    }
    const searchInput = document.getElementById('search-assignments-input');
    if (searchInput) {
        searchInput.value = '';
    }
    executeClientSideFiltering('');
};

function executeClientSideFiltering(query) {
    const tbody = document.getElementById('table-assignments-body');
    if (!tbody) return;

    const rows = tbody.getElementsByTagName('tr');
    let visibleCount = 0;

    if (rows.length === 1 && rows[0].textContent.includes('Синхронізація')) return;

    let actualColumns = 5;
    const firstRealRow = Array.from(rows).find(r => r.id !== 'search-empty-fallback-row');
    if (firstRealRow) {
        actualColumns = firstRealRow.getElementsByTagName('td').length || 5;
    } else {
        const head = document.getElementById('dynamic-table-head');
        if (head) actualColumns = head.getElementsByTagName('th').length || 5;
    }

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.id === 'search-empty-fallback-row') continue;

        const textContent = row.textContent.toLowerCase();
        if (textContent.includes(query)) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    }

    let fallback = document.getElementById('search-empty-fallback-row');
    if (visibleCount === 0 && query !== '') {
        if (!fallback) {
            fallback = document.createElement('tr');
            fallback.id = 'search-empty-fallback-row';
            fallback.innerHTML = `<td colspan="${actualColumns}" style="padding: 30px; text-align: center; color: #64748b;"><i class="fa-solid fa-magnifying-glass"></i> Записів із фрагментом "${escapeHtml(query)}" не знайдено</td>`;
            tbody.appendChild(fallback);
        } else {
            fallback.querySelector('td').setAttribute('colspan', actualColumns);
            fallback.querySelector('td').innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Записів із фрагментом "${escapeHtml(query)}" не знайдено`;
            fallback.style.display = '';
        }
    } else if (fallback) {
        fallback.style.display = 'none';
    }
}

function getApiUrl(endpoint) {
    let base = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : '';
    
    if (base.endsWith('/')) base = base.slice(0, -1);
    if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;
    
    if (base.endsWith('/api') && endpoint.startsWith('/api')) {
        return `${base}${endpoint.substring(4)}`;
    }
    return `${base}${endpoint}`;
}

function getFetchHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = (typeof window.state !== 'undefined' && window.state?.token) 
        ? window.state.token 
        : (localStorage.getItem('token') || '');
        
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}


function generateTableHeaders(type) {
    const baseStyle = `padding: 14px 16px; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase;`;
    switch(type) {
        case 'semesters':
            return `<tr>
                <th style="${baseStyle}">Назва семестру</th>
                <th style="${baseStyle}">№</th>
                <th style="${baseStyle}">Початок</th>
                <th style="${baseStyle}">Кінець</th>
                <th style="${baseStyle} text-align: center;">Тижні</th>
                <th style="${baseStyle} text-align: center;">Статус</th>
                <th style="${baseStyle} text-align: center; width: 100px;">Дії</th>
            </tr>`;
        case 'departments':
            return `<tr><th style="${baseStyle}">Коротка назва</th><th style="${baseStyle}">Повна назва спеціальності</th><th style="${baseStyle} text-align: center; width: 100px;">Дії</th></tr>`;
        case 'groups':
            return `<tr><th style="${baseStyle}">Назва групи</th><th style="${baseStyle}">Курс</th><th style="${baseStyle}">Спеціальницька прив'язка</th><th style="${baseStyle} text-align: center; width: 100px;">Дії</th></tr>`;
        case 'teachers':
            return `<tr><th style="${baseStyle}">ПІБ Викладача</th><th style="${baseStyle}">Email</th><th style="${baseStyle}">Ступінь / Посада</th><th style="${baseStyle} text-align: center; width: 100px;">Дії</th></tr>`;
        case 'subjects':
            return `<tr><th style="${baseStyle}">Назва дисципліни</th><th style="${baseStyle} text-align: center; width: 100px;">Дії</th></tr>`;
        case 'assignments':
        default:
            return `<tr><th style="${baseStyle}">Викладач</th><th style="${baseStyle}">Дисципліна</th><th style="${baseStyle} width: 110px;">Група</th><th style="${baseStyle} width: 120px; text-align: center;">Семестр</th><th style="${baseStyle} width: 100px; text-align: center;">Дія</th></tr>`;
    }
}

async function saveSystemSettings(event) {
    event.preventDefault();
    
    const form = document.getElementById('system-settings-form');
    if (!form) return;

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    const globalSemester = document.getElementById('global-semester-selector');
    if (globalSemester) {
        payload.active_semester_id = globalSemester.value;
    }

    try {
        const response = await fetch(getApiUrl('/api/settings/save'), {
            method: 'POST',
            headers: getFetchHeaders(),
            body: JSON.stringify(payload)
        });
        
        const result = await response.json().catch(() => ({}));

        if (response.ok && (result.success || !result.error)) {
            showSystemToast('⚙️ Параметри конфігурації та робочі семестри успішно оновлено', 'success');
            
            if (typeof loadCurrentSemesterInfo === 'function') await loadCurrentSemesterInfo();
            
            if (typeof loadCurrentAssignments === 'function') {
                await loadCurrentAssignments();
            } else if (typeof fetchAndDisplayMatrix === 'function') {
                await fetchAndDisplayMatrix('assignments', { showModal: false });
            }

            if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
            if (typeof initAdminDashboardFilters === 'function') await initAdminDashboardFilters();
        } else {
            showSystemToast(result.message || 'Помилка оновлення конфігураційних даних.', 'error');
        }
    } catch (error) {
        showSystemToast('Збій з\'єднання при відправці конфігурації на сервер!', 'danger');
    }
}

async function fetchAndDisplayMatrix(type, options = { showModal: true }) {
    window.activeMatrixType = type;
    
    if (options.showModal && typeof window.openCentralModal === 'function') {
        window.openCentralModal('modal-load-matrix');
    }

    const title = document.getElementById('table-view-title');
    const subtitle = document.getElementById('table-view-subtitle');
    const head = document.getElementById('dynamic-table-head');
    const tbody = document.getElementById('table-assignments-body');

    const headersHtml = generateTableHeaders(type);
    if (head) head.innerHTML = headersHtml;

    const tempDiv = document.createElement('tr');
    tempDiv.innerHTML = headersHtml;
    const columnCount = tempDiv.querySelectorAll('th').length || 5;

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="${columnCount}" style="padding: 40px; text-align: center; color: #94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Синхронізація таблиці...</td></tr>`;
    }

    const titles = {
        'assignments': { t: 'Карта розподілу навантаження', s: 'Контроль годин та закріплених викладацьких кадрів' },
        'departments': { t: 'Реєстр спеціальностей коледжу', s: 'Керування структурами факультетів та підрозділів' },
        'groups': { t: 'Академічні групи', s: 'Списки груп, курсів навчання та їх приналежність до кафедр' },
        'teachers': { t: 'Професорсько-викладацький склад', s: 'Управління акаунтами викладачів та their ступенями' },
        'subjects': { t: 'Каталог навчальних дисциплін', s: 'Повний перелік затверджених предметів семестру' },
        'semesters': { t: 'Академічні семестри / Періоди', s: 'Управління термінами навчання, датами та активністю семестрів' }
    };
    
    if (title) title.textContent = titles[type]?.t || 'Матриця розподілу';
    if (subtitle) subtitle.textContent = titles[type]?.s || '';

    if (type === 'assignments') {
        if (typeof loadCurrentAssignments === 'function') {
            try {
                await loadCurrentAssignments();
            } catch (err) {
                console.error("Помилка всередині loadCurrentAssignments:", err);
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="${columnCount}" style="padding: 30px; text-align: center; color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Помилка завантаження карти навантажень.</td></tr>`;
                }
                showSystemToast(`Збій карти навантажень`, 'error');
            }
        } else {
            try {
                const res = await fetch(getApiUrl('/api/admin/assignments'), { headers: getFetchHeaders() });
                if (!res.ok) throw new Error();
                window.rawMatrixData = await res.json();
                renderDynamicMatrix(window.rawMatrixData, columnCount);
            } catch (e) {
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="${columnCount}" style="padding: 30px; text-align: center; color: #ef4444;"><i class="fa-solid fa-bug"></i> Не вдалося отримати карту навантажень з API.</td></tr>`;
                }
            }
        }
        return;
    }

    try {
        const res = await fetch(getApiUrl(`/api/admin/${type}`), { headers: getFetchHeaders() });
        if (!res.ok) throw new Error();
        window.rawMatrixData = await res.json();
        renderDynamicMatrix(window.rawMatrixData, columnCount);
        
        if (window.systemSearchState && window.systemSearchState.matrixSearchQuery) {
            executeClientSideFiltering(window.systemSearchState.matrixSearchQuery);
        }
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="${columnCount}" style="padding: 30px; text-align: center; color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Дані поточного реєстру недоступні.</td></tr>`;
        }
        if (typeof showSystemToast === 'function') {
            showSystemToast(`Збій синхронізації реєстру даних: ${type}`, 'error');
        }
    }
}

// рендеринг даних
function renderDynamicMatrix(data, columnCount = 5) {
    const tbody = document.getElementById('table-assignments-body');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${columnCount}" style="padding: 30px; text-align: center; color: #64748b;">Записів у цій категорії немає</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(row => {
        let cells = '';
        const id = row.id;
        let entityTypeMap = {
            'assignments': 'assignment',
            'departments': 'department',
            'groups': 'group',
            'teachers': 'teacher',
            'subjects': 'subject',
            'semesters': 'semester'
        };
        let entitySingular = entityTypeMap[window.activeMatrixType] || 'entity';

        if (window.activeMatrixType === 'assignments') {
            const tName = row.teacherName || row.teacher_name || (row.teacher ? `${row.teacher.last_name} ${row.teacher.first_name}` : '—');
            const sName = row.subjectName || row.subject_name || (row.subject ? row.subject.name : '—');
            const gName = row.groupName || row.group_name || (row.group ? row.group.name : '—');
            const pName = row.periodName || row.period_name || row.semester_name || 'Поточний';

            cells = `
                <td style="padding: 14px 16px; font-weight: 600; color: #1e293b;">${escapeHtml(tName)}</td>
                <td style="padding: 14px 16px; color: #334155;">${escapeHtml(sName)}</td>
                <td style="padding: 14px 16px;"><span style="background: #f1f5f9; color: #334155; padding: 4px 8px; border-radius: 6px; font-size:12px; font-weight:700;">${escapeHtml(gName)}</span></td>
                <td style="padding: 14px 16px; text-align: center; color: #6d28d9; font-weight: 500;">${escapeHtml(pName)}</td>
            `;
        } else if (window.activeMatrixType === 'departments') {
            cells = `
                <td style="padding: 14px 16px; font-weight: 700; color: #4f46e5;">${escapeHtml(row.shortName || row.short_name || '—')}</td>
                <td style="padding: 14px 16px; color: #1e293b;">${escapeHtml(row.name || '—')}</td>
            `;
        } else if (window.activeMatrixType === 'groups') {
            cells = `
                <td style="padding: 14px 16px; font-weight: 700; color: #0f172a;">${escapeHtml(row.name || '—')}</td>
                <td style="padding: 14px 16px; color: #475569;">${escapeHtml(row.course || '—')} курс</td>
                <td style="padding: 14px 16px;"><span style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-size:12px; font-weight:600;">${escapeHtml(row.departmentName || row.department_name || 'Загальна')}</span></td>
            `;
        } else if (window.activeMatrixType === 'teachers') {
            const fullName = `${row.last_name || row.lastName || ''} ${row.first_name || row.firstName || ''}`.trim();
            cells = `
                <td style="padding: 14px 16px; font-weight: 600; color: #1e293b;">${escapeHtml(fullName || '—')}</td>
                <td style="padding: 14px 16px; color: #475569; font-size:13px;">${escapeHtml(row.email || '—')}</td>
                <td style="padding: 14px 16px; color: #059669; font-weight: 500;">${escapeHtml(row.degree || 'Викладач')}</td>
            `;
        } else if (window.activeMatrixType === 'subjects') {
            cells = `
                <td style="padding: 14px 16px; font-weight: 500; color: #1e293b;">${escapeHtml(row.name || '—')}</td>
            `;
        } else if (window.activeMatrixType === 'semesters') {
            const statusBadge = row.is_active 
                ? `<span style="background: #e6fffa; color: #047457; padding: 4px 8px; border-radius: 6px; font-size:12px; font-weight:700; border: 1px solid #c6f6d5;">Активний</span>` 
                : `<span style="background: #f7fafc; color: #718096; padding: 4px 8px; border-radius: 6px; font-size:12px; border: 1px solid #e2e8f0;">Архів</span>`;

            const sDate = row.start_date ? row.start_date.split('T')[0] : '—';
            const eDate = row.end_date ? row.end_date.split('T')[0] : '—';

            cells = `
                <td style="padding: 14px 16px; font-weight: 600; color: #1e293b;">${escapeHtml(row.name || '—')}</td>
                <td style="padding: 14px 16px; color: #475569;">${row.semester_number || '—'}</td>
                <td style="padding: 14px 16px; color: #1e293b;">${sDate}</td>
                <td style="padding: 14px 16px; color: #1e293b;">${eDate}</td>
                <td style="padding: 14px 16px; text-align: center; font-weight: 700; color: #4f46e5;">${row.total_weeks || '0'}</td>
                <td style="padding: 14px 16px; text-align: center;">${statusBadge}</td>
            `;
        }

        return `
            <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                ${cells}
                <td style="padding: 14px 16px; text-align: center;">
                    <div style="display: flex; justify-content: center; gap: 8px;">
                        <button type="button" onclick="${window.activeMatrixType === 'semesters' ? `openSemesterFormInline(${id})` : `editEntityInline('${entitySingular}', ${id})`}" style="background: none; border: none; color: #4f46e5; cursor: pointer; padding: 4px; font-size:14px;">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" onclick="confirmRecordDeletion('${window.activeMatrixType}', ${id})" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px; font-size:14px;">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// розрахунок тижнів
function calculateWeeksBetweenDates(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return 0;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;
    
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return Math.ceil(diffDays / 7);
}

function calculateSemesterWeeksLive() {
    const startInput = document.getElementById('semester-start-input');
    const endInput = document.getElementById('semester-end-input');
    const autoWeeksInput = document.getElementById('sem-total-weeks');

    if (!startInput || !endInput) return;

    const weeks = calculateWeeksBetweenDates(startInput.value, endInput.value);
    if (autoWeeksInput) {
        autoWeeksInput.value = weeks > 0 ? weeks : '0';
    }
}

function initSemesterDateListeners() {
    const startInput = document.getElementById('semester-start-input');
    const endInput = document.getElementById('semester-end-input');

    if (startInput && endInput) {
        startInput.replaceWith(startInput.cloneNode(true));
        endInput.replaceWith(endInput.cloneNode(true));

        const activeStart = document.getElementById('semester-start-input');
        const activeEnd = document.getElementById('semester-end-input');

        activeStart.addEventListener('input', calculateSemesterWeeksLive);
        activeEnd.addEventListener('input', calculateSemesterWeeksLive);
        
        calculateSemesterWeeksLive();
    }
}

window.isSystemSavingSilently = false;

// активний семестр
window.loadCurrentSemesterInfo = async function() {
    try {
        const url = typeof getApiUrl === 'function' ? getApiUrl('/api/settings/current-semester') : '/api/settings/current-semester';
        const headers = typeof getFetchHeaders === 'function' ? getFetchHeaders() : { 'Content-Type': 'application/json' };

        const response = await fetch(url, { method: 'GET', headers: headers });
        
        const infoSemesterName = document.getElementById('info-semester-name');
        const infoSemesterDates = document.getElementById('info-semester-dates');
        const infoSemesterWeeks = document.getElementById('info-semester-weeks');
        const activeBadge = document.getElementById('auto-semester-badge');

        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            
            if (data && data.id) {
                const formatDate = (dateStr) => {
                    if (!dateStr) return '--.--.----';
                    const d = new Date(dateStr);
                    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('uk-UA');
                };

                if (infoSemesterName) infoSemesterName.textContent = data.name || 'Без назви';
                if (infoSemesterDates) infoSemesterDates.textContent = `${formatDate(data.startDate || data.start_date)} - ${formatDate(data.endDate || data.end_date)}`;
                if (infoSemesterWeeks) infoSemesterWeeks.textContent = data.weeks || data.total_weeks || '0';
                if (activeBadge) activeBadge.style.display = 'inline-block';
                return;
            }
        }
        
        if (infoSemesterName) infoSemesterName.textContent = "Період не обрано";
        if (infoSemesterDates) infoSemesterDates.textContent = "--.--.---- - --.--.----";
        if (infoSemesterWeeks) infoSemesterWeeks.textContent = "0";
        if (activeBadge) activeBadge.style.display = 'none';

    } catch (error) {
        console.error("Помилка завантаження активного семестру:", error);
    }
};


window.openEntityForm = function(type, editRecord = null) {
    if (window.event) {
        window.event.stopPropagation();
    }

    if (typeof window.resetSystemSearchInput === 'function') {
        window.resetSystemSearchInput();
    }

    if (typeof window.closeCentralModal === 'function') window.closeCentralModal('modal-add-hub'); 

    const title = document.getElementById('entity-modal-title');
    const typeHidden = document.getElementById('entity-type-hidden');
    const idHidden = document.getElementById('entity-id-hidden');
    const container = document.getElementById('entity-fields-container');
    const form = document.getElementById('form-universal-entity');

    if (form) form.reset();

    let normType = type === 'assignments' ? 'assignment' : type;

    if (typeHidden) typeHidden.value = normType;
    if (idHidden) idHidden.value = editRecord ? editRecord.id : '';
    if (!container) return;
    
    container.innerHTML = ''; 

    const labelStyle = `display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px; margin-top:10px;`;
    const inputStyle = `width:100%; padding:9px 12px; border-radius:8px; border:1px solid #cbd5e1; font-size:14px; color:#1e293b; background:#fff;`;

    let entityName = '';
    if (editRecord) {
        if (normType === 'department') entityName = editRecord.name || '';
        else if (normType === 'teacher') entityName = `${editRecord.lastName || editRecord.last_name || ''} ${editRecord.firstName || editRecord.first_name || ''}`.trim();
        else if (normType === 'group') entityName = editRecord.name || '';
        else if (normType === 'subject') entityName = editRecord.name || '';
        else if (normType === 'assignment') entityName = editRecord.subject_name || 'Запис навантаження';
    }

    const safeEscape = (val) => typeof escapeHtml === 'function' ? escapeHtml(String(val ?? '')) : String(val ?? '');

    if (normType === 'department') {
        if (title) title.innerHTML = editRecord ? `<i class="fa-solid fa-building-columns" style="color:#4f46e5;"></i> Редагування: ${safeEscape(entityName)}` : '<i class="fa-solid fa-building-columns" style="color:#4f46e5;"></i> Додати спеціальність';
        container.innerHTML = `
            <label style="${labelStyle}">Повна назва спеціальності</label>
            <input type="text" name="name" required style="${inputStyle}" placeholder="Напр. Спеціальність Комп'ютерних Наук" value="${editRecord ? safeEscape(editRecord.name) : ''}">
            <label style="${labelStyle}">Коротка назва (абревіатура)</label>
            <input type="text" name="shortName" required style="${inputStyle}" placeholder="Напр. КН" value="${editRecord ? safeEscape(editRecord.shortName || editRecord.short_name) : ''}">
        `;
    } 
    else if (normType === 'teacher') {
        if (title) title.innerHTML = editRecord ? `<i class="fa-solid fa-user-tie" style="color:#10b981;"></i> Редагування: ${safeEscape(entityName)}` : '<i class="fa-solid fa-user-tie" style="color:#10b981;"></i> Додати викладача';
        container.innerHTML = `
            <label style="${labelStyle}">Ім'я викладача</label>
            <input type="text" name="firstName" required style="${inputStyle}" value="${editRecord ? safeEscape(editRecord.firstName || editRecord.first_name) : ''}">
            <label style="${labelStyle}">Прізвище викладача</label>
            <input type="text" name="lastName" required style="${inputStyle}" value="${editRecord ? safeEscape(editRecord.lastName || editRecord.last_name) : ''}">
            <label style="${labelStyle}">Електронна пошта (Email)</label>
            <input type="email" name="email" required style="${inputStyle}" value="${editRecord ? safeEscape(editRecord.email) : ''}">
            <label style="${labelStyle}">Вчений ступінь / Посада</label>
            <input type="text" name="degree" style="${inputStyle}" placeholder="Напр. Доцент, к.т.н." value="${editRecord ? safeEscape(editRecord.degree) : ''}">
        `;
    } 
    else if (normType === 'group') {
        if (title) title.innerHTML = editRecord ? `<i class="fa-solid fa-users-rectangle" style="color:#06b6d4;"></i> Редагування групи: ${safeEscape(entityName)}` : '<i class="fa-solid fa-users-rectangle" style="color:#06b6d4;"></i> Створити академічну групу';
        container.innerHTML = `
            <label style="${labelStyle}">Назва групи</label>
            <input type="text" name="name" required style="${inputStyle}" placeholder="Напр. ІПЗ-22-1" value="${editRecord ? safeEscape(editRecord.name) : ''}">
            <label style="${labelStyle}">Курс навчання</label>
            <input type="number" name="course" min="1" max="6" required style="${inputStyle}" value="${editRecord ? safeEscape(editRecord.course) : ''}">
            <label style="${labelStyle}">Спеціальницька прив'язка</label>
            <select id="modal-group-dept-select" name="departmentId" required style="${inputStyle}"></select>
        `;
        
        if (typeof loadDepartmentsToModalGroup === 'function') {
            loadDepartmentsToModalGroup().then(() => {
                const sel = document.getElementById('modal-group-dept-select');
                if (sel && editRecord) {
                    sel.value = editRecord.departmentId || editRecord.department_id || '';
                }
            });
        }
    } 
    else if (normType === 'subject') {
        if (title) title.innerHTML = editRecord ? `<i class="fa-solid fa-book-open" style="color:#f59e0b;"></i> Редагування: ${safeEscape(entityName)}` : '<i class="fa-solid fa-book-open" style="color:#f59e0b;"></i> Створити дисципліну';
        container.innerHTML = `
            <label style="${labelStyle}">Назва предмета</label>
            <input type="text" name="name" required style="${inputStyle}" placeholder="Напр. Вища Математика" value="${editRecord ? safeEscape(editRecord.name) : ''}">
        `;
    } 
    else if (normType === 'assignment') {
        if (title) title.innerHTML = editRecord ? `<i class="fa-solid fa-scroll" style="color:#6366f1;"></i> Редагувати розподіл навантаження` : '<i class="fa-solid fa-scroll" style="color:#6366f1;"></i> Розподілити семестрове навантаження';
        
        container.innerHTML = `
            <label style="${labelStyle}">Оберіть викладача</label>
            <select id="modal-assign-teacher" name="teacherId" required style="${inputStyle}"></select>
            
            <label style="${labelStyle}">Оберіть дисципліну</label>
            <select id="modal-assign-subject" name="subjectId" required style="${inputStyle}"></select>
            
            <label style="${labelStyle}">Оберіть академічну групу</label>
            <select id="modal-assign-group" name="groupId" required style="${inputStyle}"></select>

            <label style="${labelStyle}">Навчальний період (Семестр)</label>
            <select id="modal-assign-period" name="periodId" required style="${inputStyle}"></select>
        `;

        if (typeof window.populateAssignDropdowns === 'function') {
            window.populateAssignDropdowns(editRecord);
        }
    }

    setTimeout(() => {
        if (typeof window.openCentralModal === 'function') {
            window.openCentralModal('modal-single-entity');
        }
        if (typeof rebindFormSubmitEvents === 'function') rebindFormSubmitEvents();
    }, 50);
};

if (window.closeCentralModal && !window.closeCentralModalOldPassed) {
    window.closeCentralModalOld = window.closeCentralModal;
    
    window.closeCentralModal = async function(modalId) {
        if (typeof window.closeCentralModalOld === 'function') {
            window.closeCentralModalOld(modalId);
        }

        if (modalId === 'modal-single-entity' || modalId === 'modal-semester-form') {
            if (typeof window.resetSystemSearchInput === 'function') {
                window.resetSystemSearchInput();
            }
            
            if (typeof fetchAndDisplayMatrix === 'function' && window.activeMatrixType) {
                await fetchAndDisplayMatrix(window.activeMatrixType, { showModal: false, silent: true });
            }
        }
    };
    window.closeCentralModalOldPassed = true;
}

window.openSemesterFormInline = function(idOrRecord = null) {
    if (window.event) {
        window.event.stopPropagation();
    }

    const form = document.getElementById('semester-form');
    if (form) form.reset();

    const modalTitle = document.getElementById('semester-modal-title');
    window.currentEditSemesterId = null;

    let record = null;
    if (idOrRecord && typeof idOrRecord === 'object') {
        record = idOrRecord;
        window.currentEditSemesterId = record.id || null;
    } else if (idOrRecord) {
        window.currentEditSemesterId = idOrRecord;
        const matrix = typeof window.rawMatrixData !== 'undefined' ? window.rawMatrixData : [];
        record = matrix.find(item => String(item.id) === String(idOrRecord));
    }

    if (window.currentEditSemesterId && record) {
        if (modalTitle) modalTitle.innerHTML = `<i class="fa-solid fa-pen-to-square" style="color:#4f46e5;"></i> Редагувати навчальний період`;
        
        if (document.getElementById('semester-name-input')) document.getElementById('semester-name-input').value = record.name || '';
        if (document.getElementById('semester-number-input')) document.getElementById('semester-number-input').value = record.semester_number || record.number || '';
        
        const sDate = record.start_date ? record.start_date.split('T')[0] : (record.startDate || '');
        const eDate = record.end_date ? record.end_date.split('T')[0] : (record.endDate || '');

        if (document.getElementById('semester-start-input')) document.getElementById('semester-start-input').value = sDate;
        if (document.getElementById('semester-end-input')) document.getElementById('semester-end-input').value = eDate;
        if (document.getElementById('semester-active-checkbox')) document.getElementById('semester-active-checkbox').checked = !!(record.is_active || record.isActive);
    } else {
        if (modalTitle) modalTitle.innerHTML = `<i class="fa-solid fa-calendar-plus" style="color:#4f46e5;"></i> Створити новий навчальний період`;
        if (document.getElementById('semester-active-checkbox')) document.getElementById('semester-active-checkbox').checked = false;
        if (document.getElementById('sem-total-weeks')) document.getElementById('sem-total-weeks').value = '0';
    }

    if (typeof window.closeCentralModal === 'function') {
        window.closeCentralModal('modal-load-matrix');
        window.closeCentralModal('modal-add-hub');
    }

    setTimeout(() => {
        if (typeof window.openCentralModal === 'function') {
            window.openCentralModal('modal-semester-form');
        }
        if (typeof initSemesterDateListeners === 'function') initSemesterDateListeners();
        if (typeof rebindFormSubmitEvents === 'function') rebindFormSubmitEvents();
    }, 50);
};

window.handleSemesterFormSubmit = async function(event) {
    if (event) {
        event.preventDefault(); 
        event.stopImmediatePropagation(); 
    }

    const name = document.getElementById('semester-name-input')?.value?.trim();
    const semester_number = document.getElementById('semester-number-input')?.value?.trim();
    const start_date = document.getElementById('semester-start-input')?.value;
    const end_date = document.getElementById('semester-end-input')?.value;
    const is_active = document.getElementById('semester-active-checkbox')?.checked;

    if (!name || !semester_number || !start_date || !end_date) {
        if (typeof showSystemToast === 'function') showSystemToast('Будь ласка, заповніть усі обовʼязкові поля форми!', 'warning');
        return;
    }

    const total_weeks = calculateWeeksBetweenDates(start_date, end_date);
    if (total_weeks <= 0) {
        if (typeof showSystemToast === 'function') showSystemToast('Дата завершення повинна бути більшою за дату початку!', 'error');
        return;
    }
    
    const payload = {
        name: name,
        semester_number: parseInt(semester_number, 10),
        start_date: start_date,
        end_date: end_date,
        total_weeks: total_weeks,
        is_active: !!is_active
    };

    const isEdit = window.currentEditSemesterId !== null;
    const url = isEdit ? `/api/admin/semesters/${window.currentEditSemesterId}` : '/api/admin/semesters';
    const method = isEdit ? 'PUT' : 'POST';

    const finalUrl = typeof getApiUrl === 'function' ? getApiUrl(url) : url;
    const finalHeaders = typeof getFetchHeaders === 'function' ? getFetchHeaders() : { 'Content-Type': 'application/json' };

    try {
        window.isSystemSavingSilently = true;

        const response = await fetch(finalUrl, {
            method: method,
            headers: finalHeaders,
            body: JSON.stringify(payload)
        });
        
        const result = await response.json().catch(() => ({}));

        if (response.ok && (result.success || !result.error)) {
            if (typeof showSystemToast === 'function') {
                showSystemToast(isEdit ? '🔄 Дані семестру успішно оновлено!' : '📅 Новий семестр успішно створено!', 'success');
            }
            
            if (typeof window.closeCentralModal === 'function') {
                window.closeCentralModal('modal-semester-form');
            }

            if (typeof loadAcademicPeriods === 'function') await loadAcademicPeriods();
            await window.loadCurrentSemesterInfo();
            if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
            if (typeof loadCurrentAssignments === 'function') await loadCurrentAssignments();
            
            if (typeof fetchAndDisplayMatrix === 'function' && window.activeMatrixType) {
                await fetchAndDisplayMatrix(window.activeMatrixType, { showModal: false });
            }
            
        } else {
            const errorMsg = result.error || result.message || 'Помилка збереження семестру.';
            if (typeof showSystemToast === 'function') showSystemToast(errorMsg, 'error');
        }
    } catch (error) {
        console.error("Критична помилка збереження семестру:", error);
    } finally {
        setTimeout(() => { window.isSystemSavingSilently = false; }, 200);
    }
};

window.handleUniversalEntitySubmit = async function(event) {
    event.preventDefault(); 
    event.stopImmediatePropagation(); 

    const typeEl = document.getElementById('entity-type-hidden');
    if (!typeEl) return;
    const type = typeEl.value;

    if (type === 'semester') {
        await window.handleSemesterFormSubmit(event);
        return;
    }

    const idEl = document.getElementById('entity-id-hidden');
    const id = (idEl && idEl.value && idEl.value !== '0') ? idEl.value.trim() : null;
    
    let hasEmptyFields = false;
    const inputs = event.target.querySelectorAll('input[required], select[required]');
    inputs.forEach(input => { if (!input.value.trim()) hasEmptyFields = true; });

    if (hasEmptyFields) {
        if (typeof showSystemToast === 'function') showSystemToast('Будь ласка, заповніть усі обовʼязкові поля форми!', 'warning');
        return;
    }

    const formData = new FormData(event.target);
    const payload = {};
    formData.forEach((value, key) => {
        if (['course', 'departmentId', 'teacherId', 'subjectId', 'groupId', 'periodId', 'semesterId', 'department_id', 'weeks'].includes(key)) {
            payload[key] = value ? parseInt(value, 10) : null;
        } else {
            payload[key] = value;
        }
    });

    const endpointMap = { 
        'department': 'departments', 
        'teacher': 'teachers', 
        'group': 'groups', 
        'subject': 'subjects',
        'assignment': 'teacher-subjects' 
    };
    const pluralType = endpointMap[type] || 'departments';
    const finalMethod = id ? 'PUT' : 'POST';
    const finalUrl = id ? `/api/admin/${pluralType}/${id}` : `/api/admin/${pluralType}`;

    try {
        window.isSystemSavingSilently = true;

        const res = await fetch(getApiUrl(finalUrl), {
            method: finalMethod,
            headers: getFetchHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const humanLabels = { 'department': 'Спеціальність', 'teacher': 'Викладач', 'group': 'Група', 'subject': 'Дисципліна', 'assignment': 'Навантаження' };
            if (typeof showSystemToast === 'function') {
                showSystemToast(id ? `${humanLabels[type] || 'Запис'} — успішно оновлено!` : `${humanLabels[type] || 'Запис'} — успішно створено!`, 'success');
            }
            
            if (typeof window.closeCentralModal === 'function') window.closeCentralModal('modal-single-entity');
            if (typeof window.closeAllModalsGlobal === 'function') window.closeAllModalsGlobal();
            
            if (type === 'assignment') {
                window.activeMatrixType = 'assignments';
                if (typeof loadCurrentAssignments === 'function') await loadCurrentAssignments();
            }

            if (typeof fetchAndDisplayMatrix === 'function' && window.activeMatrixType) {
                await fetchAndDisplayMatrix(window.activeMatrixType, { showModal: false });
            }
        } else {
            const errData = await res.json().catch(() => ({}));
            if (typeof showSystemToast === 'function') showSystemToast(`Помилка: ${errData.error || 'Дія відхилена сервером'}`, 'error');
        }
    } catch (e) {
        console.error("Помилка надсилання універсальної форми:", e);
    } finally {
        setTimeout(() => { window.isSystemSavingSilently = false; }, 200);
    }
};

function patchAnalyticsPeriodSelector() {
    const periodSelect = document.getElementById('analytics-period-filter') || document.getElementById('report-criteria-period');
    if (!periodSelect) return;

    Array.from(periodSelect.options).forEach(option => {
        const text = option.textContent.toLowerCase();
        
        if (text.includes('i семестр') || text.includes('1 семестр') || text.includes('1-й семестр')) {
            option.setAttribute('data-active', 'false');
        } else if (text.includes('ii семестр') || text.includes('2 семестр') || text.includes('2-й семестр')) {
            option.setAttribute('data-active', 'true');
        }
    });
}

if (typeof window.loadCurrentSemesterInfo === 'function') {
    const originalLoadInfo = window.loadCurrentSemesterInfo;
    window.loadCurrentSemesterInfo = async function(...args) {
        await originalLoadInfo.apply(this, args);
        patchAnalyticsPeriodSelector();
    };
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(patchAnalyticsPeriodSelector, 500);
});

function rebindFormSubmitEvents() {
    const semesterForm = document.getElementById('semester-form');
    if (semesterForm) {
        semesterForm.removeAttribute('onsubmit'); 
        semesterForm.removeEventListener('submit', window.handleSemesterFormSubmit);
        semesterForm.addEventListener('submit', window.handleSemesterFormSubmit);
    }
    
    const universalForm = document.getElementById('form-universal-entity');
    if (universalForm) {
        universalForm.removeAttribute('onsubmit');
        universalForm.removeEventListener('submit', window.handleUniversalEntitySubmit);
        universalForm.addEventListener('submit', window.handleUniversalEntitySubmit);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    rebindFormSubmitEvents();
});

async function loadCurrentAssignments() {
    const tbody = document.getElementById('table-assignments-body');
    const head = document.getElementById('dynamic-table-head');
    if (!tbody) return;

    if (window.activeMatrixType === 'assignments' && head) {
        head.innerHTML = generateTableHeaders('assignments');
    }

    try {
        const globalSemester = document.getElementById('global-semester-selector');
        let periodId = globalSemester ? globalSemester.value : '';
        
        if (globalSemester && globalSemester.options.length <= 1 && !periodId) {
            setTimeout(loadCurrentAssignments, 150);
            return;
        }

        let url = '/api/admin/teacher-subjects';
        if (periodId && periodId !== 'null' && periodId !== 'undefined' && periodId.trim() !== '') {
            url += `?period_id=${parseInt(periodId, 10)}`;
        }

        const res = await fetch(getApiUrl(url), { headers: getFetchHeaders() });
        if (!res.ok) throw new Error("Помилка сервера");
        
        window.loadedAssignments = await res.json();
        if (window.activeMatrixType !== 'assignments') return;

        if (!window.loadedAssignments || window.loadedAssignments.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding: 30px; text-align: center; color: #64748b;"><i class="fa-solid fa-folder-open"></i> Розподілу навантаження немає</td></tr>`;
            return;
        }

        tbody.innerHTML = window.loadedAssignments.map(row => `
            <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                <td style="padding: 14px 16px; font-weight: 500; color: #1e293b;">${escapeHtml(row.teacher_name || '—')}</td>
                <td style="padding: 14px 16px; color: #475569;">${escapeHtml(row.subject_name || '—')}</td>
                <td style="padding: 14px 16px; font-weight: 600; color: #4f46e5;">
                    <span style="background: #f1f5f9; padding: 4px 8px; border-radius: 4px; font-size:12px;">${escapeHtml(row.group_name || '—')}</span>
                </td>
                <td style="padding: 14px 16px; text-align: center; color: #64748b; font-size: 13px;">${escapeHtml(row.semester_name || '—')}</td>
                <td style="padding: 14px 16px; text-align: center;">
                    <div style="display: flex; justify-content: center; gap: 8px;">
                        <button type="button" onclick="editEntityInline('assignment', ${row.id})" style="background: none; border: none; color: #4f46e5; cursor: pointer; padding: 6px;">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" onclick="confirmRecordDeletion('assignments', ${row.id})" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 6px;">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        if (window.activeMatrixType === 'assignments') {
            tbody.innerHTML = `<tr><td colspan="5" style="padding: 30px; text-align: center; color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Помилка завантаження карти навантаження семестру.</td></tr>`;
        }
    }
}

window.isSystemSavingSilently = false;

function forceCloseAllModalsHard() {
    const modalsToHide = ['modal-single-entity', 'modal-add-hub', 'modal-load-matrix', 'modal-semester-form'];
    modalsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.setProperty('display', 'none', 'important');
            el.classList.remove('show', 'active', 'visible');
        }
    });
    const backdrop = document.querySelector('.modal-backdrop, .modal-overlay');
    if (backdrop) backdrop.remove();
}

window.handleUniversalEntitySubmit = async function(event) {
    event.preventDefault(); 
    event.stopImmediatePropagation(); 

    const typeEl = document.getElementById('entity-type-hidden');
    if (!typeEl) return;
    const type = typeEl.value;

    if (type === 'semester') {
        if (typeof window.handleSemesterFormSubmit === 'function') {
            await window.handleSemesterFormSubmit(event);
        }
        return;
    }

    const idEl = document.getElementById('entity-id-hidden');
    const id = (idEl && idEl.value && idEl.value !== '0') ? idEl.value.trim() : null;
    
    let hasEmptyFields = false;
    const inputs = event.target.querySelectorAll('input[required], select[required]');
    inputs.forEach(input => { if (!input.value.trim()) hasEmptyFields = true; });

    if (hasEmptyFields) {
        if (typeof showSystemToast === 'function') showSystemToast('Будь ласка, заповніть усі обовʼязкові поля форми!', 'warning');
        return;
    }

    const formData = new FormData(event.target);
    const payload = {};
    formData.forEach((value, key) => {
        if (['course', 'departmentId', 'teacherId', 'subjectId', 'groupId', 'periodId', 'semesterId', 'department_id', 'weeks'].includes(key)) {
            payload[key] = value ? parseInt(value, 10) : null;
        } else {
            payload[key] = value;
        }
    });

    const endpointMap = { 
        'department': 'departments', 
        'teacher': 'teachers', 
        'group': 'groups', 
        'subject': 'subjects',
        'assignment': 'teacher-subjects' 
    };
    const pluralType = endpointMap[type] || 'departments';
    const finalMethod = id ? 'PUT' : 'POST';
    const finalUrl = id ? `/api/admin/${pluralType}/${id}` : `/api/admin/${pluralType}`;

    try {
        // 🔥 Вмикаємо режим повної тиші
        window.isSystemSavingSilently = true;
        forceCloseAllModalsHard();

        const res = await fetch(getApiUrl(finalUrl), {
            method: finalMethod,
            headers: getFetchHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const humanLabels = { 'department': 'Спеціальність', 'teacher': 'Викладач', 'group': 'Група', 'subject': 'Дисципліна', 'assignment': 'Навантаження' };
            if (typeof showSystemToast === 'function') {
                showSystemToast(id ? `${humanLabels[type] || 'Запис'} — успішно оновлено!` : `${humanLabels[type] || 'Запис'} — успешно створено!`, 'success');
            }
            
            if (type === 'assignment') {
                window.activeMatrixType = 'assignments';
                if (typeof loadCurrentAssignments === 'function') await loadCurrentAssignments();
            }

            // Фонове оновлення таблиці
            if (typeof fetchAndDisplayMatrix === 'function' && window.activeMatrixType) {
                await fetchAndDisplayMatrix(window.activeMatrixType, { showModal: false, silent: true });
            }

            // Жорстко підчищаємо інтерфейс у кілька етапів, щоб перебити чужі таймаути
            forceCloseAllModalsHard();
            setTimeout(forceCloseAllModalsHard, 50);
            setTimeout(forceCloseAllModalsHard, 150);
            setTimeout(forceCloseAllModalsHard, 400);

        } else {
            const errData = await res.json().catch(() => ({}));
            if (typeof showSystemToast === 'function') showSystemToast(`Помилка: ${errData.error || 'Дія відхилена сервером'}`, 'error');
            window.isSystemSavingSilently = false;
        }
    } catch (e) {
        console.error("Помилка надсилання універсальної форми:", e);
        window.isSystemSavingSilently = false;
    } finally {
        setTimeout(() => { 
            window.isSystemSavingSilently = false; 
        }, 550);
    }
};

if (!window.openCentralModalOld) {
    window.openCentralModalOld = window.openCentralModal;
}

window.openCentralModal = function(modalId) {
    if (window.isSystemSavingSilently) {
        console.warn(`[Блокувальник] Вікно ${modalId} заблоковано. Залишаємось на головній.`);
        forceCloseAllModalsHard();
        return false; 
    }

    if (typeof window.openCentralModalOld === 'function') {
        window.openCentralModalOld(modalId);
    }

    if (modalId === 'modal-semester' || modalId === 'modal-semester-form' || modalId === 'modal-single-entity') {
        setTimeout(() => {
            if (typeof initSemesterDateListeners === 'function') initSemesterDateListeners();
            if (typeof rebindFormSubmitEvents === 'function') rebindFormSubmitEvents();
        }, 50);
    }
};

window.populateAssignDropdowns = async function(editRecord = null) {
    const tSel = document.getElementById('modal-assign-teacher');
    const sSel = document.getElementById('modal-assign-subject');
    const gSel = document.getElementById('modal-assign-group');
    const pSel = document.getElementById('modal-assign-period');

    try {
        const [tRes, sRes, gRes, pRes] = await Promise.all([
            fetch(getApiUrl('/api/admin/teachers'), { headers: getFetchHeaders() }).then(r => r.json()).catch(() => []),
            fetch(getApiUrl('/api/admin/subjects'), { headers: getFetchHeaders() }).then(r => r.json()).catch(() => []),
            fetch(getApiUrl('/api/admin/groups'), { headers: getFetchHeaders() }).then(r => r.json()).catch(() => []),
            fetch(getApiUrl('/api/admin/semesters'), { headers: getFetchHeaders() }).then(r => r.json()).catch(() => [])
        ]);

        if (tSel) {
            tSel.innerHTML = '<option value="">-- Оберіть викладача --</option>' + 
                tRes.map(t => `<option value="${t.id}">${escapeHtml(t.last_name || t.lastName || '')} ${escapeHtml(t.first_name || t.firstName || '')}</option>`).join('');
        }
        if (sSel) {
            sSel.innerHTML = '<option value="">-- Оберіть дисципліну --</option>' + 
                sRes.map(s => `<option value="${s.id}">${escapeHtml(s.name || '')}</option>`).join('');
        }
        if (gSel) {
            gSel.innerHTML = '<option value="">-- Оберіть групу --</option>' + 
                gRes.map(g => `<option value="${g.id}">${escapeHtml(g.name || '')}</option>`).join('');
        }
        if (pSel) {
            pSel.innerHTML = '<option value="">-- Оберіть семестр --</option>' + 
                pRes.map(p => `<option value="${p.id}">${escapeHtml(p.name || '')}</option>`).join('');
        }

        if (editRecord) {
            if (tSel) tSel.value = editRecord.teacher_id || editRecord.teacherId || '';
            if (sSel) sSel.value = editRecord.subject_id || editRecord.subjectId || '';
            if (gSel) gSel.value = editRecord.group_id || editRecord.groupId || '';
            if (pSel) pSel.value = editRecord.period_id || editRecord.periodId || editRecord.semester_id || '';
        }
    } catch (err) {
        console.error("Помилка завантаження списків форми розподілу:", err);
    }
};

async function loadDepartmentsToModalGroup() {
    const sel = document.getElementById('modal-group-dept-select');
    if (!sel) return;
    try {
        const res = await fetch(getApiUrl('/api/admin/departments'), { headers: getFetchHeaders() });
        if (res.ok) {
            const list = await res.json();
            sel.innerHTML = '<option value="">-- Оберіть спеціальність --</option>' + 
                list.map(d => `<option value="${d.id}">${escapeHtml(d.name)} (${escapeHtml(d.shortName || d.short_name || '')})</option>`).join('');
        }
    } catch(e) { console.error("❌ Помилка завантаження кафедр:", e); }
}

function fillSelectElement(elementId, data, textFn) {
    const select = document.getElementById(elementId);
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Оберіть значення --</option>';
    if (!Array.isArray(data)) return;

    data.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id || item._id; 
        opt.textContent = textFn(item);
        select.appendChild(opt);
    });
}

async function preloadAllDropdowns() {
    try {
        const [teachersRes, subjectsRes, groupsRes, periodsRes] = await Promise.all([
            fetch(getApiUrl('/api/admin/teachers'), { headers: getFetchHeaders() }).catch(() => null),
            fetch(getApiUrl('/api/admin/subjects'), { headers: getFetchHeaders() }).catch(() => null),
            fetch(getApiUrl('/api/admin/groups'), { headers: getFetchHeaders() }).catch(() => null),
            fetch(getApiUrl('/api/admin/semesters'), { headers: getFetchHeaders() }).catch(() => null)
        ]);

        if (teachersRes && teachersRes.ok) {
            const teachers = await teachersRes.json();
            const validTeachers = teachers.filter(t => t.last_name || t.lastName || t.first_name || t.firstName);
            fillSelectElement('assignment-teacher-select', validTeachers, t => {
                return `${t.last_name || t.lastName || ''} ${t.first_name || t.firstName || ''}`.trim() || t.email || `ID: ${t.id}`;
            });
        }
        if (subjectsRes && subjectsRes.ok) {
            const subjects = await subjectsRes.json();
            fillSelectElement('assignment-subject-select', subjects, s => s.name);
        }
        if (groupsRes && groupsRes.ok) {
            const groups = await groupsRes.json();
            fillSelectElement('assignment-group-select', groups, g => g.name);
        }
        if (periodsRes && periodsRes.ok) {
            const periods = await periodsRes.json();
            fillSelectElement('assignment-period-select', periods, p => p.name);
        }
    } catch (err) {
        console.error("❌ Критична помилка прелоаду селектів:", err);
    }
}

function rebindFormSubmitEvents() {
    const semesterForm = document.getElementById('semester-form');
    if (semesterForm) {
        semesterForm.removeAttribute('onsubmit'); 
        semesterForm.removeEventListener('submit', window.handleSemesterFormSubmit);
        semesterForm.addEventListener('submit', window.handleSemesterFormSubmit);
    }
    
    const universalForm = document.getElementById('form-universal-entity');
    if (universalForm) {
        universalForm.removeAttribute('onsubmit');
        universalForm.removeEventListener('submit', window.handleUniversalEntitySubmit);
        universalForm.addEventListener('submit', window.handleUniversalEntitySubmit);
    }
}

const originalEditEntityInline = window.editEntityInline;
window.editEntityInline = async function(type, id) {
    let normType = type.endsWith('s') ? type.slice(0, -1) : type;
    if (normType === 'semester') {
        if (typeof window.openSemesterFormInline === 'function') window.openSemesterFormInline(id);
        return;
    }
    if (typeof originalEditEntityInline === 'function') {
        await originalEditEntityInline(type, id);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    rebindFormSubmitEvents();
    if (typeof initSemesterDateListeners === 'function') initSemesterDateListeners();
    if (typeof window.loadCurrentSemesterInfo === 'function') window.loadCurrentSemesterInfo();
});

function setSelectValue(elementId, value) {
    const el = document.getElementById(elementId);
    if (el && typeof value !== 'undefined' && value !== null) {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

window.editEntityInline = async function(type, id) {
    let normType = type.endsWith('s') ? type.slice(0, -1) : type; 
    if (normType === 'assignment') normType = 'assignments'; 

    if (normType === 'assignments') {
        const form = document.getElementById('assignment-form');
        if (form) form.reset();

        if (typeof preloadAllDropdowns === 'function') {
            await preloadAllDropdowns();
        }

        const ensureDefaultOption = (selectId, text) => {
            const selectEl = document.getElementById(selectId);
            if (!selectEl) return;
            let blankOpt = selectEl.querySelector('option[value=""]');
            if (!blankOpt) {
                blankOpt = document.createElement('option');
                blankOpt.value = "";
                blankOpt.textContent = text;
                selectEl.insertBefore(blankOpt, selectEl.firstChild);
            }
        };

        ensureDefaultOption('assignment-teacher-select', '-- Оберіть викладача --');
        ensureDefaultOption('assignment-subject-select', '-- Оберіть дисципліну --');
        ensureDefaultOption('assignment-group-select', '-- Оберіть групу --');
        ensureDefaultOption('assignment-period-select', '-- Оберіть період --');

        if (id) {
            window.currentEditAssignmentId = id;
            const modalTitle = document.getElementById('assignment-modal-title');
            if (modalTitle) modalTitle.textContent = '📝 Редагувати розподіл навантаження';

            const records = window.loadedAssignments || [];
            const record = records.find(item => String(item.id) === String(id));
                
            if (record) {
                showSystemToast(`Редагування навантаження: ${record.teacher_name || ''}`, 'info');
                setSelectValue('assignment-teacher-select', record.teacher_id);
                setSelectValue('assignment-subject-select', record.subject_id);
                setSelectValue('assignment-group-select', record.group_id);
                setSelectValue('assignment-period-select', record.period_id || record.semester_id);
            }
        } else {
            window.currentEditAssignmentId = null;
            const modalTitle = document.getElementById('assignment-modal-title');
            if (modalTitle) modalTitle.textContent = '➕ Нове призначення навантаження';
            
            setSelectValue('assignment-teacher-select', '');
            setSelectValue('assignment-subject-select', '');
            setSelectValue('assignment-group-select', '');
            
            const globalSemester = document.getElementById('global-semester-selector');
            if (globalSemester && globalSemester.value) {
                setSelectValue('assignment-period-select', globalSemester.value);
            } else {
                setSelectValue('assignment-period-select', '');
            }
        }

        window.closeCentralModal('modal-load-matrix');
        window.openCentralModal('modal-assignment-form');
        return;
    }

    if (typeof window.rawMatrixData === 'undefined') return;
    
    const record = window.rawMatrixData.find(item => String(item.id) === String(id));
    if (!record) {
        showSystemToast('Локальні дані об\'єкта не знайдено в поточному реєстрі', 'error');
        return;
    }

    let entityLabelName = 'Запис';
    if (normType === 'department') entityLabelName = record.name || '';
    else if (normType === 'teacher') entityLabelName = `${record.lastName || record.last_name || ''} ${record.firstName || record.first_name || ''}`.trim();
    else if (normType === 'group') entityLabelName = record.name || '';
    else if (normType === 'subject') entityLabelName = record.name || '';
    else if (normType === 'semester') entityLabelName = record.name || '';

    showSystemToast(`Редагування: ${entityLabelName}`, 'info');

    if (window.systemSearchState) window.systemSearchState.matrixSearchQuery = '';
    const searchInput = document.getElementById('search-assignments-input');
    if (searchInput) searchInput.value = '';

    window.closeCentralModal('modal-load-matrix');
    
    if (typeof window.openEntityForm === 'function') {
        window.openEntityForm(normType, record);
    } else if (typeof window.openCentralModal === 'function') {
        const typeEl = document.getElementById('entity-type-hidden');
        const idEl = document.getElementById('entity-id-hidden');
        if (typeEl) typeEl.value = normType;
        if (idEl) idEl.value = id;
        window.openCentralModal('modal-single-entity');
    }
};

function forceKillAllModals() {
    document.querySelectorAll('.custom-modal-overlay, [id^="modal-"]').forEach(modal => {
        modal.style.setProperty('display', 'none', 'important');
        modal.classList.remove('active', 'show', 'visible');
    });
    document.body.style.overflow = '';
}

window.openCentralModal = function(modalId) {
    if (window.isSystemSavingSilently) {
        console.warn(`[Блокувальник] Спроба відкрити вікно ${modalId} заблокована. Залишаємося на головній.`);
        forceKillAllModals();
        return;
    }

    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (modal.parentNode !== document.body) document.body.appendChild(modal);
    
    modal.style.cssText = `
        position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important;
        display: flex !important; align-items: center !important; justify-content: center !important; z-index: 5000000 !important;
        background: rgba(15, 23, 42, 0.6) !important; backdrop-filter: blur(4px) !important;
    `;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
};

window.closeCentralModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.cssText = 'display: none !important;';
    modal.classList.remove('active');
    if (document.querySelectorAll('.custom-modal-overlay.active').length === 0) {
        document.body.style.overflow = '';
    }
};

window.closeAllModalsGlobal = function() {
    forceKillAllModals();
};

window.editEntityInline = async function(type, id) {
    let normType = type.endsWith('s') ? type.slice(0, -1) : type; 
    if (normType === 'assignment') normType = 'assignments'; 

    if (normType === 'assignments') {
        const form = document.getElementById('assignment-form');
        if (form) form.reset();

        if (typeof preloadAllDropdowns === 'function') {
            await preloadAllDropdowns();
        }

        if (id) {
            window.currentEditAssignmentId = id;
            const modalTitle = document.getElementById('assignment-modal-title');
            if (modalTitle) modalTitle.textContent = '📝 Редагувати розподіл навантаження';

            const records = window.loadedAssignments || [];
            const record = records.find(item => String(item.id) === String(id));
                
            if (record) {
                showSystemToast(`Редагування навантаження: ${record.teacher_name || ''}`, 'info');
                setSelectValue('assignment-teacher-select', record.teacher_id);
                setSelectValue('assignment-subject-select', record.subject_id);
                setSelectValue('assignment-group-select', record.group_id);
                setSelectValue('assignment-period-select', record.period_id || record.semester_id);
            }
        } else {
            window.currentEditAssignmentId = null;
            const modalTitle = document.getElementById('assignment-modal-title');
            if (modalTitle) modalTitle.textContent = '➕ Нове призначення навантаження';
            
            const globalSemester = document.getElementById('global-semester-selector');
            if (globalSemester && globalSemester.value) {
                setSelectValue('assignment-period-select', globalSemester.value);
            }
        }

        window.closeCentralModal('modal-load-matrix');
        window.openCentralModal('modal-assignment-form');
        return;
    }

    if (typeof window.rawMatrixData === 'undefined') return;
    
    const record = window.rawMatrixData.find(item => String(item.id) === String(id));
    if (!record) {
        showSystemToast('Локальні дані об\'єкта не знайдено в поточному реєстрі', 'error');
        return;
    }

    let entityLabelName = 'Запис';
    if (normType === 'department') entityLabelName = record.name || '';
    else if (normType === 'teacher') entityLabelName = `${record.lastName || record.last_name || ''} ${record.firstName || record.first_name || ''}`.trim();
    else if (normType === 'group') entityLabelName = record.name || '';
    else if (normType === 'subject') entityLabelName = record.name || '';
    else if (normType === 'semester') entityLabelName = record.name || '';

    showSystemToast(`Редагування: ${entityLabelName}`, 'info');

    if (window.systemSearchState) window.systemSearchState.matrixSearchQuery = '';
    const searchInput = document.getElementById('search-assignments-input');
    if (searchInput) searchInput.value = '';

    window.closeCentralModal('modal-load-matrix');
    
    if (typeof window.openEntityForm === 'function') {
        window.openEntityForm(normType, record);
    } else if (typeof window.openCentralModal === 'function') {
        const typeEl = document.getElementById('entity-type-hidden');
        const idEl = document.getElementById('entity-id-hidden');
        if (typeEl) typeEl.value = normType;
        if (idEl) idEl.value = id;
        window.openCentralModal('modal-single-entity');
    }
};

window.handleAssignmentFormSubmit = async function(event) {
    event.preventDefault();
    event.stopImmediatePropagation(); 

    const teacher_id = document.getElementById('assignment-teacher-select')?.value;
    const subject_id = document.getElementById('assignment-subject-select')?.value;
    const group_id = document.getElementById('assignment-group-select')?.value;
    const period_id = document.getElementById('assignment-period-select')?.value;

    if (!teacher_id || !subject_id || !group_id || !period_id) {
        showSystemToast('Будь ласка, заповніть усі поля форми розподілу навантаження!', 'warning');
        return;
    }

    const payload = { 
        teacher_id: parseInt(teacher_id, 10), 
        subject_id: parseInt(subject_id, 10), 
        group_id: parseInt(group_id, 10), 
        semester_id: parseInt(period_id, 10),
        period_id: parseInt(period_id, 10)
    };
    
    const isEdit = (typeof window.currentEditAssignmentId !== 'undefined' && window.currentEditAssignmentId !== null);
    const url = isEdit ? `/api/admin/teacher-subjects/${window.currentEditAssignmentId}` : '/api/admin/teacher-subjects';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        window.isSystemSavingSilently = true;
        forceKillAllModals();

        const response = await fetch(getApiUrl(url), {
            method: method,
            headers: getFetchHeaders(),
            body: JSON.stringify(payload)
        });
        
        const result = await response.json().catch(() => ({}));

        if (response.ok) {
            showSystemToast(isEdit ? '🔄 Розподіл навантаження успішно оновлено!' : '✨ Навантаження успішно створено!', 'success');

            if (window.systemSearchState) window.systemSearchState.matrixSearchQuery = '';
            const searchInput = document.getElementById('search-assignments-input');
            if (searchInput) searchInput.value = '';

            if (typeof loadCurrentAssignments === 'function') {
                await loadCurrentAssignments();
            }
            
            forceKillAllModals();
        } else {
            showSystemToast(result.error || result.message || 'Такий розподіл навантаження вже існує в базі!', 'error');
            window.isSystemSavingSilently = false;
        }
    } catch (error) {
        console.error("❌ Submit Assignment Error:", error);
        showSystemToast('Критичний збій з\'єднання з сервером!', 'danger');
        window.isSystemSavingSilently = false;
    } finally {
        setTimeout(() => { window.isSystemSavingSilently = false; }, 400);
    }
};

window.handleUniversalEntitySubmit = async function(event) {
    event.preventDefault();
    event.stopImmediatePropagation(); 

    const typeEl = document.getElementById('entity-type-hidden');
    const idEl = document.getElementById('entity-id-hidden');
    if (!typeEl) return;
    
    const type = typeEl.value; 
    const id = (idEl && idEl.value && idEl.value !== '0') ? idEl.value.trim() : null;
    
    let hasEmptyFields = false;
    const reqInputs = event.target.querySelectorAll('input[required], select[required]');
    reqInputs.forEach(input => {
        if (!input.value.trim()) hasEmptyFields = true;
    });

    if (hasEmptyFields) {
        showSystemToast('Будь ласка, заповніть усі обовʼязкові поля форми!', 'warning');
        return;
    }

    const formData = new FormData(event.target);
    const payload = {};
    formData.forEach((value, key) => {
        if (['course', 'departmentId', 'teacherId', 'subjectId', 'groupId', 'semesterId', 'department_id'].includes(key)) {
            payload[key] = parseInt(value, 10) || value;
        } else {
            payload[key] = value;
        }
    });

    const endpointMap = { 
        'department': 'departments', 'departments': 'departments',
        'teacher': 'teachers', 'teachers': 'teachers',
        'group': 'groups', 'groups': 'groups',
        'subject': 'subjects', 'subjects': 'subjects',
        'semester': 'semesters', 'semesters': 'semesters'
    };
    
    const pluralType = endpointMap[type] || 'departments';
    const finalMethod = id ? 'PUT' : 'POST';
    const finalUrl = id ? `/api/admin/${pluralType}/${id}` : `/api/admin/${pluralType}`;

    const humanLabels = { 'department': 'Спеціальність', 'teacher': 'Викладач', 'group': 'Група', 'subject': 'Дисципліна', 'semester': 'Семестр' };
    const entityLabel = humanLabels[type] || 'Запис';

    try {
        window.isSystemSavingSilently = true;
        forceKillAllModals();

        const res = await fetch(getApiUrl(finalUrl), {
            method: finalMethod,
            headers: getFetchHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showSystemToast(id ? `${entityLabel} — дані оновлено` : `${entityLabel} — запис створено`, 'success');
            
            if (window.systemSearchState) window.systemSearchState.matrixSearchQuery = '';
            const searchInput = document.getElementById('search-assignments-input');
            if (searchInput) searchInput.value = '';

            if (typeof window.activeMatrixType !== 'undefined' && typeof fetchAndDisplayMatrix === 'function') {
                await fetchAndDisplayMatrix(window.activeMatrixType);
            }
            if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
            if ((type === 'group' || type === 'department') && typeof initAdminDashboardFilters === 'function') {
                await initAdminDashboardFilters();
            }
            
            forceKillAllModals();
        } else {
            const errData = await res.json().catch(() => ({}));
            showSystemToast(errData.error || `Помилка: такий запис (${entityLabel.toLowerCase()}) вже є в системі!`, 'error');
            window.isSystemSavingSilently = false;
        }
    } catch (e) {
        showSystemToast('Сталася критична помилка мережі!', 'danger');
        window.isSystemSavingSilently = false;
    } finally {
        setTimeout(() => { window.isSystemSavingSilently = false; }, 400);
    }
};

window.confirmRecordDeletion = function(type, id) {
    window.deleteEntityInline(type, id);
};

window.showCustomDeleteConfirm = function(title, text, onConfirm) {
    const existing = document.getElementById('custom-delete-modal');
    if (existing) existing.remove();

    const modalHtml = `
    <div id="custom-delete-modal" style="position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(15, 23, 42, 0.75) !important; backdrop-filter: blur(5px) !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 9999999 !important;">
        <div class="custom-modal-card" style="background: #1e293b !important; padding: 32px !important; border-radius: 16px !important; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important; max-width: 400px !important; width: 90% !important; text-align: center !important; position: relative !important; z-index: 10000000 !important; border: 1px solid #334155 !important;">
            <div class="custom-modal-icon" style="width: 56px !important; height: 56px !important; background: rgba(239, 68, 68, 0.15) !important; color: #f87171 !important; border-radius: 50% !important; display: flex !important; align-items: center !important; justify-content: center !important; margin: 0 auto 16px !important; font-size: 24px !important;">
                <i class="fa-solid fa-trash-can"></i>
            </div>
            <h3 style="font-size: 20px !important; font-weight: 700 !important; color: #f8fafc !important; margin-bottom: 8px !important; font-family: sans-serif !important;">${title}</h3>
            <p style="font-size: 14px !important; color: #94a3b8 !important; margin-bottom: 24px !important; line-height: 1.5 !important; font-family: sans-serif !important;">${text}</p>
            <div class="custom-modal-buttons" style="display: flex !important; gap: 12px !important; justify-content: center !important;">
                <button id="delete-cancel-btn" type="button" style="padding: 10px 20px !important; border-radius: 8px !important; font-size: 14px !important; font-weight: 600 !important; cursor: pointer !important; background: #334155 !important; border: 1px solid #475569 !important; color: #cbd5e1 !important; transition: all 0.2s !important;">Скасувати</button>
                <button id="delete-confirm-btn" type="button" style="padding: 10px 20px !important; border-radius: 8px !important; font-size: 14px !important; font-weight: 600 !important; cursor: pointer !important; background: #ef4444 !important; border: none !important; color: #ffffff !important; transition: all 0.2s !important;">Видалити</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = document.getElementById('custom-delete-modal');
    const cancelBtn = document.getElementById('delete-cancel-btn');
    const confirmBtn = document.getElementById('delete-confirm-btn');

    const closeModalClosure = () => { modalEl.remove(); };

    cancelBtn?.addEventListener('click', (e) => { e.preventDefault(); closeModalClosure(); });
    confirmBtn?.addEventListener('click', (e) => { e.preventDefault(); closeModalClosure(); if (typeof onConfirm === 'function') onConfirm(); });
    modalEl.addEventListener('click', (e) => { if(e.target === modalEl) { e.preventDefault(); closeModalClosure(); } });
};

window.deleteEntityInline = async function(type, id) {
    const pluralMap = {
        'department': 'departments', 'departments': 'departments',
        'teacher': 'teachers', 'teachers': 'teachers',
        'group': 'groups', 'groups': 'groups',
        'subject': 'subjects', 'subjects': 'subjects',
        'assignment': 'assignments', 'assignments': 'assignments',
        'semester': 'semesters', 'semesters': 'semesters'
    };
    
    const finalPluralType = pluralMap[type] || 'departments';
    const humanTypes = { 'departments': 'Спеціальність', 'teachers': 'Викладача', 'groups': 'Академічну групу', 'subjects': 'Дисципліну', 'assignments': 'Розподіл навантаження', 'semesters': 'Семестр' };
    const typeLabel = humanTypes[finalPluralType] || 'Запис';

    window.showCustomDeleteConfirm(
        'Вилучення запису',
        `Ви впевнені, що хочете безповоротно видалити цей об'єкт (${typeLabel.toLowerCase()}) із системи?`,
        async () => {
            let deleteEndpoint = finalPluralType === 'assignments' ? `/api/admin/teacher-subjects/${id}` : `/api/admin/${finalPluralType}/${id}`;

            try {
                const res = await fetch(getApiUrl(deleteEndpoint), {
                    method: 'DELETE',
                    headers: getFetchHeaders()
                });

                if (res.ok) {
                    showSystemToast(`Запис видалено успішно (${typeLabel})`, 'success');
                    
                    if (window.systemSearchState) window.systemSearchState.matrixSearchQuery = '';
                    const searchInput = document.getElementById('search-assignments-input');
                    if (searchInput) searchInput.value = '';

                    if (typeof fetchAndDisplayMatrix === 'function') {
                        await fetchAndDisplayMatrix(window.activeMatrixType || finalPluralType);
                    }
                    if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
                    if ((finalPluralType === 'groups' || finalPluralType === 'departments') && typeof initAdminDashboardFilters === 'function') {
                        await initAdminDashboardFilters();
                    }
                } else {
                    const errData = await res.json().catch(() => ({}));
                    showSystemToast(`Не вдалося видалити: ${errData.error || 'Дія заблокована сервером'}`, 'error');
                }
            } catch (err) {
                showSystemToast('Помилка з\'єднання при спробі видалення об\'єкта!', 'danger');
            }
        }
    );
};

window.switchGlobalSemester = async (id) => {
    if (!id) return;
    try {
        showSystemToast(`🔄 Синхронізація для нового періоду...`, 'info');
        
        const response = await fetch(getApiUrl(`/api/settings/switch-semester`), {
            method: 'POST',
            headers: getFetchHeaders(),
            body: JSON.stringify({ semesterId: parseInt(id, 10) })
        });
        
        if (!response.ok) throw new Error('Switch failed');
        
        if (typeof loadCurrentSemesterInfo === 'function') await loadCurrentSemesterInfo();
        if (typeof loadGlobalSemesterSelector === 'function') await loadGlobalSemesterSelector();
        if (typeof loadCurrentAssignments === 'function') await loadCurrentAssignments();
        if (typeof loadStatsAndChartsFromDB === 'function') await loadStatsAndChartsFromDB();
        if (typeof initAdminDashboardFilters === 'function') await initAdminDashboardFilters();
        
        showSystemToast(`✅ Дані успішно синхронізовано під обраний семестр.`, 'success');
    } catch (err) {
        console.error("Помилка світчу семестру:", err);
        showSystemToast('Не вдалося перемикнути поточний навчальний період', 'error');
    }
};

window.filterMatrixTable = function(val) {
    const query = val.toLowerCase().trim();
    if (typeof window.systemSearchState !== 'undefined') {
        window.systemSearchState.matrixSearchQuery = query;
    }
    if (typeof executeClientSideFiltering === 'function') {
        executeClientSideFiltering(query);
    }
};

function rebindFormSubmitEvents() {
    const universalForm = document.getElementById('form-universal-entity') || document.getElementById('universal-entity-form');
    if (universalForm && typeof window.handleUniversalEntitySubmit === 'function') {
        universalForm.removeAttribute('onsubmit');
        universalForm.removeEventListener('submit', window.handleUniversalEntitySubmit);
        universalForm.addEventListener('submit', window.handleUniversalEntitySubmit);
    }

    const assignmentForm = document.getElementById('assignment-form');
    if (assignmentForm && typeof handleAssignmentFormSubmit === 'function') {
        assignmentForm.removeAttribute('onsubmit');
        assignmentForm.removeEventListener('submit', handleAssignmentFormSubmit);
        assignmentForm.addEventListener('submit', handleAssignmentFormSubmit);
    }

    const semesterForm = document.getElementById('semester-form');
    if (semesterForm && typeof window.handleSemesterFormSubmit === 'function') {
        semesterForm.removeAttribute('onsubmit');
        semesterForm.removeEventListener('submit', window.handleSemesterFormSubmit);
        semesterForm.addEventListener('submit', window.handleSemesterFormSubmit);
    }
}

function initModalSystem() {
    document.querySelectorAll('.custom-modal-overlay').forEach(overlay => {
        overlay.removeEventListener('click', handleOverlayClick);
        overlay.addEventListener('click', handleOverlayClick);
    });
}

function handleOverlayClick(e) {
    if (e.target === this || e.target.classList.contains('custom-modal-overlay')) {
        window.closeCentralModal(this.id);
    }
}

function setSelectValue(elementId, value) {
    const el = document.getElementById(elementId);
    if (el && typeof value !== 'undefined' && value !== null) {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof initSemesterDateListeners === 'function') initSemesterDateListeners();
    initModalSystem();
    if (typeof initLiveSearchEngine === 'function') initLiveSearchEngine();
    
    try {
        if (typeof loadCurrentSemesterInfo === 'function') await loadCurrentSemesterInfo();
        if (typeof loadGlobalSemesterSelector === 'function') await loadGlobalSemesterSelector();
        if (typeof preloadAllDropdowns === 'function') await preloadAllDropdowns();
    } catch (e) {
        console.error("Помилка попереднього завантаження:", e);
    }

    rebindFormSubmitEvents();
});

if (typeof initAdminDashboard === 'function') window.initAdminDashboard = initAdminDashboard;
window.initTeacherAssignmentsModule = initAssignmentsModule; 

if (typeof loadStatsAndChartsFromDB === 'function') window.loadStatsAndChartsFromDB = loadStatsAndChartsFromDB;
if (typeof changeAttendancePeriod === 'function') window.changeAttendancePeriod = changeAttendancePeriod;
if (typeof loadGroupTrendsFromDB === 'function') window.loadGroupTrendsFromDB = loadGroupTrendsFromDB;
if (typeof filterUsersTable === 'function') window.filterUsersTable = filterUsersTable;
if (typeof clearUserFilters === 'function') window.clearUserFilters = clearUserFilters;

if (typeof prepareEditUser === 'function') window.prepareEditUser = prepareEditUser; 
if (typeof askDeleteUser === 'function') window.askDeleteUser = askDeleteUser;      
if (typeof openUserModal === 'function') window.openUserModal = openUserModal;
if (typeof closeUserModal === 'function') window.closeUserModal = closeUserModal;
if (typeof saveUserForm === 'function') window.saveUserForm = saveUserForm;
if (typeof executeDeleteUser === 'function') window.executeDeleteUser = executeDeleteUser;
if (typeof closeDeleteModal === 'function') window.closeDeleteModal = closeDeleteModal;

if (typeof saveSchedule === 'function') window.saveSchedule = saveSchedule;
if (typeof loadScheduleGrid === 'function') window.loadScheduleGrid = loadScheduleGrid;
if (typeof removeLessonFromSchedule === 'function') window.removeLessonFromSchedule = removeLessonFromSchedule;

if (typeof downloadPDF === 'function') window.downloadPDF = downloadPDF;
if (typeof downloadExcel === 'function') window.downloadExcel = downloadExcel;
if (typeof deleteAssignment === 'function') window.deleteAssignment = deleteAssignment;
