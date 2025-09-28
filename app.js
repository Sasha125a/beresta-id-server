const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// Конфигурация
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'];

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Инициализация базы данных
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        token VARCHAR(500),
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);
    console.log('База данных инициализирована');
  } catch (error) {
    console.error('Ошибка инициализации БД:', error);
  }
}

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1 || ALLOWED_ORIGINS.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Домен не разрешен CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Статические файлы - исправленный путь
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток, попробуйте позже' }
});

app.use('/auth/', authLimiter);

// Middleware проверки аутентификации
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Токен отсутствует' });
    }

    const result = await pool.query(
      `SELECT s.*, u.id as user_id, u.email, u.name 
       FROM sessions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Недействительный или просроченный токен' });
    }

    const session = result.rows[0];
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Недействительный токен' });
      }
      req.user = {
        id: session.user_id,
        email: session.email,
        name: session.name
      };
      next();
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Ошибка аутентификации' });
  }
};

// Middleware проверки админских прав
const requireAdmin = async (req, res, next) => {
  try {
    // Здесь можно добавить проверку ролей пользователя
    // Пока что разрешаем доступ всем аутентифицированным пользователям к админке
    next();
  } catch (error) {
    res.status(403).json({ error: 'Доступ запрещен' });
  }
};

// Маршруты аутентификации
app.post(
  '/auth/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').optional().trim().isLength({ min: 2 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, name } = req.body;

      const userExists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userExists.rows.length > 0) {
        return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const result = await pool.query(
        'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
        [email, hashedPassword, name || null]
      );

      const user = result.rows[0];

      res.status(201).json({ 
        message: 'Пользователь успешно создан',
        user: { id: user.id, email: user.email, name: user.name }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Ошибка при создании пользователя' });
    }
  }
);

app.post(
  '/auth/login',
  [
    body('email').isEmail(),
    body('password').exists()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Неверные учетные данные' });
      }

      const user = result.rows[0];

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Неверные учетные данные' });
      }

      const tokenPayload = {
        userId: user.id,
        email: user.email
      };
      
      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await pool.query(
        'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, token, expiresAt]
      );

      res.json({
        token,
        expiresAt: expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Ошибка входа' });
    }
  }
);

app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    const token = req.headers['authorization'].split(' ')[1];
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ message: 'Успешный выход' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Ошибка выхода' });
  }
});

app.get('/auth/verify', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user
  });
});

// API для управления пользователями
app.get('/api/profile', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      'UPDATE users SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, email, name',
      [name, userId]
    );

    res.json({
      message: 'Профиль обновлен',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

// Админские эндпоинты
app.get('/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const sessionsCount = await pool.query('SELECT COUNT(*) FROM sessions WHERE expires_at > NOW()');
    const recentUsers = await pool.query('SELECT email, name, created_at FROM users ORDER BY created_at DESC LIMIT 10');

    res.json({
      users: parseInt(usersCount.rows[0].count),
      activeSessions: parseInt(sessionsCount.rows[0].count),
      recentUsers: recentUsers.rows
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});

app.get('/client.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  
  const clientCode = `
// Beresta ID Client Library v1.1.0
(function() {
  'use strict';

  class BerestaIDClient {
    constructor(baseURL = '${req.protocol}://${req.get('host')}') {
      this.baseURL = baseURL;
      this.token = localStorage.getItem('beresta_id_token');
      this.user = this.getUserFromStorage();
      this.savedAccounts = this.getSavedAccounts();
    }

    // Вспомогательные методы
    getUserFromStorage() {
      try {
        const userStr = localStorage.getItem('beresta_id_user');
        return userStr ? JSON.parse(userStr) : null;
      } catch (e) {
        return null;
      }
    }

    getSavedAccounts() {
      try {
        const accountsStr = localStorage.getItem('beresta_id_saved_accounts');
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
        
        localStorage.setItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
      } catch (e) {
        console.warn('Failed to save account:', e);
      }
    }

    removeSavedAccount(email) {
      try {
        this.savedAccounts = this.savedAccounts.filter(acc => acc.email !== email);
        localStorage.setItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
      } catch (e) {
        console.warn('Failed to remove account:', e);
      }
    }

    setUserData(token, user) {
      try {
        this.token = token;
        this.user = user;
        localStorage.setItem('beresta_id_token', token);
        localStorage.setItem('beresta_id_user', JSON.stringify(user));
        this.saveAccount(user);
      } catch (e) {
        console.warn('Failed to set user data:', e);
      }
    }

    clearUserData() {
      try {
        this.token = null;
        this.user = null;
        localStorage.removeItem('beresta_id_token');
        localStorage.removeItem('beresta_id_user');
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
          localStorage.setItem('beresta_id_user', JSON.stringify(data.user));
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
          localStorage.setItem('beresta_id_saved_accounts', JSON.stringify(this.savedAccounts));
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
        localStorage.removeItem('beresta_id_saved_accounts');
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
    
    // Автоматическая инициализация при загрузке
    const initClient = () => {
      window.berestaID.init().then(user => {
        console.log('Beresta ID initialized', user);
      }).catch(error => {
        console.warn('Beresta ID init error:', error);
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initClient);
    } else {
      initClient();
    }
  }

})();
`;

  res.send(clientCode);
});

// Явные маршруты для HTML страниц
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});

app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({ error: 'Страница не найдена' });
});

// Обработка ошибок
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запуск сервера
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`Brest ID сервис запущен на порту ${PORT}`);
  console.log(`Главная страница: http://localhost:${PORT}`);
  console.log(`Демо: http://localhost:${PORT}/demo`);
  console.log(`Документация: http://localhost:${PORT}/docs`);
  console.log(`Админ-панель: http://localhost:${PORT}/admin`);
  console.log(`Клиентская библиотека: http://localhost:${PORT}/client.js`);
});