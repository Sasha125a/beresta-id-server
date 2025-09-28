// Beresta ID Widget v1.0 - для простой интеграции в приложения
(function() {
    'use strict';
    
    // Загружаем клиентскую библиотеку если её нет
    function loadClientLibrary() {
        return new Promise((resolve, reject) => {
            if (window.berestaID) {
                resolve(window.berestaID);
                return;
            }
            
            const script = document.createElement('script');
            script.src = '/client.js';
            script.onload = () => {
                if (window.berestaID) {
                    resolve(window.berestaID);
                } else {
                    reject(new Error('Failed to load Beresta ID client'));
                }
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    // Основная функция для входа
    window.BerestaAuth = {
        /**
         * Инициализирует вход через Beresta ID
         * @param {Object} options - Опции входа
         * @returns {Promise} Промис с данными пользователя
         */
        async login(options = {}) {
            try {
                const client = await loadClientLibrary();
                return await client.loginWithBerestaID(options);
            } catch (error) {
                console.error('Beresta Auth failed:', error);
                throw error;
            }
        },
        
        /**
         * Быстрый вход для приложений (упрощенный API)
         * @param {string} appName - Название приложения
         * @param {Function} onSuccess - Колбэк при успехе
         * @param {Function} onError - Колбэк при ошибке
         */
        quickLogin(appName, onSuccess, onError) {
            this.login({
                appName: appName,
                onSuccess: onSuccess,
                onError: onError
            });
        },
        
        /**
         * Проверяет, авторизован ли пользователь
         * @returns {Promise<boolean>}
         */
        async isAuthenticated() {
            try {
                const client = await loadClientLibrary();
                return client.isAuthenticated();
            } catch (error) {
                return false;
            }
        },
        
        /**
         * Получает данные текущего пользователя
         * @returns {Promise<Object|null>}
         */
        async getCurrentUser() {
            try {
                const client = await loadClientLibrary();
                return client.getUser();
            } catch (error) {
                return null;
            }
        },
        
        /**
         * Выход из системы
         */
        async logout() {
            try {
                const client = await loadClientLibrary();
                await client.logout();
            } catch (error) {
                console.error('Logout failed:', error);
            }
        }
    };
    
    console.log('Beresta Auth Widget loaded');
})();
