const API_URL = 'http://localhost:5000/api';

// Старт при завантаженні сторінки
document.addEventListener('DOMContentLoaded', () => {
    
    // Перевірка активної сесії
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        const authToken = localStorage.getItem('authToken');

        // Якщо юзер вже увійшов і є токен — скеровуємо на його сторінку
        if (currentUser?.role && authToken) {
            redirectToDashboard(currentUser.role);
        }
    } catch (e) {
        // Захист від застарілих або битих даних у localStorage
        localStorage.clear();
    }

    // Обробка відправки форми
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);

    // Показ/приховування пароля
    document.getElementById('togglePassBtn')?.addEventListener('click', () => {
        const input = document.getElementById('password');
        const icon = document.getElementById('toggleIcon');
        if (!input || !icon) return;

        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        }
    });
});

// Запит авторизації на бекенд
async function handleLogin(e) {
    e.preventDefault(); 
    
    const submitBtn = document.getElementById('loginBtn');
    // Миттєвий захист від double-click атаки на сервер
    if (submitBtn) submitBtn.disabled = true;

    const errorEl = document.getElementById('error');
    const successEl = document.getElementById('success');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    if (errorEl) errorEl.style.display = 'none';
    if (successEl) successEl.style.display = 'none';

    if (!emailInput || !passwordInput) {
        if (submitBtn) submitBtn.disabled = false;
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';

    try {
        if (submitBtn) {
            // Анімація завантаження на кнопці
            submitBtn.innerHTML = `<span>Авторизація...</span> <i class="fa-solid fa-spinner fa-spin"></i>`;
        }

        // Надсилання даних на сервер
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        // Перевірка контенту відповіді сервера
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error(`Сервер повернув помилку (Код: ${response.status}). Перевірте роботу бекенду.`);
        }

        const data = await response.json(); 

        // Обробка помилок від Node.js бекенду
        if (!response.ok) {
            throw new Error(data.error || 'Невірний логін або пароль');
        }

        // Безпечне збереження валідованої сесії в браузері
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        localStorage.setItem('authToken', 'session_active_authenticated_verified');

        if (successEl) successEl.style.display = 'block';

        // Редирект із невеликою затримкою для завершення CSS-анімацій успіху
        setTimeout(() => {
            redirectToDashboard(data.user.role);
        }, 800);

    } catch (err) {
        // Виведення помилки користувачу
        if (errorEl) {
            errorEl.innerText = err.message;
            errorEl.style.display = 'block';
        } else {
            alert(err.message);
        }
        
        // Скидання стану та розблокування кнопки для нової спроби
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
        }
    }
}

// Розподіл користувачів за ролями через безпечний replace (запобігає циклічному поверненню кнопкою "Назад")
function redirectToDashboard(roleOrId) {
    const role = String(roleOrId || '').toLowerCase().trim();
    
    if (role === '1' || role === 'admin' || role === 'administrator') {
        window.location.replace('admin.html');
    } else if (role === '2' || role === 'teacher') {
        window.location.replace('teacher.html');
    } else if (role === '3' || role === 'student') {
        window.location.replace('student.html');
    } else {
        console.error('Невідома роль в системі:', role);
        window.location.replace('student.html'); 
    }
}

// Вікно підтвердження виходу з системи (глобальна функція)
window.logout = function() { 
    if (document.getElementById('logout-modal')) return;

    const modalHtml = `
        <div id="logout-modal" class="custom-modal-overlay">
            <div class="custom-modal-card">
                <div class="custom-modal-icon">
                    <i class="fa-solid fa-user"></i>
                </div>
                <h3>Вже йдете?</h3>
                <p>Ви дійсно бажаєте вийти зі свого облікового запису?</p>
                <div class="custom-modal-buttons">
                    <button id="modal-cancel-btn" class="btn-modal-secondary">Скасувати</button>
                    <button id="modal-confirm-btn" class="btn-modal-danger">Так, вийти</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('logout-modal');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const confirmBtn = document.getElementById('modal-confirm-btn');

    // Закриття модалки з плавною CSS анімацією
    const closeModal = () => {
        if (!modal) return;
        modal.classList.add('closing');
        setTimeout(() => modal.remove(), 220); 
    };

    cancelBtn?.addEventListener('click', closeModal);
    
    confirmBtn?.addEventListener('click', () => {
        localStorage.clear(); // Повне очищення перед виходом
        window.location.replace('login.html'); 
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
};