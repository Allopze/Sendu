import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import SqliteStore from 'better-sqlite3-session-store';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import multer from 'multer';
import { DEFAULT_EMAIL_TEMPLATES } from './templates/email/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production');
}

// Database Setup
const dbPath = path.join(rootDir, 'db.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Session Store Setup
const SqliteSessionStore = SqliteStore(session);
const sessionDbPath = path.join(rootDir, 'sessions.sqlite');
const sessionDb = new Database(sessionDbPath);

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.PUBLIC_ORIGIN 
        : [
            'http://localhost:5173', 
            'http://localhost:5174',
            'http://localhost:2000',
            'http://localhost:2001',
            'http://localhost:3000'
          ],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Middleware
app.use(session({
    store: new SqliteSessionStore({
        client: sessionDb,
        expired: {
            clear: true,
            intervalMs: 900000 //ms = 15min
        }
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
    }
}));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Static Files (Production)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(rootDir, 'frontend/dist')));
}

// Branding static files (logos, favicon)
const BRANDING_DIR = path.join(rootDir, 'branding');
if (!fs.existsSync(BRANDING_DIR)) fs.mkdirSync(BRANDING_DIR, { recursive: true });
app.use('/branding', express.static(BRANDING_DIR));

// Helper: Get SMTP config from settings
const getSmtpConfig = () => {
    const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('smtp%');
    const config = {};
    settings.forEach(s => { config[s.key] = s.value; });
    return config;
};

// Helper: Get email templates from settings (with fallback to defaults)
const getEmailTemplates = () => {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get('emailTemplates');
    if (result && result.value) {
        try {
            const savedTemplates = JSON.parse(result.value);
            // Merge with defaults (saved templates take priority)
            return { ...DEFAULT_EMAIL_TEMPLATES, ...savedTemplates };
        } catch (e) {
            return DEFAULT_EMAIL_TEMPLATES;
        }
    }
    return DEFAULT_EMAIL_TEMPLATES;
};

// Helper: Replace variables in template
const replaceTemplateVariables = (template, variables) => {
    let result = template;
    Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value || '');
    });
    return result;
};

// Helper: Create nodemailer transporter
const createSmtpTransporter = () => {
    const config = getSmtpConfig();
    if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
        return null;
    }
    return nodemailer.createTransport({
        host: config.smtpHost,
        port: parseInt(config.smtpPort) || 587,
        secure: config.smtpSecure === 'true',
        auth: {
            user: config.smtpUser,
            pass: config.smtpPass
        }
    });
};

