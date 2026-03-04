#!/usr/bin/env node
/**
 * Script de diagnóstico para problemas de sesión en Sendu
 * Ejecuta: node scripts/diagnose-session.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

console.log('\n========================================');
console.log('  DIAGNÓSTICO DE SESIÓN - SENDU v2');
console.log('========================================\n');

const issues = [];
const warnings = [];
const ok = [];

// 1. Verificar NODE_ENV
const nodeEnv = process.env.NODE_ENV;
console.log(`NODE_ENV: ${nodeEnv || '(no definido)'}`);
if (nodeEnv === 'production') {
    ok.push('NODE_ENV está en production');
} else {
    warnings.push('NODE_ENV no está en production - algunas configuraciones de seguridad estarán deshabilitadas');
}

// 2. Verificar SESSION_SECRET
const sessionSecret = process.env.SESSION_SECRET;
console.log(`SESSION_SECRET: ${sessionSecret ? '***' + sessionSecret.slice(-4) : '(no definido)'}`);
if (!sessionSecret) {
    issues.push('SESSION_SECRET no está definido - las sesiones no funcionarán correctamente');
} else if (sessionSecret.length < 32) {
    warnings.push('SESSION_SECRET tiene menos de 32 caracteres - se recomienda uno más largo');
} else {
    ok.push('SESSION_SECRET está configurado correctamente');
}

// 3. Verificar PUBLIC_ORIGIN
const publicOrigin = process.env.PUBLIC_ORIGIN;
console.log(`PUBLIC_ORIGIN: ${publicOrigin || '(no definido)'}`);
if (!publicOrigin) {
    issues.push('PUBLIC_ORIGIN no está definido - requerido en producción');
} else {
    if (publicOrigin.endsWith('/')) {
        warnings.push('PUBLIC_ORIGIN termina con / - debería ser sin slash final');
    }
    if (nodeEnv === 'production' && publicOrigin.startsWith('http://')) {
        issues.push('PUBLIC_ORIGIN usa HTTP en producción - las cookies seguras no funcionarán');
    }
    if (publicOrigin.startsWith('https://')) {
        ok.push('PUBLIC_ORIGIN usa HTTPS correctamente');
    }
}

// 4. Verificar ALLOWED_ORIGINS
const allowedOrigins = process.env.ALLOWED_ORIGINS;
console.log(`ALLOWED_ORIGINS: ${allowedOrigins || '(no definido, usará PUBLIC_ORIGIN)'}`);
if (allowedOrigins && publicOrigin && !allowedOrigins.includes(publicOrigin)) {
    warnings.push('ALLOWED_ORIGINS no incluye PUBLIC_ORIGIN - podría causar problemas de CORS');
}

// 5. Verificar configuración de cookies
const cookieDomain = process.env.SESSION_COOKIE_DOMAIN;
const cookieSameSite = process.env.SESSION_COOKIE_SAMESITE || 'lax';
const cookieSecure = process.env.SESSION_COOKIE_SECURE;
const cookieName = process.env.SESSION_COOKIE_NAME || 'sendu.sid';

console.log(`SESSION_COOKIE_DOMAIN: ${cookieDomain || '(no definido, usará el dominio del request)'}`);
console.log(`SESSION_COOKIE_SAMESITE: ${cookieSameSite}`);
console.log(`SESSION_COOKIE_SECURE: ${cookieSecure || '(auto: true en producción)'}`);
console.log(`SESSION_COOKIE_NAME: ${cookieName}`);

// En producción, secure debería ser true solo si usas HTTPS
if (nodeEnv === 'production') {
    const isSecure = cookieSecure === undefined ? true : cookieSecure === 'true';
    const usesHttps = publicOrigin?.startsWith('https://');
    
    if (isSecure && !usesHttps) {
        issues.push('SESSION_COOKIE_SECURE es true pero PUBLIC_ORIGIN usa HTTP - las cookies no se enviarán');
        issues.push('SOLUCIÓN: Usa HTTPS o añade SESSION_COOKIE_SECURE=false (no recomendado en producción)');
    }
}

// 6. Verificar TRUST_PROXY
const trustProxy = process.env.TRUST_PROXY;
console.log(`TRUST_PROXY: ${trustProxy || '(auto: 1 en producción)'}`);
if (nodeEnv === 'production' && !trustProxy) {
    warnings.push('TRUST_PROXY no está definido - se usará "1" por defecto');
    warnings.push('Si usas un reverse proxy (nginx, Cloudflare, etc.), asegúrate de que esté configurado');
}

// Resumen
console.log('\n========================================');
console.log('  RESUMEN');
console.log('========================================\n');

if (issues.length > 0) {
    console.log('❌ PROBLEMAS CRÍTICOS:');
    issues.forEach(i => console.log(`   • ${i}`));
    console.log('');
}

if (warnings.length > 0) {
    console.log('⚠️  ADVERTENCIAS:');
    warnings.forEach(w => console.log(`   • ${w}`));
    console.log('');
}

if (ok.length > 0) {
    console.log('✅ CONFIGURACIÓN CORRECTA:');
    ok.forEach(o => console.log(`   • ${o}`));
    console.log('');
}

// Recomendaciones
console.log('========================================');
console.log('  CONFIGURACIÓN RECOMENDADA PARA PRODUCCIÓN');
console.log('========================================\n');

console.log(`# .env (ejemplo para dominio con HTTPS)
NODE_ENV=production
SESSION_SECRET=$(openssl rand -base64 48)
PUBLIC_ORIGIN=https://tu-dominio.com
ALLOWED_ORIGINS=https://tu-dominio.com
SESSION_COOKIE_SAMESITE=lax
TRUST_PROXY=1

# Si usas HTTP (NO RECOMENDADO):
# PUBLIC_ORIGIN=http://tu-dominio.com
# SESSION_COOKIE_SECURE=false
`);

console.log('========================================');
console.log('  VERIFICACIÓN EN EL NAVEGADOR');
console.log('========================================\n');

console.log(`1. Abre DevTools (F12) > Application > Cookies
2. Busca la cookie "${cookieName}"
3. Verifica:
   - Que existe después de hacer login
   - Que persiste después de refrescar la página
   - Que el atributo "Secure" coincide con tu protocolo (HTTPS = Secure, HTTP = no Secure)
   - Que el atributo "SameSite" es "${cookieSameSite}"
`);

if (issues.length > 0) {
    process.exit(1);
}
