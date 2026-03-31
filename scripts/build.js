#!/usr/bin/env node
/**
 * Build script - Generates a production-ready build
 * Contains frontend (compiled), backend (copied), and Docker files
 * Outputs a ZIP file in /release folder
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(rootDir, 'release');

// Get version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;
const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
const zipFileName = `sendu-v${version}-${timestamp}.zip`;

console.log('🚀 Starting build process...\n');
console.log(`📦 Version: ${version}`);
console.log(`📅 Date: ${timestamp}`);
console.log('🔒 Note: Secrets will be generated at deployment time (not included in build)');
console.log();

// Validation errors collector
const errors = [];
const warnings = [];

// Step 1: Clean dist folder
console.log('📁 Cleaning dist folder...');
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Step 2: Build frontend
console.log('⚛️  Building frontend...');
try {
    execSync('npm run build', { cwd: path.join(rootDir, 'frontend'), stdio: 'inherit' });
} catch (err) {
    console.error('❌ Frontend build failed');
    process.exit(1);
}

// Step 3: Copy frontend build to dist/public
console.log('📦 Copying frontend build...');
const frontendDist = path.join(rootDir, 'frontend', 'dist');
const publicDir = path.join(distDir, 'public');
if (!fs.existsSync(frontendDist)) {
    errors.push('Frontend build output not found at frontend/dist');
} else {
    fs.cpSync(frontendDist, publicDir, { recursive: true });
}

// Step 4: Copy backend files
console.log('📦 Copying backend files...');
const backendDir = path.join(distDir, 'backend');
fs.mkdirSync(backendDir, { recursive: true });

// Copy backend folder (excluding tests)
const backendSrc = path.join(rootDir, 'backend');
const shouldSkipBackendCopy = (src) => {
    const baseName = path.basename(src);
    if (['tests', 'logs'].includes(baseName)) {
        return true;
    }

    return (
        baseName.endsWith('.sqlite')
        || baseName.endsWith('.sqlite-shm')
        || baseName.endsWith('.sqlite-wal')
        || baseName.endsWith('.db')
    );
};

const copyBackendFile = (src, dest) => {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        if (shouldSkipBackendCopy(src)) return; // Skip tests, logs, and local database artifacts
        fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(src)) {
            copyBackendFile(path.join(src, file), path.join(dest, file));
        }
    } else {
        if (shouldSkipBackendCopy(src)) return;
        fs.copyFileSync(src, dest);
    }
};
copyBackendFile(backendSrc, backendDir);

// Step 5: Copy scripts folder (cleanup script)
console.log('📦 Copying scripts...');
const scriptsDistDir = path.join(distDir, 'scripts');
fs.mkdirSync(scriptsDistDir, { recursive: true });
fs.copyFileSync(path.join(rootDir, 'scripts', 'cleanup.js'), path.join(scriptsDistDir, 'cleanup.js'));

// Step 6: Create production package.json
console.log('📝 Creating production package.json...');
const prodPkg = {
    name: pkg.name,
    version: pkg.version,
    type: 'module',
    scripts: {
        start: 'node backend/server.js',
        cleanup: 'node scripts/cleanup.js'
    },
    dependencies: pkg.dependencies
};
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(prodPkg, null, 2));

// Copy package-lock.json if it exists
const lockFilePath = path.join(rootDir, 'package-lock.json');
if (fs.existsSync(lockFilePath)) {
    fs.copyFileSync(lockFilePath, path.join(distDir, 'package-lock.json'));
}

// Step 7: Create necessary folders
console.log('📁 Creating required folders...');
fs.mkdirSync(path.join(distDir, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'uploads', 'chunks'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'tmp'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'branding'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'backend', 'logs'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'data'), { recursive: true });

// Copy default branding assets if present
const brandingSrc = path.join(rootDir, 'branding');
const brandingDest = path.join(distDir, 'branding');
if (fs.existsSync(brandingSrc)) {
    fs.cpSync(brandingSrc, brandingDest, { recursive: true });
}

// Step 8: Create .env.example
console.log('📝 Creating .env.example...');
const envExample = `# Sendu v${version} - Production Environment Configuration
# Generated: ${new Date().toISOString()}

NODE_ENV=production
PORT=4000

# ===========================================
# REQUIRED SETTINGS
# ===========================================

# Session secret - use a strong random string (min 32 characters)
# Generate with: openssl rand -hex 32
SESSION_SECRET=your-super-secret-session-key-change-this

# Public URL of your application (no trailing slash)
# This is the primary URL used for email links
PUBLIC_ORIGIN=https://yourdomain.com

# Allowed origins for CORS (comma-separated)
ALLOWED_ORIGINS=https://yourdomain.com

# ===========================================
# OPTIONAL SETTINGS
# ===========================================

# Cookie domain for sharing sessions across subdomains (optional)
# Example: .yourdomain.com
SESSION_COOKIE_DOMAIN=.yourdomain.com

# Custom session cookie name
SESSION_COOKIE_NAME=sendu.sid

# SameSite policy for session cookie (lax|strict|none)
# Use "none" only with HTTPS and if frontend/API are on different sites
SESSION_COOKIE_SAMESITE=lax

# Secure flag for session cookie (true|false)
# Set to false only if TLS is terminated upstream and secure cookies aren't being set
SESSION_COOKIE_SECURE=true

# Trust reverse proxy (set to 1 if behind Nginx/Traefik/Cloudflare)
TRUST_PROXY=1

# Enable strict CSP (true/false)
CSP_STRICT=false

# ===========================================
# USER REGISTRATION
# ===========================================

# Allow public registration (true/false)
ALLOW_PUBLIC_REGISTRATION=false

# Bootstrap token for first admin (optional if first-user bootstrap is enabled)
ADMIN_BOOTSTRAP_TOKEN=your-bootstrap-token

# ===========================================
# STORAGE PATHS (optional)
# ===========================================

# Path where database is stored
# APP_DATA_PATH=/app/data

# Path where uploads are stored
# APP_UPLOADS_PATH=/app/uploads

# Path for temporary files
# APP_TEMP_PATH=/app/tmp

# Max age for upload sessions (hours)
UPLOAD_SESSION_MAX_AGE_HOURS=24

# ===========================================
# SMTP EMAIL CONFIGURATION (Optional)
# ===========================================

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@yourdomain.com
`;
fs.writeFileSync(path.join(distDir, '.env.example'), envExample);

// Step 8b: Create init-secrets.sh script for Docker entrypoint
console.log('🔐 Creating secrets initialization script...');
const initSecretsScript = `#!/bin/bash
# Auto-generate secrets on first run if not provided
# This runs at container startup, not at build time

ENV_FILE="/app/.env"
ENV_EXAMPLE="/app/.env.example"

# If .env doesn't exist but .env.example does, copy it
if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
fi

# If SESSION_SECRET is not set or is the placeholder, generate one
if [ -z "$SESSION_SECRET" ] || [ "$SESSION_SECRET" = "your-super-secret-session-key-change-this" ]; then
    if [ -f "$ENV_FILE" ]; then
        # Generate secure secret
        NEW_SECRET=$(openssl rand -hex 64 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 128 | head -n 1)
        
        # Update .env file
        if grep -q "^SESSION_SECRET=" "$ENV_FILE"; then
            sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$NEW_SECRET/" "$ENV_FILE"
        else
            echo "SESSION_SECRET=$NEW_SECRET" >> "$ENV_FILE"
        fi
        
        echo "✅ Generated new SESSION_SECRET"
    fi
    export SESSION_SECRET="$NEW_SECRET"
fi

# Warn if PUBLIC_ORIGIN is not set
if [ -z "$PUBLIC_ORIGIN" ] || [ "$PUBLIC_ORIGIN" = "https://yourdomain.com" ]; then
    echo "⚠️  WARNING: PUBLIC_ORIGIN is not configured. Please set it in .env or as environment variable."
fi
`;
fs.writeFileSync(path.join(distDir, 'init-secrets.sh'), initSecretsScript);

// Step 9: Create startup scripts
console.log('📝 Creating startup scripts...');

// Windows batch file
const startBat = `@echo off
echo Starting Sendu v${version}...
set NODE_ENV=production
node backend/server.js
`;
fs.writeFileSync(path.join(distDir, 'start.bat'), startBat);

// Unix shell script
const startSh = `#!/bin/bash
echo "Starting Sendu v${version}..."
export NODE_ENV=production
node backend/server.js
`;
fs.writeFileSync(path.join(distDir, 'start.sh'), startSh);

// Step 10: Copy Docker files
console.log('🐳 Copying Docker files...');
const dockerFiles = [
    { src: 'Dockerfile.prebuilt', dest: 'Dockerfile' },
    { src: 'docker-compose.prebuilt.yml', dest: 'docker-compose.yml' }
];

for (const { src, dest } of dockerFiles) {
    const srcPath = path.join(rootDir, src);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(distDir, dest));
    } else {
        errors.push(`Docker file not found: ${src}`);
    }
}

// Step 11: Create README for the release
console.log('📝 Creating README...');
const readme = `# Sendu v${version}

File sharing application - Production Build
Generated: ${new Date().toISOString()}

## Quick Start with Docker (Recommended)

1. **Configure environment variables**:
   
   Copy the example and edit:
   \`\`\`bash
   cp .env.example .env
   nano .env
   \`\`\`
   Required: Set \`PUBLIC_ORIGIN\` to your actual domain:
   \`\`\`
   PUBLIC_ORIGIN=https://your-actual-domain.com
   \`\`\`
   NOTE: \`SESSION_SECRET\` is required. Generate one with:
   \`\`\`bash
   openssl rand -hex 64
   \`\`\`

2. Start the application:
   \`\`\`bash
   docker compose up -d --build
   \`\`\`

3. Access the application at your configured URL (default: \`http://localhost:4000\`)

## Security Notes
**Secrets are NOT included in the build artifact**:
- \`SESSION_SECRET\` must be set via environment variable or .env file
- \`PUBLIC_ORIGIN\` must be set to your domain
- Never commit .env files with real secrets to version control

## Manual Installation (Without Docker)

1. Install dependencies:
   \`\`\`bash
   npm install --production
   \`\`\`

2. Copy and configure environment:
   \`\`\`bash
   cp .env.example .env
   # Generate a session secret
   openssl rand -hex 64
   # Edit .env and add the secret
   nano .env
   \`\`\`

3. Start the server:
   \`\`\`bash
   npm start
   # Or use: ./start.sh (Linux) or start.bat (Windows)
   \`\`\`

## Data Persistence

The following directories contain persistent data:
- \`data/\` - SQLite database (users, files, sessions, CSRF tokens)
- \`uploads/\` - Uploaded files
- \`backend/logs/\` - Application logs
- \`branding/\` - Custom branding files

## Multi-Replica Support

This version supports running multiple replicas behind a load balancer:
- Sessions are stored in SQLite (shared across replicas)
- CSRF tokens are stored in SQLite
- Guest upload tracking is stored in SQLite
- Download tokens are stored in SQLite
- Background job queue is stored in SQLite (with distributed locking)

For multi-replica deployments, ensure:
1. All replicas share the same \`data/\` directory (via shared volume or NFS)
2. All replicas use the same \`SESSION_SECRET\`

## Background Job Queue

Emails and cleanup tasks run asynchronously via a persistent job queue:
- Automatic retry with exponential backoff
- Jobs survive server restarts
- Admin endpoints: \`GET /api/admin/jobs/stats\`, \`POST /api/admin/jobs/cleanup\`

## Health Check

The application exposes a health endpoint at \`/api/health\`

## Email Configuration (Optional)

To enable email features (password reset, notifications), edit \`.env\` and add:
\`\`\`
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=Sendu <your-email@gmail.com>
\`\`\`

## Support

For issues and updates, visit the project repository.
`;
fs.writeFileSync(path.join(distDir, 'README.md'), readme);

// Step 12: Modify server.js to serve frontend in production
console.log('🔧 Updating server for production...');
const serverPath = path.join(distDir, 'backend', 'server.js');
let serverCode = fs.readFileSync(serverPath, 'utf8');

// Remove the old static file serving block that points to frontend/dist
serverCode = serverCode.replace(
    /\/\/ Static Files \(Production\)\s*\nif \(process\.env\.NODE_ENV === 'production'\) \{\s*\n\s*app\.use\(express\.static\(path\.join\(rootDir, 'frontend\/dist'\)\)\);\s*\n\}/,
    '// Static files are served from /public via middleware added above'
);

// Find where to add static serving (before app.use(express.json()))
const jsonMiddleware = "app.use(express.json());";
const jsonIndex = serverCode.indexOf(jsonMiddleware);
if (jsonIndex > -1) {
    const staticServing = `// Serve static frontend files in production
app.use(express.static(path.join(rootDir, 'public')));
`;
    serverCode = serverCode.slice(0, jsonIndex) + staticServing + serverCode.slice(jsonIndex);
} else {
    warnings.push('Could not find express.json() middleware to insert static serving');
}

// Add SPA fallback for client-side routing before notFoundHandler (only if not already present in source)
if (!serverCode.includes('// SPA Fallback') && !serverCode.includes('SPA fallback')) {
    const notFoundHandlerIndex = serverCode.indexOf("app.use(notFoundHandler);");
    if (notFoundHandlerIndex > -1) {
        const spaFallback = `// SPA Fallback - serve index.html for client-side routing
app.get('/{*path}', (req, res, next) => {
    // Skip API routes and branding
    if (req.path.startsWith('/api/') || req.path.startsWith('/branding/')) {
        return next();
    }
    res.sendFile(path.join(rootDir, 'public', 'index.html'));
});

`;
        serverCode = serverCode.slice(0, notFoundHandlerIndex) + spaFallback + serverCode.slice(notFoundHandlerIndex);
    }
}

// Add startup log to show the public path for debugging
const serverStartLog = "logger.info(`Server running on port ${PORT}`);";
const startLogIndex = serverCode.indexOf(serverStartLog);
if (startLogIndex > -1) {
    const debugLog = `logger.info(\`Serving static files from: \${path.join(rootDir, 'public')}\`);
    `;
    serverCode = serverCode.slice(0, startLogIndex) + debugLog + serverCode.slice(startLogIndex);
}

fs.writeFileSync(serverPath, serverCode);

// Step 13: Validate build
console.log('\n🔍 Validating build...');

// Check required files exist
const requiredFiles = [
    'package.json',
    'Dockerfile',
    'docker-compose.yml',
    '.env.example',
    'init-secrets.sh',
    'README.md',
    'backend/server.js',
    'public/index.html'
];

for (const file of requiredFiles) {
    const filePath = path.join(distDir, file);
    if (!fs.existsSync(filePath)) {
        errors.push(`Required file missing: ${file}`);
    }
}

// Check required directories exist
const requiredDirs = ['backend', 'public', 'uploads', 'data', 'scripts'];
for (const dir of requiredDirs) {
    const dirPath = path.join(distDir, dir);
    if (!fs.existsSync(dirPath)) {
        errors.push(`Required directory missing: ${dir}`);
    }
}

// Check server.js has the static serving code
if (!serverCode.includes("express.static(path.join(rootDir, 'public'))")) {
    errors.push('Server.js missing static file serving');
}

// Check server.js has the SPA fallback
if (!serverCode.includes('// SPA Fallback')) {
    errors.push('Server.js missing SPA fallback route');
}

// Print validation results
if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(w => console.log(`   - ${w}`));
}

if (errors.length > 0) {
    console.log('\n❌ Build validation failed:');
    errors.forEach(e => console.log(`   - ${e}`));
    process.exit(1);
}

console.log('✅ Build validation passed!');

// Step 14: Create release folder and ZIP
console.log('\n📦 Creating release package...');

// Clean and create release folder
if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
}
fs.mkdirSync(releaseDir, { recursive: true });

// Create ZIP file using PowerShell (Windows) or zip command (Unix)
const zipPath = path.join(releaseDir, zipFileName);
const isWindows = process.platform === 'win32';

try {
    if (isWindows) {
        // Use PowerShell's Compress-Archive
        execSync(
            `powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force"`,
            { stdio: 'inherit' }
        );
    } else {
        // Use zip command on Unix
        execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
    }
    
    // Get ZIP file size
    const stats = fs.statSync(zipPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`\n✅ Release package created: ${zipFileName} (${sizeMB} MB)`);
} catch (err) {
    console.error('❌ Failed to create ZIP file:', err.message);
    console.log('📂 Build files are available in dist/ folder');
}

// Final summary
console.log('\n' + '='.repeat(60));
console.log('✅ BUILD COMPLETED SUCCESSFULLY!');
console.log('='.repeat(60));
console.log(`\n📂 Build folder: dist/`);
console.log(`📦 Release ZIP:  release/${zipFileName}`);
console.log('\n🔐 Security configuration:');
console.log('   SESSION_SECRET: Must be set in .env (required in production)');
console.log('   ⚠️  PUBLIC_ORIGIN: Must be set to your domain in .env');
console.log('\n🚀 To deploy on your server:');
console.log('   1. Upload the ZIP file to your server');
console.log('   2. Extract: unzip ' + zipFileName);
console.log('   3. Edit .env and set PUBLIC_ORIGIN to your domain');
console.log('   4. Run: docker compose up -d --build');
