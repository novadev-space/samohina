const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Розклад дзвінків
const LOCAL_LESSON_MAP = {
    1: ['08:30', '09:50'], 2: ['10:00', '11:20'], 3: ['11:40', '13:00'], 4: ['13:20', '14:40'],
    5: ['15:00', '16:20'], 6: ['16:30', '17:50'], 7: ['18:00', '19:20'], 8: ['19:30', '20:50']
};

// Безпечне виділення дати в ISO форматі
function safeExtractIsoDate(dateInput) {
    if (!dateInput) return new Date().toISOString().split('T')[0];
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) {
            return new Date().toISOString().split('T')[0];
        }
        return d.toISOString().split('T')[0];
    } catch (e) {
        return new Date().toISOString().split('T')[0];
    }
}

// Приведення дати до формату YYYY-MM-DD
function cleanLocalDate(dateInput) {
    if (!dateInput) return new Date().toISOString().split('T')[0];
    const match = dateInput.toString().match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : new Date().toISOString().split('T')[0];
}

// Форматування назви типу пари для фронтенду
function formatWorkTypeForFrontend(type) {
    if (!type) return 'Заняття';
    const t = type.toLowerCase().trim();
    if (t.includes('лекц') || t === 'l' || t === 'lecture') return 'Лекція';
    if (t.includes('практ') || t === 'p' || t === 'practice') return 'Практична';
    if (t.includes('лабор') || t === 'lb' || t === 'lab') return 'Лабораторна';
    if (t.includes('семін') || t === 'sem') return 'Семінар';
    if (t.includes('екзам') || t === 'exam') return 'Екзамен';
    if (t.includes('залік') || t === 'credit') return 'Залік';
    return type;
}

// Валідація типу роботи для збереження в БД
function getValidWorkType(type) {
    if (!type) return 'Пара';
    const t = type.toLowerCase().trim();
    if (t.includes('лекц')) return 'Лекція';
    if (t.includes('практ')) return 'Практична';
    if (t.includes('лабор')) return 'Лабораторна';
    if (t.includes('семін')) return 'Семінар';
    if (t.includes('екзам')) return 'Екзамен';
    if (t.includes('залік')) return 'Залік';
    return type;
}

// Читання типу DATE з Postgres як рядок YYYY-MM-DD
require('pg').types.setTypeParser(1082, val => val);

// Перевірка зв'язку з базою даних
app.get('/', async (req, res) => {
    try {
        await db.query('SELECT NOW()');
        res.send('✅ API EduPlatform працює. База даних підключена і синхронізована.');
    } catch (err) {
        console.error("❌ Database Connection Error:", err);
        res.status(500).send('❌ Помилка БД: ' + err.message);
    }
});

