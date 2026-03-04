/**
 * Email Templates - Central export
 * All email templates are defined here for easy maintenance
 */

import { welcomeTemplate } from './welcome.js';
import { verificationTemplate } from './verification.js';
import { passwordResetTemplate } from './passwordReset.js';
import { fileSharedTemplate } from './fileShared.js';
import { downloadNotificationTemplate } from './downloadNotification.js';

export const DEFAULT_EMAIL_TEMPLATES = {
    welcome: welcomeTemplate,
    verification: verificationTemplate,
    passwordReset: passwordResetTemplate,
    fileShared: fileSharedTemplate,
    downloadNotification: downloadNotificationTemplate
};

export const EMAIL_VARIABLES = [
    { key: '{{username}}', description: 'Nombre del usuario' },
    { key: '{{email}}', description: 'Email del usuario' },
    { key: '{{fileName}}', description: 'Nombre del archivo' },
    { key: '{{fileSize}}', description: 'Tamaño del archivo' },
    { key: '{{downloadLink}}', description: 'Enlace de descarga' },
    { key: '{{expirationDate}}', description: 'Fecha de expiración' },
    { key: '{{appName}}', description: 'Nombre de la aplicación' },
    { key: '{{appUrl}}', description: 'URL de la aplicación' },
    { key: '{{logoUrl}}', description: 'URL del logo' },
    { key: '{{verificationLink}}', description: 'Enlace de verificación' },
    { key: '{{resetLink}}', description: 'Enlace de reseteo de contraseña' },
];

export default DEFAULT_EMAIL_TEMPLATES;
