// Адреса сервера для запитів
const BASE_URL = window.API_URL || 'caring-respect-production-c61c.up.railway.app/api'; 

// Розклад
const LESSON_MAP_FOUR = {
    1: ['08:30', '09:50'],
    2: ['10:00', '11:20'],
    3: ['11:40', '13:00'],
    4: ['13:20', '14:40']
};

// Створюємо місце для графіків
if (typeof window.charts === 'undefined') {
    window.charts = { line: null, pie: null, bar: null, doughnut: null };
}

// Змінні для збереження даних студента
let studentUserId = null;
let studentGroupName = '';
let originalGradesData = []; 
let uniqueSubjects = []; 
let currentScheduleDate = new Date();
let currentFilteredGradesData = [];
let studentEmail = '';
let studentFirstName = ''; 
let studentLastName = '';  
// Перевірка, щоб не завантажувати головну сторінку двічі
window.dashboardLoaded = false;

// 1. ГОЛОВНИЙ ЗАПУСК (ПОКАЗУЄМО СТОРІНКУ СТУДЕНТА)
window.initStudentModule = async function (currentUser, sharedDate) {
    // Перевіряємо, чи користувач зайшов у систему
    if (!currentUser?.id) {
        alert('Доступ заборонено. Будь ласка, увійдіть в систему.');
        window.location.href = 'login.html';
        return;
    }

    // Запам'ятовуємо дані користувача
    studentUserId = currentUser.id;
    studentGroupName = currentUser.group_name || '';
    studentEmail = currentUser.email || currentUser.username || '';
    studentFirstName = currentUser.first_name || ''; // Зберігаємо ім'я
    studentLastName = currentUser.last_name || '';   // Зберігаємо прізвище

    // Налаштовуємо дату розкладу
    currentScheduleDate = sharedDate || new Date();
    currentScheduleDate.setHours(0, 0, 0, 0);

    // Ховаємо всі інші блоки на сторінці
    document.querySelectorAll('section, .page-section, .app-section').forEach(sec => {
        sec.style.display = 'none';
        sec.classList.remove('section-active', 'active-section', 'active');
    });

    // Показуємо саме головну сторінку (панель студента)
    const dashboardSection = document.getElementById('dashboard-sec');
    if (dashboardSection) {
        dashboardSection.style.setProperty('display', 'block', 'important');
        dashboardSection.classList.add('section-active', 'active-section');
    }

    // Знімаємо підсвітку з усіх кнопок меню
    document.querySelectorAll('.nav-link, .menu-btn, .nav-item').forEach(btn => {
        btn.classList.remove('active', 'navigation-active');
    });

    // Підсвічуємо кнопку головної сторінки в меню
    const dbBtn = document.getElementById('btn-dashboard');
    if (dbBtn) {
        dbBtn.classList.add('active', 'navigation-active');
        const parentLi = dbBtn.closest('.nav-item') || dbBtn.parentElement;
        if (parentLi) parentLi.classList.add('active', 'navigation-active');
    }

    // Налаштовуємо меню та фільтри (робимо це лише один раз)
    if (!window._studentNavInit) {
        window._studentNavInit = true;
        if (typeof setCurrentDateBadge === 'function') setCurrentDateBadge();
        if (typeof initNavigation === 'function') initNavigation();
        if (typeof initGradesFilters === 'function') initGradesFilters();
    }

    // Чекаємо, поки оновиться зовнішній вигляд сторінки
    await new Promise(r => requestAnimationFrame(() => r()));

    try {
        console.log('🚀 Завантаження даних студентського дашборду...');

        // Завантажуємо всі дані з сервера одночасно
        await Promise.all([
            loadDashboardData(studentUserId),
            typeof loadGradesData === 'function' ? loadGradesData(studentUserId) : Promise.resolve(),
            typeof window.loadScheduleData === 'function' ? window.loadScheduleData(currentScheduleDate) : Promise.resolve()
        ]);

        // Позначаємо, що все успішно завантажено
        window.dashboardLoaded = true;
        if (typeof loadedSectionsCache !== 'undefined') {
            loadedSectionsCache.dashboard = true;
        }

        // Оновлюємо розміри графіків, щоб вони підлаштувалися під екран
        setTimeout(() => {
            if (window.charts?.line?.ctx) window.charts.line.resize();
            if (window.charts?.pie?.ctx) window.charts.pie.resize();
            if (window.charts?.bar?.ctx) window.charts.bar.resize();
            if (window.charts?.doughnut?.ctx) window.charts.doughnut.resize();
        }, 150);

    } catch (err) {
        console.error('❌ Дашборд не завантажився автоматично:', err);
    }
};

// 2. ЗАВАНТАЖЕННЯ ДАНИХ ТА ГРАФІКІВ
async function loadDashboardData(userId) {
    if (!userId) return;
    try {
        // Просимо у сервера дані для головної сторінки
        const res = await fetch(`${BASE_URL}/student/${userId}/dashboard-analytics`);
        if (!res.ok) throw new Error('Помилка сервера при отриманні дешборду');
        const data = await res.json();

        // Запам'ятовуємо дату початку навчання, якщо вона є
        if (data.academic_periods && data.academic_periods.length > 0) {
            const activePeriod = data.academic_periods.find(p => p.is_active);
            if (activePeriod && activePeriod.start_date) {
                window.activeSemesterStartDate = new Date(activePeriod.start_date);
            }
        }

        // Шукаємо елементи на сторінці для виведення тексту
        const scoreEl = document.getElementById('my-avg-score');
        const absEl = document.getElementById('my-absences');
        const attRateEl = document.getElementById('my-attendance-rate');
        const weekCounterEl = document.getElementById('semester-weeks-counter');
        const analyticsWeekCounterEl = document.getElementById('analytics-weeks-counter'); 
        const userGroupEl = document.getElementById('user-group');

        // Показуємо назву групи
        if (userGroupEl) {
            userGroupEl.textContent = `Група: ${studentGroupName || 'Не вказано'}`;
        }

        // Рахуємо відвідуваність (присутність, відсутність, запізнення)
        const raw = data.attendance_raw || {};
        let present = parseInt(raw.present ?? data.present ?? data.att_present ?? 0, 10);
        let absent = parseInt(raw.absent ?? data.absent ?? data.att_absent ?? 0, 10);
        let delayed = parseInt(raw.delayed ?? data.delayed ?? data.att_delayed ?? 0, 10);
        
        const totalLessons = present + absent + delayed;

        // Показуємо середній бал та кількість пропусків
        if (scoreEl) scoreEl.textContent = data.total_gpa ? Number(data.total_gpa).toFixed(1) : '0.0';
        if (absEl) absEl.textContent = data.missed_days ?? 0;
        
        // Показуємо відсоток відвідуваності
        if (attRateEl) {
            if (totalLessons > 0) {
                const attendanceRate = data.attendance_rate !== undefined ? parseFloat(data.attendance_rate) : 100;
                attRateEl.textContent = `${attendanceRate}%`;
            } else {
                attRateEl.textContent = '0%';
            }
        }
        
        // Показуємо поточний тиждень навчання
        const weeksText = data.current_week_text || "0 / 18";
        if (weekCounterEl) weekCounterEl.textContent = weeksText;
        if (analyticsWeekCounterEl) analyticsWeekCounterEl.textContent = weeksText;

        console.log(`СИНХРОНІЗАЦІЯ ТИЖНІВ УСПІШНА: ${weeksText}`);

        // Дізнаємося номери тижнів для кругового графіка
        let currentWeekNum = 0;
        let totalWeeksNum = 18;
        if (weeksText.includes('/')) {
            const parts = weeksText.split('/');
            currentWeekNum = parseInt(parts[0], 10) || 0;
            totalWeeksNum = parseInt(parts[1], 10) || 18;
        }

        // Налаштовуємо цифри для графіка відвідуваності, якщо занять ще не було
        if (totalLessons > 0 && present === 0 && absent === 0) {
            const attendanceRate = data.attendance_rate !== undefined ? parseFloat(data.attendance_rate) : 100;
            present = Math.round(attendanceRate);
            absent = Math.round(100 - attendanceRate);
            delayed = 0;
        } else if (totalLessons === 0) {
            present = 0;
            absent = 0;
            delayed = 0;
        }

        // Малюємо всі 4 графіки на сторінці
        buildLineChart(data.line_chart_data || []);
        buildPieChart(present, absent, delayed); 
        buildBarChart(data.bar_chart_data || { excellent: 0, good: 0, fair: 0, poor: 0 });
        buildDoughnutChart(currentWeekNum, totalWeeksNum);

    } catch (err) {
        console.error('❌ Помилка завантаження аналітики дашборду:', err);
        // Якщо сталася помилка, малюємо порожні графіки
        buildLineChart([]);
        buildPieChart(0, 0, 0); 
        buildBarChart({ excellent: 0, good: 0, fair: 0, poor: 0 });
    }
}