// Авторизація користувача (Вхід)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Введіть email та пароль" });

    try {
        const userRes = await db.query(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.password_hash, u.phone, r.name AS role
            FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(u.email) = LOWER($1)
        `, [email.trim()]);

        if (userRes.rows.length === 0) return res.status(404).json({ error: "Користувача не знайдено" });
        const user = userRes.rows[0];

        const passCheck = await db.query('SELECT ($1 = crypt($2, $3)) AS is_match', [user.password_hash, password, user.password_hash]);
        if (!passCheck.rows[0]?.is_match) return res.status(401).json({ error: "Невірний пароль" });

        const cleanRole = (user.role || '').toLowerCase().trim();
        let profileId = user.id, groupId = null, groupName = null, degree = null;

        if (cleanRole === 'teacher') {
            const tRes = await db.query('SELECT id, degree FROM teachers WHERE user_id = $1', [user.id]);
            if (tRes.rows.length > 0) { profileId = tRes.rows[0].id; degree = tRes.rows[0].degree || 'Викладач'; }
        } else if (cleanRole === 'student') {
            const sRes = await db.query('SELECT s.id, s.group_id, g.name FROM students s LEFT JOIN "groups" g ON s.group_id = g.id WHERE s.user_id = $1', [user.id]);
            if (sRes.rows.length === 0) return res.status(403).json({ error: "Студент не знайдений" });
            profileId = sRes.rows[0].id; groupId = sRes.rows[0].group_id; groupName = sRes.rows[0].name;
        }

        res.json({
            success: true,
            token: Buffer.from(`${user.id}-${cleanRole}`).toString('base64'),
            user: { id: user.id, profile_id: profileId, group_id: groupId, group_name: groupName, first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone || '', role: cleanRole, degree }
        });
    } catch (err) {
        console.error("❌ Login error:", err);
        res.status(500).json({ error: "Внутрішня помилка сервера" });
    }
});

// Зміна пароля
app.post('/api/users/:id/change-password', async (req, res) => {
    const { id } = req.params;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Заповніть усі поля' });
    }

    if (newPassword.trim().length < 4) {
        return res.status(400).json({ error: 'Новий пароль занадто короткий' });
    }

    try {
        const userRes = await db.query('SELECT password_hash FROM users WHERE id = $1', [id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }

        const currentHash = userRes.rows[0].password_hash;
        const passCheckResult = await db.query('SELECT ($1 = crypt($2, $3)) AS is_match', [currentHash, oldPassword, currentHash]);

        if (!passCheckResult.rows[0]?.is_match) {
            return res.status(401).json({ error: 'Невірний поточний пароль' });
        }

        await db.query("UPDATE users SET password_hash = crypt($1, gen_salt('bf', 10)) WHERE id = $2", [newPassword, id]);
        res.json({ success: true, message: 'Пароль успішно змінено' });
    } catch (err) {
        console.error("❌ Change Password API Error:", err);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// Оновлення телефону в профілі користувача
app.put('/api/users/:id/profile', async (req, res) => {
    const { id } = req.params;
    let { phone } = req.body;

    if (phone) {
        phone = phone.trim();
        if (phone === '+380' || phone === '') phone = null; 
    } else {
        phone = null;
    }

    try {
        const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [id]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Користувача з таким ID не знайдено.' });
        }

        await db.query('UPDATE users SET phone = $1 WHERE id = $2', [phone, id]);
        return res.json({ success: true, message: 'Номер телефону успішно збережено!' });
    } catch (err) {
        console.error("❌ Update Profile API Error:", err);
        return res.status(500).json({ success: false, error: 'Внутрішня помилка бази даних при оновленні профілю.', details: err.message });
    }
});

// ==========================================================================
// студент
// ==========================================================================

// Отримання повної інформації про пару для студента
app.get('/api/student/lesson-details', async (req, res) => {
    const { scheduleId, date, userId } = req.query;

    if (!scheduleId || !date || !userId) {
        return res.status(400).json({ error: 'Пропущені обов\'язкові параметри' });
    }

    try {
        const studentCheck = await db.query('SELECT id FROM students WHERE user_id = $1', [parseInt(userId, 10)]);
        if (studentCheck.rows.length === 0) return res.status(404).json({ error: 'Студента не знайдено' });
        const studentId = studentCheck.rows[0].id;
        
        const queryText = `
            SELECT 
                sch.id AS schedule_id, sch.room_name, sch.lesson_number,
                COALESCE(lj.work_type, 'Пара') AS work_type, lj.theme, lj.homework, 
                COALESCE(lj.is_cancelled_today, FALSE) AS is_cancelled_today,
                att.status AS attendance_status, gr.grade AS student_grade,
                COALESCE(gr.work_type, 'Пара') AS grade_type
            FROM schedule sch
            LEFT JOIN lessons_journal lj ON lj.schedule_id = sch.id AND lj.lesson_date = $2::date
            LEFT JOIN attendance att ON att.schedule_id = sch.id AND att.student_id = $3 AND att.lesson_date = $2::date
            LEFT JOIN grades gr ON gr.schedule_id = sch.id AND gr.student_id = $3 AND gr.graded_at = $2::date
            WHERE sch.id = $1 LIMIT 1;
        `;

        const result = await db.query(queryText, [parseInt(scheduleId, 10), date, studentId]);

        if (result.rows.length === 0) {
            return res.status(200).json({ 
                theme: null, homework: null, attendance_status: null, student_grade: null,
                work_type: 'Пара', is_cancelled_today: false, message: 'Заняття відсутнє в розкладі' 
            });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error("❌ Error fetching combined student lesson details:", err);
        res.status(500).json({ error: 'Помилка сервера під час отримання деталей пари' });
    }
});

// Розклад студента з валідацією семестру/канікул
app.get('/api/student/:userId/schedule', async (req, res) => {
    const { userId } = req.params;
    const { week_type, date, periodId } = req.query; 
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
        // Пошук активного навчального періоду
        let periodQuery = `SELECT id, name, is_active, start_date, end_date FROM academic_periods WHERE $1::date BETWEEN start_date AND end_date AND is_active = TRUE LIMIT 1`;
        let periodParams = [targetDate];

        if (periodId && periodId !== 'all' && periodId !== 'undefined') {
            periodQuery = `SELECT id, name, is_active, start_date, end_date FROM academic_periods WHERE id = $1 LIMIT 1`;
            periodParams = [parseInt(periodId, 10)];
        }

        const periodCheck = await db.query(periodQuery, periodParams);

        if (periodCheck.rows.length === 0 || periodCheck.rows[0].is_active === false) {
            return res.json({
                isVacation: true,
                message: "Навчальні заняття не проводяться. Відпочивайте!",
                schedule: [],
                period: periodCheck.rows[0] || null
            });
        }

        const currentPeriod = periodCheck.rows[0];

        // Парсинг та нормалізація типу тижня
        let dbWeekType = 'always';
        const cleanWeekType = String(week_type).toLowerCase().trim();
        
        if (cleanWeekType === 'upper' || cleanWeekType === '1' || cleanWeekType === 'numerator') {
            dbWeekType = 'numerator';
        } else if (cleanWeekType === 'lower' || cleanWeekType === '2' || cleanWeekType === 'denominator') {
            dbWeekType = 'denominator';
        }

        // Отримання розкладу для групи студента
        const queryText = `
            SELECT sch.id, g.name AS group_name, sub.name AS subject_name,
                   COALESCE(CONCAT(u.last_name, ' ', u.first_name), 'Викладач не призначений') AS teacher_name,
                   sch.lesson_number, sch.room_name, sch.day_of_week, sch.week_type,
                   COALESCE(lj.is_cancelled_today, FALSE) AS is_cancelled_today
            FROM users usr
            JOIN students s ON s.user_id = usr.id
            JOIN "groups" g ON g.id = s.group_id
            JOIN schedule sch ON sch.group_id = g.id
            JOIN subjects sub ON sub.id = sch.subject_id
            LEFT JOIN teachers t ON t.id = sch.teacher_id
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN lessons_journal lj ON lj.schedule_id = sch.id AND lj.lesson_date = $2::date
            WHERE usr.id = $1::integer 
              AND sch.period_id = $3::integer
              AND sch.is_active = TRUE
              AND (sch.week_type = $4 OR sch.week_type = 'always')
            ORDER BY sch.day_of_week ASC, sch.lesson_number ASC;
        `;
        
        const result = await db.query(queryText, [parseInt(userId, 10), targetDate, currentPeriod.id, dbWeekType]);
        
        res.json({
            isVacation: false,
            message: "Робочий період",
            schedule: result.rows,
            period: currentPeriod
        });
    } catch (err) {
        console.error("❌ Помилка сервера при отриманні розкладу студента:", err.message);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// Ендпоінт для отримання оцінок студента
app.get('/api/student/:userId/grades', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await db.query(`
            SELECT 
                g.id, sub.name AS discipline, g.grade, g.work_type, 
                TO_CHAR(g.graded_at, 'YYYY-MM-DD') AS date,
                COALESCE(CONCAT(u.last_name, ' ', u.first_name), 'Кафедра') AS teacher_full_name
            FROM grades g
            JOIN students s ON s.id = g.student_id
            JOIN subjects sub ON sub.id = g.subject_id
            LEFT JOIN academic_periods ap ON ap.id = g.period_id
            LEFT JOIN teachers t ON t.id = COALESCE(
                g.teacher_id, 
                (SELECT teacher_id FROM schedule WHERE subject_id = g.subject_id AND group_id = s.group_id LIMIT 1)
            )
            LEFT JOIN users u ON u.id = t.user_id
            WHERE s.user_id = $1::integer 
              AND (g.period_id IS NULL OR ap.is_active = TRUE OR (SELECT COUNT(*) FROM academic_periods WHERE is_active = TRUE) = 0)
            ORDER BY g.graded_at DESC, g.id DESC
        `, [parseInt(userId, 10)]);

        res.json(result.rows);
    } catch (err) {
        console.error("❌ Student Grades API Error:", err);
        res.status(500).json({ error: 'Помилка отримання оцінок', details: err.message });
    }
});

// Ендпоінт для отримання відвідуваності (н-ок)
app.get('/api/student/:userId/attendance', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await db.query(`
            SELECT 
                a.id, sub.name AS subject_name, a.status, 
                TO_CHAR(a.lesson_date, 'YYYY-MM-DD') AS date, 
                COALESCE(sch.lesson_number, 1) AS lesson_number, 
                COALESCE(sch.room_name, 'Дистанційно') AS room_name
            FROM attendance a
            JOIN students s ON s.id = a.student_id
            JOIN subjects sub ON sub.id = a.subject_id
            LEFT JOIN schedule sch ON sch.id = a.schedule_id
            LEFT JOIN academic_periods ap ON ap.id = sch.period_id
            WHERE s.user_id = $1::integer 
              AND (sch.period_id IS NULL OR ap.is_active = TRUE OR (SELECT COUNT(*) FROM academic_periods WHERE is_active = TRUE) = 0)
            ORDER BY a.lesson_date DESC, sch.lesson_number ASC
        `, [parseInt(userId, 10)]);
        
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Student Attendance API Error:", err);
        res.status(500).json({ error: 'Помилка отримання відвідуваності', details: err.message });
    }
});

// Аналітика успішності та відвідуваності для дашборду
app.get('/api/student/:userId/dashboard-analytics', async (req, res) => {
    const { userId } = req.params;
    const { periodId } = req.query; 

    try {
        const studentCheck = await db.query('SELECT id FROM students WHERE user_id = $1', [parseInt(userId, 10)]);
        if (studentCheck.rows.length === 0) return res.status(404).json({ error: 'Студента не знайдено' });
        const studentId = studentCheck.rows[0].id;

        // Список усіх періодів для фільтра на фронтенді
        const periodsRes = await db.query(`SELECT id, name, semester_number, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, total_weeks, is_active FROM academic_periods ORDER BY id ASC`);
        
        // Визначення вибраного семестру
        let targetPeriod = periodsRes.rows.find(p => p.is_active === true);
        if (periodId && periodId !== 'all') {
            targetPeriod = periodsRes.rows.find(p => String(p.id) === String(periodId));
        }
        if (!targetPeriod && periodsRes.rows.length > 0) {
            targetPeriod = periodsRes.rows[periodsRes.rows.length - 1]; 
        }

        const pId = targetPeriod ? targetPeriod.id : 0;

        // Розрахунок середнього бала та статистики відвідуваності
        const analyticsQuery = `
            SELECT 
                (SELECT ROUND(AVG(grade), 1) FROM grades WHERE student_id = $1 AND period_id = $2) as total_gpa,
                (SELECT COUNT(DISTINCT lesson_date) FROM attendance WHERE student_id = $1 AND period_id = $2 AND status = 'Відсутній') as missed_days,
                (SELECT COUNT(*) FROM attendance WHERE student_id = $1 AND period_id = $2 AND status = 'Присутній') as att_present,
                (SELECT COUNT(*) FROM attendance WHERE student_id = $1 AND period_id = $2 AND status = 'Відсутній') as att_absent,
                (SELECT COUNT(*) FROM attendance WHERE student_id = $1 AND period_id = $2 AND status = 'Запізнення') as att_delayed
        `;

        const analyticsRes = await db.query(analyticsQuery, [studentId, pId]);
        const row = analyticsRes.rows[0];

        const present = parseInt(row.att_present, 10) || 0;
        const absent = parseInt(row.att_absent, 10) || 0;
        const delayed = parseInt(row.att_delayed, 10) || 0;
        const totalLessons = present + absent + delayed;
        
        const attendanceRate = totalLessons > 0 ? Math.round(((present + delayed) / totalLessons) * 100) : 100;

        // Групування оцінок за критеріями ECTS
        const ectsQuery = `
            SELECT 
                COUNT(CASE WHEN grade >= 90 THEN 1 END) as excellent,
                COUNT(CASE WHEN grade >= 75 AND grade < 90 THEN 1 END) as good,
                COUNT(CASE WHEN grade >= 60 AND grade < 75 THEN 1 END) as fair,
                COUNT(CASE WHEN grade < 60 THEN 1 END) as poor
            FROM grades WHERE student_id = $1 AND period_id = $2
        `;
        const ectsRes = await db.query(ectsQuery, [studentId, pId]);
        const ectsRow = ectsRes.rows[0];

        // Обчислення середнього бала по кожній дисципліні
        const subjectsQuery = `
            SELECT s.name as subject_name, ROUND(AVG(g.grade), 1) as avg_grade
            FROM grades g JOIN subjects s ON g.subject_id = s.id
            WHERE g.student_id = $1 AND g.period_id = $2 GROUP BY s.name ORDER BY s.name ASC
        `;
        const subjectsRes = await db.query(subjectsQuery, [studentId, pId]);

        // Розрахунок поточного навчального тижня з лімітацією переповнення
        let currentWeekDisplay = "0";
        if (targetPeriod) {
            const start = new Date(targetPeriod.start_date);
            const end = new Date(targetPeriod.end_date);
            const today = new Date();
            const maxWeeks = parseInt(targetPeriod.total_weeks, 10) || 18;

            if (today < start) {
                currentWeekDisplay = `0 / ${maxWeeks}`;
            } else {
                const diffTime = Math.abs(today - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                let calcWeek = Math.ceil(diffDays / 7);

                if (calcWeek > maxWeeks || today > end) calcWeek = maxWeeks;
                currentWeekDisplay = `${calcWeek} / ${maxWeeks}`;
            }
        }

        res.json({
            academic_periods: periodsRes.rows, 
            selected_period_id: pId,
            current_week_text: currentWeekDisplay, 
            total_gpa: parseFloat(row.total_gpa) || 0.0,
            missed_days: parseInt(row.missed_days, 10) || 0,
            attendance_rate: attendanceRate,
            attendance_raw: { present, absent, delayed },
            bar_chart_data: {
                excellent: parseInt(ectsRow.excellent, 10) || 0,
                good: parseInt(ectsRow.good, 10) || 0,
                fair: parseInt(ectsRow.fair, 10) || 0,
                poor: parseInt(ectsRow.poor, 10) || 0
            },
            line_chart_data: subjectsRes.rows.map(r => ({
                subject_name: r.subject_name,
                avg_grade: parseFloat(r.avg_grade) || 0
            }))
        });
    } catch (err) {
        console.error('❌ Помилка на бекенді (Аналітика):', err);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// ==========================================================================
// викладач
// ==========================================================================

// Профіль викладача
app.get('/api/teacher/by-user/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Некоректний ID' });

    try {
        const result = await db.query(`
            SELECT t.id AS teacher_id, t.user_id, COALESCE(t.degree, 'Не вказано') as degree, COALESCE(t.degree, 'Викладач') as position,
                   u.first_name, u.last_name, u.email, COALESCE(u.phone, '') as phone, COALESCE(d.name, 'Загальноуніверситетська') as department_name, COALESCE(d.short_name, '-') as department_short
            FROM teachers t JOIN users u ON u.id = t.user_id LEFT JOIN departments d ON d.id = t.department_id WHERE t.user_id = $1::integer
        `, [userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Викладача не знайдено' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error("❌ Teacher Profile Error:", err);
        res.status(500).json({ error: 'Помилка завантаження профілю' });
    }
});

// Дисципліни викладача для групи
app.get('/api/teacher/:userId/subjects', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const groupId = parseInt(req.query.groupId, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Некоректний ID' });

    try {
        let queryText = `
            SELECT DISTINCT s.id, s.name FROM subjects s
            JOIN schedule sch ON sch.subject_id = s.id JOIN teachers t ON t.id = sch.teacher_id
            WHERE t.user_id = $1::integer AND sch.is_active = TRUE AND sch.period_id = (SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1)
        `;
        const params = [userId];
        if (!isNaN(groupId)) { params.push(groupId); queryText += ` AND sch.group_id = $2::integer`; }
        queryText += ` ORDER BY s.name`;

        const result = await db.query(queryText, params);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Teacher Subjects Error:", err);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// Аналітика успішності студентів з урахуванням семестру
app.get('/api/teacher/analytics/students-state', async (req, res) => {
    const groupId = parseInt(req.query.groupId, 10);
    const subjectId = parseInt(req.query.subjectId, 10);
    const queryPeriodId = parseInt(req.query.periodId, 10);

    if (isNaN(groupId) || isNaN(subjectId)) {
        return res.status(400).json({ error: "Параметри groupId та subjectId обов'язкові" });
    }

    try {
        // Визначаємо цільовий період: або переданий, або поточний активний
        let targetPeriodId = queryPeriodId;
        if (isNaN(targetPeriodId)) {
            const activePeriodRes = await db.query(`SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1`);
            targetPeriodId = activePeriodRes.rows.length > 0 ? activePeriodRes.rows[0].id : 0;
        }

        const queryText = `
            SELECT 
                u.id AS user_id, u.first_name, u.last_name, u.email, COALESCE(u.phone, 'Не вказано') AS phone,
                COALESCE((
                    SELECT AVG(g.grade)::float 
                    FROM grades g 
                    WHERE g.student_id = s.id 
                      AND g.subject_id = $2::integer 
                      AND g.assignment_id IS NULL 
                      AND g.period_id = $3::integer
                ), 0.0) AS avg_grade,
                COALESCE((
                    SELECT CASE 
                        WHEN COUNT(att.id) = 0 THEN 0.0
                        ELSE ROUND((COUNT(CASE WHEN att.status IN ('Присутній', 'Запізнення') THEN 1 END)::float / COUNT(att.id)::float) * 100)::float 
                    END
                    FROM attendance att 
                    WHERE att.student_id = s.id 
                      AND att.subject_id = $2::integer 
                      AND att.period_id = $3::integer
                ), 0.0) AS attendance_pct
            FROM students s 
            JOIN users u ON u.id = s.user_id 
            WHERE s.group_id = $1::integer 
            ORDER BY u.last_name, u.first_name
        `;
        
        const result = await db.query(queryText, [groupId, subjectId, targetPeriodId]);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Students State Analytics Error:", err);
        res.status(500).json({ error: 'Помилка збору аналітики успішності' });
    }
});

// Глобальний пошук студентів
app.get('/api/teacher/:userId/students/search', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const { query } = req.query;
    if (isNaN(userId)) return res.status(400).json({ error: 'Некоректний ID' });
    if (!query || query.trim() === '') return res.json([]);

    try {
        const teacherRes = await db.query('SELECT id FROM teachers WHERE user_id = $1::integer', [userId]);
        if (teacherRes.rows.length === 0) return res.status(404).json({ error: 'Викладача не знайдено' });
        
        const result = await db.query(`
            SELECT st.id AS student_id, u.first_name, u.last_name, u.email, COALESCE(u.phone, '—') AS phone, grp.name AS group_name, grp.course, sub.name AS subject_name,
                COALESCE(ROUND(AVG(g.grade)::numeric, 1), 0.0)::float AS avg_grade,
                CASE WHEN COUNT(att.id) = 0 THEN 100.0 ELSE ROUND((COUNT(CASE WHEN att.status IN ('Присутній', 'Запізнення') THEN 1 END) * 100.0 / COUNT(att.id))::numeric, 1)::float END AS attendance_pct
            FROM students st JOIN users u ON u.id = st.user_id JOIN "groups" grp ON grp.id = st.group_id
            JOIN schedule sch ON sch.group_id = grp.id JOIN subjects sub ON sub.id = sch.subject_id
            LEFT JOIN grades g ON g.student_id = st.id AND g.subject_id = sub.id AND g.assignment_id IS NULL AND g.period_id = sch.period_id
            LEFT JOIN attendance att ON att.student_id = st.id AND att.subject_id = sub.id AND att.period_id = sch.period_id
            WHERE sch.teacher_id = $1::integer AND sch.is_active = TRUE AND sch.period_id = (SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1)
              AND (LOWER(u.last_name) LIKE LOWER($2) OR LOWER(u.first_name) LIKE LOWER($2) OR LOWER(CONCAT(u.last_name, ' ', u.first_name)) LIKE LOWER($2))
            GROUP BY st.id, u.id, grp.id, sub.id ORDER BY u.last_name ASC, u.first_name ASC, sub.name ASC LIMIT 40
        `, [teacherRes.rows[0].id, `%${query.trim()}%`]);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Global Students Search Error:", err);
        res.status(500).json({ error: 'Помилка пошуку' });
    }
});

// Академічні групи викладача
app.get('/api/teacher/:teacherUserId/groups', async (req, res) => {
    try {
        const teacherUserId = parseInt(req.params.teacherUserId, 10);
        const subjectId = parseInt(req.query.subjectId, 10);
        const { skipEmpty } = req.query;

        if (isNaN(teacherUserId) || isNaN(subjectId)) return res.json([]);

        const query = `
            SELECT DISTINCT g.id, g.name, g.course, (SELECT COUNT(*)::integer FROM students s WHERE s.group_id = g.id) as "studentsCount"
            FROM "groups" g JOIN schedule sch ON sch.group_id = g.id JOIN teachers t ON sch.teacher_id = t.id
            WHERE t.user_id = $1::integer AND sch.subject_id = $2::integer AND sch.is_active = TRUE AND sch.period_id = (SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1)
            ORDER BY g.course ASC, g.name ASC;
        `;
        const { rows } = await db.query(query, [teacherUserId, subjectId]);
        let groups = rows.map(r => ({ id: r.id, name: r.name, course: r.course, studentsCount: parseInt(r.studentsCount, 10) || 0 }));
        if (skipEmpty === 'true') groups = groups.filter(g => g.studentsCount > 0);
        res.json(groups);
    } catch (error) {
        console.error("❌ Teacher Groups Fetch Error:", error);
        res.status(500).json({ error: "Помилка при отриманні груп" });
    }
});

// Розклад занять викладача
app.get('/api/teacher/:tId/schedule', async (req, res) => {
    try {
        const userId = parseInt(req.params.tId, 10);
        const weekType = req.query.week_type || 'numerator';
        const targetDate = req.query.date || new Date().toISOString().split('T')[0];

        if (isNaN(userId)) return res.status(400).json({ error: "Невалідний ID викладача" });

        // 1. Шукаємо ЛИШЕ той період, який зараз є активним І в межі якого потрапляє обрана дата
        const periodCheck = await db.query(`
            SELECT id, name FROM academic_periods 
            WHERE $1::date BETWEEN start_date AND end_date 
              AND is_active = TRUE 
            LIMIT 1
        `, [targetDate]);

        // Якщо дата не потрапляє в межі поточного АКТИВНОГО семестру -> це канікули!
        if (periodCheck.rows.length === 0) {
            return res.json({
                isVacation: true,
                message: "Навчальні заняття не проводяться відповідно до затвердженого академічного плану.",
                lessons: []
            });
        }

        const targetPeriodId = periodCheck.rows[0].id;

        // 2. Вигрібаємо пари виключно для знайденого активного періоду
        const { rows } = await db.query(`
            SELECT 
                s.id, s.lesson_number, s.room_name AS room, s.day_of_week, s.week_type, 
                sub.id AS subject_id, sub.name AS subject_name, g.id AS group_id, g.name AS group_name, 
                COALESCE(j.is_cancelled_today, FALSE) AS is_cancelled_today
            FROM schedule s 
            JOIN subjects sub ON s.subject_id = sub.id 
            JOIN "groups" g ON s.group_id = g.id 
            JOIN teachers t ON s.teacher_id = t.id
            LEFT JOIN lessons_journal j ON s.id = j.schedule_id AND j.lesson_date = $3::date
            WHERE t.user_id = $1::integer 
              AND s.is_active = TRUE 
              AND (s.week_type = $2 OR s.week_type = 'always') 
              AND s.period_id = $4::integer
            ORDER BY s.lesson_number ASC;
        `, [userId, weekType, targetDate, targetPeriodId]);
        
        // Повертаємо чистий формат
        res.json({
            isVacation: false,
            message: "",
            lessons: rows
        });

    } catch (err) {
        console.error("❌ Schedule API Error:", err);
        res.status(500).json({ error: "Внутрішня помилка розкладу" });
    }
});

// Отримання студентів журналу
app.get('/api/teacher/journal/students', async (req, res) => {
    const { groupId, subjectId, date } = req.query;
    const parsedSubjectId = parseInt(subjectId, 10);
    const filterDate = cleanLocalDate(date) || cleanLocalDate(new Date());

    if (isNaN(parsedSubjectId) || !groupId) return res.status(400).json({ error: "Параметри обов'язкові" });

    try {
        const targetGroupIds = String(groupId).split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
        if (targetGroupIds.length === 0) return res.json({ theme: '', homework: '', workType: 'Пара', all_stream_schedule_ids: [], students: [] });

        const scheduleRes = await db.query(`
            SELECT id FROM schedule 
            WHERE group_id = ANY($1::integer[]) AND subject_id = $2::integer AND is_active = TRUE
              AND period_id = (SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1)
        `, [targetGroupIds, parsedSubjectId]);
        
        const allScheduleIds = scheduleRes.rows.map(r => r.id);
        let theme = '', homework = '', workType = 'Пара', dbWorkTypeFromJournal = 'Пара'; 

        if (allScheduleIds.length > 0) {
            const journalRes = await db.query(`
                SELECT theme, homework, work_type FROM lessons_journal 
                WHERE schedule_id = ANY($1::integer[]) AND lesson_date = $2::date
                ORDER BY theme DESC NULLS LAST, work_type DESC LIMIT 1
            `, [allScheduleIds, filterDate]);
            
            if (journalRes.rows.length > 0) {
                theme = journalRes.rows[0].theme || '';
                homework = journalRes.rows[0].homework || '';
                dbWorkTypeFromJournal = journalRes.rows[0].work_type || 'Пара';
                workType = formatWorkTypeForFrontend(dbWorkTypeFromJournal);
            }
        }

        const result = await db.query(`
            SELECT s.id AS student_id, s.group_id, u.first_name, u.last_name, u.email, u.phone,
                   g.id AS grade_id, g.grade AS student_grade, g.work_type AS grade_work_type,
                   COALESCE(a.status, 'Присутній') AS attendance_status, grp.name AS group_name, sch.id AS schedule_id
            FROM students s JOIN users u ON u.id = s.user_id JOIN "groups" grp ON grp.id = s.group_id
            JOIN schedule sch ON sch.group_id = s.group_id AND sch.subject_id = $2::integer AND sch.is_active = TRUE
            LEFT JOIN grades g ON g.student_id = s.id AND g.subject_id = $2::integer AND g.graded_at = $3::date AND g.schedule_id = sch.id AND g.assignment_id IS NULL
            LEFT JOIN attendance a ON a.student_id = s.id AND a.subject_id = $2::integer AND a.lesson_date = $3::date AND a.schedule_id = sch.id
            WHERE s.group_id = ANY($1::integer[]) AND u.is_active = TRUE AND sch.period_id = (SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1)
            ORDER BY grp.name ASC, u.last_name ASC, u.first_name ASC
        `, [targetGroupIds, parsedSubjectId, filterDate]);
        
        const studentsData = result.rows.map(row => {
            let status = 'Присутній';
            if (row.attendance_status === 'Н' || row.attendance_status === 'Відсутній') status = 'Відсутній';
            else if (row.attendance_status === 'Зп' || row.attendance_status === 'Запізнення') status = 'Запізнення';

            return {
                student_id: row.student_id, first_name: row.first_name, last_name: row.last_name,
                email: row.email, phone: row.phone, group_name: row.group_name, grade_id: row.grade_id,
                work_type: formatWorkTypeForFrontend(row.grade_work_type || dbWorkTypeFromJournal),
                attendance: status, grade: row.student_grade, schedule_id: row.schedule_id
            };
        });

        res.json({ theme, homework, workType, date: filterDate, all_stream_schedule_ids: allScheduleIds, students: studentsData });
    } catch (err) {
        console.error("❌ Journal Students API Error:", err);
        res.status(500).json({ error: "Не вдалося отримати дані журналу" });
    }
});

// Ендпоінт матриці журналу 
app.get('/api/teacher/journal/matrix', async (req, res) => {
    const { groupId, subjectId, dateFrom, dateTo } = req.query;
    const gId = parseInt(groupId, 10), sId = parseInt(subjectId, 10);

    if (isNaN(gId) || isNaN(sId)) return res.status(400).json({ error: "Параметри обов'язкові" });

    try {
        const studentsRes = await db.query(`
            SELECT s.id AS student_id, u.first_name, u.last_name FROM students s JOIN users u ON u.id = s.user_id 
            WHERE s.group_id = $1 ORDER BY u.last_name ASC, u.first_name ASC
        `, [gId]);
        if (studentsRes.rows.length === 0) return res.json({ dates: [], students: [], isPairToday: false });

        // 🔥 Отримуємо активний семестр динамічно з бази даних разом із правильними датами старту й фінішу!
        const activePeriodRes = await db.query(`
            SELECT id, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date 
            FROM academic_periods WHERE is_active = TRUE LIMIT 1
        `);
        
        if (activePeriodRes.rows.length === 0) {
            return res.status(404).json({ error: "Не знайдено активного академічного періоду" });
        }

        const activePeriod = activePeriodRes.rows[0];
        const semesterStartStr = activePeriod.start_date; 
        const semesterEndStr = activePeriod.end_date;
        const todayStr = new Date().toISOString().split('T')[0];

        const scheduleRes = await db.query(`
            SELECT s.id as schedule_id, s.day_of_week, s.week_type FROM schedule s
            WHERE s.group_id = $1 AND s.subject_id = $2 AND s.is_active = TRUE AND s.period_id = $3
        `, [gId, sId, activePeriod.id]);

        const scheduleRules = scheduleRes.rows;
        const scheduleIdsList = scheduleRules.map(r => r.schedule_id);

        let startStr = semesterStartStr;
        if (dateFrom && dateFrom.trim() !== '') {
            const cleanFrom = safeExtractIsoDate(dateFrom);
            if (cleanFrom > startStr) startStr = cleanFrom;
        }

        let endStr = todayStr < semesterEndStr ? todayStr : semesterEndStr; 
        if (dateTo && dateTo.trim() !== '') {
            endStr = safeExtractIsoDate(dateTo);
        }

        const generatedDates = [];
        let currentIter = new Date(startStr + 'T12:00:00');
        const endLimit = new Date(endStr + 'T12:00:00');
        const baseMonday = new Date(semesterStartStr + 'T12:00:00');

        while (currentIter <= endLimit) {
            const dbDayOfWeek = currentIter.getDay() === 0 ? 7 : currentIter.getDay();
            const matchingRules = scheduleRules.filter(r => r.day_of_week === dbDayOfWeek);

            if (matchingRules.length > 0) {
                const diffTime = currentIter.getTime() - baseMonday.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const diffWeeks = Math.floor(diffDays / 7);
                const currentWeekType = (diffWeeks + 1) % 2 !== 0 ? 'numerator' : 'denominator';

                const curDateIso = currentIter.toISOString().split('T')[0];

                for (const rule of matchingRules) {
                    if (rule.week_type === 'always' || rule.week_type === currentWeekType) {
                        generatedDates.push(curDateIso);
                    }
                }
            }
            currentIter.setTime(currentIter.getTime() + 24 * 60 * 60 * 1000);
        }

        const finalUniqueDates = [...new Set(generatedDates)].sort();
        if (finalUniqueDates.length === 0 || scheduleIdsList.length === 0) {
            return res.json({ dates: [], students: [], isPairToday: false });
        }

        const dbStart = finalUniqueDates[0], dbEnd = finalUniqueDates[finalUniqueDates.length - 1];

        const [journalTypesRes, gradesRes, attendanceRes] = await Promise.all([
            db.query(`SELECT TO_CHAR(lesson_date, 'YYYY-MM-DD') as lesson_date, work_type FROM lessons_journal WHERE schedule_id = ANY($1::integer[]) AND lesson_date BETWEEN $2::date AND $3::date`, [scheduleIdsList, dbStart, dbEnd]),
            db.query(`SELECT student_id, TO_CHAR(graded_at, 'YYYY-MM-DD') as graded_at, grade, work_type FROM grades WHERE subject_id = $1 AND schedule_id = ANY($2::integer[]) AND assignment_id IS NULL AND period_id = $3 AND graded_at BETWEEN $4::date AND $5::date`, [sId, scheduleIdsList, activePeriod.id, dbStart, dbEnd]),
            db.query(`SELECT student_id, TO_CHAR(lesson_date, 'YYYY-MM-DD') as lesson_date, status FROM attendance WHERE subject_id = $1 AND schedule_id = ANY($2::integer[]) AND period_id = $3 AND lesson_date BETWEEN $4::date AND $5::date`, [sId, scheduleIdsList, activePeriod.id, dbStart, dbEnd])
        ]);

        const journalWorkTypesMap = {};
        journalTypesRes.rows.forEach(r => { if (r.lesson_date) journalWorkTypesMap[r.lesson_date] = r.work_type; });

        const studentsMatrix = studentsRes.rows.map(student => {
            const studentData = { student_id: student.student_id, first_name: student.first_name, last_name: student.last_name, history: {} };
            finalUniqueDates.forEach(d => studentData.history[d] = { grade: '', attendance: '', work_type: journalWorkTypesMap[d] || 'Пара' });

            gradesRes.rows.forEach(g => {
                if (g.student_id === student.student_id && studentData.history[g.graded_at]) {
                    studentData.history[g.graded_at].grade = g.grade ?? '';
                    if (g.work_type) studentData.history[g.graded_at].work_type = g.work_type;
                }
            });

            attendanceRes.rows.forEach(a => {
                if (a.student_id === student.student_id && studentData.history[a.lesson_date]) {
                    let letter = '';
                    if (a.status === 'Відсутній' || a.status === 'Н') letter = 'Н';
                    else if (a.status === 'Запізнення' || a.status === 'Зп') letter = 'З';
                    studentData.history[a.lesson_date].attendance = letter;
                }
            });
            return studentData;
        });

        res.json({ dates: finalUniqueDates, students: studentsMatrix, isPairToday: finalUniqueDates.includes(todayStr) });
    } catch (err) {
        console.error("❌ Помилка генерації матриці:", err);
        res.status(500).json({ error: "Помилка сервера під час збору даних matrix" });
    }
});

// Масове збереження відомості журналу (З ПРАВИЛЬНИМ PERIOD_ID)
app.post('/api/teacher/journal/save-bulk', async (req, res) => {
    const { userId, subjectId, date, workType, theme, homework, records, scheduleIds } = req.body;
    const parsedUserId = parseInt(userId, 10), parsedSubjectId = parseInt(subjectId, 10), cleanDate = cleanLocalDate(date); 

    if (isNaN(parsedUserId) || isNaN(parsedSubjectId) || !cleanDate || !records?.length) return res.status(400).json({ error: 'Некоректні дані.' });

    const validWorkType = getValidWorkType(workType);
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const teacherRes = await client.query('SELECT id FROM teachers WHERE user_id = $1::integer', [parsedUserId]);
        if (teacherRes.rows.length === 0) return res.status(403).json({ error: 'Викладача не знайдено.' });
        const teacherId = teacherRes.rows[0].id;

        // Поточний активний період навчання
        const periodRes = await client.query('SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1');
        const periodId = periodRes.rows[0]?.id;

        if (!periodId) {
            throw new Error("Не знайдено жодного активного академічного періоду (семестру) в таблиці academic_periods!");
        }

        const targetScheduleIds = scheduleIds?.length ? scheduleIds : [...new Set(records.map(r => parseInt(r.scheduleId || r.schedule_id, 10)).filter(id => !isNaN(id)))];
        if (targetScheduleIds.length === 0) throw new Error("Відсутні дійсні scheduleId.");
        const fallbackScheduleId = targetScheduleIds[0];

        // Запис у журнал занять (ФІКС: додано period_id)
        for (const schId of targetScheduleIds) {
            await client.query(`
                INSERT INTO lessons_journal (schedule_id, lesson_date, theme, homework, work_type, period_id) 
                VALUES ($1::integer, $2::date, $3, $4, $5, $6::integer)
                ON CONFLICT (schedule_id, lesson_date) 
                DO UPDATE SET theme = EXCLUDED.theme, homework = EXCLUDED.homework, work_type = EXCLUDED.work_type, period_id = EXCLUDED.period_id
            `, [schId, cleanDate, theme || '', homework || '', validWorkType, periodId]);
            
            await client.query(`UPDATE grades SET work_type = $1 WHERE schedule_id = $2::integer AND graded_at = $3::date AND assignment_id IS NULL`, [validWorkType, schId, cleanDate]);
        }

        // Запис відвідуваності та оцінок студентів
        for (const record of records) {
            const studentId = parseInt(record.studentId || record.student_id, 10);
            if (isNaN(studentId)) continue;

            let attStatus = record.attendanceStatus || record.attendance || 'Присутній';
            if (attStatus === 'Н' || attStatus.includes('Відсутній')) attStatus = 'Відсутній';
            else if (attStatus === 'Зп' || attStatus.includes('Запізнення')) attStatus = 'Запізнення';

            const validScheduleId = parseInt(record.scheduleId || record.schedule_id, 10) || fallbackScheduleId;

            await client.query(`
                INSERT INTO attendance (student_id, subject_id, schedule_id, lesson_date, status, period_id) VALUES ($1::integer, $2::integer, $3::integer, $4::date, $5, $6)
                ON CONFLICT ON CONSTRAINT unique_student_subject_schedule_date DO UPDATE SET status = EXCLUDED.status
            `, [studentId, parsedSubjectId, validScheduleId, cleanDate, attStatus, periodId]);

            if (record.grade !== null && record.grade !== undefined && record.grade !== '' && attStatus !== 'Відсутній') {
                const gradeVal = parseInt(record.grade, 10);
                if (isNaN(gradeVal) || gradeVal < 0 || gradeVal > 100) throw new Error(`Оцінка (${record.grade}) поза діапазоном 0-100.`);

                await client.query(`
                    INSERT INTO grades (student_id, subject_id, teacher_id, schedule_id, grade, work_type, graded_at, period_id) VALUES ($1::integer, $2::integer, $3::integer, $4::integer, $5::integer, $6, $7::date, $8)
                    ON CONFLICT (student_id, subject_id, schedule_id, graded_at) WHERE assignment_id IS NULL DO UPDATE SET grade = EXCLUDED.grade, work_type = EXCLUDED.work_type, teacher_id = EXCLUDED.teacher_id
                `, [studentId, parsedSubjectId, teacherId, validScheduleId, gradeVal, validWorkType, cleanDate, periodId]);
            } else {
                await client.query(`DELETE FROM grades WHERE student_id = $1::integer AND subject_id = $2::integer AND graded_at = $3::date AND schedule_id = $4::integer AND assignment_id IS NULL`, [studentId, parsedSubjectId, cleanDate, validScheduleId]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Журнал успішно оновлено на дату ${cleanDate}.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Пакетне збереження журналу:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});
// Поодиноке збереження оцінки або відсутності (з урахуванням періоду навчання)
app.post('/api/teacher/journal/save', async (req, res) => {
    const { studentId, scheduleId, subjectId, userId, grade, work_type, workType, attendanceStatus, date } = req.body;
    if (!studentId || !subjectId || !userId || !date) return res.status(400).json({ error: "Неповні дані" });

    const cleanDate = cleanLocalDate(date), validWorkType = getValidWorkType(work_type || workType);
    let attStatus = attendanceStatus === 'Відсутній' || attendanceStatus === 'Н' ? 'Відсутній' : (attendanceStatus === 'Запізнення' || attendanceStatus === 'Зп' ? 'Запізнення' : 'Присутній');

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const teacherRes = await client.query('SELECT id FROM teachers WHERE user_id = $1::integer', [parseInt(userId, 10)]);
        if (teacherRes.rows.length === 0) throw new Error('Викладача не знайдено');
        const teacherId = teacherRes.rows[0].id;

        const periodRes = await client.query('SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1');
        const periodId = periodRes.rows[0]?.id;

        if (!periodId) {
            throw new Error("Не знайдено активного періоду навчання!");
        }

        let finalScheduleId = scheduleId ? parseInt(scheduleId, 10) : null;
        if (!finalScheduleId) {
            const findSch = await client.query(`SELECT sch.id FROM schedule sch JOIN students s ON s.group_id = sch.group_id WHERE s.id = $1::integer AND sch.subject_id = $2::integer AND sch.is_active = TRUE LIMIT 1`, [parseInt(studentId, 10), parseInt(subjectId, 10)]);
            finalScheduleId = findSch.rows[0]?.id || null;
        }

        if (finalScheduleId) {
            await client.query(`
                INSERT INTO lessons_journal (schedule_id, lesson_date, theme, homework, work_type, period_id) 
                VALUES ($1::integer, $2::date, '', '', $3, $4::integer) 
                ON CONFLICT (schedule_id, lesson_date) 
                DO UPDATE SET work_type = EXCLUDED.work_type, period_id = EXCLUDED.period_id
            `, [finalScheduleId, cleanDate, validWorkType, periodId]);
            
            await client.query(`UPDATE grades SET work_type = $1 WHERE schedule_id = $2::integer AND graded_at = $3::date AND assignment_id IS NULL`, [validWorkType, finalScheduleId, cleanDate]);
        }

        await client.query(`
            INSERT INTO attendance (student_id, subject_id, schedule_id, lesson_date, status, period_id) VALUES ($1::integer, $2::integer, $3, $4::date, $5, $6)
            ON CONFLICT ON CONSTRAINT unique_student_subject_schedule_date DO UPDATE SET status = EXCLUDED.status
        `, [parseInt(studentId, 10), parseInt(subjectId, 10), finalScheduleId, cleanDate, attStatus, periodId]);

        if (grade !== null && grade !== undefined && grade !== '' && attStatus !== 'Відсутній') {
            const gradeVal = parseInt(grade, 10);
            if (isNaN(gradeVal) || gradeVal < 0 || gradeVal > 100) throw new Error(`Помилка оцінки: 0-100.`);

            await client.query(`
                INSERT INTO grades (student_id, subject_id, teacher_id, schedule_id, grade, work_type, graded_at, period_id) VALUES ($1::integer, $2::integer, $3::integer, $4, $5::integer, $6, $7::date, $8)
                ON CONFLICT (student_id, subject_id, schedule_id, graded_at) WHERE assignment_id IS NULL DO UPDATE SET grade = EXCLUDED.grade, work_type = EXCLUDED.work_type, teacher_id = EXCLUDED.teacher_id
            `, [parseInt(studentId, 10), parseInt(subjectId, 10), teacherId, finalScheduleId, gradeVal, validWorkType, cleanDate, periodId]);
        } else {
            await client.query(`DELETE FROM grades WHERE student_id = $1::integer AND subject_id = $2::integer AND graded_at = $3::date AND (schedule_id = $4::integer OR ($4::integer IS NULL AND schedule_id IS NULL)) AND assignment_id IS NULL`, [parseInt(studentId, 10), parseInt(subjectId, 10), cleanDate, finalScheduleId]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: "Збережено" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Journal Save Error:", err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Оновлення теми та домашнього завдання для заняття
app.post('/api/teacher/lessons/save', async (req, res) => {
    const scheduleId = parseInt(req.body.scheduleId, 10);
    const { date, theme, homework, work_type, workType } = req.body; 

    if (isNaN(scheduleId) || !date) return res.status(400).json({ error: "Неповні параметри" });

    const cleanDate = cleanLocalDate(date), validWorkType = getValidWorkType(work_type || workType);
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');

        const periodRes = await client.query('SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1');
        const periodId = periodRes.rows[0]?.id;

        if (!periodId) {
            throw new Error("Не знайдено активного періоду навчання для збереження теми уроку!");
        }

        const result = await client.query(`
            INSERT INTO lessons_journal (schedule_id, lesson_date, theme, homework, work_type, period_id) 
            VALUES ($1::integer, $2::date, $3, $4, $5, $6::integer)
            ON CONFLICT (schedule_id, lesson_date) 
            DO UPDATE SET theme = EXCLUDED.theme, homework = EXCLUDED.homework, work_type = EXCLUDED.work_type, period_id = EXCLUDED.period_id, created_at = CURRENT_TIMESTAMP
            RETURNING id
        `, [scheduleId, cleanDate, theme ? theme.trim() : null, homework ? homework.trim() : null, validWorkType, periodId]);

        await client.query(`UPDATE grades SET work_type = $1 WHERE schedule_id = $2::integer AND graded_at = $3::date AND assignment_id IS NULL`, [validWorkType, scheduleId, cleanDate]);

        await client.query('COMMIT');
        res.json({ success: true, lessonId: result.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Save Lesson Error:", err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Статистика та аналітика для головної панелі викладача
app.get('/api/teacher/:userId/analytics', async (req, res) => {
    const { userId } = req.params;
    const parsedUserId = parseInt(userId, 10);
    const queryPeriodId = parseInt(req.query.periodId, 10); 

    if (isNaN(parsedUserId)) {
        return res.status(400).json({ error: 'Некоректний ID користувача' });
    }

    try {
        const teacherCheck = await db.query('SELECT id FROM teachers WHERE user_id = $1::integer', [parsedUserId]);
        if (teacherCheck.rows.length === 0) return res.status(404).json({ error: 'Викладача не знайдено' });
        const teacherId = teacherCheck.rows[0].id;

        let targetPeriodId = queryPeriodId;
        if (isNaN(targetPeriodId)) {
            const activePeriodRes = await db.query('SELECT id FROM academic_periods WHERE is_active = TRUE LIMIT 1');
            targetPeriodId = activePeriodRes.rows[0]?.id || 0;
        }

        if (!targetPeriodId) {
            return res.status(404).json({ error: 'Не знайдено активного академічного періоду для розрахунку аналітики' });
        }

        const subjectsCountRes = await db.query(
            'SELECT COUNT(DISTINCT subject_id)::integer as count FROM schedule WHERE teacher_id = $1::integer AND is_active = TRUE AND period_id = $2::integer', 
            [teacherId, targetPeriodId]
        );
        const groupsCountRes = await db.query(
            'SELECT COUNT(DISTINCT group_id)::integer as count FROM schedule WHERE teacher_id = $1::integer AND is_active = TRUE AND period_id = $2::integer', 
            [teacherId, targetPeriodId]
        );
        const avgGradeRes = await db.query(
            'SELECT COALESCE(ROUND(AVG(grade)::numeric, 1), 0.0)::float as avg_grade FROM grades WHERE teacher_id = $1::integer AND period_id = $2::integer', 
            [teacherId, targetPeriodId]
        );

        const riskStudentsDetailedRes = await db.query(`
            WITH student_stats AS (
                SELECT student_id, subject_id, ROUND(AVG(grade)::numeric, 1)::float as avg_s_grade
                FROM grades 
                WHERE teacher_id = $1::integer AND period_id = $2::integer
                GROUP BY student_id, subject_id
            ),
            student_misses AS (
                SELECT student_id, subject_id, COUNT(*)::integer as missed_count
                FROM attendance 
                WHERE status = 'Відсутній' AND period_id = $2::integer
                  AND schedule_id IN (SELECT id FROM schedule WHERE teacher_id = $1::integer AND period_id = $2::integer)
                GROUP BY student_id, subject_id
            )
            SELECT 
                CONCAT(u.last_name, ' ', u.first_name) as student_name, grp.name as group_name, sub.name as subject_name,
                COALESCE(ss.avg_s_grade, 0.0)::float as avg_grade, COALESCE(sm.missed_count, 0)::integer as missed_lessons
            FROM students st
            JOIN users u ON u.id = st.user_id
            JOIN "groups" grp ON grp.id = st.group_id
            JOIN schedule sch ON sch.group_id = grp.id AND sch.teacher_id = $1::integer AND sch.is_active = TRUE AND sch.period_id = $2::integer
            JOIN subjects sub ON sub.id = sch.subject_id
            LEFT JOIN student_stats ss ON ss.student_id = st.id AND ss.subject_id = sub.id
            LEFT JOIN student_misses sm ON sm.student_id = st.id AND sm.subject_id = sub.id
            WHERE (ss.avg_s_grade IS NOT NULL AND ss.avg_s_grade < 60) OR (sm.missed_count IS NOT NULL AND sm.missed_count >= 2)
            GROUP BY u.last_name, u.first_name, grp.name, sub.name, ss.avg_s_grade, sm.missed_count
            ORDER BY missed_lessons DESC, avg_grade ASC LIMIT 10
        `, [teacherId, targetPeriodId]);

        const performanceAndAttendanceRes = await db.query(`
            WITH base_combinations AS (
                SELECT DISTINCT sch.group_id, sch.subject_id FROM schedule sch WHERE sch.teacher_id = $1::integer AND sch.is_active = TRUE AND sch.period_id = $2::integer
            ),
            attendance_stats AS (
                SELECT st.group_id, a.subject_id, COUNT(a.id) as total_records,
                    COUNT(CASE WHEN a.status IN ('Присутній', 'Запізнення') THEN 1 END) as present_records
                FROM attendance a 
                JOIN students st ON st.id = a.student_id
                WHERE a.period_id = $2::integer AND a.subject_id IN (SELECT subject_id FROM base_combinations) 
                GROUP BY st.group_id, a.subject_id
            ),
            grades_stats AS (
                SELECT st.group_id, g.subject_id, ROUND(AVG(g.grade)::numeric, 1)::float as avg_score
                FROM grades g 
                JOIN students st ON st.id = g.student_id 
                WHERE g.teacher_id = $1::integer AND g.period_id = $2::integer
                GROUP BY st.group_id, g.subject_id
            )
            SELECT grp.name as group_name, sub.name as subject_name, COALESCE(gs.avg_score, 0.0)::float as avg_score,
                CASE WHEN ast.total_records IS NULL OR ast.total_records = 0 THEN 0.0 ELSE ROUND(((ast.present_records::float / ast.total_records::float) * 100)::numeric, 1)::float END as attendance_pct
            FROM base_combinations bc
            JOIN subjects sub ON sub.id = bc.subject_id
            JOIN "groups" grp ON grp.id = bc.group_id
            LEFT JOIN grades_stats gs ON gs.group_id = bc.group_id AND gs.subject_id = bc.subject_id
            LEFT JOIN attendance_stats ast ON ast.group_id = bc.group_id AND ast.subject_id = bc.subject_id
            ORDER BY grp.name ASC, sub.name ASC
        `, [teacherId, targetPeriodId]);

        const performanceStatsRes = await db.query(`
            WITH student_teacher_gpa AS (
                SELECT student_id, AVG(grade) as avg_grade 
                FROM grades 
                WHERE teacher_id = $1::integer AND period_id = $2::integer
                GROUP BY student_id
            )
            SELECT 
                COUNT(CASE WHEN avg_grade >= 90 THEN 1 END)::integer AS excelent_count,
                COUNT(CASE WHEN avg_grade >= 74 AND avg_grade < 90 THEN 1 END)::integer AS good_count,
                COUNT(CASE WHEN avg_grade >= 60 AND avg_grade < 74 THEN 1 END)::integer AS satisfactory_count,
                COUNT(CASE WHEN avg_grade < 60 THEN 1 END)::integer AS fail_count
            FROM student_teacher_gpa;
        `, [teacherId, targetPeriodId]);

        const teacherGroupsRes = await db.query(`
            SELECT 
                g.name AS group_name,
                s.name AS subject_name,
                COUNT(DISTINCT st.id)::integer AS students_count
            FROM schedule sch
            JOIN "groups" g ON sch.group_id = g.id
            JOIN subjects s ON sch.subject_id = s.id
            JOIN students st ON st.group_id = g.id
            WHERE sch.teacher_id = $1::integer AND sch.is_active = TRUE AND sch.period_id = $2::integer
            GROUP BY g.id, g.name, s.id, s.name
            ORDER BY g.name ASC;
        `, [teacherId, targetPeriodId]);

        // Формуємо відповідь, адаптуючи назви полів під очікування фронтенду
        res.json({
            metrics: {
                subjects_count: subjectsCountRes.rows[0].count,
                groups_count: groupsCountRes.rows[0].count,
                avg_grade: avgGradeRes.rows[0].avg_grade,
                risk_students: riskStudentsDetailedRes.rows.length // покаже реальну кількість у зоні ризику
            },
            // Гарантуємо фронтенду наявність усіх необхідних полів (і avg_score, і avg_grade)
            chartData: performanceAndAttendanceRes.rows.map(row => ({
                ...row,
                avg_grade: row.avg_score, // про всяк випадок дублюємо для графіків
                attendance_pct: row.attendance_pct ?? 0
            })), 
            riskStudentsDetailed: riskStudentsDetailedRes.rows,
            subjectAttendance: performanceAndAttendanceRes.rows.map(row => ({
                ...row,
                attendance_pct: row.attendance_pct ?? 0
            })),
            performanceStats: performanceStatsRes.rows[0] || { excelent_count: 0, good_count: 0, satisfactory_count: 0, fail_count: 0 },
            teacherGroups: teacherGroupsRes.rows
        });
    } catch (err) {
        console.error("❌ Analytics API Error:", err);
        res.status(500).json({ error: 'Помилка розрахунку аналітики' });
    }
});

// Отримання деталей конкретного заняття
app.get('/api/teacher/lessons/details', async (req, res) => {
    const { scheduleId, date } = req.query;
    if (!scheduleId || isNaN(parseInt(scheduleId, 10)) || !date) {
        return res.status(400).json({ error: "Параметри scheduleId та date обов'язкові" });
    }

    try {
        const sId = parseInt(scheduleId, 10);
        let cleanDateStr = String(date).trim().split('T')[0];

        const detailsRes = await db.query(`
            SELECT id, theme, homework, work_type 
            FROM lessons_journal 
            WHERE schedule_id = $1::integer AND lesson_date = $2::date
        `, [sId, cleanDateStr]);

        if (detailsRes.rows.length === 0) {
            return res.json({ theme: '', homework: '', work_type: 'Пара' });
        }
        res.json(detailsRes.rows[0]);
    } catch (err) {
        console.error("❌ Teacher Get Lesson Details Error:", err);
        res.status(500).json({ error: "Помилка сервера під час отримання деталей уроку" });
    }
});

// Список студентів академічної групи для поточного заняття
app.get('/api/teacher/lesson-students', async (req, res) => {
    const scheduleId = req.query.scheduleId;
    const parsedScheduleId = parseInt(scheduleId, 10);

    if (!scheduleId || isNaN(parsedScheduleId)) {
        return res.status(400).json({ error: 'Пропущено або некоректний параметр scheduleId' });
    }

    try {
        const scheduleCheck = await db.query(`SELECT group_id FROM schedule WHERE id = $1`, [parsedScheduleId]);
        if (scheduleCheck.rows.length === 0) return res.status(404).json({ error: 'Заняття не знайдено' });

        const groupId = scheduleCheck.rows[0].group_id;
        const studentsResult = await db.query(`
            SELECT s.id AS student_id, CONCAT(u.last_name, ' ', u.first_name) AS full_name 
            FROM students s
            JOIN users u ON u.id = s.user_id
            WHERE s.group_id = $1 AND u.is_active = TRUE
            ORDER BY full_name ASC
        `, [groupId]);

        res.json({ groupId: groupId, students: studentsResult.rows });
    } catch (err) {
        console.error("❌ Помилка сервера при завантаженні студентів для заняття:", err);
        res.status(500).json({ error: 'Внутрішня помилка сервера' });
    }
});

// ==========================================================================
// адміністратор
// ==========================================================================

// Отримання повного списку користувачів з їхніми мета-даними для адмін-панелі
app.get('/api/admin/users', async (req, res) => {
    try {
        const queryText = `
            SELECT 
                u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.created_at,
                u.role_id, r.name AS role_name,
                g.id AS group_id, g.name AS group_name, g.course,
                t.id AS teacher_id, t.degree,
                d.id AS department_id, d.name AS department_name, d.short_name AS department_short,
                CASE 
                    WHEN u.role_id = 3 THEN g.id::text
                    WHEN u.role_id = 2 THEN d.id::text
                    ELSE ''
                END AS "metaValue"
            FROM users u
            JOIN roles r ON u.role_id = r.id
            LEFT JOIN students s ON u.id = s.user_id
            LEFT JOIN "groups" g ON s.group_id = g.id
            LEFT JOIN teachers t ON u.id = t.user_id
            LEFT JOIN departments d ON t.department_id = d.id
            ORDER BY u.id DESC
        `;
        const result = await db.query(queryText);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Admin Get Users Table Error:", err);
        res.status(500).json({ error: 'Помилка завантаження списку користувачів' });
    }
});
// Створення користувача
app.post('/api/admin/users', async (req, res) => {
    const { first_name, last_name, email, password, role_id, phone, metaValue, group_id, department_id } = req.body;
    let client = null;
    
    let cleanRoleId = parseInt(role_id, 10);
    if (isNaN(cleanRoleId)) cleanRoleId = 3; 

    let rawMeta = '';
    if (cleanRoleId === 3) rawMeta = group_id || metaValue;
    if (cleanRoleId === 2) rawMeta = department_id || metaValue;
    
    const cleanMeta = (rawMeta !== undefined && rawMeta !== null) ? String(rawMeta).trim() : '';

    if (!email || !first_name || !last_name) {
        return res.status(400).json({ error: 'ПІБ та Електронна пошта є обовʼязковими полями!' });
    }

    if ((cleanRoleId === 2 || cleanRoleId === 3) && !cleanMeta) {
        return res.status(400).json({ error: `Для обраної ролі обов'язково потрібно вказати ${cleanRoleId === 3 ? 'групу' : 'кафедру'}!` });
    }

    try {
        client = await db.connect();
        await client.query('BEGIN');

        const emailCheck = await client.query('SELECT id FROM users WHERE email = $1', [email.trim()]);
        if (emailCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Користувач з таким Email вже існує в системі!' });
        }

        const rawPassword = (password && password.trim() !== '') ? password : 'default_password'; 

        const userInsert = await client.query(`
            INSERT INTO users (first_name, last_name, email, password_hash, role_id, phone)
            VALUES ($1, $2, $3, crypt($4, gen_salt('bf', 8)), $5, $6) RETURNING id
        `, [first_name.trim(), last_name.trim(), email.trim(), rawPassword, cleanRoleId, phone || null]);

        const newUserId = userInsert.rows[0].id;

        if (cleanRoleId === 3) { // Студент
            let groupId = null;
            const parsedGroupId = parseInt(cleanMeta, 10);
            
            if (!isNaN(parsedGroupId)) {
                const gRes = await client.query('SELECT id FROM "groups" WHERE id = $1 LIMIT 1', [parsedGroupId]);
                if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
            } else {
                const gRes = await client.query('SELECT id FROM "groups" WHERE name = $1 LIMIT 1', [cleanMeta]);
                if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
            }

            if (groupId) {
                await client.query('INSERT INTO students (user_id, group_id) VALUES ($1, $2)', [newUserId, groupId]);
            } else {
                throw new Error('Вказану студентську групу не знайдено в базі даних!');
            }
        } else if (cleanRoleId === 2) { // Викладач
            let depId = null;
            const parsedDepId = parseInt(cleanMeta, 10);

            if (!isNaN(parsedDepId)) {
                const dRes = await client.query('SELECT id FROM departments WHERE id = $1 LIMIT 1', [parsedDepId]);
                if (dRes.rows.length > 0) depId = dRes.rows[0].id;
            } else {
                const dRes = await client.query('SELECT id FROM departments WHERE name = $1 OR short_name = $1 LIMIT 1', [cleanMeta]);
                if (dRes.rows.length > 0) depId = dRes.rows[0].id;
            }

            if (depId) {
                await client.query('INSERT INTO teachers (user_id, department_id, degree) VALUES ($1, $2, $3)', [newUserId, depId, 'Викладач']);
            } else {
                throw new Error('Вказану кафедру не знайдено в базі даних!');
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, userId: newUserId, message: 'Користувача успішно створено!' });
    } catch (err) {
        if (client) { try { await client.query('ROLLBACK'); } catch(e) {} }
        console.error("❌ Admin Create User Error:", err);
        res.status(500).json({ error: err.message || 'Помилка при створенні користувача' });
    } finally {
        if (client) client.release();
    }
});