// Helper: Send Email with template support
const sendEmail = async (to, subject, text, html = null) => {
    const config = getSmtpConfig();
    const transporter = createSmtpTransporter();
    
    if (!transporter) {
        console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}, Body: ${text}`);
        return { success: true, mock: true };
    }
    
    const mailOptions = {
        from: config.smtpFrom || config.smtpUser,
        to,
        subject,
        text,
        ...(html && { html })
    };
    
    return transporter.sendMail(mailOptions);
};

// Helper: Send templated email
const sendTemplatedEmail = async (to, templateName, variables = {}) => {
    const templates = getEmailTemplates();
    const config = getSmtpConfig();
    
    // Get logo URL from branding settings
    const logoSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logoLight');
    const publicOrigin = process.env.PUBLIC_ORIGIN || 'http://localhost:5174';
    const logoUrl = logoSetting?.value ? `${publicOrigin}${logoSetting.value.split('?')[0]}` : `${publicOrigin}/logo.png`;
    
    // Default app variables
    const appVars = {
        appName: 'Sendu',
        appUrl: publicOrigin,
        logoUrl,
        ...variables
    };
    
    if (!templates || !templates[templateName]) {
        // Fallback to simple text email
        const subject = replaceTemplateVariables(variables.subject || 'Notificación', appVars);
        const text = replaceTemplateVariables(variables.text || '', appVars);
        return sendEmail(to, subject, text);
    }
    
    const template = templates[templateName];
    const subject = replaceTemplateVariables(template.subject, appVars);
    const html = replaceTemplateVariables(template.html, appVars);
    const text = html.replace(/<[^>]*>/g, ''); // Strip HTML for text version
    
    return sendEmail(to, subject, text, html);
};

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
    const { email, username, password } = req.body;
    if (!email || !username || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        const verificationToken = uuidv4();

        const stmt = db.prepare('INSERT INTO users (id, email, username, passwordHash, verificationToken, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(userId, email, username, hashedPassword, verificationToken, Date.now());

        // Send verification email using template
        const verificationLink = `${process.env.PUBLIC_ORIGIN || 'http://localhost:5174'}/verify?token=${verificationToken}`;
        await sendTemplatedEmail(email, 'welcome', {
            username,
            email,
            verificationLink
        });

        res.status(201).json({ message: 'Usuario registrado. Por favor verifica tu email.' });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'El email o nombre de usuario ya existe' });
        }
        console.error(err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { login, password } = req.body; // login can be email or username
    if (!login || !password) return res.status(400).json({ error: 'Faltan campos requeridos' });

    try {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?');
        const user = stmt.get(login, login);

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        req.session.userId = user.id;
        res.json({ message: 'Sesión iniciada correctamente', user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'No se pudo cerrar sesión' });
        res.clearCookie(process.env.SESSION_COOKIE_NAME || 'connect.sid');
        res.json({ message: 'Sesión cerrada' });
    });
});

app.get('/api/auth/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });

    const stmt = db.prepare('SELECT id, username, email, role, isVerified FROM users WHERE id = ?');
    const user = stmt.get(req.session.userId);

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user });
});

// Email verification endpoint
app.get('/api/auth/verify', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).json({ error: 'Token de verificación requerido' });
    }
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE verificationToken = ?').get(token);
        
        if (!user) {
            return res.status(400).json({ error: 'Token de verificación inválido o expirado' });
        }
        
        if (user.isVerified) {
            return res.json({ message: 'El email ya está verificado', alreadyVerified: true });
        }
        
        // Mark user as verified and clear token
        db.prepare('UPDATE users SET isVerified = 1, verificationToken = NULL WHERE id = ?').run(user.id);
        
        res.json({ message: 'Email verificado correctamente', success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al verificar email' });
    }
});

// Request password reset
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email requerido' });
    }
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        
        // Always return success to prevent email enumeration
        if (!user) {
            return res.json({ message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña' });
        }
        
        // Generate reset token (valid for 1 hour)
        const resetToken = uuidv4();
        const resetTokenExpires = Date.now() + (60 * 60 * 1000); // 1 hour
        
        db.prepare('UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE id = ?').run(resetToken, resetTokenExpires, user.id);
        
        // Send password reset email
        const resetLink = `${process.env.PUBLIC_ORIGIN || 'http://localhost:5174'}/reset-password?token=${resetToken}`;
        await sendTemplatedEmail(email, 'passwordReset', {
            username: user.username,
            email: user.email,
            resetLink
        });
        
        res.json({ message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al procesar la solicitud' });
    }
});

// Validate reset token
app.get('/api/auth/reset-password/validate', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).json({ error: 'Token requerido', valid: false });
    }
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE resetToken = ?').get(token);
        
        if (!user) {
            return res.status(400).json({ error: 'Token inválido', valid: false });
        }
        
        if (user.resetTokenExpires && Date.now() > user.resetTokenExpires) {
            return res.status(400).json({ error: 'El token ha expirado', valid: false });
        }
        
        res.json({ valid: true, username: user.username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al validar token', valid: false });
    }
});

// Reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    
    if (!token || !password) {
        return res.status(400).json({ error: 'Token y contraseña requeridos' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE resetToken = ?').get(token);
        
        if (!user) {
            return res.status(400).json({ error: 'Token inválido o expirado' });
        }
        
        if (user.resetTokenExpires && Date.now() > user.resetTokenExpires) {
            return res.status(400).json({ error: 'El token ha expirado' });
        }
        
        // Update password and clear reset token
        const hashedPassword = await bcrypt.hash(password, 10);
        db.prepare('UPDATE users SET passwordHash = ?, resetToken = NULL, resetTokenExpires = NULL WHERE id = ?').run(hashedPassword, user.id);
        
        res.json({ message: 'Contraseña actualizada correctamente', success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al actualizar contraseña' });
    }
});

// Resend verification email
app.post('/api/auth/resend-verification', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        if (user.isVerified) {
            return res.status(400).json({ error: 'El email ya está verificado' });
        }
        
        // Generate new verification token
        const verificationToken = uuidv4();
        db.prepare('UPDATE users SET verificationToken = ? WHERE id = ?').run(verificationToken, user.id);
        
        // Send verification email
        const verificationLink = `${process.env.PUBLIC_ORIGIN || 'http://localhost:5174'}/verify?token=${verificationToken}`;
        await sendTemplatedEmail(user.email, 'welcome', {
            username: user.username,
            email: user.email,
            verificationLink
        });
        
        res.json({ message: 'Email de verificación reenviado' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al reenviar email de verificación' });
    }
});

// Upload Routes
const UPLOAD_DIR = process.env.STORAGE_PATH || path.join(rootDir, 'uploads');
const CHUNKS_DIR = path.join(UPLOAD_DIR, 'chunks');

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });

// Helper: Get upload limits from settings
const getUploadLimits = () => {
    const keys = ['maxFileSize', 'maxTotalSize'];
    const stmt = db.prepare(`SELECT * FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`);
    const settings = stmt.all(...keys);
    
    const limits = {
        maxFileSize: 100,  // Default 100MB
        maxTotalSize: 500  // Default 500MB
    };
    
    settings.forEach(s => limits[s.key] = parseInt(s.value) || limits[s.key]);
    return limits;
};

app.post('/api/upload/init', (req, res) => {
    const { originalName, size, mimeType, totalChunks } = req.body;
    
    // Validate file size against limits
    const limits = getUploadLimits();
    const maxFileSizeBytes = limits.maxFileSize * 1024 * 1024;
    
    if (size > maxFileSizeBytes) {
        return res.status(400).json({ 
            error: `El archivo excede el límite de ${limits.maxFileSize}MB` 
        });
    }
    
    const uploadId = uuidv4();
    const uploadPath = path.join(CHUNKS_DIR, uploadId);

    fs.mkdirSync(uploadPath);
    fs.writeFileSync(path.join(uploadPath, 'meta.json'), JSON.stringify({
        originalName,
        size,
        mimeType,
        totalChunks,
        userId: req.session.userId || null,
        createdAt: Date.now(),
        expires: req.body.expires,
        password: req.body.password
    }));

    res.json({ uploadId });
});

const upload = multer({ dest: path.join(rootDir, 'tmp') });

app.post('/api/upload/chunk', upload.single('chunk'), (req, res) => {
    const { uploadId, index } = req.query;
    const chunkPath = path.join(CHUNKS_DIR, uploadId, `${index}.part`);

    if (!req.file) return res.status(400).json({ error: 'No se proporcionó el fragmento' });
    if (!fs.existsSync(path.join(CHUNKS_DIR, uploadId))) return res.status(404).json({ error: 'Sesión de subida no encontrada' });

    fs.renameSync(req.file.path, chunkPath);

    res.json({ message: 'Fragmento subido' });
});

app.post('/api/upload/complete', async (req, res) => {
    const { uploadId } = req.body;
    
    if (!uploadId) {
        return res.status(400).json({ error: 'Se requiere el ID de subida' });
    }
    
    const uploadPath = path.join(CHUNKS_DIR, uploadId);

    if (!fs.existsSync(uploadPath)) return res.status(404).json({ error: 'Sesión de subida no encontrada' });

    let meta;
    try {
        meta = JSON.parse(fs.readFileSync(path.join(uploadPath, 'meta.json')));
    } catch (err) {
        return res.status(400).json({ error: 'Sesión de subida inválida: faltan metadatos' });
    }
    
    const finalFileId = uuidv4();
    const finalPath = path.join(UPLOAD_DIR, finalFileId);

    try {
        // Assemble file synchronously to avoid stream callback issues
        const chunks = [];
        for (let i = 0; i < meta.totalChunks; i++) {
            const chunkPath = path.join(uploadPath, `${i}.part`);
            if (!fs.existsSync(chunkPath)) {
                throw new Error(`Missing chunk ${i}`);
            }
            chunks.push(fs.readFileSync(chunkPath));
        }
        
        // Write all chunks to final file
        fs.writeFileSync(finalPath, Buffer.concat(chunks));

        // Clean up chunks directory
        fs.rmSync(uploadPath, { recursive: true, force: true });

        let expiresAt = null;
        if (meta.expires) {
            expiresAt = Date.now() + (parseInt(meta.expires) * 24 * 60 * 60 * 1000);
        }

        let passwordHash = null;
        if (meta.password) {
            passwordHash = await bcrypt.hash(meta.password, 10);
        }

        const stmt = db.prepare(`
            INSERT INTO files (id, originalName, serverPath, mimeType, size, createdAt, userId, expiresAt, passwordHash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(finalFileId, meta.originalName, finalPath, meta.mimeType, meta.size, Date.now(), meta.userId, expiresAt, passwordHash);

        res.json({ fileId: finalFileId, message: 'Subida completada' });

    } catch (err) {
        console.error('Error al completar subida:', err);
        // Clean up on error
        if (fs.existsSync(uploadPath)) {
            fs.rmSync(uploadPath, { recursive: true, force: true });
        }
        if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
        }
        res.status(500).json({ error: err.message || 'Error al completar la subida' });
    }
});

