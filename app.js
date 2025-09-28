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
