// Beresta ID Client Library v1.1.0
class BerestaIDClient {
  constructor(baseURL = window.location.origin) {
    this.baseURL = baseURL;
    this.token = localStorage.getItem('beresta_id_token');
    this.user = this.getUserFromStorage();
    this.savedAccounts = this.getSavedAccounts();
  }

  // Вспомогательные методы
  getUserFromStorage() {
    const userStr = localStorage.getItem('beresta_id_user');
    return userStr ? JSON.parse(userStr) : null;
  }

  getSavedAccounts() {
    const accountsStr = localStorage.getItem('beresta_id_saved_accounts');
    return accountsStr ? JSON.parse(accountsStr) : [];
  }

  saveAccount(user) {
    // Проверяем, нет ли уже такого аккаунта в списке
    const existingIndex = this.savedAccounts.findIndex(acc => acc.email === user.email);
    
    if (existingIndex === -1) {
      // Добавляем новый аккаунт (без пароля!)
      this.savedAccounts.unshift({
        id: user.id,
        email: user.email,
        name: user.name,
        lastUsed: new Date().toISOString()
      });
      
      // Ограничиваем количество сохраненных аккаунтов (например, 5)
      if (this.savedAccounts.length > 5) {
        this.savedAccounts.pop();
      }
    } else {
      // Обновляем время использования существующего аккаунта
      this.savedAccounts[existingIndex].lastUsed = new Date().toISOString();
    }
    
    // Сохраняем в localStorage
    localStorage.setItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
  }

  removeSavedAccount(email) {
    this.savedAccounts = this.savedAccounts.filter(acc => acc.email !== email);
    localStorage.setItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
  }

  setUserData(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('beresta_id_token', token);
    localStorage.setItem('beresta_id_user', JSON.stringify(user));
    
    // Сохраняем аккаунт в список "запомненных"
    this.saveAccount(user);
  }

  clearUserData() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('beresta_id_token');
    localStorage.removeItem('beresta_id_user');
  }

  // Основные методы API
  async register(email, password, name = null) {
    try {
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

    // Обновляем данные пользователя
    if (data.user) {
      this.user = data.user;
      localStorage.setItem('beresta_id_user', JSON.stringify(data.user));
      
      // Обновляем также в сохраненных аккаунтах
      this.updateSavedAccount(data.user);
    }

    return data;
  }

  updateSavedAccount(updatedUser) {
    const accountIndex = this.savedAccounts.findIndex(acc => acc.id === updatedUser.id);
    if (accountIndex !== -1) {
      this.savedAccounts[accountIndex] = {
        ...this.savedAccounts[accountIndex],
        name: updatedUser.name,
        email: updatedUser.email
      };
      localStorage.setItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
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
    this.savedAccounts = [];
    localStorage.removeItem('beresta_id_saved_accounts');
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
window.berestaID = new BerestaIDClient();

// Автоматическая инициализация при загрузке
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.berestaID.init().then(user => {
      console.log('Beresta ID initialized', user);
    });
  });
} else {
  window.berestaID.init().then(user => {
    console.log('Beresta ID initialized', user);
  });
}