// ... (previous code)



// Download Routes
app.get('/api/meta/:id', (req, res) => {
    const { id } = req.params;
    const stmt = db.prepare('SELECT id, originalName, size, mimeType, createdAt, expiresAt, maxDownloads, downloadCount, userId, passwordHash FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check expiration
    if (file.expiresAt && Date.now() > file.expiresAt) {
        return res.status(410).json({ error: 'El archivo ha expirado' });
    }

    // Check download limit
    if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
        return res.status(410).json({ error: 'Límite de descargas alcanzado' });
    }

    const isOwner = req.session.userId && req.session.userId === file.userId;
    const hasPassword = !!file.passwordHash;

    res.json({
        id: file.id,
        originalName: file.originalName,
        size: file.size,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
        expiresAt: file.expiresAt,
        hasPassword,
        isOwner
    });
});

app.post('/api/download/:id', async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check expiration
    if (file.expiresAt && Date.now() > file.expiresAt) {
        return res.status(410).json({ error: 'El archivo ha expirado' });
    }

    // Check download limit
    if (file.maxDownloads && file.downloadCount >= file.maxDownloads) {
        return res.status(410).json({ error: 'Límite de descargas alcanzado' });
    }

    // Verify password if set
    if (file.passwordHash) {
        if (!password) return res.status(401).json({ error: 'Contraseña requerida' });
        const match = await bcrypt.compare(password, file.passwordHash);
        if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Increment download count
    const updateStmt = db.prepare('UPDATE files SET downloadCount = downloadCount + 1 WHERE id = ?');
    updateStmt.run(id);

    // Send file
    res.download(file.serverPath, file.originalName);
});