// РЕЗЕРВНІ РАХУНКИ ТИЖНІВ (ЯКЩО СЕРВЕР НЕ СКАЗАВ ТОЧНИЙ ТИЖДЕНЬ)
function calculateCurrentAcademicWeek(periods = []) {
    const now = new Date();
    const activePeriod = Array.isArray(periods) && periods.length > 0 
        ? (periods.find(p => p.is_active) || periods[0]) 
        : null;

    let totalWeeks = (activePeriod && activePeriod.total_weeks) ? parseInt(activePeriod.total_weeks, 10) : 18;

    const semesterStart = getSemesterStart(now); 
    const startRange = getWeekRange(semesterStart);
    const targetRange = getWeekRange(now);

    if (targetRange.monday < startRange.monday) {
        return { current: 0, total: totalWeeks };
    }

    // Рахуємо, скільки тижнів минуло з початку навчання
    const diffTime = targetRange.monday.getTime() - startRange.monday.getTime();
    const diffWeeks = Math.round(diffTime / (1000 * 60 * 60 * 24 * 7));
    let currentWeekNum = diffWeeks + 1; 

    // Обмежуємо значення, щоб цифри не виходили за рамки
    if (currentWeekNum < 0) currentWeekNum = 0;
    if (currentWeekNum > totalWeeks) currentWeekNum = totalWeeks; 

    return { current: currentWeekNum, total: totalWeeks };
}

// Математичний підрахунок тижнів між двома датами
function processWeeksMath(startDateStr, totalWeeks) {
    const startDate = new Date(startDateStr);
    const currentDate = new Date();

    const startUTC = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const currentUTC = Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

    if (currentUTC < startUTC) {
        return { current: 0, total: totalWeeks };
    }

    const diffTime = currentUTC - startUTC;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    let currentWeek = Math.floor(diffDays / 7) + 1;

    if (currentWeek > totalWeeks) currentWeek = totalWeeks; 
    if (currentWeek < 0) currentWeek = 0;

    return { current: currentWeek, total: totalWeeks };
}

// Визначення семестру за поточною датою на комп'ютері
function calculateWeeksFallback() {
    const now = new Date();
    const currentYear = now.getFullYear();
    
    // Приблизні дати початку та кінця семестрів
    const p1_start = new Date(`${currentYear - 1}-09-01`); 
    const p1_end = new Date(`${currentYear}-01-25`);
    const p2_start = new Date(`${currentYear}-02-02`); 
    const p2_end = new Date(`${currentYear}-06-30`);

    if (now >= p2_start && now <= p2_end) {
        return processWeeksMath(p2_start, 21); // Другий семестр (21 тиждень)
    } else if (now >= p1_start && now <= p1_end) {
        return processWeeksMath(p1_start, 18); // Перший семестр (18 тижнів)
    } else {
        return { current: 21, total: 21 }; 
    }
}

// Графік 1: Стовпчики середнього балу з предметів
function buildLineChart(lineData) {
    const canvas = document.getElementById('chartGradesLine');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    
    if (window.charts.line) window.charts.line.destroy();

    const labels = (!lineData || lineData.length === 0) ? ['Немає даних'] : lineData.map(d => d.subject_name);
    const dataset = (!lineData || lineData.length === 0) ? [0] : lineData.map(d => Math.round(parseFloat(d.avg_grade)) || 0);

    window.charts.line = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Поточний сер. бал',
                data: dataset,
                backgroundColor: '#6366f1', 
                hoverBackgroundColor: '#4f46e5',
                borderWidth: 0,
                borderRadius: 8, 
                borderSkipped: false,
                categoryPercentage: 0.6,
                barPercentage: 0.8,      
                maxBarThickness: 120 
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { display: false },
                tooltip: { enabled: true }
            },
            scales: { 
                y: { 
                    min: 0, 
                    max: 100,
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#64748b', font: { weight: '600' } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { weight: '600' }, maxRotation: 30, minRotation: 0 }
                }
            } 
        }
    });
}