// Редагування користувача (Профіль та зміна ролей)
app.put('/api/admin/users/:id', async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, email, password, role_id, phone, metaValue, group_id, department_id } = req.body;
    let client = null;

    const userIdInt = parseInt(id, 10);
    if (isNaN(userIdInt)) {
        return res.status(400).json({ error: 'Некоректний ID користувача!' });
    }

    try {
        client = await db.connect();
        await client.query('BEGIN');

        let cleanRoleId = parseInt(role_id, 10);
        if (isNaN(cleanRoleId)) {
            const currentRoleRes = await client.query('SELECT role_id FROM users WHERE id = $1', [userIdInt]);
            if (currentRoleRes.rows.length > 0) {
                cleanRoleId = currentRoleRes.rows[0].role_id;
            } else {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Користувача не знайдено в базі!' });
            }
        }

        let rawMeta = '';
        if (cleanRoleId === 3) rawMeta = group_id || metaValue;
        if (cleanRoleId === 2) rawMeta = department_id || metaValue;
        const cleanMeta = (rawMeta !== undefined && rawMeta !== null) ? String(rawMeta).trim() : '';

        if ((cleanRoleId === 2 || cleanRoleId === 3) && !cleanMeta) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Для цієї ролі необхідно вказати ${cleanRoleId === 3 ? 'групу' : 'кафедру'}!` });
        }

        const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.trim(), userIdInt]);
        if (emailCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Цей Email вже зайнятий іншим користувачем!' });
        }

        if (password && password.trim() !== '') {
            await client.query(`
                UPDATE users SET first_name=$1, last_name=$2, email=$3, password_hash=crypt($4, gen_salt('bf', 8)), role_id=$5, phone=$6
                WHERE id=$7
            `, [first_name.trim(), last_name.trim(), email.trim(), password, cleanRoleId, phone || null, userIdInt]);
        } else {
            await client.query(`
                UPDATE users SET first_name=$1, last_name=$2, email=$3, role_id=$4, phone=$5
                WHERE id=$6
            `, [first_name.trim(), last_name.trim(), email.trim(), cleanRoleId, phone || null, userIdInt]);
        }

        if (cleanRoleId === 3) { 
    // 1. Спочатку знаходимо id викладача, якщо він існував
    const teacherCheck = await client.query('SELECT id FROM teachers WHERE user_id = $1', [userIdInt]);
    if (teacherCheck.rows.length > 0) {
        const teacherId = teacherCheck.rows[0].id;
        
        // 2. Видаляємо всі пов'язані дані, що блокують видалення викладача
        await client.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [teacherId]);
        await client.query('DELETE FROM grades WHERE teacher_id = $1', [teacherId]);
        await client.query('DELETE FROM assignments WHERE teacher_id = $1', [teacherId]);
        
        await client.query(`
            DELETE FROM lessons_journal 
            WHERE schedule_id IN (SELECT id FROM schedule WHERE teacher_id = $1)
        `, [teacherId]);
        
        await client.query('DELETE FROM schedule WHERE teacher_id = $1', [teacherId]);
            }

            // 3. Тепер видалення з таблиці teachers пройде без помилок FOREIGN KEY
            await client.query('DELETE FROM teachers WHERE user_id = $1', [userIdInt]);

            let groupId = parseInt(cleanMeta, 10);
            if (isNaN(groupId) && cleanMeta !== '') {
                const gRes = await client.query('SELECT id FROM "groups" WHERE name = $1 LIMIT 1', [cleanMeta]);
                if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
            }

            if (groupId) {
                await client.query(`
                    INSERT INTO students (user_id, group_id) VALUES ($1, $2)
                    ON CONFLICT (user_id) DO UPDATE SET group_id = EXCLUDED.group_id
                `, [userIdInt, groupId]);
            } else {
                throw new Error('Студентську групу не знайдено!');
            }
        }
        else if (cleanRoleId === 2) { 
            await client.query('DELETE FROM students WHERE user_id = $1', [userIdInt]);

            let depId = parseInt(cleanMeta, 10);
            if (isNaN(depId) && cleanMeta !== '') {
                const dRes = await client.query('SELECT id FROM departments WHERE name = $1 OR short_name = $1 LIMIT 1', [cleanMeta]);
                if (dRes.rows.length > 0) depId = dRes.rows[0].id;
            }

            if (depId) {
                await client.query(`
                    INSERT INTO teachers (user_id, department_id, degree) VALUES ($1, $2, $3)
                    ON CONFLICT (user_id) DO UPDATE SET department_id = EXCLUDED.department_id
                `, [userIdInt, depId, 'Викладач']);
            } else {
                throw new Error('Кафедру не знайдено!');
            }
        } 
        else if (cleanRoleId === 1) { 
            await client.query('DELETE FROM students WHERE user_id = $1', [userIdInt]);
            await client.query('DELETE FROM teachers WHERE user_id = $1', [userIdInt]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Зміни збережено успішно!' });
    } catch (err) {
        if (client) { try { await client.query('ROLLBACK'); } catch(e) {} }
        console.error("❌ Admin Update User Error:", err);
        res.status(500).json({ error: err.message || 'Помилка оновлення профілю' });
    } finally {
        if (client) client.release();
    }
});

// Видалення користувача 
app.delete('/api/admin/users/:id', async (req, res) => {
    const { id } = req.params;
    let client = null;
    
    try {
        client = await db.connect();
        await client.query('BEGIN');
        const userIdInt = parseInt(id, 10);

        const userCheck = await client.query('SELECT id, role_id FROM users WHERE id = $1', [userIdInt]);
        if (userCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }

        const roleId = userCheck.rows[0].role_id;

        if (roleId === 2) { // Викладач
            const teacherRes = await client.query('SELECT id FROM teachers WHERE user_id = $1', [userIdInt]);
            if (teacherRes.rows.length > 0) {
                const teacherId = teacherRes.rows[0].id;
                
                await client.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [teacherId]);
                await client.query('DELETE FROM grades WHERE teacher_id = $1', [teacherId]);
                await client.query('DELETE FROM assignments WHERE teacher_id = $1', [teacherId]);
                
                await client.query(`
                    DELETE FROM lessons_journal 
                    WHERE schedule_id IN (SELECT id FROM schedule WHERE teacher_id = $1)
                `, [teacherId]);
                
                await client.query('DELETE FROM schedule WHERE teacher_id = $1', [teacherId]);
                await client.query('DELETE FROM teachers WHERE id = $1', [teacherId]);
            }
        }

        if (roleId === 3) { // Студент
            const studentRes = await client.query('SELECT id FROM students WHERE user_id = $1', [userIdInt]);
            if (studentRes.rows.length > 0) {
                const studentId = studentRes.rows[0].id;
                await client.query('DELETE FROM attendance WHERE student_id = $1', [studentId]);
                await client.query('DELETE FROM grades WHERE student_id = $1', [studentId]);
                await client.query('DELETE FROM students WHERE id = $1', [studentId]);
            }
        }

        await client.query('DELETE FROM users WHERE id = $1', [userIdInt]);
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Користувача та всі повʼязані дані успішно видалено' });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error("❌ Admin Delete User Error:", err);
        res.status(500).json({ error: `Помилка при видаленні: ${err.message}` });
    } finally {
        if (client) client.release();
    }
});

// Валідатор накладок у розкладі за часом, викладачем, аудиторією та групою
async function checkScheduleConflict(dbClient, data, excludeId = null) {
    const groupId = parseInt(data.group_id || data.groupId, 10);
    const teacherId = parseInt(data.teacher_id || data.teacherId, 10);
    const periodId = parseInt(data.period_id || data.periodId || data.semesterId, 10);
    const lessonNumber = parseInt(data.lesson_number || data.lessonNumber, 10);
    const dayOfWeek = parseInt(data.day_of_week || data.dayOfWeek, 10);
    const weekType = data.week_type || 'always';
    const roomName = (data.room_name || '').trim();

    let queryText = `
        SELECT id, room_name, week_type, group_id, teacher_id 
        FROM schedule 
        WHERE period_id = $1 AND day_of_week = $2 AND lesson_number = $3 AND is_active = TRUE
    `;
    const params = [periodId, dayOfWeek, lessonNumber];

    if (excludeId) {
        queryText += ` AND id != $4`;
        params.push(parseInt(excludeId, 10));
    }

    const { rows } = await dbClient.query(queryText, params);

    for (const row of rows) {
        const isWeekConflict = (weekType === 'always' || row.week_type === 'always' || weekType === row.week_type);
        
        if (isWeekConflict) {
            if (row.group_id === groupId) {
                return `Ця група вже має заняття на цій парі!`;
            }
            if (row.teacher_id === teacherId) {
                return `Викладач уже зайнятий на цій парі в іншому місці!`;
            }
            if (roomName !== '' && row.room_name.toLowerCase() === roomName.toLowerCase()) {
                return `Аудиторія ${roomName} вже зайнята іншою групою!`;
            }
        }
    }
    return null;
}

// Отримання списку викладачів для довідника
app.get('/api/admin/teachers', async (req, res) => {
    try {
        const queryText = `
            SELECT t.id, u.first_name, u.last_name, u.email, t.degree, t.department_id, d.short_name as department_name
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN departments d ON t.department_id = d.id
            ORDER BY u.last_name ASC
        `;
        const result = await db.query(queryText);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Admin Get Teachers Error:", err);
        res.status(500).json({ error: 'Помилка отримання списку викладачів' });
    }
});

// Пряма реєстрація викладача із дефолтним паролем
app.post('/api/admin/teachers', async (req, res) => {
    let { first_name, firstName, last_name, lastName, email, degree, department_id, departmentId } = req.body;
    const fName = (firstName || first_name || '').trim();
    const lName = (lastName || last_name || '').trim();
    const depId = departmentId || department_id;

    if (!fName || !lName || !email) {
        return res.status(400).json({ error: 'ПІБ та Email є обовʼязковими!' });
    }

    const client = await (db.connect ? db.connect() : db); 
    try {
        await client.query('BEGIN');
        
        const userRes = await client.query(
            `INSERT INTO users (first_name, last_name, email, password_hash, role_id) 
             VALUES ($1, $2, $3, crypt('teacher123', gen_salt('bf', 8)), 2) RETURNING id`,
            [fName, lName, email.trim().toLowerCase()]
        );
        const userId = userRes.rows[0].id;

        await client.query(
            `INSERT INTO teachers (user_id, degree, department_id) VALUES ($1, $2, $3)`,
            [userId, degree || 'Викладач', depId ? parseInt(depId, 10) : null]
        );
        
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Admin Post Teacher Error:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Користувач із такою електронною адресою вже зареєстрований!' });
        }
        res.status(500).json({ error: 'Помилка реєстрації викладача в системі' });
    } finally {
        if (db.connect && typeof client.release === 'function') client.release();
    }
});

// Оновлення профілю викладача з повторним вибіркою даних для фронтенду
app.put('/api/admin/teachers/:id', async (req, res) => {
    let { first_name, firstName, last_name, lastName, email, degree, department_id, departmentId } = req.body;
    const teacherId = parseInt(req.params.id, 10);
    const fName = (firstName || first_name || '').trim();
    const lName = (lastName || last_name || '').trim();
    const depId = departmentId || department_id;

    if (isNaN(teacherId) || !fName || !lName || !email) {
        return res.status(400).json({ error: 'ПІБ та Email є обовʼязковими для оновлення даних!' });
    }

    const client = await (db.connect ? db.connect() : db); 
    try {
        await client.query('BEGIN');
        
        await client.query(
            `UPDATE users SET first_name = $1, last_name = $2, email = $3 
             WHERE id = (SELECT user_id FROM teachers WHERE id = $4)`,
            [fName, lName, email.trim().toLowerCase(), teacherId]
        );

        await client.query(
            `UPDATE teachers SET degree = $1, department_id = $2 WHERE id = $3`,
            [degree || 'Викладач', depId ? parseInt(depId, 10) : null, teacherId]
        );

        await client.query('COMMIT');

        const updatedTeacherRes = await db.query(`
            SELECT t.id, u.first_name, u.last_name, u.email, t.degree, t.department_id, d.short_name as department_name
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN departments d ON t.department_id = d.id
            WHERE t.id = $1
        `, [teacherId]);

        if (updatedTeacherRes.rows.length === 0) {
            return res.status(404).json({ error: 'Викладача не знайдено після оновлення' });
        }

        res.json({ 
            success: true, 
            teacher: updatedTeacherRes.rows[0] 
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Admin Put Teacher Error:", err);
        res.status(500).json({ error: 'Не вдалося оновити дані викладача. Перевірте унікальність email.' });
    } finally {
        if (db.connect && typeof client.release === 'function') client.release(); 
    }
});

// Видалення викладача та очищення зв'язаних даних
app.delete('/api/admin/teachers/:id', async (req, res) => {
    const teacherId = parseInt(req.params.id, 10);
    const client = await (db.connect ? db.connect() : db);
    try {
        await client.query('BEGIN');

        const tCheck = await client.query('SELECT user_id FROM teachers WHERE id = $1', [teacherId]);
        if (tCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Викладача не знайдено' });
        }
        const userId = tCheck.rows[0].user_id;

        await client.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [teacherId]);
        await client.query('DELETE FROM schedule WHERE teacher_id = $1', [teacherId]);
        await client.query('UPDATE grades SET teacher_id = NULL WHERE teacher_id = $1', [teacherId]);
        await client.query('DELETE FROM assignments WHERE teacher_id = $1', [teacherId]);
        
        await client.query('DELETE FROM teachers WHERE id = $1', [teacherId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Викладача успішно видалено' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Admin Delete Teacher Error:", err);
        res.status(500).json({ error: `Помилка при видаленні викладача: ${err.message}` });
    } finally {
        if (db.connect && typeof client.release === 'function') client.release();
    }
});

// Отримання списку предметів за алфавітом
app.get('/api/admin/subjects', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name FROM subjects ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Admin Get Subjects Error:", err);
        res.status(500).json({ error: 'Помилка отримання списку предметів з БД' });
    }
});

// Створення нової дисципліни
app.post('/api/admin/subjects', async (req, res) => {
    const { name } = req.body;
    try {
        if (!name || !name.trim()) return res.status(400).json({ error: 'Назва предмета не може бути порожньою!' });
        await db.query('INSERT INTO subjects (name) VALUES ($1)', [name.trim()]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Admin Post Subject Error:", err);
        res.status(500).json({ error: 'Така дисципліна вже занесена до каталогу або виникла помилка БД' });
    }
});

// Редагування назви дисципліни
app.put('/api/admin/subjects/:id', async (req, res) => {
    try {
        if (!req.body.name || !req.body.name.trim()) return res.status(400).json({ error: 'Назва не може бути порожньою' });
        await db.query('UPDATE subjects SET name = $1 WHERE id = $2', [req.body.name.trim(), parseInt(req.params.id, 10)]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Admin Put Subject Error:", err);
        res.status(500).json({ error: 'Помилка зміни назви предмета' });
    }
});

// Вилучення дисципліни з каталогу
app.delete('/api/admin/subjects/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM subjects WHERE id = $1', [parseInt(req.params.id, 10)]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Admin Delete Subject Error:", err);
        res.status(500).json({ error: 'Дисципліна використовується в розкладі або матриці розподілу!' });
    }
});

// Навчальні семестри (Academic periods)
function autoCalculateWeeks(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); 
    return Math.round(diffDays / 7) || 1; 
}

// Уніфікований обробник списку семестрів для чисельних аліасів
const getSemestersHandler = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                id, 
                name, 
                semester_number, 
                TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
                TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, 
                total_weeks, 
                is_active 
            FROM academic_periods 
            ORDER BY is_active DESC, start_date DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Get Semesters Error:", err);
        res.status(500).json({ error: 'Помилка отримання семестрів з бази даних' });
    }
};

// Реєстрація розгалужених роутів-аліасів для синхронізації з фронтендом
app.get('/api/admin/semesters', getSemestersHandler);
app.get('/api/admin/periods', getSemestersHandler);
app.get('/api/academic-periods', getSemestersHandler);
app.get('/api/admin/academic-periods', getSemestersHandler);
app.get('/api/active-period', getSemestersHandler);

// Поточний активний семестр
app.get('/api/admin/academic-periods/current', async (req, res) => {
    try {
        const result = await db.query("SELECT id, name, semester_number, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, total_weeks, is_active FROM academic_periods WHERE is_active = TRUE LIMIT 1");
        if (result.rows.length === 0) {
            return res.json({ message: "Немає активного періоду", noActive: true });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Get Current Period Error:", err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Створення нового періоду
app.post('/api/admin/semesters', async (req, res) => {
    let { name, semesterNumber, semester_number, startDate, start_date, endDate, end_date, isActive, is_active } = req.body;
    
    const semNum = parseInt(semesterNumber || semester_number, 10);
    const sDate = startDate || start_date;
    const eDate = endDate || end_date;
    
    const rawActive = isActive !== undefined ? isActive : is_active;
    const active = rawActive === true || rawActive === 'true' || rawActive === 1 || rawActive === '1';

    const client = await (db.connect ? db.connect() : db); 
    try {
        if (!name || !semNum || !sDate || !eDate) {
            return res.status(400).json({ error: 'Заповніть усі обовʼязкові поля періоду!' });
        }

        const computedWeeks = autoCalculateWeeks(sDate, eDate);
        await client.query('BEGIN');
        
        if (active) {
            await client.query('UPDATE academic_periods SET is_active = FALSE');
        }

        const insertResult = await client.query(
            `INSERT INTO academic_periods (name, semester_number, start_date, end_date, total_weeks, is_active) 
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, semester_number, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, total_weeks, is_active`,
            [name.trim(), semNum, sDate, eDate, computedWeeks, active]
        );

        await client.query('COMMIT');
        res.json({ success: true, period: insertResult.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Admin Post Semester Error:", err);
        res.status(500).json({ error: 'Помилка збереження семестру в базі даних' });
    } finally {
        if (db.connect && typeof client.release === 'function') client.release();
    }
});

// Редагування існуючого періоду
app.put('/api/admin/semesters/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    let { name, semesterNumber, semester_number, startDate, start_date, endDate, end_date, isActive, is_active } = req.body;
    
    const semNum = parseInt(semesterNumber || semester_number, 10);
    const sDate = startDate || start_date;
    const eDate = endDate || end_date;
    
    const rawActive = isActive !== undefined ? isActive : is_active;
    const active = rawActive === true || rawActive === 'true' || rawActive === 1 || rawActive === '1';

    const client = await (db.connect ? db.connect() : db);
    try {
        if (!name || !semNum || !sDate || !eDate) {
            return res.status(400).json({ error: 'Заповніть усі обовʼязкові поля!' });
        }

        const computedWeeks = autoCalculateWeeks(sDate, eDate);
        await client.query('BEGIN');

        if (active) {
            await client.query('UPDATE academic_periods SET is_active = FALSE WHERE id != $1', [id]);
        }
        
        const updateResult = await client.query(
            `UPDATE academic_periods 
             SET name = $1, semester_number = $2, start_date = $3, end_date = $4, total_weeks = $5, is_active = $6
             WHERE id = $7
             RETURNING id, name, semester_number, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, total_weeks, is_active`,
            [name.trim(), semNum, sDate, eDate, computedWeeks, active, id]
        );

        await client.query('COMMIT');
        res.json({ success: true, period: updateResult.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Admin Put Semester Error:", err);
        res.status(500).json({ error: 'Помилка оновлення семестру' });
    } finally {
        if (db.connect && typeof client.release === 'function') client.release();
    }
});

// Видалення періоду навчання
app.delete('/api/admin/semesters/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await db.query('DELETE FROM academic_periods WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Період не знайдено' });
        res.json({ success: true });
    } catch (err) {
        console.error("Admin Delete Semester Error:", err);
        res.status(500).json({ error: 'Неможливо вилучити період! Він уже містить активний розклад, оцінки чи розподіл навантаження.' });
    }
});

// Спеціальний роут-аліас поточного семестру із кастомним маппінгом об'єкта під фронтенд
app.get('/api/settings/current-semester', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT id, name, semester_number, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, total_weeks, is_active 
            FROM academic_periods WHERE is_active = TRUE LIMIT 1
        `);
        
        if (result.rows.length === 0) {
            return res.status(200).json({ message: "Немає активного періоду", noActive: true });
        }
        
        const period = result.rows[0];
        res.json({
            id: period.id,
            name: period.name,
            number: period.semester_number,
            startDate: period.start_date,
            endDate: period.end_date,
            weeks: period.total_weeks,
            isActive: period.is_active
        });
    } catch (err) {
        console.error("Get Current Period Error:", err);
        res.status(500).json({ error: 'Помилка сервера при отриманні поточного семестру' });
    }
});

