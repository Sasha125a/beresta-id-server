// Beresta ID Widget v2.0 - улучшенный виджет для входа
(function() {
    'use strict';
    
    class BerestaAuthWidget {
        constructor() {
            this.baseURL = window.location.origin;
            this.client = null;
            this.currentContainerId = null;
            this.resolvePromise = null;
            this.rejectPromise = null;
        }
        
        async initialize() {
            try {
                await this.loadClientLibrary();
                console.log('Beresta Auth Widget initialized');
            } catch (error) {
                console.error('Failed to initialize Beresta Auth Widget:', error);
            }
        }
        
        loadClientLibrary() {
            return new Promise((resolve, reject) => {
                if (window.berestaID) {
                    this.client = window.berestaID;
                    resolve(this.client);
                    return;
                }
                
                const script = document.createElement('script');
                script.src = this.baseURL + '/client.js';
                script.onload = () => {
                    if (window.berestaID) {
                        this.client = window.berestaID;
                        resolve(this.client);
                    } else {
                        reject(new Error('Failed to load Beresta ID client'));
                    }
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        
        /**
         * Основной метод для входа через Beresta ID
         * @param {Object} options - Опции входа
         */
        async login(options = {}) {
            const {
                appName = 'Приложение',
                appLogo = null,
                redirectUrl = null,
                containerId = 'beresta-login-container',
                theme = 'light',
                onSuccess = null,
                onError = null
            } = options;
            
            try {
                await this.initialize();
                this.currentContainerId = containerId;
                
                // Создаем интерфейс входа
                this.createLoginInterface(containerId, appName, appLogo, theme);
                
                // Ожидаем результат входа
                const userData = await this.waitForLogin();
                
                // Закрываем интерфейс
                this.closeLoginInterface();
                
                // Вызываем колбэки
                if (onSuccess) onSuccess(userData);
                if (redirectUrl) window.location.href = redirectUrl;
                
                return userData;
                
            } catch (error) {
                this.closeLoginInterface();
                if (onError) onError(error);
                throw error;
            }
        }
        
        createLoginInterface(containerId, appName, appLogo, theme) {
            // Удаляем существующий контейнер
            this.closeLoginInterface();
            
            const overlay = document.createElement('div');
            overlay.className = 'beresta-login-overlay';
            overlay.id = containerId;
            
            const modal = document.createElement('div');
            modal.className = 'beresta-login-modal';
            if (theme === 'dark') {
                modal.style.background = '#1f2937';
                modal.style.color = 'white';
            }
            
            modal.innerHTML = `
                <div class="beresta-login-header">
                    ${appLogo ? `<img src="${appLogo}" alt="${appName}" style="height: 40px; margin-bottom: 1rem;">` : ''}
                    <h2>Вход через Beresta ID</h2>
                    <p>для ${appName}</p>
                </div>
                <div id="${containerId}-content"></div>
                <div style="text-align: center; margin-top: 1rem;">
                    <button type="button" class="beresta-back-btn" onclick="window.berestaAuth.close()">
                        Отмена
                    </button>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            // Показываем соответствующий контент
            this.showInitialContent(containerId);
        }
        
        showInitialContent(containerId) {
            const content = document.getElementById(`${containerId}-content`);
            
            if (this.client.hasSavedAccounts()) {
                this.showAccountList(containerId);
            } else {
                this.showLoginForm(containerId);
            }
        }
        
        showAccountList(containerId) {
            const content = document.getElementById(`${containerId}-content`);
            const accounts = this.client.getSavedAccountsList();
            
            content.innerHTML = `
                <div style="margin-bottom: 1rem;">
                    <h4 style="margin: 0 0 1rem 0; color: #374151; font-size: 0.875rem;">Выберите аккаунт:</h4>
                    <div class="beresta-account-list" id="${containerId}-accounts"></div>
                </div>
                <button type="button" class="beresta-secondary-btn" onclick="window.berestaAuth.showManualLogin()">
                    Войти другим аккаунтом
                </button>
            `;
            
            const accountsContainer = document.getElementById(`${containerId}-accounts`);
            accounts.forEach(account => {
                const accountElement = document.createElement('div');
                accountElement.className = 'beresta-account-item';
                accountElement.innerHTML = `
                    <div class="beresta-account-info">
                        <div class="beresta-account-name">${account.name || account.email}</div>
                        <div class="beresta-account-email">${account.email}</div>
                    </div>
                    <button type="button" class="beresta-remove-account" 
                            onclick="event.stopPropagation(); window.berestaAuth.removeAccount('${account.email}')">
                        ×
                    </button>
                `;
                accountElement.addEventListener('click', () => this.selectAccount(account.email));
                accountsContainer.appendChild(accountElement);
            });
        }
        
        showLoginForm(containerId) {
            const content = document.getElementById(`${containerId}-content`);
            
            content.innerHTML = `
                <form class="beresta-login-form" id="${containerId}-login-form" onsubmit="return false;">
                    <div class="beresta-form-group">
                        <label class="beresta-form-label" for="${containerId}-email">Email</label>
                        <input type="email" class="beresta-form-input" id="${containerId}-email" required 
                               placeholder="your@email.com">
                    </div>
                    <div class="beresta-form-group">
                        <label class="beresta-form-label" for="${containerId}-password">Пароль</label>
                        <input type="password" class="beresta-form-input" id="${containerId}-password" required 
                               placeholder="Ваш пароль">
                    </div>
                    <div class="beresta-checkbox-group">
                        <input type="checkbox" class="beresta-checkbox" id="${containerId}-remember" checked>
                        <label class="beresta-checkbox-label" for="${containerId}-remember">Запомнить аккаунт</label>
                    </div>
                    <button type="submit" class="beresta-primary-btn">Войти</button>
                </form>
                ${this.client.hasSavedAccounts() ? `
                <div style="text-align: center;">
                    <button type="button" class="beresta-back-btn" onclick="window.berestaAuth.showAccountList()">
                        ← Выбрать из сохраненных аккаунтов
                    </button>
                </div>
                ` : ''}
            `;
            
            const form = document.getElementById(`${containerId}-login-form`);
            form.addEventListener('submit', () => this.handleLogin(containerId));
        }
        
        showPasswordPrompt(containerId, email) {
            const content = document.getElementById(`${containerId}-content`);
            
            content.innerHTML = `
                <div style="text-align: center; margin-bottom: 1.5rem;">
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">${email}</div>
                    <div style="color: #64748b; font-size: 0.875rem;">Введите пароль для входа</div>
                </div>
                <form class="beresta-login-form" id="${containerId}-password-form" onsubmit="return false;">
                    <div class="beresta-form-group">
                        <input type="password" class="beresta-form-input" id="${containerId}-account-password" required 
                               placeholder="Пароль для ${email}">
                    </div>
                    <button type="submit" class="beresta-primary-btn">Войти</button>
                </form>
                <div style="text-align: center;">
                    <button type="button" class="beresta-back-btn" onclick="window.berestaAuth.showAccountList()">
                        ← Выбрать другой аккаунт
                    </button>
                </div>
            `;
            
            const form = document.getElementById(`${containerId}-password-form`);
            form.addEventListener('submit', () => this.handleAccountLogin(containerId, email));
        }
        
        async handleLogin(containerId) {
            const email = document.getElementById(`${containerId}-email`).value;
            const password = document.getElementById(`${containerId}-password`).value;
            
            await this.performLogin(email, password, containerId);
        }
        
        async handleAccountLogin(containerId, email) {
            const password = document.getElementById(`${containerId}-account-password`).value;
            
            await this.performLogin(email, password, containerId);
        }
        
        async performLogin(email, password, containerId) {
            const content = document.getElementById(`${containerId}-content`);
            
            try {
                // Показываем индикатор загрузки
                content.innerHTML = `
                    <div class="beresta-loading">
                        <div class="beresta-loading-spinner"></div>
                        <div>Выполняется вход...</div>
                    </div>
                `;
                
                const result = await this.client.login(email, password);
                this.resolvePromise(result);
                
            } catch (error) {
                // Показываем ошибку
                this.showError(containerId, error.message);
            }
        }
        
        showError(containerId, message) {
            const content = document.getElementById(`${containerId}-content`);
            const errorDiv = document.createElement('div');
            errorDiv.className = 'beresta-error';
            errorDiv.textContent = message;
            
            // Вставляем ошибку в начало
            content.insertBefore(errorDiv, content.firstChild);
            
            // Показываем форму снова
            setTimeout(() => {
                this.showInitialContent(containerId);
            }, 3000);
        }
        
        selectAccount(email) {
            this.showPasswordPrompt(this.currentContainerId, email);
        }
        
        removeAccount(email) {
            this.client.removeSavedAccount(email);
            this.showAccountList(this.currentContainerId);
        }
        
        showManualLogin() {
            this.showLoginForm(this.currentContainerId);
        }
        
        showAccountList() {
            this.showAccountList(this.currentContainerId);
        }
        
        waitForLogin() {
            return new Promise((resolve, reject) => {
                this.resolvePromise = resolve;
                this.rejectPromise = reject;
            });
        }
        
        closeLoginInterface() {
            if (this.currentContainerId) {
                const container = document.getElementById(this.currentContainerId);
                if (container) {
                    container.remove();
                }
                this.currentContainerId = null;
            }
            
            if (this.rejectPromise) {
                this.rejectPromise(new Error('Вход отменен'));
            }
        }
        
        close() {
            this.closeLoginInterface();
        }
        
        // Быстрые методы для интеграции
        quickLogin(appName, onSuccess, onError) {
            return this.login({
                appName: appName,
                onSuccess: onSuccess,
                onError: onError
            });
        }
        
        async isLoggedIn() {
            await this.initialize();
            return this.client.isAuthenticated();
        }
        
        async getCurrentUser() {
            await this.initialize();
            return this.client.getUser();
        }
        
        async logout() {
            await this.initialize();
            return this.client.logout();
        }
    }
    
    // Создаем глобальный экземпляр
    window.berestaAuth = new BerestaAuthWidget();
    
    console.log('Beresta Auth Widget v2.0 loaded');
})();
