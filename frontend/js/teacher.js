const BASE_URL = window.API_URL || 'https://caring-respect-production-c61c.up.railway.app/api';

// Розклад дзвінків
window.LESSON_MAP = {
    1: ["08:30", "09:50"],
    2: ["10:00", "11:20"],
    3: ["11:40", "13:00"],
    4: ["13:20", "14:40"]
};
const TEACHER_LESSON_MAP = window.LESSON_MAP;

// Ініціалізація глобальних графіків
if (typeof window.charts === 'undefined') {
    window.charts = { line: null, pie: null, bar: null, doughnut: null };
}

// Сесійні дані викладача
let teacherUserId = window.state?.user?.id || 1; 
let currentTeacherData = null;

// Поточна дата розкладу
let currentScheduleDate = window.state?.currentScheduleDate ? new Date(window.state.currentScheduleDate) : new Date();
let selectedJournalSubjectId = null;
let selectedJournalGroupId = null;
let localMatrixDates = [];

// Локальний стан пошуку та студентів
let globalSearchTimeout = null;
let currentGroupStudentsData = []; 

// Екранування HTML від XSS атак
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Створюємо глобальний синонім, який викликає таблиця дашборду
const safeEscapeHtml = escapeHtml;

// Скорочення типів занять
const WORK_TYPE_MAP = {
    'Пара': 'Пара',
    'Лекція': 'Лекц.',
    'Практична': 'Пр.',
    'Лабораторна': 'ЛР',
    'Контрольна': 'МКР',
    'Іспит': 'Ісп/Зл'
};

// Конвертація типу заняття для фронтенду
function mapWorkTypeToFrontend(type) {
    if (!type) return 'Пара';
    const t = String(type).trim();
    if (t === 'Екзамен' || t === 'іспит') return 'Іспит';
    if (t === 'Модуль' || t === 'контрольна') return 'Контрольна';
    return t;
}

// Конвертація типу заняття для бази даних
function mapWorkTypeToBackend(type) {
    if (!type) return 'Пара';
    const t = String(type).trim();
    if (t === 'Іспит') return 'Екзамен';
    if (t === 'Контрольна') return 'Модуль';
    return t;
}

// Отримання заголовків з JWT токеном
function getAuthHeaders() {
    const token = window.state?.token || localStorage.getItem('token') || '';
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// Головна ініціалізація модуля викладача
window.initTeacherModule = async function(user) {
    console.log("👨‍🏫 Модуль викладача успішно ініціалізовано.");
    if (user && user.id) {
        teacherUserId = user.id;
    }
    
    // Завантаження профілю
    await loadTeacherProfile(teacherUserId);
    
    // Перехоплення та оптимізація навігації
    if (!window.originalShowSection) {
        window.originalShowSection = window.showSection;
        
        let currentActiveSection = 'dashboard-sec';
        
        window.showSection = async function(sectionId, isFirstInit = false) {
            // Очищення сесії журналу при виході
            if (currentActiveSection === 'journal-sec' && sectionId !== 'journal-sec') {
                if (typeof destroyJournalSession === 'function') {
                    destroyJournalSession();
                }
            }

            currentActiveSection = sectionId;

            if (typeof window.originalShowSection === 'function') {
                window.originalShowSection(sectionId, isFirstInit);
            }
            
            // Ліниве завантаження даних для секцій
            if (sectionId === 'dashboard-sec') {
                if (typeof loadDashboardData === 'function') await loadDashboardData(teacherUserId);
            } else if (sectionId === 'journal-sec') {
                if (typeof initJournalSection === 'function') await initJournalSection();
                restorePremiumPlaceholders(); 
            } else if (sectionId === 'students-sec') {
                if (typeof initStudentsSection === 'function') await initStudentsSection();
                restorePremiumPlaceholders();
            } else if (sectionId === 'schedule-sec') {
                if (typeof window.loadTeacherSchedule === 'function') {
                    const checkDate = window.state?.currentScheduleDate ? new Date(window.state.currentScheduleDate) : new Date();
                    await window.loadTeacherSchedule(checkDate);
                }
            }
        };
    }

    // Ініціалізація посилань меню
    if (typeof initNavigationMenuLinks === 'function') {
        initNavigationMenuLinks();
    }

    // Запуск головного дашборду
    if (typeof loadDashboardData === 'function') {
        await loadDashboardData(teacherUserId);
    }
};

// Візуалізація заглушок преміум дизайну
function restorePremiumPlaceholders() {
    // Генератор HTML шаблону заглушки
    function createTemplate(icon, title, description) {
        return `
<div style="padding:48px 24px; text-align:center; background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);">
    <div class="edu-pure-float" style="background:linear-gradient(135deg,#e0e7ff 0%,#c7d2fe 100%); width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 16px; box-shadow:0 8px 18px -4px rgba(99,102,241,.2);">
        <i class="fa-solid ${icon}" style="font-size:22px; color:#4f46e5;"></i>
    </div>
    <h4 style="font-size:16px; font-weight:800; color:#0f172a; margin:0 0 8px;">${title}</h4>
    <p style="font-size:13px; color:#64748b; max-width:480px; margin:0 auto; line-height:1.5; font-weight:500;">${description}</p>
</div>`;
    }

    //  для журналу успішності
    const journalPlaceholder = document.getElementById('journal-placeholder');
    if (journalPlaceholder) {
        journalPlaceholder.innerHTML = createTemplate(
            'fa-folder-open',
            'Модуль обліку та аналітики успішності',
            'Будь ласка, оберіть активну дисципліну та academia групу для перегляду списку та виставлення поточних оцінок чи відвідуваності.'
        );
    }

    //  для списку студентів
    const studentsPlaceholder = document.getElementById('students-placeholder');
    if (studentsPlaceholder) {
        studentsPlaceholder.innerHTML = createTemplate(
            'fa-user-graduate',
            'Модуль перегляду списків студентів',
            'Будь ласка, оберіть академічну групу або скористайтеся пошуком для перегляду детальної аналітики успішності та пропусків студентів.'
        );
    }
}

// Завантаження профілю викладача
async function loadTeacherProfile(userId) {
    try {
        const res = await fetch(`${BASE_URL}/teacher/by-user/${userId}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Профіль викладача не знайдено');
        
        currentTeacherData = await res.json();
        
        const nameEl = document.getElementById('teacher-name');
        const degreeEl = document.getElementById('teacher-degree');
        
        // Виведення повного імені викладача
        if (nameEl && currentTeacherData) {
            const firstName = currentTeacherData.first_name || '';
            const lastName = currentTeacherData.last_name || '';
            const middleName = currentTeacherData.middle_name || ''; 
            
            nameEl.textContent = `${lastName} ${firstName} ${middleName}`.replace(/\s+/g, ' ').trim();
            nameEl.classList.remove('skeleton-text');
        }
        
        // Виведення посади та кафедри
        if (degreeEl && currentTeacherData) {
            const positionText = currentTeacherData.position || currentTeacherData.degree || 'Викладач';
            const deptText = currentTeacherData.department_short || '-';
            degreeEl.textContent = `Посада: ${positionText} (${deptText})`;
        }
    } catch (err) {
        console.error("❌ Помилка завантаження профілю викладача:", err);
    }
}

// Граматичне форматування кількості пар
function formatMissedLessons(count) {
    const n = Math.abs(count) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return `${count} пар`;
    if (n1 > 1 && n1 < 5) return `${count} пари`; 
    if (n1 === 1) return `${count} пара`;
    return `${count} пар`;
}

// Форматування кількості пропущених занять
function safeFormatMissedLessons(lessons) {
    const num = parseInt(lessons, 10) || 0;
    if (num === 0) return '0 занять';
    if (num === 1) return '1 заняття';
    if (num >= 2 && num <= 4) return `${num} заняття`;
    return `${num} занять`;
}

// Створення кругового графіка успішності
function buildPerformancePieChart(stats) {
    const canvas = document.getElementById('studentPerformancePieChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    if (!window.charts) window.charts = {};
    if (window.charts.performancePie) window.charts.performancePie.destroy();

    const dataValues = [
        stats.excelent_count ?? 0,
        stats.good_count ?? 0,
        stats.satisfactory_count ?? 0,
        stats.fail_count ?? 0
    ];
    const totalStudents = dataValues.reduce((a, b) => a + b, 0);

    window.charts.performancePie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Відмінно (90-100)', 'Добре (74-89)', 'Задовільно (60-73)', 'Незадовільно (<60)'],
            datasets: [{
                data: dataValues,
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'],
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { boxWidth: 12, padding: 12, font: { family: 'Inter, sans-serif', size: 11, weight: 500 }, color: '#334155' }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    callbacks: {
                        label: function(context) {
                            const value = context.raw || 0;
                            const percent = totalStudents > 0 ? Math.round((value / totalStudents) * 100) : 0;
                            return ` ${context.label}: ${value} чол. (${percent}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

// Створення горизонтального графіка груп
function buildTeacherGroupsChart(teacherGroups) {
    const canvas = document.getElementById('teacherGroupsBarChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    if (!window.charts) window.charts = {};
    if (window.charts.teacherGroupsBar) window.charts.teacherGroupsBar.destroy();

    if (!teacherGroups || teacherGroups.length === 0) {
        ctx.font = "14px Inter, sans-serif";
        ctx.fillStyle = "#64748b";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Активні групи відсутні", canvas.width / 2, canvas.height / 2);
        return;
    }

    // Генерація підписів до графіка
    const labels = teacherGroups.map(g => {
        const subj = g.subject_name || '';
        const shortSubj = subj.length > 12 ? subj.substring(0, 10) + '...' : subj;
        return `${g.group_name || 'Група'} (${shortSubj})`;
    });
    const counts = teacherGroups.map(g => parseInt(g.students_count || 0, 10));

    window.charts.teacherGroupsBar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Студентів у групі',
                data: counts,
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                borderColor: '#10b981',
                borderWidth: 1.5,
                borderRadius: 4,
                barPercentage: 0.6
            }]
        },
        options: {
            indexAxis: 'y', 
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            return `Група: ${teacherGroups[index].group_name} ➔ Дисципліна: ${teacherGroups[index].subject_name}`;
                        },
                        label: function(context) {
                            return ` Кількість: ${context.parsed.x} студентів`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#64748b', stepSize: 5 }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#1e293b', font: { weight: 500, size: 11 } }
                }
            }
        }
    });
}

// Створення лінійного комбінованого графіка аналітики
function buildTeacherAnalyticsChart(chartData) {
    const canvas = document.getElementById('teacherAnalyticsChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    if (!window.charts) window.charts = {};
    if (window.charts.teacherLine) window.charts.teacherLine.destroy();

    if (!chartData || chartData.length === 0) {
        ctx.font = "14px Inter, sans-serif";
        ctx.fillStyle = "#64748b";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Аналітичні відомості відсутні", canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = chartData.map(d => {
        const subject = d.subject_name || '';
        const shortSubject = subject.length > 14 ? subject.substring(0, 12) + '...' : subject;
        return [d.group_name || 'Група', `[${shortSubject}]`]; 
    });
    
    const scores = chartData.map(d => Number(d.avg_score || 0));
    const attendance = chartData.map(d => Number(d.attendance_pct || 0));

    window.charts.teacherLine = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Середній рейтинговий бал',
                    data: scores,
                    borderColor: '#4f46e5', 
                    backgroundColor: 'rgba(79, 70, 229, 0.03)',
                    borderWidth: 3,
                    tension: 0.35,
                    pointBackgroundColor: '#4f46e5',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    yAxisID: 'y' 
                },
                {
                    label: 'Відсоток присутності на заняттях',
                    data: attendance,
                    borderColor: '#10b981', 
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    tension: 0.35,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    yAxisID: 'y1' 
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1200, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 10, usePointStyle: true, pointStyle: 'circle', padding: 20, font: { family: 'Inter, sans-serif', size: 12, weight: 500 } }
                },
                tooltip: {
                    padding: 12,
                    backgroundColor: '#0f172a',
                    titleFont: { family: 'Inter, sans-serif', size: 13, weight: 600 },
                    bodyFont: { family: 'Inter, sans-serif', size: 13 },
                    boxPadding: 6,
                    usePointStyle: true,
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            const item = chartData[index];
                            return `Група: ${item.group_name || ''} ➔ ${item.subject_name || ''}`;
                        },
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return ` Академічний успіх: ${context.parsed.y} / 100 балів`;
                            }
                            return ` Відвідуваність: ${context.parsed.y}%`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'Оцінка успішності', color: '#4f46e5', font: { weight: 600, size: 11 } },
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#64748b' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'Присутність (%)', color: '#10b981', font: { weight: 600, size: 11 } },
                    grid: { drawOnChartArea: false }, 
                    ticks: { 
                        color: '#64748b',
                        callback: function(value) { return value + '%'; }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#475569', font: { size: 10, weight: 500 }, maxRotation: 0, minRotation: 0 }
                }
            }
        }
    });
}