// Матриця розподілу навантаження (Teacher subjects)
const FETCH_LOAD_ASSIGNMENT_SQL = `
    SELECT 
        ts.id AS id, ts.teacher_id AS teacher_id, ts.subject_id AS subject_id, ts.group_id AS group_id, ts.period_id AS period_id, ts.period_id AS semester_id,
        COALESCE(u.last_name || ' ' || u.first_name, 'Невідомий викладач') AS teacher_name,
        COALESCE(s.name, 'Без назви') AS subject_name,
        COALESCE(g.name, 'Без групи') AS group_name,
        COALESCE(ap.name, 'Без періоду') AS semester_name
    FROM teacher_subjects ts
    LEFT JOIN teachers t ON ts.teacher_id = t.id
    LEFT JOIN users u ON t.user_id = u.id
    LEFT JOIN subjects s ON ts.subject_id = s.id
    LEFT JOIN "groups" g ON ts.group_id = g.id
    LEFT JOIN academic_periods ap ON ts.period_id = ap.id
`;

// Отримання карти навантаження
app.get('/api/admin/teacher-subjects', async (req, res) => {
    try {
        const { period_id } = req.query;
        let queryText = FETCH_LOAD_ASSIGNMENT_SQL;
        const queryParams = [];
        
        if (period_id && period_id !== 'undefined' && period_id.trim() !== '') {
            queryText += ` WHERE ts.period_id = $1`;
            queryParams.push(parseInt(period_id, 10));
        } else {
            queryText += ` WHERE ap.is_active = TRUE`; 
        }
        
        queryText += ` ORDER BY teacher_name ASC, group_name ASC, subject_name ASC`;
        const result = await db.query(queryText, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error("Помилка отримання всієї карти навантаження:", err);
        res.status(500).json({ error: 'Помилка виконання SQL-запиту на сервері.' });
    }
});

// Отримання картки окремого запису розподілу
app.get('/api/admin/teacher-subjects/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Некоректний ID запису' });

    try {
        const result = await db.query(`SELECT id, teacher_id, subject_id, group_id, period_id FROM teacher_subjects WHERE id = $1`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Запис розподілу навантаження не знайдено' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Error fetching single teacher-subject row:", err);
        res.status(500).json({ error: 'Помилка сервера при отриманні картки запису' });
    }
});