// Графік 2: Круг відвідуваності (Присутній / Відсутній)
function buildPieChart(present, absent, delayed) {
    const canvas = document.getElementById('chartAttendancePie');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    
    if (window.charts.pie) window.charts.pie.destroy();
    
    const totalPresent = present + delayed;
    const total = totalPresent + absent;
    const isNoData = total === 0;
    
    const presentPercent = !isNoData ? Math.round((totalPresent / total) * 100) : 0;
    const adjustedAbsentPercent = !isNoData ? (100 - presentPercent) : 0;

    const datasetData = isNoData ? [1] : [presentPercent, adjustedAbsentPercent];
    const backgroundColors = isNoData ? ['#e2e8f0'] : ['#10b981', '#f43f5e'];
    const labels = isNoData ? ['Немає даних'] : ['Присутній', 'Відсутній'];

    window.charts.pie = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{ 
                data: datasetData, 
                backgroundColor: backgroundColors, 
                borderWidth: isNoData ? 0 : 1 
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { position: 'bottom' },
                tooltip: {
                    enabled: !isNoData,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.label}: ${context.raw}%`;
                        }
                    }
                }
            } 
        }
    });
}

// Графік 3: Стовпчики кількості оцінок за рівнями (Відмінно, Добре...)
function buildBarChart(barData) {
    const canvas = document.getElementById('chartEctsBar');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    
    if (window.charts.bar) window.charts.bar.destroy();

    window.charts.bar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Відмінно (90+)', 'Добре (75-89)', 'Задов. (60-74)', 'Незадов. (<60)'],
            datasets: [{
                label: 'Кількість отриманих оцінок',
                data: [
                    parseInt(barData?.excellent) || 0, 
                    parseInt(barData?.good) || 0, 
                    parseInt(barData?.fair) || 0, 
                    parseInt(barData?.poor) || 0
                ],
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'],
                hoverBackgroundColor: ['#059669', '#2563eb', '#d97706', '#dc2626'],
                borderWidth: 0,
                borderRadius: 8,
                borderSkipped: false,
                categoryPercentage: 0.85, 
                barPercentage: 0.95,
                maxBarThickness: 90
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { precision: 0 } },
                x: { grid: { display: false } }
            }
        }
    });
}

// Графік 4: Кільце прогресу (Скільки тижнів навчалися і скільки залишилося)
function buildDoughnutChart(currentWeek, totalWeeks) {
    const canvas = document.getElementById('chartProgressDoughnut');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (window.charts.doughnut) window.charts.doughnut.destroy();

    const safeCurrent = Math.min(currentWeek, totalWeeks);
    const remainingWeeks = Math.max(0, totalWeeks - safeCurrent);

    window.charts.doughnut = new Chart(ctx, {
        type: 'doughnut', 
        data: {
            labels: ['Пройдено тижнів', 'Залишилось'],
            datasets: [{ 
                data: [safeCurrent, remainingWeeks], 
                backgroundColor: ['#a855f7', '#e2e8f0'], 
                borderWidth: 0 
            }]
        },
        options: { 
            cutout: '75%', 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { position: 'bottom' } } 
        }
    });
}

// 3. ЖУРНАЛ ОЦІНОК ТА ФІЛЬТРИ ДЛЯ ПОШУКУ
async function loadGradesData(userId) {
    const container = document.getElementById('student-grades-container');
    if (!container) return;
    
    try {
        // Просимо у сервера всі оцінки студента
        const res = await fetch(`${BASE_URL}/student/${userId}/grades`);
        if (!res.ok) throw new Error('Помилка завантаження оцінок');
        
        const rawData = await res.json();
        
        // Сортуємо оцінки від нових до старих
        originalGradesData = rawData.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        // Складаємо список усіх предметів без повторів
        uniqueSubjects = [...new Set(originalGradesData.map(item => item.discipline).filter(Boolean))].sort();

        // Оновлюємо підказки та кнопки пошуку на сторінці
        if (typeof buildSuggestionsDropdown === 'function') buildSuggestionsDropdown(uniqueSubjects);
        buildSubjectsChips(uniqueSubjects); 
        applyGradesFilters(); 

    } catch (err) {
        console.error("📋 Grades Render Error:", err);
        container.innerHTML = `<div style="text-align:center; padding:30px; color:#ef4444; font-weight:600;">❌ Не вдалося завантажити журнал успішності.</div>`;
    }
}

// Налаштовуємо роботу полів для пошуку оцінок
function initGradesFilters() {
    const inputSubject = document.getElementById('filter-subject');
    const inputDate = document.getElementById('filter-date');
    const btnClear = document.getElementById('btn-clear-filters');

    // Слідкуємо за введенням тексту у пошук предмета
    if (inputSubject && !inputSubject.dataset.listenerActive) {
        inputSubject.addEventListener('input', handleSubjectSearch);
        if (typeof showAllSuggestions === 'function') {
            inputSubject.addEventListener('focus', showAllSuggestions);
        }
        inputSubject.dataset.listenerActive = "true";
    }
    // Слідкуємо за зміною дати у фільтрі
    if (inputDate && !inputDate.dataset.listenerActive) {
        inputDate.addEventListener('change', applyGradesFilters);
        inputDate.dataset.listenerActive = "true";
    }
    // Слідкуємо за натисканням на кнопку скидання фільтрів
    if (btnClear && !btnClear.dataset.listenerActive) {
        if (typeof resetAllGradesFilters === 'function') {
            btnClear.addEventListener('click', resetAllGradesFilters);
        }
        btnClear.dataset.listenerActive = "true";
    }

    // Ховаємо список підказок, якщо клікнули в іншому місці екрану
    if (document && !document.dataset.globalClickActive) {
        document.addEventListener('click', (e) => {
            const suggestionsEl = document.getElementById('subject-suggestions');
            if (suggestionsEl && !e.target.closest('.search-input-wrapper') && e.target !== inputSubject) {
                suggestionsEl.style.display = 'none';
            }
        });
        document.dataset.globalClickActive = "true";
    }
}

// Створення карток з оцінками на сторінці
function renderGroupedGrades(filteredData) {
    const container = document.getElementById('student-grades-container');
    const counterBadge = document.getElementById('grades-counter-badge');
    const subjectInput = document.getElementById('filter-subject');
    
    if (!container) return;
    if (counterBadge) counterBadge.textContent = `Знайдено оцінок: ${filteredData.length}`;

    // Якщо нічого не знайшли, показуємо повідомлення про порожній результат
    if (!filteredData || filteredData.length === 0) {
        if (subjectInput && subjectInput.value.trim() !== '') {
            subjectInput.style.borderColor = '#f87171';
            subjectInput.style.boxShadow = '0 0 0 3px rgba(248, 113, 113, 0.15)';
        }
        container.innerHTML = `
            <div style="text-align:center; padding: 50px 20px; color: #64748b; background: #f8fafc; border-radius: 20px; border: 1px dashed #cbd5e1;">
                <i class="fa-solid fa-magnifying-glass-blur" style="font-size: 42px; margin-bottom: 16px; color:#cbd5e1; display: block;"></i>
                <p style="font-weight:700; margin:0; font-size:16px; color: #334155;">Дисципліну або оцінки не знайдено</p>
            </div>
        `;
        return;
    }

    if (subjectInput) { subjectInput.style.borderColor = ''; subjectInput.style.boxShadow = ''; }

    // Групуємо всі оцінки за назвою предмета
    const grouped = {};
    filteredData.forEach(item => {
        if (!item.discipline) return;
        if (item.discipline.trim() === 'Електронна відомість за семестр') return;
        
        if (!grouped[item.discipline]) grouped[item.discipline] = [];
        grouped[item.discipline].push(item);
    });

    let html = '';
    const defEscape = (str) => (typeof escapeHtml === 'function' ? escapeHtml(str) : str);

    // Створюємо HTML-код для кожного предмета та його оцінок
    for (const [subjectName, items] of Object.entries(grouped)) {
        // Рахуємо середній бал для цього конкретного предмета
        const sum = items.reduce((acc, current) => acc + (parseFloat(current.grade) || 0), 0);
        const avg = (sum / items.length).toFixed(1);

        // Вибираємо колір для блоку середнього балу залежно від оцінки
        let avgStyle = 'background: #f1f5f9; color: #334155; font-weight:800;';
        if (avg >= 90) {
            avgStyle = 'background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #15803d; font-weight:800; border: 1px solid #bbf7d0;';
        } else if (avg >= 75) {
            avgStyle = 'background: linear-gradient(135deg, #dbeafe, #bfdbfe); color: #1d4ed8; font-weight:800; border: 1px solid #bfdbfe;';
        } else if (avg >= 60) {
            avgStyle = 'background: linear-gradient(135deg, #fef3c7, #fde68a); color: #b45309; font-weight:800; border: 1px solid #fde68a;';
        } else if (avg < 60) {
            avgStyle = 'background: linear-gradient(135deg, #fee2e2, #fecaca); color: #b91c1c; font-weight:800; border: 1px solid #fecaca;';
        }

        // Будуємо велику картку предмета
        html += `
            <div class="subject-row-card" style="width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 24px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.02); margin-bottom: 30px; overflow: hidden; display: flex; flex-direction: column;">
                <div style="padding: 20px 28px; background: linear-gradient(to right, #f8fafc, #ffffff); border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; gap: 16px;">
                    <div style="display: flex; align-items: center; gap: 14px; min-width: 0;">
                        <div style="width: 42px; height: 42px; background: linear-gradient(135deg, #eef2ff, #e0e7ff); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i class="fa-solid fa-book" style="color: #4f46e5; font-size: 18px;"></i>
                        </div>
                        <span style="font-weight: 800; color: #0f172a; font-size: 18px; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${defEscape(subjectName)}
                        </span>
                    </div>
                    <span style="padding: 8px 16px; border-radius: 14px; font-size: 13px; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.02); ${avgStyle}">
                        Середній бал: <span style="font-size: 16px; font-weight: 900;">${avg}</span>
                    </span>
                </div>
                
                <div style="padding: 20px 28px; display: flex; flex-direction: column; gap: 12px; background: #ffffff; width: 100%; box-sizing: border-box;">
                    ${items.map(gradeItem => {
                        // Визначаємо колір для кожної окремої оцінки у списку
                        const score = parseFloat(gradeItem.grade) || 0;
                        let badgeStyle = 'background: #f1f5f9; color: #475569;';
                        let gradeColor = 'color: #475569;';

                        if (score >= 90) { badgeStyle = 'background: #dcfce7; color: #15803d;'; gradeColor = 'color: #10b981;'; }
                        else if (score >= 75) { badgeStyle = 'background: #dbeafe; color: #1d4ed8;'; gradeColor = 'color: #3b82f6;'; }
                        else if (score >= 60) { badgeStyle = 'background: #fef3c7; color: #b45309;'; gradeColor = 'color: #f59e0b;'; }
                        else if (score < 60) { badgeStyle = 'background: #fee2e2; color: #b91c1c;'; gradeColor = 'color: #ef4444;'; }

                        const teacherLastName = gradeItem.teacher_full_name ? gradeItem.teacher_full_name.split(' ')[0] : 'Викладач';

                        // Додаємо рядок з деталями про оцінку (дата, тип роботи, викладач)
                        return `
                            <div class="grade-line-row" style="display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 20px; gap: 16px;">
                                <div style="flex: 1; min-width: 0; text-align: left;">
                                    <span style="font-size: 13px; font-weight: 700; padding: 4px 12px; border-radius: 8px; display: inline-block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; ${badgeStyle}" title="${defEscape(gradeItem.work_type)}">
                                        ${defEscape(gradeItem.work_type)}
                                    </span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 24px; color: #64748b; font-size: 13px; font-weight: 500;">
                                    <span>📅 ${defEscape(gradeItem.date)}</span>
                                    <span style="max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${defEscape(gradeItem.teacher_full_name)}">👤 ${defEscape(teacherLastName)}</span>
                                </div>
                                <div style="font-size: 22px; font-weight: 900; min-width: 50px; text-align: right; ${gradeColor}">
                                    ${defEscape(String(gradeItem.grade))}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    // Вставляємо весь створений код на сторінку
    container.innerHTML = `<div style="width: 100%; display: block; box-sizing: border-box;">${html}</div>`;
}
// Модифікуємо вашу існуючу функцію applyGradesFilters, щоб вона записувала поточний стан фільтрації
function applyGradesFilters() {
    const subjectInput = document.getElementById('filter-subject');
    const dateInput = document.getElementById('filter-date');
    
    // Беремо текст пошуку предмета та дату з полів вводу
    const subjectQuery = subjectInput ? subjectInput.value.toLowerCase().trim() : '';
    const dateQuery = dateInput ? dateInput.value : ''; 

    // Просіюємо масив оцінок через фільтри
    const filtered = originalGradesData.filter(item => {
        if (!item.discipline) return false;
        
        // Перевіряємо, чи збігається назва предмета
        const matchesSubject = item.discipline.toLowerCase().includes(subjectQuery);
        
        // Перевіряємо, чи збігається дата (якщо її обрали)
        let matchesDate = true;
        if (dateQuery && item.date) {
            matchesDate = (item.date === dateQuery);
        }
        return matchesSubject && matchesDate;
    });

    // Запам'ятовуємо відфільтровані дані для майбутнього експорту
    currentFilteredGradesData = filtered;

    // Перемальовуємо оцінки на екрані та підсвічуємо активну кнопку-тег
    renderGroupedGrades(filtered);
    highlightActiveChip(subjectQuery);
}

// Створюємо швидкі кнопки-теги для вибору предметів
function buildSubjectsChips(subjects) {
    const container = document.getElementById('subjects-chips-container');
    if (!container) return;
    if (subjects.length === 0) { container.innerHTML = ''; return; }

    const defEscape = (str) => (typeof escapeHtml === 'function' ? escapeHtml(str) : str);

    // Додаємо найпершу кнопку для скидання фільтру
    let html = `<span class="subject-chip active-chip" data-value="" style="display:inline-block; margin:4px; padding:6px 12px; background:#4f46e5; color:#fff; border-radius:20px; font-size:12px; cursor:pointer; font-weight:500;">Всі предмети</span>`;
    
    // Додаємо кнопки для кожного окремого предмета
    subjects.forEach(sub => {
        html += `<span class="subject-chip" data-value="${defEscape(sub)}" style="display:inline-block; margin:4px; padding:6px 12px; background:#f1f5f9; color:#334155; border-radius:20px; font-size:12px; cursor:pointer; font-weight:500;">${defEscape(sub)}</span>`;
    });
    container.innerHTML = html;

    // Вішаємо клік на кожну створену кнопку-тег
    container.querySelectorAll('.subject-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            const val = e.currentTarget.getAttribute('data-value');
            const inputSubject = document.getElementById('filter-subject');
            if (inputSubject) { 
                inputSubject.value = val; 
                applyGradesFilters(); 
            }
        });
    });
}

// Підсвічуємо вибрану кнопку-тег предмета та гасимо інші
function highlightActiveChip(currentQuery) {
    const chips = document.querySelectorAll('#subjects-chips-container .subject-chip');
    chips.forEach(chip => {
        const val = chip.getAttribute('data-value').toLowerCase().trim();
        if (val === currentQuery) {
            chip.style.background = '#4f46e5'; 
            chip.style.color = '#fff';
        } else {
            chip.style.background = '#f1f5f9'; 
            chip.style.color = '#334155';
        }
    });
}

// Будуємо випадаючий список підказок під полем пошуку
function buildSuggestionsDropdown(list) {
    const dropdown = document.getElementById('subject-suggestions');
    if (!dropdown) return;
    if (list.length === 0) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }

    // Створюємо HTML елементи для кожного предмета у списку підказок
    dropdown.innerHTML = list.map(subject => `
        <div class="suggestion-item" data-value="${escapeHtml(subject)}" style="padding:10px 14px; cursor:pointer; border-bottom:1px solid #f8fafc; font-size:13px; color:#334155;">
            📚 ${escapeHtml(subject)}
        </div>`).join('');

    // Налаштовуємо кліки та ефекти наведення для підказок
    dropdown.querySelectorAll('.suggestion-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const val = e.currentTarget.getAttribute('data-value');
            const inputSubject = document.getElementById('filter-subject');
            if (inputSubject) { 
                inputSubject.value = val; 
                applyGradesFilters(); 
            }
            dropdown.style.display = 'none';
        });
        el.addEventListener('mouseenter', (e) => e.target.style.background = '#f1f5f9');
        el.addEventListener('mouseleave', (e) => e.target.style.background = '#ffffff');
    });
}

// Обробка введення тексту у поле пошуку предмета
function handleSubjectSearch(e) { 
    const query = e.target.value.toLowerCase().trim();
    const dropdown = document.getElementById('subject-suggestions');
    if (!dropdown) return;
    
    // Залишаємо в списку підказок лише те, що підходить під введені літери
    const filteredSubjects = uniqueSubjects.filter(s => s.toLowerCase().includes(query));
    buildSuggestionsDropdown(filteredSubjects);
    
    // Показуємо або ховаємо віконце підказок
    dropdown.style.display = filteredSubjects.length > 0 ? 'block' : 'none';
    applyGradesFilters(); 
}

// Показуємо відразу всі можливі предмети при натисканні на пусте поле пошуку
function showAllSuggestions() {
    const dropdown = document.getElementById('subject-suggestions');
    if (dropdown && uniqueSubjects.length > 0) {
        buildSuggestionsDropdown(uniqueSubjects);
        dropdown.style.display = 'block';
    }
}

// Повне скидання всіх фільтрів (пошуку та дати) до початкового стану
function resetAllGradesFilters() {
    const inputSubject = document.getElementById('filter-subject');
    const inputDate = document.getElementById('filter-date');
    if (inputSubject) inputSubject.value = '';
    if (inputDate) inputDate.value = '';
    renderGroupedGrades(originalGradesData);
    highlightActiveChip('');
}

// Збираємо повне ім'я студента з бази для гарного відображення в документах
function getStudentNameFromDB() {
    if (studentLastName || studentFirstName) {
        return `${studentLastName} ${studentFirstName} (${studentGroupName || 'Без групи'})`.trim();
    }
    return "Студент";
}

// Експорт оцінок у файл Excel за допомогою бібліотеки XLSX
function exportGradesToExcel() {
    // Беремо відфільтровані дані, а якщо фільтр порожній — абсолютно всі оцінки
    const dataToExport = currentFilteredGradesData.length > 0 ? currentFilteredGradesData : originalGradesData;
    
    if (!dataToExport || dataToExport.length === 0) {
        alert("Немає даних для експорту в Excel!");
        return;
    }

    let studentName = getStudentNameFromDB();
    if (!studentName) studentName = "Студент";
    
    const safeStudentName = studentName.replace(/[/\\?%*:|"<>]/g, '-');
    
    const currentDate = new Date().toISOString().split('T')[0];
    const formattedDate = new Date().toLocaleDateString('uk-UA');

    // Формуємо шапку таблиці та назви колонок
    const excelRows = [
        ["Електронна відомість успішності (EduPlatform)"],
        [`Студент: ${studentName}`],
        [`Дата формування: ${formattedDate}`],
        [], 
        ["№", "Дисципліна", "Тип роботи", "Дата занять", "Викладач", "Оцінка"]
    ];

    // Заповнюємо таблицю рядками з оцінками
    dataToExport.forEach((item, index) => {
        excelRows.push([
            index + 1,
            item.discipline || "Не вказано",
            item.work_type || "Поточна оцінка",
            item.date || "",
            item.teacher_full_name || "Викладач",
            parseFloat(item.grade) || item.grade
        ]);
    });

    // Створюємо та збираємо документ Excel
    const worksheet = XLSX.utils.aoa_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    
    // ВІДПРАВЛЕНО: Змінено другий аргумент з workbook на worksheet
    XLSX.utils.book_append_sheet(workbook, worksheet, "Успішність");

    // Об'єднуємо перші кілька осередків для гарного заголовка
    worksheet["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }
    ];

    // Задаємо фіксовану ширину для кожної колонки, щоб текст не злипався
    worksheet["!cols"] = [
        { wch: 6 }, { wch: 38 }, { wch: 22 }, { wch: 14 }, { wch: 28 }, { wch: 10 }
    ];

    // Зберігаємо готовий файл на комп'ютер користувача
    const fileName = `Успішність_${safeStudentName}_${currentDate}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

// Генерація та завантаження красивого PDF звіту
async function exportGradesToPDF() {
    console.log("🎬 Ініціалізація чищення та генерації PDF...");

    // Перевіряємо, чи підключена html2pdf. Якщо ні — завантажуємо її на льоту
    if (typeof html2pdf === 'undefined') {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (e) {
            alert("Помилка: Не вдалося завантажити модуль PDF.");
            return;
        }
    }

    const container = document.getElementById('student-grades-container');
    if (!container || !container.innerHTML.trim()) {
        alert("Помилка: Немає даних для генерації PDF!");
        return;
    }

    // Безпечно збираємо інформацію про поточного студента
    let sName = "Студент";
    if (typeof studentLastName !== 'undefined' && typeof studentFirstName !== 'undefined' && (studentLastName || studentFirstName)) {
        sName = `${studentLastName} ${studentFirstName} (${studentGroupName || 'Без групи'})`.trim();
    }
    const sEmail = typeof studentEmail !== 'undefined' ? studentEmail : 'Електронна пошта відсутня';
    const currentDate = new Date().toISOString().split('T')[0];
    const finalFileName = `Успішність_${sName.replace(/[/\\?%*:|"<>]/g, '-')}_${currentDate}.pdf`;

    // Створюємо тимчасовий чистий HTML-шаблон суто для друку в PDF
    const pdfWrapper = document.createElement('div');
    pdfWrapper.className = "pdf-export-root";
    pdfWrapper.innerHTML = `
        <div style="font-family: 'Inter', system-ui, -apple-system, sans-serif; padding: 10px; background: #ffffff; color: #0f172a;">
            <div style="margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
                <h1 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: -0.01em;">Електронна відомість успішності</h1>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #334155;">
                    <div><strong>Студент:</strong> ${sName}</div>
                    <div><strong>Електронна пошта:</strong> ${sEmail}</div>
                    <div><strong>Дата генерації:</strong> ${new Date().toLocaleDateString('uk-UA')}</div>
                </div>
            </div>
            
            <div class="pdf-body-content" style="display: block; width: 100%;">
                ${container.innerHTML}
            </div>
        </div>
    `;

    // Очищаємо картки та адаптуємо їх під друкований формат сторінки А4
    pdfWrapper.querySelectorAll('.subject-row-card').forEach(card => {
        card.style.cssText = "width: 100% !important; background: #ffffff !important; border: 1px solid #e2e8f0 !important; border-radius: 12px !important; margin-bottom: 12px !important; page-break-inside: avoid !important; display: flex !important; flex-direction: column !important; box-shadow: none !important; overflow: hidden !important;";
        
        // Оновлюємо та стискаємо відступи у шапці картки предмета
        const header = card.querySelector('div');
        if (header) {
            header.style.cssText = "padding: 10px 15px !important; background: #f8fafc !important; border-bottom: 1px solid #f1f5f9 !important; display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 10px !important;";
        }
        
        // Налаштовуємо внутрішні списки оцінок для друку
        const body = card.children[1];
        if (body) {
            body.style.cssText = "padding: 10px 15px !important; display: flex !important; flex-direction: column !important; gap: 6px !important; background: #ffffff !important; width: 100% !important; box-sizing: border-box !important;";
        }
    });

    // Очищаємо та притискаємо рядки оцінок, щоб вони не розривалися посеред сторінки
    pdfWrapper.querySelectorAll('.grade-line-row').forEach(row => {
        row.style.cssText = "display: flex !important; align-items: center !important; justify-content: space-between !important; background: #f8fafc !important; border: 1px solid #e2e8f0 !important; border-radius: 8px !important; padding: 6px 12px !important; gap: 10px !important; page-break-inside: avoid !important;";
    });

    // Повністю видаляємо зі звіту інтерактивні елементи, які не потрібні на папері
    pdfWrapper.querySelectorAll('button, .toolbar-actions, #grades-counter-badge, .subjects-chips-carousel, .section-title-mini').forEach(el => {
        el.style.setProperty('display', 'none', 'important');
    });

    // Налаштовуємо параметри друку (відступи, якість рендерингу, формат)
    const options = {
        margin:       [10, 10, 10, 10],
        filename:     finalFileName,
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  { 
            scale: 3,             // Висока якість картинки та чіткість шрифтів
            useCORS: true, 
            letterRendering: true,
            logging: false
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['css'] } 
    };

    // Запускаємо процес створення та скачування PDF-файлу
    try {
        console.log("🚀 Генеруємо чистий PDF-файл...");
        await html2pdf().set(options).from(pdfWrapper).save();
        console.log("🎉 Успішно завантажено!");
    } catch (err) {
        console.error("❌ Помилка рендерингу html2pdf:", err);
        alert("Сталася помилка при збереженні файлу. Спробуйте ще раз.");
    }
}

// Перевірка прапорців скасування заняття від бекенду
function checkIsCancelled(data) {
    if (!data) return false;
    return data.is_cancelled_today === true || 
           data.is_cancelled_today === 'true' || 
           parseInt(data.is_cancelled_today, 10) === 1 ||
           data.is_cancelled === true || 
           data.is_cancelled === 'true' ||
           parseInt(data.is_cancelled, 10) === 1 ||
           data.status === 'cancelled';
}

// Екранування рядків для захисту від XSS
const safeEscape = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
};

// Асинхронне завантаження оцінок, енок та скасувань
async function loadLessonDetails(scheduleId, date, userId, rowElement) {
    try {
        const token = localStorage.getItem('token');
        
        let requestDate = date;
        if (date && date.includes('.')) {
            const dParts = date.split('.');
            if (dParts.length === 3) requestDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`;
        }

        const response = await fetch(`${BASE_URL}/student/lesson-details?scheduleId=${scheduleId}&date=${requestDate}&userId=${userId}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!response.ok) return;

        const data = await response.json();
        const isCancelled = checkIsCancelled(data);

        let targetRow = rowElement;
        if (!targetRow) {
            const formattedStandard = `lesson-row-${scheduleId}-${requestDate}`;
            const formattedDots = `lesson-row-${scheduleId}-${date}`;
            targetRow = document.getElementById(formattedStandard) || document.getElementById(formattedDots);
        }

        if (isCancelled) {
            console.log(`🚨 [СКАСОВАНО] Пара ID ${scheduleId} на дату ${requestDate} заблокована.`);
            
            if (targetRow) {
                // Блокування картки заняття
                targetRow.style.cssText = `
                    background: #fef2f2 !important; 
                    border: 1px solid #fec2c2 !important; 
                    border-left: 4px solid #ef4444 !important; 
                    opacity: 0.65 !important; 
                    cursor: not-allowed !important;
                    pointer-events: none !important;
                `;
                
                targetRow.removeAttribute('onclick');
                targetRow.classList.add('cancelled-blocked');
                targetRow.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                };

                // Зміна номера пари на скасований
                const numberLabel = targetRow.querySelector('.lesson-number-label');
                if (numberLabel) {
                    numberLabel.style.setProperty('color', '#ef4444', 'important');
                    numberLabel.style.setProperty('font-weight', '700', 'important');
                    numberLabel.innerHTML = `Пара №${data.lesson_number || scheduleId} <span style="color:#ef4444; font-weight:800;">❌ [СКАСОВАНО]</span>`;
                }

                // Закреслення назви предмета
                const titleEl = targetRow.querySelector('.lesson-title-text');
                if (titleEl) {
                    titleEl.style.setProperty('text-decoration', 'line-through', 'important');
                    titleEl.style.setProperty('color', '#94a3b8', 'important');
                    titleEl.style.setProperty('font-style', 'italic', 'important');
                }

                // Додавання червоного бейджа скасування
                const attBadgeZone = targetRow.querySelector('.row-attendance-zone');
                if (attBadgeZone) {
                    attBadgeZone.innerHTML = `
                        <span class="badge bg-danger" style="font-size:10px; padding:3px 7px; font-weight:700; border-radius:4px; text-transform:uppercase; color:white !important; background-color:#ef4444 !important; border:none !important;">
                            Скасовано
                        </span>`;
                }

                const gradeBadgeZone = targetRow.querySelector('.row-grade-zone');
                if (gradeBadgeZone) gradeBadgeZone.innerHTML = '';
            }
            return;
        }

        // Обробка звичайної пари (тема, оцінки, н-ки)
        if (targetRow) {
            targetRow.classList.remove('cancelled-blocked');
            
            const titleEl = targetRow.querySelector('.lesson-title-text');
            if (data.theme && titleEl) {
                titleEl.title = `Тема: ${data.theme}\nНатисніть, щоб відкрити домашнє завдання`;
            }

            const attBadgeZone = targetRow.querySelector('.row-attendance-zone');
            if (attBadgeZone) {
                if (data.attendance_status === 'Відсутній') {
                    attBadgeZone.innerHTML = `<span class="badge bg-danger" style="font-size:10px; padding:2px 6px; font-weight:700;">Н</span>`;
                } else if (data.attendance_status === 'Запізнення') {
                    attBadgeZone.innerHTML = `<span class="badge bg-warning text-dark" style="font-size:10px; padding:2px 6px; font-weight:700;">З</span>`;
                } else {
                    attBadgeZone.innerHTML = ''; 
                }
            }

            const gradeBadgeZone = targetRow.querySelector('.row-grade-zone');
            if (gradeBadgeZone && data.student_grade !== null && data.student_grade !== undefined) {
                let badgeColor = '#4f46e5';
                if (data.student_grade >= 90) badgeColor = '#16a34a';
                if (data.student_grade < 60) badgeColor = '#dc2626';

                gradeBadgeZone.innerHTML = `
                    <span style="background:${badgeColor}; color:white; padding:2px 8px; border-radius:8px; font-size:11px; font-weight:800;">
                        ${data.student_grade}
                    </span>`;
            }
        }
    } catch (err) {
        console.error(`❌ Помилка деталей пари ${scheduleId}:`, err);
    }
}

// Рендеринг одного рядка заняття
function renderLessonRow(lesson, rowIdx, dateStr, uniqueRowId) {
    const isCancelled = checkIsCancelled(lesson);

    const cancelledRowStyles = isCancelled 
        ? "background: #fef2f2 !important; border: 1px solid #fec2c2 !important; border-left: 4px solid #ef4444 !important; opacity: 0.6; cursor: not-allowed !important; pointer-events: none !important;" 
        : "cursor: pointer;";

    const titleStyle = isCancelled
        ? "margin: 4px 0; text-decoration: line-through; color: #94a3b8; font-style: italic;"
        : "margin: 4px 0; color: #1e293b;";

    const clickHandler = `if(this.classList.contains('cancelled-blocked')){ event.stopPropagation(); return false; } window.openStudentHomeworkModal('${encodeURIComponent(JSON.stringify({
        schedule_id: lesson.id,
        subject_name: lesson.subject_name,
        teacher_name: lesson.teacher_name,
        lesson_number: lesson.lesson_number,
        date: dateStr,
        userId: (typeof studentUserId !== 'undefined') ? studentUserId : null
    }))}')`;

    return `
        <div id="${uniqueRowId}" class="lesson-row-item student-lesson-clickable ${isCancelled ? 'cancelled-blocked' : ''}" style="--row-animation-index:${rowIdx}; display: flex; flex-direction: column; position: relative; ${cancelledRowStyles}" onclick="${clickHandler}">
            <div class="lesson-time-meta" style="display: flex; justify-content: space-between; align-items: center;">
                <span class="lesson-number-label" style="${isCancelled ? 'color:#ef4444; font-weight:700;' : ''}">
                    Пара №${lesson.lesson_number} ${isCancelled ? '❌ [СКАСОВАНО]' : ''}
                </span>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <div class="row-attendance-zone">
                        ${isCancelled ? `<span class="badge bg-danger" style="font-size:10px; padding:3px 7px; font-weight:700; border-radius:4px; text-transform:uppercase;">Скасовано</span>` : ''}
                    </div>
                    <div class="row-grade-zone"></div>
                </div>
            </div>
            <h4 class="lesson-title-text" style="${titleStyle}" title="${isCancelled ? 'Пару скасовано' : 'Натисніть, щоб переглянути тему та ДЗ'}">${safeEscape(lesson.subject_name)}</h4>
            <div class="lesson-details-meta">
                <span><i class="fa-solid fa-user-tie"></i> ${safeEscape(lesson.teacher_name || 'Не вказано')}</span>
                <span class="room-pill"><i class="fa-solid fa-location-dot"></i> ${safeEscape(lesson.room_name || lesson.room || 'Онлайн')}</span>
            </div>
        </div>
    `;
}

// Генерація сітки розкладу на тиждень
function renderDynamicSchedule(lessons) {
    const scheduleContainer = document.getElementById('student-schedule-container');
    if (!scheduleContainer) return;

    scheduleContainer.innerHTML = `<div class="schedule-perfect-grid" id="schedule-grid-wrapper" style="display: grid; width: 100%;"></div>`;
    const gridWrapper = document.getElementById('schedule-grid-wrapper');

    const weekdays = [
        { id: 1, name: "Понеділок" },
        { id: 2, name: "Вівторок" },
        { id: 3, name: "Середа" },
        { id: 4, name: "Четвер" },
        { id: 5, name: "П'ятниця" }
    ];

    let currentDayIndex = new Date().getDay(); 
    if (currentDayIndex === 0) currentDayIndex = 7; 

    const now = new Date();
    const realTodayStr = now.toLocaleDateString('uk-UA');

    let currentWeekMonday = null;
    if (typeof window.getWeekRange === 'function' && window.currentScheduleDate) {
        currentWeekMonday = new Date(window.getWeekRange(window.currentScheduleDate).monday);
    } else {
        const tempDate = new Date(window.currentScheduleDate || new Date());
        const dayOffset = tempDate.getDay() === 0 ? -6 : 1 - tempDate.getDay();
        tempDate.setDate(tempDate.getDate() + dayOffset);
        currentWeekMonday = tempDate;
    }

    const lessonsByDay = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    if (Array.isArray(lessons)) {
        lessons.forEach(lesson => {
            if (lessonsByDay[lesson.day_of_week]) {
                lessonsByDay[lesson.day_of_week].push(lesson);
            }
        });
    }

    const postRenderQueue = [];

    weekdays.forEach((day, cardIndex) => {
        const dayLessons = lessonsByDay[day.id];
        
        const cardDate = new Date(currentWeekMonday);
        cardDate.setDate(currentWeekMonday.getDate() + (day.id - 1));
        const cardDateStr = cardDate.toLocaleDateString('uk-UA');
        const formattedDateStr = cardDate.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });

        const isToday = (day.id === currentDayIndex) && (cardDateStr === realTodayStr);
        
        const year = cardDate.getFullYear();
        const month = String(cardDate.getMonth() + 1).padStart(2, '0');
        const dayOfMonth = String(cardDate.getDate()).padStart(2, '0');
        const isoDateStr = `${year}-${month}-${dayOfMonth}`;

        const cardElement = document.createElement('div');
        cardElement.className = `schedule-modern-card ${isToday ? 'current-day-active today-highlight-card' : ''}`;
        cardElement.style.setProperty('--card-animation-index', cardIndex);

        let headerHTML = `
            <div class="modern-card-header">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <h3 style="margin:0;">${day.name}</h3>
                    <span style="font-size: 11px; opacity: 0.7; font-weight: 600;">${formattedDateStr}</span>
                </div>
                ${isToday ? '<span class="today-text-badge">СЬОГОДНІ</span>' : ''}
            </div>
        `;

        let lessonsHTML = '';
        if (dayLessons && dayLessons.length > 0) {
            dayLessons.sort((a, b) => (a.lesson_number || 0) - (b.lesson_number || 0));
            lessonsHTML = dayLessons.map((lesson, rowIndex) => {
                const uniqueRowId = `lesson-row-${lesson.id}-${isoDateStr}`;
                postRenderQueue.push({ scheduleId: lesson.id, dateStr: isoDateStr, elementId: uniqueRowId });
                
                return renderLessonRow(lesson, rowIndex, isoDateStr, uniqueRowId);
            }).join('');
        } else {
            lessonsHTML = `
                <div class="lesson-box-empty">
                    <i class="fa-regular fa-calendar-xmark empty-icon-animated"></i>
                    <p>Пар не заплановано</p>
                </div>
            `;
        }

        cardElement.innerHTML = `
            ${headerHTML}
            <div class="modern-lessons-container">
                ${lessonsHTML}
            </div>
        `;
        gridWrapper.appendChild(cardElement);
    });

    if (typeof renderCallsCard === 'function') {
        renderCallsCard(gridWrapper);
    }

    // Запуск детальних фонових запитів після рендерингу
    const activeUserId = (typeof studentUserId !== 'undefined') ? studentUserId : null;
    if (activeUserId) {
        postRenderQueue.forEach(item => {
            const rowElement = document.getElementById(item.elementId);
            loadLessonDetails(item.scheduleId, item.dateStr, activeUserId, rowElement);
        });
    }
}

// Завантаження розкладу з сервера та обробка канікул
window.loadScheduleData = async function(targetDate = new Date()) {
    const container = document.getElementById('student-schedule-container');
    if (!container) return;
    
    const sanitizedDate = new Date(targetDate);
    sanitizedDate.setHours(0, 0, 0, 0);
    window.currentScheduleDate = sanitizedDate; 

    const activeUserId = (typeof studentUserId !== 'undefined' && studentUserId) ? studentUserId : 
                         (window.state?.user?.id || localStorage.getItem('userId') || localStorage.getItem('user_id'));

    if (!activeUserId) {
        console.error("❌ studentUserId не визначено на сторінці.");
        container.innerHTML = `<div style="color:#ef4444; text-align:center; padding:20px; font-weight:700;">Помилка авторизації: ID студента відсутній.</div>`;
        return;
    }

    try {
        const weekRange = (typeof getWeekRange === 'function') ? getWeekRange(window.currentScheduleDate) : null;
        const weekInfo = (typeof getWeekType === 'function') ? getWeekType(window.currentScheduleDate) : { text: "Поточний тиждень", code: "1" }; 

        if (document.getElementById('schedule-week-range') && weekRange) {
            document.getElementById('schedule-week-range').innerText = `${weekRange.monday.toLocaleDateString('uk-UA')} - ${weekRange.sunday.toLocaleDateString('uk-UA')}`;
        }
        const badgeTextEl = document.getElementById('week-type-badge-text') || document.querySelector('#week-type-badge .badge-text');
        if (badgeTextEl) badgeTextEl.innerText = weekInfo.text;

        const year = sanitizedDate.getFullYear();
        const month = String(sanitizedDate.getMonth() + 1).padStart(2, '0');
        const day = String(sanitizedDate.getDate()).padStart(2, '0');
        const dateParam = `${year}-${month}-${day}`;

        let cleanBaseUrl = typeof BASE_URL !== 'undefined' ? BASE_URL : 'http://localhost:5000';
        if (cleanBaseUrl.endsWith('/api')) cleanBaseUrl = cleanBaseUrl.slice(0, -4);

        const res = await fetch(`${cleanBaseUrl}/api/student/${activeUserId}/schedule?week_type=${weekInfo.code}&date=${dateParam}`);
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || `Помилка сервера (Статус ${res.status})`);
        }
        
        const data = await res.json();

        // Показ блоку канікул
        if (data && (data.isVacation === true || data.is_vacation === true)) {
            container.innerHTML = `
                <div class="vacation-block-modern" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 50px 20px; text-align: center; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 16px; width: 100%; margin-top: 10px; box-sizing: border-box;">
                    <span style="font-size: 55px; margin-bottom: 16px; animation: campPulse 2s infinite ease-in-out; display:inline-block;">🌴</span>
                    <p style="font-size: 16px; font-weight: 700; color: #1e293b; max-width: 500px; margin: 0; line-height: 1.6;">
                        ${data.message || 'Навчальні заняття не проводяться відповідно до затвердженого академічного плану.'}
                    </p>
                </div>
            `;
            return; 
        }

        const lessonsArray = data.schedule || [];
        renderDynamicSchedule(lessonsArray);

    } catch (err) {
        console.error("❌ Помилка завантаження розкладу:", err);
        container.innerHTML = `
            <div style="color:#ef4444; text-align:center; padding:30px; font-weight:700; background:#fef2f2; border-radius:16px; border:1px solid #fee2e2; width: 100%;">
                <i class="fa-solid fa-triangle-exclamation"></i> Не вдалося завантажити актуальний розклад занять.<br>
                <span style="font-size:11px; font-weight:400; color:#b91c1c;">Деталі: ${err.message}</span>
            </div>`;
    }
};