// Завантаження аналітичних даних дашборду
async function loadDashboardData(userId) {
    try {
        const res = await fetch(`${BASE_URL}/teacher/${userId}/analytics`, { 
            headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : {} 
        });
        
        if (!res.ok) throw new Error('Помилка сервера при отриманні аналітики');
        const data = await res.json();

        const metrics = data.metrics || {};
        const riskStudentsDetailed = data.riskStudentsDetailed || [];
        const subjectAttendance = data.subjectAttendance || [];
        const chartData = data.chartData || [];
        const performanceStats = data.performanceStats || {};
        const teacherGroups = data.teacherGroups || [];

        // Оновлення карток метрик
        if (document.getElementById('metric-subjects-count')) document.getElementById('metric-subjects-count').textContent = metrics.subjects_count ?? 0;
        if (document.getElementById('metric-groups-count')) document.getElementById('metric-groups-count').textContent = metrics.groups_count ?? 0;
        if (document.getElementById('metric-gpa-total')) document.getElementById('metric-gpa-total').textContent = metrics.avg_grade ? Number(metrics.avg_grade).toFixed(1) : '0.0';
        if (document.getElementById('metric-risk-count')) document.getElementById('metric-risk-count').textContent = metrics.risk_students ?? 0;

        // Візуалізація графіків
        buildPerformancePieChart(performanceStats);
        buildTeacherGroupsChart(teacherGroups);

        // Візуалізація великого графіка успішності
        const graphContainer = document.getElementById('subjects-performance-dashboard');
        if (graphContainer) {
            graphContainer.innerHTML = `<div style="position:relative; height:300px; width:100%;"><canvas id="teacherAnalyticsChart"></canvas></div>`;
            buildTeacherAnalyticsChart(chartData);
        }

        // Візуалізація таблиці студентів групи ризику
        const riskTbody = document.getElementById('dashboard-risk-students-list');
        if (riskTbody) {
            if (riskStudentsDetailed.length > 0) {
                riskTbody.innerHTML = riskStudentsDetailed.map(student => {
                    const avgGrade = Number(student.avg_grade || 0);
                    const missedLessons = parseInt(student.missed_lessons || 0, 10);
                    
                    const gradeBadgeStyle = avgGrade < 60 
                        ? 'background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 6px; font-weight: 700;' 
                        : 'background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 6px; font-weight: 700;';
                    
                    let missBadgeStyle = 'padding: 4px 10px; border-radius: 20px; font-weight: 600; font-size: 12px; white-space: nowrap; display: inline-block;';
                    if (missedLessons === 0) {
                        missBadgeStyle += ' background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0;';
                    } else if (missedLessons < 3) {
                        missBadgeStyle += ' background: #fff7ed; color: #ea580c; border: 1px solid #ffedd5;';
                    } else {
                        missBadgeStyle += ' background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; font-weight: 700;';
                    }
                    
                    return `
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 11px 8px; font-weight: 500; color: #1e293b;">${safeEscapeHtml(student.student_name)}</td>
                            <td style="padding: 11px 8px; color: #64748b;"><span style="background: #e0f2fe; color: #0369a1; padding: 3px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap;">${safeEscapeHtml(student.group_name)}</span></td>
                            <td style="padding: 11px 8px; color: #334155; font-size: 13px;">${safeEscapeHtml(student.subject_name)}</td>
                            <td style="padding: 11px 8px; text-align: center;"><span style="${gradeBadgeStyle}">${avgGrade.toFixed(0)}</span></td>
                            <td style="padding: 11px 8px; text-align: center; vertical-align: middle;"><span style="${missBadgeStyle}">${safeFormatMissedLessons(missedLessons)}</span></td>
                        </tr>`;
                }).join('');
            } else {
                riskTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color: #16a34a; font-weight:500;">Усі студенти мають гарну успішність!</td></tr>';
            }
        }

        // Візуалізація таблиці статистики відвідуваності
        const attendanceTbody = document.getElementById('dashboard-attendance-subjects-list');
        if (attendanceTbody) {
            if (subjectAttendance.length > 0) {
                attendanceTbody.innerHTML = subjectAttendance.map(row => {
                    let pct = Math.round(Number(row.attendance_pct || 0));
                    let pctStyle = pct < 85 ? 'background: #fee2e2; color: #dc2626; border: 1px solid #fecaca;' : pct < 90 ? 'background: #fff7ed; color: #ea580c; border: 1px solid #ffedd5;' : 'background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;';
                    return `
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 12px 8px; color: #334155; font-weight: 500;">${safeEscapeHtml(row.subject_name)}</td>
                            <td style="padding: 12px 8px;"><span style="background: #f5f3ff; color: #6d28d9; padding: 3px 6px; border-radius: 4px; font-size: 12px; font-weight: 600;">${safeEscapeHtml(row.group_name)}</span></td>
                            <td style="padding: 12px 8px; text-align: center;"><span style="${pctStyle} padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 13px;">${pct}%</span></td>
                        </tr>`;
                }).join('');
            } else {
                attendanceTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#64748b;">Дані про відвідуваність відсутні</td></tr>';
            }
        }

    } catch (err) {
        console.error("❌ Помилка завантаження дашборду:", err);
    }
}
// Динамічний електронний журнал успішності
async function renderJournalTable() {
    const wrapper = document.getElementById('journal-table-wrapper');
    
    const token = (typeof window.state !== 'undefined' && window.state?.token) ? window.state.token : (localStorage.getItem('token') || '');
    const currentUserId = (typeof window.state !== 'undefined' && window.state?.user?.id) ? window.state.user.id : (localStorage.getItem('userId') || '');
    const apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : (typeof BASE_URL !== 'undefined' ? BASE_URL : '');

    if (!wrapper || !selectedJournalGroupId || !selectedJournalSubjectId) return;

    // Лоадер під час завантаження
    wrapper.innerHTML = `
        <div style="padding: 40px 16px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); width: 100%; box-sizing: border-box; border: 1px solid #e2e8f0; border-radius: 12px;">
            <div style="background: #f1f5f9; width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 6px 14px -4px rgba(100, 116, 139, 0.2); box-sizing: border-box;">
                <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 18px; color: #4f46e5;"></i>
            </div>
            <h4 style="font-size: 14px; color: #0f172a; font-weight: 800; margin: 0 0 6px 0;">Синхронізація даних</h4>
            <p style="font-weight: 500; font-size: 12px; color: #64748b; margin: 0;">Отримання поточної matrix успішності з сервера...</p>
        </div>
    `;

    try {
        const dateFromEl = document.getElementById('journal-date-from');
        const dateToEl = document.getElementById('journal-date-to');
        const dateFrom = dateFromEl ? dateFromEl.value : '';
        const dateTo = dateToEl ? dateToEl.value : '';

        let queryUrl = `${apiUrl}/teacher/journal/matrix?groupId=${selectedJournalGroupId}&subjectId=${selectedJournalSubjectId}&userId=${currentUserId}`;
        if (dateFrom) queryUrl += `&dateFrom=${dateFrom}`;
        if (dateTo) queryUrl += `&dateTo=${dateTo}`;

        const res = await fetch(queryUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        localMatrixDates = data.dates || [];
        const students = data.students || [];
        
        const dNow = new Date();
        const todayIso = `${dNow.getFullYear()}-${String(dNow.getMonth() + 1).padStart(2, '0')}-${String(dNow.getDate()).padStart(2, '0')}`;

        // Попередження, якщо за вказаний період немає занять
        if (!localMatrixDates || localMatrixDates.length === 0) {
            wrapper.innerHTML = `
                <div style="padding: 40px 16px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #fffbeb 100%); width: 100%; box-sizing: border-box; border: 1px solid #fef3c7; border-radius: 12px;">
                    <div style="background: #fef3c7; width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 6px 14px -4px rgba(245, 158, 11, 0.2); box-sizing: border-box;">
                        <i class="fa-solid fa-calendar-xmark" style="font-size: 18px; color: #d97706;"></i>
                    </div>
                    <h4 style="font-size: 14px; color: #92400e; font-weight: 800; margin: 0 0 6px 0;">Заняття відсутні</h4>
                    <p style="font-size: 12px; color: #b45309; max-width: 440px; margin: 0 auto; line-height: 1.4; font-weight: 500;">
                        За вказаний період дат не знайдено жодного заняття з цієї дисципліни. Будь ласка, перевірте правильність встановлених фільтрів дат «З» та «По».
                    </p>
                </div>
            `;
            return;
        }

        // Помилка, якщо група порожня
        if (!students || students.length === 0) {
            wrapper.innerHTML = `
                <div style="padding: 40px 16px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #fef2f2 100%); width: 100%; box-sizing: border-box; border: 1px solid #fee2e2; border-radius: 12px;">
                    <div style="background: #fee2e2; width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 6px 14px -4px rgba(239, 68, 68, 0.2); box-sizing: border-box;">
                        <i class="fa-solid fa-users-slash" style="font-size: 18px; color: #ef4444;"></i>
                    </div>
                    <h4 style="font-size: 14px; color: #991b1b; font-weight: 800; margin: 0 0 6px 0;">Увага: Порожня група</h4>
                    <p style="font-size: 12px; color: #ef4444; max-width: 440px; margin: 0 auto; line-height: 1.4; font-weight: 500;">У базі даних до цієї групи не прив'язано жодного активного студента!</p>
                </div>
            `;
            return;
        }

        let headerHTML = `
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 600; height: 52px;">
                <th style="padding: 12px 8px; width: 45px; min-width: 45px; max-width: 45px; text-align: center; border-right: 1px solid #e2e8f0; box-sizing: border-box;">№</th>
                <th style="padding: 12px 16px; width: 260px; min-width: 260px; max-width: 260px; border-right: 2px solid #e2e8f0; position: sticky; left: 0; background: #f8fafc; z-index: 3; text-align: left; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">ПІБ Студента</th>
        `;

        localMatrixDates.forEach(date => {
            const parts = date.split('-');
            const formattedDate = parts.length === 3 ? `${parts[2]}.${parts[1]}` : date;
            const isToday = (date === todayIso);
            headerHTML += `
                <th style="padding: 8px; text-align: center; width: 85px; min-width: 85px; max-width: 85px; border-right: 1px solid #e2e8f0; font-size: 13px; background: ${isToday ? '#eef2ff' : '#f8fafc'}; box-sizing: border-box;">
                    <div style="color: ${isToday ? '#4f46e5' : '#1e293b'}; font-weight: 700; white-space: nowrap;">${formattedDate}</div>
                </th>
            `;
        });
        headerHTML += `</tr>`;

        let rowsHTML = students.map((student, idx) => {
            let cellsHTML = '';
            localMatrixDates.forEach(date => {
                const dayInfo = student.history ? (student.history[date] || { grade: '', attendance: '', work_type: 'Пара' }) : { grade: '', attendance: '', work_type: 'Пара' };
                
                let cellBg = '#fff';
                let initialValue = dayInfo.grade;

                const att = dayInfo.attendance ? dayInfo.attendance.toUpperCase() : '';
                if (att === 'Н' || att === 'ВІДСУТНІЙ' || att === 'N') { 
                    cellBg = '#fef2f2'; 
                    initialValue = 'Н'; 
                } else if (att === 'З' || att === 'ЗП' || att === 'ЗАПІЗНЕННЯ') { 
                    cellBg = '#fffbeb'; 
                    initialValue = dayInfo.grade ? `${dayInfo.grade} (З)` : 'З'; 
                }

                let selectedWorkType = mapWorkTypeToFrontend(dayInfo.work_type);

                cellsHTML += `
                    <td style="padding: 6px 4px; text-align: center; width: 85px; min-width: 85px; max-width: 85px; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; background: ${cellBg}; transition: background-color 0.2s; box-sizing: border-box; overflow: hidden;" 
                        data-student-id="${student.student_id || student.id}" data-date="${date}">
                        
                        <input type="text" class="matrix-grade-input" value="${initialValue || ''}" placeholder="—"
                            style="width: 100%; max-width: 44px; padding: 4px 2px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; font-weight: 700; color: #1e293b; outline: none; font-size: 12px; height: 26px; box-sizing: border-box; display: inline-block; vertical-align: middle;">
                        
                        <select class="matrix-work-select" style="display: block; margin: 5px auto 0; width: 100%; max-width: 76px; font-size: 10px; font-weight: 600; color: #64748b; background: #f1f5f9; border: none; border-radius: 4px; padding: 2px; cursor: pointer; text-align: center; box-sizing: border-box;">
                            <option value="Пара" ${selectedWorkType === 'Пара' ? 'selected' : ''}>Пара</option>
                            <option value="Лекція" ${selectedWorkType === 'Лекція' ? 'selected' : ''}>Лекція</option>
                            <option value="Практична" ${selectedWorkType === 'Практична' ? 'selected' : ''}>Практ.</option>
                            <option value="Лабораторна" ${selectedWorkType === 'Лабораторна' ? 'selected' : ''}>Лаб.</option>
                            <option value="Контрольна" ${selectedWorkType === 'Контрольна' ? 'selected' : ''}>Контр.</option>
                            <option value="Іспит" ${selectedWorkType === 'Іспит' ? 'selected' : ''}>Іспит</option>
                        </select>
                    </td>
                `;
            });

            return `
                <tr style="background: #fff; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">
                    <td style="padding: 10px 4px; width: 45px; min-width: 45px; max-width: 45px; text-align: center; background: #f8fafc; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500; font-size: 12px; box-sizing: border-box;">${idx + 1}</td>
                    <td style="padding: 10px 16px; width: 260px; min-width: 260px; max-width: 260px; border-right: 2px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; position: sticky; left: 0; background: #fff; z-index: 2; box-shadow: 2px 0 5px -2px rgba(0,0,0,0.05); box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        <span style="color: #1e293b; font-weight: 600; font-size: 13px;" title="${escapeHtml(student.last_name)} ${escapeHtml(student.first_name)}">
                            ${escapeHtml(student.last_name)} ${escapeHtml(student.first_name)}
                        </span>
                    </td>
                    ${cellsHTML}
                </tr>
            `;
        }).join('');

        wrapper.innerHTML = `
            <div style="overflow-x: auto; max-width: 100%; width: 100%; box-sizing: border-box; background: #fff;-webkit-overflow-scrolling: touch;">
                <table style="width: 100%; min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; table-layout: fixed;">
                    <thead>${headerHTML}</thead>
                    <tbody>${rowsHTML}</tbody>
                </table>
            </div>
            <div style="padding: 16px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; align-items: center; gap: 24px; font-size: 12px; color: #64748b; font-weight: 500; width: 100%; box-sizing: border-box;">
                <div><span style="display: inline-block; width: 12px; height: 12px; background: #fee2e2; border-radius: 3px; border: 1px solid #fca5a5; vertical-align: middle; margin-right: 6px;"></span> <b>Н</b> — Відсутній</div>
                <div><span style="display: inline-block; width: 12px; height: 12px; background: #fef3c7; border-radius: 3px; border: 1px solid #fde68a; vertical-align: middle; margin-right: 6px;"></span> <b>З</b> — Запізнення</div>
                <div id="save-status-indicator" style="margin-left: auto; font-weight: 600; color: #10b981; transition: color 0.2s;">
                    <i class="fa-solid fa-cloud"></i> Журнал синхронізовано з хмарою
                </div>
            </div>
        `;

        const statusIndicator = document.getElementById('save-status-indicator');

        const saveCellData = async (cell) => {
            const studentId = cell.getAttribute('data-student-id');
            const date = cell.getAttribute('data-date');
            const inputField = cell.querySelector('.matrix-grade-input');
            const inputVal = inputField ? inputField.value.trim() : '';
            const selectField = cell.querySelector('.matrix-work-select');
            
            let frontendWorkType = selectField ? selectField.value : 'Пара';
            let attendanceStatus = 'Присутній';
            let grade = null;

            if (inputVal.toUpperCase() === 'Н' || inputVal.toUpperCase() === 'N') {
                attendanceStatus = 'Відсутній';
                cell.style.backgroundColor = '#fef2f2'; 
            } else if (inputVal.toUpperCase() === 'З' || inputVal.toUpperCase().includes('(З)') || inputVal.toUpperCase().endsWith(' З')) {
                attendanceStatus = 'Запізнення';
                cell.style.backgroundColor = '#fffbeb'; 
                const cleanGrade = parseInt(inputVal.replace(/[^\d]/g, ''), 10);
                if (!isNaN(cleanGrade)) grade = cleanGrade;
            } else if (inputVal !== '') {
                const parsedGrade = parseInt(inputVal, 10);
                if (!isNaN(parsedGrade)) {
                    grade = parsedGrade;
                    cell.style.backgroundColor = '#fff';
                } else {
                    if (inputField) inputField.value = '';
                    cell.style.backgroundColor = '#fff';
                }
            } else {
                cell.style.backgroundColor = '#fff';
            }

            if (!currentUserId) {
                if (statusIndicator) {
                    statusIndicator.style.color = '#ef4444';
                    statusIndicator.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Помилка: Сесія застаріла.`;
                }
                return;
            }

            let dbWorkType = mapWorkTypeToBackend(frontendWorkType);

            try {
                const response = await fetch(`${apiUrl}/teacher/journal/save`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        studentId: parseInt(studentId, 10),
                        subjectId: parseInt(selectedJournalSubjectId, 10),
                        userId: parseInt(currentUserId, 10),
                        date: date,
                        grade: grade, 
                        work_type: dbWorkType, 
                        attendanceStatus: attendanceStatus,
                        scheduleId: null 
                    })
                });

                const resData = await response.json();
                if (!response.ok) throw new Error(resData.error || 'Помилка сервера');

            } catch (err) {
                console.error("Помилка автозбереження клітинки:", err);
                throw err;
            }
        };

        wrapper.querySelectorAll('.matrix-grade-input').forEach(input => {
            input.addEventListener('blur', async () => {
                if (statusIndicator) {
                    statusIndicator.style.color = '#eab308';
                    statusIndicator.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Збереження...`;
                }
                try {
                    await saveCellData(input.parentElement);
                    if (statusIndicator) {
                        statusIndicator.style.color = '#10b981';
                        statusIndicator.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Зміни зафіксовано`;
                    }
                    if (typeof updateTeacherCharts === 'function') updateTeacherCharts();
                    if (typeof window.loadTeacherSchedule === 'function' && window.currentScheduleDate) {
                        window.loadTeacherSchedule(window.currentScheduleDate);
                    }
                } catch (e) {
                    if (statusIndicator) {
                        statusIndicator.style.color = '#ef4444';
                        statusIndicator.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Помилка: ${e.message}`;
                    }
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
        });

        wrapper.querySelectorAll('.matrix-work-select').forEach(select => {
            select.addEventListener('change', async () => {
                const currentCell = select.parentElement;
                const targetDate = currentCell.getAttribute('data-date');
                const newWorkType = select.value;

                if (statusIndicator) {
                    statusIndicator.style.color = '#eab308';
                    statusIndicator.innerHTML = `<i class="fa-solid fa-shuffle fa-spin"></i> Оновлення пари...`;
                }

                const sameDateCells = wrapper.querySelectorAll(`td[data-date="${targetDate}"]`);
                sameDateCells.forEach(cell => {
                    const cellSelect = cell.querySelector('.matrix-work-select');
                    if (cellSelect) cellSelect.value = newWorkType;
                });

                try {
                    const savePromises = Array.from(sameDateCells).map(cell => saveCellData(cell));
                    await Promise.all(savePromises);

                    if (statusIndicator) {
                        statusIndicator.style.color = '#10b981';
                        statusIndicator.innerHTML = `<i class="fa-solid fa-users-gear"></i> Тип "${newWorkType}" застосовано`;
                    }
                    if (typeof updateTeacherCharts === 'function') updateTeacherCharts();
                    if (typeof window.loadTeacherSchedule === 'function' && window.currentScheduleDate) {
                        await window.loadTeacherSchedule(window.currentScheduleDate);
                    }
                } catch (err) {
                    if (statusIndicator) {
                        statusIndicator.style.color = '#ef4444';
                        statusIndicator.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Помилка: ${err.message}`;
                    }
                }
            });
        });

    } catch (err) {
        console.error(err);
        wrapper.innerHTML = `
            <div style="padding: 40px 16px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #fef2f2 100%); width: 100%; box-sizing: border-box; border: 1px solid #fee2e2; border-radius: 12px;">
                <div style="background: #fee2e2; width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 6px 14px -4px rgba(239, 68, 68, 0.2); box-sizing: border-box;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 18px; color: #ef4444;"></i>
                </div>
                <h4 style="font-size: 14px; color: #991b1b; font-weight: 800; margin: 0 0 6px 0;">Помилка запиту</h4>
                <p style="font-size: 12px; color: #ef4444; max-width: 440px; margin: 0 auto; line-height: 1.4; font-weight: 500;">Не вдалося сформувати відомість. Будь ласка, перевірте з'єднання або спробуйте пізніше.</p>
            </div>
        `;
    }
}

async function initJournalSection() {
    const subSelect = document.getElementById('journal-subject-filter');
    const groupSelect = document.getElementById('journal-group-filter');
    const btnLoad = document.getElementById('btn-load-journal');
    const btnClose = document.getElementById('btn-close-journal');
    const wrapper = document.getElementById('journal-table-wrapper');
    const dateFromEl = document.getElementById('journal-date-from');
    const dateToEl = document.getElementById('journal-date-to');

    if (!subSelect || !groupSelect || !wrapper) return;

    // Завантаження предметів викладача
    if (subSelect.options.length <= 1) {
        try {
            const subRes = await fetch(`${BASE_URL}/teacher/${teacherUserId}/subjects`, {
                headers: getAuthHeaders()
            });
            const teacherSubjects = await subRes.json().catch(() => []);

            subSelect.innerHTML = '<option value="">Оберіть дисципліну з розкладу...</option>';
            if (Array.isArray(teacherSubjects)) {
                teacherSubjects.forEach(subject => {
                    subSelect.insertAdjacentHTML('beforeend', `
                        <option value="${subject.id}">${escapeHtml(subject.name)}</option>
                    `);
                });
            }
        } catch (err) {
            console.error('Помилка завантаження предметів:', err);
        }
    }

    // Динамічна фільтрація груп за предметом
    if (!subSelect.dataset.bound) {
        subSelect.dataset.bound = 'true';
        subSelect.addEventListener('change', async () => {
            const subjectId = subSelect.value;
            groupSelect.innerHTML = '<option value="">Оберіть групу</option>';
            
            if (!subjectId) {
                groupSelect.setAttribute('disabled', 'true');
                return;
            }
            
            groupSelect.innerHTML = '<option value="">Завантаження груп...</option>';
            groupSelect.removeAttribute('disabled');

            try {
                const groupsRes = await fetch(`${BASE_URL}/teacher/${teacherUserId}/groups?subjectId=${encodeURIComponent(subjectId)}`, {
                    headers: getAuthHeaders()
                });
                if (!groupsRes.ok) throw new Error('Помилка завантаження груп');

                const groups = await groupsRes.json();
                groupSelect.innerHTML = '<option value="">Оберіть групу</option>';

                if (!Array.isArray(groups) || groups.length === 0) {
                    groupSelect.innerHTML = '<option value="">Немає доступних груп</option>';
                    return;
                }

                groups.forEach(group => {
                    groupSelect.insertAdjacentHTML('beforeend', `
                        <option value="${group.id}">
                            ${escapeHtml(group.name)} ${group.course ? `(${group.course} курс)` : ''}
                        </option>
                    `);
                });
            } catch (err) {
                console.error('Помилка отримання груп:', err);
                groupSelect.innerHTML = '<option value="">Помилка завантаження</option>';
            }
        });
    }

    // Клік: сформувати журнал
    if (btnLoad && !btnLoad.dataset.bound) {
        btnLoad.dataset.bound = 'true';
        btnLoad.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            selectedJournalSubjectId = subSelect.value;
            selectedJournalGroupId = groupSelect.value;

            if (!selectedJournalSubjectId || !selectedJournalGroupId) {
                const originalAlert = window.alert;
                window.alert = function() { console.warn("Браузерний alert заблоковано!"); };

                wrapper.removeAttribute('style');
                wrapper.innerHTML = `
                    <div style="height: 240px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 24px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #fef2f2 100%); border: 1px solid #fee2e2; width: 100%; box-sizing: border-box; border-radius: 20px; box-shadow: 0 25px 60px -15px rgba(220, 38, 38, 0.05);">
                        <div style="background: #fee2e2; width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; box-shadow: 0 6px 14px -4px rgba(239, 68, 68, 0.2); box-sizing: border-box; flex-shrink: 0;">
                            <i class="fa-solid fa-circle-exclamation" style="font-size: 18px; color: #ef4444;"></i>
                        </div>
                        <h4 style="font-size: 14px; color: #991b1b; font-weight: 800; margin: 0 0 6px 0; line-height: 1.2;">
                            Помилка: Оберіть дисципліну та групу!
                        </h4>
                        <p style="font-size: 12px; color: #ef4444; max-width: 460px; margin: 0 auto; line-height: 1.5; font-weight: 500;">
                            Для формування відомості необхідно обов'язково вказати предмет та академічну групу у випадаючих списках вище.
                        </p>
                    </div>
                `;

                setTimeout(() => { window.alert = originalAlert; }, 100);
                return;
            }
            
            wrapper.removeAttribute('style');
            
            const journalSec = document.getElementById('journal-sec');
            if (journalSec) journalSec.style.display = 'block';

            await renderJournalTable();
        });
    }

    // Клік: закрити журнал та повернути плейсхолдер
    if (btnClose && !btnClose.dataset.bound) {
        btnClose.dataset.bound = 'true';
        btnClose.addEventListener('click', (e) => {
            e.preventDefault();
            
            subSelect.value = "";
            groupSelect.innerHTML = '<option value="">Оберіть спочатку дисципліну</option>';
            groupSelect.setAttribute('disabled', 'true');
            
            if (dateFromEl) dateFromEl.value = "";
            if (dateToEl) dateToEl.value = "";
            
            selectedJournalSubjectId = null;
            selectedJournalGroupId = null;
            if (typeof localMatrixDates !== 'undefined') localMatrixDates = [];

            wrapper.removeAttribute('style');
            wrapper.innerHTML = `
                <div id="journal-placeholder" style="height: 240px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 24px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); border: 1px solid #e2e8f0; box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.06); box-sizing: border-box; width: 100%; border-radius: 20px;">
                    <div class="edu-pure-float style-premium-animate" style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; box-shadow: 0 6px 14px -4px rgba(99, 102, 241, 0.2); box-sizing: border-box; flex-shrink: 0;">
                        <i class="fa-solid fa-folder-open" style="font-size: 18px; color: #4f46e5;"></i>
                    </div>
                    <h4 style="font-size: 14px; color: #0f172a; font-weight: 800; margin: 0 0 6px 0; line-height: 1.2;">Модуль обліку та аналітики успішності</h4>
                    <p style="font-size: 12px; color: #64748b; max-width: 460px; margin: 0 auto; line-height: 1.5; font-weight: 500;">Будь ласка, оберіть активну дисципліну та академічную групу для перегляду списку та виставлення поточних оцінок чи відвідуваності.</p>
                </div>
            `;

            if (typeof showSystemToast === 'function') {
                showSystemToast(`🚪 Відомість успішно закрито`, 'info');
            }
        });
    }

    // Автооновлення при зміні дати фільтрації
    const handleDateChange = async () => {
        if (!selectedJournalSubjectId || !selectedJournalGroupId) return;

        if (selectedJournalSubjectId === subSelect.value && selectedJournalGroupId === groupSelect.value) {
            wrapper.removeAttribute('style');
            await renderJournalTable();
        }
    };

    if (dateFromEl && !dateFromEl.dataset.bound) {
        dateFromEl.dataset.bound = 'true';
        dateFromEl.addEventListener('change', handleDateChange);
    }
    if (dateToEl && !dateToEl.dataset.bound) {
        dateToEl.dataset.bound = 'true';
        dateToEl.addEventListener('change', handleDateChange);
    }
}
// Очищення сесії журналу та скидання фільтрів
function destroyJournalSession() {
    selectedJournalSubjectId = null;
    selectedJournalGroupId = null;
    localMatrixDates = [];

    const btnClose = document.getElementById('btn-close-journal');
    if (btnClose) btnClose.style.display = 'none';

    const wrapper = document.getElementById('journal-table-wrapper');
    if (wrapper) {
        wrapper.removeAttribute('style');
        wrapper.innerHTML = `
            <div id="journal-placeholder" style="height: 240px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 24px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); border: 1px solid #e2e8f0; box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.06); width: 100%; box-sizing: border-box; border-radius: 20px;">
                <div class="edu-pure-float style-premium-animate" style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; box-shadow: 0 6px 14px -4px rgba(99, 102, 241, .2); box-sizing: border-box; flex-shrink: 0;">
                    <i class="fa-solid fa-folder-open" style="font-size: 18px; color: #4f46e5;"></i>
                </div>
                <h4 style="font-size: 14px; font-weight: 800; color: #0f172a; margin: 0 0 6px; line-height: 1.2;">Модуль обліку та аналітики успішності</h4>
                <p style="font-size: 12px; color: #64748b; max-width: 460px; margin: 0 auto; line-height: 1.5; font-weight: 500;">
                    Будь ласка, оберіть активну дисципліну та академічну групу для перегляду списку та виставлення поточних оцінок чи відвідуваності.
                </p>
            </div>
        `;
    }

    const subSelect = document.getElementById('journal-subject-filter');
    const groupSelect = document.getElementById('journal-group-filter');
    
    if (subSelect) subSelect.value = "";
    if (groupSelect) {
        groupSelect.innerHTML = '<option value="">Оберіть спочатку дисципліну</option>';
        groupSelect.setAttribute('disabled', 'true');
    }
}

// Оновлення плейсхолдера студентів
function renderStudentsPlaceholder(title, message) {
    const wrapper = document.getElementById('students-list-wrapper');
    if (!wrapper) return;
    
    wrapper.removeAttribute('style');
    wrapper.innerHTML = `
        <div id="students-placeholder" style="height: 240px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 24px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); border: 1px solid #e2e8f0; box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.06); width: 100%; box-sizing: border-box; border-radius: 20px;">
            <div class="edu-pure-float style-premium-animate" style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; box-shadow: 0 6px 14px -4px rgba(99, 102, 241, .2); box-sizing: border-box; flex-shrink: 0;">
                <i class="fa-solid fa-user-graduate" style="font-size: 18px; color: #4f46e5;"></i>
            </div>
            <h4 style="font-size: 14px; font-weight: 800; color: #0f172a; margin: 0 0 6px; line-height: 1.2;">${title}</h4>
            <p style="font-size: 12px; color: #64748b; max-width: 460px; margin: 0 auto; line-height: 1.5; font-weight: 500;">${message}</p>
        </div>
    `;
}

// Показ скелетона під час завантаження
function renderStudentsSkeletonLoader() {
    const wrapper = document.getElementById('students-list-wrapper');
    if (!wrapper) return;
    
    wrapper.removeAttribute('style');
    wrapper.innerHTML = `
        <div style="height: 240px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 24px; text-align: center; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); border: 1px solid #e2e8f0; box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.06); width: 100%; box-sizing: border-box; border-radius: 20px;">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; margin-bottom: 14px; color: #4f46e5; flex-shrink: 0;"></i>
            <h4 style="font-size: 14px; font-weight: 800; color: #0f172a; margin: 0 0 6px; line-height: 1.2;">Завантаження аналітики</h4>
            <p style="font-size: 12px; color: #64748b; max-width: 460px; margin: 0 auto; line-height: 1.5; font-weight: 500;">
                Будь ласка, зачекайте. Отримуємо актуальний список студентів та підраховуємо успішність...
            </p>
        </div>
    `;
}

// Ініціалізація розділу студентів та слухачів подій
async function initStudentsSection() {
    const subjectSelect = document.getElementById('students-subject-filter');
    const groupSelect = document.getElementById('students-group-filter');
    const searchInput = document.getElementById('students-search-input');
    const clearAllBtn = document.getElementById('btn-clear-all-filters');
    const wrapper = document.getElementById('students-list-wrapper');

    if (!subjectSelect || !groupSelect || !wrapper) return;

    renderStudentsPlaceholder(
        "Списки студентів академічних груп", 
        "Будь ласка, оберіть потрібну дисципліну та академічну групу вище, щоб відобразити актуальний список студентів."
    );

    try {
        subjectSelect.innerHTML = '<option value="">⏳ Завантаження предметів...</option>';
        const res = await fetch(`${BASE_URL}/teacher/${teacherUserId}/subjects`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("Не вдалося отримати предмети з бази даних");
        const subjects = await res.json();

        if (subjects.length === 0) {
            subjectSelect.innerHTML = '<option value="">Немає активних предметів</option>';
            renderStudentsPlaceholder("Розклад порожній", "У базі даних не знайдено активних занять для вашого профілю.");
            return;
        }

        subjectSelect.innerHTML = '<option value="">Оберіть дисципліну...</option>' + 
            subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join(''); 

    } catch (err) {
        console.error("❌ Помилка завантаження предметів:", err);
        subjectSelect.innerHTML = '<option value="">Помилка завантаження даних</option>';
    }

    subjectSelect.addEventListener('change', async () => {
        const subjectId = subjectSelect.value;
        
        currentGroupStudentsData = [];
        groupSelect.innerHTML = '<option value="">Оберіть спочатку дисципліну</option>';
        groupSelect.disabled = true;
        groupSelect.style.background = '#f8fafc';

        if (!subjectId) {
            if (searchInput) searchInput.value = '';
            renderStudentsPlaceholder(
                "Списки студентів academic груп", 
                "Будь ласка, оберіть потрібну дисципліну та академічну групу вище, щоб відобразити актуальний список студентів."
            );
            return;
        }

        groupSelect.disabled = false;
        groupSelect.style.background = '#fff';
        groupSelect.innerHTML = '<option value="">⏳ Завантаження груп з БД...</option>';
        renderStudentsSkeletonLoader();

        try {
            const groupRes = await fetch(`${BASE_URL}/teacher/${teacherUserId}/groups?subjectId=${subjectId}`, { headers: getAuthHeaders() });
            if (!groupRes.ok) throw new Error("Помилка при завантаженні груп");
            const groups = await groupRes.json();

            if (groups.length === 0) {
                groupSelect.innerHTML = '<option value="">Немає груп для цього предмета</option>';
                renderStudentsPlaceholder("Груп не знайдено", "За цим предметом у розкладі не закріплено жодної активної групи.");
                return;
            }

            groupSelect.innerHTML = '<option value="">Оберіть групу...</option>' +
                groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${g.course} курс)</option>`).join('');
            
            renderStudentsPlaceholder("Групу не обрано", "Дисципліну визначено. Тепер оберіть необхідную академічну групу.");

        } catch (err) {
            console.error("❌ Помилка завантаження груп з БД:", err);
            groupSelect.innerHTML = '<option value="">Помилка завантаження груп</option>';
        }
    });

    groupSelect.addEventListener('change', () => {
        const groupId = groupSelect.value;
        const subjectId = subjectSelect.value;

        if (groupId && subjectId) {
            // Очищення стилів обгортки для побудови таблиці
            wrapper.removeAttribute('style');
            
            if (typeof loadStudentsAcademicState === 'function') {
                loadStudentsAcademicState(groupId, subjectId);
            }
        } else {
            renderStudentsPlaceholder("Групу не обрано", "Будь ласка, оберіть академічну групу для перегляду списку студентів.");
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (typeof processSmartSearch === 'function') processSmartSearch();
        });
    }

    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            subjectSelect.value = '';
            groupSelect.value = '';
            groupSelect.disabled = true;
            groupSelect.style.background = '#f8fafc';
            groupSelect.innerHTML = '<option value="">Оберіть спочатку дисципліну</option>';
            
            if (searchInput) searchInput.value = '';
            currentGroupStudentsData = [];
            
            renderStudentsPlaceholder(
                "Списки студентів академічних груп", 
                "Будь ласка, оберіть потрібну дисципліну та академічну групу вище, щоб відобразити актуальний список студентів."
            );
        });
    }
}

// Завантаження успішності групи з бази даних
async function loadStudentsAcademicState(groupId, subjectId) {
    renderStudentsSkeletonLoader();
    try {
        const dateFromEl = document.getElementById('journal-date-from');
        const dateToEl = document.getElementById('journal-date-to');
        
        const dateFrom = dateFromEl ? dateFromEl.value : '';
        const dateTo = dateToEl ? dateToEl.value : '';

        let queryUrl = `${BASE_URL}/teacher/analytics/students-state?groupId=${groupId}&subjectId=${subjectId}`;
        if (dateFrom) queryUrl += `&dateFrom=${dateFrom}`;
        if (dateTo) queryUrl += `&dateTo=${dateTo}`;
        
        const res = await fetch(queryUrl, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("Помилка відповіді сервера");
        
        currentGroupStudentsData = await res.json();
        renderStudentsTableSkeleton(false);
        
        const currentQuery = document.getElementById('students-search-input') ? document.getElementById('students-search-input').value : '';
        renderStudentsTableRows(currentQuery, false);
    } catch (err) {
        console.error("❌ Помилка отримання даних:", err);
        renderStudentsPlaceholder("Помилка завантаження даних", "Не вдалося отримати актуальний список студентів з бази даних.");
    }
}

// Розумний пошук та фільтрація студентів
function processSmartSearch() {
    const searchInput = document.getElementById('students-search-input');
    if (!searchInput) return;
    
    const query = searchInput.value.trim();
    const studentsSubject = document.getElementById('students-subject-filter');
    const studentsGroup = document.getElementById('students-group-filter');
    const journalSubject = document.getElementById('journal-subject-filter');
    const journalGroup = document.getElementById('journal-group-filter');

    const hasActiveStudentsFilter = (studentsSubject && studentsSubject.value && studentsGroup && studentsGroup.value);
    const hasActiveJournalFilter = (journalSubject && journalSubject.value && journalGroup && journalGroup.value);

    if (hasActiveStudentsFilter || hasActiveJournalFilter) {
        renderStudentsTableRows(query, false);
        return;
    }

    if (globalSearchTimeout) clearTimeout(globalSearchTimeout);

    if (query.length === 0) {
        renderStudentsPlaceholder(
            "Списки студентів академічних груп", 
            "Будь ласка, оберіть потрібну дисципліну та академічную групу вище, щоб відобразити актуальний список студентів."
        );
        return;
    }

    globalSearchTimeout = setTimeout(async () => {
        renderStudentsSkeletonLoader();
        
        const apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG?.apiUrl) ? window.CONFIG.apiUrl : (typeof BASE_URL !== 'undefined' ? BASE_URL : '');
        const currentUserId = (typeof window.state !== 'undefined' && window.state?.user?.id) ? window.state.user.id : (localStorage.getItem('userId') || '');
        const authHeaders = typeof getAuthHeaders === 'function' ? getAuthHeaders() : { 'Authorization': `Bearer ${localStorage.getItem('token')}` };

        try {
            const res = await fetch(`${apiUrl}/teacher/${currentUserId}/students/search?query=${encodeURIComponent(query)}`, { headers: authHeaders });
            if (!res.ok) throw new Error("Помилка глобального пошуку");
            
            const rawData = await res.json();
            const groupedStudents = {};
            
            rawData.forEach(item => {
                const sId = item.student_id;
                if (!sId) return;
                
                const itemGrade = item.avg_grade ? parseFloat(item.avg_grade) : null;
                const itemAtt = item.attendance_pct ? parseFloat(item.attendance_pct) : null;
                
                if (!groupedStudents[sId]) {
                    groupedStudents[sId] = { 
                        ...item, 
                        subjects: item.subject_name ? [item.subject_name] : [],
                        _gradesList: itemGrade !== null ? [itemGrade] : [],
                        _attendanceList: itemAtt !== null ? [itemAtt] : []
                    };
                } else {
                    if (item.subject_name && !groupedStudents[sId].subjects.includes(item.subject_name)) {
                        groupedStudents[sId].subjects.push(item.subject_name);
                    }
                    if (itemGrade !== null) groupedStudents[sId]._gradesList.push(itemGrade);
                    if (itemAtt !== null) groupedStudents[sId]._attendanceList.push(itemAtt);
                }
            });

            currentGroupStudentsData = Object.values(groupedStudents).map(student => {
                if (student._attendanceList.length > 0) {
                    const totalAtt = student._attendanceList.reduce((sum, val) => sum + val, 0);
                    student.attendance_pct = totalAtt / student._attendanceList.length;
                } else {
                    student.attendance_pct = 100;
                }

                if (student._gradesList.length > 0) {
                    const totalGrades = student._gradesList.reduce((sum, val) => sum + val, 0);
                    student.avg_grade = totalGrades / student._gradesList.length;
                } else {
                    student.avg_grade = null;
                }
                return student;
            });
            
            renderStudentsTableSkeleton(true); 
            renderStudentsTableRows(query, true);
        } catch (err) {
            console.error("❌ Помилка глобального пошуку:", err);
            renderStudentsPlaceholder("Помилка пошуку", "Не вдалося виконати глобальний запит пошуку.");
        }
    }, 300);
}

// Рендеринг структури адаптивної таблиці
function renderStudentsTableSkeleton(isGlobalMode = false) {
    const wrapper = document.getElementById('students-list-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = `
        <div class="table-responsive-wrapper" style="width: 100%; overflow-x: auto; max-width: 100%; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff;">
            <table style="width:100%; border-collapse:collapse; font-size:14px; text-align:left; min-width: 700px;">
                <thead>
                    <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#64748b; user-select:none;">
                        <th style="padding:16px 20px; font-weight:600;">Студент</th>
                        ${isGlobalMode ? '<th style="padding:16px; font-weight:600;">Група</th>' : ''}
                        ${isGlobalMode ? '<th style="padding:16px; font-weight:600;">Дисципліни викладача</th>' : ''}
                        <th style="padding:16px; font-weight:600;">Email контакти</th>
                        <th style="padding:16px; font-weight:600; text-align:center; width:140px;">Відвідуваність</th>
                        <th style="padding:16px; font-weight:600; text-align:center; width:110px;">Сер. бал</th>
                        <th style="padding:16px; font-weight:600; text-align:center; width:130px;">Статус</th>
                    </tr>
                </thead>
                <tbody id="students-table-body"></tbody>
            </table>
        </div>
    `;
}

// Рендеринг рядків таблиці студентів
function renderStudentsTableRows(filterQuery = '', isGlobalMode = false) {
    const tbody = document.getElementById('students-table-body');
    if (!tbody) return;

    const query = filterQuery.toLowerCase().trim();
    const filtered = isGlobalMode 
        ? currentGroupStudentsData 
        : currentGroupStudentsData.filter(st => 
            `${st.last_name || ''} ${st.first_name || ''}`.toLowerCase().includes(query)
          );

    const totalColumnsCount = isGlobalMode ? 7 : 5;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${totalColumnsCount}" style="padding:40px; text-align:center; color:#94a3b8;">
                    У цій вибірці немає зареєстрованих студентів
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((st) => {
        const fullName = `${st.last_name || 'Студент'} ${st.first_name || ''}`;
        const initials = `${(st.last_name || 'С').charAt(0)}${(st.first_name || 'С').charAt(0)}`.toUpperCase();
        const attPct = Math.round(parseFloat(st.attendance_pct) || 100);
        let attColor = attPct >= 85 ? '#16a34a' : (attPct >= 65 ? '#d97706' : '#ef4444');
        const gpa = st.avg_grade ? parseFloat(st.avg_grade) : null;

        let statusText = 'Немає балів';
        let statusStyle = 'background:#f1f5f9; color:#475569;';
        
        if (gpa > 0) {
            if (gpa >= 90) { statusText = 'Відмінно'; statusStyle = 'background:#dcfce7; color:#15803d;'; }
            else if (gpa >= 75) { statusText = 'Добре'; statusStyle = 'background:#e0f2fe; color:#0369a1;'; }
            else if (gpa >= 60) { statusText = 'Задовільно'; statusStyle = 'background:#fef3c7; color:#b45309;'; }
            else { statusText = 'Незадовільно'; statusStyle = 'background:#fee2e2; color:#b91c1c;'; }
        }

        // Рендеринг фіолетових бейджів для глобального пошуку
        const subjectsHtml = isGlobalMode 
            ? (st.subjects || []).map(sub => `<span style="display:inline-block; background:#e0e7ff; color:#4f46e5; padding:3px 8px; border-radius:6px; font-size:12px; font-weight:600; margin-right:4px; margin-bottom:4px;">${escapeHtml(sub)}</span>`).join('')
            : '';

        return `
        <tr style="border-bottom:1px solid #f1f5f9; background:#fff;">
            <td style="padding:14px 20px;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:36px; height:36px; background:#e0e7ff; color:#4f46e5; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px;">
                        ${initials}
                    </div>
                    <span style="font-weight:600; color:#1e293b;">${escapeHtml(fullName)}</span>
                </div>
            </td>
            ${isGlobalMode ? `<td style="padding:14px 20px;"><span style="background:#f1f5f9; padding:4px 8px; border-radius:6px; font-weight:600; font-size:12px; color:#475569;">${escapeHtml(st.group_name || '—')}</span></td>` : ''}
            ${isGlobalMode ? `<td style="padding:14px 20px; max-width: 280px; white-space: normal;">${subjectsHtml}</td>` : ''}
            <td style="padding:14px 20px; color:#475569; font-size:13px;">${escapeHtml(st.email || '—')}</td>
            <td style="padding:14px 20px; text-align:center;">
                <span style="font-weight:700; color:${attColor};">${attPct}%</span>
            </td>
            <td style="padding:14px 20px; text-align:center; font-weight:700; color:#1e293b;">${gpa ? gpa.toFixed(1) : '—'}</td>
            <td style="padding:14px 20px; text-align:center;">
                <span style="padding:4px 10px; border-radius:12px; font-size:11px; font-weight:600; ${statusStyle}">
                    ${statusText}
                </span>
            </td>
        </tr>
    `;
    }).join('');
}

// Завантаження розкладу викладача з оверлеєм та канікулами
window.loadTeacherSchedule = async function(targetDate = new Date()) {
    const container = document.getElementById('teacher-schedule-container'); 
    if (!container) return;

    container.classList.add('schedule-loading-state');

    const sanitizedDate = new Date(targetDate);
    sanitizedDate.setHours(0, 0, 0, 0); 
    window.currentScheduleDate = sanitizedDate; 

    const tId = typeof teacherUserId !== 'undefined' ? teacherUserId : 
                (window.state?.user?.id || localStorage.getItem('userId') || localStorage.getItem('user_id'));

    if (!tId) {
        console.error("❌ teacherUserId не визначено на сторінці.");
        container.innerHTML = `<div style="color:#ef4444; text-align:center; padding:20px; font-weight:700;">Помилка авторизації: ID викладача відсутній.</div>`;
        return;
    }

    try {
        const weekRange = (typeof getWeekRange === 'function') ? getWeekRange(window.currentScheduleDate) : null;
        const weekInfo = (typeof getWeekType === 'function') ? getWeekType(window.currentScheduleDate) : { text: "Поточний тиждень", code: "numerator" }; 

        if (document.getElementById('schedule-week-range') && weekRange) {
            document.getElementById('schedule-week-range').innerText = `${weekRange.monday.toLocaleDateString('uk-UA')} - ${weekRange.sunday.toLocaleDateString('uk-UA')}`;
        }
        
        const badgeTextEl = document.getElementById('week-type-badge-text') || document.querySelector('#week-type-badge .badge-text');
        if (badgeTextEl) badgeTextEl.innerText = weekInfo.text;

        // Безпечне форматування локальної дати YYYY-MM-DD
        const year = sanitizedDate.getFullYear();
        const month = String(sanitizedDate.getMonth() + 1).padStart(2, '0');
        const day = String(sanitizedDate.getDate()).padStart(2, '0');
        const dateParam = `${year}-${month}-${day}`;

        let cleanBaseUrl = typeof BASE_URL !== 'undefined' ? BASE_URL : 'http://localhost:5000';
        if (cleanBaseUrl.endsWith('/api')) cleanBaseUrl = cleanBaseUrl.slice(0, -4);

        const res = await fetch(`${cleanBaseUrl}/api/teacher/${tId}/schedule?week_type=${weekInfo.code}&date=${dateParam}`, {
            headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : { 'Content-Type': 'application/json' }
        });
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || `Помилка сервера (Статус ${res.status})`);
        }
        
        const data = await res.json();

        // Однорідна обробка канікул
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

        const lessonsArray = data.lessons || [];
        renderDynamicTeacherSchedule(lessonsArray);

    } catch (err) {
        console.error("❌ Помилка завантаження розкладу викладача:", err);
        container.innerHTML = `
            <div style="color:#ef4444; text-align:center; padding:30px; font-weight:700; background:#fef2f2; border-radius:16px; border:1px solid #fee2e2; width: 100%;">
                <i class="fa-solid fa-triangle-exclamation"></i> Не вдалося завантажити актуальний розклад занять викладача.<br>
                <span style="font-size:11px; font-weight:400; color:#b91c1c;">Деталі: ${err.message}</span>
            </div>`;
    } finally {
        setTimeout(() => {
            container.classList.remove('schedule-loading-state');
        }, 50);
    }
};

// Збереження аліасу функції для сторонніх модулів
window.loadScheduleData = window.loadTeacherSchedule;

// Рендеринг карток тижня з обробкою скасувань
function renderDynamicTeacherSchedule(lessons) {
    const scheduleContainer = document.getElementById('teacher-schedule-container');
    if (!scheduleContainer) return;

    scheduleContainer.innerHTML = `<div class="schedule-perfect-grid" id="schedule-grid-wrapper"></div>`;
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

    weekdays.forEach((day, cardIndex) => {
        const rawDayLessons = lessonsByDay[day.id];
        
        const cardDate = new Date(currentWeekMonday);
        cardDate.setDate(currentWeekMonday.getDate() + (day.id - 1));
        const cardDateStr = cardDate.toLocaleDateString('uk-UA');

        const isToday = (day.id === currentDayIndex) && (cardDateStr === realTodayStr);
        const formattedDateStr = cardDate.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });

        const cardElement = document.createElement('div');
        cardElement.className = `schedule-modern-card ${isToday ? 'today-highlight-card' : ''}`;
        cardElement.style.setProperty('--card-animation-index', cardIndex);

        const headerStyle = isToday 
            ? 'background: linear-gradient(135deg, #4f46e5, #6366f1); border-top-left-radius: 12px; border-top-right-radius: 12px; display: flex; justify-content: space-between; align-items: center; padding: 15px 18px 10px 18px;'
            : 'display: flex; justify-content: space-between; align-items: center; padding: 15px 18px 10px 18px;';

        const titleColor = isToday ? 'color: #ffffff !important;' : 'color: #1e293b;';
        const dateColor = isToday ? 'color: rgba(255, 255, 255, 0.85) !important;' : 'color: #64748b;';

        let headerHTML = `
            <div class="modern-card-header" style="${headerStyle}">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <h3 style="margin: 0; font-size: 17px; font-weight: 700; ${titleColor}">${day.name}</h3>
                    <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.3px; ${dateColor}">${formattedDateStr}</span>
                </div>
                ${isToday ? '<span class="today-text-badge-glow">СЬОГОДНІ</span>' : ''}
            </div>
        `;

        let lessonsHTML = '';
        if (rawDayLessons && rawDayLessons.length > 0) {
            const mergedLessonsMap = {};
            
            rawDayLessons.forEach(lesson => {
                const key = `${lesson.lesson_number}_${lesson.subject_id}`;
                if (!mergedLessonsMap[key]) {
                    mergedLessonsMap[key] = { 
                        ...lesson, 
                        lesson_real_date: cardDate.toLocaleDateString('sv-SE'), 
                        groups: [lesson.group_name],
                        groupIds: [lesson.group_id],
                        scheduleIds: [lesson.id] 
                    };
                } else {
                    if (!mergedLessonsMap[key].groups.includes(lesson.group_name)) {
                        mergedLessonsMap[key].groups.push(lesson.group_name);
                    }
                    if (!mergedLessonsMap[key].groupIds.includes(lesson.group_id)) {
                        mergedLessonsMap[key].groupIds.push(lesson.group_id);
                    }
                    if (!mergedLessonsMap[key].scheduleIds.includes(lesson.id)) {
                        mergedLessonsMap[key].scheduleIds.push(lesson.id);
                    }
                    if (lesson.is_cancelled_today) {
                        mergedLessonsMap[key].is_cancelled_today = true;
                    }
                }
            });

            const finalDayLessons = Object.values(mergedLessonsMap);
            finalDayLessons.sort((a, b) => (a.lesson_number || 0) - (b.lesson_number || 0));
            lessonsHTML = finalDayLessons.map((lesson, rowIndex) => renderTeacherLessonRow(lesson, rowIndex)).join('');
        } else {
            lessonsHTML = `
                <div class="lesson-box-empty" style="padding: 30px 15px;">
                    <i class="fa-regular fa-calendar-xmark empty-icon-animated"></i>
                    <p>Пар не заплановано</p>
                </div>
            `;
        }

        cardElement.innerHTML = `
            ${headerHTML}
            <div class="modern-lessons-container" style="padding: 0 14px 14px 14px;">
                ${lessonsHTML}
            </div>
        `;
        gridWrapper.appendChild(cardElement);
    });

    // Рендеринг розкладу дзвінків
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
            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5;">Пара №1</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>08:30 – 09:50</span>
                </div>
            </div>
            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5;">Пара №2</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>10:00 – 11:20</span>
                </div>
            </div>
            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5;">Пара №3</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>11:40 – 13:00</span>
                </div>
            </div>
            <div class="call-tg-item" style="background: #ffffff; border-radius: 14px; padding: 12px 16px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid #e2e8f0;">
                <span style="font-weight: 800; font-size: 15px; color: #4f46e5;">Пара №4</span>
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; font-weight: 600; font-size: 14px;">
                    <i class="fa-regular fa-clock" style="color: #818cf8;"></i> <span>13:20 – 14:40</span>
                </div>
            </div>
        </div>
    `;
    gridWrapper.appendChild(callsCard);
}

// Рендеринг рядка заняття з блокуванням кліків для скасованих пар
function renderTeacherLessonRow(lesson, rowIdx) {
    const LOCAL_LESSON_MAP = window.LESSON_MAP || (typeof LESSON_MAP !== 'undefined' ? LESSON_MAP : {
        1: ["08:30", "09:50"],
        2: ["10:00", "11:20"],
        3: ["11:40", "13:00"],
        4: ["13:20", "14:40"]
    });

    const time = LOCAL_LESSON_MAP[lesson.lesson_number] || [lesson.time_start || '--:--', lesson.time_end || '--:--'];
    const groupsString = lesson.groups ? lesson.groups.join(', ') : (lesson.group_name || 'Не вказано');
    const isStream = lesson.groups && lesson.groups.length > 1;
    const badgeHTML = isStream ? `<span class="stream-pill" style="background: #e0e7ff; color: #4f46e5; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px;">ПОТІК</span>` : '';

    const safeLessonData = encodeURIComponent(JSON.stringify(lesson));
    const safeEscape = (str) => {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"}[m]));
    };

    const displayRoom = lesson.room || lesson.room_name || 'Онлайн';
    const isCancelled = lesson.is_cancelled_today === true || lesson.is_cancelled === true;
    
    const cancelledRowStyles = isCancelled 
        ? "background: #fef2f2 !important; border: 1px solid #fec2c2 !important; border-left: 4px solid #ef4444 !important; opacity: 0.75; cursor: not-allowed !important;" 
        : "cursor: pointer;";

    const titleStyle = isCancelled
        ? "text-decoration: line-through; color: #94a3b8; font-style: italic;"
        : "color: #1e293b;";

    const clickHandler = isCancelled 
        ? "event.stopPropagation(); return false;" 
        : `window.openTeacherLessonManagement('${safeLessonData}')`;

    return `
        <div class="lesson-row-item" style="--row-animation-index:${rowIdx}; ${cancelledRowStyles}" onclick="${clickHandler}">
            <div class="lesson-time-meta">
                <span class="lesson-number-label" style="${isCancelled ? 'color:#ef4444;' : ''}">
                    Пара №${lesson.lesson_number} ${badgeHTML} ${isCancelled ? '❌ [СКАСОВАНО]' : ''}
                </span>
                <span class="lesson-clock-label"><i class="fa-regular fa-clock"></i> ${safeEscape(time[0])} - ${safeEscape(time[1])}</span>
            </div>
            <h4 class="lesson-title-text" style="${titleStyle}">${safeEscape(lesson.subject_name)}</h4>
            <div class="lesson-details-meta">
                <span><i class="fa-solid fa-users"></i> Гр: <strong>${safeEscape(groupsString)}</strong></span>
                <span class="room-pill"><i class="fa-solid fa-location-dot"></i> ${safeEscape(displayRoom)}</span>
            </div>
        </div>
    `;
}

// Перемикач доступності інпуту оцінки при відсутності студента
window.toggleGradeInput = function(selectEl) {
    const row = selectEl.closest('tr');
    if (!row) return;
    const gradeInput = row.querySelector('.student-grade-input');
    if (!gradeInput) return;

    if (selectEl.value === 'Відсутній') {
        gradeInput.value = '';
        gradeInput.disabled = true;
        gradeInput.style.background = '#f1f5f9';
        gradeInput.style.color = '#94a3b8';
    } else {
        gradeInput.disabled = false;
        gradeInput.style.background = '#fff';
        gradeInput.style.color = '#000';
    }
};

// Відкриття модального вікна журналу заняття
window.openTeacherLessonManagement = async function(encodedLessonData) {
    try {
        const lesson = JSON.parse(decodeURIComponent(encodedLessonData));
        const modal = document.getElementById('lesson-management-modal');
        const form = document.getElementById('form-lesson-management');
         
        if (!modal || !form) return;

        if (document.getElementById('lesson-theme')) document.getElementById('lesson-theme').value = '';
        if (document.getElementById('lesson-homework')) document.getElementById('lesson-homework').value = '';
        
        const currentWorkType = lesson.work_type || lesson.control_type || 'Пара';
        const workTypeSelect = document.getElementById('modal-lesson-work-type');
        if (workTypeSelect) {
            workTypeSelect.value = currentWorkType;
        }

        const selectedDate = lesson.lesson_real_date || new Date().toLocaleDateString('sv-SE');
         
        const globalScheduleIds = lesson.scheduleIds ? lesson.scheduleIds.join(',') : (lesson.id || '');
        const allScheduleIdsArray = lesson.scheduleIds ? lesson.scheduleIds : [lesson.id];
        const globalGroupIds = lesson.groupIds ? lesson.groupIds.join(',') : (lesson.group_id || '');

        form.dataset.date = selectedDate;
        form.dataset.subjectId = lesson.subject_id;
        form.dataset.scheduleIds = globalScheduleIds; 
        form.dataset.groupId = globalGroupIds; 

        const modalGradeDate = document.getElementById('modal-grade-date');
        if (modalGradeDate) modalGradeDate.value = selectedDate;

        const titleEl = document.getElementById('lesson-modal-title');
        const subtitleEl = document.getElementById('lesson-modal-subtitle');
         
        if (titleEl) titleEl.textContent = `Журнал: ${lesson.subject_name}`;
        if (subtitleEl) {
            const groupsString = lesson.groups ? lesson.groups.join(', ') : (lesson.group_name || '—');
            subtitleEl.textContent = `${currentWorkType} | Група: ${groupsString} | Пара №${lesson.lesson_number} | Дата: ${selectedDate}`;
        }

        modal.style.display = 'flex';

        await loadAttendanceList(lesson, selectedDate, globalScheduleIds, globalGroupIds);

        let cleanBaseUrl = typeof BASE_URL !== 'undefined' ? BASE_URL : '';
        if (cleanBaseUrl.endsWith('/api')) cleanBaseUrl = cleanBaseUrl.slice(0, -4);

        for (const sId of allScheduleIdsArray) {
            try {
                const response = await fetch(`${cleanBaseUrl}/api/teacher/lessons/details?scheduleId=${sId}&date=${selectedDate}`, {
                    headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : {}
                });
                if (response.ok) {
                    const details = await response.json();
                    if (details) {
                        if (details.theme && document.getElementById('lesson-theme')) {
                            document.getElementById('lesson-theme').value = details.theme;
                        }
                        if (details.homework && document.getElementById('lesson-homework')) {
                            document.getElementById('lesson-homework').value = details.homework;
                        }
                        if (details.work_type && workTypeSelect) {
                            workTypeSelect.value = details.work_type;
                        }
                        break; 
                    }
                }
            } catch (e) {
                console.warn(`Деталі не знайдено для scheduleId ${sId}...`);
            }
        }

    } catch (err) {
        console.error("❌ Помилка під час відкриття модального вікна:", err);
    }
};

// Завантаження списку студентів з бази даних
async function loadAttendanceList(lesson, dateStr, globalScheduleIds = '', globalGroupIds = '') {
    const tbody = document.getElementById('lesson-students-attendance-list');
    if (!tbody) return;
     
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Завантаження журналу...</td></tr>`;
     
    try {
        const targetGroups = globalGroupIds || lesson.group_id;
        const targetSubject = lesson.subject_id;

        let cleanBaseUrl = typeof BASE_URL !== 'undefined' ? BASE_URL : '';
        if (cleanBaseUrl.endsWith('/api')) cleanBaseUrl = cleanBaseUrl.slice(0, -4);
        
        const url = `${cleanBaseUrl}/api/teacher/journal/students?groupId=${targetGroups}&subjectId=${targetSubject}&date=${dateStr}`;
        
        const response = await fetch(url, {
            headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : {}
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Помилка сервера: ${response.status}`);
        }
         
        const serverData = await response.json();
        
        const themeInput = document.getElementById('lesson-theme');
        const hwInput = document.getElementById('lesson-homework');
        const workTypeSelect = document.getElementById('modal-lesson-work-type');

        if (themeInput) themeInput.value = serverData.theme || lesson.theme || '';
        if (hwInput) hwInput.value = serverData.homework || lesson.homework || '';
        
        if (workTypeSelect) {
            workTypeSelect.value = serverData.work_type || lesson.work_type || 'Пара';
        }

        const studentsArray = serverData.students || [];
         
        if (studentsArray.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: #94a3b8;">У групі немає студентів</td></tr>`;
            return;
        }
         
        const safeEscape = (str) => String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"}[m]));

        studentsArray.sort((a, b) => {
            const groupA = String(a.group_name || '');
            const groupB = String(b.group_name || '');
            if (groupA !== groupB) return groupA.localeCompare(groupB);
            
            const nameA = `${a.last_name || ''} ${a.first_name || ''}`;
            const nameB = `${b.last_name || ''} ${b.first_name || ''}`;
            return nameA.localeCompare(nameB);
        });

        tbody.innerHTML = studentsArray.map(student => {
            let att = student.attendance || 'Присутній'; 
            if (att === 'Н' || att === 'N') att = 'Відсутній';
            if (att === 'З' || att === 'Зп') att = 'Запізнення';

            const isAbsent = att === 'Відсутній'; 
            const isLate = att === 'Запізнення';
            const isPresent = !isAbsent && !isLate;

            const studentName = `${student.last_name || ''} ${student.first_name || ''}`.trim();
            const studentGroup = student.group_name || '—';

            return `
                <tr data-student-id="${student.student_id}" data-schedule-id="${student.schedule_id || lesson.id}" style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px; font-weight: 500; color: #1e293b;">
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span>${safeEscape(studentName)}</span>
                            <span style="font-size: 11px; color: #6366f1; font-weight: 600;">
                                <i class="fa-solid fa-graduation-cap" style="font-size: 10px; margin-right: 3px;"></i>Група: ${safeEscape(studentGroup)}
                            </span>
                        </div>
                    </td>
                    <td style="padding: 10px; text-align: center; width: 130px;">
                        <select class="student-attendance-select" style="padding: 6px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px; width: 115px;" onchange="window.toggleGradeInput(this)">
                            <option value="Присутній" ${isPresent ? 'selected' : ''}>Присутній</option>
                            <option value="Відсутній" ${isAbsent ? 'selected' : ''}>Відсутній (Н)</option>
                            <option value="Запізнення" ${isLate ? 'selected' : ''}>Запізнення</option>
                        </select>
                    </td>
                    <td style="padding: 10px; text-align: center; width: 90px;">
                        <input type="number" class="student-grade-input" min="0" max="100" placeholder="—" 
                            value="${student.grade !== null && student.grade !== undefined ? student.grade : ''}" 
                            ${isAbsent ? 'disabled style="background: #f1f5f9; color: #94a3b8; width: 65px; padding: 6px 4px; text-align: center; border: 1px solid #cbd5e1; border-radius: 6px;"' : 'style="background: #fff; width: 65px; padding: 6px 4px; text-align: center; border: 1px solid #cbd5e1; border-radius: 6px;"'}>
                    </td>
                </tr>
            `;
        }).join('');
         
    } catch (err) {
        console.error("❌ Помилка відомості:", err);
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 25px; color: #ef4444; font-weight: 600;">Помилка: ${err.message}</td></tr>`;
    }
}