// Закріплення дисципліни за викладачем
app.post('/api/admin/teacher-subjects', async (req, res) => {
    const { teacherId, teacher_id, subjectId, subject_id, groupId, group_id, periodId, period_id, semesterId } = req.body;
    
    const tId = parseInt(teacherId || teacher_id, 10);
    const sId = parseInt(subjectId || subject_id, 10);
    const gId = parseInt(groupId || group_id, 10);
    const pId = parseInt(periodId || period_id || semesterId, 10);

    // 1. Базова перевірка форматів даних
    if (isNaN(tId) || isNaN(sId) || isNaN(gId) || isNaN(pId)) {
        return res.status(400).json({ error: 'Будь ласка, заповніть усі поля форми розподілу навантаження коректними даними!' });
    }

    try {
        // 2. Валідація зовнішніх ключів (Foreign Keys Validation)
        // Перевіряємо, чи існує дисципліна
        const subjectCheck = await db.query('SELECT id FROM subjects WHERE id = $1', [sId]);
        if (subjectCheck.rows.length === 0) {
            return res.status(400).json({ 
                error: `Помилка! Дисципліну з ID ${sId} не знайдено в базі даних. Можливо, її було видалено. Оновіть сторінку.` 
            });
        }

        // Перевіряємо, чи існує викладач
        const teacherCheck = await db.query('SELECT id FROM teachers WHERE id = $1', [tId]);
        if (teacherCheck.rows.length === 0) {
            return res.status(400).json({ 
                error: `Помилка! Викладача з ID ${tId} не знайдено в системі.` 
            });
        }

        // Перевіряємо, чи існує група
        const groupCheck = await db.query('SELECT id FROM "groups" WHERE id = $1', [gId]);
        if (groupCheck.rows.length === 0) {
            return res.status(400).json({ 
                error: `Помилка! Академічну групу з ID ${gId} не знайдено.` 
            });
        }

        // Перевіряємо, чи існує період навчання (семестр)
        const periodCheck = await db.query('SELECT id FROM academic_periods WHERE id = $1', [pId]);
        if (periodCheck.rows.length === 0) {
            return res.status(400).json({ 
                error: `Помилка! Семестр/період з ID ${pId} не знайдено.` 
            });
        }

        // 3. Якщо всі перевірки пройдено — виконуємо безпечний INSERT
        const insertResult = await db.query(
            `INSERT INTO teacher_subjects (teacher_id, subject_id, group_id, period_id) VALUES ($1, $2, $3, $4) RETURNING id`, 
            [tId, sId, gId, pId]
        );
        
        const finalRow = await db.query(`${FETCH_LOAD_ASSIGNMENT_SQL} WHERE ts.id = $1`, [insertResult.rows[0].id]);
        res.json({ success: true, message: 'Навантаження успішно розподілено', assignment: finalRow.rows[0] });
        
    } catch (err) {
        console.error("Teacher-Subject Insertion Conflict Error:", err);
        
        if (err.code === '23505') { 
            return res.status(400).json({ error: 'Конфлікт! Ця дисципліна вже закріплена за цим викладачем та цією групою в поточному семестрі.' });
        }
        
        // Перехоплення помилок цілісності, якщо якась перевірка проскочила
        if (err.code === '23503') {
            return res.status(400).json({ error: 'Помилка звʼязків даних! Перевірте правильність вибору викладача, предмета та групи.' });
        }
        
        res.status(500).json({ error: 'Помилка бази даних при збереженні розподілу навантаження' });
    }
});

