// Beresta ID Client Library v1.1.0
(function() {
    'use strict';

    class BerestaIDClient {
        constructor(baseURL = window.location.origin) {
            this.baseURL = baseURL;
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
            } catch (e) {
                console.warn('localStorage not available:', e);
            }
        }

        removeSafeItem(key) {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.warn('localStorage not available:', e);
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

    // Создаем глобальный экземпляр
    if (typeof window !== 'undefined') {
        window.berestaID = new BerestaIDClient();
        console.log('BerestaID global object created:', window.berestaID);
        
        // Автоматическая инициализация при загрузке
        const initClient = () => {
            if (window.berestaID && window.berestaID.init) {
                window.berestaID.init().then(user => {
                    console.log('Beresta ID initialized successfully', user);
                }).catch(error => {
                    console.warn('Beresta ID init error:', error);
                });
            } else {
                console.error('BerestaID not properly initialized');
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initClient);
        } else {
            initClient();
        }
    }

})();