// Обробник збереження журналу та теми занять
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-lesson-management');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const rawUserId = localStorage.getItem('userId') || window.state?.user?.id || (typeof teacherUserId !== 'undefined' ? teacherUserId : null); 
            const userId = rawUserId ? parseInt(rawUserId, 10) : null;

            const targetDate = this.dataset.date;
            const subjectId = this.dataset.subjectId;
            const globalScheduleIds = this.dataset.scheduleIds ? this.dataset.scheduleIds.split(',').map(id => parseInt(id, 10)) : [];
            
            const workType = document.getElementById('modal-lesson-work-type')?.value || 'Пара';
            const theme = document.getElementById('lesson-theme')?.value || '';
            const homework = document.getElementById('lesson-homework')?.value || '';

            if (!userId || isNaN(userId)) {
                alert("Помилка збереження: користувач не авторизований.");
                return;
            }

            const rows = document.querySelectorAll('#lesson-students-attendance-list tr[data-student-id]');
            const records = Array.from(rows).map(row => {
                const studentId = row.dataset.studentId;
                let rowScheduleId = row.dataset.scheduleId;
                const attendanceStatus = row.querySelector('.student-attendance-select').value;
                const gradeInputVal = row.querySelector('.student-grade-input').value;
                
                if (!rowScheduleId && globalScheduleIds.length > 0) {
                    rowScheduleId = globalScheduleIds[0];
                }
                
                return {
                    studentId: parseInt(studentId, 10),
                    scheduleId: rowScheduleId ? parseInt(rowScheduleId, 10) : null,
                    attendanceStatus: attendanceStatus,
                    grade: (attendanceStatus === 'Відсутній' || gradeInputVal === '') ? null : parseInt(gradeInputVal, 10)
                };
            });
            
            if (records.length === 0) {
                alert("Немає даних студентів для збереження.");
                return;
            }

            const bodyPayload = {
                userId: userId,
                subjectId: parseInt(subjectId, 10),
                date: targetDate,
                workType: workType,
                theme: theme,
                homework: homework,
                records: records,
                scheduleIds: globalScheduleIds 
            };
            
            try {
                let cleanBaseUrl = typeof BASE_URL !== 'undefined' ? BASE_URL : '';
                if (cleanBaseUrl.endsWith('/api')) cleanBaseUrl = cleanBaseUrl.slice(0, -4);

                // 1. Пакетне збереження оцінок та відвідуваності в журнал
                const response = await fetch(`${cleanBaseUrl}/api/teacher/journal/save-bulk`, {
                    method: 'POST',
                    headers: {
                        ...getAuthHeaders(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(bodyPayload)
                });
                
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Не вдалося зберегти відомість уроку");
                
                // 2. Послідовна синхронізація теми заняття для всіх пов'язаних розкладів потоку
                if (globalScheduleIds.length > 0) {
                    for (const sId of globalScheduleIds) {
                        const lessonSaveRes = await fetch(`${cleanBaseUrl}/api/teacher/lessons/save`, {
                            method: 'POST',
                            headers: {
                                ...getAuthHeaders(),
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                scheduleId: sId,
                                date: targetDate,
                                theme: theme,
                                homework: homework,
                                work_type: workType
                            })
                        });
                        if (!lessonSaveRes.ok) {
                            console.warn(`⚠️ Не вдалося синхронізувати тему для розкладу ID: ${sId}`);
                        }
                    }
                }

                const toast = document.getElementById('toast-notification');
                if (toast) {
                    toast.querySelector('span').innerText = "Відомість та тему заняття успішно збережено!";
                    toast.style.display = 'flex';
                    setTimeout(() => { toast.style.display = 'none'; }, 3000);
                }
                
                const modalEl = document.getElementById('lesson-management-modal');
                if (modalEl) modalEl.style.display = 'none';
                
                // 3. Синхронне оновлення поточних інтерфейсів
                if (typeof window.loadTeacherSchedule === 'function') {
                    window.loadTeacherSchedule(window.currentScheduleDate);
                }
                
                if (typeof window.renderJournalTable === 'function') {
                    await window.renderJournalTable();
                }
                
            } catch (err) {
                console.error("❌ Помилка відправки відомості:", err);
                alert(`Не вдалося зберегти відомість групи: ${err.message}`);
            }
        });
    }

    const modal = document.getElementById('lesson-management-modal');
    const closeBtn = document.getElementById('btn-close-lesson-modal');
    const cancelBtn = document.getElementById('btn-cancel-lesson-modal');

    const closeModal = () => { if (modal) modal.style.display = 'none'; };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
});
// Розклад дзвінків
function renderCallsCard(gridWrapper) {
    if (!gridWrapper) return;
    const callsCard = document.createElement('div');
    callsCard.className = 'schedule-modern-card calls-card-special';
    callsCard.style.setProperty('--card-animation-index', 5);

    const mapToUse = window.LESSON_MAP || typeof LESSON_MAP !== 'undefined' ? LESSON_MAP : {
        1: ["08:30", "09:50"],
        2: ["10:00", "11:20"],
        3: ["11:40", "13:00"],
        4: ["13:20", "14:40"]
    };

    let callsRowsHTML = Object.keys(mapToUse).map((lessonNumber, rowIndex) => {
        const time = mapToUse[lessonNumber];
        return `
            <div class="lesson-row-item call-row-item" style="--row-animation-index: ${rowIndex}; display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px dashed #e2e8f0;">
                <span class="lesson-number-label" style="font-weight: 600; color: #475569;">Пара №${lessonNumber}</span>
                <span class="lesson-clock-label" style="font-weight: 700; color: #1e293b;"><i class="fa-regular fa-clock" style="margin-right: 4px; color: #6366f1;"></i> ${time[0]} - ${time[1]}</span>
            </div>
        `;
    }).join('');

    callsCard.innerHTML = `
        <div class="modern-card-header" style="padding: 15px 18px 10px 18px;">
            <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #1e293b;"><i class="fa-solid fa-bell" style="color: #6366f1; margin-right: 6px;"></i> Розклад дзвінків</h3>
        </div>
        <div class="modern-lessons-container" style="padding: 0 14px 14px 14px;">
            ${callsRowsHTML}
        </div>
    `;
    gridWrapper.appendChild(callsCard);
}