// Зміна параметрів закріпленого навантаження
app.put('/api/admin/teacher-subjects/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { teacher_id, teacherId, subject_id, subjectId, group_id, groupId, period_id, periodId, semesterId } = req.body;

    const tId = parseInt(teacher_id || teacherId, 10);
    const sId = parseInt(subject_id || subjectId, 10);
    const gId = parseInt(group_id || groupId, 10);
    const pId = parseInt(period_id || periodId || semesterId, 10);

    if (isNaN(id) || isNaN(tId) || isNaN(sId) || isNaN(gId) || isNaN(pId)) {
        return res.status(400).json({ error: 'Усі поля є обовʼязковими для оновлення запису!' });
    }

    try {
        const result = await db.query(
            `UPDATE teacher_subjects SET teacher_id = $1, subject_id = $2, group_id = $3, period_id = $4 WHERE id = $5`,
            [tId, sId, gId, pId, id]
        );

        if (result.rowCount === 0) return res.status(404).json({ error: 'Запис для оновлення не знайдено' });

        const updatedRow = await db.query(`${FETCH_LOAD_ASSIGNMENT_SQL} WHERE ts.id = $1`, [id]);
        res.json({ success: true, message: 'Розподіл навантаження успішно оновлено', assignment: updatedRow.rows[0] });
    } catch (err) {
        console.error("Teacher-Subject Update Error:", err);
        if (err.code === '23505') return res.status(400).json({ error: 'Конфлікт: такое призначення вже існує в базі даних на цей семестр!' });
        res.status(500).json({ error: 'Помилка сервера при оновленні матриці навантаження' });
    }
});

// Видалення зв'язку з матриці семестру
app.delete('/api/admin/teacher-subjects/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Некоректний ID для видалення' });

    try {
        const result = await db.query('DELETE FROM teacher_subjects WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Призначення навантаження не знайдено або вже видалено раніше' });
        res.json({ success: true, message: 'Запис успішно видалено з матриці семестру' });
    } catch (err) {
        console.error("Teacher-Subject Deletion Error:", err);
        res.status(500).json({ error: 'Не вдалося видалити призначення! Можливо, для цієї комбінації вже створено розклад або виставлено оцінки.' });
    }
});

// Дублюючий роут-аліас навантаження для фронтенду
app.get('/api/assignments', async (req, res) => {
    try {
        const { period_id } = req.query;
        let queryText = FETCH_LOAD_ASSIGNMENT_SQL;
        const queryParams = [];
        
        if (period_id && period_id !== 'undefined' && period_id.trim() !== '') {
            queryText += ` WHERE ts.period_id = $1`;
            queryParams.push(parseInt(period_id, 10));
        } else {
            queryText += ` WHERE ap.is_active = TRUE`; 
        }
        
        queryText += ` ORDER BY teacher_name ASC, group_name ASC, subject_name ASC`;
        const result = await db.query(queryText, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error("Помилка отримання всієї карти навантаження через аліас:", err);
        res.status(500).json({ error: 'Помилка виконання SQL-запиту на сервері.' });
    }
});

// Фільтрація та валідація конфліктів розкладу
app.get('/api/admin/schedule/filter-meta', async (req, res) => {
    try {
        const groupId = parseInt(req.query.group_id, 10);
        const periodId = req.query.period_id ? parseInt(req.query.period_id, 10) : null; 

        if (!groupId || isNaN(groupId)) {
            return res.status(400).json({ error: 'Параметр group_id є обовʼязковим та має бути числом' });
        }

        let targetPeriodId = periodId;
        if (!targetPeriodId) {
            const activePeriodRes = await db.query('SELECT id FROM academic_periods WHERE is_active = true LIMIT 1');
            targetPeriodId = activePeriodRes.rows[0]?.id || null;
        }

        if (!targetPeriodId) {
            return res.status(400).json({ error: 'Не вказано семестр і немає активного семестру в системі.' });
        }

        const subjectsQuery = `
            SELECT DISTINCT s.id, s.name 
            FROM teacher_subjects ts 
            JOIN subjects s ON ts.subject_id = s.id 
            WHERE ts.group_id = $1 AND ts.period_id = $2
            ORDER BY s.name ASC`;
            
        const teachersQuery = `
            SELECT DISTINCT t.id, u.last_name, u.first_name 
            FROM teacher_subjects ts 
            JOIN teachers t ON ts.teacher_id = t.id 
            JOIN users u ON t.user_id = u.id 
            WHERE ts.group_id = $1 AND ts.period_id = $2
            ORDER BY u.last_name ASC`;
            
        const matrixQuery = `
            SELECT DISTINCT teacher_id, subject_id 
            FROM teacher_subjects 
            WHERE group_id = $1 AND period_id = $2`;

        const [subjectsRes, teachersRes, matrixRes] = await Promise.all([
            db.query(subjectsQuery, [groupId, targetPeriodId]),
            db.query(teachersQuery, [groupId, targetPeriodId]),
            db.query(matrixQuery, [groupId, targetPeriodId])
        ]);

        const formattedTeachers = teachersRes.rows.map(t => ({
            id: t.id,
            name: `${t.last_name || ''} ${t.first_name || ''}`.trim()
        }));

        res.json({ subjects: subjectsRes.rows, teachers: formattedTeachers, load_matrix: matrixRes.rows });
    } catch (err) {
        console.error("Помилка сервера при генерації мета-даних групи:", err);
        res.status(500).json({ error: 'Внутрішня помилка сервера при фільтрації навантаження.' });
    }
});

// Валідація накладок часу/аудиторій перед фіксацією пари в розкладі
app.post('/api/admin/schedule/validate-conflict', async (req, res) => {
    try {
        if (req.body.is_stream === true || req.body.is_stream === 'true') {
            return res.json({ success: true, message: "Потокова пара: конфлікти дозволено." });
        }
        if (typeof checkScheduleConflict === 'function') {
            const conflictError = await checkScheduleConflict(db, req.body, req.body.id);
            if (conflictError) return res.status(400).json({ error: conflictError });
        }
        return res.json({ success: true, message: "Конфліктів не виявлено" });
    } catch (err) {
        console.error("Валідація конфлікту впала:", err);
        res.status(500).json({ error: "Помилка сервера при валідації часу." });
    }
});

// Сітка розкладу та журнал керування заняттями (Schedule & cancel)
app.post('/api/admin/schedule/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const { date, period_id } = req.query; 

    if (!date) return res.status(400).json({ error: 'Не вказано дату для скасування заняття!' });

    try {
        const targetPeriodId = period_id ? parseInt(period_id, 10) : null;
        const periodCheck = await checkAcademicPeriodAndVacation(db, date, targetPeriodId);
        if (periodCheck.error) return res.status(400).json({ error: periodCheck.error });

        const cancelQuery = `
            INSERT INTO lessons_journal (schedule_id, lesson_date, is_cancelled_today, theme, period_id)
            VALUES ($1, $2::date, TRUE, 'Скасовано адміністратором', $3)
            ON CONFLICT (schedule_id, lesson_date) DO UPDATE SET is_cancelled_today = TRUE RETURNING *
        `;
        await db.query(cancelQuery, [parseInt(id, 10), date, periodCheck.period.id]);
        return res.json({ success: true, message: 'Пару успішно скасовано на сьогодні!' });
    } catch (err) {
        console.error("Cancel lesson error:", err);
        return res.status(500).json({ error: 'Помилка сервера при скасуванні пари.' });
    }
});

// Допоміжний внутрішній сервіс валідації рамок семестру та детекту канікул
async function checkAcademicPeriodAndVacation(db, dateStr, customPeriodId = null) {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    let periodQuery = `SELECT id, start_date, end_date, is_active FROM academic_periods`;
    let params = [];

    if (customPeriodId && !isNaN(customPeriodId)) {
        periodQuery += ` WHERE id = $1`;
        params.push(parseInt(customPeriodId, 10));
    } else {
        periodQuery += ` WHERE ($1::date BETWEEN start_date AND end_date) OR is_active = TRUE ORDER BY is_active DESC LIMIT 1`;
        params.push(targetDate);
    }

    const res = await db.query(periodQuery, params);
    if (res.rows.length === 0) return { error: 'Не знайдено жодного навчального семестру у базі даних.', period: null };

    const period = res.rows[0];
    const formatDate = (d) => new Date(d).toISOString().split('T')[0];
    const startStr = formatDate(period.start_date);
    const endStr = formatDate(period.end_date);

    if (targetDate < startStr || targetDate > endStr) {
        return { error: 'На вказану дату неможливо внести зміни! Період визначено як канікули.', period };
    }
    return { error: null, period };
}

// Отримання повної сітки розкладу на семестр
app.get('/api/admin/schedule/all', async (req, res) => {
    const { date, period_id } = req.query; 
    const targetDate = date || new Date().toISOString().split('T')[0];
    const targetPeriodId = period_id ? parseInt(period_id, 10) : null;

    try {
        const periodCheck = await checkAcademicPeriodAndVacation(db, targetDate, targetPeriodId);
        if (periodCheck.error) {
            return res.json({ isVacation: true, message: periodCheck.error, data: [] });
        }

        let queryText = `
            SELECT 
                s.id, s.lesson_number, s.room_name, s.day_of_week, s.week_type, s.is_active,
                g.id as group_id, g.name as group_name, g.course as group_course, g.department_id as department_id,
                sub.id as subject_id, sub.name as subject_name, t.id as teacher_id,
                u.last_name || ' ' || LEFT(u.first_name, 1) || '.' as teacher_name,
                ap.id as period_id, ap.name as period_name,
                COALESCE(j.is_cancelled_today, FALSE) as is_cancelled_today
            FROM schedule s
            JOIN "groups" g ON s.group_id = g.id
            JOIN subjects sub ON s.subject_id = sub.id
            JOIN teachers t ON s.teacher_id = t.id
            JOIN users u ON t.user_id = u.id
            LEFT JOIN academic_periods ap ON s.period_id = ap.id
            LEFT JOIN lessons_journal j ON s.id = j.schedule_id AND j.lesson_date::date = $1::date
            WHERE s.period_id = $2
            ORDER BY s.day_of_week ASC, s.lesson_number ASC
        `;
        
        const result = await db.query(queryText, [targetDate, periodCheck.period.id]);
        res.json(result.rows);
    } catch (err) {
        console.error("Admin Get Schedule Error:", err);
        res.status(500).json({ error: 'Помилка отримання розкладу з БД' });
    }
});