// Модальне вікно перегляду теми та ДЗ пари
window.openStudentHomeworkModal = async function(encodedPayload) {
    try {
        const decodedString = decodeURIComponent(encodedPayload);
        const lesson = JSON.parse(decodedString);
        
        let modal = document.getElementById('student-homework-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'student-homework-modal';
            modal.className = 'custom-modal-backdrop';
            modal.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:none; justify-content:center; align-items:center; z-index:9999; padding:20px; backdrop-filter:blur(4px);";
            document.body.appendChild(modal);
        }

        let cleanIsoDate = lesson.date;
        if (lesson.date && lesson.date.includes('.')) {
            const parts = lesson.date.split('.');
            if (parts.length === 3) cleanIsoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        } else if (lesson.date && lesson.date.includes('T')) {
            cleanIsoDate = lesson.date.split('T')[0];
        }

        modal.innerHTML = `
            <div style="background:#fff; width:100%; max-width:500px; border-radius:16px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); padding:24px; position:relative; animation: modalFadeIn 0.25s ease; font-family: system-ui, -apple-system, sans-serif;">
                <button onclick="document.getElementById('student-homework-modal').style.display='none'" style="position:absolute; top:16px; right:16px; background:none; border:none; font-size:20px; color:#64748b; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                <h3 style="margin:0 0 4px 0; font-size:18px; color:#1e293b; font-weight:700;">${lesson.subject_name}</h3>
                <p style="margin:0 0 16px 0; font-size:13px; color:#64748b; font-weight:500;">
                    <i class="fa-solid fa-user-tie"></i> ${lesson.teacher_name} | Пара №${lesson.lesson_number}
                </p>
                <div style="font-size:11px; font-weight:600; color:#94a3b8; margin-bottom:12px; display:flex; gap:6px; align-items:center;">
                    <i class="fa-regular fa-calendar"></i> Дата заняття: ${lesson.date}
                </div>
                <hr style="border:0; border-top:1px solid #f1f5f9; margin-bottom:16px;">
                
                <div id="homework-modal-content" style="display:flex; flex-direction:column; gap:16px;">
                    <div style="text-align:center; padding:20px; color:#64748b;">
                        <i class="fa-solid fa-circle-notch fa-spin" style="margin-right:8px; color:#4f46e5;"></i> Отримання даних з журналу...
                    </div>
                </div>
            </div>
        `;
        modal.style.display = 'flex';

        if (!lesson.userId) {
            document.getElementById('homework-modal-content').innerHTML = `<p style="color:#ef4444; font-size:14px; text-align:center;">Помилка: Не вдалося визначити ID студента.</p>`;
            return;
        }

        const token = localStorage.getItem('token');
        const response = await fetch(`${BASE_URL}/student/lesson-details?scheduleId=${lesson.schedule_id}&date=${cleanIsoDate}&userId=${lesson.userId}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const contentDiv = document.getElementById('homework-modal-content');

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            contentDiv.innerHTML = `<p style="color:#ef4444; text-align:center; margin:20px 0;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size:24px; display:block;"></i>
                Помилка сервера (${response.status}): ${errorData.error || 'Невідома помилка'}
            </p>`;
            return;
        }

        const details = await response.json();
        const isCancelled = checkIsCancelled(details);

        if (isCancelled) {
            contentDiv.innerHTML = `
                <div style="text-align:center; padding:24px 10px; background:#fef2f2; border:1px dashed #fca5a5; border-radius:12px;">
                    <i class="fa-solid fa-ban" style="font-size:32px; color:#ef4444; margin-bottom:10px; display:block;"></i>
                    <h4 style="margin:0 0 4px 0; color:#991b1b; font-size:15px; font-weight:700;">ЗАНЯТТЯ СКАСОВАНО</h4>
                    <p style="margin:0; color:#7f1d1d; font-size:13px; line-height:1.4;">
                        Цю пару було офіційно скасовано адміністрацією на вказану дату. Домашні завдання та теми занять відсутні.
                    </p>
                </div>`;
            
            const rowEl = document.getElementById(`lesson-row-${lesson.schedule_id}-${cleanIsoDate}`) || 
                          document.getElementById(`lesson-row-${lesson.schedule_id}-${lesson.date}`);
            
            if (rowEl) {
                rowEl.style.cssText = `
                    background: #fef2f2 !important; 
                    border: 1px solid #fec2c2 !important; 
                    border-left: 4px solid #ef4444 !important; 
                    opacity: 0.55 !important; 
                    cursor: not-allowed !important;
                    pointer-events: none !important;
                `;
                rowEl.classList.add('cancelled-blocked');
                rowEl.removeAttribute('onclick');
                
                const tEl = rowEl.querySelector('.lesson-title-text');
                if (tEl) {
                    tEl.style.setProperty('text-decoration', 'line-through', 'important');
                    tEl.style.setProperty('color', '#94a3b8', 'important');
                    tEl.style.setProperty('font-style', 'italic', 'important');
                }
                const numLabel = rowEl.querySelector('.lesson-number-label');
                if (numLabel && !numLabel.innerText.includes('[СКАСОВАНО]')) {
                    numLabel.style.setProperty('color', '#ef4444', 'important');
                    numLabel.innerHTML = `Parа №${lesson.lesson_number} ❌ [СКАСОВАНО]`;
                }
                const attBadgeZone = rowEl.querySelector('.row-attendance-zone');
                if (attBadgeZone) {
                    attBadgeZone.innerHTML = `<span class="badge bg-danger" style="font-size:10px; padding:3px 7px; font-weight:700; border-radius:4px; text-transform:uppercase; background-color:#ef4444!important; color:#fff!important;">Скасовано</span>`;
                }
            }
            return;
        }
        
        if (!details.theme && !details.homework && !details.attendance_status && !details.student_grade) {
            contentDiv.innerHTML = `
                <p style="color:#64748b; text-align:center; margin:20px 0;">
                    <i class="fa-solid fa-folder-open" style="font-size:24px; margin-bottom:8px; display:block; color:#94a3b8;"></i>
                    На цю дату дані відсутні. Викладач ще не виставляв оцінок та не заповнював тему.
                </p>`;
            return;
        }

        let personalStatsHTML = '';
        if (details.attendance_status || details.student_grade) {
            let attendanceBadge = '';
            let gradeBadge = '';

            if (details.attendance_status === 'Присутній') {
                attendanceBadge = `<span style="background:#dcfce7; color:#15803d; padding:6px 12px; border-radius:20px; font-size:12px; font-weight:700;"><i class="fa-solid fa-circle-check"></i> Присутній</span>`;
            } else if (details.attendance_status === 'Відсутній') {
                attendanceBadge = `<span style="background:#fee2e2; color:#b91c1c; padding:6px 12px; border-radius:20px; font-size:12px; font-weight:700;"><i class="fa-solid fa-circle-xmark"></i> Відсутній (н)</span>`;
            } else if (details.attendance_status === 'Запізнення') {
                attendanceBadge = `<span style="background:#fef9c3; color:#a16207; padding:6px 12px; border-radius:20px; font-size:12px; font-weight:700;"><i class="fa-solid fa-clock"></i> Запізнення</span>`;
            }

            if (details.student_grade !== null && details.student_grade !== undefined) {
                let gradeColor = '#4f46e5';
                if (details.student_grade >= 90) gradeColor = '#16a34a';
                if (details.student_grade < 60) gradeColor = '#dc2626';

                gradeBadge = `
                    <div style="display:flex; align-items:center; gap:8px; background:#f8fafc; padding:6px 14px; border-radius:12px; border:1px solid #e2e8f0;">
                        <span style="font-size:12px; font-weight:600; color:#64748b;">Оцінка [${details.grade_type || 'Пара'}]:</span>
                        <span style="background:${gradeColor}; color:#fff; width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; font-size:14px; font-weight:800; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${details.student_grade}</span>
                    </div>
                `;
            }

            personalStatsHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; padding:12px; border-radius:12px; margin-bottom:8px; flex-wrap:wrap; gap:10px;">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <span style="font-size:10px; font-weight:700; color:#64748b; text-transform: uppercase; letter-spacing:0.5px;">СТАТУС СТУДЕНТА</span>
                        ${attendanceBadge || '<span style="font-size:12px; color:#94a3b8; font-style:italic;">Не відмічено</span>'}
                    </div>
                    ${gradeBadge}
                </div>
            `;
        }

        contentDiv.innerHTML = `
            ${personalStatsHTML}
            <div style="margin-top:4px;">
                <span style="font-size:11px; font-weight:700; color:#4f46e5; text-transform: uppercase; letter-spacing:0.5px; display:block; margin-bottom:4px;">ТЕМA ЗАНЯТТЯ</span>
                <div style="background:#f8fafc; padding:12px; border-radius:8px; color:#334155; font-size:14px; border-left:3px solid #cbd5e1; min-height:36px;">
                    ${details.theme || '<span style="color:#94a3b8; font-style:italic;">Тема заняття не внесена викладачем</span>'}
                </div>
            </div>
            <div>
                <span style="font-size:11px; font-weight:700; color:#e11d48; text-transform: uppercase; letter-spacing:0.5px; display:block; margin-bottom:4px;">ДОМАШНЄ ЗАВДАННЯ</span>
                <div style="background:#fff1f2; padding:12px; border-radius:8px; color:#9f1239; font-size:14px; font-weight:500; border-left:3px solid #f43f5e; min-height:36px;">
                    ${details.homework || '<span style="color:#cca3a8; font-style:italic;">Домашнього завдання не задано</span>'}
                </div>
            </div>
        `;

    } catch (e) {
        console.error("❌ Помилка відображення деталей уроку:", e);
        const contentDiv = document.getElementById('homework-modal-content');
        if (contentDiv) {
            contentDiv.innerHTML = `<p style="color:#ef4444; text-align:center;">Помилка обробки даних.</p>`;
        }
    }
};
// Генерація картки з розкладом дзвінків
function renderCallsCard(gridWrapper) {
    if (!gridWrapper) return;

    if (typeof window.customRenderCallsCard === 'function') {
        window.customRenderCallsCard(gridWrapper);
        return;
    }
    
    const callsCard = document.createElement('div');
    callsCard.className = 'schedule-modern-card calls-card-special';
    callsCard.style.setProperty('--card-animation-index', 5);

    callsCard.innerHTML = `
        <div class="modern-card-header" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 15px 18px 10px 18px; gap: 4px;">
            <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #1e293b; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <i class="fa-solid fa-clock-retro" style="color: #6366f1;"></i> Розклад дзвінків
            </h3>
            <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.3px; color: #64748b;">Понеділок — П'ятниця</span>
        </div>
        
        <div class="modern-lessons-container" style="padding: 10px 14px 14px 14px; display: flex; flex-direction: column; gap: 14px;">
            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.03), 0 4px 12px rgba(99, 102, 241, 0.05); padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5; letter-spacing: 0.2px;">Пара №1</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>08:30 – 09:50</span>
                </div>
            </div>

            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.03), 0 4px 12px rgba(99, 102, 241, 0.05); padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5; letter-spacing: 0.2px;">Пара №2</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>10:00 – 11:20</span>
                </div>
            </div>

            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.03), 0 4px 12px rgba(99, 102, 241, 0.05); padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5; letter-spacing: 0.2px;">Пара №3</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>11:40 – 13:00</span>
                </div>
            </div>

            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.03), 0 4px 12px rgba(99, 102, 241, 0.05); padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5; letter-spacing: 0.2px;">Пара №4</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>13:20 – 14:40</span>
                </div>
            </div>
        </div>
    `;
    
    gridWrapper.appendChild(callsCard);
}

