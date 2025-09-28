// Beresta ID Client Library v1.1.0
console.log('Loading Beresta ID Client Library...');

class BerestaIDClient {
    constructor(baseURL) {
        this.baseURL = baseURL || window.location.origin;
        this.token = this.getSafeItem('beresta_id_token');
        this.user = this.getUserFromStorage();
        this.savedAccounts = this.getSavedAccounts();
        console.log('BerestaIDClient initialized with baseURL:', this.baseURL);
    }

    // Безопасные методы работы с localStorage
    getSafeItem(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn('localStorage not available:', e);
            return null;
        }
    }

    setSafeItem(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            console.warn('localStorage not available:', e);
            return false;
        }
    }

    removeSafeItem(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn('localStorage not available:', e);
            return false;
        }
    }

    // Вспомогательные методы
    getUserFromStorage() {
        try {
            const userStr = this.getSafeItem('beresta_id_user');
            return userStr ? JSON.parse(userStr) : null;
        } catch (e) {
            return null;
        }
    }

    getSavedAccounts() {
        try {
            const accountsStr = this.getSafeItem('beresta_id_saved_accounts');
            return accountsStr ? JSON.parse(accountsStr) : [];
        } catch (e) {
            return [];
        }
    }

    saveAccount(user) {
        try {
            const existingIndex = this.savedAccounts.findIndex(acc => acc.email === user.email);
            
            if (existingIndex === -1) {
                this.savedAccounts.unshift({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    lastUsed: new Date().toISOString()
                });
                
                if (this.savedAccounts.length > 5) {
                    this.savedAccounts.pop();
                }
            } else {
                this.savedAccounts[existingIndex].lastUsed = new Date().toISOString();
            }
            
            this.setSafeItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
        } catch (e) {
            console.warn('Failed to save account:', e);
        }
    }

    removeSavedAccount(email) {
        try {
            this.savedAccounts = this.savedAccounts.filter(acc => acc.email !== email);
            this.setSafeItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
        } catch (e) {
            console.warn('Failed to remove account:', e);
        }
    }

    setUserData(token, user) {
        try {
            this.token = token;
            this.user = user;
            this.setSafeItem('beresta_id_token', token);
            this.setSafeItem('beresta_id_user', JSON.stringify(user));
            this.saveAccount(user);
        } catch (e) {
            console.warn('Failed to set user data:', e);
        }
    }

    clearUserData() {
        try {
            this.token = null;
            this.user = null;
            this.removeSafeItem('beresta_id_token');
            this.removeSafeItem('beresta_id_user');
        } catch (e) {
            console.warn('Failed to clear user data:', e);
        }
    }

    // Основные методы API
    async register(email, password, name = null) {
        try {
            console.log('Registering user:', email);
            const response = await fetch(this.baseURL + '/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password, name }),
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Ошибка регистрации');
            }

            return data;
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    async login(email, password) {
        try {
            console.log('Logging in user:', email);
            const response = await fetch(this.baseURL + '/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Ошибка входа');
            }

            this.setUserData(data.token, data.user);
            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async logout() {
        try {
            if (this.token) {
                await fetch(this.baseURL + '/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + this.token,
                    },
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            this.clearUserData();
        }
    }

    async verifyToken() {
        if (!this.token) return null;

        try {
            const response = await fetch(this.baseURL + '/auth/verify', {
                headers: {
                    'Authorization': 'Bearer ' + this.token,
                },
            });

            if (!response.ok) {
                throw new Error('Недействительный токен');
            }

            return await response.json();
        } catch (error) {
            this.clearUserData();
            return null;
        }
    }

    async getProfile() {
        if (!this.token) throw new Error('Требуется аутентификация');

        const response = await fetch(this.baseURL + '/api/profile', {
            headers: {
                'Authorization': 'Bearer ' + this.token,
            },
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Ошибка получения профиля');
        }

        return data;
    }

    async updateProfile(name) {
        if (!this.token) throw new Error('Требуется аутентификация');

        const response = await fetch(this.baseURL + '/api/profile', {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + this.token,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name }),
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Ошибка обновления профиля');
        }

        if (data.user) {
            this.user = data.user;
            try {
                this.setSafeItem('beresta_id_user', JSON.stringify(data.user));
                this.updateSavedAccount(data.user);
            } catch (e) {
                console.warn('Failed to update user in storage:', e);
            }
        }

        return data;
    }

    updateSavedAccount(updatedUser) {
        try {
            const accountIndex = this.savedAccounts.findIndex(acc => acc.id === updatedUser.id);
            if (accountIndex !== -1) {
                this.savedAccounts[accountIndex] = {
                    ...this.savedAccounts[accountIndex],
                    name: updatedUser.name,
                    email: updatedUser.email
                };
                this.setSafeItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
            }
        } catch (e) {
            console.warn('Failed to update saved account:', e);
        }
    }

    // Новые методы для работы с сохраненными аккаунтами
    getSavedAccountsList() {
        return this.savedAccounts.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
    }

    hasSavedAccounts() {
        return this.savedAccounts.length > 0;
    }

    clearAllSavedAccounts() {
        try {
            this.savedAccounts = [];
            this.removeSafeItem('beresta_id_saved_accounts');
        } catch (e) {
            console.warn('Failed to clear saved accounts:', e);
        }
    }

    // Вспомогательные методы
    isAuthenticated() {
        return !!this.token;
    }

    getUser() {
        return this.user;
    }

    getToken() {
        return this.token;
    }

    // Метод для автоматической проверки аутентификации при загрузке
    async init() {
        if (this.token) {
            const verified = await this.verifyToken();
            if (!verified) {
                this.clearUserData();
            }
            return verified;
        }
        return null;
    }
}

// Добавьте эти методы в класс BerestaIDClient в public/client.js

/**
 * Функция для входа через Beresta ID из внешних приложений
 * @param {Object} options - Опции входа
 * @param {string} options.appName - Название приложения
 * @param {string} options.redirectUrl - URL для редиректа после успешного входа
 * @param {string} options.containerId - ID контейнера для отображения интерфейса входа
 * @param {Function} options.onSuccess - Колбэк при успешном входе
 * @param {Function} options.onError - Колбэк при ошибке
 */
async function loginWithBerestaID(options = {}) {
    const {
        appName = 'Приложение',
        redirectUrl = window.location.href,
        containerId = 'beresta-login-container',
        onSuccess = null,
        onError = null
    } = options;

    // Создаем контейнер для интерфейса входа
    createLoginContainer(containerId, appName);

    try {
        // Проверяем, есть ли сохраненные аккаунты
        if (this.hasSavedAccounts()) {
            showSavedAccounts(containerId);
        } else {
            showLoginForm(containerId);
        }

        // Ожидаем выбора аккаунта или входа
        const userData = await waitForLogin(containerId);
        
        if (onSuccess) {
            onSuccess(userData);
        }
        
        if (redirectUrl) {
            window.location.href = redirectUrl;
        }

        return userData;

    } catch (error) {
        console.error('Login with Beresta ID failed:', error);
        if (onError) {
            onError(error);
        }
        throw error;
    }
}

/**
 * Создает контейнер для интерфейса входа
 */
function createLoginContainer(containerId, appName) {
    let container = document.getElementById(containerId);
    
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        document.body.appendChild(container);
    }

    container.innerHTML = `
        <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); max-width: 400px; width: 90%; max-height: 90vh; overflow-y: auto;">
            <div style="text-align: center; margin-bottom: 1.5rem;">
                <h2 style="margin: 0 0 0.5rem 0; color: #2563eb;">Вход через Beresta ID</h2>
                <p style="margin: 0; color: #64748b;">для ${appName}</p>
            </div>
            <div id="${containerId}-content"></div>
            <div style="text-align: center; margin-top: 1rem;">
                <button onclick="closeBerestaLogin('${containerId}')" style="background: none; border: none; color: #64748b; cursor: pointer; text-decoration: underline;">
                    Отмена
                </button>
            </div>
        </div>
    `;
}

/**
 * Показывает список сохраненных аккаунтов
 */
function showSavedAccounts(containerId) {
    const content = document.getElementById(`${containerId}-content`);
    const savedAccounts = this.getSavedAccountsList();
    
    content.innerHTML = `
        <div style="margin-bottom: 1rem;">
            <h4 style="margin: 0 0 1rem 0; color: #374151;">Выберите аккаунт:</h4>
            <div id="${containerId}-accounts-list" style="max-height: 200px; overflow-y: auto;"></div>
        </div>
        <button onclick="showManualLogin('${containerId}')" style="width: 100%; padding: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; color: #64748b;">
            Войти другим аккаунтом
        </button>
    `;

    const accountsList = document.getElementById(`${containerId}-accounts-list`);
    
    savedAccounts.forEach(account => {
        const accountDiv = document.createElement('div');
        accountDiv.style.cssText = `
            padding: 0.75rem;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            margin-bottom: 0.5rem;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background-color 0.2s;
        `;
        accountDiv.onmouseenter = () => accountDiv.style.backgroundColor = '#f8fafc';
        accountDiv.onmouseleave = () => accountDiv.style.backgroundColor = 'white';
        
        accountDiv.innerHTML = `
            <div>
                <div style="font-weight: 600; color: #1e293b;">${account.name || account.email}</div>
                <div style="font-size: 0.875rem; color: #64748b;">${account.email}</div>
            </div>
            <button onclick="event.stopPropagation(); removeAccountFromList('${account.email}', '${containerId}')" 
                    style="background: none; border: none; font-size: 1.25rem; cursor: pointer; color: #ef4444; padding: 0.25rem;">
                ×
            </button>
        `;
        accountDiv.onclick = () => this.selectAccountForLogin(account.email, containerId);
        accountsList.appendChild(accountDiv);
    });
}

/**
 * Показывает форму ручного входа
 */
function showManualLogin(containerId) {
    const content = document.getElementById(`${containerId}-content`);
    
    content.innerHTML = `
        <form id="${containerId}-login-form" onsubmit="return false;">
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: #374151;">Email</label>
                <input type="email" id="${containerId}-email" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem;"
                       placeholder="your@email.com">
            </div>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: #374151;">Пароль</label>
                <input type="password" id="${containerId}-password" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem;"
                       placeholder="Ваш пароль">
            </div>
            <div style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                <input type="checkbox" id="${containerId}-remember" checked style="margin: 0;">
                <label for="${containerId}-remember" style="margin: 0; color: #64748b;">Запомнить аккаунт</label>
            </div>
            <button type="submit" 
                    style="width: 100%; padding: 0.75rem; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer;">
                Войти
            </button>
        </form>
        ${this.hasSavedAccounts() ? `
        <div style="text-align: center; margin-top: 1rem;">
            <button onclick="showSavedAccounts('${containerId}')" style="background: none; border: none; color: #64748b; cursor: pointer; text-decoration: underline;">
                ← Выбрать из сохраненных аккаунтов
            </button>
        </div>
        ` : ''}
    `;

    const form = document.getElementById(`${containerId}-login-form`);
    form.onsubmit = () => this.handleManualLogin(containerId);
}

/**
 * Обрабатывает ручной вход
 */
async function handleManualLogin(containerId) {
    const email = document.getElementById(`${containerId}-email`).value;
    const password = document.getElementById(`${containerId}-password`).value;
    
    try {
        const result = await this.login(email, password);
        this.resolveLoginPromise(result);
    } catch (error) {
        this.showLoginError(containerId, error.message);
    }
}

/**
 * Выбор аккаунта из списка
 */
async function selectAccountForLogin(email, containerId) {
    const content = document.getElementById(`${containerId}-content`);
    content.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <div style="margin-bottom: 1rem;">Выбран: <strong>${email}</strong></div>
            <div>Введите пароль для входа</div>
            <form id="${containerId}-password-form" onsubmit="return false;" style="margin-top: 1rem;">
                <input type="password" id="${containerId}-account-password" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; margin-bottom: 1rem;"
                       placeholder="Пароль для ${email}">
                <button type="submit" 
                        style="width: 100%; padding: 0.75rem; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer;">
                    Войти
                </button>
            </form>
        </div>
    `;

    const form = document.getElementById(`${containerId}-password-form`);
    form.onsubmit = async () => {
        const password = document.getElementById(`${containerId}-account-password`).value;
        try {
            const result = await this.login(email, password);
            this.resolveLoginPromise(result);
        } catch (error) {
            this.showLoginError(containerId, error.message);
        }
    };
}

// Добавьте эти методы в класс BerestaIDClient
BerestaIDClient.prototype.loginWithBerestaID = loginWithBerestaID;
BerestaIDClient.prototype.createLoginContainer = createLoginContainer;
BerestaIDClient.prototype.showSavedAccounts = showSavedAccounts;
BerestaIDClient.prototype.showManualLogin = showManualLogin;
BerestaIDClient.prototype.handleManualLogin = handleManualLogin;
BerestaIDClient.prototype.selectAccountForLogin = selectAccountForLogin;

// Глобальные функции для обработки событий
window.closeBerestaLogin = function(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.remove();
    }
    if (window.berestaID && window.berestaID.rejectLoginPromise) {
        window.berestaID.rejectLoginPromise(new Error('Вход отменен'));
    }
};

window.showManualLogin = function(containerId) {
    if (window.berestaID) {
        window.berestaID.showManualLogin(containerId);
    }
};

window.removeAccountFromList = function(email, containerId) {
    if (window.berestaID) {
        window.berestaID.removeSavedAccount(email);
        window.berestaID.showSavedAccounts(containerId);
    }
};

// Система промисов для ожидания входа
BerestaIDClient.prototype.waitForLogin = function(containerId) {
    return new Promise((resolve, reject) => {
        this.resolveLoginPromise = resolve;
        this.rejectLoginPromise = reject;
    });
};

BerestaIDClient.prototype.showLoginError = function(containerId, message) {
    const content = document.getElementById(`${containerId}-content`);
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #dc2626;
        padding: 0.75rem;
        border-radius: 6px;
        margin-bottom: 1rem;
        font-size: 0.875rem;
    `;
    errorDiv.textContent = message;
    content.insertBefore(errorDiv, content.firstChild);
    
    // Автоматически скрываем ошибку через 5 секунд
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 5000);
};

// Создаем глобальный экземпляр
if (typeof window !== 'undefined') {
    window.berestaID = new BerestaIDClient();
    console.log('BerestaID global object created:', window.berestaID);
    
    // Автоматическая инициализация при загрузке
    const initClient = () => {
        if (window.berestaID && typeof window.berestaID.init === 'function') {
            window.berestaID.init().then(user => {
                console.log('Beresta ID initialized successfully', user);
            }).catch(error => {
                console.warn('Beresta ID init error:', error);
            });
        } else {
            console.error('BerestaID not properly initialized');
        }
    };

    // Ждем полной загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initClient);
    } else {
        setTimeout(initClient, 100);
    }
}

console.log('Beresta ID Client Library loaded successfully');