// Додання нової пари
app.post('/api/admin/schedule', async (req, res) => {
    const { group_id, subject_id, teacher_id, lesson_number, room_name, day_of_week, week_type, period_id, target_date, is_stream } = req.body;

    if (!group_id || !subject_id || !teacher_id || !lesson_number || !room_name || !day_of_week) {
        return res.status(400).json({ error: 'Заповніть усі обовʼязкові поля розкладу!' });
    }

    try {
        const dateToCheck = target_date || new Date().toISOString().split('T')[0];
        const targetPeriodId = period_id ? parseInt(period_id, 10) : null;
        const periodCheck = await checkAcademicPeriodAndVacation(db, dateToCheck, targetPeriodId);
        
        if (periodCheck.error) {
            return res.status(400).json({ error: periodCheck.error });
        }

        const finalPeriodId = periodCheck.period.id;

        if (!(is_stream === true || is_stream === 'true') && typeof checkScheduleConflict === 'function') {
            const conflictError = await checkScheduleConflict(db, { ...req.body, period_id: finalPeriodId });
            if (conflictError) return res.status(400).json({ error: conflictError });
        }

        const queryText = `
            INSERT INTO schedule 
            (group_id, subject_id, teacher_id, lesson_number, room_name, day_of_week, week_type, period_id, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE) 
            RETURNING *
        `;
        const values = [
            parseInt(group_id, 10), 
            parseInt(subject_id, 10), 
            parseInt(teacher_id, 10), 
            parseInt(lesson_number, 10), 
            room_name.trim(), 
            parseInt(day_of_week, 10), 
            week_type || 'always', 
            finalPeriodId
        ];
        
        const result = await db.query(queryText, values);
        return res.status(201).json({ success: true, message: 'Заняття успішно додано', lesson: result.rows[0] });

    } catch (err) {
        console.error("Admin Create Schedule Error:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Конфлікт! Дана група вже має пару на цей час.' });
        }
        return res.status(500).json({ error: 'Внутрішня помилка сервера при збереженні.' });
    }
});

// Редагування запису розкладу
app.put('/api/admin/schedule/:id', async (req, res) => {
    const { id } = req.params;
    const { group_id, subject_id, teacher_id, lesson_number, room_name, day_of_week, week_type, is_active, period_id, target_date, is_stream } = req.body;

    if (!group_id || !subject_id || !teacher_id || !lesson_number || !room_name || !day_of_week) {
        return res.status(400).json({ error: 'Необхідно заповнити ключові поля для перезапису!' });
    }

    try {
        const dateToCheck = target_date || new Date().toISOString().split('T')[0];
        const targetPeriodId = period_id ? parseInt(period_id, 10) : null;
        const periodCheck = await checkAcademicPeriodAndVacation(db, dateToCheck, targetPeriodId);
        
        if (periodCheck.error) {
            return res.status(400).json({ error: periodCheck.error });
        }

        const finalPeriodId = periodCheck.period.id;
        const isActiveBool = is_active === true || is_active === 'true' || is_active === undefined;

        if (!(is_stream === true || is_stream === 'true') && typeof checkScheduleConflict === 'function') {
            const conflictError = await checkScheduleConflict(db, { ...req.body, id: parseInt(id, 10), period_id: finalPeriodId }, id);
            if (conflictError) return res.status(400).json({ error: conflictError });
        }

        const queryText = `
            UPDATE schedule 
            SET group_id = $1, subject_id = $2, teacher_id = $3, lesson_number = $4, 
                room_name = $5, day_of_week = $6, week_type = $7, is_active = $8, period_id = $9
            WHERE id = $10 RETURNING *
        `;
        const values = [
            parseInt(group_id, 10), 
            parseInt(subject_id, 10), 
            parseInt(teacher_id, 10), 
            parseInt(lesson_number, 10), 
            room_name.trim(), 
            parseInt(day_of_week, 10), 
            week_type, 
            isActiveBool, 
            finalPeriodId,
            parseInt(id, 10)
        ];
        
        const result = await db.query(queryText, values);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Заняття з таким ID не знайдено' });

        res.json({ success: true, message: 'Розклад успішно оновлено', lesson: result.rows[0] });
    } catch (err) {
        console.error("Admin Update Schedule Error:", err);
        if (err.code === '23505') return res.status(400).json({ error: 'Помилка унікальності! Час або аудиторія вже зайняті.' });
        res.status(500).json({ error: 'Помилка при оновленні розкладу.' });
    }
});

// Повне видалення назавжди
app.delete('/api/admin/schedule/:id', async (req, res) => {
    const { id } = req.params;
    const scheduleId = parseInt(id, 10);

    if (isNaN(scheduleId)) {
        return res.status(400).json({ error: 'Некоректний ID обʼєкта розкладу.' });
    }

    const client = await db.connect(); 
    try {
        await client.query('BEGIN');

        await client.query('DELETE FROM grades WHERE schedule_id = $1', [scheduleId]);
        await client.query('DELETE FROM attendance WHERE schedule_id = $1', [scheduleId]);
        await client.query('DELETE FROM lessons_journal WHERE schedule_id = $1', [scheduleId]);
        
        const result = await client.query('DELETE FROM schedule WHERE id = $1 RETURNING id', [scheduleId]);
        
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Такого заняття вже немає в системі.' });
        }

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Пару та повʼязані логи успешно видалено!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Delete schedule error:", err);
        return res.status(500).json({ error: `Помилка сервера при видаленні пари: ${err.message || err}` });
    } finally {
        client.release();
    }
});

app.get('/api/admin/courses', (req, res) => {
    res.json([1, 2, 3, 4]); 
});

// Кафедри та групи
app.get('/api/admin/departments', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, short_name FROM departments ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error("Admin Get Departments Error:", err);
        res.status(500).json({ error: 'Помилка отримання списку кафедр' });
    }
});

