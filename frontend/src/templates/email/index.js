/**
 * Email Templates - Central export for Frontend
 * These are used in the EmailTemplateEditor for preview and defaults
 */

import { welcomeTemplate } from './welcome';
import { verificationTemplate } from './verification';
import { passwordResetTemplate } from './passwordReset';
import { fileSharedTemplate } from './fileShared';
import { downloadNotificationTemplate } from './downloadNotification';

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