// Перевірка готовності бібліотек
function checkLibrariesReady() {
    if (!window.XLSX) {
        alert("❌ Помилка: Не підключено бібліотеку для Excel (XLSX) у вашому HTML.");
        return false;
    }
    if (!window.jspdf) {
        alert("❌ Помилка: Не підключено головну бібліотеку PDF (jsPDF) у вашому HTML.");
        return false;
    }
    return true;
}

// Отримання метаданих для експорту
function getExportMetaData(sectionType) {
    const subjectSelect = document.getElementById(`${sectionType}-subject-filter`);
    const groupSelect = document.getElementById(`${sectionType}-group-filter`);
    
    const rawSubject = subjectSelect?.options[subjectSelect.selectedIndex]?.text || "";
    const rawGroup = groupSelect?.options[groupSelect.selectedIndex]?.text || "";
    
    const cleanSubject = rawSubject.replace(/Оберіть|\.\.\./g, '').trim() || "Дисципліна";
    const cleanGroup = (rawGroup.includes('спочатку') || !rawGroup) ? "Усі_Групи" : rawGroup.trim();
    const currentDateStr = new Date().toLocaleDateString('uk-UA').replace(/\//g, '.');

    return { subject: cleanSubject, group: cleanGroup, date: currentDateStr };
}

// Створення чистої таблиці для експорту
function createCleanVirtualTable(originalTable) {
    const cleanTable = document.createElement('table');
    const rows = originalTable.querySelectorAll('tr');

    rows.forEach((row, rowIndex) => {
        const cleanRow = document.createElement('tr');
        const cells = row.querySelectorAll('th, td');
        
        cells.forEach((cell, colIndex) => {
            const cleanCell = rowIndex === 0 ? document.createElement('th') : document.createElement('td');
            const inputElement = cell.querySelector('input, select, textarea');
            
            let text = "";
            if (inputElement) {
                text = inputElement.value.trim();
            } else {
                const cellClone = cell.cloneNode(true);
                const mobileBadges = cellClone.querySelectorAll('.mobile-only, .avatar, .badge, span[style*="display: none"]');
                mobileBadges.forEach(b => b.remove());
                
                text = cellClone.textContent.trim();
                
                if (text.length > 4 && text.substring(0, 2) === text.substring(2, 4) && text.substring(0, 2) === text.substring(0, 2).toUpperCase()) {
                    text = text.substring(2);
                }
            }

            cleanCell.textContent = text;

            cleanCell.style.border = "1px solid #cbd5e1";
            cleanCell.style.fontFamily = "system-ui, -apple-system, sans-serif";
            cleanCell.style.fontSize = "11px";
            cleanCell.style.padding = "7px 5px";

            if (rowIndex === 0) {
                cleanCell.style.backgroundColor = "#4f46e5";
                cleanCell.style.color = "#ffffff";
                cleanCell.style.fontWeight = "bold";
                cleanCell.style.textAlign = "center";
            } else {
                cleanCell.style.backgroundColor = rowIndex % 2 === 0 ? "#f8fafc" : "#ffffff";
                
                if (colIndex === 0) {
                    cleanCell.style.textAlign = "center";
                    cleanCell.style.color = "#64748b";
                } else if (colIndex === 1) {
                    cleanCell.style.textAlign = "left";
                    cleanCell.style.fontWeight = "bold";
                    cleanCell.style.color = "#0f172a";
                } else {
                    cleanCell.style.textAlign = "center";
                    if (text.toLowerCase() === 'н') {
                        cleanCell.style.color = "#ef4444";
                        cleanCell.style.fontWeight = "bold";
                    }
                }
            }
            cleanRow.appendChild(cleanCell);
        });
        cleanTable.appendChild(cleanRow);
    });

    return cleanTable;
}

// Експорт в Excel
function doExcelExport(sectionType) {
    if (!checkLibrariesReady()) return;
    const wrapperId = sectionType === 'journal' ? 'journal-table-wrapper' : 'students-list-wrapper';
    const originalTable = document.querySelector(`#${wrapperId} table`);
    if (!originalTable) {
        alert("⚠️ На сторінці немає активної таблиці журналу чи списку для імпорту.");
        return;
    }
    const cleanTable = createCleanVirtualTable(originalTable);
    const wb = XLSX.utils.table_to_book(cleanTable, { sheet: "Відомість успішності" });
    const ws = wb.Sheets["Відомість успішності"];
    
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!cols'] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
        if (C === 0) ws['!cols'].push({ wch: 5 });
        else if (C === 1) ws['!cols'].push({ wch: 35 });
        else ws['!cols'].push({ wch: 8 });
    }
    const meta = getExportMetaData(sectionType);
    const docTitle = sectionType === 'journal' ? "Журнал_Успішності" : "Список_Групи";
    const fileName = `${docTitle}_${meta.group}_${meta.subject || ''}_${meta.date}`.replace(/[\s\/\\\?%\*:|"<>\s]+/g, '_');
    XLSX.writeFile(wb, `${fileName}.xlsx`);
} 

// Експорт в PDF
async function doPdfExport(sectionType) {
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
            alert("Помилка: Не вдалося завантажити модуль html2pdf.");
            return;
        }
    }

    const wrapperId = sectionType === 'journal' ? 'journal-table-wrapper' : 'students-list-wrapper';
    const originalTable = document.querySelector(`#${wrapperId} table`);

    if (!originalTable) {
        alert("⚠️ На сторінці не знайдено активної таблиці для експорту.");
        return;
    }

    let meta = { group: "ВП-11", subject: "Веб-програмування (Node.js/JS)", date: "04.06.2026" };
    if (typeof getExportMetaData === 'function') {
        try { meta = getExportMetaData(sectionType); } catch(e) {}
    }

    const docTitle = sectionType === 'journal' ? "ЖУРНАЛ УСПІШНОСТІ СТУДЕНТІВ" : "СПИСОК СТУДЕНТІВ АКАДЕМІЧНОЇ ГРУПИ";
    const finalFileName = `${docTitle}_${meta.group}_${meta.date}`.replace(/[\s\/\\\?%\*:|"<>\s]+/g, '_') + '.pdf';

    const cleanTable = createCleanVirtualTable(originalTable);
    cleanTable.style.width = "100%";
    cleanTable.style.borderCollapse = "collapse";
    cleanTable.style.marginTop = "15px";

    const pdfWrapper = document.createElement('div');
    pdfWrapper.style.padding = "15px";
    pdfWrapper.style.background = "#ffffff";
    pdfWrapper.style.color = "#0f172a";
    pdfWrapper.style.fontFamily = "'Inter', system-ui, -apple-system, sans-serif";

    pdfWrapper.innerHTML = `
        <div style="margin-bottom: 15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
            <h1 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 800; color: #0f172a; text-transform: uppercase;">${docTitle}</h1>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; color: #334155;">
                <div><strong>Академічна група:</strong> ${meta.group}</div>
                <div style="text-align: right;"><strong>Дата формування:</strong> ${meta.date}</div>
                ${meta.subject ? `<div><strong>Дисципліна:</strong> ${meta.subject}</div>` : ''}
                <div style="text-align: right; color: #4f46e5; font-weight: bold;">EduPlatform Academic Report</div>
            </div>
        </div>
        <div class="pdf-table-container" style="width: 100%; overflow: visible;"></div>
        <div style="margin-top: 20px; border-top: 1px dashed #cbd5e1; padding-top: 8px; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between;">
            <span>Документ згенеровано автоматично в системі EduPlatform</span>
            <span>Контроль успішності семестру</span>
        </div>
    `;

    pdfWrapper.querySelector('.pdf-table-container').appendChild(cleanTable);

    const options = {
        margin:       [10, 10, 10, 10],
        filename:     finalFileName,
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  { scale: 2.5, useCORS: true, letterRendering: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak:    { mode: ['css', 'legacy'] } 
    };

    try {
        await html2pdf().set(options).from(pdfWrapper).save();
    } catch (err) {
        console.error(err);
        alert("Не вдалося згенерувати PDF. Перевірте консоль браузера.");
    }
}

// Повторна перевірка завантаження бібліотек
function checkLibrariesReady() {
    if (typeof XLSX === 'undefined') {
        alert("Помилка: Модуль Excel (SheetJS) ще не завантажився. Зачекайте секунду або оновіть сторінку!");
        return false;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert("Помилка: Модуль PDF (jsPDF) відсутній на сторінці.");
        return false;
    }
    return true;
}

// Слухачі подій
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('btn-journal-excel')?.addEventListener('click', (e) => { e.preventDefault(); doExcelExport('journal'); });
    document.getElementById('btn-journal-pdf')?.addEventListener('click', (e) => { e.preventDefault(); doPdfExport('journal'); });
    document.getElementById('btn-students-excel')?.addEventListener('click', (e) => { e.preventDefault(); doExcelExport('students'); });
    document.getElementById('btn-students-pdf')?.addEventListener('click', (e) => { e.preventDefault(); doPdfExport('students'); });
});