// User Files Route
app.get('/api/user/files', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });

    const stmt = db.prepare('SELECT * FROM files WHERE userId = ? ORDER BY createdAt DESC');
    const files = stmt.all(req.session.userId);

    res.json({ files });
});

app.delete('/api/files/:id', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });

    const { id } = req.params;
    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Check ownership or admin
    const userStmt = db.prepare('SELECT role FROM users WHERE id = ?');
    const user = userStmt.get(req.session.userId);

    if (file.userId !== req.session.userId && user.role !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    // Delete from DB
    const deleteStmt = db.prepare('DELETE FROM files WHERE id = ?');
    deleteStmt.run(id);

    // Delete from disk
    if (fs.existsSync(file.serverPath)) {
        fs.unlinkSync(file.serverPath);
    }

    res.json({ message: 'Archivo eliminado' });
});

// Admin Routes
const requireAdmin = (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
    const stmt = db.prepare('SELECT role FROM users WHERE id = ?');
    const user = stmt.get(req.session.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    next();
};

app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const fileCount = db.prepare('SELECT COUNT(*) as count FROM files').get().count;
    const totalSize = db.prepare('SELECT SUM(size) as size FROM files').get().size || 0;

    res.json({ userCount, fileCount, totalSize });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, email, username, role, isVerified, createdAt FROM users').all();
    res.json({ users });
});