// Ініціалізація бічного меню навігації
function initNavigation() {
    const navButtons = {
        'btn-dashboard': 'dashboard-sec',
        'btn-grades': 'grades-sec',
        'btn-schedule': 'schedule-sec',
        'btn-settings': 'settings-sec'
    };

    // Прив'язка кліків до кнопок меню
    Object.keys(navButtons).forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (!btn || btn.dataset.navListenerActive) return;

        btn.addEventListener('click', async () => {
            switchSection(btnId, navButtons[btnId]);
        });
        
        btn.dataset.navListenerActive = "true";
    });

    // Автоматичне відкриття дашборду при старті
    switchSection('btn-dashboard', 'dashboard-sec');
}

// Перемикання активної секції кабінету
function switchSection(activeBtnId, targetSectionId) {
    const navButtons = {
        'btn-dashboard': 'dashboard-sec',
        'btn-grades': 'grades-sec',
        'btn-schedule': 'schedule-sec',
        'btn-settings': 'settings-sec'
    };

    // Очищення активних класів у всіх кнопок
    Object.keys(navButtons).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.remove('navigation-active', 'active');
            const parentLi = btn.closest('.nav-item') || btn.parentElement;
            if (parentLi) parentLi.classList.remove('navigation-active', 'active');
        }
    });

    // Активація натиснутої кнопки
    const activeBtn = document.getElementById(activeBtnId);
    if (activeBtn) {
        activeBtn.classList.add('navigation-active', 'active');
        const parentLi = activeBtn.closest('.nav-item') || activeBtn.parentElement;
        if (parentLi) parentLi.classList.add('navigation-active', 'active');
    }

    // Приховування всіх існуючих секцій сторінки
    document.querySelectorAll('.content-section, section, .page-section').forEach(sec => {
        sec.classList.remove('active-section', 'section-active', 'active');
        sec.style.display = 'none'; 
    });

    // Показ обраної секції в інтерфейсі
    const targetSec = document.getElementById(targetSectionId);
    if (targetSec) {
        targetSec.style.setProperty('display', 'block', 'important'); 
        targetSec.classList.add('active-section', 'section-active');   
    }

    // Асинхронне фонове завантаження даних
    setTimeout(async () => {
        try {
            if (targetSectionId === 'dashboard-sec') {
                if (typeof loadDashboardData === 'function') await loadDashboardData(studentUserId);
            } else if (targetSectionId === 'grades-sec') {
                if (typeof loadGradesData === 'function') await loadGradesData(studentUserId);
            } else if (targetSectionId === 'schedule-sec') {
                if (typeof window.loadScheduleData === 'function') await window.loadScheduleData(currentScheduleDate);
            }
            
            // Адаптація розмірів графіків Chart.js при поверненні на дашборд
            if (targetSectionId === 'dashboard-sec') {
                if (window.charts?.line?.ctx) window.charts.line.resize();
                if (window.charts?.pie?.ctx) window.charts.pie.resize();
                if (window.charts?.bar?.ctx) window.charts.bar.resize();
                if (window.charts?.doughnut?.ctx) window.charts.doughnut.resize();
            }
        } catch (e) {
            console.error(`Помилка оновлення секції ${targetSectionId}:`, e);
        }
    }, 30);
}