app.post('/api/admin/departments', async (req, res) => {
    let { name, shortName, short_name } = req.body;
    const sName = shortName || short_name;
    
    if (!name || !sName) {
        return res.status(400).json({ error: 'Назва та абревіатура обовʼязкові!' });
    }

    try {
        await db.query(
            'INSERT INTO departments (name, short_name) VALUES ($1, $2)', 
            [name.toString().trim(), sName.toString().trim().toUpperCase()]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Admin Post Department Error:", err);
        res.status(500).json({ error: 'Кафедра з такою назвою або коротким кодом вже існує' });
    }
});

app.put('/api/admin/departments/:id', async (req, res) => {
    let { name, shortName, short_name } = req.body;
    const sName = shortName || short_name;
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || !name || !sName) {
        return res.status(400).json({ error: 'Некоректні дані для оновлення кафедри!' });
    }

    try {
        await db.query(
            'UPDATE departments SET name = $1, short_name = $2 WHERE id = $3', 
            [name.toString().trim(), sName.toString().trim().toUpperCase(), id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Admin Put Department Error:", err);
        res.status(500).json({ error: 'Помилка модифікації даних кафедри' });
    }
});

// Видалення кафедри з каскадним очищенням залежностей
app.delete('/api/admin/departments/:id', async (req, res) => {
    const departmentId = parseInt(req.params.id, 10);
    
    if (isNaN(departmentId)) {
        return res.status(400).json({ error: 'Некоректний ID кафедри' });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // Очищення логів груп цієї кафедри
        await client.query(`
            DELETE FROM lessons_journal 
            WHERE schedule_id IN (SELECT id FROM schedule WHERE group_id IN (SELECT id FROM "groups" WHERE department_id = $1))
        `, [departmentId]);

        await client.query(`
            DELETE FROM attendance 
            WHERE schedule_id IN (SELECT id FROM schedule WHERE group_id IN (SELECT id FROM "groups" WHERE department_id = $1))
        `, [departmentId]);

        await client.query(`
            DELETE FROM grades 
            WHERE student_id IN (SELECT id FROM students WHERE group_id IN (SELECT id FROM "groups" WHERE department_id = $1))
               OR schedule_id IN (SELECT id FROM schedule WHERE group_id IN (SELECT id FROM "groups" WHERE department_id = $1))
        `, [departmentId]);

        // Очищення логів викладачів цієї кафедри
        await client.query(`
            DELETE FROM lessons_journal 
            WHERE schedule_id IN (SELECT id FROM schedule WHERE teacher_id IN (SELECT id FROM teachers WHERE department_id = $1))
        `, [departmentId]);

        await client.query(`
            DELETE FROM attendance 
            WHERE schedule_id IN (SELECT id FROM schedule WHERE teacher_id IN (SELECT id FROM teachers WHERE department_id = $1))
        `, [departmentId]);

        await client.query(`
            DELETE FROM grades 
            WHERE schedule_id IN (SELECT id FROM schedule WHERE teacher_id IN (SELECT id FROM teachers WHERE department_id = $1))
        `, [departmentId]);

        // Розклад, навантаження, завдання
        await client.query(`
            DELETE FROM schedule 
            WHERE group_id IN (SELECT id FROM "groups" WHERE department_id = $1)
               OR teacher_id IN (SELECT id FROM teachers WHERE department_id = $1)
        `, [departmentId]);

        await client.query(`
            DELETE FROM teacher_subjects 
            WHERE teacher_id IN (SELECT id FROM teachers WHERE department_id = $1)
               OR group_id IN (SELECT id FROM "groups" WHERE department_id = $1)
        `, [departmentId]);

        await client.query(`
            DELETE FROM assignments 
            WHERE teacher_id IN (SELECT id FROM teachers WHERE department_id = $1)
        `, [departmentId]);

        // Вибірка user_id для безпечного видалення з таблиці users
        const usersToDelRes = await client.query(`
            SELECT user_id FROM students WHERE group_id IN (SELECT id FROM "groups" WHERE department_id = $1)
            UNION
            SELECT user_id FROM teachers WHERE department_id = $1
        `, [departmentId]);
        const userIds = usersToDelRes.rows.map(r => r.user_id);

        // Видалення зв'язаних сутностей для зняття Foreign Keys
        await client.query(`
            DELETE FROM students WHERE group_id IN (SELECT id FROM "groups" WHERE department_id = $1)
        `, [departmentId]);
        
        await client.query(`
            DELETE FROM teachers WHERE department_id = $1
        `, [departmentId]);

        // Видалення користувачів
        if (userIds.length > 0) {
            await client.query('DELETE FROM users WHERE id = ANY($1::integer[])', [userIds]);
        }

        // Очищення базових сутностей
        await client.query('DELETE FROM "groups" WHERE department_id = $1', [departmentId]);
        const result = await client.query('DELETE FROM departments WHERE id = $1', [departmentId]);

        await client.query('COMMIT');

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Кафедру не знайдено' });
        }

        res.json({ success: true, message: 'Кафедру, викладачів, групи та студентів успішно видалено з системи!' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Admin Delete Department Error:", err);
        res.status(500).json({ error: `Критична помилка при видаленні кафедри: ${err.message || err}` });
    } finally {
        client.release();
    }
});

// Видалення окремої групи
app.delete('/api/admin/groups/:id', async (req, res) => {
    const groupId = parseInt(req.params.id, 10);

    if (isNaN(groupId)) {
        return res.status(400).json({ error: 'Некоректний ID групи' });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await client.query('DELETE FROM lessons_journal WHERE schedule_id IN (SELECT id FROM schedule WHERE group_id = $1)', [groupId]);
        await client.query('DELETE FROM attendance WHERE schedule_id IN (SELECT id FROM schedule WHERE group_id = $1)', [groupId]);
        await client.query('DELETE FROM grades WHERE student_id IN (SELECT id FROM students WHERE group_id = $1) OR schedule_id IN (SELECT id FROM schedule WHERE group_id = $1)', [groupId]);
        await client.query('DELETE FROM schedule WHERE group_id = $1', [groupId]);
        await client.query('DELETE FROM teacher_subjects WHERE group_id = $1', [groupId]);
        
        const studentUsersRes = await client.query('SELECT user_id FROM students WHERE group_id = $1', [groupId]);
        const studentUserIds = studentUsersRes.rows.map(r => r.user_id);

        await client.query('DELETE FROM students WHERE group_id = $1', [groupId]);

        if (studentUserIds.length > 0) {
            await client.query('DELETE FROM users WHERE id = ANY($1::integer[])', [studentUserIds]);
        }

        const result = await client.query('DELETE FROM "groups" WHERE id = $1', [groupId]);

        await client.query('COMMIT');

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Групу не знайдено' });
        }

        res.json({ success: true, message: 'Групу та всіх її студентів успішно видалено!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Admin Delete Group Error:", err);
        res.status(500).json({ error: `Критична помилка при видаленні групи: ${err.message || err}` });
    } finally {
        client.release();
    }
});

app.get('/api/admin/groups', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT g.id, g.name, g.course, g.department_id, d.short_name as department_name
            FROM "groups" g
            LEFT JOIN departments d ON g.department_id = d.id
            ORDER BY g.course ASC, g.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Admin Get Groups Error:", err);
        res.status(500).json({ error: 'Помилка отримання груп' });
    }
});

app.post('/api/admin/groups', async (req, res) => {
    let { name, course, departmentId, department_id } = req.body;
    const depId = departmentId || department_id;
    
    if (!name || !course || !depId) {
        return res.status(400).json({ error: 'Заповніть назву, курс та кафедру!' });
    }

    try {
        await db.query(
            'INSERT INTO "groups" (name, course, department_id) VALUES ($1, $2, $3)', 
            [name.toString().trim(), parseInt(course, 10), parseInt(depId, 10)]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Admin Post Group Error:", err);
        res.status(500).json({ error: 'Група з такою назвою вже присутня в базі даних' });
    }
});

app.put('/api/admin/groups/:id', async (req, res) => {
    let { name, course, departmentId, department_id } = req.body;
    const depId = departmentId || department_id;
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || !name || !course || !depId) {
        return res.status(400).json({ error: 'Некоректні дані для зміни групи!' });
    }

    try {
        await db.query(
            'UPDATE "groups" SET name = $1, course = $2, department_id = $3 WHERE id = $4', 
            [name.toString().trim(), parseInt(course, 10), parseInt(depId, 10), id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Admin Put Group Error:", err);
        res.status(500).json({ error: 'Помилка редагування параметрів групи' });
    }
});

app.get('/api/admin/analytics/filter-meta', async (req, res) => {
    const { specialty } = req.query;
    try {
        let courseQuery = 'SELECT DISTINCT g.course FROM "groups" g';
        let params = [];
       
        if (specialty && specialty !== 'all') {
            if (isNaN(specialty)) {
                courseQuery += ' JOIN departments d ON g.department_id = d.id WHERE d.short_name = $1';
            } else {
                courseQuery += ' WHERE g.department_id = $1';
            }
            params.push(specialty);
        }
        courseQuery += ' ORDER BY g.course ASC';
       
        const coursesRes = await db.query(courseQuery, params);
        const courses = coursesRes.rows.map(r => r.course);

        res.json({ courses: courses });
    } catch (err) {
        console.error('Помилка завантаження мета-фільтрів:', err);
        res.status(500).json({ courses: [] });
    }
});

// Допоміжна функція для отримання активного семестру, якщо periodId не передано
async function getActivePeriodId() {
    const res = await db.query('SELECT id FROM academic_periods WHERE is_active = true LIMIT 1');
    return res.rows[0]?.id || null;
}
// Генерація звітів (ізоляція за семестрами)
app.get('/api/admin/reports/build', async (req, res) => {
    const { type, dept, course, group, start, end, periodId } = req.query;

    try {
        const targetPeriodId = periodId ? parseInt(periodId, 10) : await getActivePeriodId();

        let conditions = [];
        let params = [];
        let paramIdx = 1;

        if (group && group !== 'all' && group.trim() !== '') {
            conditions.push(`g.id = $${paramIdx}::integer`);
            params.push(parseInt(group, 10));
            paramIdx++;
        }

        if (course && course !== 'all' && course.trim() !== '') {
            conditions.push(`g.course = $${paramIdx}::integer`);
            params.push(parseInt(course, 10));
            paramIdx++;
        }

        if (dept && dept !== 'all' && dept.trim() !== '') {
            if (/^\d+$/.test(dept)) {
                conditions.push(`g.department_id = $${paramIdx}::integer`);
                params.push(parseInt(dept, 10));
            } else {
                conditions.push(`d.short_name = $${paramIdx}`);
                params.push(dept);
            }
            paramIdx++;
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        let mainQuery = "";

        if (type === 'success') {
            let gradeConditions = [`gr.period_id = $${paramIdx}::integer`]; 
            params.push(targetPeriodId);
            paramIdx++;

            if (start && start.trim() !== '') {
                gradeConditions.push(`gr.graded_at >= $${paramIdx}::date`);
                params.push(start);
                paramIdx++;
            }
            if (end && end.trim() !== '') {
                gradeConditions.push(`gr.graded_at <= $${paramIdx}::date`);
                params.push(end);
                paramIdx++;
            }

            const joinGradesOn = `ON s.id = gr.student_id AND ` + gradeConditions.join(' AND ');

            mainQuery = `
                SELECT
                    u.last_name || ' ' || u.first_name AS name,
                    g.name AS group_name,
                    COALESCE(ROUND(AVG(gr.grade)::numeric, 1), 0.0) AS score,
                    CASE
                        WHEN COUNT(gr.id) = 0 THEN 'Немає оцінок'
                        WHEN AVG(gr.grade) >= 90 THEN 'Відмінно'
                        WHEN AVG(gr.grade) >= 82 THEN 'Дуже добре'
                        WHEN AVG(gr.grade) >= 74 THEN 'Добре'
                        WHEN AVG(gr.grade) >= 60 THEN 'Задовільно'
                        ELSE 'Незадовільно'
                    END AS status
                FROM students s
                JOIN users u ON s.user_id = u.id
                JOIN "groups" g ON s.group_id = g.id
                LEFT JOIN departments d ON g.department_id = d.id
                LEFT JOIN grades gr ${joinGradesOn}
                ${whereClause}
                GROUP BY u.id, u.last_name, u.first_name, g.name
                ORDER BY u.last_name ASC, u.first_name ASC;
            `;
        } else {
            let attConditions = [`att.period_id = $${paramIdx}::integer`]; 
            params.push(targetPeriodId);
            paramIdx++;

            if (start && start.trim() !== '') {
                attConditions.push(`att.lesson_date >= $${paramIdx}::date`);
                params.push(start);
                paramIdx++;
            }
            if (end && end.trim() !== '') {
                attConditions.push(`att.lesson_date <= $${paramIdx}::date`);
                params.push(end);
                paramIdx++;
            }

            const joinAttendanceOn = `ON s.id = att.student_id AND ` + attConditions.join(' AND ');

            mainQuery = `
                SELECT
                    u.last_name || ' ' || u.first_name AS name,
                    g.name AS group_name,
                    CASE
                        WHEN COUNT(att.id) = 0 THEN 0.0
                        ELSE ROUND((COUNT(att.id) FILTER (WHERE att.status IN ('Присутній', 'Запізнення'))::float / COUNT(att.id)::float * 100)::numeric, 1)
                    END AS score,
                    CASE
                        WHEN COUNT(att.id) = 0 THEN 'Немає даних'
                        WHEN (COUNT(att.id) FILTER (WHERE att.status IN ('Присутній', 'Запізнення'))::float / COUNT(att.id)::float * 100) >= 90 THEN 'Висока'
                        WHEN (COUNT(att.id) FILTER (WHERE att.status IN ('Присутній', 'Запізнення'))::float / COUNT(att.id)::float * 100) >= 70 THEN 'Нормальна'
                        ELSE 'Критична зона'
                    END AS status
                FROM students s
                JOIN users u ON s.user_id = u.id
                JOIN "groups" g ON s.group_id = g.id
                LEFT JOIN departments d ON g.department_id = d.id
                LEFT JOIN attendance att ${joinAttendanceOn}
                ${whereClause}
                GROUP BY u.id, u.last_name, u.first_name, g.name
                ORDER BY u.last_name ASC, u.first_name ASC;
            `;
        }

        const result = await db.query(mainQuery, params);
        res.json({ rows: result.rows });

    } catch (err) {
        console.error("Помилка генерації аналітичного звіту:", err);
        res.status(500).json({ error: 'Внутрішня помилка сервера при виконанні SQL' });
    }
});

// Головний ендпоїнт синхронної аналітики
app.get('/api/admin/analytics/summary', async (req, res) => {
    const { group, specialty, course, period, date, periodId } = req.query;

    try {
        const targetPeriodId = periodId ? parseInt(periodId, 10) : await getActivePeriodId();

        // Базові фільтри для студентів, відвідуваності та оцінок
        let studentFilters = [];
        let filterParams = [];

        if (group && group !== 'all') {
            filterParams.push(group);
            studentFilters.push(`g.name = $${filterParams.length}::varchar`);
        }
        if (specialty && specialty !== 'all') {
            filterParams.push(specialty);
            studentFilters.push(`d.short_name = $${filterParams.length}::varchar`);
        }
        if (course && course !== 'all') {
            filterParams.push(parseInt(course, 10));
            studentFilters.push(`g.course = $${filterParams.length}::integer`);
        }

        const studentWhereStr = studentFilters.length > 0 ? ' AND ' + studentFilters.join(' AND ') : '';

        // Лічильник студентів
        const studentsCountRes = await db.query(
            `SELECT COUNT(DISTINCT s.id)::int as count FROM students s
             JOIN "groups" g ON s.group_id = g.id
             LEFT JOIN departments d ON g.department_id = d.id WHERE 1=1 ${studentWhereStr}`,
            filterParams
        );

        // Лічильник викладачів
        let teacherFilters = [];
        let teacherParams = [];
        let teacherJoins = '';

        if ((group && group !== 'all') || (course && course !== 'all')) {
            teacherJoins = `
                JOIN teacher_subjects ts ON t.id = ts.teacher_id AND ts.period_id = $1::integer
                JOIN "groups" g ON ts.group_id = g.id
            `;
            teacherParams.push(targetPeriodId);

            if (group && group !== 'all') {
                teacherParams.push(group);
                teacherFilters.push(`g.name = $${teacherParams.length}::varchar`);
            }
            if (course && course !== 'all') {
                teacherParams.push(parseInt(course, 10));
                teacherFilters.push(`g.course = $${teacherParams.length}::integer`);
            }
            if (specialty && specialty !== 'all') {
                teacherParams.push(specialty);
                teacherFilters.push(`d.short_name = $${teacherParams.length}::varchar`);
            }
        } else if (specialty && specialty !== 'all') {
            teacherParams.push(specialty);
            teacherFilters.push(`d.short_name = $${teacherParams.length}::varchar`);
        }

        const teacherWhereStr = teacherFilters.length > 0 ? 'WHERE ' + teacherFilters.join(' AND ') : '';
        const teachersCountRes = await db.query(`
            SELECT COUNT(DISTINCT t.id)::int as count
            FROM teachers t
            LEFT JOIN departments d ON t.department_id = d.id
            ${teacherJoins}
            ${teacherWhereStr}
        `, teacherParams);

        // Розподіл дисциплін (всі або за фільтром)
        const hasActiveFilters = (group && group !== 'all') || (specialty && specialty !== 'all') || (course && course !== 'all');
        
        let subjectsCountRes;
        let groupSubjectsRes;
        
        let mapParams = [targetPeriodId];
        let mapFilters = [];

        if (group && group !== 'all') {
            mapParams.push(group);
            mapFilters.push(`g.name = $${mapParams.length}::varchar`);
        }
        if (specialty && specialty !== 'all') {
            mapParams.push(specialty);
            mapFilters.push(`d.short_name = $${mapParams.length}::varchar`);
        }
        if (course && course !== 'all') {
            mapParams.push(parseInt(course, 10));
            mapFilters.push(`g.course = $${mapParams.length}::integer`);
        }

        if (!hasActiveFilters) {
            subjectsCountRes = await db.query(`SELECT COUNT(id)::int as count FROM subjects`);
            
            groupSubjectsRes = await db.query(`
                SELECT g.name as group_name, sub.name as subject_name
                FROM "groups" g
                CROSS JOIN subjects sub
                ORDER BY g.name ASC, sub.name ASC
            `);
        } else {
            const joinFilterStr = mapFilters.length > 0 ? 'AND ' + mapFilters.join(' AND ') : '';
            
            subjectsCountRes = await db.query(`
                SELECT COUNT(DISTINCT ts.subject_id)::int as count 
                FROM teacher_subjects ts
                JOIN "groups" g ON ts.group_id = g.id
                LEFT JOIN departments d ON g.department_id = d.id
                WHERE ts.period_id = $1::integer ${joinFilterStr.replace(/g\./g, 'g.').replace(/d\./g, 'd.')}
            `, mapParams);

            groupSubjectsRes = await db.query(`
                SELECT DISTINCT g.name as group_name, sub.name as subject_name
                FROM "groups" g
                LEFT JOIN departments d ON g.department_id = d.id
                JOIN teacher_subjects ts ON ts.group_id = g.id AND ts.period_id = $1::integer ${joinFilterStr}
                JOIN subjects sub ON ts.subject_id = sub.id
                ORDER BY g.name ASC, sub.name ASC
            `, mapParams);
        }

        const groupSubjectsMap = {};
        groupSubjectsRes.rows.forEach(row => {
            if (!groupSubjectsMap[row.group_name]) {
                groupSubjectsMap[row.group_name] = [];
            }
            if (row.subject_name && !groupSubjectsMap[row.group_name].includes(row.subject_name)) {
                groupSubjectsMap[row.group_name].push(row.subject_name);
            }
        });

        // Розрахунок відвідуваності
        let dateClause = ` AND att.period_id = $${filterParams.length + 1}::integer`;
        let attParams = [...filterParams, targetPeriodId];

        if (date && date.trim() !== '') {
            attParams.push(date);
            dateClause += ` AND att.lesson_date = $${attParams.length}::date`;
        } else if (period && period !== 'all') {
            let daysInterval = 90;
            if (period === 'day') daysInterval = 1;
            if (period === 'week') daysInterval = 7;
            attParams.push(daysInterval);
            dateClause += ` AND att.lesson_date >= CURRENT_DATE - ($${attParams.length}::integer * INTERVAL '1 day')`;
        }

        let attRateQuery = `
            SELECT COALESCE(ROUND(COUNT(CASE WHEN att.status IN ('Присутній', 'Запізнення') THEN 1 END) * 100.0 / NULLIF(COUNT(att.id), 0), 0), 0) as rate
            FROM attendance att
            JOIN students s ON att.student_id = s.id
            JOIN "groups" g ON s.group_id = g.id
            LEFT JOIN departments d ON g.department_id = d.id
            WHERE 1=1 ${studentWhereStr} ${dateClause}
        `;
        const attRateRes = await db.query(attRateQuery, attParams);
        const liveAttRate = parseInt(attRateRes.rows[0]?.rate, 10) || 0;

        const counters = {
            students: studentsCountRes.rows[0]?.count || 0,
            teachers: teachersCountRes.rows[0]?.count || 0,
            subjects: subjectsCountRes.rows[0]?.count || 0, 
            attendanceRate: liveAttRate.toString()
        };

        // Середній бал груп за семестр
        const gradeParams = [...filterParams, targetPeriodId];
        const gradeQuery = `
            SELECT g.name AS group_name, g.course, COALESCE(ROUND(AVG(gr.grade)::numeric, 1), 0) AS avg_score
            FROM "groups" g
            LEFT JOIN departments d ON g.department_id = d.id
            LEFT JOIN students s ON s.group_id = g.id
            LEFT JOIN grades gr ON gr.student_id = s.id AND gr.period_id = $${gradeParams.length}::integer
            WHERE 1=1 ${studentWhereStr}
            GROUP BY g.id, g.name, g.course
            ORDER BY g.course ASC, g.name ASC
        `;
        const gradeRes = await db.query(gradeQuery, gradeParams);
        const gradeData = {
            labels: gradeRes.rows.map(r => `${r.group_name} (${r.course} к.)`),
            values: gradeRes.rows.map(r => parseFloat(r.avg_score))
        };

        // Динамічна відвідуваність (Pie Chart)
        let pieQuery = `
            SELECT att.status, COUNT(att.id) as count
            FROM attendance att
            JOIN students s ON att.student_id = s.id
            JOIN "groups" g ON s.group_id = g.id
            LEFT JOIN departments d ON g.department_id = d.id
            WHERE 1=1 ${studentWhereStr} ${dateClause}
            GROUP BY att.status
        `;
        const pieRes = await db.query(pieQuery, attParams);
        let totalAtt = pieRes.rows.reduce((sum, item) => sum + parseInt(item.count, 10), 0);

        let attendancePieData = { labels: [], values: [] };
        if (totalAtt > 0) {
            attendancePieData = {
                labels: pieRes.rows.map(r => r.status),
                values: pieRes.rows.map(r => parseInt(r.count, 10))
            };
        }

        // Рейтинг спеціальностей
        const specRes = await db.query(`
            SELECT d.short_name, COUNT(DISTINCT s.id) as student_count
            FROM departments d
            LEFT JOIN "groups" g ON g.department_id = d.id
            LEFT JOIN students s ON s.group_id = g.id
            GROUP BY d.id, d.short_name
            ORDER BY d.short_name ASC
        `);
        const specialtiesData = {
            labels: specRes.rows.map(r => r.short_name),
            values: specRes.rows.map(r => parseInt(r.student_count, 10))
        };

        // Моніторинг загальної активності за семестр
        const activityParams = [...filterParams, targetPeriodId];
        const activityQuery = `
            SELECT sch.day_of_week, COUNT(sch.id) as count
            FROM schedule sch
            JOIN "groups" g ON sch.group_id = g.id
            LEFT JOIN departments d ON g.department_id = d.id
            WHERE sch.is_active = true AND sch.period_id = $${activityParams.length}::integer ${studentWhereStr}
            GROUP BY sch.day_of_week
            ORDER BY sch.day_of_week ASC
        `;
        const activityRes = await db.query(activityQuery, activityParams);

        const weekDaysMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        activityRes.rows.forEach(r => {
            const dNum = parseInt(r.day_of_week, 10);
            if (dNum >= 1 && dNum <= 5) {
                weekDaysMap[dNum] = parseInt(r.count, 10);
            }
        });

        const teacherData = {
            labels: ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П\'ятниця'],
            values: Object.values(weekDaysMap)
        };

        // Списки успішності студентів
        const perfParams = [...filterParams, targetPeriodId];
        const studentsPerformanceQuery = `
            SELECT s.id, u.first_name, u.last_name, g.name as group_name,
                    COALESCE(ROUND(AVG(gr.grade)::numeric, 1), 0) as avg_grade
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN "groups" g ON s.group_id = g.id
            LEFT JOIN departments d ON g.department_id = d.id
            LEFT JOIN grades gr ON gr.student_id = s.id AND gr.period_id = $${perfParams.length}::integer
            WHERE 1=1 ${studentWhereStr}
            GROUP BY s.id, u.first_name, u.last_name, g.name
        `;
        const perfRes = await db.query(studentsPerformanceQuery, perfParams);
       
        const riskStudents = perfRes.rows.filter(s => parseFloat(s.avg_grade) > 0 && parseFloat(s.avg_grade) < 60.0).sort((a,b) => a.avg_grade - b.avg_grade);
        const excellentStudents = perfRes.rows.filter(s => parseFloat(s.avg_grade) >= 90.0).sort((a,b) => b.avg_grade - a.avg_grade);

        res.json({
            counters,
            gradeData,
            attendancePieData,
            specialtiesData,
            teacherData,
            groupSubjects: groupSubjectsMap, 
            riskStudents: riskStudents.slice(0, 15),
            excellentStudents: excellentStudents.slice(0, 15)
        });

    } catch (err) {
        console.error('Помилка збірної аналітики адміна:', err);
        res.status(500).json({ error: 'Помилка генерації аналітики' });
    }
});

// Ендпоїнт для отримання списку семестрів
app.get('/api/admin/analytics/periods', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, is_active FROM academic_periods ORDER BY start_date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Помилка завантаження періодів навчання:', err);
        res.status(500).json({ error: 'Не вдалося завантажити семестри' });
    }
});

// Отримання всіх спеціальностей для фільтра
app.get('/api/admin/analytics/specialties', async (req, res) => {
    try {
        const result = await db.query('SELECT short_name, name FROM departments ORDER BY short_name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Помилка завантаження спеціальностей для фільтру:', err);
        res.status(500).json({ error: 'Не вдалося завантажити спеціальності' });
    }
});

// Динамічний фільтр для груп в аналітиці
app.get('/api/admin/analytics/groups', async (req, res) => {
    const { specialty, course } = req.query;
    let clauses = [];
    let vals = [];

    if (specialty && specialty !== 'all') {
        vals.push(specialty);
        clauses.push(`d.short_name = $${vals.length}`);
    }
    if (course && course !== 'all') {
        vals.push(parseInt(course, 10));
        clauses.push(`g.course = $${vals.length}`);
    }

    const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
    try {
        const result = await db.query(`
            SELECT DISTINCT g.name FROM "groups" g
            LEFT JOIN departments d ON g.department_id = d.id
            ${where} ORDER BY g.name ASC
        `, vals);
        res.json(result.rows.map(r => r.name));
    } catch (e) {
        console.error('Помилка динамічного завантаження груп:', e);
        res.status(500).json([]);
    }
});

// Запуск та експорт сервера
const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Сервер успішно запущено на порту ${PORT}`);
    });
}

module.exports = app;