// Update user
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { email, username } = req.body;
    
    try {
        const stmt = db.prepare('UPDATE users SET email = ?, username = ? WHERE id = ?');
        stmt.run(email, username, id);
        res.json({ message: 'Usuario actualizado' });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Email o username ya existe' });
        }
        console.error(err);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    
    // Prevent deleting yourself
    if (id === req.session.userId) {
        return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }
    
    try {
        // Delete user's files first
        const userFiles = db.prepare('SELECT id, serverPath FROM files WHERE userId = ?').all(id);
        userFiles.forEach(file => {
            if (file.serverPath && fs.existsSync(file.serverPath)) {
                fs.unlinkSync(file.serverPath);
            }
        });
        db.prepare('DELETE FROM files WHERE userId = ?').run(id);
        
        // Delete user
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        res.json({ message: 'Usuario eliminado' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

// Toggle user role (admin/user)
app.post('/api/admin/users/:id/toggle-role', requireAdmin, (req, res) => {
    const { id } = req.params;
    
    // Prevent changing your own role
    if (id === req.session.userId) {
        return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    }
    
    try {
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        
        const newRole = user.role === 'admin' ? 'user' : 'admin';
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, id);
        res.json({ message: 'Rol actualizado', role: newRole });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al cambiar rol' });
    }
});

// Toggle user verified status
app.post('/api/admin/users/:id/toggle-verified', requireAdmin, (req, res) => {
    const { id } = req.params;
    
    try {
        const user = db.prepare('SELECT isVerified FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        
        const newVerified = user.isVerified ? 0 : 1;
        db.prepare('UPDATE users SET isVerified = ? WHERE id = ?').run(newVerified, id);
        res.json({ message: 'Estado de verificación actualizado', isVerified: newVerified });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al cambiar verificación' });
    }
});

// Reset user password
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hashedPassword, id);
        res.json({ message: 'Contraseña actualizada' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

// Admin: Send verification email to user
app.post('/api/admin/users/:id/send-verification', requireAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        
        if (user.isVerified) {
            return res.status(400).json({ error: 'El usuario ya está verificado' });
        }
        
        // Generate new verification token
        const verificationToken = uuidv4();
        db.prepare('UPDATE users SET verificationToken = ? WHERE id = ?').run(verificationToken, id);
        
        // Send verification email
        const verificationLink = `${process.env.PUBLIC_ORIGIN || 'http://localhost:5174'}/verify?token=${verificationToken}`;
        await sendTemplatedEmail(user.email, 'verification', {
            username: user.username,
            email: user.email,
            verificationLink
        });
        
        res.json({ message: 'Email de verificación enviado' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al enviar email de verificación' });
    }
});

// Admin: Send password reset email to user
app.post('/api/admin/users/:id/send-reset', requireAdmin, async (req, res) => {
    const { id } = req.params;
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        
        // Generate reset token (valid for 1 hour)
        const resetToken = uuidv4();
        const resetTokenExpires = Date.now() + (60 * 60 * 1000); // 1 hour
        
        db.prepare('UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE id = ?').run(resetToken, resetTokenExpires, id);
        
        // Send password reset email
        const resetLink = `${process.env.PUBLIC_ORIGIN || 'http://localhost:5174'}/reset-password?token=${resetToken}`;
        await sendTemplatedEmail(user.email, 'passwordReset', {
            username: user.username,
            email: user.email,
            resetLink
        });
        
        res.json({ message: 'Email de reseteo de contraseña enviado' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al enviar email de reseteo' });
    }
});

app.get('/api/admin/files', requireAdmin, (req, res) => {
    const files = db.prepare('SELECT * FROM files ORDER BY createdAt DESC LIMIT 100').all();
    res.json({ files });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    res.json(settingsMap);
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
    const settings = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    const insertMany = db.transaction((settings) => {
        for (const [key, value] of Object.entries(settings)) {
            stmt.run(key, String(value));
        }
    });

    try {
        insertMany(settings);
        res.json({ message: 'Configuración actualizada' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

// Branding Upload (logos and favicon)
const brandingUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, BRANDING_DIR),
        filename: (req, file, cb) => {
            const type = req.query.type; // 'logoLight', 'logoDark', 'favicon'
            const ext = path.extname(file.originalname);
            cb(null, `${type}${ext}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo inválido. Solo se permiten PNG, JPG, SVG e ICO.'));
        }
    }
});

app.post('/api/admin/branding/upload', requireAdmin, brandingUpload.single('file'), (req, res) => {
    const type = req.query.type;
    if (!['logoLight', 'logoDark', 'favicon'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido. Debe ser logoLight, logoDark o favicon' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Save the path in settings
    const fileUrl = `/branding/${req.file.filename}?t=${Date.now()}`;
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(type, fileUrl);

    res.json({ message: 'Archivo subido', url: fileUrl });
});

app.delete('/api/admin/branding/:type', requireAdmin, (req, res) => {
    const { type } = req.params;
    if (!['logoLight', 'logoDark', 'favicon'].includes(type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
    }

    // Find and delete the file
    const files = fs.readdirSync(BRANDING_DIR);
    const fileToDelete = files.find(f => f.startsWith(type));
    if (fileToDelete) {
        fs.unlinkSync(path.join(BRANDING_DIR, fileToDelete));
    }

    // Remove from settings
    const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
    stmt.run(type);

    res.json({ message: 'Recurso de marca eliminado' });
});

// SMTP Test Endpoint
app.post('/api/admin/smtp/test', requireAdmin, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Se requiere una dirección de email' });
    }

    try {
        const config = getSmtpConfig();
        
        if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
            return res.status(400).json({ error: 'Configuración SMTP incompleta. Guarda la configuración primero.' });
        }

        const result = await sendEmail(
            email,
            'Sendu - Email de Prueba',
            'Este es un email de prueba desde Sendu. Si recibes este mensaje, la configuración SMTP está funcionando correctamente.',
            '<h1>Sendu - Email de Prueba</h1><p>Si recibes este mensaje, la configuración SMTP está funcionando correctamente.</p>'
        );

        if (result.mock) {
            return res.json({ message: 'Email enviado (modo simulación)', mock: true });
        }

        res.json({ message: 'Email de prueba enviado correctamente', messageId: result.messageId });
    } catch (err) {
        console.error('SMTP Test Error:', err);
        res.status(500).json({ error: `Error SMTP: ${err.message}` });
    }
});

// Public Settings (for Navbar/Branding)
app.get('/api/settings/public', (req, res) => {
    const keys = ['showName', 'logoLight', 'logoDark', 'favicon', 'footerText'];
    const stmt = db.prepare(`SELECT * FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`);
    const settings = stmt.all(...keys);

    const settingsMap = {
        showName: 'true',
        logoLight: '',
        logoDark: '',
        favicon: '',
        footerText: ''
    };

    settings.forEach(s => settingsMap[s.key] = s.value);
    res.json(settingsMap);
});

// Upload Limits (public)
app.get('/api/settings/limits', (req, res) => {
    const keys = ['maxFileSize', 'maxTotalSize'];
    const stmt = db.prepare(`SELECT * FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`);
    const settings = stmt.all(...keys);

    const settingsMap = {
        maxFileSize: 100,  // Default 100MB
        maxTotalSize: 500  // Default 500MB
    };

    settings.forEach(s => settingsMap[s.key] = parseInt(s.value) || settingsMap[s.key]);
    res.json(settingsMap);
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Database Initialization (Schema)
const initDb = () => {
    // Users Table
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      isVerified INTEGER DEFAULT 0,
      verificationToken TEXT,
      resetToken TEXT,
      resetTokenExpires INTEGER,
      createdAt INTEGER NOT NULL
    );
  `);

    // Files Table
    db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      originalName TEXT NOT NULL,
      serverPath TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER,
      maxDownloads INTEGER,
      downloadCount INTEGER DEFAULT 0,
      passwordHash TEXT,
      userId TEXT,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);

    // Settings Table
    db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

    // Reports Table
    db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      fileId TEXT NOT NULL,
      reason TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (fileId) REFERENCES files(id)
    );
  `);

    console.log('Database initialized');
};

initDb();

export { db };
